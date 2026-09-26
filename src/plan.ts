import { z } from 'zod';

// A strict JSON profile of Substrait v0.63.0, not a new relational IR.
const empty = z.strictObject({});
const index = z.number().int().nonnegative();
const common = z.union([
  z.strictObject({ direct: empty }),
  z.strictObject({ emit: z.strictObject({ outputMapping: z.array(index).min(1) }) }),
]);
const field = z.strictObject({
  selection: z.strictObject({
    directReference: z.strictObject({ structField: z.strictObject({ field: index }) }),
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
type Common = z.infer<typeof common>;
type Read = { common?: Common; namedTable: { names: string[] }; baseSchema: {
  names: string[]; struct: { types: z.infer<typeof type>[]; nullability: 'NULLABILITY_REQUIRED' };
} };
export type Rel =
  | { read: Read }
  | { project: { common?: Common; input: Rel; expressions: Field[] } }
  | { sort: { input: Rel; sorts: { expr: Field; direction: z.infer<typeof direction> }[] } }
  | { fetch: { input: Rel; count: string; offset?: string } };
const rel: z.ZodType<Rel> = z.lazy(() => z.union([
  z.strictObject({ read: z.strictObject({
    common: common.optional(), namedTable: z.strictObject({ names: z.array(z.string()).length(1) }),
    baseSchema: z.strictObject({ names: z.array(z.string()).min(1), struct: z.strictObject({
      types: z.array(type).min(1), nullability: z.literal('NULLABILITY_REQUIRED'),
    }) }),
  }) }),
  z.strictObject({ project: z.strictObject({ common: common.optional(), input: rel, expressions: z.array(field).min(1) }) }),
  z.strictObject({ sort: z.strictObject({ input: rel, sorts: z.array(z.strictObject({ expr: field, direction })).min(1) }) }),
  z.strictObject({ fetch: z.strictObject({ input: rel, count: integer, offset: integer.optional() }) }),
]));
export const planSchema = z.strictObject({
  version: z.strictObject({ majorNumber: z.literal(0), minorNumber: z.literal(63), patchNumber: z.literal(0) }),
  relations: z.array(z.strictObject({ root: z.strictObject({ input: rel, names: z.array(z.string().min(1)).min(1) }) })).length(1),
});
export type Plan = z.infer<typeof planSchema>;
export const ref = (position: number): Field => ({ selection: {
  directReference: { structField: { field: position } }, rootReference: {},
} });
