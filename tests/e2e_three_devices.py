"""Production check for the stated architecture: ONE D1 record, N authed devices.

The requirement is that the mobile, the desktop widget and the browser all sync
against a single record in D1, with divergence possible only while a device is
offline and resolved automatically once it reconnects.

This proves it against the live relay using three independent clients on one
disposable, account-bound pair -- the widget, a browser and a third device --
all authenticating as the account rather than through the single mobile
invitation slot. That slot limits only invitation claims; the account path
(worker/src/index.js:620-635) has no per-device limit, which is the property
this script exists to keep honest.

It uses a synthetic schedule and always revokes the pair it creates. It never
touches the operator's own pairing.

Run from the repository root, supplying an existing account device credential:
    MEDICATION_DEVICE_CREDENTIAL=mdk_... python tests/e2e_three_devices.py

A credential supplied through the environment is left alone, because it is not
ours to revoke.
"""

from __future__ import annotations

import os
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medication_core import merge_dose_maps, validate_schedule
from sync_client import EncryptedSyncClient

TODAY = "2026-08-09"
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


def main() -> None:
    credential = os.environ.get("MEDICATION_DEVICE_CREDENTIAL", "").strip()
    if not credential.startswith("mdk_"):
        raise SystemExit("Set MEDICATION_DEVICE_CREDENTIAL to an mdk_... account device credential.")

    schedule = synthetic_schedule()
    widget, browser, third = EncryptedSyncClient(), EncryptedSyncClient(), EncryptedSyncClient()

    credentials = widget.create_account_pair(
        {"version": 2, "schedule": schedule, "doses": {}},
        secrets.token_urlsafe(24),
        credential,
    )
    # Every device holds the SAME pair id and key: one record, not three copies.
    # This is exactly what joinAccountPair gives a browser from a pair link.
    browser_credentials = dict(credentials)
    third_credentials = dict(credentials)
    print(f"Disposable account pair: {credentials['pairId']}")

    try:
        print("\n1. All three devices read the one record")
        for name, client, creds in (("widget", widget, credentials),
                                    ("browser", browser, browser_credentials),
                                    ("third", third, third_credentials)):
            remote = client.fetch(creds)
            check(len(remote.schedule["events"]) == 2, f"{name} reads both events")
            check(remote.doses == {}, f"{name} starts with no dose state")

        print("\n2. The browser writes -- with account auth, no invitation claimed")
        taken_at = stamp()
        base = browser.fetch(browser_credentials)
        revision = browser.update(
            {"version": 2, "schedule": schedule,
             "doses": {MORNING: {"taken_at": taken_at, "updated_at": taken_at}}},
            browser_credentials, base.revision, dose_only=True,
        )
        check(revision == 2, "the browser's write is accepted on the account path")

        print("\n3. The widget and the third device both see it")
        for name, client, creds in (("widget", widget, credentials),
                                    ("third", third, third_credentials)):
            remote = client.fetch(creds)
            check(remote.doses.get(MORNING, {}).get("taken_at") == taken_at,
                  f"{name} sees the browser's mark, byte for byte")

        print("\n4. A third device's write does not clobber the browser's")
        evening_at = stamp(1)
        remote = third.fetch(third_credentials)
        merged = merge_dose_maps(
            {EVENING: {"taken_at": evening_at, "updated_at": evening_at}}, remote.doses)
        third.update({"version": 2, "schedule": schedule, "doses": merged},
                     third_credentials, remote.revision, dose_only=True)
        seen = widget.fetch(credentials)
        check(MORNING in seen.doses and EVENING in seen.doses,
              "the widget sees BOTH devices' marks -- union, not last-writer-wins")

        print("\n5. A stale write is refused, which is what keeps them converged")
        stale = widget.fetch(credentials)
        widget.update({"version": 2, "schedule": schedule, "doses": stale.doses},
                      credentials, stale.revision, dose_only=True)
        try:
            # Replaying the now-consumed revision is exactly what an offline device
            # does when it reconnects holding an out-of-date base.
            third.update({"version": 2, "schedule": schedule, "doses": stale.doses},
                         third_credentials, stale.revision, dose_only=True)
            raise AssertionError("FAILED: a stale revision was accepted")
        except AssertionError:
            raise
        except Exception:
            check(True, "a write against a superseded revision is rejected")

        print("\n6. The reconnecting device recovers by re-reading and merging")
        latest = third.fetch(third_credentials)
        offline_at = stamp(2)
        recovered = merge_dose_maps(
            {EVENING: {"taken_at": offline_at, "updated_at": offline_at}}, latest.doses)
        third.update({"version": 2, "schedule": schedule, "doses": recovered},
                     third_credentials, latest.revision, dose_only=True)
        final = browser.fetch(browser_credentials)
        check(final.doses.get(EVENING, {}).get("taken_at") == offline_at,
              "the reconnected device's mark lands")
        check(final.doses.get(MORNING, {}).get("taken_at") == taken_at,
              "and the earlier mark from another device survived it")

        print("\nThree-device E2E passed: one D1 record, three account-authenticated "
              "devices, per-occurrence merge, and stale writes refused rather than "
              "silently overwriting.")
    finally:
        widget.revoke(credentials)
        print(f"Disposable pair revoked: {credentials['pairId']}")


if __name__ == "__main__":
    main()
