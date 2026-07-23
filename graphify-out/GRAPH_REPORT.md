# Graph Report - Medication Reminder  (2026-07-23)

## Corpus Check
- 48 files · ~26,885 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 613 nodes · 1095 edges · 40 communities (31 shown, 9 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 100 edges (avg confidence: 0.55)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `20c7d16a`
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
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]

## God Nodes (most connected - your core abstractions)
1. `MedicationReminderApp` - 48 edges
2. `$()` - 32 edges
3. `QRCode` - 30 edges
4. `ScheduleEngine` - 28 edges
5. `StorageError` - 24 edges
6. `AppStorage` - 21 edges
7. `ConfigValidationError` - 20 edges
8. `Any` - 19 edges
9. `Any` - 19 edges
10. `validate_schedule()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `DueOccurrence` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `MedicationReminderApp` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `SingleInstance` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `Toplevel` --uses--> `ConfigValidationError`  [INFERRED]
  medication_reminder.py → medication_core.py
- `DueOccurrence` --uses--> `StorageError`  [INFERRED]
  medication_reminder.py → medication_core.py

## Import Cycles
- 1-file cycle: `medication_core.py -> medication_core.py`
- 1-file cycle: `medication_reminder.py -> medication_reminder.py`
- 1-file cycle: `vendor/qrcode/image/styles/moduledrawers/svg.py -> vendor/qrcode/image/styles/moduledrawers/svg.py`
- 1-file cycle: `vendor/qrcode/image/svg.py -> vendor/qrcode/image/svg.py`

## Communities (40 total, 9 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.18
Nodes (10): Build a single Windows EXE, Editing the schedule, Files, Important clinical note, Local-first web app, Main features, Medication Reminder Widget for Windows, Quick start (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (9): DueOccurrence, DueEvent, MedicationReminderApp, Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls., Apply a bright, friendly palette while preserving native Tk controls. (+1 more)

### Community 2 - "Community 2"
Cohesion: 0.16
Nodes (7): QRCode, Compile the data into a QR Code array.          :param fit: If ``True`` (or if a, Find the minimum size required to fit in the data., Find the most efficient mask pattern., Output the QR Code only using TTY colors.          If the data has not been comp, Output the QR Code using ASCII characters.          :param tty: use fixed TTY co, Return the QR Code as a multidimensional array, including the border.          T

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (43): Any, date, Exception, AppStorage, atomic_write_bytes(), ConfigValidationError, _DataBlob, default_data_dir() (+35 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (12): author, dependencies, web-push, description, keywords, license, main, name (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (33): gexp(), glog(), Polynomial, rs_blocks(), RSBlock, BCH_digit(), BCH_type_info(), BCH_type_number() (+25 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (10): main(), Prevent duplicate reminder processes using a per-user Windows mutex., Prevent duplicate reminder processes using a per-user Windows mutex., Prevent duplicate reminder processes using a per-user Windows mutex., Prevent duplicate reminder processes using a per-user Windows mutex., Prevent duplicate reminder processes using a per-user Windows mutex., Prevent duplicate reminder processes using a per-user Windows mutex., show_startup_error() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (17): Styled PIL image builder, default format is PNG.      This differs from the PilI, StyledPilImage, CircleModuleDrawer, GappedSquareModuleDrawer, HorizontalBarsDrawer, A base class for StyledPilImage module drawers.      NOTE: the color that this d, Draws vertically contiguous groups of modules as long rounded rectangles,     wi, Draws horizontally contiguous groups of modules as long rounded rectangles, (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (14): HorizontalGradiantColorMask, ImageColorMask, QRColorMask, RadialGradiantColorMask, Fills in the foreground with a radial gradient from the center to the edge, Fills in the foreground with a square gradient from the center to the edge, Fills in the foreground with a gradient sweeping from the left to the right, Fills in the forefround with a gradient sweeping from the top to the bottom (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.10
Nodes (10): BaseImage, Find whether the referenced module is in an eye., Base QRCode image output class., Draw a single rectangle of the QR code., Draw a single rectangle of the QR code given the surrounding context, Processes QR code after completion, A helper method for pixel-based image generators that specifies the         four, Build the image class. Subclasses should return the class created. (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (10): BaseSvgQRModuleDrawer, Coords, SvgCircleDrawer, SvgPathCircleDrawer, SvgPathQRModuleDrawer, SvgPathSquareDrawer, SvgQRModuleDrawer, SvgSquareDrawer (+2 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (12): SVG image builder with one single <path> element (removes white spaces     betwe, SVG image builder      Creates a QR-code image as a SVG document fragment., An SvgImage that fills the background to white., An SvgPathImage that fills the background to white., A box_size of 10 (default) equals 1mm., Standalone SVG image builder      Creates a QR-code image as a standalone SVG do, SvgFillImage, SvgFragmentImage (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (6): commas(), get_drawer_help(), get_factory(), main(), test_commas(), BaseImage

### Community 18 - "Community 18"
Cohesion: 0.17
Nodes (12): Return a quoted command that starts this app without a console window., Register this user's app for logon startup; never requires elevation., Return a quoted command that starts this app without a console window., Return a quoted command that starts this app without a console window., Return a quoted command that starts this app without a console window., Return a quoted command that starts this app without a console window., Register this user's app for logon startup; never requires elevation., Register this user's app for logon startup; never requires elevation. (+4 more)

### Community 19 - "Community 19"
Cohesion: 0.33
Nodes (7): This file provides zest.releaser entrypoints using when releasing new qrcode ver, Update the version in the manpage document., update_manpage(), test_change(), test_invalid_data(), test_no_change(), test_not_qrcode()

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (25): fetch(), $(), addMedicineInput(), bridge, clearPrematureTaken(), enableNotifications(), esc(), localDateKey() (+17 more)

### Community 34 - "Community 34"
Cohesion: 0.40
Nodes (5): enable_dpi_awareness(), Ask Windows to render Tk at the monitor's native DPI., Ask Windows to render Tk at the monitor's native DPI., Ask Windows to render Tk at the monitor's native DPI., Ask Windows to render Tk at the monitor's native DPI.

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (8): BaseImage, GenericImage, GenericImageLocal, PyPNGImage, _check_border(), _check_box_size(), Reset the internal data., Make an image from the QR Code data.          If the data has not been compiled

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (3): PilImage, PIL image builder, default format is PNG., ActiveWithNeighbors

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (4): _check_mask_pattern(), copy_2d_array(), make(), Add data to this QR Code.          :param optimize: Data will be split into mult

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (3): Build an example QR Code and display it.      There's an even easier way than th, run_example(), test_example()

## Knowledge Gaps
- **33 isolated node(s):** `PreToolUse`, `timezone`, `events`, `BaseImage`, `SvgImageWhite` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ActiveWithNeighbors` connect `Community 36` to `Community 35`, `Community 37`, `Community 38`, `Community 10`, `Community 12`, `Community 14`?**
  _High betweenness centrality (0.154) - this node is a cross-community bridge._
- **Why does `ConfigValidationError` connect `Community 3` to `Community 1`, `Community 7`?**
  _High betweenness centrality (0.139) - this node is a cross-community bridge._
- **Why does `StyledPilImage` connect `Community 10` to `Community 11`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `MedicationReminderApp` (e.g. with `AppStorage` and `ConfigValidationError`) actually correct?**
  _`MedicationReminderApp` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `QRCode` (e.g. with `BaseImage` and `BaseImageWithDrawer`) actually correct?**
  _`QRCode` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `ScheduleEngine` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`ScheduleEngine` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `StorageError` (e.g. with `DueOccurrence` and `Exception`) actually correct?**
  _`StorageError` has 9 INFERRED edges - model-reasoned connections that need verification._