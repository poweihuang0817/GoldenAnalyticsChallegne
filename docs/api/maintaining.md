# Maintaining TypeScript API documentation

[API guide](README.md)

## Documentation layers

1. **Source comments:** TSDoc-style descriptions beside exported functions and methods provide editor hover help. Focus on meaning, defaults, return behavior and restrictions; TypeScript signatures already carry parameter types.
2. **Reference:** [tables](tables.md), [expressions](expressions.md) and [execution](execution.md) describe the supported calling contract, including behavior that types alone cannot express.
3. **Learning material:** [tutorial](tutorial.md), [recipes](northwind.md) and [design](design.md) explain how and why to use the API. Keep these distinct from a catalog of methods.
4. **Executable examples:** [examples.ts](examples.ts) keeps representative Northwind queries type-checkable and compilable against the actual implementation.

This follows the useful separation between tutorials, how-to guides, reference and explanation described by [Diataxis](https://diataxis.fr/). The pages use ordinary Markdown, so reviewers can browse them directly in the private GitHub repository.

## TypeScript tools and the current choice

- [TSDoc](https://tsdoc.org/) defines conventions for documentation comments; it does not generate a website by itself. Use concise summaries and, where useful, `@param`, `@returns`, `@remarks` and `@example`. Mark implementation plumbing `@internal`.
- [TypeDoc](https://typedoc.org/documents/Overview.html) can generate API reference from TypeScript declarations and comments, including Markdown project documents. It is a sensible later option if generated navigation/search becomes useful. Verify compatibility with the repository's pinned TypeScript version before adopting a release.
- [API Extractor](https://api-extractor.com/) supports API surface analysis, review reports and declaration rollups. Consider it when publishing/versioning a supported package API. It is not necessary for this private take-home library.

The documentation uses source comments, authored reference pages and checked examples without introducing a documentation dependency, generated site, hosting requirement or TypeScript upgrade. Reference signatures are maintained manually; they are not claimed to be generated. Existing low-level profile documents remain linked for deeper protocol details.

## When changing the API

- Update source comments and the relevant reference page in the same PR as the behavior change.
- Keep documented defaults, nullable outputs and backend exceptions consistent with implementation/tests.
- Update representative executable examples when signatures or behavior change.
- Run `npm run check:docs` and `npm run docs:examples`. The latter compiles without contacting remote databases; success is not execution conformance.
- For changes affecting execution, run the existing integration/conformance suites and, when useful, `npm run docs:examples -- --execute` after seeding. Do not replace independent correctness tests with example smoke checks.
- Check local Markdown links and keep `docs/PUBLIC-API.md` as the stable entry-point redirect.

Examples use `.js` import specifiers in TypeScript because the repository uses ESM/NodeNext. Run them using the configured tsx loader/scripts. Their typecheck configuration includes the source tree and example file; the normal application/test typecheck remains separate.

The docs describe a prototype supported profile and do not establish a SemVer stability guarantee, a normalized error-code contract or a published npm package. Future generated docs should select intended entry points and exclude vendored/generated internals rather than exposing every export indiscriminately.
