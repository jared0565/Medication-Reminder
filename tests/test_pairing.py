import json
import unittest
from pathlib import Path

from medication_core import validate_schedule
from sync_client import EncryptedSyncClient


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


if __name__ == "__main__":
    unittest.main()
