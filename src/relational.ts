import { CompileQueryError } from './errors.js';
import { compilerBackend, requireCapability } from './capabilities.js';
import { Kysely, MysqlAdapter, sql, type RawBuilder } from 'kysely';
import type { Catalog, Database } from './compiler.js';
import type { Expression, Rel, SupportedPlanJson } from './plan.js';
import { DuckDBAdapter } from './duckdb.js';
import { duckdbDecimalDivide } from './duckdb-decimal.js';

import { FUNCTION_URI, FUNCTIONS } from './functions.js';
export { FUNCTION_URI, FUNCTIONS } from './functions.js';
type Kind = Catalog[string][number]['type'];
export type LoweringDecision = { relationId: string; operation: string; decision: string; reason: string };
type Value = { expr: RawBuilder<unknown>; kind: Kind; nullable: boolean };
// SQL emission state, not another relational IR. Only simple row-level blocks
// may absorb another operation; aggregates remain a boundary for their parent.
type QueryBlock = { source: RawBuilder<unknown>; values: Value[]; where?: RawBuilder<unknown>; groups?: Value[]; extendable: boolean };
type Relation = { query: RawBuilder<unknown>; fields: Omit<Value, 'expr'>[]; order?: { index: number; direction: string }[]; block?: QueryBlock };

/**
 * Internal lowering entry: callers must pass a profile-validated plan via compilePlan.
 * SupportedPlanJson is a TypeScript shape, not proof of runtime validation.
 * In particular, planSchema enforces window arity/output/phase/frame restrictions.
 * Combine compatible SQL clauses, retaining aggregate/window/fetch boundaries.
 */
export function compileAnalytics(db: Kysely<Database>, plan: SupportedPlanJson, catalog: Catalog, trace?: LoweringDecision[]) {
  const backend = compilerBackend(db);
  const invalid = (message: string) => new CompileQueryError(message, { code: 'INVALID_QUERY', stage: 'compile', backend });
  const unsupported = (message: string) => new CompileQueryError(message, { code: 'UNSUPPORTED_CAPABILITY', stage: 'compile', backend });
  const mysql = db.getExecutor().adapter instanceof MysqlAdapter;
  const duckdb = db.getExecutor().adapter instanceof DuckDBAdapter;
  const float = (value: RawBuilder<unknown>) => mysql ? sql`cast(${value} as double)` : sql`cast(${value} as double precision)`;
  const decimal = (value: RawBuilder<unknown>) => sql`cast(${value} as decimal(38, 10))`;
  const functions = new Map<number, string>();
  const uris = new Map<number, string>();
  for (const uri of plan.extensionUris ?? []) {
    if (uris.has(uri.extensionUriAnchor)) throw invalid('Unsupported or duplicate function URI');
    if (uri.uri !== FUNCTION_URI) throw unsupported('Unsupported or duplicate function URI');
    uris.set(uri.extensionUriAnchor, uri.uri);
  }
  for (const { extensionFunction: fn } of plan.extensions ?? []) {
    if (!uris.has(fn.extensionUriReference) || functions.has(fn.functionAnchor))
      throw invalid('Unsupported, duplicate, or unresolved function declaration');
    if (!(FUNCTIONS as readonly string[]).includes(fn.name))
      throw unsupported('Unsupported, duplicate, or unresolved function declaration');
    functions.set(fn.functionAnchor, fn.name);
  }
  let nextAlias = 0;
  const alias = () => `r${nextAlias++}`;
  const col = (name: string, i: number) => sql.ref(`${name}.c${i}`);
  const fields = (relation: Relation, name: string): Value[] => relation.fields.map((field, i) => ({ ...field, expr: col(name, i) }));
  const select = (values: Value[]) => sql.join(values.map((value, i) => sql`${value.expr} as ${sql.id(`c${i}`)}`));
  const from = (relation: Relation, name: string) => sql`(${relation.query}) as ${sql.id(name)}`;
  const clauses = (block: QueryBlock) => sql` from ${block.source}${block.where ? sql` where ${block.where}` : sql``}${block.groups?.length ? sql` group by ${sql.join(block.groups.map(g => g.expr))}` : sql``}`;
  const blockRelation = (block: QueryBlock, order?: Relation['order']): Relation => ({
    query: sql`select ${select(block.values)}${clauses(block)}`, fields: block.values, block, order,
  });
  const kindOf = (type: object) => Object.keys(type)[0] as Kind;
  function declared(type: object, value: Value) {
    const kind = kindOf(type);
    const nullable = (type as Record<string, { nullability: string }>)[kind].nullability === 'NULLABILITY_NULLABLE';
    if (kind !== value.kind || (!nullable && value.nullable)) throw invalid('Function output type/nullability mismatch');
    return { ...value, nullable };
  }
  function numeric(values: Value[]) {
    if (values.some(value => !['i32', 'i64', 'fp64', 'decimal'].includes(value.kind))) throw invalid('Numeric argument required');
  }
  function expression(expr: Expression, input: Value[]): Value {
    if ('selection' in expr) {
      const index = expr.selection.directReference.structField.field;
      if (!input[index]) throw invalid(`Field index ${index} out of range`);
      return input[index];
    }
    if ('literal' in expr) {
      const [kind, value] = Object.entries(expr.literal)[0];
      const parameter = sql.val(value);
      const typed = kind === 'fp64' ? float(parameter)
        : kind === 'string' ? (mysql ? sql`cast(${parameter} as char)` : sql`cast(${parameter} as text)`)
        : kind === 'boolean' ? (mysql ? sql`cast(${parameter} as unsigned)` : sql`cast(${parameter} as boolean)`)
        : (mysql ? sql`cast(${parameter} as signed)` : sql`cast(${parameter} as integer)`);
      return { expr: typed, kind: (kind === 'boolean' ? 'bool' : kind) as Kind, nullable: false };
    }
    if ('ifThen' in expr) {
      const otherwise = expression(expr.ifThen.else, input);
      const branches = expr.ifThen.ifs.map(branch => {
        const condition = expression(branch.if, input), result = expression(branch.then, input);
        if (condition.kind !== 'bool' || result.kind !== otherwise.kind) throw invalid('Invalid CASE types');
        return { condition, result };
      });
      return { kind: otherwise.kind, nullable: otherwise.nullable || branches.some(b => b.result.nullable),
        expr: sql`case ${sql.join(branches.map(b => sql`when ${b.condition.expr} then ${b.result.expr}`), sql` `)} else ${otherwise.expr} end` };
    }
    const fn = expr.scalarFunction;
    const name = functions.get(fn.functionReference);
    if (!name) throw invalid(`Unresolved function reference: ${fn.functionReference}`);
    const args = fn.arguments.map(arg => expression(arg.value, input));
    const arity = name === 'lower' || name === 'is_null' || name === 'is_not_null' ? 1 : 2;
    if (args.length !== arity) throw invalid(`Invalid scalar function arity: ${name}`);
    const [a, b] = args;
    const nullable = args.some(arg => arg.nullable);
    let value: Value;
    switch (name) {
      case 'lower':
        if (a.kind !== 'string') throw invalid('lower requires string');
        value = { expr: sql`lower(${a.expr})`, kind: 'string', nullable }; break;
      case 'equal':
        if (a.kind !== b.kind) throw invalid('equal requires matching types');
        value = { expr: a.kind === 'string' && mysql ? sql`(cast(${a.expr} as binary) = cast(${b.expr} as binary))` : sql`(${a.expr} = ${b.expr})`, kind: 'bool', nullable }; break;
      case 'less_than_or_equal':
        numeric(args);
        if (a.kind !== b.kind && !args.every(arg => ['i32', 'i64'].includes(arg.kind))) throw invalid('Comparison requires matching numeric types or integer widths');
        value = { expr: sql`(${a.expr} <= ${b.expr})`, kind: 'bool', nullable }; break;
      case 'is_null': value = { expr: sql`(${a.expr} is null)`, kind: 'bool', nullable: false }; break;
      case 'is_not_null': value = { expr: sql`(${a.expr} is not null)`, kind: 'bool', nullable: false }; break;
      case 'and':
        if (args.some(arg => arg.kind !== 'bool')) throw invalid('and requires bool');
        value = { expr: sql`(${a.expr} and ${b.expr})`, kind: 'bool', nullable }; break;
      case 'multiply': case 'subtract': case 'divide': {
        numeric(args);
        const exact = args.some(arg => arg.kind === 'decimal');
        if (exact && args.some(arg => arg.kind === 'fp64')) throw invalid('Cannot mix decimal and fp64 arithmetic');
        const cast = exact ? decimal : float;
        const left = cast(a.expr), right = cast(b.expr);
        const result = name === 'multiply' ? sql`(${left} * ${right})` : name === 'subtract' ? sql`(${left} - ${right})`
          : exact && duckdb ? duckdbDecimalDivide(left, right) : sql`(${left} / nullif(${right}, 0))`;
        value = { expr: cast(result), kind: exact ? 'decimal' : 'fp64', nullable: name === 'divide' || nullable }; break;
      }
      case 'coalesce':
        if (a.kind !== b.kind && !(a.kind === 'decimal' && b.kind === 'i32')) throw invalid('coalesce requires matching types (or decimal and integer fallback)');
        value = { expr: a.kind === 'decimal' ? decimal(sql`coalesce(${a.expr}, ${b.expr})`) : sql`coalesce(${a.expr}, ${b.expr})`, kind: a.kind, nullable: a.nullable && b.nullable }; break;
      default: throw invalid(`Unsupported scalar function: ${name}`);
    }
    return declared(fn.outputType, value);
  }
  function emit(values: Value[], common?: { direct: object } | { emit: { outputMapping: number[] } }) {
    return common && 'emit' in common ? common.emit.outputMapping.map(i => {
      if (!values[i]) throw invalid(`Emit index ${i} out of range`);
      return values[i];
    }) : values;
  }
  function ordering(relation: Relation, name: string, values?: Value[]) {
    if (!relation.order?.length) return sql``;
    return sql` order by ${sql.join(relation.order.flatMap(sort => {
      const value = values ? values[sort.index].expr : col(name, sort.index), rank = sort.direction.endsWith('NULLS_FIRST') ? 0 : 1;
      return [sql`case when ${value} is null then ${sql.lit(rank)} else ${sql.lit(1-rank)} end asc`,
        sort.direction.includes('_ASC_') ? sql`${value} asc` : sql`${value} desc`];
    }))}`;
  }
  function visit(rel: Rel, depth = 0): Relation {
    if (depth > 32) throw invalid('Plan depth exceeds 32');
    const name = alias();
    if ('read' in rel) {
      const read = rel.read, table = read.namedTable.names[0];
      const schema = Object.hasOwn(catalog, table) ? catalog[table] : undefined;
      if (!schema || schema.length !== read.baseSchema.names.length || schema.length !== read.baseSchema.struct.types.length) throw invalid('Unknown table or read schema width mismatch');
      const values = schema.map((column, i): Value => {
        const type = read.baseSchema.struct.types[i];
        if (read.baseSchema.names[i] !== column.name || kindOf(type) !== column.type) throw invalid('Read schema mismatch');
        const value: Value = { expr: sql.ref(`${table}.${column.name}`), kind: column.type, nullable: column.nullable };
        const checked = declared(type, value);
        // fp64 catalog entries explicitly expose approximate analytical values.
        return { ...checked, expr: column.type === 'fp64' ? float(value.expr) : column.type === 'decimal' ? decimal(value.expr) : value.expr };
      });
      const output = emit(values, read.common);
      return blockRelation({ source: sql.id(table), values: output, extendable: true });
    }
    if ('join' in rel) {
      const left = visit(rel.join.left, depth+1), right = visit(rel.join.right, depth+1), rightName = alias();
      const leftFields = fields(left, name), rightFields = fields(right, rightName);
      const condition = expression(rel.join.expression, [...leftFields, ...rightFields]);
      if (condition.kind !== 'bool') throw invalid('Join condition must be bool');
      const output = [...leftFields, ...rightFields.map(field => ({ ...field, nullable: field.nullable || rel.join.type === 'JOIN_TYPE_LEFT' }))];
      const join = rel.join.type === 'JOIN_TYPE_LEFT' ? sql`left join` : sql`inner join`;
      return { query: sql`select ${select(output)} from ${from(left, name)} ${join} ${from(right, rightName)} on ${condition.expr}`, fields: output };
    }
    const node = 'project' in rel ? rel.project : 'filter' in rel ? rel.filter : 'aggregate' in rel ? rel.aggregate : 'sort' in rel ? rel.sort : 'window' in rel ? rel.window : rel.fetch;
    const child = visit(node.input, depth+1);
    // Fetch/percentile lowering still uses derived-table field references.
    const canAbsorb = child.block?.extendable && ('filter' in rel || 'project' in rel || 'window' in rel ||
      ('aggregate' in rel && !rel.aggregate.measures.some(m => functions.get(m.measure.functionReference) === 'percentile_cont')));
    const block = canAbsorb ? child.block! : undefined;
    const input = block ? block.values : fields(child, name);
    const operation = 'project' in rel ? 'project' : 'filter' in rel ? 'filter' : 'aggregate' in rel ? 'aggregate' : 'window' in rel ? 'window' : 'fetch' in rel ? 'fetch' : 'sort';
    const childKind = Object.keys(node.input).find(k => ['read', 'filter', 'project', 'aggregate', 'window', 'fetch', 'sort', 'join'].includes(k));
    trace?.push({ relationId: name, operation, decision: block || operation === 'sort' ? 'merged' : 'boundary',
      reason: operation === 'sort' ? 'Track output ordering without a new query block' : block ? 'Compatible row-level input block' : `Preserve ${childKind} input scope or specialized lowering boundary` });
    if ('window' in rel) {
      const fn = rel.window.windowFunctions[0];
      if (!functions.has(fn.functionReference)) throw invalid(`Unresolved function reference: ${fn.functionReference}`);
      if (functions.get(fn.functionReference) !== 'row_number') throw unsupported('Only row_number window functions are supported');
      const partitions = rel.window.partitionExpressions.map(e => expression(e, input));
      const sorts = rel.window.sorts.map(sort => {
        expression(sort.expr, input);
        return { index: sort.expr.selection.directReference.structField.field, direction: sort.direction };
      });
      const partition = partitions.length ? sql`partition by ${sql.join(partitions.map(p => p.expr))}` : sql``;
      const number: Value = { expr: sql`row_number() over (${partition}${ordering({ ...child, order: sorts }, name, block?.values)})`, kind: 'i64', nullable: false };
      const output = [...input, number];
      return blockRelation({ source: block?.source ?? from(child, name), where: block?.where, values: output, extendable: false }, child.order);
    }
    if ('project' in rel) {
      const output = emit([...input, ...rel.project.expressions.map(e => expression(e, input))], rel.project.common);
      const order = child.order?.map(sort => {
        const position = output.findIndex(value => value === input[sort.index]);
        if (position < 0) throw unsupported('Project cannot discard a sort field in this profile');
        return { ...sort, index: position };
      });
      // Computed projections are boundaries: avoid duplicating expressions or
      // moving their evaluation through a later filter/aggregate.
      return blockRelation({ source: block?.source ?? from(child, name), where: block?.where,
        values: output, extendable: rel.project.expressions.every(e => 'selection' in e) }, order);
    }
    if ('filter' in rel) {
      const condition = expression(rel.filter.condition, input);
      if (condition.kind !== 'bool') throw invalid('Filter condition must be bool');
      return blockRelation({ source: block?.source ?? from(child, name), values: input,
        where: block?.where ? sql`(${block.where}) and (${condition.expr})` : condition.expr, extendable: true }, child.order);
    }
    if ('sort' in rel) {
      const order = rel.sort.sorts.map(sort => {
        expression(sort.expr, input);
        return { index: sort.expr.selection.directReference.structField.field, direction: sort.direction };
      });
      return { ...child, order };
    }
    if ('fetch' in rel) return { query: sql`select ${select(input)} from ${from(child, name)}${ordering(child, name)} limit ${Number(rel.fetch.count)} offset ${Number(rel.fetch.offset ?? '0')}`, fields: input, order: child.order };
    if (!('aggregate' in rel)) throw unsupported('Unsupported relation');
    const groups = rel.aggregate.groupings[0].groupingExpressions.map(e => expression(e, input));
    const measures = rel.aggregate.measures.map(({ measure }) => {
      const name = functions.get(measure.functionReference);
      if (!name) throw invalid(`Unresolved function reference: ${measure.functionReference}`);
      return { measure, name, args: measure.arguments.map(arg => expression(arg.value, input)) };
    });
    if (measures.some(m => m.name === 'percentile_cont')) {
      if (measures.length !== 1) throw unsupported('Percentile must be the sole measure in its aggregate');
      const { measure, args } = measures[0];
      if (args.length !== 2 || !('literal' in measure.arguments[1].value) || !('fp64' in measure.arguments[1].value.literal)) throw invalid('Percentile requires value and literal fp64 fraction');
      numeric(args);
      const p = measure.arguments[1].value.literal.fp64;
      if (p < 0 || p > 1) throw invalid('Percentile fraction must be in [0, 1]');
      const exact = args[0].kind === 'decimal', resultKind = exact ? 'decimal' : 'fp64';
      if (exact && Number(p.toFixed(10)) !== p) throw unsupported('Decimal percentile supports fractions with at most 10 decimal places');
      declared(measure.outputType, { expr: sql`null`, kind: resultKind, nullable: true });
      // A portable exact continuous percentile over ordered non-null values.
      // Partition count counts only non-null values; nulls sort last but remain to retain all-null groups.
      const partition = groups.length ? sql`partition by ${sql.join(groups.map(g => g.expr))}` : sql``;
      const cast = exact ? decimal : float;
      const value = cast(args[0].expr);
      const selectedGroups = groups.length ? sql`${select(groups)}, ` : sql``;
      const ranked = sql`select ${selectedGroups}${value} as v, row_number() over (${partition} order by case when ${value} is null then 1 else 0 end, ${value}) as rn, count(${value}) over (${partition}) as n from ${from(child, name)}`;
      const r = alias(), v = sql.ref(`${r}.v`), n = sql.ref(`${r}.n`), rn = sql.ref(`${r}.rn`);
      const position = sql`(1 + ${cast(sql.val(p))} * (${n} - 1))`;
      const lo = sql`max(case when ${rn} = floor(${position}) and ${n} > 0 then ${v} end)`;
      const hi = sql`max(case when ${rn} = ceil(${position}) and ${n} > 0 then ${v} end)`;
      const fraction = sql`max(${position} - floor(${position}))`;
      const result: Value = { expr: cast(sql`(${lo} + (${hi} - ${lo}) * ${fraction})`), kind: resultKind, nullable: true };
      const output = [...groups.map((g,i) => ({ ...g, expr: col(r,i) })), result];
      return { query: sql`select ${select(output)} from (${ranked}) as ${sql.id(r)}${groups.length ? sql` group by ${sql.join(groups.map((_,i) => col(r,i)))}` : sql``}`, fields: output };
    }
    const aggregateValues = measures.map(({ measure, name, args }): Value => {
      if (args.length !== 1) throw invalid('Aggregate requires one argument');
      let value: Value;
      if (name === 'count') {
        // The validated literal profile contains only non-null constants.
        // Do not drop arbitrary expressions: they may be null or raise errors.
        const rowCount = 'literal' in measure.arguments[0].value;
        value = { expr: rowCount ? sql`count(*)` : sql`count(${args[0].expr})`, kind: 'i64', nullable: false };
      }
      else if (name === 'sum' || name === 'avg') {
        numeric(args);
        if (backend && name === 'avg' && args[0].kind === 'decimal') requireCapability(backend, 'exactDecimalAverage');
        const exact = args[0].kind === 'decimal', cast = exact ? decimal : float;
        value = { expr: cast(name === 'sum' ? sql`sum(${cast(args[0].expr)})` : sql`avg(${cast(args[0].expr)})`), kind: exact ? 'decimal' : 'fp64', nullable: true };
      } else throw invalid(`Unsupported aggregate: ${name}`);
      return declared(measure.outputType, value);
    });
    const output = [...groups, ...aggregateValues];
    return blockRelation({ source: block?.source ?? from(child, name), where: block?.where,
      values: output, groups, extendable: false });
  }
  const root = plan.relations[0].root, relation = visit(root.input), name = alias();
  if (root.names.length !== relation.fields.length || new Set(root.names).size !== root.names.length) throw invalid('Invalid root names');
  const output = (relation.block?.values ?? fields(relation, name)).map((value, i) => {
    const expr = value.kind === 'fp64' ? float(value.expr) : value.kind === 'decimal' ? decimal(value.expr) : value.kind === 'i64' ? (mysql ? sql`cast(${value.expr} as char)` : sql`cast(${value.expr} as text)`) : value.expr;
    return sql`${expr} as ${sql.id(root.names[i])}`;
  });
  return sql<Record<string, unknown>>`select ${sql.join(output)}${relation.block ? clauses(relation.block) : sql` from ${from(relation, name)}`}${ordering(relation, name, relation.block?.values)}`.compile(db);
}
