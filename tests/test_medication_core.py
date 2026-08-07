import tempfile
import unittest
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from medication_core import (
    COMPLETED_RETENTION,
    MAX_DOSE_ENTRIES,
    AppStorage,
    ConfigValidationError,
    ScheduleEngine,
    StorageError,
    merge_dose_maps,
    normalize_state,
    occurrence_key,
    prune_dose_map,
    sanitize_csv_cell,
    validate_schedule,
    validate_sync_payload,
)


TZ = ZoneInfo("Europe/London")


class _IdentityProtector:
    """Test protector: identity transform that rejects empty data like DPAPI."""

    def protect(self, data: bytes) -> bytes:
        if not data:
            raise StorageError("Refusing to protect empty data")
        return data

    def unprotect(self, data: bytes) -> bytes:
        if not data:
            raise StorageError("Refusing to unprotect empty data")
        return data


def make_storage(tmp: Path) -> AppStorage:
    return AppStorage(data_dir=tmp, protector=_IdentityProtector())


def schedule():
    return {
        "timezone": "Europe/London",
        "events": [{
            "id": "morning",
            "enabled": True,
            "time": "07:00",
            "label": "Morning medicines",
            "medicines": ["Example medicine"],
            "instructions": "Take as directed.",
            "days": ["daily"],
            "start_date": None,
            "end_date": None,
        }],
    }


class ScheduleEngineTests(unittest.TestCase):
    def test_invalid_schedule_is_rejected(self):
        invalid = schedule()
        invalid["events"][0]["time"] = "25:99"
        with self.assertRaises(ConfigValidationError):
            validate_schedule(invalid)

    def test_catches_up_after_sleep_or_restart(self):
        state = {
            "version": 1,
            "last_check_at": datetime(2026, 7, 22, 6, 59, tzinfo=TZ).isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }
        engine = ScheduleEngine(schedule(), state)
        added = engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        self.assertEqual(added, 1)
        self.assertEqual(len(engine.state["pending"]), 1)

    def test_snooze_suppresses_until_expiry(self):
        state = {
            "version": 1,
            "last_check_at": datetime(2026, 7, 22, 6, 59, tzinfo=TZ).isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }
        engine = ScheduleEngine(schedule(), state)
        now = datetime(2026, 7, 22, 7, 1, tzinfo=TZ)
        engine.collect_due(now)
        key = engine.state["pending"][0]
        until = engine.snooze(key, now, 10)
        self.assertIsNone(engine.next_ready(now))
        self.assertIsNotNone(engine.next_ready(until))

    def test_mark_taken_removes_pending_and_records_completion(self):
        state = {
            "version": 1,
            "last_check_at": datetime(2026, 7, 22, 6, 59, tzinfo=TZ).isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }
        engine = ScheduleEngine(schedule(), state)
        now = datetime(2026, 7, 22, 7, 1, tzinfo=TZ)
        engine.collect_due(now)
        key = engine.state["pending"][0]
        engine.mark_taken(key, now)
        self.assertNotIn(key, engine.state["pending"])
        self.assertIn(key, engine.state["completed"])


class StorageRecoveryTests(unittest.TestCase):
    """H3: corrupt/undecryptable protected files must not brick startup."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def test_corrupt_state_recovers_to_defaults(self):
        storage = make_storage(self.tmp)
        storage.state_file.path.write_bytes(b"not valid json at all")
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        state = storage.load_state(now)
        self.assertEqual(state["version"], 1)
        self.assertEqual(state["pending"], [])
        self.assertEqual(state["completed"], {})
        # The corrupt file was quarantined and a fresh default written back.
        self.assertTrue(list(self.tmp.glob("state.dat.corrupt-*")))
        self.assertTrue(storage.state_file.exists())

    def test_unsupported_state_version_recovers(self):
        storage = make_storage(self.tmp)
        storage.state_file.save({"version": 999, "pending": ["x"]})
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        state = storage.load_state(now)
        self.assertEqual(state["version"], 1)
        self.assertTrue(list(self.tmp.glob("state.dat.corrupt-*")))


def account_credentials(**overrides) -> dict:
    """The exact shape create_account_pair returns (sync_client.py:252-259)."""
    value = {
        "version": 2, "role": "account", "pairId": "p" * 32,
        "encryptionKey": "k" * 43, "deviceCredential": "mdk_" + "c" * 32,
        "sourceId": "s" * 22, "deviceId": "s" * 22,
        "invitationToken": "i" * 43, "invitationExpiresAt": "2026-08-07T00:00:00Z",
        "revision": 1, "claimed": False, "dirty": False,
    }
    value.update(overrides)
    return value


def source_credentials(**overrides) -> dict:
    """The legacy v1 shape create_pair returns (sync_client.py:127)."""
    value = {
        "version": 1, "role": "source", "pairId": "p" * 32, "token": "t" * 32,
        "encryptionKey": "k" * 43, "sourceId": "s" * 22, "deviceId": "s" * 22,
        "revision": 1, "claimed": False, "dirty": False,
    }
    value.update(overrides)
    return value


class AccountCredentialStorageTests(unittest.TestCase):
    """Account (v2) pairings must survive a restart.

    load_sync_credentials used to hard-require version == 1 and a 'token' field,
    so credentials minted by create_account_pair could be saved but never read
    back. Startup swallows StorageError and sets sync_credentials = None, so the
    widget silently unpaired itself on the first restart after linking an
    account -- no error, sync simply stopped. Nothing covered this: the only
    caller of load_sync_credentials was the widget's __init__.
    """

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def test_account_credentials_survive_a_restart(self):
        storage = make_storage(self.tmp)
        saved = account_credentials()
        storage.save_sync_credentials(saved)

        # A fresh AppStorage is what a restarted widget actually does.
        loaded = make_storage(self.tmp).load_sync_credentials()

        self.assertIsNotNone(loaded, "the widget would have silently unpaired itself")
        self.assertEqual(loaded["version"], 2)
        self.assertEqual(loaded["deviceCredential"], saved["deviceCredential"])
        self.assertEqual(loaded["pairId"], saved["pairId"])
        self.assertEqual(loaded["encryptionKey"], saved["encryptionKey"])

    def test_legacy_source_credentials_still_load(self):
        storage = make_storage(self.tmp)
        storage.save_sync_credentials(source_credentials())
        loaded = make_storage(self.tmp).load_sync_credentials()
        self.assertEqual(loaded["version"], 1)
        self.assertEqual(loaded["token"], "t" * 32)

    def test_account_credentials_without_a_device_credential_are_rejected(self):
        # Accepting v2 must not mean accepting anything that calls itself v2.
        storage = make_storage(self.tmp)
        broken = account_credentials()
        del broken["deviceCredential"]
        storage.save_sync_credentials(broken)
        with self.assertRaises(StorageError):
            make_storage(self.tmp).load_sync_credentials()

    def test_legacy_credentials_without_a_token_are_rejected(self):
        storage = make_storage(self.tmp)
        broken = source_credentials()
        del broken["token"]
        storage.save_sync_credentials(broken)
        with self.assertRaises(StorageError):
            make_storage(self.tmp).load_sync_credentials()

    def test_an_unknown_credential_version_is_rejected(self):
        storage = make_storage(self.tmp)
        storage.save_sync_credentials(account_credentials(version=3))
        with self.assertRaises(StorageError):
            make_storage(self.tmp).load_sync_credentials()

    def test_non_numeric_volume_recovers(self):
        storage = make_storage(self.tmp)
        storage.settings_file.save({"volume": "loud", "sound": "chime"})
        settings = storage.load_settings()
        self.assertEqual(settings["volume"], 70)
        self.assertEqual(settings["sound"], "chime")
        # A valid dict with one bad field is repaired in place, not quarantined.
        self.assertFalse(list(self.tmp.glob("settings.dat.corrupt-*")))

    def test_corrupt_settings_recovers_to_defaults(self):
        storage = make_storage(self.tmp)
        storage.settings_file.path.write_bytes(b"\x00\x01 not json")
        settings = storage.load_settings()
        self.assertEqual(settings, {"volume": 70, "sound": "chime"})
        self.assertTrue(list(self.tmp.glob("settings.dat.corrupt-*")))


class CsvExportTests(unittest.TestCase):
    """L4: exported CSV cells must not carry spreadsheet formula injection."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self._dir.name)

    def tearDown(self) -> None:
        self._dir.cleanup()

    def test_sanitize_csv_cell_helper(self):
        for dangerous in ("=cmd", "+1", "-1", "@x", "\tx", "\rx"):
            self.assertTrue(sanitize_csv_cell(dangerous).startswith("'"))
        self.assertEqual(sanitize_csv_cell("safe"), "safe")
        self.assertEqual(sanitize_csv_cell(""), "")
        self.assertEqual(sanitize_csv_cell(None), "")

    def test_csv_export_neutralizes_formula_injection(self):
        storage = make_storage(self.tmp)
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        storage.append_audit(
            "medication_taken",
            now,
            event_id="e1",
            label="=SUM(1+1)",
            scheduled_time="2026-07-22T08:00:00",
            items=["+danger", "safe"],
        )
        dest = self.tmp / "out.csv"
        count = storage.export_taken_csv(dest)
        self.assertEqual(count, 1)
        text = dest.read_text(encoding="utf-8")
        self.assertIn("'=SUM(1+1)", text)  # label neutralized
        self.assertIn("'+danger", text)  # leading item in the items cell neutralized
        self.assertNotIn(",=SUM(1+1)", text)  # the raw formula is never a bare cell


class DstTests(unittest.TestCase):
    """L2: wall times across DST transitions resolve to real instants."""

    def _engine(self, time_text: str):
        sched = schedule()
        sched["events"][0]["time"] = time_text
        state = {
            "version": 1,
            "last_check_at": datetime(2026, 1, 1, 0, 0, tzinfo=TZ).isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }
        return ScheduleEngine(sched, state), sched

    def test_spring_forward_nonexistent_time_is_normalized(self):
        # Europe/London springs forward 2026-03-29 01:00 -> 02:00; 01:30 does not exist.
        engine, sched = self._engine("01:30")
        occ = engine.resolve(occurrence_key(date(2026, 3, 29), sched["events"][0]))
        self.assertIsNotNone(occ)
        self.assertEqual(occ.scheduled_at.hour, 2)  # shifted forward past the gap
        self.assertEqual(occ.scheduled_at.utcoffset(), timedelta(hours=1))  # BST

    def test_fall_back_ambiguous_time_uses_first_occurrence(self):
        # Europe/London falls back 2026-10-25 02:00 -> 01:00; 01:30 occurs twice.
        engine, sched = self._engine("01:30")
        occ = engine.resolve(occurrence_key(date(2026, 10, 25), sched["events"][0]))
        self.assertIsNotNone(occ)
        self.assertEqual((occ.scheduled_at.hour, occ.scheduled_at.minute), (1, 30))
        self.assertEqual(occ.scheduled_at.utcoffset(), timedelta(hours=1))  # first (BST)

    def test_normal_time_is_unchanged(self):
        engine, sched = self._engine("07:00")
        occ = engine.resolve(occurrence_key(date(2026, 7, 22), sched["events"][0]))
        self.assertEqual((occ.scheduled_at.hour, occ.scheduled_at.minute), (7, 0))


class SkipNoticeTests(unittest.TestCase):
    """L10: a long off-window that drops missed doses must not be invisible."""

    def _state(self, last_check: datetime) -> dict:
        return {
            "version": 1,
            "last_check_at": last_check.isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }

    def test_large_gap_records_skip_notice(self):
        engine = ScheduleEngine(schedule(), self._state(datetime(2026, 7, 18, 7, 0, tzinfo=TZ)))
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))  # ~4 days > MAX_CATCH_UP
        self.assertIsNotNone(engine.pending_skip_notice)
        self.assertIn("skipped_from", engine.pending_skip_notice)
        self.assertIn("skipped_until", engine.pending_skip_notice)

    def test_small_gap_records_no_skip_notice(self):
        engine = ScheduleEngine(schedule(), self._state(datetime(2026, 7, 22, 6, 59, tzinfo=TZ)))
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        self.assertIsNone(engine.pending_skip_notice)


class SyncedTimeChangeTests(unittest.TestCase):
    """F3: a schedule edit arriving from another device must not destroy dose state.

    An occurrence's identity must not include the event's scheduled time, or
    retiming an event on the web silently drops the widget's queued reminders
    and re-queues doses that were already taken.
    """

    def _state(self, last_check: datetime) -> dict:
        return {
            "version": 1,
            "last_check_at": last_check.isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }

    @staticmethod
    def _retimed(new_time: str) -> dict:
        changed = schedule()
        changed["events"][0]["time"] = new_time
        return changed

    def test_pending_reminder_survives_a_synced_time_change(self):
        engine = ScheduleEngine(schedule(), self._state(datetime(2026, 7, 22, 6, 0, tzinfo=TZ)))
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        self.assertEqual(len(engine.state["pending"]), 1, "precondition: one reminder is queued")

        engine.replace_schedule(self._retimed("07:30"))

        self.assertEqual(
            len(engine.state["pending"]), 1,
            "retiming the event on another device deleted the queued reminder",
        )

    def test_snooze_survives_a_synced_time_change(self):
        engine = ScheduleEngine(schedule(), self._state(datetime(2026, 7, 22, 6, 0, tzinfo=TZ)))
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        key = engine.state["pending"][0]
        engine.snooze(key, datetime(2026, 7, 22, 7, 21, tzinfo=TZ), 10)

        engine.replace_schedule(self._retimed("07:30"))

        self.assertIn(key, engine.state["snoozed_until"], "the snooze was dropped with the key")

    def test_snooze_still_suppresses_the_alarm_after_a_synced_time_change(self):
        """_cleanup prunes snoozes to pending keys, and the real loop calls
        collect_due on every tick before next_ready. If the snooze is lost there,
        a snoozed dose re-alarms 15 seconds later."""
        engine = ScheduleEngine(schedule(), self._state(datetime(2026, 7, 22, 6, 0, tzinfo=TZ)))
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        key = engine.state["pending"][0]
        engine.snooze(key, datetime(2026, 7, 22, 7, 21, tzinfo=TZ), 10)  # until 07:31

        engine.replace_schedule(self._retimed("07:30"))
        engine.collect_due(datetime(2026, 7, 22, 7, 25, tzinfo=TZ))  # the next tick

        self.assertIn(key, engine.state["snoozed_until"], "cleanup pruned the live snooze")
        self.assertIsNone(
            engine.next_ready(datetime(2026, 7, 22, 7, 25, tzinfo=TZ)),
            "a snoozed dose re-alarmed after a synced retime",
        )
        self.assertIsNotNone(
            engine.next_ready(datetime(2026, 7, 22, 7, 40, tzinfo=TZ)),
            "the dose never came back after its snooze expired",
        )

    def test_taken_dose_is_not_requeued_after_a_synced_time_change(self):
        engine = ScheduleEngine(schedule(), self._state(datetime(2026, 7, 22, 6, 0, tzinfo=TZ)))
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        engine.mark_taken(engine.state["pending"][0], datetime(2026, 7, 22, 7, 25, tzinfo=TZ))

        engine.replace_schedule(self._retimed("07:30"))
        engine.collect_due(datetime(2026, 7, 22, 8, 0, tzinfo=TZ))

        self.assertEqual(
            engine.state["pending"], [],
            "a dose already taken was re-queued because retiming changed its key",
        )

    def test_resolved_occurrence_reports_the_current_scheduled_time(self):
        engine = ScheduleEngine(schedule(), self._state(datetime(2026, 7, 22, 6, 0, tzinfo=TZ)))
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        key = engine.state["pending"][0]

        engine.replace_schedule(self._retimed("07:30"))
        occurrence = engine.resolve(key)

        self.assertIsNotNone(occurrence)
        self.assertEqual(occurrence.time_text, "07:30")
        self.assertEqual(occurrence.scheduled_at.strftime("%H:%M"), "07:30")

    def test_reminder_for_a_deleted_event_is_still_dropped(self):
        """The guard must keep working: only *retiming* is now tolerated."""
        engine = ScheduleEngine(schedule(), self._state(datetime(2026, 7, 22, 6, 0, tzinfo=TZ)))
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        emptied = schedule()
        emptied["events"] = []

        engine.replace_schedule(emptied)

        self.assertEqual(engine.state["pending"], [])


class LegacyStateKeyTests(unittest.TestCase):
    """F3: state files written before the key change must not lose their doses."""

    def test_legacy_three_part_pending_key_is_migrated(self):
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        raw = {
            "version": 1,
            "last_check_at": now.isoformat(),
            "pending": ["2026-07-22|morning|07:00"],
            "completed": {},
            "snoozed_until": {},
        }

        state = normalize_state(raw, now)

        self.assertEqual(state["pending"], ["2026-07-22|morning"])

    def test_legacy_three_part_completed_and_snooze_keys_are_migrated(self):
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        raw = {
            "version": 1,
            "last_check_at": now.isoformat(),
            "pending": ["2026-07-22|evening|20:00"],
            "completed": {"2026-07-21|morning|07:00": now.isoformat()},
            "snoozed_until": {"2026-07-22|evening|20:00": now.isoformat()},
        }

        state = normalize_state(raw, now)

        self.assertEqual(list(state["completed"]), ["2026-07-21|morning"])
        self.assertEqual(list(state["snoozed_until"]), ["2026-07-22|evening"])

    def test_migrated_taken_dose_is_not_requeued(self):
        """The whole point of the migration: an upgrade must not re-alarm a taken dose."""
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        raw = {
            "version": 1,
            "last_check_at": datetime(2026, 7, 22, 6, 0, tzinfo=TZ).isoformat(),
            "pending": [],
            "completed": {"2026-07-22|morning|07:00": now.isoformat()},
            "snoozed_until": {},
        }

        engine = ScheduleEngine(schedule(), normalize_state(raw, now))
        engine.collect_due(now)

        self.assertEqual(engine.state["pending"], [])

    def test_colliding_legacy_completed_keys_keep_the_earliest_take(self):
        """A retimed event could leave two legacy keys for one dose. Collapsing
        them must keep when it was actually taken, not an arbitrary survivor —
        _cleanup retires `completed` against that timestamp."""
        now = datetime(2026, 7, 22, 23, 0, tzinfo=TZ)
        first = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        later = datetime(2026, 7, 22, 20, 5, tzinfo=TZ).isoformat()
        raw = {
            "version": 1,
            "last_check_at": now.isoformat(),
            "pending": [],
            # Insertion order puts the later take last, so "last wins" gets it wrong.
            "completed": {"2026-07-22|morning|07:00": first, "2026-07-22|morning|20:00": later},
            "snoozed_until": {},
        }

        state = normalize_state(raw, now)

        self.assertEqual(list(state["completed"]), ["2026-07-22|morning"])
        self.assertEqual(state["completed"]["2026-07-22|morning"], first)

    def test_colliding_legacy_snooze_keys_keep_the_longest_suppression(self):
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        short = datetime(2026, 7, 22, 8, 5, tzinfo=TZ).isoformat()
        long = datetime(2026, 7, 22, 9, 30, tzinfo=TZ).isoformat()
        raw = {
            "version": 1,
            "last_check_at": now.isoformat(),
            "pending": ["2026-07-22|morning"],
            "completed": {},
            # Insertion order puts the longer snooze first, so "last wins" gets it wrong.
            "snoozed_until": {"2026-07-22|morning|07:00": long, "2026-07-22|morning|20:00": short},
        }

        state = normalize_state(raw, now)

        self.assertEqual(state["snoozed_until"]["2026-07-22|morning"], long)

    def test_current_two_part_keys_are_preserved(self):
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        raw = {
            "version": 1,
            "last_check_at": now.isoformat(),
            "pending": ["2026-07-22|morning"],
            "completed": {},
            "snoozed_until": {},
        }

        self.assertEqual(normalize_state(raw, now)["pending"], ["2026-07-22|morning"])

    def test_malformed_keys_are_still_rejected(self):
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        raw = {
            "version": 1,
            "last_check_at": now.isoformat(),
            "pending": ["nonsense", "a|b|c|d", 17],
            "completed": {},
            "snoozed_until": {},
        }

        self.assertEqual(normalize_state(raw, now)["pending"], [])


NOW_FOR_MAP = datetime(2026, 7, 22, 12, 0, tzinfo=TZ)


class MissedDoseTests(unittest.TestCase):
    """F5: a dose that was genuinely missed must be recordable as missed.

    Before this existed the only way to silence the alarm was to press Taken,
    which recorded — and synced — a dose that was never taken.
    """

    def _engine(self, last_check=datetime(2026, 7, 22, 6, 0, tzinfo=TZ)) -> ScheduleEngine:
        return ScheduleEngine(schedule(), normalize_state({
            "version": 1, "last_check_at": last_check.isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }, last_check))

    def _pending_engine(self):
        engine = self._engine()
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        return engine, engine.state["pending"][0]

    def test_marking_missed_stops_the_alarm(self):
        engine, key = self._pending_engine()

        engine.mark_missed(key, datetime(2026, 7, 22, 7, 25, tzinfo=TZ))

        self.assertNotIn(key, engine.state["pending"])
        self.assertIsNone(engine.next_ready(datetime(2026, 7, 22, 7, 30, tzinfo=TZ)))

    def test_marking_missed_does_not_record_a_dose_as_taken(self):
        """The whole point: silencing the alarm must not falsify the record."""
        engine, key = self._pending_engine()

        engine.mark_missed(key, datetime(2026, 7, 22, 7, 25, tzinfo=TZ))

        self.assertNotIn(key, engine.state["completed"])
        self.assertIsNone(engine.dose_map(NOW_FOR_MAP)[key]["taken_at"])
        self.assertIsNotNone(engine.dose_map(NOW_FOR_MAP)[key]["missed_at"])

    def test_a_missed_dose_is_distinguishable_from_an_undone_one(self):
        """Undo leaves both stamps null; missed must not look like undo."""
        engine, key = self._pending_engine()
        engine.mark_taken(key, datetime(2026, 7, 22, 7, 25, tzinfo=TZ))
        engine.mark_missed(key, datetime(2026, 7, 22, 7, 40, tzinfo=TZ))

        entry = engine.dose_map(NOW_FOR_MAP)[key]

        self.assertIsNone(entry["taken_at"])
        self.assertIsNotNone(entry["missed_at"])

    def test_a_remote_missed_dose_clears_the_local_pending_reminder(self):
        """Marked missed on the phone: the PC must stop alarming for it."""
        engine, key = self._pending_engine()
        stamp = datetime(2026, 7, 22, 7, 30, tzinfo=TZ).isoformat()

        engine.apply_remote_doses(
            {key: {"taken_at": None, "missed_at": stamp, "updated_at": stamp}},
            datetime(2026, 7, 22, 7, 35, tzinfo=TZ),
        )

        self.assertNotIn(key, engine.state["pending"])
        self.assertNotIn(key, engine.state["completed"])

    def test_missed_survives_the_sync_payload_validator(self):
        stamp = datetime(2026, 7, 22, 7, 30, tzinfo=TZ).isoformat()
        payload = validate_sync_payload({
            "version": 2, "schedule": schedule(),
            "doses": {"2026-07-22|morning": {"taken_at": None, "missed_at": stamp,
                                             "updated_at": stamp}},
        })

        self.assertEqual(payload["doses"]["2026-07-22|morning"]["missed_at"], stamp)

    def test_a_legacy_entry_without_missed_at_still_loads(self):
        """A peer on an older build publishes no missed_at; that must not break."""
        stamp = datetime(2026, 7, 22, 7, 30, tzinfo=TZ).isoformat()
        payload = validate_sync_payload({
            "version": 2, "schedule": schedule(),
            "doses": {"2026-07-22|morning": {"taken_at": stamp, "updated_at": stamp}},
        })

        entry = payload["doses"]["2026-07-22|morning"]
        self.assertEqual(entry["taken_at"], stamp)
        self.assertIsNone(entry["missed_at"])

    def test_a_later_take_overrides_an_earlier_missed(self):
        """Took it late after marking it missed: the take is the newer truth."""
        missed_at = datetime(2026, 7, 22, 7, 30, tzinfo=TZ).isoformat()
        taken_at = datetime(2026, 7, 22, 8, 0, tzinfo=TZ).isoformat()

        merged = merge_dose_maps(
            {"2026-07-22|morning": {"taken_at": None, "missed_at": missed_at, "updated_at": missed_at}},
            {"2026-07-22|morning": {"taken_at": taken_at, "missed_at": None, "updated_at": taken_at}},
        )

        self.assertEqual(merged["2026-07-22|morning"]["taken_at"], taken_at)
        self.assertIsNone(merged["2026-07-22|morning"]["missed_at"])

    def test_a_later_missed_overrides_an_earlier_take(self):
        taken_at = datetime(2026, 7, 22, 7, 30, tzinfo=TZ).isoformat()
        missed_at = datetime(2026, 7, 22, 8, 0, tzinfo=TZ).isoformat()

        merged = merge_dose_maps(
            {"2026-07-22|morning": {"taken_at": taken_at, "missed_at": None, "updated_at": taken_at}},
            {"2026-07-22|morning": {"taken_at": None, "missed_at": missed_at, "updated_at": missed_at}},
        )

        self.assertIsNone(merged["2026-07-22|morning"]["taken_at"])
        self.assertEqual(merged["2026-07-22|morning"]["missed_at"], missed_at)

    def test_an_unknown_occurrence_cannot_be_marked_missed(self):
        """Pending or already-recorded doses only — never an invented key."""
        engine = self._engine()
        with self.assertRaises(ValueError):
            engine.mark_missed("2026-07-22|morning", datetime(2026, 7, 22, 7, 25, tzinfo=TZ))

    def test_a_mistaken_take_can_be_corrected_to_missed(self):
        engine, key = self._pending_engine()
        engine.mark_taken(key, datetime(2026, 7, 22, 7, 25, tzinfo=TZ))

        engine.mark_missed(key, datetime(2026, 7, 22, 7, 40, tzinfo=TZ))

        self.assertNotIn(key, engine.state["completed"])
        self.assertIsNotNone(engine.dose_map(NOW_FOR_MAP)[key]["missed_at"])


class EngineDoseStateTests(unittest.TestCase):
    """F2: the engine keeps a syncable dose map and folds a remote one in."""

    def _engine(self, last_check=datetime(2026, 7, 22, 6, 0, tzinfo=TZ)) -> ScheduleEngine:
        return ScheduleEngine(schedule(), normalize_state({
            "version": 1, "last_check_at": last_check.isoformat(),
            "pending": [], "completed": {}, "snoozed_until": {},
        }, last_check))

    def test_marking_taken_records_a_syncable_dose(self):
        engine = self._engine()
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        key = engine.state["pending"][0]

        engine.mark_taken(key, datetime(2026, 7, 22, 7, 25, tzinfo=TZ))

        self.assertIn(key, engine.dose_map(NOW_FOR_MAP))
        self.assertIsNotNone(engine.dose_map(NOW_FOR_MAP)[key]["taken_at"])

    def test_existing_completed_history_seeds_the_dose_map(self):
        """An upgrade must publish the doses already recorded on this PC."""
        now = datetime(2026, 7, 22, 8, 0, tzinfo=TZ)
        taken_at = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        state = normalize_state({
            "version": 1, "last_check_at": now.isoformat(), "pending": [],
            "completed": {"2026-07-22|morning": taken_at}, "snoozed_until": {},
        }, now)

        engine = ScheduleEngine(schedule(), state)

        self.assertEqual(engine.dose_map(NOW_FOR_MAP)["2026-07-22|morning"]["taken_at"], taken_at)

    def test_a_remote_take_clears_the_local_pending_reminder(self):
        engine = self._engine()
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        key = engine.state["pending"][0]
        stamp = datetime(2026, 7, 22, 7, 30, tzinfo=TZ).isoformat()

        engine.apply_remote_doses(
            {key: {"taken_at": stamp, "updated_at": stamp}},
            datetime(2026, 7, 22, 7, 35, tzinfo=TZ),
        )

        self.assertEqual(engine.state["pending"], [], "the dose was taken on another device")
        self.assertIn(key, engine.state["completed"])

    def test_a_remote_undo_clears_the_local_take(self):
        engine = self._engine()
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        key = engine.state["pending"][0]
        engine.mark_taken(key, datetime(2026, 7, 22, 7, 25, tzinfo=TZ))
        undone = datetime(2026, 7, 22, 9, 0, tzinfo=TZ).isoformat()

        engine.apply_remote_doses(
            {key: {"taken_at": None, "updated_at": undone}},
            datetime(2026, 7, 22, 9, 5, tzinfo=TZ),
        )

        self.assertNotIn(key, engine.state["completed"])
        self.assertIsNone(engine.dose_map(NOW_FOR_MAP)[key]["taken_at"])

    def test_a_local_take_survives_a_remote_take_of_a_different_dose(self):
        engine = self._engine()
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        key = engine.state["pending"][0]
        engine.mark_taken(key, datetime(2026, 7, 22, 7, 25, tzinfo=TZ))
        other = "2026-07-21|morning"
        stamp = datetime(2026, 7, 21, 7, 5, tzinfo=TZ).isoformat()

        engine.apply_remote_doses(
            {other: {"taken_at": stamp, "updated_at": stamp}},
            datetime(2026, 7, 22, 9, 0, tzinfo=TZ),
        )

        self.assertIn(key, engine.state["completed"], "this PC's own take was overwritten")
        self.assertIn(other, engine.state["completed"])

    def test_a_remotely_taken_dose_is_not_requeued_by_the_next_check(self):
        engine = self._engine()
        engine.collect_due(datetime(2026, 7, 22, 7, 20, tzinfo=TZ))
        key = engine.state["pending"][0]
        stamp = datetime(2026, 7, 22, 7, 30, tzinfo=TZ).isoformat()
        engine.apply_remote_doses({key: {"taken_at": stamp, "updated_at": stamp}},
                                  datetime(2026, 7, 22, 7, 35, tzinfo=TZ))

        engine.collect_due(datetime(2026, 7, 22, 7, 50, tzinfo=TZ))

        self.assertEqual(engine.state["pending"], [])


class SyncPayloadTests(unittest.TestCase):
    """F2: the synced payload carries dose state alongside the schedule.

    validate_sync_payload also guards the *decrypt* boundary, so the schedule
    half must stay exactly as strict as validate_schedule was on its own.
    """

    def test_legacy_bare_schedule_is_accepted_and_carries_no_doses(self):
        payload = validate_sync_payload(schedule())
        self.assertEqual(payload["version"], 2)
        self.assertEqual(payload["schedule"], validate_schedule(schedule()))
        self.assertEqual(payload["doses"], {})

    def test_versioned_payload_round_trips_schedule_and_doses(self):
        stamp = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        payload = validate_sync_payload({
            "version": 2,
            "schedule": schedule(),
            "doses": {"2026-07-22|morning": {"taken_at": stamp, "updated_at": stamp}},
        })
        self.assertEqual(payload["schedule"], validate_schedule(schedule()))
        self.assertEqual(payload["doses"]["2026-07-22|morning"]["taken_at"], stamp)

    def test_schedule_half_is_still_validated_strictly(self):
        broken = schedule()
        broken["events"][0]["time"] = "25:99"
        with self.assertRaises(ConfigValidationError):
            validate_sync_payload({"version": 2, "schedule": broken, "doses": {}})

    def test_a_hostile_schedule_cannot_hide_behind_a_valid_dose_map(self):
        with self.assertRaises(ConfigValidationError):
            validate_sync_payload({"version": 2, "schedule": {"timezone": "Nowhere/Fake",
                                                              "events": []}, "doses": {}})

    def test_dose_map_must_be_an_object(self):
        with self.assertRaises(ConfigValidationError):
            validate_sync_payload({"version": 2, "schedule": schedule(), "doses": ["nope"]})

    def test_dose_map_is_size_capped(self):
        stamp = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        huge = {f"2026-07-22|event{index}": {"taken_at": stamp, "updated_at": stamp}
                for index in range(MAX_DOSE_ENTRIES + 1)}
        with self.assertRaises(ConfigValidationError):
            validate_sync_payload({"version": 2, "schedule": schedule(), "doses": huge})

    def test_unusable_dose_entries_are_skipped_without_losing_the_rest(self):
        """One bad entry must not make the whole payload undecryptable — that
        would take sync down entirely rather than degrade it."""
        stamp = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        payload = validate_sync_payload({
            "version": 2,
            "schedule": schedule(),
            "doses": {
                "2026-07-22|morning": {"taken_at": stamp, "updated_at": stamp},
                "rubbish": {"taken_at": stamp, "updated_at": stamp},
                "2026-07-22|evening": "not-an-object",
                "2026-07-22|night": {"taken_at": stamp},  # no updated_at
            },
        })
        self.assertEqual(list(payload["doses"]), ["2026-07-22|morning"])

    def test_dose_map_migrates_legacy_three_part_keys(self):
        stamp = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        payload = validate_sync_payload({
            "version": 2,
            "schedule": schedule(),
            "doses": {"2026-07-22|morning|07:00": {"taken_at": stamp, "updated_at": stamp}},
        })
        self.assertEqual(list(payload["doses"]), ["2026-07-22|morning"])

    def test_an_undo_is_carried_as_a_null_take(self):
        stamp = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        payload = validate_sync_payload({
            "version": 2,
            "schedule": schedule(),
            "doses": {"2026-07-22|morning": {"taken_at": None, "updated_at": stamp}},
        })
        self.assertIsNone(payload["doses"]["2026-07-22|morning"]["taken_at"])


class DoseMergeTests(unittest.TestCase):
    """F2: two devices marking different doses must both survive the merge."""

    @staticmethod
    def _entry(taken_at, updated_at=None):
        return {"taken_at": taken_at, "updated_at": updated_at or taken_at}

    def test_marks_for_different_doses_are_both_kept(self):
        morning = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        evening = datetime(2026, 7, 22, 20, 5, tzinfo=TZ).isoformat()
        merged = merge_dose_maps(
            {"2026-07-22|morning": self._entry(morning)},
            {"2026-07-22|evening": self._entry(evening)},
        )
        self.assertEqual(sorted(merged), ["2026-07-22|evening", "2026-07-22|morning"])

    def test_the_later_update_wins_for_the_same_dose(self):
        early = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        late = datetime(2026, 7, 22, 9, 0, tzinfo=TZ).isoformat()
        merged = merge_dose_maps(
            {"2026-07-22|morning": self._entry(early)},
            {"2026-07-22|morning": self._entry(None, late)},  # undone later, elsewhere
        )
        self.assertIsNone(merged["2026-07-22|morning"]["taken_at"], "the undo was lost")

    def test_an_undo_does_not_resurrect_from_the_other_device(self):
        early = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        late = datetime(2026, 7, 22, 9, 0, tzinfo=TZ).isoformat()
        merged = merge_dose_maps(
            {"2026-07-22|morning": self._entry(None, late)},
            {"2026-07-22|morning": self._entry(early)},
        )
        self.assertIsNone(merged["2026-07-22|morning"]["taken_at"])

    def test_a_recorded_take_wins_an_exact_tie(self):
        stamp = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        merged = merge_dose_maps(
            {"2026-07-22|morning": self._entry(None, stamp)},
            {"2026-07-22|morning": self._entry(stamp, stamp)},
        )
        self.assertEqual(merged["2026-07-22|morning"]["taken_at"], stamp)

    def test_merging_is_order_independent_for_a_tie(self):
        stamp = datetime(2026, 7, 22, 7, 5, tzinfo=TZ).isoformat()
        forward = merge_dose_maps(
            {"2026-07-22|morning": self._entry(stamp, stamp)},
            {"2026-07-22|morning": self._entry(None, stamp)},
        )
        self.assertEqual(forward["2026-07-22|morning"]["taken_at"], stamp)

    def test_entries_older_than_retention_are_pruned(self):
        now = datetime(2026, 7, 22, 12, 0, tzinfo=TZ)
        stale = (now - COMPLETED_RETENTION - timedelta(days=1)).isoformat()
        fresh = (now - timedelta(days=1)).isoformat()
        pruned = prune_dose_map(
            {"2026-07-01|morning": self._entry(stale), "2026-07-21|morning": self._entry(fresh)},
            now,
        )
        self.assertEqual(list(pruned), ["2026-07-21|morning"])


if __name__ == "__main__":
    unittest.main()
