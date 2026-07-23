# Graphite Report: `Medication Reminder`

## Summary
- **Files scanned:** 46
- **Total nodes:** 1410
- **Total edges:** 2709
- **Communities detected:** 141

## Top Files by Connectivity
- `sync.js` — degree 64
- `app.js` — degree 54
- `medication_reminder.py` — degree 52
- `medication_core.py` — degree 50
- `qrcode.js` — degree 48
- `index.js` — degree 39
- `auth.js` — degree 24
- `sync_client.py` — degree 23
- `test_worker_sync.mjs` — degree 20
- `access.js` — degree 20

## God Nodes
- `installedMobileHarness` (function) — in 42 / out 23
- `sync.js` (file) — in 0 / out 64
- `app.js` (file) — in 16 / out 38
- `accountHarness` (function) — in 24 / out 29
- `medication_reminder.py` (file) — in 0 / out 52
- `medication_core.py` (file) — in 5 / out 45
- `qrcode.js` (file) — in 0 / out 48
- `prepare` (function) — in 41 / out 4
- `prepare` (function) — in 41 / out 4
- `handleSync` (function) — in 2 / out 43

## Entry Points
- `sync.js` — out 64 / in 0 (ratio 64.0)
- `medication_reminder.py` — out 52 / in 0 (ratio 52.0)
- `qrcode.js` — out 48 / in 0 (ratio 48.0)
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
- size: 176 (files: 0, functions: 55, classes: 1)
- members: `medication_reminder_actions`, `medication_reminder_add_medicine`, `medication_reminder_add_schedule`, `medication_reminder_add_schedule_main`, `medication_reminder_after`, `medication_reminder_alert_buttons`, `medication_reminder_append_audit`, `medication_reminder_apply_remote_schedule`, `medication_reminder_apply_timezone`, `medication_reminder_bind`, `medication_reminder_build_main_window`, `medication_reminder_button_bar`, `medication_reminder_buttons`, `medication_reminder_bytearray`, `medication_reminder_check_schedule` ...
### Community 85 (functions)
- size: 148 (files: 3, functions: 129, classes: 0)
- members: `node_fs_promises`, `node_sqlite`, `tests_test_web_access_replace`, `tests_test_web_sw_match`, `tests_test_worker_auth_all`, `tests_test_worker_auth_bind`, `tests_test_worker_auth_first`, `tests_test_worker_auth_prepare`, `tests_test_worker_auth_run`, `tests_test_worker_sync`, `tests_test_worker_sync_all`, `tests_test_worker_sync_assertindexdefinitions`, `tests_test_worker_sync_batch`, `tests_test_worker_sync_bind`, `tests_test_worker_sync_btoa` ...
### Community 4 (mixed)
- size: 128 (files: 1, functions: 42, classes: 9)
- members: `copy`, `csv`, `ctypes`, `date`, `deepcopy`, `medication_core`, `medication_core_append_audit`, `medication_core_appstorage`, `medication_core_astimezone`, `medication_core_atomic_write_bytes`, `medication_core_candidates`, `medication_core_cleanup`, `medication_core_collect_due`, `medication_core_configure_functions`, `medication_core_configvalidationerror` ...
### Community 2 (mixed)
- size: 119 (files: 5, functions: 14, classes: 2)
- members: `aesgcm`, `any`, `appstorage`, `base64`, `configvalidationerror`, `cryptography_hazmat_primitives_ciphers_aead`, `dataclass`, `dataclasses`, `datetime`, `dueoccurrence`, `encryptedsyncclient`, `filedialog`, `image`, `imagetk`, `io` ...
### Community 27 (functions)
- size: 115 (files: 1, functions: 97, classes: 0)
- members: `tests_test_web_access_getitem`, `tests_test_web_access_removeitem`, `tests_test_web_account_getitem`, `tests_test_web_account_removeitem`, `tests_test_web_sync_detect`, `tests_test_web_sync_removeitem`, `web_access_removestorage`, `web_app_readstoredjson_l2_c165`, `web_sync`, `web_sync_acceptlegacypairing`, `web_sync_acceptpairing`, `web_sync_alert`, `web_sync_anon_l1019_c81`, `web_sync_anon_l1_c2`, `web_sync_api` ...
### Community 23 (functions)
- size: 97 (files: 1, functions: 73, classes: 0)
- members: `tests_test_web_access_add`, `tests_test_web_access_names_foreach_l12_c35`, `tests_test_web_access_preventdefault`, `tests_test_web_access_setitem`, `tests_test_web_account_setitem`, `tests_test_web_sync_add`, `tests_test_web_sync_adddata`, `tests_test_web_sync_fillrect`, `tests_test_web_sync_getusermedia`, `tests_test_web_sync_make`, `tests_test_web_sync_setitem`, `tests_test_web_sync_toggle`, `web_access_dialog_addeventlistener_cancel_l192_c38`, `web_access_writestorage`, `web_account_anon_l1_c2` ...
### Community 26 (functions)
- size: 91 (files: 8, functions: 63, classes: 1)
- members: `node_assert_strict`, `node_crypto`, `node_fs`, `node_test`, `node_vm`, `tests_test_due_modal`, `tests_test_due_modal_close`, `tests_test_due_modal_showmodal`, `tests_test_due_modal_test`, `tests_test_web_access`, `tests_test_web_access_focus`, `tests_test_web_access_readfilesync`, `tests_test_web_access_test`, `tests_test_web_access_test_browser_apis_are_same_origin_and_push_payloads_stay_generic_l386_c69`, `tests_test_web_access_test_pages_cache_rules_are_explicit_and_non_conflicting_for_every_application_pa_l439_c87` ...
### Community 37 (tests, functions)
- size: 84 (files: 0, functions: 73, classes: 0)
- members: `tests_test_web_access_assert_throws_l270_c5`, `tests_test_web_access_assert_throws_l317_c5`, `tests_test_web_access_test_account_resolution_emits_a_safe_access_event_and_enables_entitled_cloud_use_l297_c85`, `tests_test_web_account_requirecloud`, `tests_test_web_account_resolveaccount`, `tests_test_web_sync_addeventlistener`, `tests_test_web_sync_append`, `tests_test_web_sync_cancelanimationframe`, `tests_test_web_sync_close`, `tests_test_web_sync_control`, `tests_test_web_sync_createelement`, `tests_test_web_sync_dialog`, `tests_test_web_sync_dispatchevent`, `tests_test_web_sync_encode`, `tests_test_web_sync_encryptedremote` ...
### Community 29 (functions)
- size: 61 (files: 1, functions: 57, classes: 0)
- members: `tests_test_web_access_addeventlistener`, `tests_test_web_access_callback`, `tests_test_web_access_classlist`, `tests_test_web_access_close`, `tests_test_web_access_constructor`, `tests_test_web_access_contains`, `tests_test_web_access_dispatch`, `tests_test_web_access_dispatchevent`, `tests_test_web_access_harness`, `tests_test_web_access_queryselector`, `tests_test_web_access_queuemicrotask`, `tests_test_web_access_remove`, `tests_test_web_access_replacestate`, `tests_test_web_access_showmodal`, `tests_test_web_access_stop` ...
### Community 31 (tests, functions)
- size: 55 (files: 0, functions: 52, classes: 0)
- members: `tests_test_web_account_accountharness`, `tests_test_web_account_addeventlistener`, `tests_test_web_account_alert`, `tests_test_web_account_anon_l339_c23`, `tests_test_web_account_anon_l353_c23`, `tests_test_web_account_anon_l368_c23`, `tests_test_web_account_anon_l429_c21`, `tests_test_web_account_append`, `tests_test_web_account_chooselocal`, `tests_test_web_account_clearmedicationschedule`, `tests_test_web_account_clearschedulecalls`, `tests_test_web_account_close`, `tests_test_web_account_completegooglerequest`, `tests_test_web_account_completemerequest`, `tests_test_web_account_constructor` ...
### Community 132 (web)
- size: 43 (files: 1, functions: 2, classes: 0)
- members: `web_qrcode`, `web_qrcode_base64decodeinputstream`, `web_qrcode_base64encodeoutputstream`, `web_qrcode_bitoutputstream`, `web_qrcode_bytearrayoutputstream`, `web_qrcode_chattonum`, `web_qrcode_createbytes`, `web_qrcode_createdata`, `web_qrcode_createdataurl`, `web_qrcode_createhalfascii`, `web_qrcode_decode`, `web_qrcode_define`, `web_qrcode_encode`, `web_qrcode_escapexml`, `web_qrcode_factory` ...
### Community 15 (functions)
- size: 40 (files: 2, functions: 32, classes: 0)
- members: `tests_test_due_modal_readfilesync`, `tests_test_due_modal_replacechildren`, `tests_test_due_modal_test_notification_taps_route_the_private_due_timestamp_back_to_local_modal_data_l43_c84`, `tests_test_due_modal_test_pwa_due_reminder_opens_a_modal_with_one_safe_list_row_per_medication_l6_c78`, `tests_test_due_modal_test_service_worker_updates_are_consent_gated_and_never_cache_same_origin_api_re_l52_c92`, `tests_test_due_modal_test_windows_reminder_is_modal_and_creates_one_visible_label_for_every_medicine_l68_c84`, `tests_test_web_account_renderbutton`, `web_account`, `web_account_accessdecisioniscurrent`, `web_account_accessdecisionsnapshot`, `web_account_advanced`, `web_account_alert`, `web_account_anon_l219_c22`, `web_account_anon_l315_c24`, `web_account_anon_l330_c23` ...
### Community 63 (functions)
- size: 38 (files: 0, functions: 33, classes: 0)
- members: `tests_test_worker_auth_assert_rejects_l769_c24`, `tests_test_worker_auth_assert_rejects_l775_c24`, `tests_test_worker_auth_assert_rejects_l778_c24`, `tests_test_worker_auth_authdatabase`, `tests_test_worker_auth_b64url`, `tests_test_worker_auth_batch`, `tests_test_worker_auth_dev_hosts_cannot_enter_the_legacy_v1_google_contract_l428_c97`, `tests_test_worker_auth_fixture`, `tests_test_worker_auth_handleauthrequest`, `tests_test_worker_auth_resetgooglekeysfortests`, `tests_test_worker_auth_sha256hex`, `tests_test_worker_auth_test_a_token_issued_for_another_oauth_client_is_rejected_l766_c61`, `tests_test_worker_auth_test_api_prefixed_auth_remains_cookie_only_on_the_exact_legacy_host_l701_c72`, `tests_test_worker_auth_test_api_prefixed_paths_normalize_while_legacy_and_similarly_prefixed_paths_are_l738_c94`, `tests_test_worker_auth_test_audit_failure_does_not_prevent_valid_v2_logout_from_clearing_the_cookie_l554_c81` ...
### Community 20 (mixed)
- size: 32 (files: 0, functions: 12, classes: 3)
- members: `runtimeerror`, `sync_client_aesgcm`, `sync_client_api_url`, `sync_client_b64`, `sync_client_base64`, `sync_client_create_pair`, `sync_client_decode`, `sync_client_decrypt`, `sync_client_encode`, `sync_client_encrypt`, `sync_client_encryptedsyncclient`, `sync_client_exc`, `sync_client_fetch`, `sync_client_init`, `sync_client_json` ...
### Community 62 (functions)
- size: 32 (files: 1, functions: 25, classes: 0)
- members: `tests_test_web_update_addeventlistener`, `tests_test_web_update_alert`, `tests_test_web_update_flush`, `tests_test_web_update_json`, `tests_test_web_update_postmessage`, `tests_test_web_update_queryselector`, `tests_test_web_update_readfilesync`, `tests_test_web_update_register`, `tests_test_web_update_reload`, `tests_test_web_update_setremoteversion`, `tests_test_web_update_test_cloudflare_release_discovery_asks_before_activating_an_update_l90_c71`, `tests_test_web_update_test_startup_reports_no_update_when_cloudflare_version_matches_the_installed_app_l113_c85`, `tests_test_web_update_test_updatefound_and_manual_waiting_checks_prompt_once_for_the_same_worker_ident_l122_c88`, `tests_test_web_update_update`, `tests_test_web_update_updateharness` ...
### Community 22 (tests)
- size: 9 (files: 0, functions: 2, classes: 1)
- members: `tests_test_pairing_encryptedsyncclient`, `tests_test_pairing_json`, `tests_test_pairing_pairingtests`, `tests_test_pairing_path`, `tests_test_pairing_read_text`, `tests_test_pairing_self`, `tests_test_pairing_test_encrypted_pairing_payload_round_trips_schedule`, `tests_test_pairing_test_pairing_link_uses_fragment_and_contains_no_schedule`, `tests_test_pairing_validate_schedule`
### Community 43 (tests, functions)
- size: 4 (files: 0, functions: 3, classes: 0)
- members: `tests_test_web_sync_continuation`, `tests_test_web_sync_releasedecrypt_l1314_c28`, `tests_test_web_sync_releasedecrypt_l501_c30`, `tests_test_web_sync_releaseencryption_l1247_c29`
### Community 117 (web, functions)
- size: 4 (files: 0, functions: 3, classes: 0)
- members: `web_account_finish`, `web_account_script_onerror_l206_c24`, `web_account_script_onload_l205_c23`, `web_account_settimeout_l200_c34`
### Community 38 (tests, functions)
- size: 3 (files: 0, functions: 2, classes: 0)
- members: `tests_test_web_sync_anon_l245_c25`, `tests_test_web_sync_anon_l246_c25`, `tests_test_web_sync_settimeout`
### Community 35 (tests, functions)
- size: 2 (files: 0, functions: 1, classes: 0)
- members: `tests_test_web_sw_anon_l8_c33`, `tests_test_web_sw_setimmediate`
