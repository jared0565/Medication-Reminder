# Database operations

Production D1: `medication-reminder-push` (`2841c919-502b-4528-b872-db144d789ada`),
bound as `DB`, routed at `medication.bytesfx.com/api/*`.

Run every command below from `worker/`, and address the database **by name**, not
by binding — the binding can be repointed, the name cannot.

## Migrations

`wrangler d1 migrations apply` is now the correct way to change the schema.

```sh
cd worker
npx wrangler@4.114.0 d1 migrations create medication-reminder-push <description>
# edit the generated worker/migrations/000N_<description>.sql
npx wrangler@4.114.0 d1 migrations apply medication-reminder-push --local   # rehearse
npx wrangler@4.114.0 d1 migrations apply medication-reminder-push --remote  # ship
```

Check what is outstanding at any time with
`npx wrangler@4.114.0 d1 migrations list medication-reminder-push --remote`.

### The warning this replaces

Until 2026-08-08 the standing instruction was **never** to run
`d1 migrations apply` against production, and that instruction was correct.
Production had no `d1_migrations` table, so wrangler considered all four
existing migrations unapplied and would have replayed them against a database
where they were already in place:

- `0002` and `0003` are `ALTER TABLE ... ADD COLUMN`, which is not idempotent
  and fails on a duplicate column.
- `0004` performs `DROP TABLE sync_pairs` as part of a table rebuild.

In practice `0002` would abort the run first, but the ordering was the only
thing standing between a routine command and a dropped table.

### What was done

The tracker was adopted rather than the migrations re-run. Every migration was
first confirmed already present in the live schema:

| Migration | Verified by |
| --- | --- |
| `0002_google_accounts` | `sync_pairs.user_id` plus all five account tables |
| `0003_scoped_pairing_credentials` | all five `invitation_*` / `mobile_*` columns |
| `0004_scoped_source_id` | `idx_sync_pairs_user_source` exists and is UNIQUE |
| `0005_device_authorization` | `device_authorizations`, `device_credentials` |

The table DDL was taken from wrangler itself by running
`d1 migrations apply --local`, which creates `d1_migrations` before applying
anything — so the exact schema was learned with no production exposure. That
DDL plus four `INSERT`s of the filenames was then applied to production, which
is additive and touches no existing table.

`d1 migrations list --remote` now reports **No migrations to apply**, which is
the check that proves it: had the names or schema been wrong, the four would
still be listed.

**A migration's filename is its identity.** Renaming an applied migration file
makes wrangler treat it as new and re-run it. Do not rename them.

## Backups

### Point-in-time recovery

D1 provides Time Travel automatically — there is no backup job to schedule and
none should be added.

```sh
npx wrangler@4.114.0 d1 time-travel info medication-reminder-push
npx wrangler@4.114.0 d1 time-travel restore medication-reminder-push --bookmark <bookmark>
# or: --timestamp 2026-08-08T01:00:00Z
```

Take a bookmark **before** any risky change; that is the cheapest thing in this
document.

### Manual export

Useful before a destructive change, and as an off-platform copy:

```sh
npx wrangler@4.114.0 d1 export medication-reminder-push --remote --output <path>.sql
```

**Never write an export inside this repository.** The dump contains the account
email, device records, and the encrypted schedule blob. It is user data, and
this repo has a history of PHI reaching a public remote. Write exports to a path
outside the working tree — `F:\Projects\misc\` is what previous ones used.

Verify an export non-destructively by counting objects and row-insert
statements rather than reading it; the ciphertext length should match
`SELECT length(ciphertext) FROM sync_pairs`.

## Ad-hoc SQL

`d1 execute` remains available for reads and for one-off fixes:

```sh
npx wrangler@4.114.0 d1 execute medication-reminder-push --remote --command "SELECT ..."
```

Anything that changes the schema belongs in a migration instead, now that
migrations work.
