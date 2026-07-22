# Graph Report - Medication Reminder  (2026-07-22)

## Corpus Check
- 12 files · ~6,662 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 193 nodes · 447 edges · 13 communities (9 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `99a65793`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
6. `$()` - 19 edges
7. `ConfigValidationError` - 18 edges
8. `validate_schedule()` - 14 edges
9. `datetime` - 13 edges
10. `SingleInstance` - 13 edges

## Surprising Connections (you probably didn't know these)
- `DueOccurrence` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `Exception` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `MedicationReminderApp` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `datetime` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `Path` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py

## Import Cycles
- 1-file cycle: `medication_core.py -> medication_core.py`
- 1-file cycle: `medication_reminder.py -> medication_reminder.py`

## Communities (13 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.18
Nodes (10): Build a single Windows EXE, Editing the schedule, Files, Important clinical note, Local-first web app, Main features, Medication Reminder Widget for Windows, Quick start (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (7): DueOccurrence, DueEvent, MedicationReminderApp, Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Toplevel

### Community 2 - "Community 2"
Cohesion: 0.18
Nodes (13): Any, Exception, AppStorage, atomic_write_bytes(), default_data_dir(), default_state(), normalize_state(), ProtectedJsonFile (+5 more)

### Community 3 - "Community 3"
Cohesion: 0.17
Nodes (16): date, ConfigValidationError, event_active(), occurrence_key(), parse_iso_date(), parse_time(), datetime, Raised when the medication schedule does not satisfy its contract. (+8 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (12): author, dependencies, web-push, description, keywords, license, main, name (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.36
Nodes (3): _DataBlob, DpapiProtector, Encrypt application data for the current Windows user via DPAPI.

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (26): DueOccurrence, app_dir(), enable_dpi_awareness(), main(), datetime, Path, Ask Windows to render Tk at the monitor's native DPI., Ask Windows to render Tk at the monitor's native DPI. (+18 more)

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (15): $(), addMedicineInput(), enableNotifications(), esc(), notifiedKeys, openEditor(), renderAll(), renderMedicineInputs() (+7 more)

## Knowledge Gaps
- **27 isolated node(s):** `PreToolUse`, `timezone`, `events`, `seedSchedule`, `notifiedKeys` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MedicationReminderApp` connect `Community 1` to `Community 2`, `Community 3`, `Community 7`?**
  _High betweenness centrality (0.166) - this node is a cross-community bridge._
- **Why does `ScheduleEngine` connect `Community 3` to `Community 1`, `Community 2`, `Community 7`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `StorageError` connect `Community 2` to `Community 1`, `Community 3`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `MedicationReminderApp` (e.g. with `AppStorage` and `ConfigValidationError`) actually correct?**
  _`MedicationReminderApp` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `ScheduleEngine` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`ScheduleEngine` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `StorageError` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`StorageError` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `AppStorage` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`AppStorage` has 7 INFERRED edges - model-reasoned connections that need verification._