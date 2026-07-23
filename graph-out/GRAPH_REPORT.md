# Graphite Report: `account-boundary`

## Summary
- **Files scanned:** 43
- **Total nodes:** 952
- **Total edges:** 1665
- **Communities detected:** 92

## Top Files by Connectivity
- `medication_reminder.py` — degree 52
- `app.js` — degree 52
- `medication_core.py` — degree 50
- `qrcode.js` — degree 45
- `sync.js` — degree 28
- `sync_client.py` — degree 23
- `auth.js` — degree 21
- `e2e_sync.py` — degree 16
- `index.js` — degree 15
- `account.js` — degree 13

## God Nodes
- `medication_reminder.py` (file) — in 0 / out 52
- `app.js` (file) — in 16 / out 36
- `medication_core.py` (file) — in 5 / out 45
- `qrcode.js` (file) — in 0 / out 45
- `MedicationReminderApp` (class) — in 2 / out 41
- `fetch` (function) — in 18 / out 13
- `sync.js` (file) — in 0 / out 28
- `__init__` (function) — in 2 / out 22
- `sync_client.py` (file) — in 3 / out 20
- `installedMobileHarness` (function) — in 5 / out 16

## Entry Points
- `medication_reminder.py` — out 52 / in 0 (ratio 52.0)
- `qrcode.js` — out 45 / in 0 (ratio 45.0)
- `sync.js` — out 28 / in 0 (ratio 28.0)
- `auth.js` — out 20 / in 1 (ratio 20.0)
- `e2e_sync.py` — out 16 / in 0 (ratio 16.0)
- `index.js` — out 15 / in 0 (ratio 15.0)
- `account.js` — out 13 / in 0 (ratio 13.0)
- `test_medication_core.py` — out 11 / in 0 (ratio 11.0)
- `test_worker_sync.mjs` — out 11 / in 0 (ratio 11.0)
- `test_pairing.py` — out 10 / in 0 (ratio 10.0)

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
### Community 12 (mixed)
- size: 164 (files: 0, functions: 53, classes: 1)
- members: `medication_reminder_actions`, `medication_reminder_add_medicine`, `medication_reminder_add_schedule`, `medication_reminder_add_schedule_main`, `medication_reminder_after`, `medication_reminder_alert_buttons`, `medication_reminder_append_audit`, `medication_reminder_apply_remote_schedule`, `medication_reminder_apply_timezone`, `medication_reminder_bind`, `medication_reminder_build_main_window`, `medication_reminder_button_bar`, `medication_reminder_buttons`, `medication_reminder_check_schedule`, `medication_reminder_clipboard_append` ...
### Community 9 (mixed)
- size: 115 (files: 0, functions: 42, classes: 9)
- members: `medication_core_append_audit`, `medication_core_appstorage`, `medication_core_astimezone`, `medication_core_atomic_write_bytes`, `medication_core_candidates`, `medication_core_cleanup`, `medication_core_collect_due`, `medication_core_configure_functions`, `medication_core_configvalidationerror`, `medication_core_cryptprotectdata`, `medication_core_cryptunprotectdata`, `medication_core_csv`, `medication_core_ctypes`, `medication_core_data`, `medication_core_datablob` ...
### Community 0 (mixed)
- size: 103 (files: 6, functions: 8, classes: 1)
- members: `aesgcm`, `any`, `appstorage`, `base64`, `configvalidationerror`, `copy`, `cryptography_hazmat_primitives_ciphers_aead`, `csv`, `ctypes`, `dataclass`, `dataclasses`, `date`, `datetime`, `deepcopy`, `dueoccurrence` ...
### Community 23 (functions)
- size: 98 (files: 2, functions: 73, classes: 0)
- members: `tests_test_due_modal_close`, `tests_test_due_modal_readfilesync`, `tests_test_due_modal_showmodal`, `tests_test_due_modal_test_notification_taps_route_the_private_due_timestamp_back_to_local_modal_data_l43_c84`, `tests_test_due_modal_test_pwa_due_reminder_opens_a_modal_with_one_safe_list_row_per_medication_l6_c78`, `tests_test_due_modal_test_windows_reminder_is_modal_and_creates_one_visible_label_for_every_medicine_l52_c84`, `tests_test_web_sync_close`, `tests_test_web_sync_getusermedia`, `tests_test_web_sync_showmodal`, `tests_test_web_sync_stop`, `tests_test_worker_sync_inspectsyncpairs`, `web_app`, `web_app_active`, `web_app_addeventlistener_click_l37_c42`, `web_app_addeventlistener_close_l34_c42` ...
### Community 31 (functions)
- size: 90 (files: 2, functions: 75, classes: 0)
- members: `tests_test_web_sync_json`, `tests_test_web_update_json`, `tests_test_worker_auth_all`, `tests_test_worker_auth_authdatabase`, `tests_test_worker_auth_b64url`, `tests_test_worker_auth_batch`, `tests_test_worker_auth_bind`, `tests_test_worker_auth_dev_hosts_cannot_enter_the_legacy_v1_google_contract_l428_c97`, `tests_test_worker_auth_first`, `tests_test_worker_auth_fixture`, `tests_test_worker_auth_handleauthrequest`, `tests_test_worker_auth_json`, `tests_test_worker_auth_prepare`, `tests_test_worker_auth_readjson_l321_c19`, `tests_test_worker_auth_readjson_l353_c17` ...
### Community 28 (mixed)
- size: 67 (files: 1, functions: 24, classes: 0)
- members: `tests_test_web_sync_add`, `tests_test_web_sync_addeventlistener`, `tests_test_web_sync_alert`, `tests_test_web_sync_append`, `tests_test_web_sync_cancelanimationframe`, `tests_test_web_sync_contains`, `tests_test_web_sync_control`, `tests_test_web_sync_createelement`, `tests_test_web_sync_dialog`, `tests_test_web_sync_encode`, `tests_test_web_sync_fillrect`, `tests_test_web_sync_installedmobileharness`, `tests_test_web_sync_play`, `tests_test_web_sync_readfilesync`, `tests_test_web_sync_remove` ...
### Community 29 (functions)
- size: 66 (files: 1, functions: 49, classes: 0)
- members: `tests_test_web_sync_detect`, `tests_test_web_sync_queryselector`, `tests_test_web_sync_replacestate`, `tests_test_web_update_queryselector`, `web_sync`, `web_sync_acceptpairing`, `web_sync_alert`, `web_sync_anon_l1_c2`, `web_sync_anon_l59_c1038`, `web_sync_anon_l59_c921`, `web_sync_api`, `web_sync_atob`, `web_sync_auth`, `web_sync_b64`, `web_sync_btoa` ...
### Community 18 (tests)
- size: 32 (files: 6, functions: 12, classes: 0)
- members: `node_assert_strict`, `node_crypto`, `node_fs`, `node_fs_promises`, `node_sqlite`, `node_test`, `node_vm`, `tests_test_due_modal`, `tests_test_due_modal_test`, `tests_test_web_account`, `tests_test_web_account_test`, `tests_test_web_sync`, `tests_test_web_sync_test`, `tests_test_web_update`, `tests_test_web_update_test` ...
### Community 22 (mixed)
- size: 32 (files: 0, functions: 12, classes: 3)
- members: `runtimeerror`, `sync_client_aesgcm`, `sync_client_api_url`, `sync_client_b64`, `sync_client_base64`, `sync_client_create_pair`, `sync_client_decode`, `sync_client_decrypt`, `sync_client_encode`, `sync_client_encrypt`, `sync_client_encryptedsyncclient`, `sync_client_exc`, `sync_client_fetch`, `sync_client_init`, `sync_client_json` ...
### Community 33 (functions)
- size: 27 (files: 1, functions: 21, classes: 0)
- members: `tests_test_web_update_addeventlistener`, `tests_test_web_update_alert`, `tests_test_web_update_flush`, `tests_test_web_update_postmessage`, `tests_test_web_update_readfilesync`, `tests_test_web_update_register`, `tests_test_web_update_reload`, `tests_test_web_update_test_cloudflare_release_discovery_asks_before_activating_an_update_l75_c71`, `tests_test_web_update_test_declined_updates_are_not_activated_or_repeatedly_prompted_in_the_same_sessi_l85_c87`, `tests_test_web_update_test_startup_reports_no_update_when_cloudflare_version_matches_the_installed_app_l98_c85`, `tests_test_web_update_update`, `tests_test_web_update_updateharness`, `web_sw_list_foreach_l7_c569`, `web_update`, `web_update_alert` ...
### Community 15 (mixed)
- size: 20 (files: 0, functions: 2, classes: 0)
- members: `medication_reminder_appstorage`, `medication_reminder_astimezone`, `medication_reminder_ctypes`, `medication_reminder_enable_dpi_awareness`, `medication_reminder_encryptedsyncclient`, `medication_reminder_geometry`, `medication_reminder_init`, `medication_reminder_kernel32`, `medication_reminder_load_schedule`, `medication_reminder_load_settings`, `medication_reminder_load_state`, `medication_reminder_load_sync_credentials`, `medication_reminder_minsize`, `medication_reminder_oserror`, `medication_reminder_protocol` ...
### Community 24 (functions)
- size: 20 (files: 1, functions: 16, classes: 0)
- members: `tests_test_due_modal_replacechildren`, `web_account`, `web_account_advanced`, `web_account_alert`, `web_account_anon_l1_c2`, `web_account_authorizationheaders`, `web_account_confirm`, `web_account_current`, `web_account_elements_save_onclick_l115_c25`, `web_account_elements_signout_onclick_l125_c28`, `web_account_handlegooglecredential`, `web_account_initialize`, `web_account_loadgooglelibrary`, `web_account_matchmedia`, `web_account_render` ...
### Community 25 (tests)
- size: 12 (files: 0, functions: 5, classes: 1)
- members: `tests_test_medication_core_datetime`, `tests_test_medication_core_engine`, `tests_test_medication_core_isoformat`, `tests_test_medication_core_schedule`, `tests_test_medication_core_scheduleengine`, `tests_test_medication_core_scheduleenginetests`, `tests_test_medication_core_self`, `tests_test_medication_core_test_catches_up_after_sleep_or_restart`, `tests_test_medication_core_test_invalid_schedule_is_rejected`, `tests_test_medication_core_test_mark_taken_removes_pending_and_records_completion`, `tests_test_medication_core_test_snooze_suppresses_until_expiry`, `tests_test_medication_core_validate_schedule`
### Community 14 (mixed)
- size: 9 (files: 0, functions: 1, classes: 0)
- members: `medication_reminder_bytearray`, `medication_reminder_io`, `medication_reminder_math`, `medication_reminder_output`, `medication_reminder_raw`, `medication_reminder_struct`, `medication_reminder_tone`, `medication_reminder_wav`, `medication_reminder_wave`
### Community 26 (tests)
- size: 9 (files: 0, functions: 2, classes: 1)
- members: `tests_test_pairing_encryptedsyncclient`, `tests_test_pairing_json`, `tests_test_pairing_pairingtests`, `tests_test_pairing_path`, `tests_test_pairing_read_text`, `tests_test_pairing_self`, `tests_test_pairing_test_encrypted_pairing_payload_round_trips_schedule`, `tests_test_pairing_test_pairing_link_uses_fragment_and_contains_no_schedule`, `tests_test_pairing_validate_schedule`
### Community 27 (tests, functions)
- size: 4 (files: 0, functions: 3, classes: 0)
- members: `tests_test_web_account_readfilesync`, `tests_test_web_account_test_account_client_uses_the_public_client_id_indirectly_and_never_embeds_an_oau_l5_c94`, `tests_test_web_account_test_pair_creation_requires_server_derived_advanced_access_and_sends_the_account_l13_c93`, `tests_test_web_account_test_security_policy_permits_google_identity_services_while_blocking_plugins_and_l19_c93`
### Community 36 (tests, functions)
- size: 4 (files: 0, functions: 3, classes: 0)
- members: `tests_test_worker_auth_assert_rejects_l719_c24`, `tests_test_worker_auth_assert_rejects_l725_c24`, `tests_test_worker_auth_assert_rejects_l728_c24`, `tests_test_worker_auth_verifygooglecredential`
### Community 76 (web, functions)
- size: 3 (files: 0, functions: 2, classes: 0)
- members: `web_sw_fetch`, `web_sw_self_addeventlistener_fetch_l6_c31`, `web_sw_then_l6_c551`
### Community 32 (tests, functions)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `tests_test_web_sync_revokefromsource_l135_c23`, `tests_test_web_sync_serviceworkermessagehandler`
### Community 34 (tests, functions)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `tests_test_web_update_anon_l6_c33`, `tests_test_web_update_setimmediate`
