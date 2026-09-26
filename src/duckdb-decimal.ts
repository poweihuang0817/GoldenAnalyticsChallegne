import { sql, type RawBuilder } from 'kysely';

/** DuckDB's decimal / returns DOUBLE. Use scaled integers, rounding half away from zero.
 * HUGEINT overflow is an explicit execution error, never an approximate fallback.
 */
export function duckdbDecimalDivide(left: RawBuilder<unknown>, right: RawBuilder<unknown>): RawBuilder<unknown> {
  return sql`(select cast(
    (case when sign(n) * sign(d) < 0 then '-' else '' end) ||
    cast(q // 10000000000 as varchar) || '.' || lpad(cast(q % 10000000000 as varchar), 10, '0')
    as decimal(38,10))
    from (select n, d, case when n is null or d is null then null else
      (abs(n) * 10000000000) // abs(d) +
      case when (abs(n) * 10000000000) % abs(d) >= abs(d) // 2 + abs(d) % 2 then 1 else 0 end end as q
      from (select cast(replace(cast(${left} as varchar), '.', '') as hugeint) as n,
        nullif(cast(replace(cast(${right} as varchar), '.', '') as hugeint), 0) as d) as golden_div_input
    ) as golden_div_rounded)`;
}
