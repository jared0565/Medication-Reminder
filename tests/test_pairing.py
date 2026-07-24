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


if __name__ == "__main__":
    unittest.main()
