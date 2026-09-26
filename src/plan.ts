import { z } from 'zod';
import generated from './generated/substrait.cjs';
import type { substrait as Substrait } from './generated/substrait.cjs';
import { assertKnownFields, assertKnownWire } from './wire.js';

export const substrait = generated.substrait;
export type Plan = Substrait.IPlan;

// A strict JSON profile of Substrait v0.63.0, not a new relational IR.
const empty = z.strictObject({});
const index = z.number().int().nonnegative();
const common = z.union([
  z.strictObject({ direct: empty }),
  z.strictObject({ emit: z.strictObject({ outputMapping: z.array(index).min(1) }) }),
]);
const field = z.strictObject({
  selection: z.strictObject({
    directReference: z.strictObject({ structField: z.strictObject({ field: index.default(0) }) }),
    rootReference: empty,
  }),
});
const primitive = z.strictObject({
  nullability: z.enum(['NULLABILITY_NULLABLE', 'NULLABILITY_REQUIRED']),
});
const type = z.union([
  z.strictObject({ i32: primitive }), z.strictObject({ date: primitive }),
  z.strictObject({ string: primitive }),
]);
const integer = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(
  value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER), 'Integer exceeds safe range',
);
const direction = z.enum([
  'SORT_DIRECTION_ASC_NULLS_FIRST', 'SORT_DIRECTION_ASC_NULLS_LAST',
  'SORT_DIRECTION_DESC_NULLS_FIRST', 'SORT_DIRECTION_DESC_NULLS_LAST',
]);
export type Field = z.infer<typeof field>;
const rel = z.union([
  z.strictObject({ read: z.strictObject({
    common: common.optional(), namedTable: z.strictObject({ names: z.array(z.string()).length(1) }),
    baseSchema: z.strictObject({ names: z.array(z.string()).min(1), struct: z.strictObject({
      types: z.array(type).min(1), nullability: z.literal('NULLABILITY_REQUIRED'),
    }) }),
  }) }),
  z.strictObject({ project: z.strictObject({ common: common.optional(), get input() { return rel; }, expressions: z.array(field).min(1) }) }),
  z.strictObject({ sort: z.strictObject({ get input() { return rel; }, sorts: z.array(z.strictObject({ expr: field, direction })).min(1) }) }),
  z.strictObject({ fetch: z.strictObject({ get input() { return rel; }, count: integer, offset: integer.optional() }) }),
]);
export type Rel = z.infer<typeof rel>;
export const planSchema = z.strictObject({
  version: z.strictObject({ majorNumber: z.literal(0).default(0), minorNumber: z.literal(63), patchNumber: z.literal(0).default(0) }),
  relations: z.array(z.strictObject({ root: z.strictObject({ input: rel, names: z.array(z.string().min(1)).min(1) }) })).length(1),
});
export type SupportedPlanJson = z.infer<typeof planSchema>;
export const ref = (position: number) => ({ selection: {
  directReference: { structField: { field: position } }, rootReference: {},
} } satisfies Substrait.IExpression);

export function assertBounded(input: unknown) {
  const pending = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++nodes > 10000 || depth > 100) throw new Error('Plan exceeds size or depth limit');
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
    }
  }
}

/** Capability validation precedes fromObject, which otherwise ignores unknown JSON fields. */
export function fromPlanJson(input: unknown): Substrait.Plan {
  assertBounded(input);
  const supported = planSchema.parse(input);
  const plan = substrait.Plan.fromObject(supported);
  const error = substrait.Plan.verify(plan);
  if (error) throw new Error(`Invalid Substrait: ${error}`);
  return plan;
}

/** JSON shape is normalized by the official schema codec, not handwritten serializers. */
export function toPlanJson(plan: Plan): SupportedPlanJson {
  assertBounded(plan);
  assertKnownFields(plan);
  const error = substrait.Plan.verify(plan);
  if (error) throw new Error(`Invalid Substrait: ${error}`);
  return planSchema.parse(substrait.Plan.toObject(plan as Substrait.Plan, { longs: String, enums: String }));
}

export function encodePlan(input: unknown): Uint8Array {
  return substrait.Plan.encode(fromPlanJson(input)).finish();
}

export function decodePlan(bytes: Uint8Array): SupportedPlanJson {
  if (bytes.length > 1_000_000) throw new Error('Plan exceeds binary size limit');
  assertKnownWire(bytes);
  return toPlanJson(substrait.Plan.decode(bytes));
}
