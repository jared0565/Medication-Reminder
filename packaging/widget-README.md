# Medication Reminder Widget for Windows

A lightweight Windows tray application that reminds you when a dose is due and
keeps its state in step with the web app.

## Main features

- Runs in the Windows system tray
- Checks the medication schedule automatically
- Plays an audible Windows alert when medication is due
- Displays an always-on-top reminder window
- Shows the medication names and timing instructions
- Includes **Taken** and **Snooze 10 min** buttons
- Saves completed reminders to `medication_log.csv`
- Allows reminders to be enabled, disabled, or edited
- Includes a test-reminder button
- Pairs with the web app so a dose marked on one device shows on the other

## Important clinical note

This program is an organisational aid, not a medical device. Your prescriber's
latest instructions always take priority. Check the schedule whenever a medicine
is started, stopped, or changed, and disable any temporary course when it ends.

## Quick start

1. Install Python 3.11 or newer for Windows.
2. Double-click `install_dependencies.bat`.
3. Double-click `run_medication_reminder.bat`.
4. In the application, select **Test reminder**.
5. Select **Minimize to tray**.

The app must remain running for reminders to appear.

## Upgrading from an earlier package

Replace **all** of the `.py` files, not just `medication_reminder.py`. This
version is split across three modules and a partial copy will not start:

- `medication_reminder.py`
- `medication_core.py`
- `sync_client.py`

Keep your own `medication_schedule.json` — the copy in this package is an empty
starting schedule and will overwrite yours if you let it. The application must be
fully closed and restarted for the new code to take effect; a widget left running
in the tray keeps using the version it started with.

## Build a single Windows EXE

1. Run `install_dependencies.bat`.
2. Run `build_windows_exe.bat`.
3. The executable will be created inside the `dist` folder.

Copy these files into the same folder as the EXE:

- `medication_schedule.json`
- `medication_icon.ico`

## Start automatically with Windows

After confirming the program works:

1. Press `Win + R`
2. Enter `shell:startup`
3. Place a shortcut to `run_medication_reminder.bat` or the built EXE in that folder.

## Editing the schedule

Open the main window from the system tray and select **Edit schedule**.

- Time uses 24-hour format, such as `07:00`
- Days can be `daily` or a comma-separated list such as `mon,tue,wed`
- An optional end date can automatically stop temporary reminders

## Pairing with the web app

Use **Pair device** in the main window and follow the prompt. The schedule and
the taken/snoozed state are encrypted on this machine before they are sent; the
relay only ever stores ciphertext. Marking a dose taken or undoing it on either
device is reflected on the other.

## Privacy

`medication_schedule.json` and `medication_log.csv` contain your own medication
details. They stay on this machine unless you pair a device. Do not commit them
to a repository or attach them to a bug report.

## Files

- `medication_reminder.py` — application
- `medication_core.py` — scheduling and dose-state logic
- `sync_client.py` — encrypted sync with the web app
- `medication_schedule.json` — editable schedule (empty in this package)
- `medication_log.csv` — created after the first completed reminder
- `medication_icon.ico` — tray/application icon
