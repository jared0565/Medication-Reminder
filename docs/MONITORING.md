# Monitoring

## What is monitored, and why that thing

For a medication reminder the failure that matters is **reminders stop being
delivered**, and it is silent: the app keeps working, sync keeps working, and
the first sign is somebody missing a dose.

`GET /api/health` cannot detect it. It proves the worker answers requests, and
`fetch` and `scheduled` fail independently — the worker can serve every request
perfectly while the cron throws on every run. That is not hypothetical; it is
exactly what was happening (see below).

So the cron records a heartbeat in `service_heartbeats` as the **last** thing it
does, and `GET /api/health/cron` reports on it:

| Condition | Response |
| --- | --- |
| Heartbeat within 600s | `200` `{ok: true, ageSeconds}` |
| Heartbeat older than 600s | `503` `{ok: false, ageSeconds}` |
| No heartbeat row at all | `503` `{ok: false, ageSeconds: null}` |
| Heartbeat unreadable | `503` `{ok: false, reason: "heartbeat_unreadable"}` |

Two deliberate choices:

- **The heartbeat is written last.** Stamped on entry it would stay fresh
  through a total delivery outage — a monitor reporting healthy during the
  failure it exists to catch.
- **`/api/health/cron` is separate from `/api/health`.** The app polls the
  latter, which must stay `200` while sync works; the monitor needs a non-2xx to
  trip. Folding them together would either alarm every user over an operations
  problem or never alert anyone.

A missing row counts as unhealthy. Absence of news is not health.

## Remaining setup (needs dashboard access)

The endpoint is live. The alert that watches it is **not yet configured** — the
API token available to automation can read alerting config but not write it, and
cannot reach zone-scoped endpoints at all. Do this once in the dashboard:

1. **Health check** — *bytesfx.com → Traffic → Health Checks → Create*
   - Address `medication.bytesfx.com`, type HTTPS, path `/api/health/cron`
   - Expected code `200`, interval 300s, retries 2
   - Consecutive fails 2 (so one slow tick does not page)
2. **Notification** — *Notifications → Add → Health Checks status notification*
   - Select the health check above, deliver to your email.

Verify it end to end by making it actually fail, not by reading the config:

```sh
npx wrangler@4.114.0 d1 execute medication-reminder-push --remote \
  --command "UPDATE service_heartbeats SET last_ok_at = datetime('now','-30 minutes') WHERE name='cron'"
curl -s -o /dev/null -w '%{http_code}\n' https://medication.bytesfx.com/api/health/cron   # expect 503
```

The next cron tick restores it by itself. An alert you have never seen fire is
not an alert.

## The outage this found on day one

Within minutes of deploying the heartbeat, it stayed empty. The cause:

```
D1_ERROR: no such column: last_sent_at
```

Production's `push_subscriptions` never gained `last_sent_at`, though
`schema.sql` declares it and the scheduled handler reads and writes it. **Every
cron run had been throwing, so no push reminder was ever delivered from the
server.** Fixed by migration `0007_push_last_sent_at`.

Two things made it invisible:

- Nothing watched the cron. The app looked healthy because it was.
- **The worker test fixture builds from `schema.sql`**, which has the column, so
  production drifting from `schema.sql` is unobservable to the test suite by
  construction. Green tests could never have caught this.

The second point is the durable lesson: schema drift between `schema.sql` and
production is a blind spot no amount of unit testing closes. Now that migrations
are tracked (see `DATABASE_OPERATIONS.md`), every schema change should go
through a migration so the two cannot diverge again.

## Logs

Observability is enabled at full sampling. Note that scheduled (cron)
invocations have no `outcome` field, which makes some tooling reject them when
querying mixed event types; filter to `$metadata.origin != fetch` and read the
raw telemetry response if a client refuses to parse them.
