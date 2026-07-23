# Graph Report - Medication Reminder  (2026-07-23)

## Corpus Check
- 51 files · ~30,119 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 687 nodes · 1340 edges · 36 communities (28 shown, 8 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 138 edges (avg confidence: 0.54)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `084671a3`
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
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]

## God Nodes (most connected - your core abstractions)
1. `MedicationReminderApp` - 59 edges
2. `$()` - 33 edges
3. `ScheduleEngine` - 30 edges
4. `QRCode` - 30 edges
5. `StorageError` - 28 edges
6. `AppStorage` - 26 edges
7. `EncryptedSyncClient` - 25 edges
8. `validate_schedule()` - 24 edges
9. `ConfigValidationError` - 22 edges
10. `Any` - 21 edges

## Surprising Connections (you probably didn't know these)
- `DueOccurrence` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `Exception` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `MedicationReminderApp` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `ScheduleEngineTests` --uses--> `ConfigValidationError`  [INFERRED]
  tests/test_medication_core.py → medication_core.py
- `Toplevel` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py

## Import Cycles
- 1-file cycle: `medication_core.py -> medication_core.py`
- 1-file cycle: `medication_reminder.py -> medication_reminder.py`
- 1-file cycle: `vendor/qrcode/image/styles/moduledrawers/svg.py -> vendor/qrcode/image/styles/moduledrawers/svg.py`
- 1-file cycle: `vendor/qrcode/image/svg.py -> vendor/qrcode/image/svg.py`

## Communities (36 total, 8 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.17
Nodes (11): Build a single Windows EXE, Editing the schedule, Files, Important clinical note, Local-first web app, Main features, Medication Reminder Widget for Windows, Pairing a mobile device (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (10): DueOccurrence, DueEvent, MedicationReminderApp, Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls. (+2 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (25): BaseImage, GenericImage, GenericImageLocal, PilImage, PIL image builder, default format is PNG., PyPNGImage, Build an example QR Code and display it.      There's an even easier way than th, run_example() (+17 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (25): Any, date, Exception, AppStorage, atomic_write_bytes(), _DataBlob, default_data_dir(), default_state() (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (12): author, dependencies, web-push, description, keywords, license, main, name (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (33): gexp(), glog(), Polynomial, rs_blocks(), RSBlock, BCH_digit(), BCH_type_info(), BCH_type_number() (+25 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (43): ConfigValidationError, DueOccurrence, parse_iso_date(), parse_time(), Raised when the medication schedule does not satisfy its contract., Validate and normalize untrusted schedule data at the file/UI boundary., _require_text(), validate_schedule() (+35 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (17): Styled PIL image builder, default format is PNG.      This differs from the PilI, StyledPilImage, CircleModuleDrawer, GappedSquareModuleDrawer, HorizontalBarsDrawer, A base class for StyledPilImage module drawers.      NOTE: the color that this d, Draws vertically contiguous groups of modules as long rounded rectangles,     wi, Draws horizontally contiguous groups of modules as long rounded rectangles, (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (14): HorizontalGradiantColorMask, ImageColorMask, QRColorMask, RadialGradiantColorMask, Fills in the foreground with a radial gradient from the center to the edge, Fills in the foreground with a square gradient from the center to the edge, Fills in the foreground with a gradient sweeping from the left to the right, Fills in the forefround with a gradient sweeping from the top to the bottom (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (12): BaseImage, BaseImageWithDrawer, Find whether the referenced module is in an eye., Base QRCode image output class., Draw a single rectangle of the QR code., Draw a single rectangle of the QR code given the surrounding context, Processes QR code after completion, A helper method for pixel-based image generators that specifies the         four (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (11): BaseSvgQRModuleDrawer, Coords, SvgCircleDrawer, SvgPathCircleDrawer, SvgPathQRModuleDrawer, SvgPathSquareDrawer, SvgQRModuleDrawer, SvgSquareDrawer (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (12): SVG image builder with one single <path> element (removes white spaces     betwe, SVG image builder      Creates a QR-code image as a SVG document fragment., An SvgImage that fills the background to white., An SvgPathImage that fills the background to white., A box_size of 10 (default) equals 1mm., Standalone SVG image builder      Creates a QR-code image as a standalone SVG do, SvgFillImage, SvgFragmentImage (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (6): commas(), get_drawer_help(), get_factory(), main(), test_commas(), BaseImage

### Community 18 - "Community 18"
Cohesion: 0.17
Nodes (13): Return a quoted command that starts this app without a console window., Register this user's app for logon startup; never requires elevation., Return a quoted command that starts this app without a console window., Return a quoted command that starts this app without a console window., Return a quoted command that starts this app without a console window., Return a quoted command that starts this app without a console window., Return a quoted command that starts this app without a console window., Register this user's app for logon startup; never requires elevation. (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.33
Nodes (7): This file provides zest.releaser entrypoints using when releasing new qrcode ver, Update the version in the manpage document., update_manpage(), test_change(), test_invalid_data(), test_no_change(), test_not_qrcode()

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (26): $(), addMedicineInput(), bridge, checkForegroundNotifications(), clearPrematureTaken(), enableNotifications(), esc(), localDateKey() (+18 more)

### Community 35 - "Community 35"
Cohesion: 0.25
Nodes (22): acceptPairing(), api(), b64(), copyPairLink(), copyText(), createPair(), credentials(), decryptSchedule() (+14 more)

### Community 36 - "Community 36"
Cohesion: 0.33
Nodes (12): ALLOWED_ORIGINS, authenticatedPair(), corsHeaders(), enforceRateLimit(), fetch(), handleSync(), json(), notifyPairedMobile() (+4 more)

## Knowledge Gaps
- **35 isolated node(s):** `PreToolUse`, `timezone`, `events`, `BaseImage`, `SvgImageWhite` (+30 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ConfigValidationError` connect `Community 7` to `Community 1`, `Community 2`, `Community 3`?**
  _High betweenness centrality (0.133) - this node is a cross-community bridge._
- **Why does `ActiveWithNeighbors` connect `Community 10` to `Community 2`, `Community 12`, `Community 14`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Why does `StyledPilImage` connect `Community 10` to `Community 11`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `MedicationReminderApp` (e.g. with `AppStorage` and `ConfigValidationError`) actually correct?**
  _`MedicationReminderApp` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `ScheduleEngine` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`ScheduleEngine` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `QRCode` (e.g. with `BaseImage` and `BaseImageWithDrawer`) actually correct?**
  _`QRCode` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `StorageError` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`StorageError` has 11 INFERRED edges - model-reasoned connections that need verification._