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

## What watches it

A scheduled GitHub Actions workflow, `.github/workflows/cron-health.yml`, polls
`/api/health/cron` every 10 minutes and fails the run when it does not get a
`200`. A failed run emails the workflow's author and opens an assigned issue
labelled `cron-health`; the next healthy run closes it again, so an open issue
means "down right now" rather than "was down once".

The polling logic lives in `scripts/check-cron-health.sh` so it can be run by
hand, and it retries three times a minute apart — one slow tick should not raise
an incident, a sustained failure should.

Two deliberate choices here as well:

- **It runs on GitHub, not on Cloudflare.** A monitor sharing infrastructure
  with the thing it monitors goes quiet during exactly the outage it exists to
  report.
- **It polls the heartbeat rather than watching for errors.** An error-rate
  alert fires when the cron *throws*, but stays silent when the cron simply
  never runs — zero invocations produce zero errors. Polling a staleness
  endpoint catches both, which is the whole point of "absence of news is not
  health".

Costs nothing: the repository is public, so Actions minutes are free.

### Cloudflare Health Checks were not an option

Recorded so this is not re-derived. The path is blocked twice over:

- `bytesfx.com` is on the **Free** plan, which allows **zero** health checks
  (Free/Pro/Business/Enterprise = 0/10/50/1000).
- The automation API token gets `10000: Authentication error` on
  `/zones/{zone}/healthchecks`, on `/accounts/{id}/workers/observability/alerts`
  writes, and on `POST /alerting/v3/policies`. It can read alerting config; it
  cannot write any of it.

Upgrading the zone to Pro would unlock both Health Checks and the
`health_check_status_notification` alert type, which is already available on the
account. That is a spending decision, not a technical blocker.

### Verify it by making it fail

Reading the config back is not a check. There are two failures worth proving,
and they are separate:

**The endpoint really goes unhealthy, and the script really notices.** The cron
runs every minute, so it restores itself within 60s — use a single attempt:

```sh
cd worker && npx wrangler@4.114.0 d1 execute medication-reminder-push --remote \
  --command "UPDATE service_heartbeats SET last_ok_at = datetime('now','-30 minutes') WHERE name='cron'"
cd .. && CRON_HEALTH_ATTEMPTS=1 bash scripts/check-cron-health.sh   # expect HTTP 503, exit 1
```

**The alert actually reaches a human.** Run the workflow with the `fire_drill`
input set, which fails the run on purpose without touching production:

```sh
gh workflow run cron-health.yml -f fire_drill=true
```

Then confirm the email landed and an issue was assigned to you. An alert nobody
has seen fire is not an alert.

**Status: verified end to end on 2026-08-09.** Both halves have actually been
run, not read back from config:

- Backdating the heartbeat produced a real `HTTP 503` from the live endpoint and
  the script exited 1; the next cron tick restored it and it exited 0.
- The fire drill (run `31288646472`) failed the run, the *Raise an incident* step
  succeeded and opened issue #6 assigned to the owner, *Clear the incident* was
  correctly skipped, and **the failure email arrived**.

Before running a drill, check `github.com/settings/notifications` — under
*Actions*, email delivery must be on, or a failing run notifies nobody and the
assigned issue is the only channel. Knowing that setting beforehand is what
makes a silent drill interpretable rather than ambiguous. Note that the account's
notification email is not necessarily the address on the Cloudflare alerts.

Note that GitHub disables scheduled workflows in a repository with no activity
for 60 days, and delays or drops scheduled runs under load — treat detection
latency as 10–30 minutes rather than exactly 10.

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
