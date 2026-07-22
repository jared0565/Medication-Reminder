# Graph Report - Medication Reminder  (2026-07-22)

## Corpus Check
- 17 files · ~153,076 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 181 nodes · 424 edges · 24 communities (20 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]

## God Nodes (most connected - your core abstractions)
1. `MedicationReminderApp` - 39 edges
2. `ScheduleEngine` - 26 edges
3. `StorageError` - 22 edges
4. `Any` - 19 edges
5. `AppStorage` - 19 edges
6. `ConfigValidationError` - 18 edges
7. `$()` - 15 edges
8. `validate_schedule()` - 14 edges
9. `datetime` - 13 edges
10. `DueOccurrence` - 12 edges

## Surprising Connections (you probably didn't know these)
- `DueOccurrence` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `MedicationReminderApp` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `SingleInstance` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `ScheduleEngineTests` --uses--> `ConfigValidationError`  [INFERRED]
  tests/test_medication_core.py → medication_core.py
- `Toplevel` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py

## Import Cycles
- 1-file cycle: `medication_core.py -> medication_core.py`
- 1-file cycle: `medication_reminder.py -> medication_reminder.py`

## Communities (24 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.18
Nodes (10): Build a single Windows EXE, Editing the schedule, Files, Important clinical note, Local-first web app, Main features, Medication Reminder Widget for Windows, Quick start (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.14
Nodes (6): DueOccurrence, DueEvent, MedicationReminderApp, Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Toplevel

### Community 2 - "Community 2"
Cohesion: 0.19
Nodes (12): Any, AppStorage, atomic_write_bytes(), default_data_dir(), default_state(), normalize_state(), ProtectedJsonFile, Protector (+4 more)

### Community 3 - "Community 3"
Cohesion: 0.20
Nodes (9): date, event_active(), occurrence_key(), datetime, _safe_datetime(), ScheduleEngine, schedule(), ScheduleEngineTests (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (23): Exception, ConfigValidationError, DueOccurrence, parse_iso_date(), parse_time(), Raised when the medication schedule does not satisfy its contract., Validate and normalize untrusted schedule data at the file/UI boundary., _require_text() (+15 more)

### Community 5 - "Community 5"
Cohesion: 0.36
Nodes (3): _DataBlob, DpapiProtector, Encrypt application data for the current Windows user via DPAPI.

### Community 7 - "Community 7"
Cohesion: 0.22
Nodes (7): main(), Prevent duplicate reminder processes using a per-user Windows mutex., Prevent duplicate reminder processes using a per-user Windows mutex., Prevent duplicate reminder processes using a per-user Windows mutex., show_startup_error(), SingleInstance, RuntimeError

### Community 22 - "Community 22"
Cohesion: 0.23
Nodes (12): $(), addMedicineInput(), esc(), openEditor(), renderAll(), renderMedicineInputs(), renderSchedules(), renderToday() (+4 more)

## Knowledge Gaps
- **16 isolated node(s):** `PreToolUse`, `timezone`, `events`, `seedSchedule`, `ASSETS` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MedicationReminderApp` connect `Community 1` to `Community 2`, `Community 3`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.177) - this node is a cross-community bridge._
- **Why does `ScheduleEngine` connect `Community 3` to `Community 1`, `Community 2`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `StorageError` connect `Community 2` to `Community 1`, `Community 4`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `MedicationReminderApp` (e.g. with `AppStorage` and `ConfigValidationError`) actually correct?**
  _`MedicationReminderApp` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ScheduleEngine` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`ScheduleEngine` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `StorageError` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`StorageError` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `AppStorage` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`AppStorage` has 7 INFERRED edges - model-reasoned connections that need verification._