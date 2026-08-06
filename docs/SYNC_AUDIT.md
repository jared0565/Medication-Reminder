# Synchronization & reminder-delivery audit

**Date:** 2026-08-03 · **Branch:** `audit-remediation` · **Scope:** widget (`medication_reminder.py`,
`medication_core.py`, `sync_client.py`), web PWA (`web/`), relay (`worker/`).

Two symptoms were reported:

1. The widget's alarm does not fire while the app sits in the system tray.
2. Marking a dose taken (or missed) is not reflected on the other devices.

They have separate root causes. Symptom 1 is a defect with a small fix. Symptom 2 is not a
defect — dose state has no sync channel at all, on any of the three tiers. A third finding
connects them: the one thing that *does* sync actively erases dose state on both ends.

**Status: all four findings are addressed on this branch** — 77 new tests, suites green at
94 Python and 269 Node, both exit 0. F2 was built as **Option A** (dose state rides in the
existing encrypted payload); F4 was scoped down for the reason below.

---

## F1 — Critical: hiding the widget to the tray permanently wedges the reminder popup

> **FIXED on this branch.** The rest of this section describes the defect as found.

**Root cause.** `show_due_popup` marks the reminder window transient to the main window:

- `medication_reminder.py:480` — `popup.transient(self.root)`
- `medication_reminder.py:1290` — `hide_to_tray()` → `self.root.withdraw()`

Tk mirrors a master's window state onto its transients. With the root withdrawn (i.e. the app
is in the tray), the reminder popup is born **already withdrawn** and is never displayed.

**Evidence** — probe run on this machine (Windows 11, Tk via CPython), with a control Toplevel
that is identical except that it does *not* call `transient()`:

```
transient : state='withdrawn' ismapped=0
control   : state='normal'    ismapped=1
transient.focus_force() -> ok
transient.grab_set()    -> ok
after deiconify: transient state='normal' ismapped=1
winfo_exists: transient=1 control=1
```

The control is what makes this conclusive: `withdraw()` alone does not hide a child window —
`transient()` is the specific cause, so removing it is a validated fix and not a guess.

**Why it is permanent, not just one missed dose.** `self.active_popup = popup` is assigned at
`medication_reminder.py:474`, *before* the window is ever mapped. `check_schedule` gates on it:

```python
popup_open = self.active_popup is not None and self.active_popup.winfo_exists()   # :414
if not popup_open:
    due = self.scheduler.next_ready(now)
    if due:
        self.show_due_popup(due)
```

`winfo_exists()` returns 1 for a withdrawn window (see probe). `active_popup` is cleared only by
`_close_popup`, reachable only from the **Taken** / **Snooze** buttons on the invisible window. So:

| | sound | window |
|---|---|---|
| first dose after hiding to tray | plays (`play_alert_sound()` at `:469` runs first, on its own thread) | none |
| every dose after that | **silent** — `show_due_popup` is never called again | none |

The reminder loop keeps running and doses are *not* lost from `pending` — they resurface the
moment the user opens the window from the tray, because `deiconify()` re-maps the withdrawn
popup (last probe line). **Confirming signature: reminders suddenly appear, possibly stale, when
the app is opened from the tray.** `grab_set()`/`focus_force()` do not raise, so nothing is
logged and no error dialog appears — the failure is entirely silent.

**Fix — delete `popup.transient(self.root)` from `show_due_popup`.** Nothing else works. A second
probe tested the obvious alternatives and all of them still fail:

```
A  transient,             root withdrawn : state='withdrawn' mapped=0   <- the live bug
B  transient + deiconify, root withdrawn : state='withdrawn' mapped=0   <- deiconify() does NOT rescue it
C  no transient,          root withdrawn : state='normal'    mapped=1   <- works
D  transient + deiconify, root ICONIC    : state='withdrawn' mapped=0   <- minimize path, also broken
D2 no transient,          root iconic    : state='normal'    mapped=1   <- works
E  transient, popup opened while root visible, root withdrawn AFTER
                                          : state='withdrawn' mapped=0  <- follows the root down
E2 no transient, same sequence            : state='normal'    mapped=1   <- works
```

Three things this rules out:

- **`popup.deiconify()` after creation does not help** (B, D) — the mirroring re-applies.
- **A guard like `if self.root.state() != "withdrawn"` is insufficient.** The probe measured
  `root.state() == 'iconic'` when minimized, so the guard *passes* and `transient()` is still
  called — and the popup is still hidden (D). The main window keeps its minimize button
  (only `WM_DELETE_WINDOW` is remapped to `hide_to_tray`), so this path is reachable in normal use.
- **No creation-time guard can be sufficient anyway** (E): a popup opened while the window is
  visible is dragged into `withdrawn` when the user later closes to the tray, re-entering the same
  permanent wedge from the other direction.

The only configuration that survives all three sequences is not calling `transient()` at all.
`-topmost` + `lift()` (already present at `:481-482`) preserve stay-on-top; the only loss is
taskbar suppression, and a taskbar entry is arguably correct for an alarm that fires while the app
is in the tray.

**Also hardened** (defence in depth, not a substitute): `check_schedule` now **re-asserts** a
popup that exists but is not `winfo_ismapped()` — `deiconify()` + `lift()` — rather than treating
it as closed. Re-asserting was chosen over "treat as not-open" because the latter would destroy
and recreate the window every 15 seconds if it could not map, and would stack a fresh alarm on top
of one the user had merely minimised. Either way a future regression degrades to a visible retry
instead of a permanent silent wedge.

`open_schedule_editor` (`:640`) uses the same pattern but is only reachable from a visible main
window, so it is latent rather than live. **Regression tests added** (`TrayReminderPopupTests`,
4 tests driving real Tk windows): the popup must be mapped when the root is withdrawn, when it is
minimised, and when the user hides to tray *after* the alarm opens, plus the re-assert path.
Previously nothing covered this — `tests/test_pairing.py` only stubbed `active_popup = None`.

*Not verified:* `messagebox.*(parent=self.root)` calls (e.g. the conflict prompt in
`_resolve_conflict`) are parented to the same root and may be affected while it is withdrawn.
Native Windows dialogs often behave differently from Toplevels here; this needs its own probe
before any claim is made.

---

## F2 — Critical: dose state has no sync channel anywhere in the system

> **BUILT on this branch** (Option A — see "What F2 shipped" below). The rest of this section
> describes the gap as found.

Taken/missed state is local-only on every tier, by construction. This is an absent feature, not a
broken one: the README's "Pairing and sync protocol" section (`README.md:113`) specifies the
endpoint list and the auth headers only — it describes the transport, never the payload's
contents, and does not state that dose state syncs. So nothing was promised and left unbuilt.

**Widget.** Every sync payload passes through `validate_schedule` on both encrypt
(`sync_client.py:101`) and decrypt (`sync_client.py:109-110`). That function returns exactly
`{"timezone", "events"}` (`medication_core.py:154`) — any other key is silently dropped. Dose
state lives in `scheduler.state` (`pending`, `completed`, `snoozed_until`, `last_check_at`) and
is persisted only by `storage.save_state` to a local encrypted file. It is never transmitted.

**Web.** Dose state is `localStorage['medication-reminder-taken-v1']` (`web/app.js:8,32-33`).
The only surface `sync.js` reads is `window.getMedicationSchedule()` (`web/app.js:44`), which
returns the schedule alone.

**Relay.** `sync_pairs` carries exactly one payload pair — `ciphertext` + `iv` — plus `revision`
and `updated_by`. `worker/schema.sql` and all four migrations (`0002`–`0005`) contain no dose,
occurrence, or adherence table. There is no endpoint to carry it and nowhere to put it.

**Two further blockers for any future fix:**

- **Occurrence keys already diverge.** Widget: `YYYY-MM-DD|event_id|HH:MM`
  (`medication_core.py:172`). Web: `YYYY-MM-DD|event_id` (`web/app.js:29,35`). Even a naive blob
  merge would not line the two up. A unified key format is a prerequisite — and it should be the
  web's **`YYYY-MM-DD|event_id`**, i.e. the widget drops the time component. The scheduled time is
  always recoverable from the schedule, so it carries no information in the key; including it is
  precisely what makes F3's data loss possible, because a time edit changes the identity of an
  occurrence that is in fact the same dose. This is the same key change F3 recommends, so doing
  F3 first lands the format that F2 then builds on — no rework.
- **"Missed" is not a stored fact anywhere.** The web derives it from the clock
  (`e.time < current`, `web/app.js:29`); the widget has no missed concept at all — only Taken and
  Snooze. There is nothing to synchronize; it would have to be introduced.

### Design options (a decision, not a patch)

**Option A — extend the encrypted blob to `{schedule, doses}`. Recommended.**
One payload, one revision, no schema change, end-to-end encryption preserved. Requires: a payload
version bump; splitting `validate_schedule` into a `validate_sync_payload` wrapper that keeps the
strict schedule validation inside; unifying occurrence keys to `date|event_id|HH:MM` on both ends;
and **per-occurrence merge before PUT** — not whole-blob last-writer-wins, which would silently
discard one device's marks when two devices each mark a different dose. Dose merges must never
raise the existing conflict prompt; only schedule divergence should.
Cost: merge logic lives in two languages (Python + JS) and must stay in step.

**Option B — a `dose_state` table with its own endpoint and server-side merge.**
Cleaner conflict semantics, but the server cannot read encrypted occurrence keys, so it means
either giving up E2E for dose state or storing opaque hashed keys. Needs a new migration and
more surface area.

**Orthogonal recommendation:** *derive* missed rather than storing it — an occurrence is missed
when `now > scheduled_at + grace` and no taken record exists. Then only a single `taken` map needs
to sync, and there is no third state to reconcile.

---

## F3 — High: schedule sync destroys local dose state on both ends

> **FIXED on this branch.** The rest of this section describes the defect as found.

The one thing that does sync is the thing that erases the state that doesn't. Both sides break on
the same trigger — an event's **time** being edited on the other device.

**Widget.** `_apply_remote_schedule` (`:1189`) → `replace_schedule` → `_drop_invalid_pending`
(`medication_core.py:704`) → `resolve` (`:654`), which requires the event to still exist with the
**same id *and* the same time**, and to be `event_active`. So an incoming time change, a disable,
or a narrowing of `days` **silently deletes queued pending reminders** and their snooze entries.

**Web.** `clearPrematureTaken` (`web/app.js:28`) deletes any taken mark whose event time is now
later than the wall clock. A synced edit moving a dose from 08:00 to 20:00 wipes that morning's
"Taken" — the dose was genuinely taken, and the record is gone.

Fixable independently of F2, and worth doing first. Both breakages have the same origin: an
occurrence's identity is tied to the event's *time*, so editing the time makes the app treat an
already-handled dose as a different one. Key retained state on **`date|event_id`** only — dropping
the `|HH:MM` suffix from the widget's `occurrence_key` (`medication_core.py:172`) and the
matching `candidate["time"] == time_text` condition in `resolve` (`:661`) — and delete
`clearPrematureTaken` (`web/app.js:28`) or narrow it to marks made before the dose was ever due.
This is also the unified key format F2 needs, so the work is not repeated.

---

## F4 — Medium: propagation latency, even once F2 is fixed

> **ADDRESSED on this branch**, though not as originally framed — see "What F4 shipped".

Both ends poll on a 60-second timer (widget `_periodic_sync` `:1071`; web `sync.js:1454`), and the
web only polls **while the tab is visible**. A backgrounded or closed PWA does not converge until
it is foregrounded. "Reflected on all devices" in any near-real-time sense needs push, not polling.
The existing push channel cannot help as built: it only fires client-precomputed reminder epochs
(~32, ~10 days) and cannot carry state (`web/app.js:48-51`).

---

## Recommended order

1. **F1** — ✅ **done.** `transient()` removed from the reminder popup, plus the re-assert guard.
2. **F3** — ✅ **done.** Occurrence identity is now `date|event_id` on both clients, legacy
   three-part state keys migrate on load, and `clearPrematureTaken` is gone.
3. **F2** — ✅ **done, Option A.** The encrypted payload is now
   `{version: 2, schedule, doses}`; dose state syncs both ways.
4. **F4** — ✅ **done, scoped down.** Push now drives convergence and the polls are tighter.

### What F4 shipped

**A silent push-triggered sync is not achievable here.** The subscription is created with
`userVisibleOnly: true` (`web/app.js`), which browsers enforce: a push that shows no notification
gets the browser's own "site updated in the background" message instead, and repeat offences cost
the push permission. So the original framing — "push a sync trigger invisibly" — was dropped
rather than approximated.

What replaced it:

- **Every push now makes the app converge first.** The service worker posts `SYNC_NOW` to open
  clients on any push, and `sync.js` syncs on receipt. This fixes a *correctness* bug, not just
  latency: a reminder push could otherwise alarm on the phone for a dose already taken on the PC.
- **Dose updates are silent when you are looking at the app, and notify when you are not.** The
  relay sends dose-only updates as `type: 'dose-update'`; the worker suppresses the notification
  when any client is `visible` (permitted, since Chrome does not impose its default notification
  while a window from the origin is visible) and shows it otherwise. A shared
  `tag: 'medication-dose-update'` makes successive updates replace rather than stack.
- **Polls tightened** as a fallback for when push is unavailable or permission was never granted:
  web 60s → 20s while visible, widget 60s → 30s (`PERIODIC_SYNC_SECONDS`).

Note this supersedes the earlier "the relay skips the notification" behaviour: dose updates now
send a push, and it is the *service worker* that decides whether to surface it.

**Release stamp bumped** to `2026.08.03.1` with cache `medication-reminder-web-v27`. Without it,
returning PWA users would keep serving the cached `app.js?v=20260723.17` and none of the F2/F4 web
work would reach them.

### What F2 shipped

The payload is `{version: 2, schedule: {...}, doses: {"2026-08-03|morning": {taken_at, updated_at}}}`.

- **`validate_sync_payload` / `validateSyncPayload`** wrap, and never loosen, the existing
  schedule validation — the same call still guards the decrypt boundary. The dose container is
  validated strictly (type, size cap of 2000), but one unusable *entry* is skipped rather than
  fatal, so a single malformed dose degrades the record instead of making the whole payload
  undecryptable and taking sync down.
- **Merge is per occurrence, never whole-map.** Two devices marking different doses both survive.
  For one occurrence the later `updated_at` wins; an exact tie keeps the recorded take, because
  re-alarming a dose the user believes they took risks a double dose.
- **An undo writes a tombstone** (`taken_at: null`) rather than deleting the key — otherwise the
  other device simply resurrects the take on the next sync.
- **Dose divergence never prompts, and no push route can overwrite it.** This needed two changes
  beyond the payload itself, both of which were missing on the first pass and would have caused
  real data loss:
  - Conflict detection was purely revision-based, and a take now sets `dirty` — so two devices
    each marking a *different* dose was reported as *"Schedule changes were made on both
    devices."* Divergence is now discriminated on the **schedule half**: an identical schedule
    with a bumped revision is dose-only, and merges silently.
  - Every push now merges `remote.doses` immediately before the PUT. Previously the push paths
    (including the keep-local branch of a conflict) published local state that had never seen the
    remote doses, overwriting them — the phone's morning dose lost to the PC's evening one.
- **A take during an in-flight sync is no longer dropped.** `_queue_dose_push` bumps a
  **separate** `dose_generation`; without any bump, `_start_sync` returned early on the busy flag
  and the in-flight `_finish_sync` then cleared `dirty`, discarding the take silently. The counter
  is separate because `sync_generation` also escalates a clean `"remote"` result into a conflict
  prompt — that guard protects a concurrent local *schedule* edit, and reusing it for doses would
  have reintroduced the false prompt this same change removes.
- **A clean device never echoes a remote change back.** The push branch deliberately does *not*
  fire on `remote_changed` alone: doing so bumps the revision, which the other device reads as a
  remote change, and the two PUT at each other every 60 seconds indefinitely. A clean device takes
  the `"current"` path, which carries the remote doses home without writing anything.
- **Backward compatible both ways.** A peer on an older build publishes a bare schedule object,
  which both clients still accept as "no doses"; existing local history (the widget's `completed`
  map, the PWA's numeric `taken` marks) is migrated forward on load rather than dropped.
- **Marking taken now queues a push** on both clients. Previously a take would sit on the device
  until some unrelated schedule edit happened to push it — which is the symptom F2 exists to fix.
- **A dose push no longer notifies the other device.** The relay sends *"Schedule updated"* to the
  paired phone on **every** non-mobile PUT (`worker/src/index.js:735`). Since a take is now a PUT,
  F2 would otherwise have buzzed the phone on every single dose marked on the PC. Pushes that
  change only doses now carry `doseOnly: true` and the relay skips the notification. The flag is
  set only when the pending change was a dose mark *and* the local schedule already matches the
  server's, so a schedule edit can never go out silently; a schedule edit already queued keeps its
  notification even if a dose is marked afterwards. This needed the worker deployed to take
  effect — an older relay ignores the field and simply behaves as it does today. **The worker
  is deployed as of 2026-08-03**, so the flag is honoured; see "Deployment state".

### What changed for F1 and F3

| File | Change |
| --- | --- |
| `medication_reminder.py` | `show_due_popup` no longer calls `transient()`; `check_schedule` re-asserts an existing-but-unmapped popup instead of treating it as open. |
| `medication_core.py` | `occurrence_key` drops the `\|HH:MM` component; `resolve` matches on event id alone and reports the event's current time; new `migrate_occurrence_key`; `normalize_state` migrates and dedupes legacy keys across `pending`, `completed`, and `snoozed_until`, with an explicit collision tie-break (earliest take wins for `completed`, longest snooze wins for `snoozed_until`) so a one-time upgrade never picks an arbitrary survivor for a medication record. |
| `web/app.js` | `clearPrematureTaken` removed along with its call in `renderToday`. |
| `tests/test_pairing.py` | `TrayReminderPopupTests` — real Tk windows covering the tray, minimize, hide-after-open, and re-assert paths. |
| `tests/test_medication_core.py` | `SyncedTimeChangeTests` and `LegacyStateKeyTests`. |
| `tests/test_web_dose_state.mjs` | New: runs `web/app.js` in a stub DOM with a fixed clock and asserts a taken dose survives a synced retime. |

Two behaviour changes worth knowing about, both intended:

- **One dose per event per day.** Retiming an event mid-day no longer creates a second occurrence,
  because the day+event identity is unchanged. Previously `07:00 → 20:00` would queue a fresh
  reminder even if the morning dose had been taken.
- **The reminder popup now gets its own taskbar button** (the only thing `transient()` provided
  that `-topmost` + `lift()` do not).

## Verification status

- F1: **verified by running** two isolated Tk probes on this machine — one reproducing the bug
  against a no-`transient()` control, one testing each candidate fix across the withdrawn,
  minimized, and hide-after-open sequences. The recommended fix is the only one that passed all
  three; `deiconify()` and a `state()`-based guard were tested and rejected on measured results.
  The fix is now **covered by four tests driving real Tk windows**, each watched failing first.
- F3 fix: **verified by running** new Python and Node tests, each watched failing first for the
  expected reason.
- F2 fix: **verified by running** new tests at every layer — pure merge/validation functions, the
  engine, the widget, the encrypted transport, the PWA, and one end-to-end test that crosses the
  real AES-GCM wire. Some of these passed on first run rather than being watched fail (the initial
  red was an ImportError, which proves nothing), so their falsifiability was established
  separately: **32 deliberate mutations** of the implementation were run against the suite and
  **all 32 were caught**. Five real holes were found this way and closed:
  - Nothing exercised `sync.js`'s own payload validation, so a validator that silently dropped
    dose state on the wire would have shipped green.
  - Nothing exercised the push/conflict decision itself, which hid both defects described under
    "What F2 shipped" — the false conflict prompt and the overwriting push.
  - Nothing checked that `_finish_sync` actually honours the mid-sync take guard, only that the
    counter moved.
  - Nothing checked that a dose mark tags its change signal, so the notification suppression
    could have silently stopped working.
  One mutation pass also exposed a **broken test rather than a broken implementation**: the web
  harness's `CustomEvent` stub dropped its `detail`, so two assertions were failing
  unconditionally and their "caught" result was meaningless. A mutation is only evidence when the
  unmutated suite is green — that baseline was re-checked before accepting the result.
- Two pre-existing conflict tests were passing on a fixture that never created the condition they
  named: `encryptedRemote` encrypted an **empty** schedule, identical to the harness's local one,
  so "remote revision change surfaces a conflict" only ever bumped a revision. The fixtures now
  supply a genuinely divergent schedule, so those assertions test what their names claim.
- Final suites: `pytest tests/` **93 passed** (exit 0), `node --test "tests/*.mjs"` **263 passed**
  (exit 0). Exit codes read directly, not through a pipe.

## PHI history purge — and a verification mistake worth recording

A real personal regimen — 8 drug names, 7 dosages, 6 dose times — was in this repo's git
history. It has been removed from **local** history and verified; the GitHub remote is
untouched and still exposed at the time of writing.

The condition it implied is deliberately not named here. A second pass on 2026-08-06 found
that the clinical context had survived the first purge in two places the original denylist
never covered: a hospital name in historical `README.md` blobs, and — worse — the very
denylist added to guard the widget package, which listed every drug in plain text in a file
bound for a public repo. Both are now redacted from history, and the package guard stores
SHA-256 hashes instead of literals. The general lesson: **a denylist is a disclosure**, and
prose describing an incident leaks the same facts the data did.

**The mistake:** the first pass verified with a *plaintext* scan over every git object and
reported clean. It was not. `Medication_Reminder_Widget_Windows_v2.zip` was also in history, and
a zip is DEFLATE-compressed — the drug names never appear as searchable text inside it. The
plaintext scan had been adequate against the *original* (where the same data also existed
uncompressed, so it did produce hits) and only became inadequate *after* the rewrite redacted
those plaintext copies and left the archive as the sole carrier. A passing scan and a
false-passing scan were indistinguishable, which is exactly the condition that makes a check
worthless.

**What found it:** the project memory file recorded that the zip carried the regimen. Not the scan.

**The fix:** history rewritten again, this time dropping the zip entirely
(`--path … --invert-paths`), and verification replaced with an **archive-aware** scan that
decompresses any blob starting with `PK` before searching. Current local state: 1099 blobs,
**0 archives, 0 drug names, 0 dosages**. A file-extension inventory of history confirms the zip
was the *only* binary carrier — every other blob is text, which the original scan did cover.
`*.zip` is now gitignored so a packaged build cannot reintroduce it.

**Still exposed:** the on-disk `Medication_Reminder_Widget_Windows_v2.zip` (untracked) still
contains the regimen, and so does the backup bundle in the session scratchpad — both intentional,
both local only.

## Deployment state (2026-08-03)

**Worker: deployed.** Version `d991e9a6-b69d-4d85-83af-060afddc88e2`, live at 100%.
Verified by before/after marker diff of the deployed bundle — `doseOnly` 0 → 1, `dose-update`
0 → 2, while `auth/device/start` and `device_credentials` stayed at 1 and 5, so nothing was
reverted. `/api/health` returns ok on both the custom domain and workers.dev.

**Rollback target: `09c821d6-b2b6-4230-89b8-9d661964b19d`** (deployed 2026-07-24T14:16:53Z) —
the version immediately prior. Roll back with
`wrangler versions deploy 09c821d6-b2b6-4230-89b8-9d661964b19d@100%`.

> **Process deviation, stated plainly:** this Worker deploy did **not** follow the release runbook
> in `README.md` §"Deployment order and verification". A `--dry-run` and the post-deploy health
> check were run, and the change needs no migration or schema change, but the runbook's rollback
> capture, D1 account-bearer preflight and provenance/attestation assertions were skipped. The
> rollback target above is recorded after the fact to close the most material of those gaps.

**Pages (web): deployed 2026-08-05.** Deployment `187aca1a`, production, from commit
`b5f6ee4` via the pinned local Wrangler 4.114.0. `medication.bytesfx.com` now serves
`2026.08.03.1`.

**Pages rollback target: `05534924-1970-4709-a9d7-d2aff9a7b499`** (Production, source
`c51e8e5`). Note `c51e8e5` is a *pre-history-rewrite* SHA: once the GitHub repo is
recreated that commit no longer exists, so the deployment's recorded commit link dangles.
The deployment itself stays rollback-able — Pages retains the built artifact.

Verified after deploy, each check paired with the signal that would have meant failure,
plus a deliberately-false control to prove the checks can fail at all:

| Check | Pass condition | Failure signal |
| --- | --- | --- |
| `/version.json` | `2026.08.03.1` | still `2026.07.23.17` |
| `/app.js?v=20260803.1` | 200 and contains `mergeDoseMaps` | 404, or old bundle |
| `/sw.js` | contains `medication-reminder-web-v27` | still `v26` |
| `/sw.js` | contains `SYNC_NOW` | F4 push-convergence handler absent |
| `/sw.js` | precaches `app.js?v=20260803.1` | ASSETS still on the old stamp |
| `/sync.js?v=20260803.1` | contains `validateSyncPayload` | old sync.js |
| `/api/health` | `{"ok":true}` | worker unhealthy |
| control | `/version.json` contains `1999.01.01.0` — **must fail** | if it passed, the checks prove nothing |

All seven passed; the control failed as required.

> **Runbook substitution, stated plainly:** the release runbook in `README.md` sits under
> §"Database migration 0003" and its ceremony (D1 export, SHA-256 inventory attestation,
> 24-hour expiry, account-bearer preflight) exists to make a *schema mutation* reversible.
> This deploy mutates no data and applies no migration, so that ceremony was deliberately
> not run. The one property it establishes that *does* transfer — that the artifact is the
> reviewed commit and not the working tree — was established directly instead: `git status`
> and `git diff HEAD` over `web/` were both empty, so `web/` was byte-identical to `b5f6ee4`,
> which is what the runbook's `git archive` + manifest-hash comparison exists to prove.
> Worker health was checked before Pages, per the runbook's ordering. One genuine deviation:
> an earlier read-only `pages deployment list` used `npx wrangler@4.114.0`, an implicit
> package download the runbook forbids; the deploy itself used the pinned local binary.

**Widget package rebuilt (2026-08-05).** `Medication_Reminder_Widget_Windows_v3.zip`, built
from commit `4247b7e` by `packaging/build_widget_package.ps1`. The distributed v2 package
predated the sync work entirely — it shipped neither `medication_core.py` nor
`sync_client.py`, so anyone installing from it could not receive the F1 tray-alarm fix or
F2 dose sync however many times the relay converged. v2 also carried the real regimen in
`medication_schedule.json`, and its README named a hospital and a drug; it has been deleted.
The build reads every file from the git object store rather than the working tree, and scans
the staged plaintext *before* compression — verified by a control build from a poisoned
commit, which failed closed and produced no archive.

## Not covered

- **F4 (latency).** Addressed as far as `userVisibleOnly` allows: every push posts `SYNC_NOW`,
  dose updates stay silent while a client is visible, polls tightened to 20s web / 30s widget.
  Silent background push remains impossible; convergence while nothing is open is still
  poll-bound.
- **The worker's `doseOnly` guard has no worker-level test.** It is a three-line change in
  `worker/src/index.js`, and the existing worker harness has no coverage of the notification
  path. It is covered only from the client side — that the flag is sent, and only when it
  should be. The worker is now deployed, so the guard is live but runtime-unexercised.
- ~~**No runtime test against the live relay.**~~ **Closed 2026-08-06.**
  `tests/e2e_dose_sync.py` ran green against the deployed relay — 13 assertions over a
  disposable account pair, covering the reported symptom directly: a dose marked on device A
  arrives on device B with the exact `taken_at`; two devices union rather than clobber; an
  undo propagates as a tombstone without resurrecting; and a retiming schedule edit leaves
  dose state intact. Cleanup verified independently afterwards by querying D1 — 0 leftover
  pairs — rather than trusting the script's own log. **This is the first observation, as
  opposed to inference, that the originally reported bug is fixed.**

  Two things established on the way there:
  - **`tests/e2e_sync.py` was unrunnable, and has been removed.** Against the deployed relay
    it failed with `401 Sign-in required` at `create_pair`: anonymous pair creation was removed
    by the account-boundary work (`worker/src/index.js:404` requires an authorized account). It
    would also have `IndexError`ed on `events[0]`, since the tracked schedule is now the empty
    seed. It covered schedule sync, exclusive claim and CORS — never doses. Its push CORS
    assertions were ported into `e2e_dose_sync.py` (step 6) before it was deleted.
  - **`tests/e2e_dose_sync.py` (new) covers the reported symptom.** It authenticates through
    the same device-authorization grant the widget uses, so running it costs **one browser
    approval**. Its assertions were proven self-consistent offline against
    `validate_sync_payload` before it was ever run, so a failure in a real run indicts the
    system rather than the test.

    Run it with: `python tests/e2e_dose_sync.py` (or set `MEDICATION_DEVICE_CREDENTIAL`).
    **The approve page requires an already signed-in browser session** — opening
    `/link?code=…` cold fails silently and the poll just spins on `pending`. Sign in with
    Google at `https://medication.bytesfx.com` first, then open the link.
- **`messagebox` while the root is withdrawn** (noted under F1) is still unverified.
- **The rebuilt widget package has not been installed or launched.** `v3` is verified only by
  archive-aware content scan and by matching the reviewed commit; it has not been run on a
  clean machine, so its dependency bootstrap and EXE build path are unexercised.
- F2: the original *absence* was **verified by reading** `validate_schedule`, both clients'
  storage paths, and the full worker schema plus all four migrations — structural, not a
  search miss. The *fix* is now **verified at runtime** by `e2e_dose_sync.py` against the
  deployed relay.
- F3: the fix is **verified at runtime** — step 5 of `e2e_dose_sync.py` retimes an event and
  asserts dose state survives, which is precisely the case that used to wipe it.
- F1, F4: **verified by reading** the cited lines and by probe, not reproduced at runtime.
  F1 in particular is still unproven against a real tray session — see the widget item above.
