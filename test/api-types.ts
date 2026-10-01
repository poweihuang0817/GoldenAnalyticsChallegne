/** Compile-only contracts. Never executed: npm run check validates every expect-error. */
import { createSource, literal, integer, count, caseWhen, eq, and, type Expr, type Measure, type InferRow } from '../src/api.js';
import { challengeCatalog } from '../src/challenge.js';
import { createClient } from '../src/client.js';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
function contracts() {
  const built = integer(1);
  const structuralExpr = {
    kind: built.kind, nullable: built.nullable,
    resolve: built.resolve, eq: built.eq, lower: built.lower, lte: built.lte,
    isNull: built.isNull, isNotNull: built.isNotNull, and: built.and,
    coalesce: built.coalesce, mul: built.mul, sub: built.sub, div: built.div,
    sum: built.sum, avg: built.avg, count: built.count, percentile: built.percentile,
  };
  // @ts-expect-error matching public members cannot forge a factory-built expression
  const forgedExpr: Expr<'i32', false> = structuralExpr;
  const structuralMeasure = { name: 'count', args: [built], kind: 'i64', nullable: false } as const;
  // @ts-expect-error matching public members cannot forge a factory-built measure
  const forgedMeasure: Measure<'i64', false> = structuralMeasure;
  const validExpr: Expr<'i32', false> = integer(1);
  const validMeasure: Measure<'i64', false> = count();
  void forgedExpr; void forgedMeasure; void validExpr; void validMeasure;
  const source = createSource(challengeCatalog);
  const flag = Math.random() > 0.5;
  // @ts-expect-error choose a concrete table before accessing its columns
  source.table(flag ? 'orders' : 'employees');
  const orders = source.table('orders');
  const c = orders.columns;
  orders.filter(and(eq(c.order_id, 1), c.shipped_date.isNotNull()));
  // @ts-expect-error unknown table
  source.table('missing');
  // @ts-expect-error unknown column
  orders.col('missing');
  // @ts-expect-error unknown property
  c.missing;
  // @ts-expect-error integer/string equality
  c.order_id.eq('one');
  // @ts-expect-error scalar is not a predicate
  orders.filter(c.order_id);
  // @ts-expect-error callback API removed
  orders.filter(() => literal(true));
  // @ts-expect-error callback projection removed
  orders.select(() => ({ id: c.order_id }));
  // @ts-expect-error callback aggregate removed
  orders.aggregate(() => ({ n: count() }));
  // @ts-expect-error lower needs a string
  c.order_id.lower();
  // @ts-expect-error aggregate needs numeric input
  c.customer_id.sum();
  // @ts-expect-error boolean and needs boolean operands
  literal(true).and(integer(1));
  // @ts-expect-error decimal/floating-point mixing rejected
  c.freight.mul(literal(0.5));
  // @ts-expect-error CASE branches must match
  caseWhen(literal(true), integer(1), literal('no'));
  // @ts-expect-error integer/floating equality differs
  integer(1).eq(literal(1));
  // @ts-expect-error standalone eq must not infer a wider kind to accept strings
  eq(c.order_id, literal('one'));
  // @ts-expect-error decimal comparison has no implicit integer cast
  c.freight.eq(1);
  // @ts-expect-error decimal comparison needs a decimal expression
  c.freight.lte(1);
  const nested = orders.aggregate({ n: count() });
  // @ts-expect-error i64 equality needs another i64 expression
  nested.columns.n.eq(1);
  nested.columns.n.lte(1);
  const compound = and(c.customer_id.eq('ALFKI'), c.order_id.eq(1));
  type PredicateNullable = Assert<Equal<typeof compound.nullable, true>>;
  const requiredFallback = c.customer_id.coalesce('unknown');
  type FallbackRequired = Assert<Equal<typeof requiredFallback.nullable, false>>;
  const nullableFallback = c.customer_id.coalesce(c.customer_id);
  type FallbackNullable = Assert<Equal<typeof nullableFallback.nullable, true>>;
  const projected = orders.select({ id: c.order_id, customer: c.customer_id });
  projected.col('id').eq(1);
  // @ts-expect-error old projection name disappeared
  projected.col('order_id');
  // @ts-expect-error sort name does not exist
  projected.orderBy({ column: 'order_id' });
  const grouped = orders.groupBy('customer_id').aggregate({ n: count(), freight: c.freight.sum() });
  grouped.col('customer_id'); grouped.col('n');
  // @ts-expect-error non-grouped input disappeared
  grouped.col('order_id');
  // @ts-expect-error aggregate cannot contain a scalar
  orders.aggregate({ id: c.order_id });
  // @ts-expect-error duplicate grouping/output alias
  orders.groupBy('customer_id').aggregate({ customer_id: count() });
  const join = orders.join(orders, { how: 'left' });
  const matched = join.on(join.left.order_id.eq(join.right.order_id));
  const nullable: Expr<'i32', true> = matched.right.order_id;
  // @ts-expect-error right result of left join is nullable
  const required: Expr<'i32', false> = matched.right.order_id;
  const result = matched.select({ id: matched.left.order_id, right: matched.right.order_id, fallback: matched.right.order_id.coalesce(0) });
  type Row = InferRow<typeof result>;
  type Check = Assert<Equal<Row, { id: number | string; right: number | string | null; fallback: number | string }>>;
  // @ts-expect-error a union grouping key cannot guarantee both output columns
  orders.groupBy(flag ? 'customer_id' : 'employee_id');
  const keys = flag ? ['customer_id'] as const : ['employee_id'] as const;
  // @ts-expect-error spreading alternative grouping tuples cannot guarantee both columns
  orders.groupBy(...keys);
  const dynamicName: string = 'rank';
  // @ts-expect-error a dynamic window name cannot promise every string column
  orders.withRowNumber(dynamicName, { partitionBy: [], orderBy: [{ column: 'order_id' }] });
  // @ts-expect-error a union window alias must be narrowed first
  orders.withRowNumber(flag ? 'one' : 'two', { partitionBy: [], orderBy: [{ column: 'order_id' }] });
  // @ts-expect-error runtime projection keys cannot guarantee statically named outputs
  orders.select({ [dynamicName]: c.order_id });
  // @ts-expect-error runtime aggregate aliases cannot guarantee named outputs
  orders.aggregate({ [dynamicName]: count() });
  const ranked = orders.withRowNumber('position', { partitionBy: ['customer_id'], orderBy: [{ column: 'order_id' }] });
  ranked.columns.position.lte(3);
  // @ts-expect-error window output would overwrite a field
  orders.withRowNumber('order_id', { partitionBy: [], orderBy: [{ column: 'order_id' }] });
  // @ts-expect-error missing partition field
  orders.withRowNumber('rank', { partitionBy: ['missing'], orderBy: [{ column: 'order_id' }] });
  const totals = orders.aggregate({ n: count(), freight: c.freight.sum(), average: c.order_id.avg() });
  type Totals = Assert<Equal<InferRow<typeof totals>, { n: string; freight: string | null; average: number | null }>>;
  const client = createClient('postgres', challengeCatalog);
  const rows = client.execute(result);
  type Executed = Assert<Equal<Awaited<typeof rows>['rows'][number], Row>>;
  void nullable; void required;
}
void contracts;

// The accepted/rejected expressions shown on the UI Types and Projection pages.
function presentationConstraints() {
  const source = createSource(challengeCatalog);
  const customers = source.table('customers');
  const orders = source.table('orders');
  const lowered: Expr<'string', true> = customers.columns.city.lower();
  // @ts-expect-error lower requires a string receiver
  orders.columns.order_id.lower();
  const projected = customers.select({ customer_city: customers.columns.city });
  const renamed: Expr<'string', true> = projected.columns.customer_city;
  // @ts-expect-error projection renamed this column
  projected.columns.city;
  // @ts-expect-error projection omitted this column
  projected.columns.customer_id;
  void lowered; void renamed;
}

// Compilation is Promise-based even though query construction is synchronous.
async function compilePreviewType() {
  const client = createClient('postgres', challengeCatalog);
  const query = createSource(challengeCatalog).table('customers');
  const preview: Promise<import('../src/client.js').QueryPreview> = client.compile(query);
  // @ts-expect-error SQL is available only after awaiting compilation.
  preview.sql;
  (await preview).sql satisfies string;
  await client.destroy();
}
