from __future__ import annotations

import ctypes
import base64
import io
import math
import os
import struct
import sys
import threading
import time
import wave
import webbrowser
from urllib.parse import quote
import winsound
from copy import deepcopy
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from PIL import Image
import pystray

from medication_core import (
    AppStorage,
    ConfigValidationError,
    DueOccurrence,
    ScheduleEngine,
    StorageError,
    parse_time,
    validate_schedule,
)


APP_NAME = "Medication Reminder"
CHECK_INTERVAL_SECONDS = 15
DEFAULT_SNOOZE_MINUTES = 10
ERROR_ALREADY_EXISTS = 183
STARTUP_REGISTRY_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
STARTUP_VALUE_NAME = "MedicationReminder"


def enable_dpi_awareness() -> None:
    """Ask Windows to render Tk at the monitor's native DPI."""
    if os.name != "nt":
        return
    try:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        set_context = user32.SetProcessDpiAwarenessContext
        set_context.argtypes = [ctypes.c_void_p]
        set_context.restype = ctypes.c_bool
        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
        if set_context(ctypes.c_void_p(-4)):
            return
    except (AttributeError, OSError, OverflowError):
        pass
    try:
        shcore = ctypes.WinDLL("shcore", use_last_error=True)
        shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
    except (AttributeError, OSError, OverflowError):
        pass


def resource_dir() -> Path:
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if getattr(sys, "frozen", False) and bundle_dir:
        return Path(bundle_dir).resolve()
    return Path(__file__).resolve().parent


RESOURCE_DIR = resource_dir()
SEED_CONFIG_PATH = RESOURCE_DIR / "medication_schedule.json"
ICON_PATH = RESOURCE_DIR / "medication_icon.ico"


def startup_command() -> str:
    """Return a quoted command that starts this app without a console window."""
    if getattr(sys, "frozen", False):
        executable = Path(sys.executable).resolve()
        return f'"{executable}"'
    python_executable = Path(sys.executable).with_name("pythonw.exe")
    executable = python_executable if python_executable.is_file() else Path(sys.executable)
    return f'"{executable.resolve()}" "{Path(__file__).resolve()}"'


def register_startup() -> None:
    """Register this user's app for logon startup; never requires elevation."""
    if os.name != "nt":
        return
    import winreg

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, STARTUP_REGISTRY_PATH) as key:
        winreg.SetValueEx(key, STARTUP_VALUE_NAME, 0, winreg.REG_SZ, startup_command())


class SingleInstance:
    """Prevent duplicate reminder processes using a per-user Windows mutex."""

    def __init__(self) -> None:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        handle = kernel32.CreateMutexW(None, False, "Local\\MedicationReminder-7E5D8F09")
        if not handle:
            raise OSError(ctypes.get_last_error(), "Could not create the application mutex")
        if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            raise RuntimeError("Medication Reminder is already running")
        self._kernel32 = kernel32
        self._handle = handle

    def close(self) -> None:
        if self._handle:
            self._kernel32.CloseHandle(self._handle)
            self._handle = None


class MedicationReminderApp:
    def __init__(self) -> None:
        enable_dpi_awareness()
        self.root = tk.Tk()
        self._configure_theme()
        self.root.title(APP_NAME)
        self.root.geometry("680x540")
        self.root.minsize(600, 460)
        self.root.protocol("WM_DELETE_WINDOW", self.hide_to_tray)

        self.storage = AppStorage()
        self.alert_settings = self.storage.load_settings()
        self.config_data = self.storage.load_schedule(SEED_CONFIG_PATH)
        initial_now = datetime.now().astimezone(self._configured_timezone())
        self.scheduler = ScheduleEngine(self.config_data, self.storage.load_state(initial_now))

        self.active_popup: tk.Toplevel | None = None
        self.tray_icon: pystray.Icon | None = None
        self.running = True
        self.persistence_warning_shown = False
        self.startup_enabled = False
        try:
            register_startup()
            self.startup_enabled = True
        except OSError:
            # Startup registration is a convenience; the app remains usable if
            # Windows policy blocks this per-user registry write.
            pass

        self.build_main_window()
        self.start_tray_icon()
        self._safe_audit("application_started")
        self.root.after(1000, self.check_schedule)

    def _configure_theme(self) -> None:
        """Apply a bright, friendly palette while preserving native Tk controls."""
        palette = {
            "bg": "#FFF8F2",
            "surface": "#FFFFFF",
            "ink": "#243044",
            "muted": "#68758A",
            "teal": "#138A8A",
            "teal_dark": "#0B6266",
            "coral": "#F4776B",
            "coral_dark": "#D85B54",
            "line": "#DCE7E7",
            "selection": "#D7F0EE",
        }
        self.root.configure(bg=palette["bg"])
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("App.TFrame", background=palette["bg"])
        style.configure("Card.TFrame", background=palette["surface"], relief="solid", borderwidth=1)
        style.configure("TFrame", background=palette["surface"])
        style.configure("TLabel", background=palette["surface"], foreground=palette["ink"])
        style.configure("Title.TLabel", background=palette["bg"], foreground=palette["ink"], font=("Segoe UI", 21, "bold"))
        style.configure("Subtitle.TLabel", background=palette["bg"], foreground=palette["muted"], font=("Segoe UI", 10))
        style.configure("Meta.TLabel", background=palette["bg"], foreground=palette["teal_dark"], font=("Segoe UI", 9, "bold"))
        style.configure("Status.TLabel", background=palette["bg"], foreground=palette["teal_dark"], font=("Segoe UI", 10, "bold"))
        style.configure("Accent.TButton", background=palette["coral"], foreground="white", borderwidth=0, padding=(13, 8), font=("Segoe UI", 10, "bold"))
        style.map("Accent.TButton", background=[("active", palette["coral_dark"]), ("pressed", palette["coral_dark"])])
        style.configure("Teal.TButton", background=palette["teal"], foreground="white", borderwidth=0, padding=(13, 8), font=("Segoe UI", 10, "bold"))
        style.map("Teal.TButton", background=[("active", palette["teal_dark"]), ("pressed", palette["teal_dark"])])
        style.configure("Treeview", background=palette["surface"], fieldbackground=palette["surface"], foreground=palette["ink"], rowheight=34, bordercolor=palette["line"], lightcolor=palette["line"], darkcolor=palette["line"], font=("Segoe UI", 10))
        style.configure("Treeview.Heading", background=palette["teal"], foreground="white", relief="flat", padding=(8, 8), font=("Segoe UI", 10, "bold"))
        style.map("Treeview.Heading", background=[("active", palette["teal"]), ("pressed", palette["teal"])], foreground=[("active", "white"), ("pressed", "white")])
        style.map("Treeview", background=[("selected", palette["selection"])], foreground=[("selected", palette["ink"])])

    def _configured_timezone(self):
        from zoneinfo import ZoneInfo

        return ZoneInfo(self.config_data["timezone"])

    def now(self) -> datetime:
        return datetime.now(self.scheduler.timezone)

    def build_main_window(self) -> None:
        outer = ttk.Frame(self.root, padding=22, style="App.TFrame")
        outer.pack(fill="both", expand=True)

        ttk.Label(outer, text="Medication Reminder  ✦", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            outer,
            text="The application can stay minimized in the Windows system tray. "
                 "A reminder window and sound appear when medication is due.",
            wraplength=630,
            style="Subtitle.TLabel",
        ).pack(anchor="w", pady=(5, 8))
        ttk.Label(
            outer,
            text=("Starts automatically with Windows for this user." if self.startup_enabled
                  else "Automatic Windows startup could not be registered."),
            style="Meta.TLabel",
        ).pack(anchor="w", pady=(0, 3))
        ttk.Label(
            outer,
            text=f"Schedule timezone: {self.config_data['timezone']}",
            style="Meta.TLabel",
        ).pack(anchor="w", pady=(0, 12))

        self.status_var = tk.StringVar(value="Starting…")
        ttk.Label(outer, textvariable=self.status_var, style="Status.TLabel").pack(
            anchor="w", pady=(0, 8)
        )

        button_bar = ttk.Frame(outer)
        button_bar.pack(fill="x", pady=(2, 12))
        ttk.Button(button_bar, text="Test reminder", style="Accent.TButton", command=self.test_reminder).pack(side="left")
        ttk.Button(button_bar, text="Manage schedules", style="Teal.TButton", command=self.open_schedule_editor).pack(
            side="left", padx=8
        )
        ttk.Button(button_bar, text="Edit selected", style="Teal.TButton", command=self.edit_selected_main).pack(side="left")
        ttk.Button(button_bar, text="Alert settings", style="Accent.TButton", command=self.open_alert_settings).pack(side="left", padx=8)
        ttk.Button(button_bar, text="Export taken log", style="Teal.TButton", command=self.export_taken_log).pack(side="left")
        ttk.Button(button_bar, text="Pair device", style="Teal.TButton", command=self.pair_device).pack(side="left", padx=8)
        ttk.Button(button_bar, text="Show QR", style="Teal.TButton", command=self.show_pairing_qr).pack(side="left")
        ttk.Button(button_bar, text="Minimize to tray", style="Teal.TButton", command=self.hide_to_tray).pack(side="right")

        columns = ("time", "label", "medicines")
        self.tree = ttk.Treeview(outer, columns=columns, show="headings", height=9)
        self.tree.heading("time", text="Time")
        self.tree.heading("label", text="Reminder")
        self.tree.heading("medicines", text="Medication / nutrition")
        self.tree.column("time", width=80, anchor="center")
        self.tree.column("label", width=165)
        self.tree.column("medicines", width=360)
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<Double-1>", lambda _event: self.edit_selected_main())

        self.refresh_schedule_table()
        self.update_next_due_text()

    def refresh_schedule_table(self) -> None:
        for row in self.tree.get_children():
            self.tree.delete(row)
        for event in sorted(self.config_data["events"], key=lambda item: item["time"]):
            if event["enabled"]:
                self.tree.insert(
                    "", "end", values=(event["time"], event["label"], "; ".join(event["medicines"]))
                )

    def update_next_due_text(self) -> None:
        pending_count = len(self.scheduler.state["pending"])
        next_item = self.scheduler.next_scheduled(self.now())
        pending_text = f" • {pending_count} pending" if pending_count else ""
        if next_item:
            when, label = next_item
            self.status_var.set(
                f"Running{pending_text} • Next: {label} at {when.strftime('%a %d %b, %H:%M %Z')}"
            )
        else:
            self.status_var.set(f"Running{pending_text} • No active reminders found")
        if self.running:
            self.root.after(30_000, self.update_next_due_text)

    def edit_selected_main(self) -> None:
        selected = self.tree.selection()
        if not selected:
            messagebox.showinfo(APP_NAME, "Select a schedule row first.")
            return
        values = self.tree.item(selected[0], "values")
        event_index = next((index for index, event in enumerate(self.config_data["events"]) if event["time"] == values[0] and event["label"] == values[1]), None)
        if event_index is None:
            messagebox.showerror(APP_NAME, "The selected schedule is no longer available.")
            return
        self.edit_event_dialog(self.root, event_index, self.refresh_schedule_table)

    def open_alert_settings(self) -> None:
        settings = tk.Toplevel(self.root)
        settings.title("Alert settings")
        settings.geometry("420x250")
        settings.transient(self.root)
        form = ttk.Frame(settings, padding=18)
        form.pack(fill="both", expand=True)
        volume_var = tk.IntVar(value=int(self.alert_settings.get("volume", 70)))
        ttk.Label(form, text="Alert volume").pack(anchor="w")
        tk.Scale(form, from_=0, to=100, orient="horizontal", variable=volume_var, resolution=5, showvalue=True, length=340, highlightthickness=0).pack(fill="x", pady=(2, 12))
        ttk.Label(form, text="Reminder sound").pack(anchor="w")
        sound_var = tk.StringVar(value=self.alert_settings.get("sound", "chime"))
        ttk.Combobox(form, textvariable=sound_var, state="readonly", values=("chime", "bright", "warm", "urgent", "quiet")).pack(fill="x", pady=(2, 14))
        def save_alert_settings() -> None:
            self.alert_settings = {"volume": volume_var.get(), "sound": sound_var.get()}
            try:
                self.storage.save_settings(self.alert_settings)
                self._safe_audit("alert_settings_changed", **self.alert_settings)
            except StorageError as exc:
                self._warn_persistence(exc)
            settings.destroy()
        def test_alert_settings() -> None:
            previous = self.alert_settings
            self.alert_settings = {"volume": volume_var.get(), "sound": sound_var.get()}
            self.play_alert_sound()
            self.alert_settings = previous
        alert_buttons = ttk.Frame(form)
        alert_buttons.pack(fill="x", pady=(4, 0))
        ttk.Button(alert_buttons, text="Test this sound", command=test_alert_settings).pack(side="left")
        ttk.Button(alert_buttons, text="Save alert settings", style="Accent.TButton", command=save_alert_settings).pack(side="right")

    def check_schedule(self) -> None:
        if not self.running:
            return
        now = self.now()
        try:
            added = self.scheduler.collect_due(now)
            self.storage.save_state(self.scheduler.state)
            if added:
                self._safe_audit("reminders_queued", count=added)
        except StorageError as exc:
            self._warn_persistence(exc)

        popup_open = self.active_popup is not None and self.active_popup.winfo_exists()
        if not popup_open:
            due = self.scheduler.next_ready(now)
            if due:
                self.show_due_popup(due)
        self.root.after(CHECK_INTERVAL_SECONDS * 1000, self.check_schedule)

    def play_alert_sound(self) -> None:
        settings = dict(self.alert_settings)
        def worker() -> None:
            try:
                import winsound as sound_api
                sound_profiles = {
                    "chime": ((523, 180), (659, 180), (784, 320)),
                    "bright": ((784, 130), (988, 130), (1175, 260)),
                    "warm": ((330, 180), (392, 180), (494, 300)),
                    "urgent": ((880, 130), (440, 130), (880, 180)),
                    "quiet": ((660, 220),),
                }
                pattern = sound_profiles.get(settings.get("sound"), sound_profiles["chime"])
                volume = max(0, min(100, int(settings.get("volume", 70))))
                # Beep ignores per-process volume on many Windows drivers. Generate
                # normalized PCM instead, so the setting reliably controls amplitude
                # without changing the user's global system volume.
                amplitude = int(30000 * (0.12 + 0.88 * volume / 100))
                def tone(frequency: int, duration: int) -> bytes:
                    sample_rate = 44100
                    frames = int(sample_rate * duration / 1000)
                    raw = bytearray()
                    for index in range(frames):
                        position = index / max(1, frames - 1)
                        envelope = min(1.0, position * 18.0, (1.0 - position) * 14.0)
                        sample = int(amplitude * envelope * math.sin(2 * math.pi * frequency * index / sample_rate))
                        raw.extend(struct.pack("<h", sample))
                    output = io.BytesIO()
                    with wave.open(output, "wb") as wav:
                        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(sample_rate); wav.writeframes(raw)
                    return output.getvalue()
                for _ in range(3):
                    for frequency, duration in pattern:
                        sound_api.PlaySound(tone(frequency, duration), sound_api.SND_MEMORY)
                        time.sleep(0.06)
                    time.sleep(0.35)
            except OSError:
                pass

        threading.Thread(target=worker, daemon=True, name="medication-alert-sound").start()

    def show_due_popup(self, occurrence: DueOccurrence, *, is_test: bool = False) -> None:
        self.play_alert_sound()
        if self.active_popup and self.active_popup.winfo_exists():
            self.active_popup.destroy()

        popup = tk.Toplevel(self.root)
        self.active_popup = popup
        popup.configure(bg="#FFF8F2")
        popup.title("Medication due")
        popup.geometry("540x420")
        popup.resizable(False, False)
        popup.attributes("-topmost", True)
        popup.lift()
        popup.focus_force()

        if is_test:
            popup.protocol("WM_DELETE_WINDOW", lambda: self._close_popup(popup))
        else:
            popup.protocol("WM_DELETE_WINDOW", lambda: self.snooze_event(occurrence, popup))

        frame = ttk.Frame(popup, padding=22, style="App.TFrame")
        frame.pack(fill="both", expand=True)
        overdue = not is_test and self.now() > occurrence.scheduled_at.replace(second=59)
        heading = "OVERDUE MEDICATION" if overdue else "MEDICATION DUE"
        ttk.Label(
            frame,
            text=f"{heading} • {occurrence.scheduled_at.strftime('%a %d %b, %H:%M')}",
            font=("Segoe UI", 13, "bold"),
        ).pack(anchor="center", pady=(0, 8))
        ttk.Label(frame, text=occurrence.label, font=("Segoe UI", 19, "bold")).pack(
            anchor="center", pady=(0, 14)
        )

        meds_box = tk.Text(
            frame,
            height=max(5, len(occurrence.medicines) + 1),
            width=48,
            wrap="word",
            font=("Segoe UI", 13),
            relief="solid",
            borderwidth=1,
            padx=12,
            pady=10,
        )
        meds_box.pack(fill="x")
        meds_box.insert("1.0", "\n".join(f"• {item}" for item in occurrence.medicines))
        meds_box.configure(state="disabled")

        if occurrence.instructions:
            ttk.Label(
                frame,
                text=occurrence.instructions,
                wraplength=480,
                justify="left",
                font=("Segoe UI", 10),
            ).pack(anchor="w", pady=(14, 16))

        buttons = ttk.Frame(frame)
        buttons.pack(fill="x", side="bottom")
        if is_test:
            ttk.Button(buttons, text="Close test", command=lambda: self._close_popup(popup)).pack(
                expand=True, fill="x"
            )
        else:
            ttk.Button(
                buttons, text="Taken", style="Teal.TButton", command=lambda: self.mark_taken(occurrence, popup)
            ).pack(side="left", expand=True, fill="x", padx=(0, 6))
            ttk.Button(
                buttons,
                text=f"Snooze {DEFAULT_SNOOZE_MINUTES} min",
                style="Accent.TButton",
                command=lambda: self.snooze_event(occurrence, popup),
            ).pack(side="left", expand=True, fill="x", padx=(6, 0))
        popup.bell()

    def mark_taken(self, occurrence: DueOccurrence, popup: tk.Toplevel) -> None:
        now = self.now()
        self.scheduler.mark_taken(occurrence.key, now)
        try:
            self.storage.save_state(self.scheduler.state)
            self.storage.append_audit(
                "medication_taken",
                now,
                event_id=occurrence.event_id,
                label=occurrence.label,
                scheduled_time=occurrence.scheduled_at.isoformat(),
                items=occurrence.medicines,
            )
        except StorageError as exc:
            self._warn_persistence(exc)
        self._close_popup(popup)
        self.update_next_due_text()

    def snooze_event(self, occurrence: DueOccurrence, popup: tk.Toplevel) -> None:
        now = self.now()
        until = self.scheduler.snooze(occurrence.key, now, DEFAULT_SNOOZE_MINUTES)
        try:
            self.storage.save_state(self.scheduler.state)
            self.storage.append_audit(
                "reminder_snoozed", now, event_id=occurrence.event_id, snoozed_until=until.isoformat()
            )
        except StorageError as exc:
            self._warn_persistence(exc)
        self._close_popup(popup)
        self.update_next_due_text()

    def _close_popup(self, popup: tk.Toplevel) -> None:
        if popup.winfo_exists():
            popup.destroy()
        if self.active_popup is popup:
            self.active_popup = None

    def test_reminder(self) -> None:
        now = self.now()
        sample = DueOccurrence(
            key=f"test-{time.time()}",
            event_id="test",
            label="Test reminder",
            time_text=now.strftime("%H:%M"),
            medicines=["This is a test alert", "No medication should be taken"],
            instructions="Use this button to confirm that the sound and reminder window work.",
            scheduled_at=now,
        )
        self.show_due_popup(sample, is_test=True)

    def save_config(self, candidate: dict, action: str, event_id: str | None = None) -> bool:
        try:
            validated = self.storage.save_schedule(candidate)
            self.config_data = validated
            self.scheduler.replace_schedule(validated)
            self.storage.save_state(self.scheduler.state)
            self.storage.append_audit(action, self.now(), event_id=event_id)
        except (ConfigValidationError, StorageError) as exc:
            messagebox.showerror(APP_NAME, str(exc))
            return False
        self.refresh_schedule_table()
        self.update_next_due_text()
        return True

    def open_schedule_editor(self) -> None:
        editor = tk.Toplevel(self.root)
        editor.title("Edit reminder schedule")
        editor.geometry("800x580")
        editor.transient(self.root)
        container = ttk.Frame(editor, padding=14)
        container.pack(fill="both", expand=True)

        timezone_bar = ttk.Frame(container)
        timezone_bar.pack(fill="x", pady=(0, 10))
        ttk.Label(timezone_bar, text="Timezone:").pack(side="left")
        timezone_var = tk.StringVar(value=self.config_data["timezone"])
        ttk.Entry(timezone_bar, textvariable=timezone_var, width=35).pack(side="left", padx=8)

        def apply_timezone() -> None:
            candidate = deepcopy(self.config_data)
            candidate["timezone"] = timezone_var.get().strip()
            if self.save_config(candidate, "timezone_changed"):
                messagebox.showinfo(APP_NAME, "Timezone updated. Reopen this window to refresh the display.")

        ttk.Button(timezone_bar, text="Apply timezone", command=apply_timezone).pack(side="left")

        columns = ("enabled", "time", "label", "medicines")
        tree = ttk.Treeview(container, columns=columns, show="headings", height=15)
        tree.heading("enabled", text="On")
        tree.heading("time", text="Time")
        tree.heading("label", text="Label")
        tree.heading("medicines", text="Items")
        tree.column("enabled", width=45, anchor="center")
        tree.column("time", width=70, anchor="center")
        tree.column("label", width=180)
        tree.column("medicines", width=430)
        tree.pack(fill="both", expand=True)

        def populate() -> None:
            for item in tree.get_children():
                tree.delete(item)
            for index, event in enumerate(self.config_data["events"]):
                tree.insert(
                    "", "end", iid=str(index),
                    values=("Yes" if event["enabled"] else "No", event["time"], event["label"], "; ".join(event["medicines"])),
                )

        def toggle() -> None:
            selected = tree.selection()
            if not selected:
                return
            index = int(selected[0])
            candidate = deepcopy(self.config_data)
            candidate["events"][index]["enabled"] = not candidate["events"][index]["enabled"]
            event_id = candidate["events"][index]["id"]
            if self.save_config(candidate, "reminder_toggled", event_id):
                populate()

        def edit_selected() -> None:
            selected = tree.selection()
            if not selected:
                messagebox.showinfo(APP_NAME, "Select a reminder first.")
                return
            self.edit_event_dialog(editor, int(selected[0]), populate)

        def add_schedule() -> None:
            self.edit_event_dialog(editor, None, populate)

        def remove_schedule() -> None:
            selected = tree.selection()
            if not selected:
                messagebox.showinfo(APP_NAME, "Select a reminder first.")
                return
            index = int(selected[0])
            event_id = self.config_data["events"][index]["id"]
            if not messagebox.askyesno(APP_NAME, f"Remove the '{event_id}' reminder?"):
                return
            candidate = deepcopy(self.config_data)
            candidate["events"].pop(index)
            if self.save_config(candidate, "reminder_removed", event_id):
                populate()

        def open_alert_settings() -> None:
            settings = tk.Toplevel(editor)
            settings.title("Alert settings")
            settings.geometry("420x250")
            settings.transient(editor)
            form = ttk.Frame(settings, padding=18)
            form.pack(fill="both", expand=True)
            volume_var = tk.IntVar(value=int(self.alert_settings.get("volume", 70)))
            ttk.Label(form, text="Alert volume").pack(anchor="w")
            tk.Scale(form, from_=0, to=100, orient="horizontal", variable=volume_var, resolution=5, showvalue=True, length=340, highlightthickness=0).pack(fill="x", pady=(2, 12))
            ttk.Label(form, text="Reminder sound").pack(anchor="w")
            sound_var = tk.StringVar(value=self.alert_settings.get("sound", "chime"))
            ttk.Combobox(form, textvariable=sound_var, state="readonly", values=("chime", "bright", "warm", "urgent", "quiet")).pack(fill="x", pady=(2, 14))
            def save_alert_settings() -> None:
                self.alert_settings = {"volume": volume_var.get(), "sound": sound_var.get()}
                try:
                    self.storage.save_settings(self.alert_settings)
                    self._safe_audit("alert_settings_changed", **self.alert_settings)
                except StorageError as exc:
                    self._warn_persistence(exc)
                settings.destroy()
            def test_alert_settings() -> None:
                previous = self.alert_settings
                self.alert_settings = {"volume": volume_var.get(), "sound": sound_var.get()}
                self.play_alert_sound()
                self.alert_settings = previous
            alert_buttons = ttk.Frame(form)
            alert_buttons.pack(fill="x", pady=(4, 0))
            ttk.Button(alert_buttons, text="Test this sound", command=test_alert_settings).pack(side="left")
            ttk.Button(alert_buttons, text="Save alert settings", style="Accent.TButton", command=save_alert_settings).pack(side="right")

        quick_actions = ttk.Frame(container)
        quick_actions.pack(fill="x", pady=(0, 10))
        ttk.Label(quick_actions, text="Schedule actions:", style="Meta.TLabel").pack(side="left", padx=(0, 10))
        ttk.Button(quick_actions, text="+ Add schedule", style="Accent.TButton", command=add_schedule).pack(side="left", padx=(0, 6))
        ttk.Button(quick_actions, text="Edit selected", style="Teal.TButton", command=edit_selected).pack(side="left", padx=6)
        ttk.Button(quick_actions, text="Remove selected", command=remove_schedule).pack(side="left", padx=6)
        ttk.Button(quick_actions, text="Alert settings", command=open_alert_settings).pack(side="left", padx=6)

        buttons = ttk.Frame(container)
        buttons.pack(fill="x", pady=(12, 0))
        ttk.Button(buttons, text="Enable / disable", command=toggle).pack(side="left")
        ttk.Button(buttons, text="Add schedule", style="Accent.TButton", command=add_schedule).pack(side="left", padx=8)
        ttk.Button(buttons, text="Edit selected", style="Teal.TButton", command=edit_selected).pack(side="left")
        ttk.Button(buttons, text="Remove selected", command=remove_schedule).pack(side="left", padx=8)
        ttk.Button(buttons, text="Alert settings", command=open_alert_settings).pack(side="left")
        ttk.Button(buttons, text="Close", command=editor.destroy).pack(side="right")
        populate()

    def edit_event_dialog(self, parent: tk.Toplevel, event_index: int | None, refresh_callback) -> None:
        is_new = event_index is None
        event = (deepcopy(self.config_data["events"][event_index]) if not is_new else {
            "id": f"reminder_{int(time.time())}", "enabled": True, "time": "08:00", "label": "New reminder",
            "medicines": ["New medication"], "instructions": "", "days": ["daily"], "start_date": None, "end_date": None,
        })
        dialog = tk.Toplevel(parent)
        dialog.title("Edit reminder")
        dialog.geometry("590x540")
        dialog.transient(parent)
        dialog.grab_set()
        form = ttk.Frame(dialog, padding=18)
        form.pack(fill="both", expand=True)

        time_var = tk.StringVar(value=event["time"])
        label_var = tk.StringVar(value=event["label"])
        enabled_var = tk.BooleanVar(value=event["enabled"])
        days_var = tk.StringVar(value=", ".join(event["days"]))
        start_var = tk.StringVar(value=event["start_date"] or "")
        end_var = tk.StringVar(value=event["end_date"] or "")

        ttk.Label(form, text="Time (24-hour HH:MM)").pack(anchor="w")
        ttk.Entry(form, textvariable=time_var).pack(fill="x", pady=(2, 8))
        ttk.Label(form, text="Reminder label").pack(anchor="w")
        ttk.Entry(form, textvariable=label_var).pack(fill="x", pady=(2, 8))
        ttk.Label(form, text="Medication/items, one per line").pack(anchor="w")
        medicines_box = tk.Listbox(form, height=5, activestyle="none", exportselection=False)
        medicines_box.pack(fill="x", pady=(2, 4))
        for medicine in event["medicines"]:
            medicines_box.insert("end", medicine)
        medicine_buttons = ttk.Frame(form)
        medicine_buttons.pack(fill="x", pady=(0, 8))
        def add_medicine() -> None:
            value = simpledialog.askstring("Add medication", "Medication or item:", parent=dialog)
            if value and value.strip(): medicines_box.insert("end", value.strip())
        def edit_medicine() -> None:
            selection = medicines_box.curselection()
            if not selection: return
            value = simpledialog.askstring("Edit medication", "Medication or item:", initialvalue=medicines_box.get(selection[0]), parent=dialog)
            if value and value.strip(): medicines_box.delete(selection[0]); medicines_box.insert(selection[0], value.strip())
        def remove_medicine() -> None:
            selection = medicines_box.curselection()
            if selection: medicines_box.delete(selection[0])
        ttk.Button(medicine_buttons, text="Add medication", command=add_medicine).pack(side="left")
        ttk.Button(medicine_buttons, text="Edit medication", command=edit_medicine).pack(side="left", padx=6)
        ttk.Button(medicine_buttons, text="Remove medication", command=remove_medicine).pack(side="left")
        ttk.Label(form, text="Days: daily or mon,tue,wed...").pack(anchor="w")
        ttk.Entry(form, textvariable=days_var).pack(fill="x", pady=(2, 8))

        date_row = ttk.Frame(form)
        date_row.pack(fill="x")
        start_frame = ttk.Frame(date_row)
        start_frame.pack(side="left", fill="x", expand=True, padx=(0, 6))
        end_frame = ttk.Frame(date_row)
        end_frame.pack(side="left", fill="x", expand=True, padx=(6, 0))
        ttk.Label(start_frame, text="Start date (optional, YYYY-MM-DD)").pack(anchor="w")
        ttk.Entry(start_frame, textvariable=start_var).pack(fill="x", pady=(2, 8))
        ttk.Label(end_frame, text="End date (optional, YYYY-MM-DD)").pack(anchor="w")
        ttk.Entry(end_frame, textvariable=end_var).pack(fill="x", pady=(2, 8))
        ttk.Checkbutton(form, text="Reminder enabled", variable=enabled_var).pack(anchor="w")

        def save() -> None:
            candidate = deepcopy(self.config_data)
            updated = event if is_new else candidate["events"][event_index]
            updated.update(
                {
                    "time": time_var.get().strip(),
                    "label": label_var.get().strip(),
                    "medicines": [medicines_box.get(index) for index in range(medicines_box.size())],
                    "days": [item.strip().lower() for item in days_var.get().split(",") if item.strip()] or ["daily"],
                    "start_date": start_var.get().strip() or None,
                    "end_date": end_var.get().strip() or None,
                    "enabled": enabled_var.get(),
                }
            )
            try:
                parse_time(updated["time"])
                validate_schedule(candidate)
            except ConfigValidationError as exc:
                messagebox.showerror(APP_NAME, str(exc))
                return
            if is_new:
                candidate["events"].append(updated)
            if self.save_config(candidate, "reminder_added" if is_new else "reminder_edited", updated["id"]):
                refresh_callback()
                dialog.destroy()

        ttk.Button(form, text="Save changes", command=save).pack(anchor="e", pady=(12, 0))

    def pair_device(self) -> None:
        payload = base64.urlsafe_b64encode(json.dumps({"version": 1, "schedule": self.config_data}, separators=(",", ":")).encode()).decode().rstrip("=")
        self.root.clipboard_clear()
        self.root.clipboard_append(payload)
        self.root.update()
        action = messagebox.askyesno(APP_NAME, "A private pairing code was copied to the clipboard.\n\nYes: import a code from another device instead.\nNo: keep this device's code copied for pasting into the mobile app.")
        if not action:
            return
        incoming = simpledialog.askstring(APP_NAME, "Paste the pairing code to import:", parent=self.root)
        if not incoming:
            return
        try:
            padded = incoming.strip() + "=" * ((4 - len(incoming.strip()) % 4) % 4)
            data = json.loads(base64.urlsafe_b64decode(padded).decode())
            imported = validate_schedule(data["schedule"])
            self.storage.save_schedule(imported)
            self.config_data = imported
            self.scheduler.replace_schedule(imported)
            self.refresh_schedule_table()
            self.update_next_due_text()
            messagebox.showinfo(APP_NAME, "Schedule imported successfully.")
        except (ValueError, KeyError, UnicodeError, ConfigValidationError) as exc:
            messagebox.showerror(APP_NAME, f"Invalid pairing code: {exc}")

    def show_pairing_qr(self) -> None:
        payload = base64.urlsafe_b64encode(json.dumps({"version": 1, "schedule": self.config_data}, separators=(",", ":")).encode()).decode().rstrip("=")
        webbrowser.open("https://medication.bytesfx.com/?pair=" + quote(payload, safe=""))

    def export_taken_log(self) -> None:
        if not messagebox.askyesno(
            APP_NAME,
            "The exported CSV is readable plaintext and may contain sensitive health information. Continue?",
        ):
            return
        selected = filedialog.asksaveasfilename(
            title="Export taken medication log",
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv")],
            initialfile="medication_log.csv",
        )
        if not selected:
            return
        try:
            count = self.storage.export_taken_csv(Path(selected))
            self._safe_audit("taken_log_exported", record_count=count)
            messagebox.showinfo(APP_NAME, f"Exported {count} taken record(s). Keep the file private.")
        except StorageError as exc:
            messagebox.showerror(APP_NAME, str(exc))

    def _safe_audit(self, action: str, **details) -> None:
        try:
            self.storage.append_audit(action, self.now(), **details)
        except StorageError as exc:
            self._warn_persistence(exc)

    def _warn_persistence(self, exc: Exception) -> None:
        self.status_var.set("Warning • protected data could not be saved")
        if not self.persistence_warning_shown:
            self.persistence_warning_shown = True
            messagebox.showerror(
                APP_NAME,
                f"Reminder data could not be saved safely. The application will keep running, "
                f"but restart recovery is not guaranteed.\n\n{exc}",
            )

    def hide_to_tray(self) -> None:
        self.root.withdraw()

    def show_window(self) -> None:
        self.root.after(0, self._show_window_main_thread)

    def _show_window_main_thread(self) -> None:
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def start_tray_icon(self) -> None:
        if not ICON_PATH.is_file():
            raise StorageError("The application icon is missing")
        image = Image.open(ICON_PATH)
        menu = pystray.Menu(
            pystray.MenuItem("Open medication reminder", lambda: self.show_window(), default=True),
            pystray.MenuItem("Test reminder", lambda: self.root.after(0, self.test_reminder)),
            pystray.MenuItem("Exit", lambda: self.root.after(0, self.quit_app)),
        )
        self.tray_icon = pystray.Icon("MedicationReminder", image, APP_NAME, menu)
        threading.Thread(target=self.tray_icon.run, daemon=True, name="medication-tray").start()

    def quit_app(self) -> None:
        self.running = False
        try:
            self.storage.save_state(self.scheduler.state)
            self.storage.append_audit("application_stopped", self.now())
        except StorageError:
            pass
        if self.tray_icon:
            self.tray_icon.stop()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def show_startup_error(message: str) -> None:
    root = tk.Tk()
    root.withdraw()
    messagebox.showerror(APP_NAME, message)
    root.destroy()


def main() -> int:
    instance: SingleInstance | None = None
    try:
        instance = SingleInstance()
        MedicationReminderApp().run()
        return 0
    except RuntimeError as exc:
        show_startup_error(str(exc))
        return 2
    except (ConfigValidationError, StorageError, OSError) as exc:
        show_startup_error(f"The application could not start safely.\n\n{exc}")
        return 1
    finally:
        if instance:
            instance.close()


if __name__ == "__main__":
    raise SystemExit(main())
