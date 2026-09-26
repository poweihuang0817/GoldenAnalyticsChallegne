import type { substrait as S } from './generated/substrait.cjs';
import { substrait, ref, toPlanJson, type Plan } from './plan.js';
import { FUNCTION_URI, FUNCTIONS } from './relational.js';
import type { Catalog } from './compiler.js';

const N = substrait.Type.Nullability;
const type = (kind: string, nullable = true): S.IType => ({ [kind]: { nullability: nullable ? N.NULLABILITY_NULLABLE : N.NULLABILITY_REQUIRED, ...(kind === 'decimal' ? { precision: 38, scale: 10 } : {}) } });
const literal = (value: number | string): S.IExpression => ({ literal: typeof value === 'string' ? { string: value } : { fp64: value } });
const anchor = (name: typeof FUNCTIONS[number]) => FUNCTIONS.indexOf(name) + 1;
function fn(name: typeof FUNCTIONS[number], args: S.IExpression[], kind = 'fp64', nullable = true): S.IExpression {
  return { scalarFunction: { functionReference: anchor(name), arguments: args.map(value => ({ value })), outputType: type(kind, nullable) } };
}
const eq = (a: number, b: number) => fn('equal', [ref(a), ref(b)], 'bool');
const present = (i: number) => fn('is_not_null', [ref(i)], 'bool', false);
const absent = (i: number) => fn('is_null', [ref(i)], 'bool', false);
const zeroIfNull = (expr: S.IExpression) => fn('coalesce', [expr, literal(0)]);
const money = (name: typeof FUNCTIONS[number], args: S.IExpression[]) => fn(name, args, 'decimal');
const integer = (i32: number): S.IExpression => ({ literal: { i32 } });
const zeroMoney = (expr: S.IExpression) => money('coalesce', [expr, integer(0)]);
const indicator = (condition: S.IExpression): S.IExpression => ({ ifThen: { ifs: [{ if: condition, then: literal(1) }], else: literal(0) } });

export const challengeCatalog: Catalog = {
  orders: [
    { name: 'order_id', type: 'i32', nullable: false }, { name: 'order_date', type: 'date', nullable: true },
    { name: 'customer_id', type: 'string', nullable: true }, { name: 'employee_id', type: 'i32', nullable: true },
    { name: 'shipped_date', type: 'date', nullable: true }, { name: 'freight', type: 'decimal', nullable: true },
  ],
  customers: [
    { name: 'customer_id', type: 'string', nullable: false }, { name: 'city', type: 'string', nullable: true },
    { name: 'country', type: 'string', nullable: true },
  ],
  employees: [{ name: 'employee_id', type: 'i32', nullable: false }],
  order_details: [
    { name: 'order_id', type: 'i32', nullable: false }, { name: 'unit_price', type: 'decimal', nullable: false },
    { name: 'quantity', type: 'i32', nullable: false }, { name: 'discount', type: 'decimal', nullable: false },
  ],
};
function read(table: string): S.IRel {
  const fields = challengeCatalog[table];
  return { read: { namedTable: { names: [table] }, baseSchema: { names: fields.map(f => f.name),
    struct: { nullability: N.NULLABILITY_REQUIRED, types: fields.map(f => type(f.type, f.nullable)) } } } };
}
function project(input: S.IRel, width: number, expressions: S.IExpression[]): S.IRel {
  return { project: { input, expressions, common: { emit: { outputMapping: expressions.map((_, i) => width+i) } } } };
}
function join(left: S.IRel, right: S.IRel, condition: S.IExpression, outer = false): S.IRel {
  return { join: { left, right, expression: condition, type: outer ? substrait.JoinRel.JoinType.JOIN_TYPE_LEFT : substrait.JoinRel.JoinType.JOIN_TYPE_INNER } };
}
function aggregate(input: S.IRel, groups: number[], measures: { name: typeof FUNCTIONS[number]; args: S.IExpression[]; kind?: string }[]): S.IRel {
  return { aggregate: { input, groupings: [{ groupingExpressions: groups.map(ref) }], measures: measures.map(({ name, args, kind }) => ({ measure: {
    functionReference: anchor(name), arguments: args.map(value => ({ value })), outputType: type(kind ?? (name === 'count' ? 'i64' : 'fp64'), name !== 'count'),
    phase: substrait.AggregationPhase.AGGREGATION_PHASE_INITIAL_TO_RESULT,
    invocation: substrait.AggregateFunction.AggregationInvocation.AGGREGATION_INVOCATION_ALL,
  } })) } };
}
function plan(input: S.IRel, names: string[]) {
  const message: Plan = {
    version: { majorNumber: 0, minorNumber: 63, patchNumber: 0 },
    extensionUris: [{ extensionUriAnchor: 1, uri: FUNCTION_URI }],
    extensions: FUNCTIONS.map(name => ({ extensionFunction: { extensionUriReference: 1, functionAnchor: anchor(name), name } })),
    relations: [{ root: { input, names } }],
  };
  return toPlanJson(message);
}
function sorted(input: S.IRel, index: number): S.IRel {
  return { sort: { input, sorts: [{ expr: ref(index), direction: substrait.SortField.SortDirection.SORT_DIRECTION_ASC_NULLS_LAST }] } };
}

export function customersInCity(city: string) {
  const filtered: S.IRel = { filter: { input: read('customers'), condition: fn('equal', [fn('lower', [ref(1)], 'string'), fn('lower', [literal(city)], 'string')], 'bool') } };
  return plan(aggregate(filtered, [], [{ name: 'count', args: [literal(1)] }]), ['customer_count']);
}
export function averageUnitsPerOrder() {
  const units = aggregate(read('order_details'), [0], [{ name: 'sum', args: [ref(2)] }]);
  const orders = join(read('orders'), units, eq(0,6), true);
  const values = project(orders, 8, [zeroIfNull(ref(7))]);
  return plan(aggregate(values, [], [{ name: 'avg', args: [ref(0)] }]), ['average_units']);
}
export function employeeShipping() {
  const input = join(read('employees'), read('orders'), eq(0,4), true);
  const shipped = indicator(fn('and', [present(1), present(5)], 'bool', false));
  const unshipped = indicator(fn('and', [present(1), absent(5)], 'bool', false));
  return plan(sorted(aggregate(input, [0], [{ name: 'sum', args: [shipped] }, { name: 'sum', args: [unshipped] }]), 0), ['employee_id', 'shipped', 'unshipped']);
}
function pricedOrders(): S.IRel {
  const linePrice = money('multiply', [money('multiply', [ref(1), ref(2)]), money('subtract', [integer(1), ref(3)])]);
  const totals = aggregate(read('order_details'), [0], [{ name: 'sum', args: [linePrice], kind: 'decimal' }]);
  const input = join(read('orders'), totals, eq(0,6), true);
  return project(input, 8, [ref(0), ref(2), zeroMoney(ref(7)), zeroMoney(ref(5))]);
}
export function customerFreightRatio() {
  const input = join(read('customers'), pricedOrders(), eq(0,4), true);
  const totals = aggregate(input, [0], [{ name: 'sum', args: [ref(6)], kind: 'decimal' }, { name: 'sum', args: [ref(5)], kind: 'decimal' }]);
  return plan(sorted(project(totals, 3, [ref(0), money('divide', [ref(1), ref(2)])]), 0), ['customer_id', 'freight_ratio']);
}
export function countryPercentile(fraction = 0.75) {
  const input = join(read('customers'), pricedOrders(), eq(0,4));
  return plan(sorted(aggregate(input, [2], [{ name: 'percentile_cont', args: [ref(5), literal(fraction)], kind: 'decimal' }]), 0), ['country', 'order_price_p75']);
}

export const analyticalExamples = [
  { name: 'Customers in London', plan: customersInCity('london') },
  { name: 'Customers in Mexico D.F.', plan: customersInCity('mexico d.f.') },
  { name: 'Average units per order', plan: averageUnitsPerOrder() },
  { name: 'Employee shipped/unshipped orders', plan: employeeShipping() },
  { name: 'Customer freight/order-price ratio', plan: customerFreightRatio() },
  { name: '75th percentile of order price by customer country', plan: countryPercentile() },
];
