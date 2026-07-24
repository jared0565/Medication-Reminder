from __future__ import annotations

import base64
import json
import secrets
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from medication_core import validate_schedule


SYNC_API = "https://medication-reminder-push.bmorris0565.workers.dev"
APP_URL = "https://medication.bytesfx.com/"
MAX_RESPONSE_BYTES = 128 * 1024


class SyncError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuse HTTP redirects so the Bearer token is never re-sent cross-origin.

    The default opener transparently follows 3xx responses and replays the
    Authorization header to the redirect target, which could leak the pairing
    token to another host. Turning redirects into errors keeps the credential
    on the single expected origin.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise urllib.error.HTTPError(
            req.full_url, code, f"Refusing to follow redirect to {newurl}", headers, fp
        )


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))


def _random_id(length: int = 24) -> str:
    return _b64(secrets.token_bytes(length))


@dataclass(frozen=True)
class RemoteSchedule:
    schedule: dict[str, Any]
    revision: int
    updated_by: str
    claimed: bool


class EncryptedSyncClient:
    def __init__(self, api_url: str = SYNC_API, timeout: float = 10.0) -> None:
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout
        # A private opener that refuses redirects, so the Authorization header
        # cannot be replayed to a different host on a 3xx response.
        self._opener = urllib.request.build_opener(_NoRedirectHandler())

    def _request(self, path: str, *, method: str = "GET", token: str | None = None, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "MedicationReminderWidget/1"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8") if body is not None else None
        request = urllib.request.Request(f"{self.api_url}{path}", data=encoded, headers=headers, method=method)
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise SyncError("The sync service returned an oversized response")
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read(MAX_RESPONSE_BYTES).decode("utf-8"))
                message = str(payload.get("error") or f"Sync request failed ({exc.code})")
            except (UnicodeError, json.JSONDecodeError):
                message = f"Sync request failed ({exc.code})"
            raise SyncError(message, exc.code) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SyncError("The encrypted sync service is unavailable") from exc
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise SyncError("The sync service returned an invalid response") from exc

    @staticmethod
    def pairing_link(credentials: dict[str, Any]) -> str:
        invitation = {"version": 1, "pairId": credentials["pairId"], "token": credentials["token"], "encryptionKey": credentials["encryptionKey"]}
        return f"{APP_URL}#pair={_b64(json.dumps(invitation, separators=(',', ':')).encode('utf-8'))}"

    @staticmethod
    def _encrypt(schedule: dict[str, Any], encoded_key: str) -> dict[str, str]:
        validated = validate_schedule(schedule)
        iv = secrets.token_bytes(12)
        ciphertext = AESGCM(_unb64(encoded_key)).encrypt(iv, json.dumps(validated, separators=(",", ":")).encode("utf-8"), None)
        return {"iv": _b64(iv), "ciphertext": _b64(ciphertext)}

    @staticmethod
    def _decrypt(payload: dict[str, Any], encoded_key: str) -> dict[str, Any]:
        try:
            plain = AESGCM(_unb64(encoded_key)).decrypt(_unb64(str(payload["iv"])), _unb64(str(payload["ciphertext"])), None)
            return validate_schedule(json.loads(plain.decode("utf-8")))
        except Exception as exc:
            raise SyncError("The paired schedule could not be decrypted or validated") from exc

    def create_pair(self, schedule: dict[str, Any], source_id: str) -> dict[str, Any]:
        credentials = {"version": 1, "role": "source", "pairId": _random_id(), "token": _random_id(32), "encryptionKey": _random_id(32), "sourceId": source_id, "deviceId": source_id, "revision": 1, "claimed": False, "dirty": False}
        encrypted = self._encrypt(schedule, credentials["encryptionKey"])
        self._request("/sync/pairs", method="POST", body={"pairId": credentials["pairId"], "sourceId": source_id, "token": credentials["token"], "updatedBy": source_id, **encrypted})
        return credentials

    @staticmethod
    def _revision(payload: Any, key: str = "revision") -> int:
        """Coerce a response revision to int, raising SyncError on a bad shape.

        Guards against a malformed relay response (missing/non-dict/non-numeric)
        killing the caller's worker thread with a raw KeyError/TypeError/ValueError.
        """
        if not isinstance(payload, dict):
            raise SyncError("The sync service returned an invalid response")
        try:
            return int(payload[key])
        except (KeyError, TypeError, ValueError) as exc:
            raise SyncError("The sync service returned an invalid response") from exc

    def fetch(self, credentials: dict[str, Any]) -> RemoteSchedule:
        payload = self._request(f"/sync/pairs/{credentials['pairId']}", token=credentials["token"])
        if not isinstance(payload, dict) or "updatedBy" not in payload:
            raise SyncError("The sync service returned an invalid response")
        return RemoteSchedule(
            self._decrypt(payload, credentials["encryptionKey"]),
            self._revision(payload),
            str(payload["updatedBy"]),
            bool(payload.get("claimed")),
        )

    def update(self, schedule: dict[str, Any], credentials: dict[str, Any], base_revision: int) -> int:
        encrypted = self._encrypt(schedule, credentials["encryptionKey"])
        payload = self._request(f"/sync/pairs/{credentials['pairId']}", method="PUT", token=credentials["token"], body={"baseRevision": base_revision, "updatedBy": credentials["deviceId"], **encrypted})
        return self._revision(payload)

    def revoke(self, credentials: dict[str, Any]) -> None:
        self._request(f"/sync/pairs/{credentials['pairId']}", method="DELETE", token=credentials["token"])
