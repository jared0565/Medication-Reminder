# Graphite Report: `account-boundary`

## Summary
- **Files scanned:** 45
- **Total nodes:** 1363
- **Total edges:** 2617
- **Communities detected:** 147

## Top Files by Connectivity
- `sync.js` — degree 64
- `app.js` — degree 54
- `medication_reminder.py` — degree 52
- `medication_core.py` — degree 50
- `qrcode.js` — degree 47
- `index.js` — degree 39
- `sync_client.py` — degree 23
- `auth.js` — degree 23
- `test_worker_sync.mjs` — degree 20
- `access.js` — degree 20

## God Nodes
- `installedMobileHarness` (function) — in 42 / out 23
- `sync.js` (file) — in 0 / out 64
- `app.js` (file) — in 16 / out 38
- `accountHarness` (function) — in 24 / out 29
- `medication_reminder.py` (file) — in 0 / out 52
- `medication_core.py` (file) — in 5 / out 45
- `qrcode.js` (file) — in 0 / out 47
- `prepare` (function) — in 41 / out 4
- `prepare` (function) — in 41 / out 4
- `handleSync` (function) — in 2 / out 42

## Entry Points
- `sync.js` — out 64 / in 0 (ratio 64.0)
- `medication_reminder.py` — out 52 / in 0 (ratio 52.0)
- `qrcode.js` — out 47 / in 0 (ratio 47.0)
- `index.js` — out 38 / in 1 (ratio 38.0)
- `test_worker_sync.mjs` — out 20 / in 0 (ratio 20.0)
- `access.js` — out 20 / in 0 (ratio 20.0)
- `test_web_sync.mjs` — out 18 / in 0 (ratio 18.0)
- `account.js` — out 18 / in 0 (ratio 18.0)
- `e2e_sync.py` — out 16 / in 0 (ratio 16.0)
- `test_medication_core.py` — out 11 / in 0 (ratio 11.0)

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
### Community 11 (mixed)
- size: 177 (files: 0, functions: 55, classes: 1)
- members: `medication_reminder_actions`, `medication_reminder_add_medicine`, `medication_reminder_add_schedule`, `medication_reminder_add_schedule_main`, `medication_reminder_after`, `medication_reminder_alert_buttons`, `medication_reminder_append_audit`, `medication_reminder_apply_remote_schedule`, `medication_reminder_apply_timezone`, `medication_reminder_bind`, `medication_reminder_build_main_window`, `medication_reminder_button_bar`, `medication_reminder_buttons`, `medication_reminder_bytearray`, `medication_reminder_check_schedule` ...
### Community 16 (functions)
- size: 145 (files: 3, functions: 126, classes: 0)
- members: `node_fs_promises`, `node_sqlite`, `tests_test_worker_auth_all`, `tests_test_worker_auth_batch`, `tests_test_worker_auth_bind`, `tests_test_worker_auth_first`, `tests_test_worker_auth_prepare`, `tests_test_worker_auth_run`, `tests_test_worker_sync`, `tests_test_worker_sync_all`, `tests_test_worker_sync_assertindexdefinitions`, `tests_test_worker_sync_batch`, `tests_test_worker_sync_bind`, `tests_test_worker_sync_btoa`, `tests_test_worker_sync_claim` ...
### Community 13 (mixed)
- size: 119 (files: 6, functions: 9, classes: 1)
- members: `aesgcm`, `any`, `appstorage`, `base64`, `configvalidationerror`, `copy`, `cryptography_hazmat_primitives_ciphers_aead`, `csv`, `ctypes`, `dataclass`, `dataclasses`, `date`, `datetime`, `deepcopy`, `dueoccurrence` ...
### Community 28 (functions)
- size: 119 (files: 1, functions: 103, classes: 0)
- members: `tests_test_web_access_getitem`, `tests_test_web_access_removeitem`, `tests_test_web_access_setitem`, `tests_test_web_account_getitem`, `tests_test_web_account_removeitem`, `tests_test_web_account_setitem`, `tests_test_web_sync_detect`, `tests_test_web_sync_removeitem`, `tests_test_web_sync_setitem`, `web_access_removestorage`, `web_access_writestorage`, `web_account_anon_l1_c2`, `web_app_clearprematuretaken`, `web_app_readstoredjson_l2_c165`, `web_app_save_l3_c162` ...
### Community 9 (mixed)
- size: 115 (files: 0, functions: 42, classes: 9)
- members: `medication_core_append_audit`, `medication_core_appstorage`, `medication_core_astimezone`, `medication_core_atomic_write_bytes`, `medication_core_candidates`, `medication_core_cleanup`, `medication_core_collect_due`, `medication_core_configure_functions`, `medication_core_configvalidationerror`, `medication_core_cryptprotectdata`, `medication_core_cryptunprotectdata`, `medication_core_csv`, `medication_core_ctypes`, `medication_core_data`, `medication_core_datablob` ...
### Community 24 (functions)
- size: 90 (files: 1, functions: 66, classes: 0)
- members: `tests_test_web_access_add`, `tests_test_web_access_names_foreach_l12_c35`, `tests_test_web_access_preventdefault`, `tests_test_web_access_replace`, `tests_test_web_sync_add`, `tests_test_web_sync_adddata`, `tests_test_web_sync_fillrect`, `tests_test_web_sync_getusermedia`, `tests_test_web_sync_make`, `tests_test_web_sync_toggle`, `web_access_dialog_addeventlistener_cancel_l192_c38`, `web_app`, `web_app_active`, `web_app_addeventlistener_click_l37_c42`, `web_app_addeventlistener_close_l34_c42` ...
### Community 26 (tests, functions)
- size: 84 (files: 0, functions: 73, classes: 0)
- members: `tests_test_web_access_assert_throws_l270_c5`, `tests_test_web_access_assert_throws_l317_c5`, `tests_test_web_access_test_account_resolution_emits_a_safe_access_event_and_enables_entitled_cloud_use_l297_c85`, `tests_test_web_account_requirecloud`, `tests_test_web_account_resolveaccount`, `tests_test_web_sync_addeventlistener`, `tests_test_web_sync_append`, `tests_test_web_sync_cancelanimationframe`, `tests_test_web_sync_close`, `tests_test_web_sync_control`, `tests_test_web_sync_createelement`, `tests_test_web_sync_dialog`, `tests_test_web_sync_dispatchevent`, `tests_test_web_sync_encode`, `tests_test_web_sync_encryptedremote` ...
### Community 15 (functions)
- size: 74 (files: 6, functions: 50, classes: 0)
- members: `node_assert_strict`, `node_crypto`, `node_fs`, `node_test`, `node_vm`, `tests_test_due_modal`, `tests_test_due_modal_close`, `tests_test_due_modal_showmodal`, `tests_test_due_modal_test`, `tests_test_web_access`, `tests_test_web_access_test`, `tests_test_web_account`, `tests_test_web_account_accountview`, `tests_test_web_account_completegooglerequest_l205_c33`, `tests_test_web_account_completemerequest_l194_c29` ...
### Community 25 (functions)
- size: 63 (files: 1, functions: 58, classes: 0)
- members: `tests_test_web_access_addeventlistener`, `tests_test_web_access_callback`, `tests_test_web_access_classlist`, `tests_test_web_access_close`, `tests_test_web_access_constructor`, `tests_test_web_access_contains`, `tests_test_web_access_dispatch`, `tests_test_web_access_dispatchevent`, `tests_test_web_access_harness`, `tests_test_web_access_queryselector`, `tests_test_web_access_queuemicrotask`, `tests_test_web_access_readfilesync`, `tests_test_web_access_remove`, `tests_test_web_access_replacestate`, `tests_test_web_access_showmodal` ...
### Community 30 (tests, functions)
- size: 55 (files: 0, functions: 52, classes: 0)
- members: `tests_test_web_account_accountharness`, `tests_test_web_account_addeventlistener`, `tests_test_web_account_alert`, `tests_test_web_account_anon_l339_c23`, `tests_test_web_account_anon_l353_c23`, `tests_test_web_account_anon_l368_c23`, `tests_test_web_account_anon_l429_c21`, `tests_test_web_account_append`, `tests_test_web_account_chooselocal`, `tests_test_web_account_clearmedicationschedule`, `tests_test_web_account_clearschedulecalls`, `tests_test_web_account_close`, `tests_test_web_account_completegooglerequest`, `tests_test_web_account_completemerequest`, `tests_test_web_account_constructor` ...
### Community 131 (web)
- size: 43 (files: 1, functions: 2, classes: 0)
- members: `web_qrcode`, `web_qrcode_base64decodeinputstream`, `web_qrcode_base64encodeoutputstream`, `web_qrcode_bitoutputstream`, `web_qrcode_bytearrayoutputstream`, `web_qrcode_chattonum`, `web_qrcode_createbytes`, `web_qrcode_createdata`, `web_qrcode_createdataurl`, `web_qrcode_createhalfascii`, `web_qrcode_decode`, `web_qrcode_define`, `web_qrcode_encode`, `web_qrcode_escapexml`, `web_qrcode_factory` ...
### Community 21 (functions)
- size: 39 (files: 2, functions: 31, classes: 0)
- members: `tests_test_due_modal_readfilesync`, `tests_test_due_modal_replacechildren`, `tests_test_due_modal_test_notification_taps_route_the_private_due_timestamp_back_to_local_modal_data_l43_c84`, `tests_test_due_modal_test_pwa_due_reminder_opens_a_modal_with_one_safe_list_row_per_medication_l6_c78`, `tests_test_due_modal_test_windows_reminder_is_modal_and_creates_one_visible_label_for_every_medicine_l52_c84`, `tests_test_web_account_renderbutton`, `web_account`, `web_account_accessdecisioniscurrent`, `web_account_accessdecisionsnapshot`, `web_account_advanced`, `web_account_alert`, `web_account_anon_l219_c22`, `web_account_anon_l315_c24`, `web_account_anon_l330_c23`, `web_account_choosesignoutaction` ...
### Community 59 (functions)
- size: 34 (files: 1, functions: 27, classes: 0)
- members: `tests_test_web_access_focus`, `tests_test_web_update_addeventlistener`, `tests_test_web_update_alert`, `tests_test_web_update_flush`, `tests_test_web_update_json`, `tests_test_web_update_postmessage`, `tests_test_web_update_queryselector`, `tests_test_web_update_readfilesync`, `tests_test_web_update_register`, `tests_test_web_update_reload`, `tests_test_web_update_test_cloudflare_release_discovery_asks_before_activating_an_update_l75_c71`, `tests_test_web_update_test_declined_updates_are_not_activated_or_repeatedly_prompted_in_the_same_sessi_l85_c87`, `tests_test_web_update_test_startup_reports_no_update_when_cloudflare_version_matches_the_installed_app_l98_c85`, `tests_test_web_update_update`, `tests_test_web_update_updateharness` ...
### Community 20 (mixed)
- size: 32 (files: 0, functions: 12, classes: 3)
- members: `runtimeerror`, `sync_client_aesgcm`, `sync_client_api_url`, `sync_client_b64`, `sync_client_base64`, `sync_client_create_pair`, `sync_client_decode`, `sync_client_decrypt`, `sync_client_encode`, `sync_client_encrypt`, `sync_client_encryptedsyncclient`, `sync_client_exc`, `sync_client_fetch`, `sync_client_init`, `sync_client_json` ...
### Community 22 (tests)
- size: 12 (files: 0, functions: 5, classes: 1)
- members: `tests_test_medication_core_datetime`, `tests_test_medication_core_engine`, `tests_test_medication_core_isoformat`, `tests_test_medication_core_schedule`, `tests_test_medication_core_scheduleengine`, `tests_test_medication_core_scheduleenginetests`, `tests_test_medication_core_self`, `tests_test_medication_core_test_catches_up_after_sleep_or_restart`, `tests_test_medication_core_test_invalid_schedule_is_rejected`, `tests_test_medication_core_test_mark_taken_removes_pending_and_records_completion`, `tests_test_medication_core_test_snooze_suppresses_until_expiry`, `tests_test_medication_core_validate_schedule`
### Community 23 (tests)
- size: 9 (files: 0, functions: 2, classes: 1)
- members: `tests_test_pairing_encryptedsyncclient`, `tests_test_pairing_json`, `tests_test_pairing_pairingtests`, `tests_test_pairing_path`, `tests_test_pairing_read_text`, `tests_test_pairing_self`, `tests_test_pairing_test_encrypted_pairing_payload_round_trips_schedule`, `tests_test_pairing_test_pairing_link_uses_fragment_and_contains_no_schedule`, `tests_test_pairing_validate_schedule`
### Community 140 (web, functions)
- size: 5 (files: 0, functions: 3, classes: 0)
- members: `web_sync_cleartimeout`, `web_sync_resolve`, `web_sync_settimeout_l1021_c32`, `web_sync_then_l1027_c37`, `web_sync_then_l1032_c10`
### Community 41 (tests, functions)
- size: 4 (files: 0, functions: 3, classes: 0)
- members: `tests_test_web_sync_continuation`, `tests_test_web_sync_releasedecrypt_l1314_c28`, `tests_test_web_sync_releasedecrypt_l501_c30`, `tests_test_web_sync_releaseencryption_l1247_c29`
### Community 116 (web, functions)
- size: 4 (files: 0, functions: 3, classes: 0)
- members: `web_account_finish`, `web_account_script_onerror_l206_c24`, `web_account_script_onload_l205_c23`, `web_account_settimeout_l200_c34`
### Community 36 (tests, functions)
- size: 3 (files: 0, functions: 2, classes: 0)
- members: `tests_test_web_sync_anon_l245_c25`, `tests_test_web_sync_anon_l246_c25`, `tests_test_web_sync_settimeout`
