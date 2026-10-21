import { createSource, count, integer, literal } from './api.js';
import { challengeCatalog } from './challenge.js';

export type FilterStage = 'all' | 'uk' | 'london';
export const MAX_DAYS = 5000;

/** Immutable query refinement: later stages use columns from the new relation. */
export function salesStages() {
  const source = createSource(challengeCatalog);
  const all = source.table('customers');
  const uk = all.filter(all.columns.country.lower().eq(literal('UK').lower()));
  const london = uk.filter(uk.columns.city.lower().eq(literal('London').lower()));
  return { source, all, uk, london };
}

export function customerCountQuery(stage: FilterStage) {
  const selected = salesStages()[stage];
  if (!selected) throw new Error('Unknown filter stage');
  return selected.aggregate({ customers: count() });
}

/** The backend performs joins, discounted-line arithmetic and daily aggregation. */
export function dailySalesQuery(stage: FilterStage) {
  const stages = salesStages();
  const customers = stages[stage];
  if (!customers) throw new Error('Unknown filter stage');
  const orders = stages.source.table('orders');
  const co = customers.join(orders, { how: 'inner' });
  const matched = co.on(co.left.customer_id.eq(co.right.customer_id));
  const selected = matched.select({ order_id: matched.right.order_id, day: matched.right.order_date });
  const dated = selected.filter(selected.columns.day.isNotNull());
  const details = stages.source.table('order_details');
  const lines = dated.join(details, { how: 'inner' });
  const joined = lines.on(lines.left.order_id.eq(lines.right.order_id));
  const priced = joined.select({ day: joined.left.day,
    amount: joined.right.unit_price.mul(joined.right.quantity).mul(integer(1).sub(joined.right.discount)) });
  return priced.groupBy('day').aggregate({ sales: priced.columns.amount.sum() })
    .orderBy({ column: 'day' }).limit(MAX_DAYS + 1);
}

const SCALE = 10_000_000_000n;
function amount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,10})?$/.test(value)) throw new Error('Expected an exact decimal string');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return (negative ? -1n : 1n) * (BigInt(whole) * SCALE + BigInt(fraction.padEnd(10, '0')));
}
function rounded(n: bigint, divisor: bigint) {
  const sign = n < 0n ? -1n : 1n, absolute = n < 0n ? -n : n;
  return sign * ((absolute + divisor / 2n) / divisor);
}
function money(n: bigint, denominator = 1n) {
  const cents = rounded(n, denominator * (SCALE / 100n)), absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function dateKey(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) value = value.toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expected a calendar date');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return value;
}
function monthIndex(day: string) { return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1; }
function monthName(index: number) { return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`; }
export type DailyRow = { day: unknown; sales: unknown };
export type Coverage = { start: number; end: number };

/** Use one unfiltered range for every segment. Exclude both boundary months conservatively. */
export function coverage(rows: readonly DailyRow[]): Coverage | undefined {
  if (rows.length > MAX_DAYS) throw new Error('Demo daily-row limit exceeded; refusing a truncated forecast');
  if (!rows.length) return undefined;
  const months = rows.map(r => monthIndex(dateKey(r.day)));
  return { start: Math.min(...months) + 1, end: Math.max(...months) - 1 };
}

/** Demo-only baseline. Month bucketing and prediction run here, outside Substrait. */
export function forecast(rows: readonly DailyRow[], range: Coverage | undefined) {
  if (rows.length > MAX_DAYS) throw new Error('Demo daily-row limit exceeded; refusing a truncated forecast');
  const empty = { history: [] as { month: string; sales: string }[], predictions: [] as { month: string; sales: string }[], backtest: undefined as { periods: number; mae: string } | undefined };
  if (!range || range.end < range.start) return { ...empty, reason: 'No interior calendar months available.' };
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end - range.start > 1200) throw new Error('Invalid demo coverage');
  const totals = new Map<number, bigint>();
  for (const row of rows) {
    const month = monthIndex(dateKey(row.day)), value = amount(row.sales);
    if (month >= range.start && month <= range.end) totals.set(month, (totals.get(month) ?? 0n) + value);
  }
  const values: bigint[] = [];
  for (let month = range.start; month <= range.end; month++) values.push(totals.get(month) ?? 0n);
  const history = values.map((v, i) => ({ month: monthName(range.start + i), sales: money(v) }));
  if (values.length < 3 || !totals.size) return { ...empty, history, reason: 'Need three interior months and observed sales in this segment.' };
  // Retain the exact numerator/denominator until final display rounding.
  const baseline = values.slice(-3).reduce((a, b) => a + b, 0n);
  // Rolling one-step evaluation uses only the three months before each held-out month.
  const errors = values.slice(3).map((actual, i) => {
    const predicted = values.slice(i, i + 3).reduce((a, b) => a + b, 0n), scaledActual = actual * 3n;
    return scaledActual >= predicted ? scaledActual - predicted : predicted - scaledActual;
  });
  return { history, predictions: [1, 2, 3].map(i => ({ month: monthName(range.end + i), sales: money(baseline, 3n) })),
    backtest: errors.length ? { periods: errors.length, mae: money(errors.reduce((a, b) => a + b, 0n), 3n * BigInt(errors.length)) } : undefined,
    reason: undefined };
}
