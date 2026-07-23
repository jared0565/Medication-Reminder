from __future__ import annotations

import csv
import ctypes
import json
import os
import re
import tempfile
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


APP_DATA_FOLDER = "MedicationReminder"
MAX_CONFIG_BYTES = 1_000_000
MAX_PROTECTED_BYTES = 20_000_000
MAX_CATCH_UP = timedelta(hours=24)
COMPLETED_RETENTION = timedelta(days=14)
AUDIT_RETENTION = timedelta(days=730)
MAX_AUDIT_RECORDS = 20_000
VALID_DAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
EVENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")


class ConfigValidationError(ValueError):
    """Raised when the medication schedule does not satisfy its contract."""


class StorageError(RuntimeError):
    """Raised when protected application data cannot be read or written."""


class Protector(Protocol):
    def protect(self, data: bytes) -> bytes: ...

    def unprotect(self, data: bytes) -> bytes: ...


def parse_iso_date(value: str, field_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ConfigValidationError(f"{field_name} must use YYYY-MM-DD format") from exc


def parse_time(value: str, field_name: str = "time") -> time:
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise ConfigValidationError(f"{field_name} must use 24-hour HH:MM format")
    return time.fromisoformat(value)


def _require_text(value: Any, field_name: str, max_length: int, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ConfigValidationError(f"{field_name} must be text")
    normalized = value.strip()
    if not allow_empty and not normalized:
        raise ConfigValidationError(f"{field_name} cannot be empty")
    if len(normalized) > max_length:
        raise ConfigValidationError(f"{field_name} cannot exceed {max_length} characters")
    return normalized


def validate_schedule(data: Any) -> dict[str, Any]:
    """Validate and normalize untrusted schedule data at the file/UI boundary."""
    if not isinstance(data, dict):
        raise ConfigValidationError("The schedule root must be a JSON object")

    timezone_name = _require_text(data.get("timezone"), "timezone", 100)
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ConfigValidationError(f"Unknown timezone: {timezone_name}") from exc

    raw_events = data.get("events")
    if not isinstance(raw_events, list):
        raise ConfigValidationError("events must be a JSON array")
    if len(raw_events) > 500:
        raise ConfigValidationError("events cannot contain more than 500 reminders")

    normalized_events: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, raw_event in enumerate(raw_events):
        prefix = f"events[{index}]"
        if not isinstance(raw_event, dict):
            raise ConfigValidationError(f"{prefix} must be an object")

        event_id = _require_text(raw_event.get("id"), f"{prefix}.id", 100)
        if not EVENT_ID_PATTERN.fullmatch(event_id):
            raise ConfigValidationError(
                f"{prefix}.id may contain only letters, numbers, dots, underscores, and hyphens"
            )
        if event_id in seen_ids:
            raise ConfigValidationError(f"Duplicate event id: {event_id}")
        seen_ids.add(event_id)

        enabled = raw_event.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ConfigValidationError(f"{prefix}.enabled must be true or false")

        time_text = raw_event.get("time")
        parse_time(time_text, f"{prefix}.time")
        label = _require_text(raw_event.get("label"), f"{prefix}.label", 200)
        instructions = _require_text(
            raw_event.get("instructions", ""), f"{prefix}.instructions", 2_000, allow_empty=True
        )

        medicines = raw_event.get("medicines")
        if not isinstance(medicines, list) or not medicines:
            raise ConfigValidationError(f"{prefix}.medicines must contain at least one item")
        if len(medicines) > 100:
            raise ConfigValidationError(f"{prefix}.medicines cannot contain more than 100 items")
        normalized_medicines = [
            _require_text(item, f"{prefix}.medicines[{item_index}]", 500)
            for item_index, item in enumerate(medicines)
        ]

        days = raw_event.get("days", ["daily"])
        if not isinstance(days, list) or not days:
            raise ConfigValidationError(f"{prefix}.days must contain daily or weekday names")
        normalized_days = []
        for day_value in days:
            normalized_day = _require_text(day_value, f"{prefix}.days", 10).lower()
            if normalized_day != "daily" and normalized_day not in VALID_DAYS:
                raise ConfigValidationError(f"{prefix}.days contains an invalid weekday: {normalized_day}")
            if normalized_day not in normalized_days:
                normalized_days.append(normalized_day)
        if "daily" in normalized_days and len(normalized_days) > 1:
            raise ConfigValidationError(f"{prefix}.days cannot combine daily with named weekdays")

        start_date = raw_event.get("start_date")
        end_date = raw_event.get("end_date")
        parsed_start = parse_iso_date(start_date, f"{prefix}.start_date") if start_date else None
        parsed_end = parse_iso_date(end_date, f"{prefix}.end_date") if end_date else None
        if parsed_start and parsed_end and parsed_end < parsed_start:
            raise ConfigValidationError(f"{prefix}.end_date cannot be before start_date")

        normalized_events.append(
            {
                "id": event_id,
                "enabled": enabled,
                "time": time_text,
                "label": label,
                "medicines": normalized_medicines,
                "instructions": instructions,
                "days": normalized_days,
                "start_date": parsed_start.isoformat() if parsed_start else None,
                "end_date": parsed_end.isoformat() if parsed_end else None,
            }
        )

    return {"timezone": timezone_name, "events": normalized_events}


def event_active(event: dict[str, Any], target_date: date) -> bool:
    if not event["enabled"]:
        return False
    weekday = target_date.strftime("%a").lower()[:3]
    allowed_days = event["days"]
    if "daily" not in allowed_days and weekday not in allowed_days:
        return False
    if event["start_date"] and target_date < date.fromisoformat(event["start_date"]):
        return False
    if event["end_date"] and target_date > date.fromisoformat(event["end_date"]):
        return False
    return True


def occurrence_key(target_date: date, event: dict[str, Any]) -> str:
    return f"{target_date.isoformat()}|{event['id']}|{event['time']}"


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, prefix=f".{path.name}.", delete=False) as f:
            temp_path = Path(f.name)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, path)
    except OSError as exc:
        raise StorageError(f"Could not safely write {path.name}") from exc
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


class DpapiProtector:
    """Encrypt application data for the current Windows user via DPAPI."""

    _DESCRIPTION = "Medication Reminder protected data"
    _CRYPTPROTECT_UI_FORBIDDEN = 0x01

    def __init__(self) -> None:
        if os.name != "nt":
            raise StorageError("Protected storage requires Windows DPAPI")
        self._crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
        self._kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._configure_functions()

    def _configure_functions(self) -> None:
        self._crypt32.CryptProtectData.argtypes = [
            ctypes.POINTER(_DataBlob), ctypes.c_wchar_p, ctypes.POINTER(_DataBlob), ctypes.c_void_p,
            ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(_DataBlob),
        ]
        self._crypt32.CryptProtectData.restype = ctypes.c_bool
        self._crypt32.CryptUnprotectData.argtypes = [
            ctypes.POINTER(_DataBlob), ctypes.POINTER(ctypes.c_wchar_p), ctypes.POINTER(_DataBlob),
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(_DataBlob),
        ]
        self._crypt32.CryptUnprotectData.restype = ctypes.c_bool
        self._kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        self._kernel32.LocalFree.restype = ctypes.c_void_p

    @staticmethod
    def _input_blob(data: bytes) -> tuple[_DataBlob, Any]:
        buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
        return _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer

    def _transform(self, data: bytes, *, encrypt: bool) -> bytes:
        if not data:
            raise StorageError("Refusing to protect or unprotect empty data")
        input_blob, input_buffer = self._input_blob(data)
        output_blob = _DataBlob()
        del input_buffer  # the blob retains the allocation for the duration of this call
        if encrypt:
            success = self._crypt32.CryptProtectData(
                ctypes.byref(input_blob), self._DESCRIPTION, None, None, None,
                self._CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output_blob),
            )
        else:
            description = ctypes.c_wchar_p()
            success = self._crypt32.CryptUnprotectData(
                ctypes.byref(input_blob), ctypes.byref(description), None, None, None,
                self._CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(output_blob),
            )
            if description:
                self._kernel32.LocalFree(description)
        if not success:
            error_code = ctypes.get_last_error()
            raise StorageError(f"Windows could not {'encrypt' if encrypt else 'decrypt'} application data ({error_code})")
        try:
            return ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            self._kernel32.LocalFree(output_blob.pbData)

    def protect(self, data: bytes) -> bytes:
        return self._transform(data, encrypt=True)

    def unprotect(self, data: bytes) -> bytes:
        return self._transform(data, encrypt=False)


class ProtectedJsonFile:
    def __init__(self, path: Path, protector: Protector) -> None:
        self.path = path
        self.protector = protector

    def exists(self) -> bool:
        return self.path.is_file()

    def load(self) -> Any:
        try:
            if self.path.stat().st_size > MAX_PROTECTED_BYTES:
                raise StorageError(f"{self.path.name} exceeds the safe size limit")
            protected = self.path.read_bytes()
            plain = self.protector.unprotect(protected)
            return json.loads(plain.decode("utf-8"))
        except StorageError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise StorageError(f"Could not read protected file {self.path.name}") from exc

    def save(self, value: Any) -> None:
        try:
            plain = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            protected = self.protector.protect(plain)
            atomic_write_bytes(self.path, protected)
        except StorageError:
            raise
        except (TypeError, ValueError) as exc:
            raise StorageError(f"Could not serialize {self.path.name}") from exc


def default_data_dir() -> Path:
    override = os.environ.get("MEDICATION_REMINDER_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise StorageError("LOCALAPPDATA is unavailable; cannot create protected user storage")
    return Path(local_app_data) / APP_DATA_FOLDER


class AppStorage:
    def __init__(self, data_dir: Path | None = None, protector: Protector | None = None) -> None:
        self.data_dir = (data_dir or default_data_dir()).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        selected_protector = protector or DpapiProtector()
        self.schedule_file = ProtectedJsonFile(self.data_dir / "schedule.dat", selected_protector)
        self.state_file = ProtectedJsonFile(self.data_dir / "state.dat", selected_protector)
        self.audit_file = ProtectedJsonFile(self.data_dir / "audit.dat", selected_protector)
        self.settings_file = ProtectedJsonFile(self.data_dir / "settings.dat", selected_protector)
        self.sync_file = ProtectedJsonFile(self.data_dir / "sync.dat", selected_protector)

    def load_sync_credentials(self) -> dict[str, Any] | None:
        if not self.sync_file.exists():
            return None
        value = self.sync_file.load()
        required = {"version", "role", "pairId", "token", "encryptionKey", "sourceId", "deviceId", "revision"}
        if not isinstance(value, dict) or value.get("version") != 1 or not required.issubset(value):
            raise StorageError("The protected pairing credentials have an invalid structure")
        return value

    def save_sync_credentials(self, credentials: dict[str, Any]) -> None:
        self.sync_file.save(credentials)

    def delete_sync_credentials(self) -> None:
        try:
            self.sync_file.path.unlink(missing_ok=True)
        except OSError as exc:
            raise StorageError("Could not remove protected pairing credentials") from exc

    def load_settings(self) -> dict[str, Any]:
        if not self.settings_file.exists():
            return {"volume": 70, "sound": "chime"}
        value = self.settings_file.load()
        if not isinstance(value, dict):
            raise StorageError("The protected alert settings have an invalid structure")
        legacy = {"SystemExclamation": "chime", "SystemAsterisk": "bright", "SystemHand": "urgent", "SystemQuestion": "warm", "SystemInformation": "quiet"}
        sound = legacy.get(str(value.get("sound", "chime")), str(value.get("sound", "chime")))
        if sound not in {"chime", "bright", "warm", "urgent", "quiet"}:
            sound = "chime"
        return {"volume": max(0, min(100, int(value.get("volume", 70)))), "sound": sound}

    def save_settings(self, settings: dict[str, Any]) -> None:
        sound = str(settings.get("sound", "chime"))
        sound = {"SystemExclamation": "chime", "SystemAsterisk": "bright", "SystemHand": "urgent", "SystemQuestion": "warm", "SystemInformation": "quiet"}.get(sound, sound)
        if sound not in {"chime", "bright", "warm", "urgent", "quiet"}:
            sound = "chime"
        normalized = {"volume": max(0, min(100, int(settings.get("volume", 70)))), "sound": sound}
        self.settings_file.save(normalized)

    def load_schedule(self, seed_path: Path) -> dict[str, Any]:
        if self.schedule_file.exists():
            return validate_schedule(self.schedule_file.load())
        try:
            if seed_path.stat().st_size > MAX_CONFIG_BYTES:
                raise ConfigValidationError("The seed schedule exceeds the safe size limit")
            seed = json.loads(seed_path.read_text(encoding="utf-8"))
        except ConfigValidationError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ConfigValidationError("Could not read the bundled medication schedule") from exc
        validated = validate_schedule(seed)
        self.schedule_file.save(validated)
        return validated

    def save_schedule(self, schedule: Any) -> dict[str, Any]:
        validated = validate_schedule(schedule)
        self.schedule_file.save(validated)
        return validated

    def load_state(self, now: datetime) -> dict[str, Any]:
        if not self.state_file.exists():
            state = default_state(now)
            self.state_file.save(state)
            return state
        return normalize_state(self.state_file.load(), now)

    def save_state(self, state: dict[str, Any]) -> None:
        self.state_file.save(state)

    def append_audit(self, action: str, now: datetime, **details: Any) -> None:
        records = self.audit_file.load() if self.audit_file.exists() else []
        if not isinstance(records, list):
            raise StorageError("The protected audit log has an invalid structure")
        cutoff = now - AUDIT_RETENTION
        retained = [
            record for record in records
            if isinstance(record, dict) and _safe_datetime(record.get("timestamp"), now) >= cutoff
        ]
        retained.append({"timestamp": now.isoformat(timespec="seconds"), "action": action, **details})
        self.audit_file.save(retained[-MAX_AUDIT_RECORDS:])

    def export_taken_csv(self, destination: Path) -> int:
        records = self.audit_file.load() if self.audit_file.exists() else []
        taken = [record for record in records if isinstance(record, dict) and record.get("action") == "medication_taken"]
        destination = destination.resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", newline="", dir=destination.parent,
                prefix=f".{destination.name}.", delete=False,
            ) as f:
                temp_path = Path(f.name)
                writer = csv.writer(f)
                writer.writerow(["timestamp", "status", "event_id", "label", "scheduled_time", "items"])
                for record in taken:
                    writer.writerow([
                        record.get("timestamp", ""), "TAKEN", record.get("event_id", ""),
                        record.get("label", ""), record.get("scheduled_time", ""),
                        " | ".join(record.get("items", [])),
                    ])
                f.flush()
                os.fsync(f.fileno())
            os.replace(temp_path, destination)
        except OSError as exc:
            raise StorageError("Could not export the medication log") from exc
        finally:
            if temp_path and temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
        return len(taken)


def _safe_datetime(value: Any, fallback: datetime) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return fallback
        return parsed.astimezone(fallback.tzinfo)
    except (TypeError, ValueError):
        return fallback


def default_state(now: datetime) -> dict[str, Any]:
    if now.tzinfo is None:
        raise ValueError("Scheduler timestamps must be timezone-aware")
    return {
        "version": 1,
        "last_check_at": now.isoformat(),
        "pending": [],
        "completed": {},
        "snoozed_until": {},
    }


def normalize_state(raw: Any, now: datetime) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise StorageError("The protected scheduler state has an unsupported format")
    state = default_state(now)
    state["last_check_at"] = _safe_datetime(raw.get("last_check_at"), now).isoformat()
    if isinstance(raw.get("pending"), list):
        state["pending"] = [key for key in raw["pending"] if isinstance(key, str) and key.count("|") == 2]
    if isinstance(raw.get("completed"), dict):
        state["completed"] = {
            key: value for key, value in raw["completed"].items()
            if isinstance(key, str) and isinstance(value, str)
        }
    if isinstance(raw.get("snoozed_until"), dict):
        state["snoozed_until"] = {
            key: value for key, value in raw["snoozed_until"].items()
            if isinstance(key, str) and isinstance(value, str)
        }
    return state


@dataclass(frozen=True)
class DueOccurrence:
    key: str
    event_id: str
    label: str
    time_text: str
    medicines: list[str]
    instructions: str
    scheduled_at: datetime

    @property
    def overdue(self) -> bool:
        return False  # UI determines this relative to its current clock.


class ScheduleEngine:
    def __init__(self, schedule: dict[str, Any], state: dict[str, Any]) -> None:
        self.schedule = validate_schedule(schedule)
        self.timezone = ZoneInfo(self.schedule["timezone"])
        self.state = deepcopy(state)

    def replace_schedule(self, schedule: dict[str, Any]) -> None:
        self.schedule = validate_schedule(schedule)
        self.timezone = ZoneInfo(self.schedule["timezone"])
        self._drop_invalid_pending()

    def collect_due(self, now: datetime) -> int:
        now = self._localize(now)
        last_check = _safe_datetime(self.state.get("last_check_at"), now).astimezone(self.timezone)
        if last_check > now:
            last_check = now
        if now - last_check > MAX_CATCH_UP:
            last_check = now - MAX_CATCH_UP

        known = set(self.state["pending"]) | set(self.state["completed"])
        added = 0
        day_cursor = last_check.date()
        while day_cursor <= now.date():
            for event in self.schedule["events"]:
                if not event_active(event, day_cursor):
                    continue
                event_time = parse_time(event["time"])
                scheduled_at = datetime.combine(day_cursor, event_time, tzinfo=self.timezone)
                key = occurrence_key(day_cursor, event)
                if last_check < scheduled_at <= now and key not in known:
                    self.state["pending"].append(key)
                    known.add(key)
                    added += 1
            day_cursor += timedelta(days=1)

        self.state["pending"] = sorted(set(self.state["pending"]))
        self.state["last_check_at"] = now.isoformat()
        self._cleanup(now)
        return added

    def next_ready(self, now: datetime) -> DueOccurrence | None:
        now = self._localize(now)
        self._drop_invalid_pending()
        for key in list(self.state["pending"]):
            snooze_text = self.state["snoozed_until"].get(key)
            if snooze_text and _safe_datetime(snooze_text, now).astimezone(self.timezone) > now:
                continue
            occurrence = self.resolve(key)
            if occurrence:
                return occurrence
        return None

    def resolve(self, key: str) -> DueOccurrence | None:
        try:
            date_text, event_id, time_text = key.split("|", 2)
            target_date = date.fromisoformat(date_text)
        except ValueError:
            return None
        event = next(
            (candidate for candidate in self.schedule["events"] if candidate["id"] == event_id and candidate["time"] == time_text),
            None,
        )
        if not event or not event_active(event, target_date):
            return None
        scheduled_at = datetime.combine(target_date, parse_time(time_text), tzinfo=self.timezone)
        return DueOccurrence(
            key=key,
            event_id=event_id,
            label=event["label"],
            time_text=time_text,
            medicines=list(event["medicines"]),
            instructions=event["instructions"],
            scheduled_at=scheduled_at,
        )

    def mark_taken(self, key: str, now: datetime) -> None:
        now = self._localize(now)
        self.state["pending"] = [pending for pending in self.state["pending"] if pending != key]
        self.state["snoozed_until"].pop(key, None)
        self.state["completed"][key] = now.isoformat()
        self._cleanup(now)

    def snooze(self, key: str, now: datetime, minutes: int) -> datetime:
        if key not in self.state["pending"]:
            raise ValueError("Only a pending reminder can be snoozed")
        until = self._localize(now) + timedelta(minutes=minutes)
        self.state["snoozed_until"][key] = until.isoformat()
        return until

    def next_scheduled(self, now: datetime, days: int = 8) -> tuple[datetime, str] | None:
        now = self._localize(now)
        candidates: list[tuple[datetime, str]] = []
        for offset in range(days):
            target_date = now.date() + timedelta(days=offset)
            for event in self.schedule["events"]:
                if not event_active(event, target_date):
                    continue
                candidate = datetime.combine(target_date, parse_time(event["time"]), tzinfo=self.timezone)
                if candidate >= now:
                    candidates.append((candidate, event["label"]))
        return min(candidates, key=lambda item: item[0]) if candidates else None

    def _drop_invalid_pending(self) -> None:
        valid = [key for key in self.state["pending"] if self.resolve(key) is not None]
        removed = set(self.state["pending"]) - set(valid)
        self.state["pending"] = valid
        for key in removed:
            self.state["snoozed_until"].pop(key, None)

    def _cleanup(self, now: datetime) -> None:
        completed_cutoff = now - COMPLETED_RETENTION
        self.state["completed"] = {
            key: value for key, value in self.state["completed"].items()
            if _safe_datetime(value, now).astimezone(self.timezone) >= completed_cutoff
        }
        pending_keys = set(self.state["pending"])
        self.state["snoozed_until"] = {
            key: value for key, value in self.state["snoozed_until"].items() if key in pending_keys
        }

    def _localize(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Scheduler timestamps must be timezone-aware")
        return value.astimezone(self.timezone)
