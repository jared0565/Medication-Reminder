import tempfile
import unittest
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from medication_core import (
    AppStorage,
    ConfigValidationError,
    ScheduleEngine,
    StorageError,
    occurrence_key,
    sanitize_csv_cell,
    validate_schedule,
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


if __name__ == "__main__":
    unittest.main()
