# Medication Reminder Widget for Windows

A lightweight Windows tray application that accompanies the printed medication plan.
All schedule, reminder-state, and adherence-audit data is stored in the current
Windows user's protected application data directory using Windows DPAPI.

## Main features

- Runs in the Windows system tray
- Checks the medication schedule automatically
- Plays an audible Windows alert when medication is due
- Displays an always-on-top reminder window
- Shows the medication names and timing instructions
- Includes **Taken** and **Snooze 10 min** buttons
- Keeps a protected, retained audit history and can export completed reminders to CSV
- Allows reminders to be enabled, disabled, or edited
- Includes a test-reminder button

## Important clinical note

This program is an organisational aid, not a medical device. The Royal Free transplant team's latest instructions always take priority. Check the schedule whenever a medicine is started, stopped, or changed.

The temporary cefalexin reminders are enabled by default. Disable them in **Edit schedule** when the prescribed course is complete.

## Quick start

1. Install Python 3.11 or newer for Windows.
2. Double-click `install_dependencies.bat`.
3. Double-click `run_medication_reminder.bat`.
4. In the application, select **Test reminder**.
5. Select **Minimize to tray**.

The app should normally remain running. If Windows sleeps, restarts, or the app is
reopened, the scheduler catches up reminders that became due during the previous
check window and marks them as overdue. It does not replace clinical advice or a
care team's missed-dose instructions.

## Build a single Windows EXE

1. Run `install_dependencies.bat`.
2. Run `build_windows_exe.bat`.
3. The executable will be created inside the `dist` folder.

The build embeds the application code, default schedule, and tray icon. The EXE can be
copied to any user-writable folder and registers itself for startup on first launch.
The source files remain useful as editable backup/configuration inputs:

- `medication_schedule.json`
- `medication_icon.ico`

## Start automatically with Windows

The application registers itself in the current user's `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`
key on startup. This requires no administrator privileges and causes the reminder to
start automatically after the user signs in. The single-instance guard prevents a
second copy from opening if it is launched manually as well.

If you want to remove automatic startup, delete the `MedicationReminder` value from
that registry key or remove the application from Windows' Startup Apps settings.

## Editing the schedule

Open the main window from the system tray and select **Edit schedule**.

- Time uses 24-hour format, such as `07:00`
- Days can be `daily` or a comma-separated list such as `mon,tue,wed`
- An optional end date can automatically stop temporary reminders

## Files

- `medication_reminder.py` — application
- `medication_schedule.json` — editable schedule
- `%LOCALAPPDATA%\\MedicationReminder` — protected schedule, state, and audit data
- `medication_icon.ico` — tray/application icon

## Testing

Run the deterministic scheduler and validation tests with:

```text
py -m unittest discover -s tests -v
```

The application validates all schedule data at the file and UI boundaries, uses the
configured IANA timezone, persists snoozes and pending reminders, and prevents more
than one process from running for the current Windows user.

## Local-first web app

An installable responsive web/PWA prototype is available in [`web/`](web/). It is
static and dependency-free: open it through a local HTTPS/static server for full PWA
installation behavior. It stores schedules and alert settings in browser local storage,
supports schedule and medication CRUD, and includes a sound preview. Browser reminders
are not as reliable as native Android alarms, so this version is intended for workflow
validation before adding server sync or Play Store packaging. The PWA does not upload
schedules, medications, or notification subscriptions; each browser/device owns its
local data.
