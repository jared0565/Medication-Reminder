# Graphite Report: `Medication Reminder`

## Summary
- **Files scanned:** 27
- **Total nodes:** 703
- **Total edges:** 1145
- **Communities detected:** 66

## Top Files by Connectivity
- `medication_reminder.py` — degree 52
- `medication_core.py` — degree 50
- `qrcode.js` — degree 42
- `app.js` — degree 41
- `sync_client.py` — degree 23
- `sync.js` — degree 22
- `e2e_sync.py` — degree 16
- `index.js` — degree 13
- `test_medication_core.py` — degree 11
- `test_pairing.py` — degree 10

## God Nodes
- `medication_reminder.py` (file) — in 0 / out 52
- `medication_core.py` (file) — in 5 / out 45
- `MedicationReminderApp` (class) — in 2 / out 41
- `qrcode.js` (file) — in 0 / out 42
- `app.js` (file) — in 17 / out 24
- `__init__` (function) — in 2 / out 22
- `sync_client.py` (file) — in 3 / out 20
- `sync.js` (file) — in 0 / out 22
- `save` (function) — in 1 / out 19
- `syncNow` (function) — in 8 / out 12

## Entry Points
- `medication_reminder.py` — out 52 / in 0 (ratio 52.0)
- `qrcode.js` — out 42 / in 0 (ratio 42.0)
- `sync.js` — out 22 / in 0 (ratio 22.0)
- `e2e_sync.py` — out 16 / in 0 (ratio 16.0)
- `index.js` — out 13 / in 0 (ratio 13.0)
- `test_medication_core.py` — out 11 / in 0 (ratio 11.0)
- `test_pairing.py` — out 10 / in 0 (ratio 10.0)
- `medication_core.py` — out 45 / in 5 (ratio 9.0)
- `sync_client.py` — out 20 / in 3 (ratio 6.7)
- `app.js` — out 24 / in 17 (ratio 1.4)

## Surprising Connections
- `medication_core` -> `medication_core_appstorage` (contains)
- `medication_core` -> `medication_core_configvalidationerror` (contains)
- `medication_core` -> `medication_core_datablob` (contains)
- `medication_core` -> `medication_core_default_state` (contains)
- `medication_core` -> `medication_core_dpapiprotector` (contains)
- `medication_core` -> `medication_core_dueoccurrence` (contains)
- `medication_core` -> `medication_core_event_active` (contains)
- `medication_core` -> `medication_core_occurrence_key` (contains)
- `medication_core` -> `medication_core_protectedjsonfile` (contains)
- `medication_core` -> `medication_core_safe_datetime` (contains)

## Communities
### Community 6 (mixed)
- size: 115 (files: 0, functions: 42, classes: 9)
- members: `medication_core_append_audit`, `medication_core_appstorage`, `medication_core_astimezone`, `medication_core_atomic_write_bytes`, `medication_core_candidates`, `medication_core_cleanup`, `medication_core_collect_due`, `medication_core_configure_functions`, `medication_core_configvalidationerror`, `medication_core_cryptprotectdata`, `medication_core_cryptunprotectdata`, `medication_core_csv`, `medication_core_ctypes`, `medication_core_data`, `medication_core_datablob` ...
### Community 14 (mixed)
- size: 88 (files: 0, functions: 36, classes: 1)
- members: `medication_reminder_add_schedule`, `medication_reminder_add_schedule_main`, `medication_reminder_after`, `medication_reminder_append_audit`, `medication_reminder_apply_remote_schedule`, `medication_reminder_apply_timezone`, `medication_reminder_buttons`, `medication_reminder_check_schedule`, `medication_reminder_close_popup`, `medication_reminder_collect_due`, `medication_reminder_configured_timezone`, `medication_reminder_container`, `medication_reminder_deepcopy`, `medication_reminder_delete_sync_credentials`, `medication_reminder_destroy` ...
### Community 0 (mixed)
- size: 85 (files: 6, functions: 6, classes: 1)
- members: `aesgcm`, `any`, `appstorage`, `base64`, `configvalidationerror`, `copy`, `cryptography_hazmat_primitives_ciphers_aead`, `csv`, `ctypes`, `dataclass`, `dataclasses`, `date`, `datetime`, `deepcopy`, `dueoccurrence` ...
### Community 26 (web, functions)
- size: 78 (files: 1, functions: 54, classes: 0)
- members: `web_app`, `web_app_active`, `web_app_addeventlistener_click_l28_c42`, `web_app_addmedicine_onclick_l14_c361`, `web_app_addmedicineinput`, `web_app_addschedule_onclick_l14_c318`, `web_app_alert`, `web_app_anon_l39_c765`, `web_app_atob`, `web_app_await`, `web_app_b_onclick_l14_c56`, `web_app_btoa`, `web_app_catch_l39_c1469`, `web_app_checkbutton_onclick_l39_c602`, `web_app_checkforegroundnotifications` ...
### Community 9 (mixed)
- size: 61 (files: 0, functions: 13, classes: 0)
- members: `medication_reminder_actions`, `medication_reminder_add_medicine`, `medication_reminder_alert_buttons`, `medication_reminder_bind`, `medication_reminder_build_main_window`, `medication_reminder_button_bar`, `medication_reminder_code`, `medication_reminder_column`, `medication_reminder_configure`, `medication_reminder_configure_theme`, `medication_reminder_convert`, `medication_reminder_date_row`, `medication_reminder_days_var`, `medication_reminder_dialog`, `medication_reminder_edit_event_dialog` ...
### Community 62 (web, functions)
- size: 50 (files: 1, functions: 36, classes: 0)
- members: `web_sync`, `web_sync_acceptpairing`, `web_sync_alert`, `web_sync_anon_l1_c2`, `web_sync_anon_l34_c627`, `web_sync_anon_l34_c744`, `web_sync_api`, `web_sync_atob`, `web_sync_auth`, `web_sync_b64`, `web_sync_btoa`, `web_sync_catch_l40_c93`, `web_sync_cleartimeout`, `web_sync_confirm`, `web_sync_copypairlink` ...
### Community 48 (web)
- size: 43 (files: 1, functions: 2, classes: 0)
- members: `web_qrcode`, `web_qrcode_base64decodeinputstream`, `web_qrcode_base64encodeoutputstream`, `web_qrcode_bitoutputstream`, `web_qrcode_bytearrayoutputstream`, `web_qrcode_chattonum`, `web_qrcode_createbytes`, `web_qrcode_createdata`, `web_qrcode_createdataurl`, `web_qrcode_createhalfascii`, `web_qrcode_decode`, `web_qrcode_define`, `web_qrcode_encode`, `web_qrcode_escapexml`, `web_qrcode_factory` ...
### Community 22 (mixed)
- size: 32 (files: 0, functions: 12, classes: 3)
- members: `runtimeerror`, `sync_client_aesgcm`, `sync_client_api_url`, `sync_client_b64`, `sync_client_base64`, `sync_client_create_pair`, `sync_client_decode`, `sync_client_decrypt`, `sync_client_encode`, `sync_client_encrypt`, `sync_client_encryptedsyncclient`, `sync_client_exc`, `sync_client_fetch`, `sync_client_init`, `sync_client_json` ...
### Community 13 (mixed)
- size: 24 (files: 0, functions: 5, classes: 0)
- members: `medication_reminder_bytearray`, `medication_reminder_clipboard_append`, `medication_reminder_clipboard_clear`, `medication_reminder_copy_link`, `medication_reminder_create_pair`, `medication_reminder_credentials`, `medication_reminder_datetime`, `medication_reminder_dueoccurrence`, `medication_reminder_fetch`, `medication_reminder_io`, `medication_reminder_math`, `medication_reminder_now`, `medication_reminder_output`, `medication_reminder_raw`, `medication_reminder_sound_api` ...
### Community 12 (mixed)
- size: 20 (files: 0, functions: 2, classes: 0)
- members: `medication_reminder_appstorage`, `medication_reminder_astimezone`, `medication_reminder_ctypes`, `medication_reminder_enable_dpi_awareness`, `medication_reminder_encryptedsyncclient`, `medication_reminder_geometry`, `medication_reminder_init`, `medication_reminder_kernel32`, `medication_reminder_load_schedule`, `medication_reminder_load_settings`, `medication_reminder_load_state`, `medication_reminder_load_sync_credentials`, `medication_reminder_minsize`, `medication_reminder_oserror`, `medication_reminder_protocol` ...
### Community 23 (tests)
- size: 14 (files: 0, functions: 1, classes: 0)
- members: `tests_e2e_sync_assertionerror`, `tests_e2e_sync_client`, `tests_e2e_sync_decode`, `tests_e2e_sync_encryptedsyncclient`, `tests_e2e_sync_endswith`, `tests_e2e_sync_exc`, `tests_e2e_sync_get`, `tests_e2e_sync_json`, `tests_e2e_sync_main`, `tests_e2e_sync_path`, `tests_e2e_sync_read_text`, `tests_e2e_sync_secrets`, `tests_e2e_sync_urlopen`, `tests_e2e_sync_validate_schedule`
### Community 47 (worker/src, functions)
- size: 14 (files: 1, functions: 12, classes: 0)
- members: `web_push`, `worker_src_index`, `worker_src_index_authenticatedpair`, `worker_src_index_corsheaders`, `worker_src_index_enforceratelimit`, `worker_src_index_fetch`, `worker_src_index_handlesync`, `worker_src_index_json`, `worker_src_index_notifypairedmobile`, `worker_src_index_readjson`, `worker_src_index_scheduled`, `worker_src_index_tokenhash`, `worker_src_index_validencryptedbody`, `worker_src_index_validpushendpoint`
### Community 24 (tests)
- size: 12 (files: 0, functions: 5, classes: 1)
- members: `tests_test_medication_core_datetime`, `tests_test_medication_core_engine`, `tests_test_medication_core_isoformat`, `tests_test_medication_core_schedule`, `tests_test_medication_core_scheduleengine`, `tests_test_medication_core_scheduleenginetests`, `tests_test_medication_core_self`, `tests_test_medication_core_test_catches_up_after_sleep_or_restart`, `tests_test_medication_core_test_invalid_schedule_is_rejected`, `tests_test_medication_core_test_mark_taken_removes_pending_and_records_completion`, `tests_test_medication_core_test_snooze_suppresses_until_expiry`, `tests_test_medication_core_validate_schedule`
### Community 25 (tests)
- size: 9 (files: 0, functions: 2, classes: 1)
- members: `tests_test_pairing_encryptedsyncclient`, `tests_test_pairing_json`, `tests_test_pairing_pairingtests`, `tests_test_pairing_path`, `tests_test_pairing_read_text`, `tests_test_pairing_self`, `tests_test_pairing_test_encrypted_pairing_payload_round_trips_schedule`, `tests_test_pairing_test_pairing_link_uses_fragment_and_contains_no_schedule`, `tests_test_pairing_validate_schedule`
### Community 16 (mixed)
- size: 4 (files: 0, functions: 1, classes: 0)
- members: `medication_reminder_deiconify`, `medication_reminder_focus_force`, `medication_reminder_lift`, `medication_reminder_show_window_main_thread`
### Community 51 (web, functions)
- size: 3 (files: 0, functions: 2, classes: 0)
- members: `web_sw_fetch`, `web_sw_self_addeventlistener_fetch_l6_c31`, `web_sw_then_l6_c551`
### Community 65 (web)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `web_sync_resolve`, `web_sync_settimeout_l34_c764`
### Community 1 (files)
- size: 1 (files: 1, functions: 0, classes: 0)
- members: `agents`
### Community 2 (files)
- size: 1 (files: 1, functions: 0, classes: 0)
- members: `build_windows_exe`
### Community 3 (files)
- size: 1 (files: 1, functions: 0, classes: 0)
- members: `install_dependencies`
