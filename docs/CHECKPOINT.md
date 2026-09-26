# Local MVP checkpoint — September 26, 2026

Window extension code verified: `603accf627669157a2d5f6f64c8026e3259c3fca` on `feat/window-extension` (PR #13). Later documentation commits do not change executable code.

- Fresh remote clone, fresh `npm ci`, separate fresh Compose container using supplied image, alternate localhost ports 13306/15432.
- Node 24.19.0, npm 11.17.0, Docker Compose 5.5.1 on Windows.
- Type checking passed; **20 unit tests and 16 integration tests passed**.
- Driver completed six sample families and recent-N-orders-per-customer extension on PostgreSQL/MySQL.
- Diff check and fresh clone status clean.
- Database image digest: `sha256:2b42448660486dfb7778e74854e5888064ae8a004bbf6895ca68f57a81d38e0e`.
- Independent source/spec review found no blocking extension issue. Tests include independent expected results and explicit edge fixtures.

Agent used an actual remote clone at `.worktrees/fresh-window-check`; the Docker image was already cached on the machine. This is fresh dependencies/data-container validation on the existing machine, not validation on every OS or GitHub CI. Only the isolated verification container/network was removed; the shared development database was untouched. Clone retained.

Merged main `8fe7d4a` was independently fresh-clone validated before the extension as well (17 unit / 11 integration tests). The extension PR remains subject to user review/merge. DuckDB and demo-page work require their own verification and are not included in this checkpoint claim.

See [setup commands](RUNNING.md) and [future production work](FUTURE-WORK.md). README/video/reviewer access/final release remain deferred by the user.
