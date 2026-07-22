@echo off
title Build Medication Reminder EXE
cd /d "%~dp0"
py -m pip install -r requirements.txt
pyinstaller --noconfirm --clean --onefile --windowed ^
  --distpath dist ^
  --name MedicationReminder ^
  --icon medication_icon.ico ^
  --add-data "medication_schedule.json;." ^
  --add-data "medication_icon.ico;." ^
  medication_reminder.py
echo.
echo Build complete. See the dist folder.
pause
