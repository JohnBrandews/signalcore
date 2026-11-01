# SQLite development to Neon PostgreSQL

Use SQLite throughout development. Before the first Neon deployment, switch the Prisma provider and establish a new PostgreSQL migration history; SQLite migrations are not portable.

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`. Keep `DATABASE_URL` for the pooled Neon connection and add `directUrl = env("DIRECT_URL")` to the datasource for migrations. Both values should be Neon connection strings; use Neon's pooled URL for `DATABASE_URL` and direct/unpooled URL for `DIRECT_URL`.
2. Back up any development-only records you need. Delete `prisma/migrations/` (the SQLite migration history), then generate the PostgreSQL baseline with `npm.cmd run db:migrate -- --name init` after setting the Neon URLs. Review the generated baseline before deploying. Do not point `prisma migrate deploy` at the SQLite database.
3. Update `.env` locally and Vercel project environment variables with `DATABASE_URL` and `DIRECT_URL`. Keep secrets out of source control. Regenerate the client and deploy migrations with `npm.cmd run db:generate` and `npx.cmd prisma migrate deploy` against Neon.
4. Reseed canonical data with `npm.cmd run seed`. Admin-entered records are not part of the CSV seed and must be exported/imported separately if they need to be retained.
5. Run `npm.cmd run parity:db` for the database-versus-CSV parity check: Core CPI / DXY must report `n=46` and `71.7%` match; NFP / DXY must report `n=69` and `60.9%`; Core CPI / XAUUSD (n=46, 63.0%) is also compared between database and CSV. Compare the full computed reaction rows/stats from database prices and releases to the CSV-based figures. Verify the first USDJPY date remains `2019-01-02`, event `nfp-2026-10-02` remains `2026-10-02T13:30:00.000Z`, and all stored price dates match and release timestamps represent the same UTC instants as the CSV values.

SQLite stores `BiasSnapshot.drivers` as JSON text (`String`) and `ReleaseReaction.measure` / `BiasSnapshot.origin` as validated string values. This avoids provider-specific enum/JSON columns. If switching to native PostgreSQL types later, change `drivers String` to `drivers Json`, and change `measure String` and `origin String` to Prisma enums (`ReactionMeasure` with `pct`/`abs_pp`; `SnapshotOrigin` with `live`/`dev`/`backfill`). Regenerate a fresh Postgres baseline after those schema changes and update writes to pass parsed JSON values instead of `JSON.stringify`.

A snapshot is marked `live` only when both `VERCEL_ENV=production` and `FORWARD_TEST_ENABLED=true`. In every other environment it is `dev`. Keep the forward-test query filtered to `origin = "live"`; `dev` and `backfill` never count as forward-test evidence. Snapshot `releaseIds` stores the database Release IDs used for its score so late data entry can be identified.

Assumption: Vercel Hobby permits the configured daily cron route to run once per day. This plan limit has not been verified against the deployment account.



FRED ingestion inserts new symbol/date rows only. Existing values are never updated; a different received value is logged and the stored row is retained.
