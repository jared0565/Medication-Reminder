# Graphite Report: `Medication Reminder`

## Summary
- **Files scanned:** 32
- **Total nodes:** 782
- **Total edges:** 1309
- **Communities detected:** 63

## Top Files by Connectivity
- `medication_reminder.py` — degree 52
- `medication_core.py` — degree 50
- `qrcode.js` — degree 45
- `app.js` — degree 43
- `sync.js` — degree 27
- `sync_client.py` — degree 23
- `e2e_sync.py` — degree 16
- `index.js` — degree 13
- `test_medication_core.py` — degree 11
- `test_pairing.py` — degree 10

## God Nodes
- `medication_reminder.py` (file) — in 0 / out 52
- `medication_core.py` (file) — in 5 / out 45
- `qrcode.js` (file) — in 0 / out 45
- `MedicationReminderApp` (class) — in 2 / out 41
- `app.js` (file) — in 15 / out 28
- `sync.js` (file) — in 0 / out 27
- `__init__` (function) — in 2 / out 22
- `sync_client.py` (file) — in 3 / out 20
- `syncNow` (function) — in 8 / out 13
- `save` (function) — in 1 / out 19

## Entry Points
- `medication_reminder.py` — out 52 / in 0 (ratio 52.0)
- `qrcode.js` — out 45 / in 0 (ratio 45.0)
- `sync.js` — out 27 / in 0 (ratio 27.0)
- `e2e_sync.py` — out 16 / in 0 (ratio 16.0)
- `index.js` — out 13 / in 0 (ratio 13.0)
- `test_medication_core.py` — out 11 / in 0 (ratio 11.0)
- `test_pairing.py` — out 10 / in 0 (ratio 10.0)
- `medication_core.py` — out 45 / in 5 (ratio 9.0)
- `test_web_sync.mjs` — out 9 / in 0 (ratio 9.0)
- `sync_client.py` — out 20 / in 3 (ratio 6.7)

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
### Community 14 (mixed)
- size: 134 (files: 0, functions: 47, classes: 1)
- members: `medication_reminder_actions`, `medication_reminder_add_schedule`, `medication_reminder_add_schedule_main`, `medication_reminder_after`, `medication_reminder_alert_buttons`, `medication_reminder_append_audit`, `medication_reminder_apply_remote_schedule`, `medication_reminder_apply_timezone`, `medication_reminder_bind`, `medication_reminder_build_main_window`, `medication_reminder_button_bar`, `medication_reminder_buttons`, `medication_reminder_check_schedule`, `medication_reminder_clipboard_append`, `medication_reminder_clipboard_clear` ...
### Community 6 (mixed)
- size: 115 (files: 0, functions: 42, classes: 9)
- members: `medication_core_append_audit`, `medication_core_appstorage`, `medication_core_astimezone`, `medication_core_atomic_write_bytes`, `medication_core_candidates`, `medication_core_cleanup`, `medication_core_collect_due`, `medication_core_configure_functions`, `medication_core_configvalidationerror`, `medication_core_cryptprotectdata`, `medication_core_cryptunprotectdata`, `medication_core_csv`, `medication_core_ctypes`, `medication_core_data`, `medication_core_datablob` ...
### Community 0 (mixed)
- size: 100 (files: 6, functions: 7, classes: 1)
- members: `aesgcm`, `any`, `appstorage`, `base64`, `configvalidationerror`, `copy`, `cryptography_hazmat_primitives_ciphers_aead`, `csv`, `ctypes`, `dataclass`, `dataclasses`, `date`, `datetime`, `deepcopy`, `dueoccurrence` ...
### Community 26 (functions)
- size: 78 (files: 1, functions: 54, classes: 0)
- members: `tests_test_web_sync_getusermedia`, `tests_test_web_sync_showmodal`, `tests_test_web_sync_stop`, `web_app`, `web_app_active`, `web_app_addeventlistener_click_l28_c42`, `web_app_addmedicine_onclick_l14_c361`, `web_app_addmedicineinput`, `web_app_addschedule_onclick_l14_c318`, `web_app_alert`, `web_app_atob`, `web_app_await`, `web_app_btoa`, `web_app_checkforegroundnotifications`, `web_app_clearprematuretaken` ...
### Community 25 (functions)
- size: 74 (files: 1, functions: 57, classes: 0)
- members: `tests_test_web_sync_addeventlistener`, `tests_test_web_sync_close`, `tests_test_web_sync_control`, `tests_test_web_sync_createelement`, `tests_test_web_sync_detect`, `tests_test_web_sync_dialog`, `tests_test_web_sync_fillrect`, `tests_test_web_sync_play`, `tests_test_web_sync_queryselector`, `tests_test_web_sync_replacestate`, `tests_test_web_update_queryselector`, `web_app_settimeout_l12_c939`, `web_sw_self_addeventlistener_notificationclick_l8_c43`, `web_sync`, `web_sync_acceptpairing` ...
### Community 24 (mixed)
- size: 57 (files: 1, functions: 15, classes: 0)
- members: `tests_test_web_sync_add`, `tests_test_web_sync_alert`, `tests_test_web_sync_append`, `tests_test_web_sync_cancelanimationframe`, `tests_test_web_sync_contains`, `tests_test_web_sync_installedmobileharness`, `tests_test_web_sync_readfilesync`, `tests_test_web_sync_remove`, `tests_test_web_sync_test_an_explicitly_unpaired_mobile_stays_empty_after_app_reload_l186_c68`, `tests_test_web_sync_test_an_installed_mobile_with_no_active_pairing_clears_legacy_local_data_l178_c77`, `tests_test_web_sync_test_installed_mobile_exposes_only_pairing_sync_controls_and_safely_unpairs_l140_c80`, `tests_test_web_sync_test_source_side_revocation_immediately_forgets_the_mobile_schedule_l168_c72`, `tests_test_web_sync_toggle`, `web_app_b_onclick_l14_c56`, `web_qrcode` ...
### Community 27 (functions)
- size: 41 (files: 3, functions: 25, classes: 0)
- members: `node_assert_strict`, `node_crypto`, `node_fs`, `node_test`, `node_vm`, `tests_test_web_sync`, `tests_test_web_sync_json`, `tests_test_web_sync_test`, `tests_test_web_update`, `tests_test_web_update_addeventlistener`, `tests_test_web_update_alert`, `tests_test_web_update_flush`, `tests_test_web_update_json`, `tests_test_web_update_postmessage`, `tests_test_web_update_readfilesync` ...
### Community 13 (mixed)
- size: 33 (files: 0, functions: 7, classes: 0)
- members: `medication_reminder_add_medicine`, `medication_reminder_date_row`, `medication_reminder_days_var`, `medication_reminder_edit_event_dialog`, `medication_reminder_edit_medicine`, `medication_reminder_enabled_var`, `medication_reminder_end_frame`, `medication_reminder_end_var`, `medication_reminder_form`, `medication_reminder_get_children`, `medication_reminder_insert`, `medication_reminder_item`, `medication_reminder_join`, `medication_reminder_label_var`, `medication_reminder_lower` ...
### Community 21 (mixed)
- size: 32 (files: 0, functions: 12, classes: 3)
- members: `runtimeerror`, `sync_client_aesgcm`, `sync_client_api_url`, `sync_client_b64`, `sync_client_base64`, `sync_client_create_pair`, `sync_client_decode`, `sync_client_decrypt`, `sync_client_encode`, `sync_client_encrypt`, `sync_client_encryptedsyncclient`, `sync_client_exc`, `sync_client_fetch`, `sync_client_init`, `sync_client_json` ...
### Community 15 (mixed)
- size: 20 (files: 0, functions: 2, classes: 0)
- members: `medication_reminder_appstorage`, `medication_reminder_astimezone`, `medication_reminder_ctypes`, `medication_reminder_enable_dpi_awareness`, `medication_reminder_encryptedsyncclient`, `medication_reminder_geometry`, `medication_reminder_init`, `medication_reminder_kernel32`, `medication_reminder_load_schedule`, `medication_reminder_load_settings`, `medication_reminder_load_state`, `medication_reminder_load_sync_credentials`, `medication_reminder_minsize`, `medication_reminder_oserror`, `medication_reminder_protocol` ...
### Community 46 (worker/src, functions)
- size: 14 (files: 1, functions: 12, classes: 0)
- members: `web_push`, `worker_src_index`, `worker_src_index_authenticatedpair`, `worker_src_index_corsheaders`, `worker_src_index_enforceratelimit`, `worker_src_index_fetch`, `worker_src_index_handlesync`, `worker_src_index_json`, `worker_src_index_notifypairedmobile`, `worker_src_index_readjson`, `worker_src_index_scheduled`, `worker_src_index_tokenhash`, `worker_src_index_validencryptedbody`, `worker_src_index_validpushendpoint`
### Community 22 (tests)
- size: 12 (files: 0, functions: 5, classes: 1)
- members: `tests_test_medication_core_datetime`, `tests_test_medication_core_engine`, `tests_test_medication_core_isoformat`, `tests_test_medication_core_schedule`, `tests_test_medication_core_scheduleengine`, `tests_test_medication_core_scheduleenginetests`, `tests_test_medication_core_self`, `tests_test_medication_core_test_catches_up_after_sleep_or_restart`, `tests_test_medication_core_test_invalid_schedule_is_rejected`, `tests_test_medication_core_test_mark_taken_removes_pending_and_records_completion`, `tests_test_medication_core_test_snooze_suppresses_until_expiry`, `tests_test_medication_core_validate_schedule`
### Community 12 (mixed)
- size: 9 (files: 0, functions: 1, classes: 0)
- members: `medication_reminder_bytearray`, `medication_reminder_io`, `medication_reminder_math`, `medication_reminder_output`, `medication_reminder_raw`, `medication_reminder_struct`, `medication_reminder_tone`, `medication_reminder_wav`, `medication_reminder_wave`
### Community 23 (tests)
- size: 9 (files: 0, functions: 2, classes: 1)
- members: `tests_test_pairing_encryptedsyncclient`, `tests_test_pairing_json`, `tests_test_pairing_pairingtests`, `tests_test_pairing_path`, `tests_test_pairing_read_text`, `tests_test_pairing_self`, `tests_test_pairing_test_encrypted_pairing_payload_round_trips_schedule`, `tests_test_pairing_test_pairing_link_uses_fragment_and_contains_no_schedule`, `tests_test_pairing_validate_schedule`
### Community 49 (web, functions)
- size: 3 (files: 0, functions: 2, classes: 0)
- members: `web_sw_fetch`, `web_sw_self_addeventlistener_fetch_l6_c31`, `web_sw_then_l6_c551`
### Community 28 (tests, functions)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `tests_test_web_sync_revokefromsource_l134_c23`, `tests_test_web_sync_serviceworkermessagehandler`
### Community 29 (tests, functions)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `tests_test_web_update_anon_l6_c33`, `tests_test_web_update_setimmediate`
### Community 60 (web, functions)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `web_sync_resolve`, `web_sync_settimeout_l46_c1058`
### Community 1 (files)
- size: 1 (files: 1, functions: 0, classes: 0)
- members: `agents`
### Community 2 (files)
- size: 1 (files: 1, functions: 0, classes: 0)
- members: `build_windows_exe`
