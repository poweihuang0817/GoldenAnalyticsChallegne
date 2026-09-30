# Golden Interview Challenge
Author: Po-wei Huang (Manually written)

## Architecture discussion
This challenge is like creating our version of power query. I hope to reuse open source project or standard so that we don't rebuild the wheel. The first thing I need to decide is whether to introduce an IR like power query. In the end, I decide to pick a subset of Substrait. It's an open IR for relational algebra and could be ported to future semantic language upstream like Malloy.

After that, I need to pick a connector/dialect to implement postgresql/mysql backend. I choose Kysely since it's a good sql builder and dialect implementation in typescript world.

With these two in place, I implement an upstream typed API for query building. Basically all the component like predicate and select are typed. Then, I have compile API/execute API for sql generation and real execute. At here the architecture is finished.

I did think about using kysely directly and avoid IR. But substrait IR give us some advantage. For example, if we want to read data from parquet, relational algebra could express that. We don't need to bind to Kysely/SQL. Also, there are a lot of details in query semantic. For example, null + 0, is it null or 0? Kysely is a SQL builder and doesn't get into that detail. We need a specification that includes query semantic. PRQL is another IR option but I know it pretty late.

This challenge also requires semantic definition. For example, there are two definition of 75th percentile. Discrete or continuous. Also, for some definition like total order price , we need clear definition to check whether it should include discount or not. We need a place like Apache Ossie to put that. For this challenge, I put it in document only.

The last piece is metadata. I only finish metadata discovery by runtime fetch. But some service like unity catalog to serve visual and query might be useful.  To avoid complexity, I didn't isolate out for now.

So, overall the architecture is typed API -> IR by substrait -> Kysely dialect in typescript.

## Implementation details
During implementation, I reuse my knowledge from power bi to ensure it have the characteristic of production service.

### For dialect
- Capability - which clause is supported by db
- Structured connection information - machine readable and able to hook up future by Apache Ossie
- Authentication - currently only password but need to support SSO in future
- Timeout and cancellation - to avoid query stuck incident
- Debugging - framework to isolate issue. remote issue or our issue.

### For typed API
- Compile to generate query for debugging. Execute as async in API
- Each component as type, instead of callback.
- type and spelling check due to pre-load schema.

### For compiling
- In target generation, ensure tree traversal has clear context object. 


## API usage
The flows follow how we construct SQL. Get schema. Build query. Execute. Below are each step.
### Define catalog
Firstly we define table to be used in this query. This allows us to do type check and spelling check.
```
export const challengeCatalog = {
  orders: [
    { name: 'order_id', type: 'i32', nullable: false },
    { name: 'order_date', type: 'date', nullable: true },
    { name: 'customer_id', type: 'string', nullable: true },
    { name: 'employee_id', type: 'i32', nullable: true },
    { name: 'shipped_date', type: 'date', nullable: true },
    { name: 'freight', type: 'decimal', nullable: true },
  ],
  // customers、employees、order_details ...
} as const satisfies Catalog;
```

### Get table from that
const source = createSource(challengeCatalog);
const customers = source.table('customers');

### Build query
Typed predicate and aggregation

```
const query = customers
  .filter(
    customers.columns.city
      .lower()
      .eq(literal('london').lower()),
  )
  .aggregate({
    customer_count: count(),
  });
```

### Select dialect and execute
```
const client = createClient('postgres', challengeCatalog);

try {
  const { rows } = await client.execute(query);
  console.table(rows);
} finally {
  await client.destroy();
}
```

### For debugging, preview query
const preview = client.compile(query);
console.log(preview.sql)

## Db dialect and extension
- postgresql
- mysql
- duckdb
I added duckdb as it's asked by analyst in youtube video. It works well

For sql extension, I added row number window function

## Test methodology
- Test case- 6 cases in challenge. Enlarge it with more SQL cases (total 50).
- Comparison between each database
- Component test in each layer
- Equivalence test - filter (A and B) = filter A then filter B.
- Independent test
- CI to check fresh clone and basic test in github action


## Tools and setup commands
I implemented an UI to drive API
Please check doc folder for setup commands.

## AI usage

See my [manually written AI usage record](Manual_Record_AI_Usage.md).

## Future work
- Enlarge test suite by TPC-H or substrait consumer test
- Adopt apache ossie or figure out a place for semantic view
- Evaluate catalog service
- Evaluate PRQL for more compiler reuse
- Evaluate Malloy and other semantic language

