import json
import unittest
import urllib.error
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from medication_core import DueOccurrence, validate_schedule
from medication_reminder import MedicationReminderApp
from sync_client import EncryptedSyncClient, SyncError, _NoRedirectHandler


TZ = ZoneInfo("Europe/London")


def _sample_schedule() -> dict:
    return validate_schedule(
        {
            "timezone": "Europe/London",
            "events": [
                {
                    "id": "morning",
                    "enabled": True,
                    "time": "07:00",
                    "label": "Morning",
                    "medicines": ["Med"],
                    "instructions": "",
                    "days": ["daily"],
                    "start_date": None,
                    "end_date": None,
                }
            ],
        }
    )


class PairingTests(unittest.TestCase):
    def test_encrypted_pairing_payload_round_trips_schedule(self) -> None:
        schedule = validate_schedule(
            json.loads(Path("medication_schedule.json").read_text(encoding="utf-8"))
        )
        key = "A" * 43
        payload = EncryptedSyncClient._encrypt(schedule, key)
        restored = EncryptedSyncClient._decrypt(payload, key)
        self.assertEqual(restored, schedule)
        self.assertNotIn("Envarsus", payload["ciphertext"])

    def test_pairing_link_uses_fragment_and_contains_no_schedule(self) -> None:
        credentials = {"pairId": "p" * 32, "token": "t" * 43, "encryptionKey": "k" * 43}
        link = EncryptedSyncClient.pairing_link(credentials)
        self.assertIn("/#pair=", link)
        self.assertNotIn("?pair=", link)
        self.assertNotIn("medicines", link)


class SyncResponseHardeningTests(unittest.TestCase):
    """H1(a): a malformed relay response surfaces as a handled SyncError."""

    KEY = "A" * 43

    def _client(self, payload):
        client = EncryptedSyncClient()
        client._request = lambda *args, **kwargs: payload
        return client

    def _credentials(self):
        return {"pairId": "p", "token": "t", "encryptionKey": self.KEY, "deviceId": "d", "revision": 1}

    def test_fetch_malformed_response_raises_syncerror(self):
        enc = EncryptedSyncClient._encrypt(_sample_schedule(), self.KEY)
        creds = self._credentials()
        for payload in (
            {**enc, "updatedBy": "m"},          # revision missing
            {**enc, "revision": "NaN", "updatedBy": "m"},  # revision not numeric
            {**enc, "revision": 2},             # updatedBy missing
            ["not", "a", "dict"],               # not an object at all
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(SyncError):
                    self._client(payload).fetch(creds)

    def test_update_malformed_response_raises_syncerror(self):
        creds = self._credentials()
        for payload in ({"revision": "not-int"}, {}, ["nope"]):
            with self.subTest(payload=payload):
                with self.assertRaises(SyncError):
                    self._client(payload).update(_sample_schedule(), creds, 1)


class RedirectHardeningTests(unittest.TestCase):
    """L8: the opener refuses redirects so the Bearer token cannot leak."""

    def test_opener_refuses_redirects(self):
        handler = _NoRedirectHandler()

        class FakeReq:
            full_url = "https://api.example/pair"

        with self.assertRaises(urllib.error.HTTPError):
            handler.redirect_request(FakeReq(), None, 302, "Found", {}, "https://evil.example/")


class SyncWedgeTests(unittest.TestCase):
    """H1(b): a failure always resets sync_in_progress so sync cannot wedge."""

    def test_sync_failed_resets_in_progress_flag(self):
        app = object.__new__(MedicationReminderApp)
        app.sync_in_progress = True
        app.sync_status_var = None
        app._sync_failed(SyncError("boom"), notify=False)
        self.assertFalse(app.sync_in_progress)


class ConflictGuardTests(unittest.TestCase):
    """M3: while a conflict dialog is open, periodic sync must not restart."""

    def test_start_sync_blocked_during_conflict(self):
        app = object.__new__(MedicationReminderApp)
        app.sync_credentials = {"pairId": "p", "deviceId": "d", "revision": 1}
        app.sync_in_progress = False
        app.conflict_pending = True
        app.sync_status_var = None
        fetched = []

        class FakeClient:
            def fetch(self, credentials):
                fetched.append(credentials)

        app.sync_client = FakeClient()
        app._start_sync()
        self.assertFalse(app.sync_in_progress)  # guard returned before claiming the lock
        self.assertEqual(fetched, [])  # no worker spawned


class RepairTests(unittest.TestCase):
    """M1: re-pairing revokes the previous pair, best-effort."""

    def test_repair_revokes_previous_pair_then_creates(self):
        app = object.__new__(MedicationReminderApp)
        calls = {"revoke": [], "create": []}

        class FakeClient:
            def revoke(self, credentials):
                calls["revoke"].append(credentials)

            def create_pair(self, schedule, source_id):
                calls["create"].append(source_id)
                return {"pairId": "new", "sourceId": source_id}

        app.sync_client = FakeClient()
        old = {"pairId": "old", "token": "t"}
        result = app._perform_repair({"schedule": True}, "src-1", old)
        self.assertEqual(calls["revoke"], [old])
        self.assertEqual(calls["create"], ["src-1"])
        self.assertEqual(result["pairId"], "new")

    def test_repair_survives_revoke_failure(self):
        app = object.__new__(MedicationReminderApp)

        class FakeClient:
            def revoke(self, credentials):
                raise SyncError("already gone", 404)

            def create_pair(self, schedule, source_id):
                return {"pairId": "new"}

        app.sync_client = FakeClient()
        result = app._perform_repair({}, "src", {"pairId": "old"})
        self.assertEqual(result["pairId"], "new")

    def test_repair_without_previous_pair_skips_revoke(self):
        app = object.__new__(MedicationReminderApp)
        calls = {"revoke": 0}

        class FakeClient:
            def revoke(self, credentials):
                calls["revoke"] += 1

            def create_pair(self, schedule, source_id):
                return {"pairId": "new"}

        app.sync_client = FakeClient()
        app._perform_repair({}, "src", None)
        self.assertEqual(calls["revoke"], 0)


class SnoozeInvalidatedTests(unittest.TestCase):
    """L1: snoozing an occurrence a sync already invalidated just closes it."""

    def test_snooze_event_swallows_valueerror_and_closes(self):
        app = object.__new__(MedicationReminderApp)
        app.now = lambda: datetime(2026, 7, 22, 8, 0, tzinfo=TZ)

        class BoomScheduler:
            def snooze(self, key, now, minutes):
                raise ValueError("Only a pending reminder can be snoozed")

        app.scheduler = BoomScheduler()
        closed = []
        app._close_popup = lambda popup: closed.append(popup)
        occurrence = DueOccurrence(
            key="k", event_id="e", label="l", time_text="08:00",
            medicines=[], instructions="", scheduled_at=app.now(),
        )
        app.snooze_event(occurrence, "popup-sentinel")  # must not raise
        self.assertEqual(closed, ["popup-sentinel"])


class BackgroundLoopTests(unittest.TestCase):
    """H2: an exception in the periodic body must not stop future scheduling."""

    def test_check_schedule_reschedules_even_on_error(self):
        app = object.__new__(MedicationReminderApp)
        app.running = True
        app.active_popup = None
        app.now = lambda: datetime(2026, 7, 22, 8, 0, tzinfo=TZ)

        class BoomScheduler:
            pending_skip_notice = None

            def collect_due(self, now):
                raise RuntimeError("boom")

        app.scheduler = BoomScheduler()

        class FakeVar:
            def __init__(self):
                self.value = ""

            def set(self, value):
                self.value = value

        app.status_var = FakeVar()
        scheduled = []

        class FakeRoot:
            def after(self, milliseconds, callback):
                scheduled.append((milliseconds, callback))

        app.root = FakeRoot()
        app.check_schedule()
        self.assertTrue(any(callback == app.check_schedule for _ms, callback in scheduled))
        self.assertIn("background task failed", app.status_var.value)


if __name__ == "__main__":
    unittest.main()
