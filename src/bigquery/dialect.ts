import { DefaultQueryCompiler, DialectAdapterBase, type Dialect } from 'kysely';
import { BigQueryDriver, type BigQueryOptions } from './driver.js';

/** SQL construction only; not a general-purpose BigQuery Kysely dialect. */
export class BigQueryAdapter extends DialectAdapterBase {
  async acquireMigrationLock(): Promise<never> { throw new Error('BigQuery migrations are unsupported'); }
  async releaseMigrationLock(): Promise<never> { throw new Error('BigQuery migrations are unsupported'); }
}
export class BigQueryCompiler extends DefaultQueryCompiler {
  protected override getCurrentParameterPlaceholder() { return '?'; }
  protected override getLeftIdentifierWrapper() { return '`'; }
  protected override getRightIdentifierWrapper() { return '`'; }
  protected override sanitizeIdentifier(identifier: string) {
    return identifier.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  }
  protected override sanitizeStringLiteral(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}
export class BigQueryDialect implements Dialect {
  constructor(private readonly options: BigQueryOptions = {}) {}
  createAdapter() { return new BigQueryAdapter(); }
  createQueryCompiler() { return new BigQueryCompiler(); }
  createDriver() { return new BigQueryDriver(this.options); }
  createIntrospector(): never { throw new Error('BigQuery metadata discovery is not implemented'); }
}
