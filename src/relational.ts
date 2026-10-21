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
type Value = { expr: RawBuilder<unknown>; kind: Kind; nullable: boolean; computed?: boolean; sourceColumn?: string };
// SQL emission state, not another relational IR. Only simple row-level blocks
// may absorb another operation; aggregates remain a boundary for their parent.
type QueryBlock = { source: RawBuilder<unknown>; sourceFor?: (expressions: RawBuilder<unknown>[]) => RawBuilder<unknown>; values: Value[]; where?: RawBuilder<unknown>; groups?: Value[]; extendable: boolean; scan?: string; aggregateSafe?: boolean; fetch?: { count: number; offset: number; order: Relation['order'] } };
type Relation = { query: RawBuilder<unknown>; fields: Omit<Value, 'expr'>[]; order?: { index: number; direction: string }[]; block?: QueryBlock };

/**
 * Internal lowering entry: callers must pass a profile-validated plan via compilePlanSync.
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
  const bigquery = backend === 'bigquery';
  // Only explicit SQL casts establish physical type provenance. Logical kinds
  // alone do not justify removing a conversion (notably decimal precision).
  const sqlTypes = new WeakMap<RawBuilder<unknown>, 'float' | 'decimal'>();
  const castAs = (value: RawBuilder<unknown>, target: 'float' | 'decimal') => {
    if (sqlTypes.get(value) === target) return value;
    // GoogleSQL cannot CAST to parameterized DECIMAL(38,10). BIGNUMERIC
    // retains exact digits; explicitly round and reject values outside our domain.
    const rounded = bigquery && target === 'decimal' ? sql`round(cast(${value} as bignumeric), 10)` : undefined;
    const result = rounded ? sql`if(abs(${rounded}) >= bignumeric '10000000000000000000000000000', error('Golden decimal(38,10) overflow'), ${rounded})`
      : target === 'decimal' ? sql`cast(${value} as decimal(38, 10))`
      : bigquery ? sql`cast(${value} as float64)` : mysql ? sql`cast(${value} as double)` : sql`cast(${value} as double precision)`;
    sqlTypes.set(result, target);
    return result;
  };
  const float = (value: RawBuilder<unknown>) => castAs(value, 'float');
  const decimal = (value: RawBuilder<unknown>) => castAs(value, 'decimal');
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
  const fields = (relation: Relation, name: string): Value[] => relation.fields.map((field, i) => {
    const expr = col(name, i);
    const original = relation.block?.values[i]?.expr;
    const physical = original && sqlTypes.get(original);
    if (physical) sqlTypes.set(expr, physical);
    return { ...field, sourceColumn: undefined, computed: false, expr };
  });
  const select = (values: Value[]) => sql.join(values.map((value, i) => sql`${value.expr} as ${sql.id(`c${i}`)}`));
  const from = (relation: Relation, name: string, needed?: Set<number>) => {
    const block = relation.block;
    // Prune an intermediate row projection only. Never remove a global
    // aggregate and accidentally change its empty-input cardinality.
    if (block && !block.groups && !block.fetch && needed?.size && needed.size < block.values.length) {
      const projected = sql.join(block.values.flatMap((v, i) => needed.has(i) ? [sql`${v.expr} as ${sql.id(`c${i}`)}`] : []));
      return sql`(select ${projected}${clauses({ ...block, values: block.values.filter((_, i) => needed.has(i)) })}) as ${sql.id(name)}`;
    }
    return sql`(${relation.query}) as ${sql.id(name)}`;
  };
  const clauses = (block: QueryBlock) => {
    const expressions = [...block.values.map(v => v.expr), ...(block.groups ?? []).map(v => v.expr), ...(block.where ? [block.where] : [])];
    return sql` from ${block.sourceFor?.(expressions) ?? block.source}${block.where ? sql` where ${block.where}` : sql``}${block.groups?.length ? sql` group by ${sql.join(block.groups.map(g => g.expr))}` : sql``}`;
  };
  const fetchClause = (block: QueryBlock) => block.fetch ? sql` limit ${block.fetch.count} offset ${block.fetch.offset}` : sql``;
  const blockRelation = (block: QueryBlock, order?: Relation['order']): Relation => ({
    query: sql`select ${select(block.values)}${clauses(block)}${block.fetch ? ordering({ fields: block.values, order: block.fetch.order }, '', block.values) : sql``}${fetchClause(block)}`, fields: block.values, block, order,
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
        : kind === 'string' ? (bigquery ? sql`cast(${parameter} as string)` : mysql ? sql`cast(${parameter} as char)` : sql`cast(${parameter} as text)`)
        : kind === 'boolean' ? (bigquery ? sql`cast(${parameter} as bool)` : mysql ? sql`cast(${parameter} as unsigned)` : sql`cast(${parameter} as boolean)`)
        : (bigquery ? sql`cast(${parameter} as int64)` : mysql ? sql`cast(${parameter} as signed)` : sql`cast(${parameter} as integer)`);
      return { expr: typed, kind: (kind === 'boolean' ? 'bool' : kind) as Kind, nullable: false, computed: true };
    }
    if ('ifThen' in expr) {
      const otherwise = expression(expr.ifThen.else, input);
      const branches = expr.ifThen.ifs.map(branch => {
        const condition = expression(branch.if, input), result = expression(branch.then, input);
        if (condition.kind !== 'bool' || result.kind !== otherwise.kind) throw invalid('Invalid CASE types');
        return { condition, result };
      });
      return { kind: otherwise.kind, computed: true, nullable: otherwise.nullable || branches.some(b => b.result.nullable),
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
    return declared(fn.outputType, { ...value, computed: true });
  }
  function emit(values: Value[], common?: { direct: object } | { emit: { outputMapping: number[] } }) {
    return common && 'emit' in common ? common.emit.outputMapping.map(i => {
      if (!values[i]) throw invalid(`Emit index ${i} out of range`);
      return values[i];
    }) : values;
  }
  function ordering(relation: Pick<Relation, 'fields' | 'order'>, name: string, values?: Value[]) {
    if (!relation.order?.length) return sql``;
    return sql` order by ${sql.join(relation.order.flatMap(sort => {
      const value = values ? values[sort.index].expr : col(name, sort.index), rank = sort.direction.endsWith('NULLS_FIRST') ? 0 : 1;
      const nullable = (values ?? relation.fields)[sort.index].nullable;
      return [...(nullable ? [sql`case when ${value} is null then ${sql.lit(rank)} else ${sql.lit(1-rank)} end asc`] : []),
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
        const value: Value = { expr: sql.ref(`${table}.${column.name}`), kind: column.type, nullable: column.nullable, sourceColumn: column.name };
        const checked = declared(type, value);
        // fp64 catalog entries explicitly expose approximate analytical values.
        return { ...checked, expr: column.type === 'fp64' ? float(value.expr) : column.type === 'decimal' ? decimal(value.expr) : value.expr };
      });
      const output = emit(values, read.common);
      return blockRelation({ source: sql.id(table), values: output, extendable: true, scan: table });
    }
    if ('join' in rel) {
      const left = visit(rel.join.left, depth+1), right = visit(rel.join.right, depth+1), rightName = alias();
      const joinInput = (relation: Relation, alias: string) => {
        const block = relation.block;
        if (block?.scan && !block.where && !block.fetch && !block.groups && block.values.every(v => v.sourceColumn)) {
          return { source: sql`${sql.id(block.scan)} as ${sql.id(alias)}`, values: block.values.map(v => {
            const ref = sql.ref(`${alias}.${v.sourceColumn}`);
            const physical = sqlTypes.get(v.expr);
            return { ...v, sourceColumn: undefined, expr: physical === 'float' ? float(ref) : physical === 'decimal' ? decimal(ref) : ref };
          }) };
        }
        return { source: from(relation, alias), values: fields(relation, alias) };
      };
      const l = joinInput(left, name), r = joinInput(right, rightName);
      const leftFields = l.values, rightFields = r.values;
      const condition = expression(rel.join.expression, [...leftFields, ...rightFields]);
      if (condition.kind !== 'bool') throw invalid('Join condition must be bool');
      const output = [...leftFields, ...rightFields.map(field => ({ ...field, nullable: field.nullable || rel.join.type === 'JOIN_TYPE_LEFT' }))];
      const join = rel.join.type === 'JOIN_TYPE_LEFT' ? sql`left join` : sql`inner join`;
      // Demand is collected from Kysely's structured reference nodes, never by
      // parsing SQL text or renumbering positional fields. Join predicates also
      // demand their columns, even when those columns are absent from output.
      const sourceFor = (expressions: RawBuilder<unknown>[]) => {
        const demanded = new Map([[name, new Set<number>()], [rightName, new Set<number>()]]);
        const collect = (node: unknown): void => {
          if (!node || typeof node !== 'object') return;
          const n = node as { kind?: string; table?: { table?: { identifier?: { name?: string } } }; column?: { column?: { name?: string } } };
          if (n.kind === 'ReferenceNode') {
            const set = demanded.get(n.table?.table?.identifier?.name ?? '');
            const column = n.column?.column?.name;
            if (set && column && /^c\d+$/.test(column)) set.add(Number(column.slice(1)));
          }
          for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') collect(value);
        };
        [...expressions, condition.expr].forEach(e => collect(e.toOperationNode()));
        const leftSource = left.block?.scan && !left.block.where && !left.block.fetch && !left.block.groups && left.block.values.every(v => v.sourceColumn) ? l.source : from(left, name, demanded.get(name));
        const rightSource = right.block?.scan && !right.block.where && !right.block.fetch && !right.block.groups && right.block.values.every(v => v.sourceColumn) ? r.source : from(right, rightName, demanded.get(rightName));
        return sql`${leftSource} ${join} ${rightSource} on ${condition.expr}`;
      };
      return blockRelation({ source: sql`${l.source} ${join} ${r.source} on ${condition.expr}`, sourceFor, values: output, extendable: true });
    }
    const node = 'project' in rel ? rel.project : 'filter' in rel ? rel.filter : 'aggregate' in rel ? rel.aggregate : 'sort' in rel ? rel.sort : 'window' in rel ? rel.window : rel.fetch;
    const child = visit(node.input, depth+1);
    const referenced = (e: Expression, into: Set<number>) => {
      if ('selection' in e) into.add(e.selection.directReference.structField.field);
      else if ('scalarFunction' in e) e.scalarFunction.arguments.forEach(a => referenced(a.value, into));
      else if ('ifThen' in e) { referenced(e.ifThen.else, into); e.ifThen.ifs.forEach(b => { referenced(b.if, into); referenced(b.then, into); }); }
    };
    let needed: Set<number> | undefined;
    if ('aggregate' in rel) {
      needed = new Set();
      rel.aggregate.groupings[0].groupingExpressions.forEach(e => referenced(e, needed!));
      rel.aggregate.measures.forEach(m => m.measure.arguments.forEach(a => referenced(a.value, needed!)));
    } else if ('project' in rel && rel.project.common && 'emit' in rel.project.common) {
      needed = new Set(child.order?.map(s => s.index));
      for (const i of rel.project.common.emit.outputMapping) {
        if (i < child.fields.length) needed.add(i);
        else { const e = rel.project.expressions[i - child.fields.length]; if (e) referenced(e, needed); }
      }
    }
    const childFrom = () => from(child, name, needed);
    // Percentile and incompatible SQL clauses retain derived-table references.
    const ordinaryAggregate = 'aggregate' in rel && !rel.aggregate.measures.some(m => functions.get(m.measure.functionReference) === 'percentile_cont');
    const canAbsorb = child.block && !child.block.fetch && ((child.block.extendable && ('filter' in rel || 'project' in rel || 'window' in rel || 'fetch' in rel || ordinaryAggregate)) || (child.block.aggregateSafe && ordinaryAggregate && rel.aggregate.groupings[0].groupingExpressions.every(e => 'selection' in e && !child.block!.values[e.selection.directReference.structField.field]?.computed)));
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
      if (bigquery && partitions.some(p => p.kind === 'fp64')) throw unsupported('BigQuery window partition keys cannot be FLOAT64');
      const sorts = rel.window.sorts.map(sort => {
        expression(sort.expr, input);
        return { index: sort.expr.selection.directReference.structField.field, direction: sort.direction };
      });
      const partition = partitions.length ? sql`partition by ${sql.join(partitions.map(p => p.expr))}` : sql``;
      const number: Value = { expr: sql`row_number() over (${partition}${ordering({ ...child, order: sorts }, name, block?.values)})`, kind: 'i64', nullable: false };
      const output = [...input, number];
      return blockRelation({ source: block?.source ?? childFrom(), sourceFor: block?.sourceFor, where: block?.where, values: output, extendable: false }, child.order);
    }
    if ('project' in rel) {
      const output = emit([...input, ...rel.project.expressions.map(e => expression(e, input))], rel.project.common);
      const order = child.order?.map(sort => {
        const position = output.findIndex(value => value === input[sort.index]);
        if (position < 0) throw unsupported('Project cannot discard a sort field in this profile');
        return { ...sort, index: position };
      });
      // Computed projections block filters; only total expressions may enter an aggregate.
      // Computed grouping keys still retain their own scope and parameter bindings.
      const total = (e: Expression): boolean => 'selection' in e || 'literal' in e || ('ifThen' in e
        ? total(e.ifThen.else) && e.ifThen.ifs.every(b => total(b.if) && total(b.then))
        : (['is_null', 'is_not_null', 'and', 'equal'].includes(functions.get(e.scalarFunction.functionReference) ?? '') || (functions.get(e.scalarFunction.functionReference) === 'coalesce' && kindOf(e.scalarFunction.outputType) !== 'decimal')) && e.scalarFunction.arguments.every(a => total(a.value)));
      return blockRelation({ source: block?.source ?? childFrom(), sourceFor: block?.sourceFor, where: block?.where,
        values: output, extendable: rel.project.expressions.every(e => 'selection' in e),
        scan: block?.scan, aggregateSafe: rel.project.expressions.every(total) }, order);
    }
    if ('filter' in rel) {
      const condition = expression(rel.filter.condition, input);
      if (condition.kind !== 'bool') throw invalid('Filter condition must be bool');
      return blockRelation({ source: block?.source ?? childFrom(), sourceFor: block?.sourceFor, values: input,
        where: block?.where ? sql`(${block.where}) and (${condition.expr})` : condition.expr, extendable: true }, child.order);
    }
    if ('sort' in rel) {
      const order = rel.sort.sorts.map(sort => {
        expression(sort.expr, input);
        return { index: sort.expr.selection.directReference.structField.field, direction: sort.direction };
      });
      // A new sort after pagination changes output order, not the selected rows.
      return child.block?.fetch ? { query: child.query, fields: child.fields, order } : { ...child, order };
    }
    if ('fetch' in rel) {
      if (block) return blockRelation({ ...block, extendable: false, fetch: { count: Number(rel.fetch.count), offset: Number(rel.fetch.offset ?? '0'), order: child.order } }, child.order);
      return { query: sql`select ${select(input)} from ${from(child, name)}${ordering(child, name)} limit ${Number(rel.fetch.count)} offset ${Number(rel.fetch.offset ?? '0')}`, fields: input, order: child.order };
    }
    if (!('aggregate' in rel)) throw unsupported('Unsupported relation');
    const groups = rel.aggregate.groupings[0].groupingExpressions.map(e => expression(e, input));
    const measures = rel.aggregate.measures.map(({ measure }) => {
      const name = functions.get(measure.functionReference);
      if (!name) throw invalid(`Unresolved function reference: ${measure.functionReference}`);
      return { measure, name, args: measure.arguments.map(arg => expression(arg.value, input)) };
    });
    if (measures.some(m => m.name === 'percentile_cont')) {
      if (bigquery && groups.some(g => g.kind === 'fp64')) throw unsupported('BigQuery percentile partition keys cannot be FLOAT64');
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
      const windowCount = sql`count(${value}) over (${partition})`;
      const rankPosition = sql`(1 + ${cast(sql.val(bigquery && exact ? String(p) : p))} * (${windowCount} - 1))`;
      const ranked = sql`select ${selectedGroups}${value} as v, row_number() over (${partition} order by case when ${value} is null then 1 else 0 end, ${value}) as rn, ${windowCount} as n, ${rankPosition} as pos from ${childFrom()}`;
      const r = alias(), v = sql.ref(`${r}.v`), n = sql.ref(`${r}.n`), rn = sql.ref(`${r}.rn`);
      const position = sql.ref(`${r}.pos`);
      const lo = sql`max(case when ${rn} = floor(${position}) and ${n} > 0 then ${v} end)`;
      const hi = sql`max(case when ${rn} = ceil(${position}) and ${n} > 0 then ${v} end)`;
      const fraction = sql`max(${position} - floor(${position}))`;
      const result: Value = { expr: cast(sql`(${lo} + (${hi} - ${lo}) * ${fraction})`), kind: resultKind, nullable: true };
      const output = [...groups.map((g,i) => ({ ...g, expr: col(r,i) })), result];
      return blockRelation({ source: sql`(${ranked}) as ${sql.id(r)}`, values: output,
        groups: groups.map((g,i) => ({ ...g, expr: col(r,i) })), extendable: false });
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
    return blockRelation({ source: block?.source ?? childFrom(), sourceFor: block?.sourceFor, where: block?.where,
      values: output, groups, extendable: false });
  }
  const root = plan.relations[0].root, relation = visit(root.input), name = alias();
  if (root.names.length !== relation.fields.length || new Set(root.names).size !== root.names.length) throw invalid('Invalid root names');
  const output = (relation.block?.values ?? fields(relation, name)).map((value, i) => {
    const expr = value.kind === 'fp64' ? float(value.expr) : value.kind === 'decimal' ? (bigquery ? sql`format('%.10f', ${decimal(value.expr)})` : decimal(value.expr)) : value.kind === 'i64' ? (bigquery ? sql`cast(${value.expr} as string)` : mysql ? sql`cast(${value.expr} as char)` : sql`cast(${value.expr} as text)`) : value.expr;
    return sql`${expr} as ${sql.id(root.names[i])}`;
  });
  return sql<Record<string, unknown>>`select ${sql.join(output)}${relation.block ? clauses(relation.block) : sql` from ${from(relation, name)}`}${ordering(relation, name, relation.block?.values)}${relation.block ? fetchClause(relation.block) : sql``}`.compile(db);
}
