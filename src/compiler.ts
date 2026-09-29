import { Kysely, sql, type SelectQueryBuilder } from 'kysely';
import { fromPlanJson, toPlanJson, type Field, type Rel } from './plan.js';
import { compileAnalytics } from './relational.js';

/** Trusted logical table schemas, with ordered fields; decimal means precision 38 and scale 10. */
export type Catalog = Record<string, readonly { name: string; type: 'i32' | 'date' | 'string' | 'fp64' | 'i64' | 'bool' | 'decimal'; nullable: boolean }[]>;
// Dynamic database shape is confined to the compiler; the external boundary is validated.
export type Database = Record<string, Record<string, unknown>>;
type Query = SelectQueryBuilder<Database, string, {}>;
/**
 * Validate a supported JSON plan and compile it for db without executing a database query.
 * @returns A Kysely compiled query containing SQL and bound parameters.
 * @remarks Compile separately for each backend; catalog validation does not inspect live metadata.
 */
export function compilePlan(db: Kysely<Database>, input: unknown, catalog: Catalog) {
  const plan = toPlanJson(fromPlanJson(input));
  if (plan.extensions?.length || plan.extensionUris?.length) return compileAnalytics(db, plan, catalog);
  const root = plan.relations[0].root;
  let query: Query;
  let columns: string[] = [];
  let sorted = false;
  let fetched = false;
  function resolve(expr: Field) {
    const position = expr.selection.directReference.structField.field;
    if (position >= columns.length) throw new Error(`Field index ${position} out of range`);
    return columns[position];
  }
  function emit(mapping?: number[]) {
    if (mapping) columns = mapping.map(position => {
      if (position >= columns.length) throw new Error(`Emit index ${position} out of range`);
      return columns[position];
    });
  }
  function visit(rel: Rel, depth = 0): void {
    if (depth > 32) throw new Error('Plan depth exceeds 32');
    if ('read' in rel) {
      const read = rel.read;
      const table = read.namedTable.names[0];
      const expected = Object.hasOwn(catalog, table) ? catalog[table] : undefined;
      if (!expected) throw new Error(`Unknown table: ${table}`);
      const schema = read.baseSchema;
      if (schema.names.length !== expected.length || schema.struct.types.length !== expected.length)
        throw new Error('Read schema width mismatch');
      expected.forEach((column, i) => {
        const declared = schema.struct.types[i];
        const value = (declared as Record<string, { nullability: string }>)[column.type];
        if (schema.names[i] !== column.name || !value || value.nullability !== (column.nullable ? 'NULLABILITY_NULLABLE' : 'NULLABILITY_REQUIRED'))
          throw new Error(`Read schema mismatch at field ${i}`);
      });
      columns = expected.map(column => `${table}.${column.name}`);
      query = db.selectFrom(table);
      if (read.common && 'emit' in read.common) emit(read.common.emit.outputMapping);
    } else if ('project' in rel) {
      visit(rel.project.input, depth + 1);
      // Substrait project APPENDS expressions to its input before applying emit.
      columns = [...columns, ...rel.project.expressions.map(expr => {
        if (!('selection' in expr)) throw new Error('Analytical expressions require the function profile');
        return resolve(expr);
      })];
      if (rel.project.common && 'emit' in rel.project.common) emit(rel.project.common.emit.outputMapping);
    } else if ('sort' in rel) {
      visit(rel.sort.input, depth + 1);
      if (fetched || sorted) throw new Error('This profile requires a single sort before fetch');
      sorted = true;
      for (const sort of rel.sort.sorts) {
        const column = sql.ref(resolve(sort.expr));
        // CASE gives identical explicit null ordering on both dialects.
        const nullRank = sort.direction.endsWith('NULLS_FIRST') ? 0 : 1;
        query = query.orderBy(sql`case when ${column} is null then ${sql.lit(nullRank)} else ${sql.lit(1 - nullRank)} end`, 'asc');
        query = query.orderBy(column, sort.direction.includes('_ASC_') ? 'asc' : 'desc');
      }
    } else if ('fetch' in rel) {
      visit(rel.fetch.input, depth + 1);
      if (fetched) throw new Error('Nested fetch is not supported in this profile');
      fetched = true;
      query = query.limit(Number(rel.fetch.count)).offset(Number(rel.fetch.offset ?? '0'));
    } else {
      throw new Error('Analytical relations require the function profile');
    }
  }
  visit(root.input);
  if (root.names.length !== columns.length) throw new Error('Root names must match output width');
  if (new Set(root.names).size !== root.names.length) throw new Error('Duplicate output names are not supported');
  return query!.select(columns.map((column, i) => sql.ref(column).as(root.names[i]))).compile();
}
