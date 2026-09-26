# Local setup and verification

These are AI-maintained execution notes, not the candidate-authored submission README.

Requires GitHub access to this private repository, Node.js 22+ with npm, and Docker with Compose running. Commands below work in PowerShell; use `npm.cmd` if PowerShell blocks `npm.ps1`.

```powershell
git clone https://github.com/poweihuang0817/GoldenAnalytics.git
cd GoldenAnalytics
npm ci
docker compose up -d --wait
npm run check
npm test
npm run test:integration
npm run demo
```

To verify the window PR before merge, use `git clone --branch feat/window-extension --single-branch https://github.com/poweihuang0817/GoldenAnalytics.git` instead of the first command.

Compose starts the supplied `goldenbeers/golden-query-challenge:1.0` image. Ports 3306 and 5432 must be available. If an existing challenge container already occupies them, either use that running database for ordinary development or choose alternate ports for an isolated verification instance; do not start a second conflicting container. Compose includes the image's PostgreSQL socket healthcheck correction.

The local sample database defaults are built in: database/user/password `northwind`, PostgreSQL on localhost:5432, MySQL on localhost:3306. These are public sample-image credentials. For an alternate instance set `POSTGRES_URL` and `MYSQL_URL` to that instance before running tests or demo. Keep actual credentials out of Git and logs.

Unit tests compile without database access. Integration tests require both databases and fail if unavailable; they do not silently skip. Edge fixtures use temporary tables and do not change supplied Northwind rows. The demo prints generated SQL and parameter counts, sample-query results and the recent-orders-per-customer extension.

For a separate fresh database on this same machine, a current Compose version accepts a temporary override:

```yaml
services:
  databases:
    ports: !override
      - "127.0.0.1:13306:3306"
      - "127.0.0.1:15432:5432"
```

Pass `-p golden-check -f compose.yaml -f <override-file>` to `docker compose` for both `up -d --wait` and `down`. Point the application URLs at 15432/13306. This avoids interfering with the development database. Use the same project/override when stopping only that verification instance.

No CI workflow is included yet. The checkpoint is local verification, not a claim of GitHub CI status. Third-backend and demo-page setup will be documented in their own changes.
