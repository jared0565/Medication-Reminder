# Graphite Report: `account-boundary`

## Summary
- **Files scanned:** 45
- **Total nodes:** 1205
- **Total edges:** 2219
- **Communities detected:** 119

## Top Files by Connectivity
- `app.js` — degree 53
- `medication_reminder.py` — degree 52
- `medication_core.py` — degree 50
- `qrcode.js` — degree 47
- `index.js` — degree 36
- `sync.js` — degree 28
- `sync_client.py` — degree 23
- `auth.js` — degree 23
- `test_worker_sync.mjs` — degree 20
- `access.js` — degree 20

## God Nodes
- `accountHarness` (function) — in 24 / out 29
- `app.js` (file) — in 16 / out 37
- `medication_reminder.py` (file) — in 0 / out 52
- `medication_core.py` (file) — in 5 / out 45
- `qrcode.js` (file) — in 0 / out 47
- `MedicationReminderApp` (class) — in 2 / out 41
- `prepare` (function) — in 38 / out 4
- `prepare` (function) — in 38 / out 4
- `handleSync` (function) — in 2 / out 40
- `index.js` (file) — in 1 / out 35

## Entry Points
- `medication_reminder.py` — out 52 / in 0 (ratio 52.0)
- `qrcode.js` — out 47 / in 0 (ratio 47.0)
- `index.js` — out 35 / in 1 (ratio 35.0)
- `sync.js` — out 28 / in 0 (ratio 28.0)
- `test_worker_sync.mjs` — out 20 / in 0 (ratio 20.0)
- `access.js` — out 20 / in 0 (ratio 20.0)
- `account.js` — out 20 / in 0 (ratio 20.0)
- `e2e_sync.py` — out 16 / in 0 (ratio 16.0)
- `test_medication_core.py` — out 11 / in 0 (ratio 11.0)
- `test_web_account.mjs` — out 11 / in 0 (ratio 11.0)

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
- size: 167 (files: 0, functions: 54, classes: 1)
- members: `medication_reminder_actions`, `medication_reminder_add_medicine`, `medication_reminder_add_schedule`, `medication_reminder_add_schedule_main`, `medication_reminder_after`, `medication_reminder_alert_buttons`, `medication_reminder_append_audit`, `medication_reminder_apply_remote_schedule`, `medication_reminder_apply_timezone`, `medication_reminder_bind`, `medication_reminder_build_main_window`, `medication_reminder_button_bar`, `medication_reminder_buttons`, `medication_reminder_check_schedule`, `medication_reminder_clipboard_append` ...
### Community 18 (functions)
- size: 135 (files: 3, functions: 117, classes: 0)
- members: `node_fs_promises`, `node_sqlite`, `tests_test_web_access_replace`, `tests_test_worker_auth_all`, `tests_test_worker_auth_batch`, `tests_test_worker_auth_bind`, `tests_test_worker_auth_first`, `tests_test_worker_auth_prepare`, `tests_test_worker_auth_run`, `tests_test_worker_auth_test_api_prefixed_paths_normalize_while_legacy_and_similarly_prefixed_paths_are_l688_c94`, `tests_test_worker_auth_test_auth_preflight_allows_the_csrf_marker_for_the_workers_dev_migration_path_l674_c82`, `tests_test_worker_auth_test_exact_legacy_host_api_auth_requests_cannot_downgrade_into_the_legacy_v1_co_l666_c91`, `tests_test_worker_auth_test_protected_browser_auth_mutations_are_rejected_before_route_dispatch_without_l654_c104`, `tests_test_worker_sync`, `tests_test_worker_sync_all` ...
### Community 9 (mixed)
- size: 114 (files: 0, functions: 42, classes: 9)
- members: `medication_core_append_audit`, `medication_core_appstorage`, `medication_core_astimezone`, `medication_core_atomic_write_bytes`, `medication_core_candidates`, `medication_core_cleanup`, `medication_core_collect_due`, `medication_core_configure_functions`, `medication_core_configvalidationerror`, `medication_core_cryptprotectdata`, `medication_core_cryptunprotectdata`, `medication_core_csv`, `medication_core_ctypes`, `medication_core_data`, `medication_core_datablob` ...
### Community 15 (mixed)
- size: 101 (files: 6, functions: 7, classes: 1)
- members: `aesgcm`, `any`, `appstorage`, `base64`, `configvalidationerror`, `copy`, `cryptography_hazmat_primitives_ciphers_aead`, `csv`, `ctypes`, `dataclass`, `dataclasses`, `date`, `datetime`, `deepcopy`, `dueoccurrence` ...
### Community 28 (functions)
- size: 93 (files: 0, functions: 88, classes: 0)
- members: `tests_test_web_access_addeventlistener`, `tests_test_web_access_assert_throws_l270_c5`, `tests_test_web_access_assert_throws_l317_c5`, `tests_test_web_access_callback`, `tests_test_web_access_close`, `tests_test_web_access_constructor`, `tests_test_web_access_dispatch`, `tests_test_web_access_dispatchevent`, `tests_test_web_access_harness`, `tests_test_web_access_queryselector`, `tests_test_web_access_queuemicrotask`, `tests_test_web_access_readfilesync`, `tests_test_web_access_showmodal`, `tests_test_web_access_stop`, `tests_test_web_access_test_access_api_remains_stable_for_account_and_sync_integrations_l326_c69` ...
### Community 30 (functions)
- size: 92 (files: 1, functions: 68, classes: 0)
- members: `tests_test_web_access_getitem`, `tests_test_web_access_preventdefault`, `tests_test_web_access_setitem`, `tests_test_web_account_getitem`, `tests_test_web_account_setitem`, `tests_test_web_sync_getusermedia`, `web_access_dialog_addeventlistener_cancel_l192_c38`, `web_access_writestorage`, `web_account_anon_l1_c2`, `web_app`, `web_app_active`, `web_app_addeventlistener_click_l37_c42`, `web_app_addeventlistener_close_l34_c42`, `web_app_addmedicine_onclick_l13_c361`, `web_app_addmedicineinput` ...
### Community 36 (mixed)
- size: 77 (files: 1, functions: 34, classes: 0)
- members: `tests_test_web_access_add`, `tests_test_web_access_classlist`, `tests_test_web_access_contains`, `tests_test_web_access_names_foreach_l12_c35`, `tests_test_web_access_remove`, `tests_test_web_access_test_continue_locally_unlocks_without_cloud_capability_l157_c59`, `tests_test_web_access_test_new_browser_stays_privacy_locked_until_a_choice_is_made_l148_c65`, `tests_test_web_sync_add`, `tests_test_web_sync_addeventlistener`, `tests_test_web_sync_alert`, `tests_test_web_sync_append`, `tests_test_web_sync_cancelanimationframe`, `tests_test_web_sync_close`, `tests_test_web_sync_contains`, `tests_test_web_sync_control` ...
### Community 17 (functions)
- size: 65 (files: 6, functions: 41, classes: 0)
- members: `node_assert_strict`, `node_crypto`, `node_fs`, `node_test`, `node_vm`, `tests_test_due_modal`, `tests_test_due_modal_close`, `tests_test_due_modal_showmodal`, `tests_test_due_modal_test`, `tests_test_web_access`, `tests_test_web_access_test`, `tests_test_web_account`, `tests_test_web_account_accountview`, `tests_test_web_account_completegooglerequest_l205_c33`, `tests_test_web_account_completemerequest_l194_c29` ...
### Community 31 (functions)
- size: 65 (files: 1, functions: 49, classes: 0)
- members: `tests_test_web_access_removeitem`, `tests_test_web_access_replacestate`, `tests_test_web_account_removeitem`, `tests_test_web_sync_detect`, `tests_test_web_sync_fillrect`, `tests_test_web_sync_replacestate`, `web_sync`, `web_sync_acceptpairing`, `web_sync_alert`, `web_sync_anon_l1_c2`, `web_sync_anon_l59_c1038`, `web_sync_anon_l59_c921`, `web_sync_api`, `web_sync_atob`, `web_sync_auth` ...
### Community 34 (functions)
- size: 40 (files: 2, functions: 32, classes: 0)
- members: `tests_test_due_modal_readfilesync`, `tests_test_due_modal_replacechildren`, `tests_test_due_modal_test_notification_taps_route_the_private_due_timestamp_back_to_local_modal_data_l43_c84`, `tests_test_due_modal_test_pwa_due_reminder_opens_a_modal_with_one_safe_list_row_per_medication_l6_c78`, `tests_test_due_modal_test_windows_reminder_is_modal_and_creates_one_visible_label_for_every_medicine_l52_c84`, `tests_test_web_account_renderbutton`, `web_account`, `web_account_accessdecisioniscurrent`, `web_account_accessdecisionsnapshot`, `web_account_advanced`, `web_account_alert`, `web_account_anon_l219_c22`, `web_account_anon_l315_c24`, `web_account_anon_l330_c23`, `web_account_choosesignoutaction` ...
### Community 40 (functions)
- size: 34 (files: 1, functions: 27, classes: 0)
- members: `tests_test_web_access_focus`, `tests_test_web_update_addeventlistener`, `tests_test_web_update_alert`, `tests_test_web_update_flush`, `tests_test_web_update_json`, `tests_test_web_update_postmessage`, `tests_test_web_update_queryselector`, `tests_test_web_update_readfilesync`, `tests_test_web_update_register`, `tests_test_web_update_reload`, `tests_test_web_update_test_cloudflare_release_discovery_asks_before_activating_an_update_l75_c71`, `tests_test_web_update_test_declined_updates_are_not_activated_or_repeatedly_prompted_in_the_same_sessi_l85_c87`, `tests_test_web_update_test_startup_reports_no_update_when_cloudflare_version_matches_the_installed_app_l98_c85`, `tests_test_web_update_update`, `tests_test_web_update_updateharness` ...
### Community 22 (mixed)
- size: 32 (files: 0, functions: 12, classes: 3)
- members: `runtimeerror`, `sync_client_aesgcm`, `sync_client_api_url`, `sync_client_b64`, `sync_client_base64`, `sync_client_create_pair`, `sync_client_decode`, `sync_client_decrypt`, `sync_client_encode`, `sync_client_encrypt`, `sync_client_encryptedsyncclient`, `sync_client_exc`, `sync_client_fetch`, `sync_client_init`, `sync_client_json` ...
### Community 27 (web, functions)
- size: 22 (files: 1, functions: 19, classes: 0)
- members: `web_access`, `web_access_anon_l1_c2`, `web_access_chooselocal`, `web_access_cloudsync`, `web_access_dialog_addeventlistener_click_l197_c37`, `web_access_emit`, `web_access_focuschoice`, `web_access_matchmedia`, `web_access_mode`, `web_access_queuemicrotask`, `web_access_readstorage`, `web_access_ready`, `web_access_removestorage`, `web_access_requirecloud`, `web_access_resolveaccount` ...
### Community 13 (mixed)
- size: 20 (files: 0, functions: 2, classes: 0)
- members: `medication_reminder_appstorage`, `medication_reminder_astimezone`, `medication_reminder_ctypes`, `medication_reminder_enable_dpi_awareness`, `medication_reminder_encryptedsyncclient`, `medication_reminder_geometry`, `medication_reminder_init`, `medication_reminder_kernel32`, `medication_reminder_load_schedule`, `medication_reminder_load_settings`, `medication_reminder_load_state`, `medication_reminder_load_sync_credentials`, `medication_reminder_minsize`, `medication_reminder_oserror`, `medication_reminder_protocol` ...
### Community 24 (tests)
- size: 12 (files: 0, functions: 5, classes: 1)
- members: `tests_test_medication_core_datetime`, `tests_test_medication_core_engine`, `tests_test_medication_core_isoformat`, `tests_test_medication_core_schedule`, `tests_test_medication_core_scheduleengine`, `tests_test_medication_core_scheduleenginetests`, `tests_test_medication_core_self`, `tests_test_medication_core_test_catches_up_after_sleep_or_restart`, `tests_test_medication_core_test_invalid_schedule_is_rejected`, `tests_test_medication_core_test_mark_taken_removes_pending_and_records_completion`, `tests_test_medication_core_test_snooze_suppresses_until_expiry`, `tests_test_medication_core_validate_schedule`
### Community 14 (mixed)
- size: 9 (files: 0, functions: 1, classes: 0)
- members: `medication_reminder_bytearray`, `medication_reminder_io`, `medication_reminder_math`, `medication_reminder_output`, `medication_reminder_raw`, `medication_reminder_struct`, `medication_reminder_tone`, `medication_reminder_wav`, `medication_reminder_wave`
### Community 25 (tests)
- size: 9 (files: 0, functions: 2, classes: 1)
- members: `tests_test_pairing_encryptedsyncclient`, `tests_test_pairing_json`, `tests_test_pairing_pairingtests`, `tests_test_pairing_path`, `tests_test_pairing_read_text`, `tests_test_pairing_self`, `tests_test_pairing_test_encrypted_pairing_payload_round_trips_schedule`, `tests_test_pairing_test_pairing_link_uses_fragment_and_contains_no_schedule`, `tests_test_pairing_validate_schedule`
### Community 64 (tests, functions)
- size: 8 (files: 0, functions: 7, classes: 0)
- members: `tests_test_worker_sync_assertindexdefinitions`, `tests_test_worker_sync_readfile`, `tests_test_worker_sync_sqlstatements`, `tests_test_worker_sync_syncpaircolumndefinitions`, `tests_test_worker_sync_test_canonical_schema_has_one_copy_of_every_scoped_credential_column_and_index_l161_c83`, `tests_test_worker_sync_test_scoped_pairing_credentials_migration_has_complete_index_definitions_l152_c77`, `tests_test_worker_sync_test_scoped_pairing_credentials_migration_has_exactly_five_additive_columns_l139_c80`, `tests_test_worker_sync_test_worker_test_script_runs_authentication_and_schema_contracts_l218_c69`
### Community 91 (web, functions)
- size: 4 (files: 0, functions: 3, classes: 0)
- members: `web_account_finish`, `web_account_script_onerror_l206_c24`, `web_account_script_onload_l205_c23`, `web_account_settimeout_l200_c34`
### Community 108 (web, functions)
- size: 3 (files: 0, functions: 2, classes: 0)
- members: `web_sw_fetch`, `web_sw_self_addeventlistener_fetch_l6_c31`, `web_sw_then_l6_c551`
