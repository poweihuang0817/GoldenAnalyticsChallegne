import { test } from 'node:test';
import assert from 'node:assert/strict';
import protobuf from 'protobufjs';
import { recentOrders } from '../src/example.js';
import { decodePlan, encodePlan, fromPlanJson, toPlanJson, substrait } from '../src/plan.js';

test('official generated codec round-trips the supported plan', () => {
  const plan = recentOrders();
  assert.deepEqual(decodePlan(encodePlan(plan)), plan);
  assert.equal(substrait.Plan.verify(fromPlanJson(plan)), null);
});

test('independent reflection of vendored upstream schema reads and writes our wire format', () => {
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => target.startsWith('google/') ? target : `vendor/substrait/proto/${target}`;
  root.loadSync('substrait/plan.proto');
  const standard = root.lookupType('substrait.Plan');
  const fixture = recentOrders(9);
  const external = standard.fromObject(fixture);
  assert.equal(standard.verify(external), null);
  assert.deepEqual(decodePlan(standard.encode(external).finish()), fixture);
  const json = standard.toObject(standard.decode(encodePlan(fixture)), { longs: String, enums: String });
  // Protobuf JSON may omit scalar defaults such as field index zero.
  assert.deepEqual(toPlanJson(fromPlanJson(json)), fixture);
});

test('schema-valid unsupported operators and expressions are blocked', () => {
  const join = substrait.Plan.fromObject({
    version: { majorNumber: 0, minorNumber: 63, patchNumber: 0 },
    relations: [{ root: { names: ['x'], input: { join: {} } } }],
  });
  assert.equal(substrait.Plan.verify(join), null);
  assert.throws(() => toPlanJson(join));
  assert.throws(() => decodePlan(substrait.Plan.encode(join).finish()));
  const extended = { ...recentOrders(), extensions: [{ extensionFunction: { functionAnchor: 1, name: 'add' } }] };
  assert.throws(() => fromPlanJson(extended));
  assert.throws(() => encodePlan({ ...recentOrders(), inventedField: true }));
});

test('reject conflicting oneofs, malformed wire input, and oversized binaries', () => {
  const plan = fromPlanJson(recentOrders());
  plan.relations[0].root!.input!.read = {};
  assert.throws(() => toPlanJson(plan), /multiple values/);
  assert.throws(() => decodePlan(Uint8Array.from([0x1a, 0xff])));
  assert.throws(() => decodePlan(new Uint8Array(1_000_001)), /size limit/);
  const unknownTag = protobuf.Writer.create().uint32(999 << 3).uint32(1).finish();
  assert.throws(() => decodePlan(unknownTag), /Unknown Substrait wire field/);
  assert.throws(() => decodePlan(Uint8Array.from([0x33])), /Invalid message wire type/);
  const unknownField = { ...fromPlanJson(recentOrders()), inventedField: true };
  assert.throws(() => toPlanJson(unknownField), /Unknown Substrait field/);
});
