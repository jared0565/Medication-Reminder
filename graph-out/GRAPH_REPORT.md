# Graphite Report: `Medication Reminder`

## Summary
- **Files scanned:** 29
- **Total nodes:** 756
- **Total edges:** 1264
- **Communities detected:** 64

## Top Files by Connectivity
- `medication_reminder.py` — degree 52
- `medication_core.py` — degree 50
- `qrcode.js` — degree 45
- `app.js` — degree 44
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
- `app.js` (file) — in 17 / out 27
- `MedicationReminderApp` (class) — in 2 / out 41
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
### Community 8 (mixed)
- size: 138 (files: 0, functions: 48, classes: 1)
- members: `medication_reminder_actions`, `medication_reminder_add_schedule`, `medication_reminder_add_schedule_main`, `medication_reminder_after`, `medication_reminder_alert_buttons`, `medication_reminder_append_audit`, `medication_reminder_apply_remote_schedule`, `medication_reminder_apply_timezone`, `medication_reminder_bind`, `medication_reminder_build_main_window`, `medication_reminder_button_bar`, `medication_reminder_buttons`, `medication_reminder_check_schedule`, `medication_reminder_clipboard_append`, `medication_reminder_clipboard_clear` ...
### Community 7 (mixed)
- size: 115 (files: 0, functions: 42, classes: 9)
- members: `medication_core_append_audit`, `medication_core_appstorage`, `medication_core_astimezone`, `medication_core_atomic_write_bytes`, `medication_core_candidates`, `medication_core_cleanup`, `medication_core_collect_due`, `medication_core_configure_functions`, `medication_core_configvalidationerror`, `medication_core_cryptprotectdata`, `medication_core_cryptunprotectdata`, `medication_core_csv`, `medication_core_ctypes`, `medication_core_data`, `medication_core_datablob` ...
### Community 0 (mixed)
- size: 100 (files: 6, functions: 7, classes: 1)
- members: `aesgcm`, `any`, `appstorage`, `base64`, `configvalidationerror`, `copy`, `cryptography_hazmat_primitives_ciphers_aead`, `csv`, `ctypes`, `dataclass`, `dataclasses`, `date`, `datetime`, `deepcopy`, `dueoccurrence` ...
### Community 23 (functions)
- size: 85 (files: 1, functions: 60, classes: 0)
- members: `tests_test_web_sync_getusermedia`, `tests_test_web_sync_showmodal`, `tests_test_web_sync_stop`, `web_app`, `web_app_active`, `web_app_addeventlistener_click_l28_c42`, `web_app_addmedicine_onclick_l14_c361`, `web_app_addmedicineinput`, `web_app_addschedule_onclick_l14_c318`, `web_app_alert`, `web_app_anon_l39_c765`, `web_app_atob`, `web_app_await`, `web_app_btoa`, `web_app_catch_l39_c1469` ...
### Community 22 (functions)
- size: 67 (files: 1, functions: 50, classes: 0)
- members: `tests_test_web_sync_close`, `tests_test_web_sync_detect`, `tests_test_web_sync_queryselector`, `tests_test_web_sync_replacestate`, `web_app_settimeout_l12_c939`, `web_sw_self_addeventlistener_notificationclick_l8_c43`, `web_sync`, `web_sync_acceptpairing`, `web_sync_alert`, `web_sync_anon_l1_c2`, `web_sync_anon_l46_c1038`, `web_sync_anon_l46_c921`, `web_sync_api`, `web_sync_atob`, `web_sync_auth` ...
### Community 44 (web)
- size: 43 (files: 1, functions: 2, classes: 0)
- members: `web_qrcode`, `web_qrcode_base64decodeinputstream`, `web_qrcode_base64encodeoutputstream`, `web_qrcode_bitoutputstream`, `web_qrcode_bytearrayoutputstream`, `web_qrcode_chattonum`, `web_qrcode_createbytes`, `web_qrcode_createdata`, `web_qrcode_createdataurl`, `web_qrcode_createhalfascii`, `web_qrcode_decode`, `web_qrcode_define`, `web_qrcode_encode`, `web_qrcode_escapexml`, `web_qrcode_factory` ...
### Community 19 (mixed)
- size: 32 (files: 0, functions: 12, classes: 3)
- members: `runtimeerror`, `sync_client_aesgcm`, `sync_client_api_url`, `sync_client_b64`, `sync_client_base64`, `sync_client_create_pair`, `sync_client_decode`, `sync_client_decrypt`, `sync_client_encode`, `sync_client_encrypt`, `sync_client_encryptedsyncclient`, `sync_client_exc`, `sync_client_fetch`, `sync_client_init`, `sync_client_json` ...
### Community 15 (functions)
- size: 29 (files: 1, functions: 21, classes: 0)
- members: `node_assert_strict`, `node_crypto`, `node_fs`, `node_test`, `node_vm`, `tests_test_web_sync`, `tests_test_web_sync_add`, `tests_test_web_sync_addeventlistener`, `tests_test_web_sync_alert`, `tests_test_web_sync_append`, `tests_test_web_sync_cancelanimationframe`, `tests_test_web_sync_contains`, `tests_test_web_sync_control`, `tests_test_web_sync_createelement`, `tests_test_web_sync_dialog` ...
### Community 9 (mixed)
- size: 23 (files: 0, functions: 5, classes: 0)
- members: `medication_reminder_add_medicine`, `medication_reminder_days_var`, `medication_reminder_edit_medicine`, `medication_reminder_enabled_var`, `medication_reminder_end_var`, `medication_reminder_item`, `medication_reminder_label_var`, `medication_reminder_lower`, `medication_reminder_medicines_box`, `medication_reminder_parse_time`, `medication_reminder_refresh_callback`, `medication_reminder_remove_medicine`, `medication_reminder_save`, `medication_reminder_selected_main_event_index`, `medication_reminder_selection` ...
### Community 10 (mixed)
- size: 20 (files: 0, functions: 2, classes: 0)
- members: `medication_reminder_appstorage`, `medication_reminder_astimezone`, `medication_reminder_ctypes`, `medication_reminder_enable_dpi_awareness`, `medication_reminder_encryptedsyncclient`, `medication_reminder_geometry`, `medication_reminder_init`, `medication_reminder_kernel32`, `medication_reminder_load_schedule`, `medication_reminder_load_settings`, `medication_reminder_load_state`, `medication_reminder_load_sync_credentials`, `medication_reminder_minsize`, `medication_reminder_oserror`, `medication_reminder_protocol` ...
### Community 11 (mixed)
- size: 15 (files: 0, functions: 2, classes: 0)
- members: `medication_reminder_bytearray`, `medication_reminder_create_pair`, `medication_reminder_credentials`, `medication_reminder_fetch`, `medication_reminder_io`, `medication_reminder_math`, `medication_reminder_output`, `medication_reminder_raw`, `medication_reminder_sound_api`, `medication_reminder_sound_profiles`, `medication_reminder_struct`, `medication_reminder_tone`, `medication_reminder_wav`, `medication_reminder_wave`, `medication_reminder_worker`
### Community 43 (worker/src, functions)
- size: 14 (files: 1, functions: 12, classes: 0)
- members: `web_push`, `worker_src_index`, `worker_src_index_authenticatedpair`, `worker_src_index_corsheaders`, `worker_src_index_enforceratelimit`, `worker_src_index_fetch`, `worker_src_index_handlesync`, `worker_src_index_json`, `worker_src_index_notifypairedmobile`, `worker_src_index_readjson`, `worker_src_index_scheduled`, `worker_src_index_tokenhash`, `worker_src_index_validencryptedbody`, `worker_src_index_validpushendpoint`
### Community 20 (tests)
- size: 12 (files: 0, functions: 5, classes: 1)
- members: `tests_test_medication_core_datetime`, `tests_test_medication_core_engine`, `tests_test_medication_core_isoformat`, `tests_test_medication_core_schedule`, `tests_test_medication_core_scheduleengine`, `tests_test_medication_core_scheduleenginetests`, `tests_test_medication_core_self`, `tests_test_medication_core_test_catches_up_after_sleep_or_restart`, `tests_test_medication_core_test_invalid_schedule_is_rejected`, `tests_test_medication_core_test_mark_taken_removes_pending_and_records_completion`, `tests_test_medication_core_test_snooze_suppresses_until_expiry`, `tests_test_medication_core_validate_schedule`
### Community 21 (tests)
- size: 9 (files: 0, functions: 2, classes: 1)
- members: `tests_test_pairing_encryptedsyncclient`, `tests_test_pairing_json`, `tests_test_pairing_pairingtests`, `tests_test_pairing_path`, `tests_test_pairing_read_text`, `tests_test_pairing_self`, `tests_test_pairing_test_encrypted_pairing_payload_round_trips_schedule`, `tests_test_pairing_test_pairing_link_uses_fragment_and_contains_no_schedule`, `tests_test_pairing_validate_schedule`
### Community 47 (web, functions)
- size: 3 (files: 0, functions: 2, classes: 0)
- members: `web_sw_fetch`, `web_sw_self_addeventlistener_fetch_l6_c31`, `web_sw_then_l6_c551`
### Community 24 (tests, functions)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `tests_test_web_sync_revokefromsource_l134_c23`, `tests_test_web_sync_serviceworkermessagehandler`
### Community 59 (web, functions)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `web_sync_resolve`, `web_sync_settimeout_l46_c1058`
### Community 1 (files)
- size: 1 (files: 1, functions: 0, classes: 0)
- members: `agents`
### Community 2 (files)
- size: 1 (files: 1, functions: 0, classes: 0)
- members: `build_windows_exe`
### Community 3 (docs, files)
- size: 1 (files: 1, functions: 0, classes: 0)
- members: `docs_graphite_query_interface_recommendation`
