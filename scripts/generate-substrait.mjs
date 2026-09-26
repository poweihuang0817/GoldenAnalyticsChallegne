import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pbjs = require('protobufjs-cli/pbjs');
const pbts = require('protobufjs-cli/pbts');
mkdirSync('src/generated', { recursive: true });
function run(tool, args) {
  return new Promise((resolve, reject) => tool.main(args, error => error ? reject(error) : resolve()));
}
await run(pbjs, ['-t', 'static-module', '-w', 'commonjs', '-p', 'vendor/substrait/proto',
  '-o', 'src/generated/substrait.cjs', 'vendor/substrait/proto/substrait/plan.proto']);
await run(pbts, ['-o', 'src/generated/substrait.d.cts', 'src/generated/substrait.cjs']);
await run(pbjs, ['-t', 'json', '-p', 'vendor/substrait/proto',
  '-o', 'src/generated/substrait-schema.json', 'vendor/substrait/proto/substrait/plan.proto']);
