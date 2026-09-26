import { ref, toPlanJson, substrait, type Plan } from './plan.js';
import type { Catalog } from './compiler.js';

// Logical catalog view: exposes selected physical columns in a fixed positional order.
export const catalog: Catalog = { orders: [
  { name: 'order_id', type: 'i32', nullable: false },
  { name: 'order_date', type: 'date', nullable: true },
] };
export function recentOrders(count = 5) {
  const plan: Plan = {
    version: { majorNumber: 0, minorNumber: 63, patchNumber: 0 },
    relations: [{ root: {
      names: ['order_id', 'order_date'],
      input: { fetch: { count, input: { sort: {
        sorts: [
          { expr: ref(1), direction: substrait.SortField.SortDirection.SORT_DIRECTION_DESC_NULLS_LAST },
          { expr: ref(0), direction: substrait.SortField.SortDirection.SORT_DIRECTION_DESC_NULLS_LAST },
        ],
        input: { project: {
          expressions: [ref(0), ref(1)], common: { emit: { outputMapping: [2, 3] } },
          input: { read: {
            namedTable: { names: ['orders'] },
            baseSchema: { names: ['order_id', 'order_date'], struct: {
              nullability: substrait.Type.Nullability.NULLABILITY_REQUIRED, types: [
                { i32: { nullability: substrait.Type.Nullability.NULLABILITY_REQUIRED } },
                { date: { nullability: substrait.Type.Nullability.NULLABILITY_NULLABLE } },
              ],
            } },
          } },
        } },
      } } } },
    } }],
  };
  return toPlanJson(plan);
}
