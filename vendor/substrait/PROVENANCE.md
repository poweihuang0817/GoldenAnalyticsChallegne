# Substrait schema provenance

Upstream: https://github.com/substrait-io/substrait

Release: v0.63.0

Pinned revision: `6d481e1b27dc9f580aaf9fdad32a4cd98de98e32`

The `proto/substrait/` files and `LICENSE` are unmodified upstream files retrieved at that revision. The upstream release has no root NOTICE file. Substrait schema sources are Apache-2.0 licensed; see `LICENSE`.

Run `npm run generate:substrait` to regenerate `src/generated/substrait.cjs`, its TypeScript declarations, and reflection metadata. Generation uses the locally vendored schemas and pinned `protobufjs-cli` dependency; it does not download a floating upstream version. Generated files are checked in so consumers can run without a code-generation step.

We use generated bindings from the official schema, not a claim that `protobufjs` itself is an official Substrait package. Capability restrictions remain application code. A supported JSON profile plus successful wire round trips establishes compatibility for the exercised subset, not complete Substrait semantic conformance.

For a schema upgrade, review upstream changes, update the pinned revision and sources together, regenerate, inspect the supported profile, and rerun codec/compiler/database tests.
