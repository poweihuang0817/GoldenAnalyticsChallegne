import { readFileSync } from 'node:fs';
import protobuf from 'protobufjs';

// Reflection metadata is generated from the SAME upstream schema as the codec.
const root = protobuf.Root.fromJSON(JSON.parse(readFileSync(new URL('./generated/substrait-schema.json', import.meta.url), 'utf8'))).resolveAll();
const planType = root.lookupType('substrait.Plan');

export function assertKnownFields(value: unknown, type = planType): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const field = Object.hasOwn(type.fields, key) ? type.fields[key] : undefined;
    if (!field) throw new Error(`Unknown Substrait field: ${type.fullName}.${key}`);
    if (field.resolvedType instanceof protobuf.Type) {
      for (const item of Array.isArray(child) ? child : [child]) assertKnownFields(item, field.resolvedType);
    }
  }
}

/** Fail closed on unknown tags and deep messages before the generated recursive decoder. */
export function assertKnownWire(bytes: Uint8Array) {
  const reader = protobuf.Reader.create(bytes);
  let nodes = 0;
  function scan(type: protobuf.Type, end: number, depth: number) {
    if (depth > 100) throw new Error('Plan exceeds binary depth limit');
    while (reader.pos < end) {
      if (++nodes > 10000) throw new Error('Plan exceeds binary field limit');
      const tag = reader.uint32();
      const field = type.fieldsById[tag >>> 3];
      if (!field) throw new Error(`Unknown Substrait wire field: ${type.fullName}.${tag >>> 3}`);
      const wire = tag & 7;
      if (field.resolvedType instanceof protobuf.Type) {
        if (wire !== 2) throw new Error('Invalid message wire type');
        const length = reader.uint32();
        const nestedEnd = reader.pos + length;
        if (nestedEnd > end) throw new Error('Truncated Substrait message');
        scan(field.resolvedType, nestedEnd, depth + 1);
      } else {
        const scalarWire = field.type === 'string' || field.type === 'bytes' ? 2
          : ['double', 'fixed64', 'sfixed64'].includes(field.type) ? 1
          : ['float', 'fixed32', 'sfixed32'].includes(field.type) ? 5 : 0;
        const packed = field.repeated && scalarWire !== 2 && wire === 2;
        if (wire !== scalarWire && !packed) throw new Error('Invalid scalar wire type');
        reader.skipType(wire);
      }
      if (reader.pos > end) throw new Error('Invalid Substrait message length');
    }
  }
  scan(planType, bytes.length, 0);
}
