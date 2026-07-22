import json
import unittest
from pathlib import Path

from medication_core import validate_schedule
from medication_reminder import MedicationReminderApp


class PairingTests(unittest.TestCase):
    def test_compact_pairing_payload_round_trips_schedule(self) -> None:
        schedule = validate_schedule(
            json.loads(Path("medication_schedule.json").read_text(encoding="utf-8"))
        )
        app = MedicationReminderApp.__new__(MedicationReminderApp)
        app.config_data = schedule

        payload = app._pairing_payload()
        restored = validate_schedule(app._decode_pairing_payload(payload))

        self.assertEqual(restored, schedule)
        self.assertLess(len(payload), 2953)


if __name__ == "__main__":
    unittest.main()
