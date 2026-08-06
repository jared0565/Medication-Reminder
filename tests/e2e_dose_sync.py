"""Disposable production smoke test for DOSE-state sync across two devices.

This replaces the retired `e2e_sync.py`, which predated dose state and could no
longer run at all: the relay rejects anonymous pair creation with 401. Its push
CORS assertions were carried over here (step 6) so nothing was lost.

The script reproduces the originally reported symptom directly — "when the meds
are marked taken or missed, the state is not reflected in all devices" — by
driving two independent clients against the live relay through one disposable
pair, which is always revoked.

It uses a synthetic schedule, never the operator's own `medication_schedule.json`.

Run from the repository root:  python tests/e2e_dose_sync.py

Anonymous pair creation is no longer accepted by the relay (`POST /sync/pairs`
requires an authorized account), so this drives the same OAuth 2.0 device
authorization grant the widget uses: it prints a user code, you approve it once
in a signed-in browser, and the run proceeds. Set MEDICATION_DEVICE_CREDENTIAL
to an existing `mdk_...` credential to skip the prompt. A credential obtained by
this script is revoked when it finishes; one supplied through the environment is
left alone, because it is not ours to revoke.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medication_core import merge_dose_maps, validate_schedule
from sync_client import EncryptedSyncClient

TODAY = "2026-08-05"
MORNING = f"{TODAY}|morning"
EVENING = f"{TODAY}|evening"


def synthetic_schedule() -> dict:
    def event(identifier: str, at: str, label: str) -> dict:
        return {
            "id": identifier, "enabled": True, "time": at, "label": label,
            "medicines": ["Example medicine"], "instructions": "Take as directed.",
            "days": ["daily"], "start_date": None, "end_date": None,
        }

    return validate_schedule({
        "timezone": "Europe/London",
        "events": [event("morning", "07:00", "Morning medicines"),
                   event("evening", "19:00", "Evening medicines")],
    })


def stamp(offset_seconds: int = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)).isoformat()


def check(condition: bool, description: str) -> None:
    if not condition:
        raise AssertionError(f"FAILED: {description}")
    print(f"  pass  {description}")


def obtain_credential(client: EncryptedSyncClient) -> tuple[str, bool]:
    """Return (device_credential, ours). `ours` marks a credential this run created,
    which is the only kind we may revoke."""
    supplied = os.environ.get("MEDICATION_DEVICE_CREDENTIAL", "").strip()
    if supplied:
        if not supplied.startswith("mdk_"):
            raise SystemExit("MEDICATION_DEVICE_CREDENTIAL must be an mdk_... device credential.")
        print("Using the device credential supplied through the environment.")
        return supplied, False

    grant = client.start_device_authorization("Dose sync E2E")
    print("\n" + "=" * 68)
    print("  Approve this run in a signed-in browser:")
    print(f"    {grant.get('verificationUriComplete') or grant.get('verificationUri')}")
    print(f"  User code: {grant['userCode']}")
    print("=" * 68 + "\n")

    # Let the relay's own expiry govern; a short local cap only ever times out a
    # run the server would still have accepted. Bounded so a hung poll cannot idle
    # forever if the relay reports an implausible expiry.
    deadline = time.monotonic() + min(int(grant.get("expiresIn", 600)), 900)
    interval = float(grant.get("interval", 5) or 5)
    while time.monotonic() < deadline:
        time.sleep(interval)
        result = client.poll_device_authorization(grant["deviceCode"])
        status = result["status"]
        if status == "complete":
            print("Approved.")
            return result["credential"], True
        if status == "slow_down":
            interval += 2
            continue
        if status != "pending":
            raise SystemExit(f"Device authorization {status}; cannot run the E2E.")
        print("  waiting for approval...")
    raise SystemExit("Device authorization timed out; cannot run the E2E.")


def check_push_cors(client: EncryptedSyncClient) -> None:
    """Ported from the retired e2e_sync.py, which could no longer run: the relay
    must accept a preflight from the production origin and refuse an unapproved
    one. Needs no pair, so it runs outside the disposable-pair lifecycle."""
    allowed = "https://medication.bytesfx.com"
    preflight = urllib.request.Request(
        f"{client.api_url}/subscriptions", method="OPTIONS",
        headers={"Origin": allowed, "Access-Control-Request-Method": "POST",
                 "User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(preflight, timeout=10) as response:
            check(response.status == 204
                  and response.headers.get("Access-Control-Allow-Origin") == allowed,
                  "the production origin is allowed through preflight")
    except urllib.error.HTTPError as exc:
        raise AssertionError(f"Production preflight failed ({exc.code})") from exc

    denied = urllib.request.Request(
        f"{client.api_url}/subscriptions", method="OPTIONS",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    try:
        urllib.request.urlopen(denied, timeout=10)
        raise AssertionError("An unapproved browser origin was incorrectly accepted")
    except urllib.error.HTTPError as exc:
        check(exc.code == 403, "an unapproved origin is refused")


def main() -> None:
    schedule = synthetic_schedule()
    # Two independent clients over one pair: device A is the widget, device B the phone.
    device_a = EncryptedSyncClient()
    device_b = EncryptedSyncClient()

    credential, ours = obtain_credential(device_a)
    credentials = device_a.create_account_pair(
        {"version": 2, "schedule": schedule, "doses": {}},
        secrets.token_urlsafe(24),
        credential,
    )
    b_credentials = dict(credentials)  # same pair, second device
    print(f"Disposable pair created: {credentials['pairId']}")

    try:
        print("\n1. B sees the schedule and no doses")
        remote = device_b.fetch(b_credentials)
        check(len(remote.schedule["events"]) == 2, "B receives both events")
        check(remote.doses == {}, "B starts with no dose state")

        print("\n2. A marks the morning dose taken -> B sees it  [the reported symptom]")
        taken_at = stamp()
        a_doses = {MORNING: {"taken_at": taken_at, "updated_at": taken_at}}
        revision = device_a.update(
            {"version": 2, "schedule": schedule, "doses": a_doses},
            credentials, remote.revision, dose_only=True,
        )
        check(revision == 2, "the dose-only push is accepted and bumps the revision")
        remote_b = device_b.fetch(b_credentials)
        check(MORNING in remote_b.doses, "B receives the morning dose")
        check(remote_b.doses[MORNING]["taken_at"] == taken_at, "B sees the exact taken_at")

        print("\n3. B marks the evening dose -> both survive (union, not last-writer-wins)")
        evening_at = stamp(1)
        b_doses = merge_dose_maps(
            {EVENING: {"taken_at": evening_at, "updated_at": evening_at}},
            remote_b.doses,
        )
        device_b.update(
            {"version": 2, "schedule": schedule, "doses": b_doses},
            b_credentials, remote_b.revision, dose_only=True,
        )
        remote_a = device_a.fetch(credentials)
        check(MORNING in remote_a.doses and EVENING in remote_a.doses,
              "A sees BOTH doses -- B's write did not clobber A's")
        check(remote_a.doses[MORNING]["taken_at"] == taken_at, "A's own mark is intact")

        print("\n4. A undoes the morning dose -> the tombstone propagates, evening survives")
        undo_at = stamp(2)
        undone = merge_dose_maps(
            {MORNING: {"taken_at": None, "updated_at": undo_at}},
            remote_a.doses,
        )
        device_a.update(
            {"version": 2, "schedule": schedule, "doses": undone},
            credentials, remote_a.revision, dose_only=True,
        )
        remote_b = device_b.fetch(b_credentials)
        check(remote_b.doses.get(MORNING, {}).get("taken_at") is None,
              "B sees the morning dose undone (tombstone, not resurrected)")
        check(remote_b.doses.get(EVENING, {}).get("taken_at") == evening_at,
              "the evening dose is untouched by the undo")

        print("\n5. A schedule edit does not erase dose state  [the F3 regression]")
        edited = json.loads(json.dumps(schedule))
        edited["events"][0]["time"] = "07:30"  # retime: the case that used to wipe doses
        device_a.update(
            {"version": 2, "schedule": edited, "doses": remote_b.doses},
            credentials, remote_b.revision,
        )
        remote_b = device_b.fetch(b_credentials)
        check(remote_b.schedule["events"][0]["time"] == "07:30", "B receives the retimed event")
        check(EVENING in remote_b.doses and remote_b.doses[EVENING]["taken_at"] == evening_at,
              "dose state survived the schedule edit")
        check(MORNING in remote_b.doses, "the undo tombstone also survived")

        print("\nDose-state E2E passed: cross-device delivery, per-occurrence merge, "
              "undo tombstones, and schedule-edit safety.")
    finally:
        try:
            device_a.revoke(credentials)
            print(f"Disposable pair revoked: {credentials['pairId']}")
        finally:
            # Only revoke a credential this run minted; an operator-supplied one
            # may be a real device's and revoking it would unpair them.
            if ours:
                device_a.revoke_device_credential(credential)
                print("Device credential revoked.")

    print("\n6. Push CORS boundary")
    check_push_cors(device_a)
    print("\nPush CORS passed: production origin allowed, unapproved origin denied.")


if __name__ == "__main__":
    main()
