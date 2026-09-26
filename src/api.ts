import type { substrait as S } from './generated/substrait.cjs';
import { substrait as s, ref, toPlanJson } from './plan.js';
import type { Catalog } from './compiler.js';
import { FUNCTIONS, FUNCTION_URI } from './functions.js';

type Kind = Catalog[string][number]['type'];
type Field = { name: string; type: Kind; nullable: boolean };
type Scope = Map<symbol, number>;
const type = (kind: Kind, nullable: boolean): S.IType => ({ [kind]: {
  nullability: nullable ? s.Type.Nullability.NULLABILITY_NULLABLE : s.Type.Nullability.NULLABILITY_REQUIRED,
  ...(kind === 'decimal' ? { precision: 38, scale: 10 } : {}),
} });
const anchor = (name: typeof FUNCTIONS[number]) => FUNCTIONS.indexOf(name) + 1;

/** Expressions are lazy and bound to a relation scope, never SQL strings. */
export class Expr {
  constructor(readonly kind: Kind, readonly nullable: boolean,
    private readonly build: (scope: Scope) => S.IExpression) {}
  /** Internal lowering boundary. Applications use Table.toSubstrait(). */
  resolve(scope: Scope) { return this.build(scope); }
  private call(name: typeof FUNCTIONS[number], args: Expr[], kind: Kind, nullable: boolean) {
    return new Expr(kind, nullable, scope => ({ scalarFunction: {
      functionReference: anchor(name), arguments: args.map(a => ({ value: a.resolve(scope) })), outputType: type(kind, nullable),
    } }));
  }
  eq(value: Expr | string | number | boolean) {
    const other = asExpr(value, this.kind);
    if (this.kind !== other.kind) throw new Error('Equality requires matching types');
    return this.call('equal', [this, other], 'bool', this.nullable || other.nullable);
  }
  lower() {
    if (this.kind !== 'string') throw new Error('lower requires string');
    return this.call('lower', [this], 'string', this.nullable);
  }
  isNull() { return this.call('is_null', [this], 'bool', false); }
  isNotNull() { return this.call('is_not_null', [this], 'bool', false); }
  and(other: Expr) {
    if (this.kind !== 'bool' || other.kind !== 'bool') throw new Error('and requires bool');
    return this.call('and', [this, other], 'bool', this.nullable || other.nullable);
  }
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
  mul(value: Expr | number) { return this.arithmetic('multiply', value); }
  sub(value: Expr | number) { return this.arithmetic('subtract', value); }
  div(value: Expr | number) { return this.arithmetic('divide', value); }
  sum() { numeric(this); return new Measure('sum', [this], this.kind === 'decimal' ? 'decimal' : 'fp64', true); }
  avg() { numeric(this); return new Measure('avg', [this], this.kind === 'decimal' ? 'decimal' : 'fp64', true); }
  count() { return new Measure('count', [this], 'i64', false); }
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
export function literal(value: string | number | boolean): Expr {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Finite literal required');
  const kind = typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool' : 'fp64';
  return new Expr(kind, false, () => ({ literal: { [kind === 'bool' ? 'boolean' : kind]: value } }));
}
export function integer(value: number): Expr {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('i32 literal out of range');
  return new Expr('i32', false, () => ({ literal: { i32: value } }));
}
function asExpr(value: Expr | string | number | boolean, hint: Kind): Expr {
  if (value instanceof Expr) return value;
  return typeof value === 'number' && (hint === 'i32' || hint === 'decimal') ? integer(value) : literal(value);
}
export function caseWhen(condition: Expr, yes: Expr, no: Expr): Expr {
  if (condition.kind !== 'bool' || yes.kind !== no.kind) throw new Error('Invalid CASE types');
  return new Expr(yes.kind, yes.nullable || no.nullable, scope => ({ ifThen: {
    ifs: [{ if: condition.resolve(scope), then: yes.resolve(scope) }], else: no.resolve(scope),
  } }));
}
export class Measure {
  constructor(readonly name: 'sum' | 'avg' | 'count' | 'percentile_cont', readonly args: readonly Expr[], readonly kind: Kind, readonly nullable: boolean) {}
}
export const count = () => literal(1).count();

/** Callback-local column scope. A captured column cannot be reused on another relation. */
export class Columns {
  constructor(private readonly fields: readonly Field[], private readonly id: symbol) {}
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
export class Table {
  private readonly id = Symbol('relation');
  constructor(private readonly relation: S.IRel, private readonly fields: readonly Field[], private readonly source: symbol) {}
  private columns() { return new Columns(this.fields, this.id); }
  private scope() { return new Map([[this.id, 0]]); }
  select(build: (t: Columns) => Record<string, Expr>): Table {
    const entries = Object.entries(build(this.columns())); names(entries.map(([n]) => n));
    return new Table({ project: { input: this.relation, expressions: entries.map(([, e]) => e.resolve(this.scope())),
      common: { emit: { outputMapping: entries.map((_, i) => this.fields.length + i) } } } },
    entries.map(([name, e]) => ({ name, type: e.kind, nullable: e.nullable })), this.source);
  }
  filter(build: (t: Columns) => Expr): Table {
    const expr = build(this.columns());
    if (expr.kind !== 'bool') throw new Error('Filter requires bool');
    return new Table({ filter: { input: this.relation, condition: expr.resolve(this.scope()) } }, this.fields, this.source);
  }
  groupBy(...keys: string[]) {
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate grouping columns');
    keys.forEach(k => this.columns().col(k));
    return { aggregate: (build: (t: Columns) => Record<string, Measure>) => this.aggregate(build, keys) };
  }
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
    const rightOutput = new Columns(right.fields.map(f => ({ ...f, nullable: f.nullable || options.how === 'left' })), rightId);
    const entries = Object.entries(options.select(left, rightOutput)); names(entries.map(([n]) => n));
    const joined: S.IRel = { join: { left: this.relation, right: right.relation, expression: condition.resolve(scope),
      type: options.how === 'left' ? s.JoinRel.JoinType.JOIN_TYPE_LEFT : s.JoinRel.JoinType.JOIN_TYPE_INNER } };
    return new Table({ project: { input: joined, expressions: entries.map(([, e]) => e.resolve(scope)),
      common: { emit: { outputMapping: entries.map((_, i) => this.fields.length + right.fields.length + i) } } } },
    entries.map(([name, e]) => ({ name, type: e.kind, nullable: e.nullable })), this.source);
  }
  orderBy(...sorts: { column: string; direction?: 'asc' | 'desc'; nulls?: 'first' | 'last' }[]): Table {
    if (!sorts.length) throw new Error('At least one sort required');
    return new Table({ sort: { input: this.relation, sorts: sorts.map(sort => {
      const direction = sort.direction ?? 'asc', nulls = sort.nulls ?? 'last';
      if (!['asc', 'desc'].includes(direction) || !['first', 'last'].includes(nulls)) throw new Error('Invalid sort');
      const key = `SORT_DIRECTION_${direction.toUpperCase()}_NULLS_${nulls.toUpperCase()}` as keyof typeof s.SortField.SortDirection;
      return { expr: this.columns().col(sort.column).resolve(this.scope()), direction: s.SortField.SortDirection[key] };
    }) } }, this.fields, this.source);
  }
  limit(count: number, offset = 0): Table {
    if (![count, offset].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Limit and offset must be nonnegative safe integers');
    return new Table({ fetch: { input: this.relation, count, offset } }, this.fields, this.source);
  }
  toSubstrait() {
    return toPlanJson({ version: { majorNumber: 0, minorNumber: 63, patchNumber: 0 },
      extensionUris: [{ extensionUriAnchor: 1, uri: FUNCTION_URI }],
      extensions: FUNCTIONS.map(name => ({ extensionFunction: { extensionUriReference: 1, functionAnchor: anchor(name), name } })),
      relations: [{ root: { input: this.relation, names: this.fields.map(f => f.name) } }],
    });
  }
}
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
