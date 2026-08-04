# HBMS database migration runbook

## Health and pool deployment bounds

Configure explicit database resource limits in every environment:

```env
DB_POOL_SIZE=10
DB_POOL_QUEUE_LIMIT=50
DB_CONNECT_TIMEOUT_MS=5000
HEALTH_DB_PROBE_TIMEOUT_MS=1000
```

`/api/health/ready` uses a separate one-connection, non-queuing pool and returns
`503` when its deadline or concurrency gate is exceeded. Restrict this route at
the reverse proxy, load balancer, firewall or orchestrator so it is reachable
only by trusted health infrastructure where possible. Keep `/api/health/live`
available to the process supervisor because it does not query MySQL.

Use this runbook for staging and production. Never run a migration against an
unknown database name or without a restorable backup.

## 1. Preflight

1. Confirm the release commit and review every pending migration `up` and
   `down`.
2. Confirm `NODE_ENV`, `DB_HOST`, `DB_PORT`, `DB_DATABASE` and the database
   account. Do not print credentials into CI logs.
3. Run:

   ```text
   npm ci
   npm run build
   npm run migration:show
   npm run data:audit
   ```

4. Stop if the audit reports any violation, migration order is unexpected, or
   the target does not match the approved environment.
5. Estimate DDL lock duration from a production-like dataset. Use a maintenance
   window for table rebuilds, FK/check changes or large backfills.

## 2. Backup and restore proof

1. Create a transactionally consistent database backup or provider snapshot.
2. Record snapshot ID, database name, start/end time, encryption/retention and
   operator.
3. Restore that backup into an isolated environment and verify table counts plus
   a login/booking/payment smoke flow.
4. Do not proceed until the restore test succeeds.

The initial baseline migration is intentionally not reversible with
`migration:revert`; recovery for that boundary is backup restore.

## 3. Apply

1. Pause deploy workers/schedulers if the migration or backfill touches
   booking, payment, calendar, image or phone data.
2. Run exactly once:

   ```text
   npm run migration:run
   ```

3. Keep the command output and TypeORM migration table state with the release
   record. Do not run parallel migration jobs.

## 4. Verify

Run:

```text
npm run migration:show
npm run schema:check
npm run data:audit
npm run openapi:validate
```

Then verify health readiness and smoke-test authentication, room search,
booking creation and the enabled payment method. Monitor DB errors, slow
queries, scheduler summaries and stale refunds.

## 5. Rollback or restore

- Use `npm run migration:revert` only when the reviewed `down` is data-safe and
  the failed release has not written data that the old schema cannot represent.
- Revert one migration at a time, then run `migration:show` and `data:audit`.
- If a migration performs lossy conversion, drops data, crosses the initial
  baseline, or its `down` is unsafe, stop the application and restore the proven
  backup instead.
- Record the incident timeline, executed migration, backup/snapshot ID and
  verification results.

## 6. Controlled maintenance scripts

- `npm run phone:normalize:check` is dry-run.
- `npm run phone:normalize:run` locks/rechecks rows in a transaction and refuses
  production unless `--allow-production` is explicitly appended.
- `npm run seed:admin` is idempotent by email, refuses role mismatch and now
  refuses production unless `--allow-production` is explicitly appended.
- Never bypass collision, invalid-phone, concurrent-update or test-database
  safety checks.
