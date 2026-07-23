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
- Adds, edits, and removes schedules and medication items
- Supports one-to-one encrypted schedule sync with a paired mobile PWA
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

## Pairing a mobile device

Open **Manage schedules**, then select **Pair mobile**. Scan the QR code with the
phone's normal camera or QR reader. The link opens the installable web app at
`medication.bytesfx.com`, asks for consent, and imports the encrypted schedule.

- One source (Windows widget or browser) accepts one paired mobile device.
- Changes sync in both directions while the PWA is open or returns to the foreground.
- Simultaneous edits prompt before either device overwrites the other.
- **Unpair** revokes the relay record while preserving each device's local schedule.
- Widget pairing credentials are protected with Windows DPAPI.

The Cloudflare relay stores AES-GCM ciphertext, an IV, revision metadata, and hashed
access tokens. It never receives the encryption key or readable medication details.
The key is carried in the QR URL fragment, which browsers do not send to the web host,
and the fragment is removed from mobile history after pairing.

## Files

- `medication_reminder.py` — application
- `sync_client.py` — encrypted sync protocol client
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
supports schedule and medication CRUD, sound previews, encrypted device pairing, and
Web Push reminders. Unpaired devices remain completely local. Paired devices upload
only encrypted schedule blobs to the Worker. The separate push scheduler stores generic
due-time metadata without medication names so it can wake a closed PWA. Browser reminders are still subject to
the mobile operating system's notification permissions and power-management policies.
