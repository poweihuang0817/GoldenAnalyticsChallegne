import type { substrait as S } from './generated/substrait.cjs';
import { substrait as s, ref, toPlanJson } from './plan.js';
import type { Catalog } from './compiler.js';
import { FUNCTIONS, FUNCTION_URI } from './functions.js';

type Kind = Catalog[string][number]['type'];
type Field = { name: string; type: Kind; nullable: boolean };
type Scope = Map<symbol, number>;
/** Field-based ordering. Direction defaults to ascending and NULLs to last. */
export type Sort = { column: string; direction?: 'asc' | 'desc'; nulls?: 'first' | 'last' };
const type = (kind: Kind, nullable: boolean): S.IType => ({ [kind]: {
  nullability: nullable ? s.Type.Nullability.NULLABILITY_NULLABLE : s.Type.Nullability.NULLABILITY_REQUIRED,
  ...(kind === 'decimal' ? { precision: 38, scale: 10 } : {}),
} });
const anchor = (name: typeof FUNCTIONS[number]) => FUNCTIONS.indexOf(name) + 1;

/** Expressions are lazy and bound to a relation scope, never SQL strings. */
export class Expr {
  /** @internal Construct expressions with Columns.col, literals and expression methods. */
  constructor(readonly kind: Kind, readonly nullable: boolean,
    private readonly build: (scope: Scope) => S.IExpression) {}
  /** @internal Resolve against a relation scope; applications use Table.toSubstrait(). */
  resolve(scope: Scope) { return this.build(scope); }
  private call(name: typeof FUNCTIONS[number], args: Expr[], kind: Kind, nullable: boolean) {
    return new Expr(kind, nullable, scope => ({ scalarFunction: {
      functionReference: anchor(name), arguments: args.map(a => ({ value: a.resolve(scope) })), outputType: type(kind, nullable),
    } }));
  }
  /** SQL equality over matching kinds. Use isNull to test for NULL. */
  eq(value: Expr | string | number | boolean) {
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
  lte(value: Expr | number) {
    const other = typeof value === 'number' && this.kind === 'i64' ? integer(value) : asExpr(value, this.kind);
    numeric(this); numeric(other);
    if (this.kind !== other.kind && ![this.kind, other.kind].every(k => ['i32', 'i64'].includes(k))) throw new Error('Comparison requires matching numeric types or integer widths');
    return this.call('less_than_or_equal', [this, other], 'bool', this.nullable || other.nullable);
  }
  /** Return a non-null boolean indicating whether this value is NULL. */
  isNull() { return this.call('is_null', [this], 'bool', false); }
  /** Return a non-null boolean indicating whether this value is not NULL. */
  isNotNull() { return this.call('is_not_null', [this], 'bool', false); }
  /** Boolean conjunction using SQL three-valued logic. */
  and(other: Expr) {
    if (this.kind !== 'bool' || other.kind !== 'bool') throw new Error('and requires bool');
    return this.call('and', [this, other], 'bool', this.nullable || other.nullable);
  }
  /** Use a same-kind fallback when NULL; decimal also accepts i32 fallback. */
  coalesce(value: Expr | string | number | boolean) {
    const other = asExpr(value, this.kind);
    if (this.kind !== other.kind && !(this.kind === 'decimal' && other.kind === 'i32')) throw new Error('Invalid coalesce types');
    return this.call('coalesce', [this, other], this.kind, this.nullable && other.nullable);
  }
  private arithmetic(name: 'multiply' | 'subtract' | 'divide', value: Expr | number) {
    const other = asExpr(value, this.kind);
    numeric(this); numeric(other);
    const exact = this.kind === 'decimal' || other.kind === 'decimal';
    if (exact && (this.kind === 'fp64' || other.kind === 'fp64')) throw new Error('Cannot mix decimal and fp64');
    return this.call(name, [this, other], exact ? 'decimal' : 'fp64', name === 'divide' || this.nullable || other.nullable);
  }
  /** Multiply numeric values; decimal/fp64 mixing is rejected. */
  mul(value: Expr | number) { return this.arithmetic('multiply', value); }
  /** Subtract numeric values; non-decimal arithmetic produces fp64. */
  sub(value: Expr | number) { return this.arithmetic('subtract', value); }
  /** Divide numeric values, producing NULL for a zero divisor. Backend precision limits apply. */
  div(value: Expr | number) { return this.arithmetic('divide', value); }
  /** Sum non-null inputs as a Measure; empty/all-null input gives NULL. */
  sum() { numeric(this); return new Measure('sum', [this], this.kind === 'decimal' ? 'decimal' : 'fp64', true); }
  /** Average non-null inputs as a Measure; DuckDB exact decimal AVG is unsupported. */
  avg() { numeric(this); return new Measure('avg', [this], this.kind === 'decimal' ? 'decimal' : 'fp64', true); }
  /** Count non-null inputs as an i64 Measure. Use the count helper to count rows. */
  count() { return new Measure('count', [this], 'i64', false); }
  /**
   * Continuous percentile of non-null inputs, with fixed-scale limits for decimals.
   * @param fraction - Finite value in [0, 1]; decimal inputs permit at most ten fractional places.
   * @returns A Measure that must be the sole measure in its aggregate.
   */
  percentile(fraction: number) {
    numeric(this);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('Percentile fraction must be in [0, 1]');
    if (this.kind === 'decimal' && Number(fraction.toFixed(10)) !== fraction) throw new Error('Decimal percentile supports at most 10 decimal places');
    return new Measure('percentile_cont', [this, literal(fraction)], this.kind === 'decimal' ? 'decimal' : 'fp64', true);
  }
}
function numeric(expr: Expr) {
  if (!['i32', 'i64', 'fp64', 'decimal'].includes(expr.kind)) throw new Error('Numeric expression required');
}
/** Construct a required literal. Finite numbers become fp64; use integer for exact i32. */
export function literal(value: string | number | boolean): Expr {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Finite literal required');
  const kind = typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool' : 'fp64';
  return new Expr(kind, false, () => ({ literal: { [kind === 'bool' ? 'boolean' : kind]: value } }));
}
/** Construct a required signed 32-bit integer literal; rejects fractions and out-of-range values. */
export function integer(value: number): Expr {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('i32 literal out of range');
  return new Expr('i32', false, () => ({ literal: { i32: value } }));
}
function asExpr(value: Expr | string | number | boolean, hint: Kind): Expr {
  if (value instanceof Expr) return value;
  return typeof value === 'number' && (hint === 'i32' || hint === 'decimal') ? integer(value) : literal(value);
}
/** SQL CASE with a boolean condition and same-kind branches; false/NULL selects no. */
export function caseWhen(condition: Expr, yes: Expr, no: Expr): Expr {
  if (condition.kind !== 'bool' || yes.kind !== no.kind) throw new Error('Invalid CASE types');
  return new Expr(yes.kind, yes.nullable || no.nullable, scope => ({ ifThen: {
    ifs: [{ if: condition.resolve(scope), then: yes.resolve(scope) }], else: no.resolve(scope),
  } }));
}
/** Aggregate description returned by Expr aggregate methods and accepted by Table.aggregate. */
export class Measure {
  /** @internal Use sum, avg, count or percentile builders. */
  constructor(readonly name: 'sum' | 'avg' | 'count' | 'percentile_cont', readonly args: readonly Expr[], readonly kind: Kind, readonly nullable: boolean) {}
}
/** Count rows, including rows with NULL columns, as an i64 Measure. */
export const count = () => literal(1).count();

/** Callback-local column scope. A captured column cannot be reused on another relation. */
export class Columns {
  /** @internal Columns are provided by Table callbacks. */
  constructor(private readonly fields: readonly Field[], private readonly id: symbol) {}
  /** Look up a current field by name. Unknown names or use outside this scope fail. */
  col(name: string): Expr {
    const index = this.fields.findIndex(f => f.name === name);
    if (index < 0) throw new Error(`Unknown column: ${name}`);
    const field = this.fields[index];
    return new Expr(field.type, field.nullable, scope => {
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
export class Table {
  private readonly id = Symbol('relation');
  /** @internal Start with createSource(catalog).table(name). */
  constructor(private readonly relation: S.IRel, private readonly fields: readonly Field[], private readonly source: symbol) {}
  private columns() { return new Columns(this.fields, this.id); }
  private scope() { return new Map([[this.id, 0]]); }
  /** Project named scalar expressions. Object keys define the new output schema. */
  select(build: (t: Columns) => Record<string, Expr>): Table {
    const entries = Object.entries(build(this.columns())); names(entries.map(([n]) => n));
    return new Table({ project: { input: this.relation, expressions: entries.map(([, e]) => e.resolve(this.scope())),
      common: { emit: { outputMapping: entries.map((_, i) => this.fields.length + i) } } } },
    entries.map(([name, e]) => ({ name, type: e.kind, nullable: e.nullable })), this.source);
  }
  /** Keep rows where the constructed boolean expression is true; false/NULL are discarded. */
  filter(build: (t: Columns) => Expr): Table {
    const expr = build(this.columns());
    if (expr.kind !== 'bool') throw new Error('Filter requires bool');
    return new Table({ filter: { input: this.relation, condition: expr.resolve(this.scope()) } }, this.fields, this.source);
  }
  /** Group by existing unique field names, then call aggregate. No keys means a global aggregate. */
  groupBy(...keys: string[]) {
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate grouping columns');
    keys.forEach(k => this.columns().col(k));
    return { aggregate: (build: (t: Columns) => Record<string, Measure>) => this.aggregate(build, keys) };
  }
  /**
   * Aggregate into a reusable Table, outputting group keys followed by named measures.
   * @param build - Construct at least one Measure using the current input columns.
   * @param keys - Optional grouping fields; defaults to global aggregation.
   */
  aggregate(build: (t: Columns) => Record<string, Measure>, keys: string[] = []): Table {
    const entries = Object.entries(build(this.columns()));
    if (!entries.length) throw new Error('At least one measure required');
    names([...keys, ...entries.map(([n]) => n)]);
    if (entries.some(([, m]) => m.name === 'percentile_cont') && entries.length !== 1) throw new Error('Percentile must be the sole measure');
    const groups = keys.map(k => { this.columns().col(k); return this.fields.find(f => f.name === k)!; });
    return new Table({ aggregate: { input: this.relation,
      groupings: [{ groupingExpressions: keys.map(k => this.columns().col(k).resolve(this.scope())) }],
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
  join(right: Table, options: { how: 'inner' | 'left'; on: (left: Columns, right: Columns) => Expr;
    select: (left: Columns, right: Columns) => Record<string, Expr> }): Table {
    if (this.source !== right.source) throw new Error('Cross-source joins are not supported');
    if (!['inner', 'left'].includes(options.how)) throw new Error('Unsupported join type');
    // Separate occurrence IDs also make self-joins unambiguous.
    const leftId = Symbol(), rightId = Symbol();
    const left = new Columns(this.fields, leftId), r = new Columns(right.fields, rightId);
    const scope = new Map([[leftId, 0], [rightId, this.fields.length]]);
    const condition = options.on(left, r);
    if (condition.kind !== 'bool') throw new Error('Join condition requires bool');
    // Predicate fields describe inputs; output fields describe the nullable join result.
    // Do not allow captured predicate expressions to bypass that boundary.
    const outputLeftId = Symbol(), outputRightId = Symbol();
    const outputScope = new Map([[outputLeftId, 0], [outputRightId, this.fields.length]]);
    const leftOutput = new Columns(this.fields, outputLeftId);
    const rightOutput = new Columns(right.fields.map(f => ({ ...f, nullable: f.nullable || options.how === 'left' })), outputRightId);
    const entries = Object.entries(options.select(leftOutput, rightOutput)); names(entries.map(([n]) => n));
    const joined: S.IRel = { join: { left: this.relation, right: right.relation, expression: condition.resolve(scope),
      type: options.how === 'left' ? s.JoinRel.JoinType.JOIN_TYPE_LEFT : s.JoinRel.JoinType.JOIN_TYPE_INNER } };
    return new Table({ project: { input: joined, expressions: entries.map(([, e]) => e.resolve(outputScope)),
      common: { emit: { outputMapping: entries.map((_, i) => this.fields.length + right.fields.length + i) } } } },
    entries.map(([name, e]) => ({ name, type: e.kind, nullable: e.nullable })), this.source);
  }
  private sortFields(sorts: Sort[]) {
    if (!sorts.length) throw new Error('At least one sort required');
    return sorts.map(sort => {
      const direction = sort.direction ?? 'asc', nulls = sort.nulls ?? 'last';
      if (!['asc', 'desc'].includes(direction) || !['first', 'last'].includes(nulls)) throw new Error('Invalid sort');
      const key = `SORT_DIRECTION_${direction.toUpperCase()}_NULLS_${nulls.toUpperCase()}` as keyof typeof s.SortField.SortDirection;
      return { expr: this.columns().col(sort.column).resolve(this.scope()), direction: s.SortField.SortDirection[key] };
    });
  }
  /** Order by at least one field; defaults to ascending/NULLs last. Add tie-breakers for pagination. */
  orderBy(...sorts: Sort[]): Table {
    return new Table({ sort: { input: this.relation, sorts: this.sortFields(sorts) } }, this.fields, this.source);
  }
  /** Append a required i64 row number starting at 1. Empty partitions are global; ordering is required. */
  withRowNumber(name: string, options: { partitionBy: string[]; orderBy: Sort[] }): Table {
    names([...this.fields.map(f => f.name), name]);
    if (new Set(options.partitionBy).size !== options.partitionBy.length) throw new Error('Duplicate partition columns');
    return new Table({ window: {
      input: this.relation,
      partitionExpressions: options.partitionBy.map(key => this.columns().col(key).resolve(this.scope())),
      sorts: this.sortFields(options.orderBy),
      windowFunctions: [{ functionReference: anchor('row_number'), arguments: [], outputType: type('i64', false),
        phase: s.AggregationPhase.AGGREGATION_PHASE_INITIAL_TO_RESULT,
        invocation: s.AggregateFunction.AggregationInvocation.AGGREGATION_INVOCATION_ALL }],
    } }, [...this.fields, { name, type: 'i64', nullable: false }], this.source);
  }
  /** Fetch count rows after offset (default 0); both must be nonnegative safe integers. */
  limit(count: number, offset = 0): Table {
    if (![count, offset].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Limit and offset must be nonnegative safe integers');
    return new Table({ fetch: { input: this.relation, count, offset } }, this.fields, this.source);
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
export function createSource(catalog: Catalog) {
  const snapshot = structuredClone(catalog), source = Symbol('source');
  return { table(name: string): Table {
    if (!Object.hasOwn(snapshot, name)) throw new Error(`Unknown table: ${name}`);
    const fields = snapshot[name]; names(fields.map(f => f.name));
    return new Table({ read: { namedTable: { names: [name] }, baseSchema: {
      names: fields.map(f => f.name), struct: { nullability: s.Type.Nullability.NULLABILITY_REQUIRED,
        types: fields.map(f => type(f.type, f.nullable)) },
    } } }, fields, source);
  } };
}
