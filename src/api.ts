import type { substrait as S } from './generated/substrait.cjs';
import { substrait as s, ref, toPlanJson } from './plan.js';
import type { Catalog } from './compiler.js';
import { FUNCTIONS, FUNCTION_URI } from './functions.js';

type Kind = Catalog[string][number]['type'];
type Field = { name: string; type: Kind; nullable: boolean };
type Scope = Map<symbol, number>;
// Unexported, type-only brands prevent accidental structural construction.
// They are not runtime authentication; scope/profile validation remains required.
declare const exprBrand: unique symbol;
declare const measureBrand: unique symbol;
/** Field-based ordering. Direction defaults to ascending and NULLs to last. */
export type Sort = { column: string; direction?: 'asc' | 'desc'; nulls?: 'first' | 'last' };
const type = (kind: Kind, nullable: boolean): S.IType => ({ [kind]: {
  nullability: nullable ? s.Type.Nullability.NULLABILITY_NULLABLE : s.Type.Nullability.NULLABILITY_REQUIRED,
  ...(kind === 'decimal' ? { precision: 38, scale: 10 } : {}),
} });
const anchor = (name: typeof FUNCTIONS[number]) => FUNCTIONS.indexOf(name) + 1;

/** Expressions are lazy and bound to a relation scope, never SQL strings. */
class RuntimeExpr {
  declare readonly [exprBrand]: true;
  /** @internal Construct expressions with Columns.col, literals and expression methods. */
  constructor(readonly kind: Kind, readonly nullable: boolean,
    private readonly build: (scope: Scope) => S.IExpression) {}
  /** @internal Resolve against a relation scope; applications use RuntimeTable.toSubstrait(). */
  resolve(scope: Scope) { return this.build(scope); }
  private call(name: typeof FUNCTIONS[number], args: RuntimeExpr[], kind: Kind, nullable: boolean) {
    return new RuntimeExpr(kind, nullable, scope => ({ scalarFunction: {
      functionReference: anchor(name), arguments: args.map(a => ({ value: a.resolve(scope) })), outputType: type(kind, nullable),
    } }));
  }
  /** SQL equality over matching kinds. Use isNull to test for NULL. */
  eq(value: RuntimeExpr | string | number | boolean) {
    const other = asExpr(value, this.kind);
    if (this.kind !== other.kind) throw new Error('Equality requires matching types');
    return this.call('equal', [this, other], 'bool', this.nullable || other.nullable);
  }
  /** Lowercase a string expression in the selected database. */
  lower() {
    if (this.kind !== 'string') throw new Error('lower requires string');
    return this.call('lower', [this], 'string', this.nullable);
  }
  /** Numeric less-than-or-equal; permits mixed i32/i64. i64 number shorthand must fit i32. */
  lte(value: RuntimeExpr | number) {
    const other = typeof value === 'number' && this.kind === 'i64' ? runtimeInteger(value) : asExpr(value, this.kind);
    numeric(this); numeric(other);
    if (this.kind !== other.kind && ![this.kind, other.kind].every(k => ['i32', 'i64'].includes(k))) throw new Error('Comparison requires matching numeric types or integer widths');
    return this.call('less_than_or_equal', [this, other], 'bool', this.nullable || other.nullable);
  }
  /** Return a non-null boolean indicating whether this value is NULL. */
  isNull() { return this.call('is_null', [this], 'bool', false); }
  /** Return a non-null boolean indicating whether this value is not NULL. */
  isNotNull() { return this.call('is_not_null', [this], 'bool', false); }
  /** Boolean conjunction using SQL three-valued logic. */
  and(other: RuntimeExpr) {
    if (this.kind !== 'bool' || other.kind !== 'bool') throw new Error('and requires bool');
    return this.call('and', [this, other], 'bool', this.nullable || other.nullable);
  }
  /** Use a same-kind fallback when NULL; decimal also accepts i32 fallback. */
  coalesce(value: RuntimeExpr | string | number | boolean) {
    const other = asExpr(value, this.kind);
    if (this.kind !== other.kind && !(this.kind === 'decimal' && other.kind === 'i32')) throw new Error('Invalid coalesce types');
    return this.call('coalesce', [this, other], this.kind, this.nullable && other.nullable);
  }
  private arithmetic(name: 'multiply' | 'subtract' | 'divide', value: RuntimeExpr | number) {
    const other = asExpr(value, this.kind);
    numeric(this); numeric(other);
    const exact = this.kind === 'decimal' || other.kind === 'decimal';
    if (exact && (this.kind === 'fp64' || other.kind === 'fp64')) throw new Error('Cannot mix decimal and fp64');
    return this.call(name, [this, other], exact ? 'decimal' : 'fp64', name === 'divide' || this.nullable || other.nullable);
  }
  /** Multiply numeric values; decimal/fp64 mixing is rejected. */
  mul(value: RuntimeExpr | number) { return this.arithmetic('multiply', value); }
  /** Subtract numeric values; non-decimal arithmetic produces fp64. */
  sub(value: RuntimeExpr | number) { return this.arithmetic('subtract', value); }
  /** Divide numeric values, producing NULL for a zero divisor. Backend precision limits apply. */
  div(value: RuntimeExpr | number) { return this.arithmetic('divide', value); }
  /** Sum non-null inputs as a RuntimeMeasure; empty/all-null input gives NULL. */
  sum() { numeric(this); return new RuntimeMeasure('sum', [this], this.kind === 'decimal' ? 'decimal' : 'fp64', true); }
  /** Average non-null inputs as a RuntimeMeasure; DuckDB exact decimal AVG is unsupported. */
  avg() { numeric(this); return new RuntimeMeasure('avg', [this], this.kind === 'decimal' ? 'decimal' : 'fp64', true); }
  /** Count non-null inputs as an i64 RuntimeMeasure. Use the count helper to count rows. */
  count() { return new RuntimeMeasure('count', [this], 'i64', false); }
  /**
   * Continuous percentile of non-null inputs, with fixed-scale limits for decimals.
   * @param fraction - Finite value in [0, 1]; decimal inputs permit at most ten fractional places.
   * @returns A RuntimeMeasure that must be the sole measure in its aggregate.
   */
  percentile(fraction: number) {
    numeric(this);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('Percentile fraction must be in [0, 1]');
    if (this.kind === 'decimal' && Number(fraction.toFixed(10)) !== fraction) throw new Error('Decimal percentile supports at most 10 decimal places');
    return new RuntimeMeasure('percentile_cont', [this, runtimeLiteral(fraction)], this.kind === 'decimal' ? 'decimal' : 'fp64', true);
  }
}
function numeric(expr: RuntimeExpr) {
  if (!['i32', 'i64', 'fp64', 'decimal'].includes(expr.kind)) throw new Error('Numeric expression required');
}
/** Construct a required literal. Finite numbers become fp64; use integer for exact i32. */
function runtimeLiteral(value: string | number | boolean): RuntimeExpr {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Finite literal required');
  const kind = typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool' : 'fp64';
  return new RuntimeExpr(kind, false, () => ({ literal: { [kind === 'bool' ? 'boolean' : kind]: value } }));
}
/** Construct a required signed 32-bit integer literal; rejects fractions and out-of-range values. */
function runtimeInteger(value: number): RuntimeExpr {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('i32 literal out of range');
  return new RuntimeExpr('i32', false, () => ({ literal: { i32: value } }));
}
function asExpr(value: RuntimeExpr | string | number | boolean, hint: Kind): RuntimeExpr {
  if (value instanceof RuntimeExpr) return value;
  return typeof value === 'number' && (hint === 'i32' || hint === 'decimal') ? runtimeInteger(value) : runtimeLiteral(value);
}
/** SQL CASE with a boolean condition and same-kind branches; false/NULL selects no. */
function runtimeCaseWhen(condition: RuntimeExpr, yes: RuntimeExpr, no: RuntimeExpr): RuntimeExpr {
  if (condition.kind !== 'bool' || yes.kind !== no.kind) throw new Error('Invalid CASE types');
  return new RuntimeExpr(yes.kind, yes.nullable || no.nullable, scope => ({ ifThen: {
    ifs: [{ if: condition.resolve(scope), then: yes.resolve(scope) }], else: no.resolve(scope),
  } }));
}
/** Aggregate description returned by RuntimeExpr aggregate methods and accepted by RuntimeTable.aggregate. */
class RuntimeMeasure {
  declare readonly [measureBrand]: true;
  /** @internal Use sum, avg, count or percentile builders. */
  constructor(readonly name: 'sum' | 'avg' | 'count' | 'percentile_cont', readonly args: readonly RuntimeExpr[], readonly kind: Kind, readonly nullable: boolean) {}
}
/** Relation-local column scope; runtime identity is checked during lowering. */
class RuntimeColumns {
  /** @internal Columns belong to a RuntimeTable or a join occurrence. */
  constructor(private readonly fields: readonly Field[], private readonly id: symbol) {}
  /** Look up a current field by name. Unknown names or use outside this scope fail. */
  col(name: string): RuntimeExpr {
    const index = this.fields.findIndex(f => f.name === name);
    if (index < 0) throw new Error(`Unknown column: ${name}`);
    const field = this.fields[index];
    return new RuntimeExpr(field.type, field.nullable, scope => {
      const offset = scope.get(this.id);
      if (offset === undefined) throw new Error('Column belongs to a different relation scope');
      return ref(offset + index);
    });
  }
}
function names(values: string[]) {
  if (!values.length || values.some(n => !n.length) || new Set(values).size !== values.length) throw new Error('Expected nonempty unique column names');
}
/** Immutable relational description. Transformations build plans; execution is separate. */
class RuntimeTable {
  private readonly id = Symbol('relation');
  /** @internal Start with createSource(catalog).table(name). */
  constructor(private readonly relation: S.IRel, private readonly fields: readonly Field[], private readonly source: symbol) {}
  private columnScope() { return new RuntimeColumns(this.fields, this.id); }
  get columns() { return columnMap(this.fields, this.id); }
  col(name: string) { return this.columnScope().col(name); }
  private scope() { return new Map([[this.id, 0]]); }
  /** Project named scalar expressions. Object keys define the new output schema. */
  select(expressions: Record<string, RuntimeExpr>): RuntimeTable {
    if (typeof expressions === 'function') throw new Error('Callbacks are not supported; pass a projection object');
    const entries = Object.entries(expressions); names(entries.map(([n]) => n));
    return new RuntimeTable({ project: { input: this.relation, expressions: entries.map(([, e]) => e.resolve(this.scope())),
      common: { emit: { outputMapping: entries.map((_, i) => this.fields.length + i) } } } },
    entries.map(([name, e]) => ({ name, type: e.kind, nullable: e.nullable })), this.source);
  }
  /** Keep rows where the constructed boolean expression is true; false/NULL are discarded. */
  filter(expr: RuntimeExpr): RuntimeTable {
    if (expr.kind !== 'bool') throw new Error('Filter requires bool');
    return new RuntimeTable({ filter: { input: this.relation, condition: expr.resolve(this.scope()) } }, this.fields, this.source);
  }
  /** Group by existing unique field names, then call aggregate. No keys means a global aggregate. */
  groupBy(...keys: string[]) {
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate grouping columns');
    keys.forEach(k => this.columnScope().col(k));
    return { aggregate: (measures: Record<string, RuntimeMeasure>) => this.aggregate(measures, keys) };
  }
  /**
   * Aggregate into a reusable RuntimeTable, outputting group keys followed by named measures.
   * @param measures - At least one aggregate using the current input columns.
   * @param keys - Optional grouping fields; defaults to global aggregation.
   */
  aggregate(measures: Record<string, RuntimeMeasure>, keys: string[] = []): RuntimeTable {
    if (typeof measures === 'function') throw new Error('Callbacks are not supported; pass a measure object');
    const entries = Object.entries(measures);
    if (!entries.length) throw new Error('At least one measure required');
    names([...keys, ...entries.map(([n]) => n)]);
    if (entries.some(([, m]) => m.name === 'percentile_cont') && entries.length !== 1) throw new Error('Percentile must be the sole measure');
    const groups = keys.map(k => { this.columnScope().col(k); return this.fields.find(f => f.name === k)!; });
    return new RuntimeTable({ aggregate: { input: this.relation,
      groupings: [{ groupingExpressions: keys.map(k => this.columnScope().col(k).resolve(this.scope())) }],
      measures: entries.map(([, m]) => ({ measure: {
        functionReference: anchor(m.name), arguments: m.args.map(a => ({ value: a.resolve(this.scope()) })),
        outputType: type(m.kind, m.nullable), phase: s.AggregationPhase.AGGREGATION_PHASE_INITIAL_TO_RESULT,
        invocation: s.AggregateFunction.AggregationInvocation.AGGREGATION_INVOCATION_ALL,
      } })),
    } }, [...groups, ...entries.map(([name, m]) => ({ name, type: m.kind, nullable: m.nullable }))], this.source);
  }
  /**
   * Join tables from the same Source with explicit named outputs.
   * @remarks Left-join right outputs are nullable. Predicate/output scopes are distinct.
   */
  join(right: RuntimeTable, options: { how: 'inner' | 'left' }) {
    if (this.source !== right.source) throw new Error('Cross-source joins are not supported');
    if (!['inner', 'left'].includes(options.how)) throw new Error('Unsupported join type');
    const leftId = Symbol(), rightId = Symbol();
    const scope = new Map([[leftId, 0], [rightId, this.fields.length]]);
    return {
      left: columnMap(this.fields, leftId), right: columnMap(right.fields, rightId),
      on: (condition: RuntimeExpr) => {
        if (condition.kind !== 'bool') throw new Error('Join condition requires bool');
        const joined: S.IRel = { join: { left: this.relation, right: right.relation,
          expression: condition.resolve(scope),
          type: options.how === 'left' ? s.JoinRel.JoinType.JOIN_TYPE_LEFT : s.JoinRel.JoinType.JOIN_TYPE_INNER } };
        const outputLeftId = Symbol(), outputRightId = Symbol();
        const outputScope = new Map([[outputLeftId, 0], [outputRightId, this.fields.length]]);
        return {
          left: columnMap(this.fields, outputLeftId),
          right: columnMap(right.fields.map(f => ({ ...f, nullable: f.nullable || options.how === 'left' })), outputRightId),
          select: (expressions: Record<string, RuntimeExpr>) => {
            if (typeof expressions === 'function') throw new Error('Callbacks are not supported; pass a projection object');
            const entries = Object.entries(expressions); names(entries.map(([n]) => n));
            return new RuntimeTable({ project: { input: joined,
              expressions: entries.map(([, e]) => e.resolve(outputScope)),
              common: { emit: { outputMapping: entries.map((_, i) => this.fields.length + right.fields.length + i) } } } },
              entries.map(([name, e]) => ({ name, type: e.kind, nullable: e.nullable })), this.source);
          },
        };
      },
    };
  }
  private sortFields(sorts: Sort[]) {
    if (!sorts.length) throw new Error('At least one sort required');
    return sorts.map(sort => {
      const direction = sort.direction ?? 'asc', nulls = sort.nulls ?? 'last';
      if (!['asc', 'desc'].includes(direction) || !['first', 'last'].includes(nulls)) throw new Error('Invalid sort');
      const key = `SORT_DIRECTION_${direction.toUpperCase()}_NULLS_${nulls.toUpperCase()}` as keyof typeof s.SortField.SortDirection;
      return { expr: this.columnScope().col(sort.column).resolve(this.scope()), direction: s.SortField.SortDirection[key] };
    });
  }
  /** Order by at least one field; defaults to ascending/NULLs last. Add tie-breakers for pagination. */
  orderBy(...sorts: Sort[]): RuntimeTable {
    return new RuntimeTable({ sort: { input: this.relation, sorts: this.sortFields(sorts) } }, this.fields, this.source);
  }
  /** Append a required i64 row number starting at 1. Empty partitions are global; ordering is required. */
  withRowNumber(name: string, options: { partitionBy: string[]; orderBy: Sort[] }): RuntimeTable {
    names([...this.fields.map(f => f.name), name]);
    if (new Set(options.partitionBy).size !== options.partitionBy.length) throw new Error('Duplicate partition columns');
    return new RuntimeTable({ window: {
      input: this.relation,
      partitionExpressions: options.partitionBy.map(key => this.columnScope().col(key).resolve(this.scope())),
      sorts: this.sortFields(options.orderBy),
      windowFunctions: [{ functionReference: anchor('row_number'), arguments: [], outputType: type('i64', false),
        phase: s.AggregationPhase.AGGREGATION_PHASE_INITIAL_TO_RESULT,
        invocation: s.AggregateFunction.AggregationInvocation.AGGREGATION_INVOCATION_ALL }],
    } }, [...this.fields, { name, type: 'i64', nullable: false }], this.source);
  }
  /** Fetch count rows after offset (default 0); both must be nonnegative safe integers. */
  limit(count: number, offset = 0): RuntimeTable {
    if (![count, offset].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Limit and offset must be nonnegative safe integers');
    return new RuntimeTable({ fetch: { input: this.relation, count, offset } }, this.fields, this.source);
  }
  /** Export a fresh profile-validated JSON plan. Compilation still validates catalog/function semantics. */
  toSubstrait() {
    return toPlanJson({ version: { majorNumber: 0, minorNumber: 63, patchNumber: 0 },
      extensionUris: [{ extensionUriAnchor: 1, uri: FUNCTION_URI }],
      extensions: FUNCTIONS.map(name => ({ extensionFunction: { extensionUriReference: 1, functionAnchor: anchor(name), name } })),
      relations: [{ root: { input: this.relation, names: this.fields.map(f => f.name) } }],
    });
  }
}
/**
 * Snapshot a logical catalog and return a table factory; does not connect to a database.
 * @remarks Reuse the same source for joined tables. Separate factory calls have distinct identities.
 */
function runtimeSource(catalog: Catalog) {
  const snapshot = structuredClone(catalog), source = Symbol('source');
  return { table(name: string): RuntimeTable {
    if (!Object.hasOwn(snapshot, name)) throw new Error(`Unknown table: ${name}`);
    const fields = snapshot[name]; names(fields.map(f => f.name));
    return new RuntimeTable({ read: { namedTable: { names: [name] }, baseSchema: {
      names: fields.map(f => f.name), struct: { nullability: s.Type.Nullability.NULLABILITY_REQUIRED,
        types: fields.map(f => type(f.type, f.nullable)) },
    } } }, fields, source);
  } };
}

function columnMap(fields: readonly Field[], id: symbol): Record<string, RuntimeExpr> {
  const scope = new RuntimeColumns(fields, id);
  return Object.fromEntries(fields.map(f => [f.name, scope.col(f.name)]));
}

// The public type surface mirrors the runtime builder. Assertions are confined to
// this factory boundary; schema/type facts are propagated, never result values coerced.
export type Schema = Record<string, { type: Kind; nullable: boolean }>;
export type NumericKind = 'i32' | 'i64' | 'fp64' | 'decimal';
type Or<A extends boolean, B extends boolean> = true extends A | B ? true : false;
type And<A extends boolean, B extends boolean> = true extends A ? true extends B ? true : false : false;
type NullableOf<V> = V extends { nullable: infer N extends boolean } ? N : false;
type Primitive<K extends Kind> = K extends 'string' ? string : K extends 'bool' ? boolean : K extends 'i32' | 'fp64' ? number : never;
type Input<K extends Kind> = Expr<K> | Primitive<K>;
type ArithmeticKind<K extends Kind, V> = K extends 'decimal' ? 'decimal' : V extends { kind: infer L extends Kind } ? L extends 'decimal' ? 'decimal' : 'fp64' : 'fp64';
type ArithmeticInput<K extends Kind> = number | Expr<K extends 'decimal' ? 'decimal' | 'i32' | 'i64' : K extends 'fp64' ? 'fp64' | 'i32' | 'i64' : NumericKind>;
type AggregateKind<K extends Kind> = K extends 'decimal' ? 'decimal' : 'fp64';
/** A scalar expression: logical kind and SQL nullability are tracked separately. */
export interface Expr<K extends Kind = Kind, N extends boolean = boolean> {
  readonly [exprBrand]: true;
  readonly kind: K;
  readonly nullable: N;
  /** @internal Substrait lowering hook; applications use Table.toSubstrait(). */
  resolve(scope: Scope): S.IExpression;
  eq<V extends Input<K>>(value: V): Expr<'bool', Or<N, NullableOf<V>>>;
  lower(this: Expr<'string', N>): Expr<'string', N>;
  lte<V extends (K extends 'decimal' ? never : number) | Expr<K extends 'i32' | 'i64' ? 'i32' | 'i64' : K>>(this: Expr<NumericKind, N>, value: V): Expr<'bool', Or<N, NullableOf<V>>>;
  isNull(): Expr<'bool', false>;
  isNotNull(): Expr<'bool', false>;
  and<M extends boolean>(this: Expr<'bool', N>, other: Expr<'bool', M>): Expr<'bool', Or<N, M>>;
  coalesce<V extends Input<K> | (K extends 'decimal' ? Expr<'i32'> | number : never)>(value: V): Expr<K, And<N, NullableOf<V>>>;
  mul<V extends ArithmeticInput<K>>(this: Expr<NumericKind, N>, value: V): Expr<ArithmeticKind<K, V>, Or<N, NullableOf<V>>>;
  sub<V extends ArithmeticInput<K>>(this: Expr<NumericKind, N>, value: V): Expr<ArithmeticKind<K, V>, Or<N, NullableOf<V>>>;
  div<V extends ArithmeticInput<K>>(this: Expr<NumericKind, N>, value: V): Expr<ArithmeticKind<K, V>, true>;
  sum(this: Expr<NumericKind, N>): Measure<AggregateKind<K>, true>;
  avg(this: Expr<NumericKind, N>): Measure<AggregateKind<K>, true>;
  count(): Measure<'i64', false>;
  percentile(this: Expr<NumericKind, N>, fraction: number): Measure<AggregateKind<K>, true>;
}
/** Aggregate expression, accepted only by aggregate(). */
export interface Measure<K extends Kind = Kind, N extends boolean = boolean> {
  readonly [measureBrand]: true;
  readonly name: 'sum' | 'avg' | 'count' | 'percentile_cont';
  readonly args: readonly Expr[];
  readonly kind: K;
  readonly nullable: N;
}
export type Columns<R extends Schema> = { readonly [P in keyof R]: Expr<R[P]['type'], R[P]['nullable']> };
type Output<E extends Record<string, { kind: Kind; nullable: boolean }>> = {
  [P in keyof E]: { type: E[P]['kind']; nullable: E[P]['nullable'] }
};
type Widen<R extends Schema> = { [P in keyof R]: { type: R[P]['type']; nullable: true } };
// Structural names must describe one actual schema, not a union of possible schemas.
type IsUnion<T, Whole = T> = T extends Whole ? [Whole] extends [T] ? false : true : never;
type Single<T> = true extends IsUnion<T> ? never : unknown;
type LiteralName<T extends string> = string extends T ? never : Single<T>;
type KnownKeys<E> = string extends keyof E ? never : unknown;
type GroupKeys<P extends readonly string[]> = number extends P['length'] ? never : { [I in keyof P]: Single<P[I]> };
type Names<R> = Extract<keyof R, string>;
export type TypedSort<R extends Schema> = Omit<Sort, 'column'> & { column: Names<R> };
export interface Query { toSubstrait(): ReturnType<RuntimeTable['toSubstrait']> }
declare const rowSchema: unique symbol;
/** Immutable relation; use columns from this instance when composing a new stage. */
export interface Table<R extends Schema = Schema> extends Query {
  readonly [rowSchema]: R;
  readonly columns: Columns<R>;
  col<P extends Names<R>>(name: P): Columns<R>[P];
  /** Projection keys define the new output schema. */
  select<E extends Record<string, Expr>>(expressions: E & KnownKeys<E>): Table<Output<E>>;
  /** Keep only TRUE rows; false and SQL NULL are discarded. */
  filter(predicate: Expr<'bool'>): Table<R>;
  groupBy<const P extends readonly Names<R>[]>(...keys: P & Single<P> & GroupKeys<P>): {
    aggregate<M extends Record<string, Measure>>(measures: M & KnownKeys<M> & Record<Extract<keyof M, P[number]>, never>): Table<Pick<R, P[number]> & Output<M>>;
  };
  aggregate<M extends Record<string, Measure>>(measures: M & KnownKeys<M>): Table<Output<M>>;
  /** Build on() from input columns, then select from the nullable output columns. */
  join<T extends Schema, H extends 'inner' | 'left'>(right: Table<T>, options: { how: H }): {
    readonly left: Columns<R>;
    readonly right: Columns<T>;
    on(predicate: Expr<'bool'>): {
      readonly left: Columns<R>;
      readonly right: Columns<H extends 'left' ? Widen<T> : T>;
      select<E extends Record<string, Expr>>(expressions: E & KnownKeys<E>): Table<Output<E>>;
    };
  };
  orderBy(...sorts: TypedSort<R>[]): Table<R>;
  withRowNumber<P extends string>(name: P & LiteralName<P> & (P extends keyof R ? never : unknown),
    options: { partitionBy: Names<R>[]; orderBy: TypedSort<R>[] }): Table<R & { [K in P]: { type: 'i64'; nullable: false } }>;
  limit(count: number, offset?: number): Table<R>;
}
type CatalogRow<F extends Catalog[string]> = { [C in F[number] as C['name']]: { type: C['type']; nullable: C['nullable'] } };
/** Snapshot an authored catalog. Preserve literals for schema inference. No connection is opened. */
export function createSource<const C extends Catalog>(catalog: C): {
  table<N extends Extract<keyof C, string>>(name: N & Single<N>): Table<CatalogRow<C[N]>>;
} {
  return runtimeSource(catalog) as unknown as { table<N extends Extract<keyof C, string>>(name: N & Single<N>): Table<CatalogRow<C[N]>> };
}
/** Required literal; JS numbers are fp64. Use integer() for signed i32. */
export function literal<V extends string | number | boolean>(value: V): Expr<V extends string ? 'string' : V extends boolean ? 'bool' : 'fp64', false> {
  return runtimeLiteral(value) as unknown as Expr<V extends string ? 'string' : V extends boolean ? 'bool' : 'fp64', false>;
}
/** Required signed i32 literal; range/integrality are checked at runtime. */
export function integer(value: number): Expr<'i32', false> { return runtimeInteger(value) as unknown as Expr<'i32', false>; }
/** SQL CASE: false/NULL conditions choose no; both branches require the same kind. */
export function caseWhen<K extends Kind, A extends boolean, B extends boolean>(condition: Expr<'bool'>, yes: Expr<K, A>, no: Expr<NoInfer<K>, B>): Expr<K, Or<A, B>> {
  return runtimeCaseWhen(condition as unknown as RuntimeExpr, yes as unknown as RuntimeExpr, no as unknown as RuntimeExpr) as unknown as Expr<K, Or<A, B>>;
}
/** Count rows, including rows with NULL fields. The result is a required i64. */
export const count = (): Measure<'i64', false> => runtimeLiteral(1).count() as unknown as Measure<'i64', false>;
export function eq<K extends Kind, N extends boolean, V extends Input<K>>(left: Expr<K, N>, right: V) { return left.eq(right); }
export function and<A extends boolean, B extends boolean>(left: Expr<'bool', A>, right: Expr<'bool', B>) { return left.and(right); }
// Conservative cross-driver representations: in particular, computed MySQL i32
// expressions can be BIGINT strings. No decimal/bigint precision is discarded.
type Value<K extends Kind> = K extends 'i32' ? number | string : K extends 'i64' | 'decimal' | 'string' | 'date' ? string : K extends 'bool' ? boolean | number : number;
export type ResultRow<R extends Schema> = { [P in keyof R]: Value<R[P]['type']> | (true extends R[P]['nullable'] ? null : never) };
export type InferRow<Q extends Query> = Q extends Table<infer R> ? ResultRow<R> : Record<string, unknown>;
