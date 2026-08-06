import json
import tkinter as tk
from copy import deepcopy
import unittest
import urllib.error
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from medication_core import (
    DueOccurrence,
    ScheduleEngine,
    normalize_state,
    validate_schedule,
)
import medication_reminder
from medication_reminder import MedicationReminderApp
from sync_client import EncryptedSyncClient, RemoteSchedule, SyncError, _NoRedirectHandler


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
        # _decrypt now yields the full {version, schedule, doses} payload.
        self.assertEqual(restored["schedule"], schedule)

    def test_medication_names_never_appear_in_the_ciphertext(self) -> None:
        """The bundled seed is empty, so checking it for a leak proves nothing.
        Encrypt a schedule carrying a known sentinel and look for that instead."""
        sentinel = "ZZSENTINELMEDICATIONZZ"
        schedule = _sample_schedule()
        schedule["events"][0]["medicines"] = [sentinel]
        key = "A" * 43
        payload = EncryptedSyncClient._encrypt(schedule, key)
        self.assertNotIn(sentinel, payload["ciphertext"])
        self.assertNotIn(sentinel, payload["iv"])

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


class _FakeResponse:
    def __init__(self, status: int, body: dict) -> None:
        self.status = status
        self._raw = json.dumps(body).encode("utf-8")

    def read(self, _n: int = -1) -> bytes:
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


class _FakeOpener:
    """Stands in for the urllib opener: returns 2xx responses, raises HTTPError
    (carrying a JSON body) for 4xx/429 so poll-state parsing is exercised."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests = []

    def open(self, request, timeout=None):  # noqa: ANN001
        import io

        self.requests.append(request)
        status, body = self._responses.pop(0)
        raw = json.dumps(body).encode("utf-8")
        if 200 <= status < 300:
            return _FakeResponse(status, body)
        raise urllib.error.HTTPError(request.full_url, status, "error", {}, io.BytesIO(raw))


class DeviceAuthorizationTests(unittest.TestCase):
    """Authenticated device pairing: acquire a credential, then use it for
    account-scoped pairs without ever leaking the schedule or E2E key."""

    def _client(self, responses):
        client = EncryptedSyncClient(api_url="https://api.test")
        client._opener = _FakeOpener(responses)
        return client

    def test_start_requests_windows_device_and_returns_codes(self):
        client = self._client([(200, {
            "deviceCode": "mdc_" + "A" * 43, "userCode": "ABCD-EFGH",
            "verificationUri": "https://medication.bytesfx.com/link", "interval": 5, "expiresIn": 900,
        })])
        result = client.start_device_authorization("My PC")
        self.assertTrue(result["deviceCode"].startswith("mdc_"))
        self.assertEqual(result["userCode"], "ABCD-EFGH")
        sent = json.loads(client._opener.requests[0].data)
        self.assertEqual(sent["deviceType"], "windows")
        self.assertEqual(sent["deviceName"], "My PC")

    def test_poll_maps_each_state(self):
        self.assertEqual(self._client([(202, {"status": "pending"})]).poll_device_authorization("mdc_x")["status"], "pending")
        self.assertEqual(self._client([(429, {"status": "slow_down"})]).poll_device_authorization("mdc_x")["status"], "slow_down")
        self.assertEqual(self._client([(400, {"status": "expired"})]).poll_device_authorization("mdc_x")["status"], "expired")
        cred = "mdk_" + "B" * 43
        done = self._client([(200, {"status": "complete", "credential": cred, "features": {"cloudSync": True}})]).poll_device_authorization("mdc_x")
        self.assertEqual(done["status"], "complete")
        self.assertEqual(done["credential"], cred)

    def test_poll_rejects_bad_credential_prefix(self):
        with self.assertRaises(SyncError):
            self._client([(200, {"status": "complete", "credential": "not-a-credential"})]).poll_device_authorization("mdc_x")

    def test_create_account_pair_authenticates_and_conceals_secrets(self):
        cred = "mdk_" + "C" * 43
        client = self._client([(201, {
            "pairId": "pair_abcdef_123456789", "invitationToken": "i" * 40,
            "invitationExpiresAt": "2026-07-24 10:15:00", "revision": 1,
        })])
        creds = client.create_account_pair(_sample_schedule(), "source_widget_123456", cred)
        self.assertEqual(creds["role"], "account")
        self.assertEqual(creds["deviceCredential"], cred)
        self.assertEqual(creds["pairId"], "pair_abcdef_123456789")
        self.assertEqual(creds["revision"], 1)
        request = client._opener.requests[0]
        self.assertEqual(request.get_header("Authorization"), f"Bearer {cred}")
        raw = request.data.decode()
        self.assertIn("ciphertext", raw)
        self.assertNotIn("Morning", raw)  # schedule stays encrypted
        self.assertNotIn(creds["encryptionKey"], raw)  # E2E key never leaves the device

    def test_account_fetch_decrypts_with_pair_key(self):
        cred = "mdk_" + "D" * 43
        client = self._client([(201, {"pairId": "pair_abcdef_123456789", "invitationToken": "i" * 40, "invitationExpiresAt": "2026-07-24 10:15:00", "revision": 1})])
        creds = client.create_account_pair(_sample_schedule(), "source_widget_123456", cred)
        encrypted = EncryptedSyncClient._encrypt(_sample_schedule(), creds["encryptionKey"])
        client._opener = _FakeOpener([(200, {**encrypted, "revision": 3, "updatedBy": "source", "claimed": True})])
        remote = client.fetch_account(creds)
        self.assertEqual(remote.revision, 3)
        self.assertTrue(remote.claimed)
        self.assertEqual(remote.schedule, _sample_schedule())


class DeviceLinkControllerTests(unittest.TestCase):
    """The headless device-link loop drives poll states and yields the credential."""

    def _app(self, poll_results):
        app = object.__new__(MedicationReminderApp)

        class FakeClient:
            def __init__(self):
                self.polls = 0

            def start_device_authorization(self, label):
                return {"deviceCode": "mdc_x", "userCode": "ABCD-EFGH", "verificationUri": "https://x/link", "interval": 5}

            def poll_device_authorization(self, code):
                result = poll_results[min(self.polls, len(poll_results) - 1)]
                self.polls += 1
                return result

        app.sync_client = FakeClient()
        return app

    def test_link_returns_credential_after_pending_and_slow_down(self):
        cred = "mdk_" + "Z" * 43
        app = self._app([{"status": "pending"}, {"status": "slow_down"}, {"status": "complete", "credential": cred}])
        codes = []
        result = app._run_device_link(codes.append, lambda: False, sleep_fn=lambda _s: None)
        self.assertEqual(result, cred)
        self.assertEqual(codes[0]["userCode"], "ABCD-EFGH")

    def test_link_raises_on_denied(self):
        app = self._app([{"status": "denied"}])
        with self.assertRaises(SyncError):
            app._run_device_link(lambda _s: None, lambda: False, sleep_fn=lambda _s: None)

    def test_link_raises_on_cancel(self):
        app = self._app([{"status": "pending"}])
        with self.assertRaises(SyncError):
            app._run_device_link(lambda _s: None, lambda: True, sleep_fn=lambda _s: None)


class AccountRepairTests(unittest.TestCase):
    """A linked widget re-pairs in account mode; an unlinked one stays legacy."""

    def test_repair_uses_account_pair_when_credential_present(self):
        app = object.__new__(MedicationReminderApp)
        app.account_credential = "mdk_" + "Q" * 43
        calls = {}

        class FakeClient:
            def revoke(self, credentials):
                calls["revoke"] = credentials

            def create_account_pair(self, schedule, source_id, credential):
                calls["account"] = (source_id, credential)
                return {"pairId": "acct", "role": "account", "deviceCredential": credential}

            def create_pair(self, schedule, source_id):
                calls["legacy"] = source_id
                return {"pairId": "legacy"}

        app.sync_client = FakeClient()
        result = app._perform_repair({}, "src-9", None)
        self.assertEqual(result["pairId"], "acct")
        self.assertEqual(calls["account"], ("src-9", app.account_credential))
        self.assertNotIn("legacy", calls)


class WidgetMissedDoseTests(unittest.TestCase):
    """F5: the widget can record a dose as missed without claiming it was taken."""

    def _app(self) -> MedicationReminderApp:
        app = object.__new__(MedicationReminderApp)
        app.config_data = _sample_schedule()
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        app.now = lambda: now
        app.scheduler = ScheduleEngine(_sample_schedule(), normalize_state({
            "version": 1, "last_check_at": datetime(2026, 7, 22, 6, 0, tzinfo=TZ).isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }, now))
        self.audits = []
        app.storage = type("S", (), {
            "save_state": staticmethod(lambda state: None),
            "append_audit": staticmethod(lambda name, *a, **k: self.audits.append(name)),
        })()
        app._queue_dose_push = lambda: None
        app._close_popup = lambda popup: None
        app.update_next_due_text = lambda: None
        app._warn_persistence = lambda exc: None
        return app

    def _due(self, app):
        app.scheduler.collect_due(datetime(2026, 7, 22, 7, 30, tzinfo=TZ))
        return app.scheduler.next_ready(datetime(2026, 7, 22, 7, 35, tzinfo=TZ))

    def test_marking_missed_records_missed_not_taken(self):
        app = self._app()
        occurrence = self._due(app)

        app.mark_missed(occurrence, popup=None)

        entry = app.scheduler.state["doses"][occurrence.key]
        self.assertIsNone(entry["taken_at"])
        self.assertIsNotNone(entry["missed_at"])
        self.assertNotIn(occurrence.key, app.scheduler.state["completed"])

    def test_marking_missed_audits_as_missed(self):
        """The audit trail must not describe a missed dose as taken."""
        app = self._app()
        occurrence = self._due(app)

        app.mark_missed(occurrence, popup=None)

        self.assertIn("medication_missed", self.audits)
        self.assertNotIn("medication_taken", self.audits)

    def test_marking_missed_stops_the_reminder(self):
        app = self._app()
        occurrence = self._due(app)

        app.mark_missed(occurrence, popup=None)

        self.assertIsNone(app.scheduler.next_ready(datetime(2026, 7, 22, 7, 40, tzinfo=TZ)))

    def test_a_missed_dose_is_published_to_the_other_device(self):
        app = self._app()
        occurrence = self._due(app)
        app.mark_missed(occurrence, popup=None)

        payload = app._sync_payload()

        self.assertIsNotNone(payload["doses"][occurrence.key]["missed_at"])
        self.assertIsNone(payload["doses"][occurrence.key]["taken_at"])


class WidgetDoseSyncTests(unittest.TestCase):
    """F2: the widget publishes its doses and folds in the other device's."""

    def _app(self) -> MedicationReminderApp:
        app = object.__new__(MedicationReminderApp)
        app.config_data = _sample_schedule()
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        app.now = lambda: now
        app.scheduler = ScheduleEngine(_sample_schedule(), normalize_state({
            "version": 1, "last_check_at": datetime(2026, 7, 22, 6, 0, tzinfo=TZ).isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }, now))
        return app

    def test_sync_payload_carries_the_schedule_and_local_doses(self):
        app = self._app()
        app.scheduler.collect_due(datetime(2026, 7, 22, 7, 30, tzinfo=TZ))
        key = app.scheduler.state["pending"][0]
        app.scheduler.mark_taken(key, datetime(2026, 7, 22, 7, 35, tzinfo=TZ))

        payload = app._sync_payload()

        self.assertEqual(payload["schedule"], _sample_schedule())
        self.assertIsNotNone(payload["doses"][key]["taken_at"])

    def test_applying_a_remote_payload_folds_in_its_doses(self):
        app = self._app()
        app.sync_credentials = {"pairId": "p", "revision": 1}
        saved = {}
        app.storage = type("S", (), {
            "save_schedule": staticmethod(lambda schedule: validate_schedule(schedule)),
            "save_state": staticmethod(lambda state: saved.update(state=state)),
            "save_sync_credentials": staticmethod(lambda creds: None),
            "append_audit": staticmethod(lambda *a, **k: None),
        })()
        app._safe_audit = lambda *a, **k: None
        app.refresh_schedule_table = lambda: None
        app.update_next_due_text = lambda: None
        app._set_sync_status = lambda *a, **k: None
        app.scheduler.collect_due(datetime(2026, 7, 22, 7, 30, tzinfo=TZ))
        key = app.scheduler.state["pending"][0]
        stamp = "2026-07-22T07:40:00+01:00"

        app._apply_remote_schedule(RemoteSchedule(
            _sample_schedule(), 2, "other-device", True,
            {key: {"taken_at": stamp, "updated_at": stamp}},
        ))

        self.assertEqual(app.scheduler.state["pending"], [],
                         "a dose taken on the phone still had a reminder queued here")
        self.assertIn(key, app.scheduler.state["completed"])

    def test_marking_taken_queues_a_push_so_the_phone_learns_about_it(self):
        app = self._app()
        app.sync_credentials = {"pairId": "p", "revision": 1, "dirty": False}
        app.sync_generation = 0
        app.dose_generation = 0
        app.dose_only_push = False
        app.storage = type("S", (), {
            "save_state": staticmethod(lambda state: None),
            "append_audit": staticmethod(lambda *a, **k: None),
            "save_sync_credentials": staticmethod(lambda creds: None),
        })()
        app.update_next_due_text = lambda: None
        app._close_popup = lambda popup: None
        scheduled = []
        app.root = type("R", (), {"after": staticmethod(lambda ms, fn: scheduled.append(ms))})()
        app.scheduler.collect_due(datetime(2026, 7, 22, 7, 30, tzinfo=TZ))
        key = app.scheduler.state["pending"][0]
        occurrence = app.scheduler.resolve(key)

        app.mark_taken(occurrence, "popup")

        self.assertTrue(app.sync_credentials["dirty"], "the take was never queued for sync")
        self.assertTrue(scheduled, "no sync was scheduled after marking taken")

    def test_marking_taken_without_a_pairing_does_not_crash(self):
        app = self._app()
        app.sync_credentials = None
        app.storage = type("S", (), {
            "save_state": staticmethod(lambda state: None),
            "append_audit": staticmethod(lambda *a, **k: None),
        })()
        app.update_next_due_text = lambda: None
        app._close_popup = lambda popup: None
        app.scheduler.collect_due(datetime(2026, 7, 22, 7, 30, tzinfo=TZ))
        occurrence = app.scheduler.resolve(app.scheduler.state["pending"][0])

        app.mark_taken(occurrence, "popup")  # must not raise

        self.assertIn(occurrence.key, app.scheduler.state["completed"])


class PushMergeTests(unittest.TestCase):
    """F2: no push route may overwrite the other device's doses.

    Drives the real _start_sync worker body inline so the conflict/push decision
    logic itself is exercised, not just the pieces around it.
    """

    LOCAL_KEY = "2026-07-22|morning"
    REMOTE_KEY = "2026-07-21|morning"
    REMOTE_STAMP = "2026-07-21T07:05:00+01:00"

    def _app(self, *, revision: int, dirty: bool) -> MedicationReminderApp:
        app = object.__new__(MedicationReminderApp)
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        app.now = lambda: now
        app.config_data = _sample_schedule()
        app.scheduler = ScheduleEngine(_sample_schedule(), normalize_state({
            "version": 1, "last_check_at": datetime(2026, 7, 22, 6, 0, tzinfo=TZ).isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }, now))
        app.scheduler.collect_due(datetime(2026, 7, 22, 7, 30, tzinfo=TZ))
        app.scheduler.mark_taken(self.LOCAL_KEY, datetime(2026, 7, 22, 7, 35, tzinfo=TZ))
        app.sync_credentials = {"pairId": "p", "revision": revision, "dirty": dirty,
                                "deviceId": "this-pc", "encryptionKey": "k"}
        app.sync_in_progress = False
        app.conflict_pending = False
        app.sync_generation = 0
        app.dose_generation = 0
        app.dose_only_push = False
        app.storage = type("S", (), {
            "save_state": staticmethod(lambda state: None),
            "save_sync_credentials": staticmethod(lambda creds: None),
            "save_schedule": staticmethod(lambda s: validate_schedule(s)),
            "append_audit": staticmethod(lambda *a, **k: None),
        })()
        app._set_sync_status = lambda *a, **k: None
        app._safe_audit = lambda *a, **k: None
        app.refresh_schedule_table = lambda: None
        app.update_next_due_text = lambda: None
        app.root = type("R", (), {"after": staticmethod(lambda ms, fn: fn())})()
        return app

    def _run(self, app, **kwargs) -> dict:
        """Run _start_sync with the worker thread inlined, capturing the PUT."""
        captured: dict = {}
        remote_doses = {self.REMOTE_KEY: {"taken_at": self.REMOTE_STAMP,
                                          "updated_at": self.REMOTE_STAMP}}
        outer = self

        class FakeClient:
            def fetch(self, credentials):
                return RemoteSchedule(_sample_schedule(), 5, "other-device", True, remote_doses)

            def update(self, payload, credentials, base_revision, dose_only=False):
                captured["payload"] = payload
                captured["dose_only"] = dose_only
                return 6

        class InlineThread:
            def __init__(self, target=None, **_):
                self._target = target

            def start(self):
                self._target()

        app.sync_client = FakeClient()
        app._resolve_conflict = lambda remote, notify: captured.update(conflict=True)
        original = medication_reminder.threading.Thread
        medication_reminder.threading.Thread = InlineThread
        try:
            app._start_sync(**kwargs)
        finally:
            medication_reminder.threading.Thread = original
        return captured

    def test_a_push_merges_the_other_devices_doses_instead_of_overwriting(self):
        app = self._app(revision=5, dirty=True)  # same revision -> plain push path

        captured = self._run(app, push_local=True)

        doses = captured["payload"]["doses"]
        self.assertIn(self.LOCAL_KEY, doses, "this PC's own take was dropped from the push")
        self.assertIn(self.REMOTE_KEY, doses,
                      "the push overwrote the dose the other device had recorded")

    def test_a_dose_only_divergence_does_not_raise_the_conflict_prompt(self):
        # Remote revision moved but its schedule half is identical: doses only.
        app = self._app(revision=1, dirty=True)

        captured = self._run(app)

        self.assertNotIn("conflict", captured,
                         "two dose marks were reported to the user as a schedule conflict")
        self.assertIn(self.REMOTE_KEY, captured["payload"]["doses"])
        self.assertIn(self.LOCAL_KEY, captured["payload"]["doses"])

    def test_a_real_schedule_conflict_still_prompts(self):
        app = self._app(revision=1, dirty=True)
        changed = deepcopy(_sample_schedule())
        changed["events"][0]["time"] = "09:00"

        captured: dict = {}

        class FakeClient:
            def fetch(self, credentials):
                return RemoteSchedule(changed, 5, "other-device", True, {})

            def update(self, payload, credentials, base_revision):
                captured["payload"] = payload
                return 6

        class InlineThread:
            def __init__(self, target=None, **_):
                self._target = target

            def start(self):
                self._target()

        app.sync_client = FakeClient()
        app._resolve_conflict = lambda remote, notify: captured.update(conflict=True)
        original = medication_reminder.threading.Thread
        medication_reminder.threading.Thread = InlineThread
        try:
            app._start_sync()
        finally:
            medication_reminder.threading.Thread = original

        self.assertTrue(captured.get("conflict"), "a genuine schedule conflict stopped prompting")

    def test_a_remote_dose_is_applied_locally_as_well_as_pushed(self):
        app = self._app(revision=1, dirty=True)

        self._run(app)

        self.assertIn(self.REMOTE_KEY, app.scheduler.state["completed"],
                      "the other device's take was pushed back but never recorded here")

    def test_a_clean_device_applies_remote_doses_without_pushing_them_back(self):
        """Echoing a remote change back bumps the revision, which the other device
        then sees as a remote change, and the two PUT at each other every 60s."""
        app = self._app(revision=1, dirty=False)

        captured = self._run(app)

        self.assertNotIn("payload", captured,
                         "a clean device echoed the remote change back — this is a sync loop")
        self.assertIn(self.REMOTE_KEY, app.scheduler.state["completed"],
                      "the remote dose was not recorded locally either")

    def test_a_dose_mark_mid_sync_does_not_turn_a_remote_update_into_a_conflict(self):
        """sync_generation escalates 'remote' to 'conflict' to protect a concurrent
        local *schedule* edit. Doses merge per occurrence and need no such guard."""
        app = self._app(revision=1, dirty=False)
        app.root = type("R", (), {"after": staticmethod(lambda ms, fn: None)})()
        conflicts, applied = [], []
        app._resolve_conflict = lambda remote, notify: conflicts.append(remote)
        app._apply_remote_schedule = lambda remote: applied.append(remote)
        generation = app.sync_generation

        app._queue_dose_push()  # a take lands while the sync is still in flight
        app._finish_sync(
            ("remote", RemoteSchedule(_sample_schedule(), 5, "other-device", True, {})),
            generation, False,
        )

        self.assertEqual(conflicts, [],
                         "a dose mark escalated a clean remote update into a conflict prompt")
        self.assertEqual(len(applied), 1)

    def test_a_dose_push_is_flagged_so_the_phone_is_not_notified(self):
        """The relay pushes 'Schedule updated' to the phone on every non-mobile PUT.
        Now that a take triggers a PUT, an unflagged dose push buzzes the phone
        every time a dose is marked here."""
        app = self._app(revision=5, dirty=False)
        app.root = type("R", (), {"after": staticmethod(lambda ms, fn: None)})()
        app._queue_dose_push()

        captured = self._run(app, push_local=True)

        self.assertTrue(captured.get("dose_only"),
                        "a dose-only push was not flagged, so the phone gets a notification")

    def test_a_schedule_push_is_not_flagged_as_dose_only(self):
        app = self._app(revision=5, dirty=True)
        app.dose_only_push = False  # a schedule edit is what made it dirty

        captured = self._run(app, push_local=True)

        self.assertFalse(captured.get("dose_only"),
                         "a schedule change was flagged dose-only and would suppress the notice")

    def test_a_schedule_edit_after_a_take_is_no_longer_dose_only(self):
        app = self._app(revision=5, dirty=False)
        app.root = type("R", (), {"after": staticmethod(lambda ms, fn: None)})()
        app._queue_dose_push()          # dose mark first...
        app.sync_credentials["dirty"] = True
        app._note_schedule_push()       # ...then a schedule edit joins the same push

        captured = self._run(app, push_local=True)

        self.assertFalse(captured.get("dose_only"),
                         "a pending schedule change was masked by the earlier dose mark")

    def test_a_mid_sync_take_keeps_dirty_set_so_it_is_pushed_later(self):
        """The counter is only useful if _finish_sync honours it: an in-flight sync
        completing must not clear dirty for a take that landed after it started."""
        app = self._app(revision=5, dirty=True)
        app.root = type("R", (), {"after": staticmethod(lambda ms, fn: None)})()
        generation = app.sync_generation
        dose_generation = app.dose_generation

        app._queue_dose_push()  # a take lands mid-flight
        app._finish_sync(("updated", 6, True, {}), generation, False, dose_generation)

        self.assertTrue(
            app.sync_credentials["dirty"],
            "the in-flight sync cleared dirty, so the mid-sync take is never pushed",
        )

    def test_a_take_during_an_in_flight_sync_is_not_silently_dropped(self):
        app = self._app(revision=5, dirty=False)
        app.sync_in_progress = True  # a sync is already running
        generation_before = app.dose_generation

        app._queue_dose_push()

        self.assertNotEqual(
            app.dose_generation, generation_before,
            "the in-flight sync will clear dirty and the take will never be pushed",
        )


class SyncPayloadTransportTests(unittest.TestCase):
    """F2: the encrypted payload carries dose state, and still reads old ones."""

    KEY = "A" * 43

    def test_doses_survive_the_encrypted_round_trip(self):
        stamp = "2026-07-22T07:05:00+01:00"
        payload = {
            "version": 2,
            "schedule": _sample_schedule(),
            "doses": {"2026-07-22|morning": {"taken_at": stamp, "updated_at": stamp}},
        }
        restored = EncryptedSyncClient._decrypt(
            EncryptedSyncClient._encrypt(payload, self.KEY), self.KEY
        )
        self.assertEqual(restored["schedule"], _sample_schedule())
        self.assertEqual(restored["doses"]["2026-07-22|morning"]["taken_at"], stamp)

    def test_a_payload_from_an_older_build_still_decrypts(self):
        """Older peers publish a bare schedule; upgrading one device must not
        break sync with the other."""
        legacy = EncryptedSyncClient._encrypt(_sample_schedule(), self.KEY)
        # Simulate the pre-dose-sync wire format exactly: a bare schedule object.
        raw = json.dumps(_sample_schedule(), separators=(",", ":")).encode("utf-8")
        iv = b"\x00" * 12
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        import base64
        key_bytes = base64.urlsafe_b64decode(self.KEY + "=")
        cipher = AESGCM(key_bytes).encrypt(iv, raw, None)
        bare = {
            "iv": base64.urlsafe_b64encode(iv).decode().rstrip("="),
            "ciphertext": base64.urlsafe_b64encode(cipher).decode().rstrip("="),
        }

        restored = EncryptedSyncClient._decrypt(bare, self.KEY)

        self.assertEqual(restored["schedule"], _sample_schedule())
        self.assertEqual(restored["doses"], {})
        self.assertTrue(legacy["ciphertext"])

    def test_a_tampered_schedule_is_still_rejected(self):
        """The dose half must not weaken the decrypt-boundary guard."""
        hostile = {"version": 2, "schedule": {"timezone": "Nowhere/Fake", "events": []}, "doses": {}}
        with self.assertRaises(SyncError):
            EncryptedSyncClient._encrypt(hostile, self.KEY)

    def test_the_ciphertext_never_leaks_dose_keys(self):
        stamp = "2026-07-22T07:05:00+01:00"
        payload = {
            "version": 2,
            "schedule": _sample_schedule(),
            "doses": {"2026-07-22|morning": {"taken_at": stamp, "updated_at": stamp}},
        }
        encrypted = EncryptedSyncClient._encrypt(payload, self.KEY)
        self.assertNotIn("2026-07-22", encrypted["ciphertext"])
        self.assertNotIn("morning", encrypted["ciphertext"])


class TrayReminderPopupTests(unittest.TestCase):
    """F1: the due popup must be visible when the app is in the tray.

    Tk mirrors a master's window state onto its transients, so a popup made
    transient to a withdrawn/iconified root is created already withdrawn — the
    alarm is silently never shown, and because the popup still satisfies
    winfo_exists() the check loop treats one as open forever and no later dose
    ever surfaces.
    """

    # One Tk interpreter for the class: creating a second tk.Tk() in the same
    # process is unreliable on Windows. Each test gets a fresh Toplevel standing
    # in for the main window, which withdraws/iconifies exactly like the real
    # root and is not itself transient to the hidden master.
    @classmethod
    def setUpClass(cls) -> None:
        cls._master = tk.Tk()
        cls._master.withdraw()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._master.destroy()

    def _app(self) -> MedicationReminderApp:
        app = object.__new__(MedicationReminderApp)
        app.root = tk.Toplevel(self._master)
        self.addCleanup(app.root.destroy)
        app.root.geometry("300x200+80+80")
        app._configure_theme()
        app.active_popup = None
        app.play_alert_sound = lambda: None
        app.now = lambda: datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        return app

    @staticmethod
    def _occurrence() -> DueOccurrence:
        return DueOccurrence(
            key="2026-07-22|morning", event_id="morning", label="Morning",
            time_text="07:00", medicines=["Med"], instructions="",
            scheduled_at=datetime(2026, 7, 22, 7, 0, tzinfo=TZ),
        )

    def test_due_popup_is_visible_while_hidden_to_tray(self):
        app = self._app()
        app.hide_to_tray()
        app.root.update()

        app.show_due_popup(self._occurrence())
        app.root.update()

        self.assertTrue(
            app.active_popup.winfo_ismapped(),
            "the reminder popup was never shown while the app sat in the tray",
        )

    def test_due_popup_is_visible_while_main_window_is_minimized(self):
        app = self._app()
        app.root.update()
        app.root.iconify()
        app.root.update()

        app.show_due_popup(self._occurrence())
        app.root.update()

        self.assertTrue(
            app.active_popup.winfo_ismapped(),
            "the reminder popup was never shown while the main window was minimized",
        )

    def test_check_schedule_re_asserts_an_alarm_that_went_invisible(self):
        """Defence in depth: an existing-but-unmapped popup must not wedge the loop.

        winfo_exists() is true for a hidden window, so without this the check loop
        believes an alarm is on screen forever and never raises another one.
        """
        app = self._app()
        app.running = True
        app.root.update()
        app.show_due_popup(self._occurrence())
        app.root.update()
        app.active_popup.withdraw()  # stand-in for any future cause of a hidden alarm
        app.root.update()
        self.assertFalse(app.active_popup.winfo_ismapped(), "precondition: alarm is hidden")

        class QuietScheduler:
            pending_skip_notice = None
            state: dict = {}

            def collect_due(self, now):
                return 0

            def next_ready(self, now):
                return None

        class NullStorage:
            def save_state(self, state):
                pass

        app.scheduler = QuietScheduler()
        app.storage = NullStorage()
        app.root.after = lambda *args, **kwargs: None  # don't re-arm inside a test

        app.check_schedule()
        app.root.update()

        self.assertTrue(
            app.active_popup.winfo_ismapped(),
            "the check loop left an invisible alarm on screen-less standby forever",
        )

    def test_open_popup_stays_visible_when_the_user_hides_to_tray(self):
        app = self._app()
        app.root.update()

        app.show_due_popup(self._occurrence())
        app.root.update()
        app.hide_to_tray()
        app.root.update()

        self.assertTrue(
            app.active_popup.winfo_ismapped(),
            "an already-open reminder was dragged out of view by hiding to the tray",
        )


if __name__ == "__main__":
    unittest.main()
