import { sql } from 'kysely';
import { connect, type Backend } from './backend.js';
import type { Catalog } from './compiler.js';

export type MetadataErrorCode = 'INVALID_METADATA' | 'UNSUPPORTED_TYPE' | 'METADATA_FAILED';
export class MetadataError extends Error {
  readonly stage = 'metadata';
  constructor(readonly code: MetadataErrorCode, readonly backend: Backend, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'MetadataError';
  }
}
export interface MetadataOptions {
  /** Explicit schema/database, e.g. public, northwind, or main. */
  schema: string;
  /** One to 100 distinct table names. Discovery never scans all application tables. */
  tables: readonly string[];
  duckdbPath?: string;
}
export interface PhysicalColumn {
  name: string;
  ordinal: number;
  dataType: string;
  nativeType: string;
  nullable: boolean;
  precision: number | null;
  scale: number | null;
  unsigned: boolean;
  domainName: string | null;
}
export interface DiscoveredMetadata {
  backend: Backend;
  schema: string;
  defaultSchema: string;
  tables: { name: string; columns: PhysicalColumn[] }[];
}
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
function scope(backend: Backend, options: MetadataOptions) {
  if (!['postgres', 'mysql', 'duckdb'].includes(backend) || !options || typeof options.schema !== 'string' || !identifier.test(options.schema)
    || !Array.isArray(options.tables) || options.tables.length < 1 || options.tables.length > 100
    || options.tables.some(t => typeof t !== 'string' || !identifier.test(t))
    || new Set(options.tables).size !== options.tables.length) {
    throw new MetadataError('INVALID_METADATA', backend, 'Specify one simple schema name and 1 to 100 distinct simple table names');
  }
}
interface ColumnRow {
  table_name: string; column_name: string; ordinal_position: number | string;
  data_type: string; native_type: string; is_nullable: string; domain_name: string | null;
  numeric_precision: number | string | null; numeric_scale: number | string | null;
}
/** Read scoped physical metadata. Unsupported types remain visible; no catalog coercion occurs here. */
export async function discoverMetadata(backend: Backend, options: MetadataOptions): Promise<DiscoveredMetadata> {
  scope(backend, options);
  const db = connect(backend, options);
  try {
    // Kysely's generic introspector has no table scope, decimal scale, or unsigned flag.
    const native = backend === 'mysql' ? sql`column_type` : backend === 'postgres' ? sql`udt_name` : sql`data_type`;
    const domain = backend === 'postgres' ? sql`domain_name` : sql`null`;
    const defaultExpression = backend === 'mysql' ? sql`database()` : sql`current_schema()`;
    const defaultSchema = (await sql<{ name: string }>`select ${defaultExpression} as name`.execute(db)).rows[0].name;
    const catalog = backend === 'mysql' ? sql`true` : sql`table_catalog = current_database()`;
    const { rows } = await sql<ColumnRow>`select table_name as table_name, column_name as column_name, ordinal_position as ordinal_position,
      data_type as data_type, ${native} as native_type, is_nullable as is_nullable,
      numeric_precision as numeric_precision, numeric_scale as numeric_scale, ${domain} as domain_name
      from information_schema.columns where table_schema = ${options.schema}
      and table_name in (${sql.join(options.tables.map(t => sql`${t}`))}) and ${catalog}
      order by table_name, ordinal_position`.execute(db);
    const result: DiscoveredMetadata = { backend, schema: options.schema, defaultSchema, tables: [] };
    for (const name of options.tables) {
      const columns = rows.filter(r => r.table_name === name).map(r => ({
        name: r.column_name, ordinal: Number(r.ordinal_position), dataType: r.data_type,
        nativeType: r.native_type, nullable: r.is_nullable === 'YES',
        precision: r.numeric_precision === null ? null : Number(r.numeric_precision),
        scale: r.numeric_scale === null ? null : Number(r.numeric_scale),
        unsigned: /\bunsigned\b/i.test(r.native_type), domainName: r.domain_name,
      }));
      if (!columns.length) throw new MetadataError('INVALID_METADATA', backend, `Table unavailable in metadata: ${options.schema}.${name}`);
      result.tables.push({ name, columns });
    }
    return result;
  } catch (cause) {
    if (cause instanceof MetadataError) throw cause;
    throw new MetadataError('METADATA_FAILED', backend, 'Metadata discovery failed', { cause });
  } finally { await db.destroy(); }
}
/** Strict physical-to-canonical mapping; unsupported precision/types are never guessed. */
export function metadataToCatalog(metadata: DiscoveredMetadata): Catalog {
  scope(metadata.backend, { schema: metadata.schema, tables: metadata.tables.map(t => t.name) });
  if (metadata.schema !== metadata.defaultSchema) throw new MetadataError('INVALID_METADATA', metadata.backend, 'Catalog conversion requires the default execution schema; physical discovery supports other schemas');
  const result: Catalog = Object.create(null);
  for (const table of metadata.tables) {
    if (!table.columns.length || new Set(table.columns.map(c => c.name)).size !== table.columns.length) {
      throw new MetadataError('INVALID_METADATA', metadata.backend, 'Invalid or empty column list');
    }
    result[table.name] = table.columns.map((c, index) => {
      if (typeof c.nullable !== 'boolean' || typeof c.unsigned !== 'boolean' || c.ordinal !== index + 1
        || typeof c.name !== 'string' || typeof c.dataType !== 'string' || typeof c.nativeType !== 'string'
        || ![c.precision, c.scale].every(n => n === null || (Number.isSafeInteger(n) && n >= 0))) {
        throw new MetadataError('INVALID_METADATA', metadata.backend, 'Malformed physical column metadata');
      }
      if (c.domainName !== null) throw new MetadataError('UNSUPPORTED_TYPE', metadata.backend, 'Domain types require an explicit mapping');
      let type: Catalog[string][number]['type'] | undefined;
      const physical = c.dataType.toLowerCase();
      if (!identifier.test(c.name)) throw new MetadataError('INVALID_METADATA', metadata.backend, 'Catalog requires simple column names');
      if (['smallint', 'integer', 'int', 'tinyint', 'mediumint'].includes(physical)) {
        type = c.unsigned && ['integer', 'int'].includes(physical) ? 'i64' : 'i32';
      } else if (physical === 'bigint' && !c.unsigned) type = 'i64';
      else if (['boolean', 'bool'].includes(physical)) type = 'bool';
      else if (['double precision', 'double', 'real', 'float'].includes(physical)) type = 'fp64';
      else if (['character varying', 'character', 'varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext'].includes(physical)) type = 'string';
      else if (physical === 'date') type = 'date';
      else if ((physical === 'numeric' || physical === 'decimal' || /^decimal\(/.test(physical))
        && c.precision === 38 && c.scale === 10 && !c.unsigned) type = 'decimal';
      if (!type) throw new MetadataError('UNSUPPORTED_TYPE', metadata.backend,
        `Unsupported catalog type at ${metadata.schema}.${table.name}.${c.name}: ${c.nativeType} (${c.precision},${c.scale})`);
      return { name: c.name, type, nullable: c.nullable };
    });
  }
  return result;
}
/** Convenience for strictly representable schemas; use discoverMetadata to inspect rejected types. */
export async function discoverCatalog(backend: Backend, options: MetadataOptions): Promise<Catalog> {
  return metadataToCatalog(await discoverMetadata(backend, options));
}
