import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from medication_core import ConfigValidationError, ScheduleEngine, validate_schedule


TZ = ZoneInfo("Europe/London")


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


if __name__ == "__main__":
    unittest.main()
