"""Disposable production smoke test for the encrypted sync relay."""

from __future__ import annotations

import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medication_core import validate_schedule
from sync_client import EncryptedSyncClient, SyncError


def main() -> None:
    client = EncryptedSyncClient()
    schedule = validate_schedule(json.loads(Path("medication_schedule.json").read_text(encoding="utf-8")))
    credentials = client.create_pair(schedule, secrets.token_urlsafe(24))
    try:
        first = client.fetch(credentials)
        assert first.schedule == schedule and first.revision == 1 and not first.claimed
        client._request(f"/sync/pairs/{credentials['pairId']}/claim", method="POST", token=credentials["token"], body={"mobileDeviceId": secrets.token_urlsafe(24)})
        claimed = client.fetch(credentials)
        assert claimed.claimed
        try:
            client._request(f"/sync/pairs/{credentials['pairId']}/claim", method="POST", token=credentials["token"], body={"mobileDeviceId": secrets.token_urlsafe(24)})
            raise AssertionError("A second mobile device was incorrectly accepted")
        except SyncError as exc:
            assert exc.status == 409
        changed = json.loads(json.dumps(schedule))
        changed["events"][0]["label"] += " E2E"
        revision = client.update(changed, credentials, claimed.revision)
        assert revision == 2
        restored = client.fetch(credentials)
        assert restored.schedule["events"][0]["label"].endswith(" E2E")
        print("Encrypted sync E2E passed: create, decrypt, exclusive claim, update, conflict guard, revoke")
    finally:
        client.revoke(credentials)

    allowed = "https://medication.bytesfx.com"
    preflight = urllib.request.Request(f"{client.api_url}/subscriptions", method="OPTIONS", headers={"Origin": allowed, "Access-Control-Request-Method": "POST", "User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(preflight, timeout=10) as response:
            assert response.status == 204 and response.headers.get("Access-Control-Allow-Origin") == allowed
    except urllib.error.HTTPError as exc:
        raise AssertionError(f"Production preflight failed ({exc.code}): {exc.read().decode('utf-8', 'replace')}") from exc
    denied = urllib.request.Request(f"{client.api_url}/subscriptions", method="OPTIONS", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    try:
        urllib.request.urlopen(denied, timeout=10)
        raise AssertionError("An unapproved browser origin was incorrectly accepted")
    except urllib.error.HTTPError as exc:
        assert exc.code == 403
    print("Push CORS E2E passed: production origin allowed, unapproved origin denied")


if __name__ == "__main__":
    main()
