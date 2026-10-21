# BigQuery backend (post-submission extension)

BigQuery uses the existing typed Table/Expr API, constrained Substrait profile,
relational lowering and compilation worker. The new Kysely dialect emits GoogleSQL;
the official `@google-cloud/bigquery` client submits remote query jobs. It does not
translate arbitrary SQL or replace the original three backends.

## Setup

Install the [Google Cloud CLI](https://docs.cloud.google.com/sdk/docs/install-sdk),
then authenticate the Node client using Application Default Credentials:

```powershell
gcloud auth application-default login
gcloud auth application-default set-quota-project northwind-demo-512222

$env:BIGQUERY_PROJECT_ID = 'northwind-demo-512222'
$env:BIGQUERY_DATASET = 'northwind'
# Set this to the dataset's actual location if necessary; do not guess it.
# $env:BIGQUERY_LOCATION = 'US'
$env:BIGQUERY_MAXIMUM_BYTES_BILLED = '1073741824'

npm ci
npm run demo:bigquery
npm run test:bigquery
```

The account needs permission to create query jobs in the project and read the
dataset (typically BigQuery Job User and dataset-scoped BigQuery Data Viewer).
No service-account key is needed. Credentials remain in Google's local ADC store,
outside the repository. A Console browser login alone does not configure ADC.
The supplied project/dataset comes from the user's dashboard, not an application default.

The billing cap defaults to 1 GiB **per query**, not per session. The demo executes
eight queries; the live tests submit multiple query jobs. Compilation and offline
tests make no BigQuery calls. Tests never create, modify or delete dataset tables.

## Application API

```ts
import { createClient } from '../src/client.js';
import { challengeCatalog } from '../src/challenge.js';
import { cityQuery } from '../src/queries.js';

const client = createClient('bigquery', challengeCatalog, {
  bigquery: { projectId: 'northwind-demo-512222', dataset: 'northwind' },
});
try {
  const query = cityQuery('london');
  console.log(await client.compile(query)); // No credentials or remote connection needed.
  console.log((await client.execute(query, { timeoutMs: 60_000 })).rows);
} finally {
  await client.destroy();
}
```

The SDK's `defaultDataset` resolves logical table names. Positional `?` parameters
and explicit SDK parameter types are submitted separately from SQL; values are not
interpolated. Project, dataset, location and credentials do not enter the plan or worker.

## Semantic mapping

- i32 reads return safe JavaScript integers; i64 outputs are cast to STRING in SQL.
  Unexpected uncast unsafe INT64 results are rejected rather than rounded.
- DATE wrappers become calendar-date strings. Arrays, structures and other result
  wrappers outside the supported profile fail explicitly.
- Golden decimal(38,10) uses BIGNUMERIC, rounds half away from zero to ten places,
  and rejects magnitudes at or above 10^28 after rounding. Outputs use
  `FORMAT('%.10f', ...)`, preserving decimal strings instead of JavaScript floats.
  This requires extra SQL because GoogleSQL cannot CAST to parameterized decimal types.
- Division by zero yields NULL through the existing NULLIF lowering.
- Continuous percentile uses the existing rank/count interpolation rewrite; it is
  tested against independently authored native BigQuery PERCENTILE_CONT queries.
- Approximate numeric operations use FLOAT64. Imported FLOAT64 money may already
  have lost precision; casting it cannot recover the original source digits.
- FLOAT64 window partition keys (including percentile grouping keys) are rejected
  during compilation, matching BigQuery's partition-expression restriction.
- Catalogs are explicit. This adapter does not infer the dataset's physical schema.

## Execution and limitations

Each acquired connection represents an independent BigQuery job slot, not a TCP
connection. Cancellation waits for job creation and calls `job.cancel()`, then the
existing execution controller waits for query/cancellation cleanup. Timeouts cover
running execution, not compilation, credential discovery or acquisition. They are
not hard network deadlines; cancellation can fail and is reported explicitly.

The SDK retrieves all result pages into memory. Streaming, transactions, migrations,
metadata discovery, automatic schema adaptation, and Playground integration are
not implemented. This change does not claim full BigQuery or Substrait support.

## Verification

- `npm test`: offline compiler/worker, config, binding, SDK result normalization,
  cancellation and cleanup tests, alongside existing backend tests.
- `test/fixtures/sql-query-blocks/bigquery.json`: generated SQL, ordered bindings
  and lowering trace for all eight demo queries. Snapshots prevent accidental
  changes; they are not a semantic oracle.
- `npm run test:bigquery`: opt-in live tests; skipped when project/dataset env vars
  are absent. CTE fixtures test empty orders, absent employees/customers, exact
  decimals, NULLs and overflow without writing tables. Dataset queries compare
  public-client results with independently authored native reference SQL.
- Live execution is not established merely by compilation or a skipped test run.

### Live evidence (October 20, 2026)

Authenticated with local ADC against `northwind-demo-512222.northwind` in `US`.
Confirmed 830 orders, 91 customers, 9 employees and 2,155 order details. All three
live test groups passed: eight fixture examples, decimal precision/NULL/rounding/
overflow cases, and eight public-client dataset queries compared with native SQL.
No dataset tables were written. This does not establish general dialect coverage
or performance advantages.

References: [parameters](https://docs.cloud.google.com/bigquery/docs/parameterized-queries),
[types](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/data-types),
[ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials),
[conditional evaluation](https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/conditional_expressions).
