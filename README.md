# Medication Reminder

Medication Reminder is a browser-first, local-first reminder application. Public
users use the website or installed PWA. The Windows tray widget in this repository is
an owner/developer tool retained for compatibility; it is not a supported public
client.

This software is an organisational aid, not a medical device. A clinician's current
instructions always take priority. Recheck the schedule whenever a medicine is
started, stopped, or changed.

## Public user flow

A fresh browser starts behind a privacy gate: schedule content is not rendered while
account state and the device's prior choice are restored. The user must explicitly
choose one of:

- **Continue on this device** — schedules, settings, reminders, and taken state stay
  in that browser profile or installed PWA. There is no cloud pairing or recovery.
  Once the static application has been cached, local editing and reminders can
  continue offline, subject to browser notification and power-management behaviour.
- **Sign in with Google** — the local workspace remains available and the server
  returns the account's status and entitlements. Only an active account with the
  Advanced entitlement can create or operate account-owned cloud sync.

Signing in alone does not create a pairing or upload a schedule. An entitled user
must explicitly create the first pairing. If the exact returning owner already has
retained source credentials with unsynchronized local changes, automatic sync resumes
for that owner and may upload those changes after normal revision/conflict handling.
One installed mobile PWA can claim a short-lived invitation and retain its encrypted
schedule locally. That mobile remains usable and continues local reminders while
offline or while the source browser is closed.

Opening a pairing link never sends its encryption key to Cloudflare. The privacy
controller removes the fragment from browser history before retaining the invitation
in memory. A desktop browser waits for account authorization before a legacy import;
an installed mobile can process a version 2 invitation while privacy mode is still
pending. The invitation alone never unlocks the application. Only a successful,
user-confirmed claim resolves paired-mobile access. A malformed fragment or a fragment
that cannot be removed keeps the application locked.

Signing out presents three deliberate choices:

- **Keep on this device** signs out and retains this browser's schedule, settings,
  reminders, and taken state.
- **Erase from this device** signs out and clears local application data only after
  the browser confirms the clear operation.
- **Cancel** leaves both the session and local data unchanged.

Sign-out does not silently revoke or erase the paired mobile. Pair revocation is a
separate operation.

## Security and privacy boundary

Browser account and sync requests use same-origin `/api` routes on
`https://medication.bytesfx.com`. The Worker session cookie is `Secure`, `HttpOnly`,
`SameSite=Strict`, scoped to `Path=/api`, and has no `Domain` attribute. Browser
JavaScript cannot read it. Cookie-authenticated mutations require the exact
application origin and `X-Medication-CSRF: 1`.

The Worker is the authorization boundary:

- it derives the account identity from the authenticated session, never request JSON;
- it requires an active account and active Advanced entitlement for cloud sync;
- every account-side pairing query includes the authenticated `user_id`;
- a mobile request must present the pair-specific credential and matching
  `X-Medication-Device` identifier; and
- legacy bearer authorization is accepted only for records whose `user_id IS NULL`.

The relay stores AES-GCM ciphertext, IVs, revisions, hashed credentials, and limited
operational metadata. The encryption key remains in the QR URL fragment and on the
participating devices; browsers do not send fragments in HTTP requests. Sync request
bodies are limited to 96 KiB, ciphertext to 16–80,000 characters, IVs to 12–64
characters, and sync traffic is rate-limited per hashed Cloudflare client address.
Push schedules contain generic due-time messages, not medication names.

Do not log schedules, item names, encryption keys, invitation or mobile tokens,
session cookies, Google credentials, or push-subscription values. Pairing audit
metadata is restricted to bounded pair/device identifiers, revision, operation, and
result. Account audit events do not contain schedule content or credentials; the
`usage_period_updated` event can contain the user-entered intended start and end
dates. This design reduces exposure but is not a claim of perfect security.

Cloudflare Worker response headers are authoritative for `/api`; Pages `_headers`
does not govern requests intercepted by the Worker route. API JSON is `no-store` and
includes `X-Content-Type-Options: nosniff` and a restrictive referrer policy. The
Pages CSP limits scripts, frames, connections, and images to the application and
required Google Identity origins.

The service worker caches versioned application assets, including the privacy gate,
but never caches `/api` or `version.json`. Shell navigation is network-first with an
offline fallback that still starts privacy-locked.

A newly installed service worker does not call `skipWaiting()` and cannot activate
itself during installation. The running application prompts before it posts
`SKIP_WAITING`; the same worker installation is offered only once, and declining the
offered version suppresses immediate repeat prompts during that session. In the
running session, the waiting worker is activated and the page reloads on
`controllerchange` only after the user accepts the update prompt.

Shell navigation caches only a successful, non-redirected, same-origin response whose
final path is the canonical `/` or `/index.html`, and it writes that response under
the canonical root `/` cache key. A notification URL such as
`/?dueAt=<synthetic timestamp>` remains in the browser URL so local code can process
it, but the query is never used as a cache key. Offline navigation through that URL
resolves the canonical cached shell. Activation deletes only stale caches whose names
start with `medication-reminder-web-`; unrelated origin caches are preserved.

Notification permission is requested only through the user's **Enable
notifications** action; a push subscription is created only after permission is
granted.

## Pairing and sync protocol

Account-owned version 2 pairings use these contracts:

```text
GET    /api/auth/config
POST   /api/auth/google
GET    /api/auth/me
PATCH  /api/auth/me
DELETE /api/auth/session

POST   /api/sync/pairs
GET    /api/sync/pairs/:pairId
PUT    /api/sync/pairs/:pairId
DELETE /api/sync/pairs/:pairId
POST   /api/sync/pairs/:pairId/invitations
POST   /api/sync/pairs/:pairId/claim

GET    /api/health
GET    /api/vapid-public-key
POST   /api/subscriptions
```

Browser account requests send the session cookie with `credentials: same-origin`;
mutations also send the CSRF marker. Mobile sync sends
`Authorization: Bearer <mobile credential>` plus
`X-Medication-Device: <device id>` and omits browser credentials.

An invitation expires after 15 minutes, is bound to its account-owned source record,
and can be consumed once. The installed mobile creates a `claimNonce`; the Worker
uses HMAC-SHA-256 over the pair, invitation hash, device, and nonce to derive a
43-character mobile credential. This makes an interrupted claim retry deterministic
without making the invitation a permanent sync token. The client deletes invitation
material after a successful claim.

Invitation refresh is also deterministic: the source persists a `refreshNonce` and
the prior invitation proof before calling the Worker. Replaying the same safe refresh
returns the same invitation; a stale or competing refresh fails rather than
overwriting another tab's state. Source creation, reads, writes, refresh, and
revocation remain bound to the signed-in owner.

An offline or transient sync failure retains the mobile's local schedule. A paused
entitlement also retains the schedule and pairing. Automatic removal occurs only
after the Worker returns the exact verified revocation/not-found response for that
scoped mobile credential, or after the user explicitly types the destructive mobile
unpair confirmation.

## Owner Windows widget and legacy v1 transition

The Windows widget remains owner/developer-only. It stores schedule, reminder state,
audit history, and pairing material in the current Windows user's protected
application data using Windows DPAPI. Existing one-to-one encrypted widget pairings
remain on the compatibility path; public users must not be directed to this client.

The exact legacy host is:

```text
LEGACY_V1_HOST=medication-reminder-push.bmorris0565.workers.dev
```

Only that exact host's original unprefixed `/auth/*` routes receive the temporary v1
auth response behaviour. `/api/*` always uses v2 cookie semantics. Preview URLs are
disabled (`preview_urls: false`); `workers_dev: true` is temporary and exists only
for the v1 rollout boundary. Legacy bearer sync may access only `sync_pairs` rows
where `user_id IS NULL`; it must never authorize account-owned rows.

Remove the v1 branch only after release v16 clients have aged out. Do not assign a
calendar date without evidence. Use this release cleanup checklist:

1. Confirm supported clients have upgraded beyond v16 and no required owner device
   still depends on unprefixed v1 auth.
2. Re-run legacy-widget and current v2 browser/mobile tests.
3. Remove the unprefixed v1 auth response path and its tests.
4. Remove `LEGACY_V1_HOST`, set `workers_dev: false`, and retain only the custom
   `/api/*` route.
5. Deploy Worker first, verify `/api/health`, account isolation, and owner tooling,
   then deploy any dependent client update.

## Cloudflare configuration and secrets

`worker/wrangler.jsonc` contains the existing public `GOOGLE_CLIENT_ID`, the exact
legacy host, the `/api/*` custom-domain route, D1 binding, and cron trigger. Production
also requires:

- `OWNER_EMAIL` — secret used to bootstrap the owner Advanced entitlement;
- `MOBILE_CREDENTIAL_SECRET` — **exactly 32 random bytes encoded as unpadded
  base64url (43 characters)**;
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`; and
- `VAPID_SUBJECT`, a valid Web Push contact subject.

The Google OAuth client must authorize the JavaScript origins
`https://medication.bytesfx.com` and
`https://medication-reminder-8h3.pages.dev`. The popup flow does not require an
authorized redirect URI.

Generate credentials in an approved secret manager or secure local process. Never
commit, paste into tickets, echo, or log their values.

For every release, the operator must generate a new run ID with
`[guid]::NewGuid().ToString('N')`, set that exact value in
`MEDICATION_RELEASE_RUN_ID`, and record it in the approved release ticket before
starting. Never reuse a prior run ID, even for the same commit. Run all production
commands below in one PowerShell session, starting at the repository root:

```powershell
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath '.').Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'worker\wrangler.jsonc'))) {
  throw 'Start this runbook from the Medication Reminder repository root.'
}
$expectedBranch = 'main'
$expectedCommit = [Environment]::GetEnvironmentVariable('MEDICATION_RELEASE_COMMIT')
$releaseRunId = [Environment]::GetEnvironmentVariable('MEDICATION_RELEASE_RUN_ID')
if ($expectedCommit -cnotmatch '^[0-9a-f]{40}$') {
  throw 'MEDICATION_RELEASE_COMMIT must be the exact reviewed lowercase 40-character commit.'
}
if ($releaseRunId -cnotmatch '^[0-9a-f]{32}$') {
  throw 'MEDICATION_RELEASE_RUN_ID must be a new operator-generated lowercase 32-character run ID recorded in the release ticket.'
}
$captureStartedAt = [datetimeoffset]::UtcNow

function Assert-ReleaseProvenance {
  Push-Location $repoRoot
  try {
    $gitRootOutput = git rev-parse --show-toplevel
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the Git repository root.' }
    $gitRoot = (Resolve-Path -LiteralPath $gitRootOutput.Trim()).Path
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals($gitRoot, $repoRoot)) {
      throw "Git root mismatch: expected $repoRoot, found $gitRoot."
    }

    $actualBranch = git branch --show-current
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the current Git branch.' }
    if ($actualBranch.Trim() -cne $expectedBranch) {
      throw "Release branch must be exactly $expectedBranch."
    }

    $actualCommit = git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the current Git commit.' }
    if ($actualCommit.Trim() -cne $expectedCommit) {
      throw "Release commit drift: expected $expectedCommit, found $($actualCommit.Trim())."
    }

    $workspaceChanges = @(git status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Git workspace.' }
    if ($workspaceChanges.Count -ne 0) {
      throw 'Release workspace is not clean; tracked or untracked drift stops deployment.'
    }
  } finally {
    Pop-Location
  }
}

function Assert-ProtectedBackup {
  param(
    [Parameter(Mandatory)][string] $Path,
    [Parameter(Mandatory)][long] $ExpectedLength,
    [Parameter(Mandatory)][string] $ExpectedSha256,
    [Parameter(Mandatory)][string] $ExpectedOwnerSid
  )
  if ($ExpectedLength -le 0 -or $ExpectedSha256 -cnotmatch '^[A-F0-9]{64}$' -or
      $ExpectedOwnerSid -cnotmatch '^S-[0-9-]+$' -or
      -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'Protected backup inputs are invalid.'
  }
  $resolvedTmp = (Resolve-Path -LiteralPath 'F:\tmp').Path
  $resolvedBackup = (Resolve-Path -LiteralPath $Path).Path
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetDirectoryName($resolvedBackup),
      $resolvedTmp
  ) -or
      -not [IO.Path]::GetFileName($resolvedBackup).Contains($releaseRunId, [StringComparison]::Ordinal)) {
    throw 'Protected backup must remain at its run-bound path directly under F:\tmp.'
  }
  $backupItem = Get-Item -LiteralPath $resolvedBackup
  if ($backupItem.Length -ne $ExpectedLength -or
      (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash -cne $ExpectedSha256) {
    throw 'Protected backup content or length changed.'
  }

  $acl = Get-Acl -LiteralPath $resolvedBackup
  try {
    $ownerSid = [Security.Principal.SecurityIdentifier]::new($acl.Owner).Value
  } catch {
    $ownerSid = [Security.Principal.NTAccount]::new($acl.Owner).Translate(
      [Security.Principal.SecurityIdentifier]
    ).Value
  }
  $rules = @($acl.GetAccessRules(
    $true,
    $true,
    [Security.Principal.SecurityIdentifier]
  ))
  $expectedSids = @($ExpectedOwnerSid, 'S-1-5-18') | Sort-Object
  $actualSids = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object)
  if (-not $acl.AreAccessRulesProtected -or
      $ownerSid -cne $ExpectedOwnerSid -or
      $rules.Count -ne 2 -or
      (Compare-Object -CaseSensitive $expectedSids $actualSids).Count -ne 0) {
    throw 'Protected backup ACL owner or principal set is invalid.'
  }
  foreach ($rule in $rules) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        $rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]::None -or
        $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
        $rule.IsInherited) {
      throw 'Protected backup ACL contains unexpected rights, inheritance, propagation, or deny rules.'
    }
  }
}

node "C:\Users\fbmac\atlas\Codex\.codex_state\user_home\scripts\validate-packages.cjs" web-push
if ($LASTEXITCODE -ne 0) { throw 'Package validation rejected or could not validate web-push; stop release.' }
node "C:\Users\fbmac\atlas\Codex\.codex_state\user_home\scripts\validate-packages.cjs" wrangler
if ($LASTEXITCODE -ne 0) { throw 'Package validation rejected or could not validate wrangler; stop release.' }

Push-Location (Join-Path $repoRoot 'worker')
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'Locked Worker dependency bootstrap failed; stop release.' }

  $wrangler = Join-Path $repoRoot 'worker\node_modules\.bin\wrangler.cmd'
  if (-not (Test-Path -LiteralPath $wrangler -PathType Leaf)) {
    throw 'Pinned local Wrangler executable is missing after npm ci.'
  }
  $wranglerVersion = & $wrangler --version
  if ($LASTEXITCODE -ne 0 -or $wranglerVersion.Trim() -ne '4.112.0') {
    throw "Expected freshly installed Wrangler 4.112.0, found $($wranglerVersion.Trim())."
  }

  $lock = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'worker\package-lock.json') | ConvertFrom-Json -AsHashtable
  $dependencyTreeJson = npm ls --all --json
  if ($LASTEXITCODE -ne 0) { throw 'Installed dependency tree does not agree with the lockfile.' }
  $dependencyTree = $dependencyTreeJson | ConvertFrom-Json
  if ($lock.packages.''.devDependencies.wrangler -cne '4.112.0' -or
      $lock.packages.'node_modules/wrangler'.version -cne '4.112.0' -or
      $dependencyTree.dependencies.wrangler.version -cne $lock.packages.'node_modules/wrangler'.version -or
      $dependencyTree.dependencies.'web-push'.version -cne $lock.packages.'node_modules/web-push'.version) {
    throw 'Installed direct dependencies, manifest, and lockfile do not agree.'
  }

  $runtimeAuditJson = npm audit --omit=dev --json
  if ($LASTEXITCODE -ne 0) { throw 'Production dependency audit failed; stop deployment.' }
  $runtimeAudit = $runtimeAuditJson | ConvertFrom-Json
  if ($runtimeAudit.metadata.vulnerabilities.total -ne 0) {
    throw 'Production dependency audit returned vulnerabilities; stop deployment.'
  }

  function Assert-ApprovedDevToolAuditException {
    param(
      [Parameter(Mandatory)][object] $Audit,
      [Parameter(Mandatory)][hashtable] $PackageLock
    )
    $findingNames = @($Audit.vulnerabilities.PSObject.Properties.Name | Sort-Object)
    $expectedNames = @('miniflare', 'sharp', 'wrangler')
    $sharpAdvisories = @($Audit.vulnerabilities.sharp.via | Where-Object {
      $_.url -eq 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj'
    })
    $fixMetadata = @(
      $Audit.vulnerabilities.sharp.fixAvailable
      $Audit.vulnerabilities.miniflare.fixAvailable
      $Audit.vulnerabilities.wrangler.fixAvailable
    )
    $allNoFix = @($fixMetadata | Where-Object { $_ -ne $false }).Count -eq 0
    $allKnownForcedDowngrade = @($fixMetadata | Where-Object {
      $_ -isnot [pscustomobject] -or
      $_.name -cne 'wrangler' -or
      $_.version -cne '4.15.2' -or
      $_.isSemVerMajor -ne $true
    }).Count -eq 0
    $checks = [ordered]@{
      exactFindingNames = @(Compare-Object -CaseSensitive $expectedNames $findingNames).Count -eq 0
      totalCount = $Audit.metadata.vulnerabilities.total -eq 3
      highCount = $Audit.metadata.vulnerabilities.high -eq 3
      infoCount = $Audit.metadata.vulnerabilities.info -eq 0
      lowCount = $Audit.metadata.vulnerabilities.low -eq 0
      moderateCount = $Audit.metadata.vulnerabilities.moderate -eq 0
      criticalCount = $Audit.metadata.vulnerabilities.critical -eq 0
      sharpViaCount = @($Audit.vulnerabilities.sharp.via).Count -eq 1
      sharpAdvisoryCount = $sharpAdvisories.Count -eq 1
      sharpAdvisorySource = $sharpAdvisories.Count -eq 1 -and $sharpAdvisories[0].source -eq 1124066
      sharpAdvisoryRange = $sharpAdvisories.Count -eq 1 -and $sharpAdvisories[0].range -eq '<0.35.0'
      miniflareVia = @($Audit.vulnerabilities.miniflare.via).Count -eq 1 -and $Audit.vulnerabilities.miniflare.via[0] -eq 'sharp'
      wranglerVia = @($Audit.vulnerabilities.wrangler.via).Count -eq 1 -and $Audit.vulnerabilities.wrangler.via[0] -eq 'miniflare'
      approvedFixMetadata = $allNoFix -or $allKnownForcedDowngrade
      wranglerVersion = $PackageLock.packages.'node_modules/wrangler'.version -eq '4.112.0'
      wranglerDevOnly = $PackageLock.packages.'node_modules/wrangler'.dev -eq $true
      miniflareVersion = $PackageLock.packages.'node_modules/wrangler'.dependencies.miniflare -eq '4.20260714.0'
      miniflareDevOnly = $PackageLock.packages.'node_modules/miniflare'.dev -eq $true
      sharpDependency = $PackageLock.packages.'node_modules/miniflare'.dependencies.sharp -eq '0.34.5'
      sharpVersion = $PackageLock.packages.'node_modules/sharp'.version -eq '0.34.5'
      sharpDevOnly = $PackageLock.packages.'node_modules/sharp'.dev -eq $true
    }
    $failedChecks = @(
      $checks.GetEnumerator() |
        Where-Object { -not [bool]$_.Value } |
        ForEach-Object { $_.Key }
    )
    if ($failedChecks.Count -ne 0) {
      throw "Full dependency audit differs from the approved dev-tool exception. Failed checks: $($failedChecks -join ', ')."
    }
  }

  $devAuditJson = npm audit --json
  $devAuditExit = $LASTEXITCODE
  if ($devAuditExit -notin @(0, 1)) { throw 'Full dependency audit could not complete.' }
  $devAudit = $devAuditJson | ConvertFrom-Json
  if ($devAuditExit -eq 1) {
    Assert-ApprovedDevToolAuditException -Audit $devAudit -PackageLock $lock
    Write-Warning 'Known dev-tool audit exception matched exactly; production dependency audit is clean.'
  }
} finally {
  Pop-Location
}
Assert-ReleaseProvenance
```

Secret provisioning is a separate one-time prerequisite, not a deployment-window
step. If it is required, stop, provision it interactively without printing its
value, and restart the reviewed release sequence so rollback targets are captured
before any release mutation:

```powershell
Push-Location (Join-Path $repoRoot 'worker')
try {
  & $wrangler secret put MOBILE_CREDENTIAL_SECRET
  if ($LASTEXITCODE -ne 0) { throw 'MOBILE_CREDENTIAL_SECRET provisioning failed.' }
} finally {
  Pop-Location
}
```

Keep `MOBILE_CREDENTIAL_SECRET` stable. Already-claimed mobile tokens continue to
work after rotation because only their hashes are used for normal sync, but an
in-flight deterministic claim or invitation-refresh retry can no longer reproduce
its prior credential. Rotate only in a controlled window after preserving the old
secret for rollback, pausing new claims/refreshes, and verifying that no operation is
in flight.

Verify secret **names only**, never their values:

```powershell
Push-Location (Join-Path $repoRoot 'worker')
try {
  $secretListJson = & $wrangler secret list --format json
  if ($LASTEXITCODE -ne 0) { throw 'Worker secret-name lookup failed.' }
  $requiredSecrets = @('OWNER_EMAIL', 'MOBILE_CREDENTIAL_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT')
  $configuredSecrets = @($secretListJson | ConvertFrom-Json | ForEach-Object { $_.name })
  $missingSecrets = @($requiredSecrets | Where-Object { $_ -notin $configuredSecrets })
  if ($missingSecrets.Count) { throw "Missing required Worker secret names: $($missingSecrets -join ', ')" }
  Write-Output 'Required Worker secret names are configured; values were not read.'
} finally {
  Pop-Location
}
```

## Database migration 0003

`worker/migrations/0003_scoped_pairing_credentials.sql` is additive. It adds hashed
invitation and mobile-credential fields, invitation expiry/consumption timestamps,
mobile claim time, and scoped indexes. It does not delete or rewrite schedules.
`worker/schema.sql` is the equivalent canonical schema for a fresh database.
Migration 0002 is a prerequisite because it introduces `user_id` and the account
tables; production must apply migrations in numeric order.

The read-only production inventory taken on **2026-07-23** found:

- 2 legacy rows with a null owner;
- 0 account-owned rows; and
- 1 claimed row.

That observation is not deployment authorization. Re-run the inventory immediately
before migration and the blocking query immediately before Worker deployment. The
deployment must stop if any legacy account-owned bearer row has
`user_id IS NOT NULL AND invitation_token_hash IS NULL`.

### Capture rollback targets and backup before mutation

Pinned Wrangler 4.112.0 supports JSON output for `deployments list`,
`versions list`, and `pages deployment list`, but this runbook does not assume an
untested JSON field layout. Capture and validate the inventories and D1 backup
before creating the final operator attestation:

```powershell
Assert-ReleaseProvenance
if (-not (Test-Path -LiteralPath 'F:\tmp' -PathType Container)) {
  throw 'Required inventory directory F:\tmp does not exist; stop deployment.'
}
$rollbackStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$workerDeploymentsPath = Join-Path 'F:\tmp' "medication-worker-deployments-$rollbackStamp-$releaseRunId.json"
$workerVersionsPath = Join-Path 'F:\tmp' "medication-worker-versions-$rollbackStamp-$releaseRunId.json"
$pagesDeploymentsPath = Join-Path 'F:\tmp' "medication-pages-production-$rollbackStamp-$releaseRunId.json"
$backupPath = Join-Path 'F:\tmp' "medication-reminder-pre-0003-$rollbackStamp-$releaseRunId.sql"
$rollbackRecordPath = Join-Path 'F:\tmp' "medication-rollback-targets-$rollbackStamp-$releaseRunId.json"
foreach ($path in @($workerDeploymentsPath, $workerVersionsPath, $pagesDeploymentsPath, $backupPath, $rollbackRecordPath)) {
  if (Test-Path -LiteralPath $path) {
    throw "Refusing to overwrite pre-existing release evidence: $path"
  }
}

Push-Location (Join-Path $repoRoot 'worker')
try {
  & $wrangler whoami
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare authentication check failed.' }
  $workerDeploymentsJson = & $wrangler deployments list --name medication-reminder-push --json
  if ($LASTEXITCODE -ne 0) { throw 'Worker deployment inventory failed; stop deployment.' }
  $workerDeploymentsCapturedAt = [datetimeoffset]::UtcNow
  $workerVersionsJson = & $wrangler versions list --name medication-reminder-push --json
  if ($LASTEXITCODE -ne 0) { throw 'Worker version inventory failed; stop deployment.' }
  $workerVersionsCapturedAt = [datetimeoffset]::UtcNow
  & $wrangler d1 export medication-reminder-push --remote --output $backupPath
  if ($LASTEXITCODE -ne 0) { throw 'D1 export failed; stop deployment.' }
  if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf) -or
      (Get-Item -LiteralPath $backupPath).Length -le 0) {
    throw 'D1 export reported success but the unique backup is missing or empty.'
  }
  $operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new(
    [Security.Principal.WellKnownSidType]::LocalSystemSid,
    $null
  )
  $backupAcl = [Security.AccessControl.FileSecurity]::new()
  $backupAcl.SetOwner($operatorSid)
  $backupAcl.SetAccessRuleProtection($true, $false)
  $backupAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $operatorSid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  $backupAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $systemSid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  Set-Acl -LiteralPath $backupPath -AclObject $backupAcl
  $backupLength = (Get-Item -LiteralPath $backupPath).Length
  $backupSha256 = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
  $backupCapturedAt = [datetimeoffset]::UtcNow
  $backupOwnerSid = $operatorSid.Value
  Assert-ProtectedBackup -Path $backupPath -ExpectedLength $backupLength -ExpectedSha256 $backupSha256 -ExpectedOwnerSid $backupOwnerSid
} finally {
  Pop-Location
}
Push-Location $repoRoot
try {
  $pagesDeploymentsJson = & $wrangler pages deployment list --project-name medication-reminder --environment production --json
  if ($LASTEXITCODE -ne 0) { throw 'Pages production deployment inventory failed; stop deployment.' }
  $pagesDeploymentsCapturedAt = [datetimeoffset]::UtcNow
} finally {
  Pop-Location
}

$inventoryPayloads = @(
  @{ Path = $workerDeploymentsPath; Json = @($workerDeploymentsJson); CapturedAt = $workerDeploymentsCapturedAt },
  @{ Path = $workerVersionsPath; Json = @($workerVersionsJson); CapturedAt = $workerVersionsCapturedAt },
  @{ Path = $pagesDeploymentsPath; Json = @($pagesDeploymentsJson); CapturedAt = $pagesDeploymentsCapturedAt }
)
foreach ($inventoryPayload in $inventoryPayloads) {
  $rawJson = $inventoryPayload.Json -join [Environment]::NewLine
  if ([string]::IsNullOrWhiteSpace($rawJson)) {
    throw "Rollback inventory was empty: $($inventoryPayload.Path)"
  }
  try {
    $parsedInventory = $rawJson | ConvertFrom-Json
  } catch {
    throw "Rollback inventory was not valid JSON: $($inventoryPayload.Path)"
  }
  if ($null -eq $parsedInventory -or @($parsedInventory).Count -eq 0) {
    throw "Rollback inventory contained no targets: $($inventoryPayload.Path)"
  }
  $inventoryRecord = [ordered]@{
    schema = 'medication-reminder-release-inventory/v1'
    releaseRunId = $releaseRunId
    capturedAtUtc = $inventoryPayload.CapturedAt.ToString('o')
    payload = $parsedInventory
  }
  [IO.File]::WriteAllText(
    $inventoryPayload.Path,
    ($inventoryRecord | ConvertTo-Json -Depth 100),
    [Text.UTF8Encoding]::new($false)
  )
  if (-not (Test-Path -LiteralPath $inventoryPayload.Path) -or
      (Get-Item -LiteralPath $inventoryPayload.Path).Length -eq 0) {
    throw "Rollback inventory was not persisted safely: $($inventoryPayload.Path)"
  }
}

```

Stop here for operator confirmation. Compare the captured inventory payloads with
fresh independent Cloudflare current-status queries: pinned Wrangler
`deployments status --name medication-reminder-push --json` and
`pages deployment list --project-name medication-reminder --environment production
--json`. Establish exactly one currently active Worker version receiving 100% of
traffic and exactly one first/current successful Pages **production** deployment.
Resolve the Pages source abbreviation to one unique 40-character commit with
`git rev-parse`; ambiguity or a non-ancestor commit stops the release. Record these
exact fields in environment variables without copying tokens, bindings, or
application data:

- `MEDICATION_ROLLBACK_WORKER_VERSION` — active Worker version ID;
- `MEDICATION_ROLLBACK_PAGES_DEPLOYMENT` — production Pages deployment ID;
- `MEDICATION_ROLLBACK_PAGES_URL` — production deployment URL;
- `MEDICATION_ROLLBACK_PAGES_COMMIT` — production deployment commit;
- `MEDICATION_RELEASE_OPERATOR` — accountable operator name or approved identifier.

If either prior target is missing, ambiguous, split, unsuccessful, or cannot be
matched between the captured inventory and the fresh current-status query, stop.
Preview deployments are not valid Pages rollback targets. After manual confirmation,
create the timestamped operator attestation without exposing secrets:

```powershell
$rollbackWorkerVersion = [Environment]::GetEnvironmentVariable('MEDICATION_ROLLBACK_WORKER_VERSION')
$rollbackPagesDeployment = [Environment]::GetEnvironmentVariable('MEDICATION_ROLLBACK_PAGES_DEPLOYMENT')
$rollbackPagesUrl = [Environment]::GetEnvironmentVariable('MEDICATION_ROLLBACK_PAGES_URL')
$rollbackPagesCommit = [Environment]::GetEnvironmentVariable('MEDICATION_ROLLBACK_PAGES_COMMIT')
$releaseOperator = [Environment]::GetEnvironmentVariable('MEDICATION_RELEASE_OPERATOR')
$uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
if ($rollbackWorkerVersion -notmatch $uuidPattern -or
    $rollbackPagesDeployment -notmatch $uuidPattern -or
    $rollbackPagesCommit -notmatch '^[0-9a-fA-F]{40}$' -or
    [string]::IsNullOrWhiteSpace($releaseOperator)) {
  throw 'Both rollback targets, their commit metadata, and operator identity are required.'
}
try {
  $rollbackPagesUri = [uri]$rollbackPagesUrl
} catch {
  throw 'Captured Pages rollback URL is invalid.'
}
if ($rollbackPagesUri.Scheme -ne 'https' -or [string]::IsNullOrWhiteSpace($rollbackPagesUri.Host)) {
  throw 'Captured Pages rollback URL must be HTTPS.'
}

$attestedAt = [datetimeoffset]::UtcNow
$captureTimeline = @(
  $captureStartedAt,
  $workerDeploymentsCapturedAt,
  $workerVersionsCapturedAt,
  $backupCapturedAt,
  $pagesDeploymentsCapturedAt,
  $attestedAt
)
for ($index = 0; $index -lt $captureTimeline.Count; $index++) {
  if ($captureTimeline[$index].Offset -ne [timespan]::Zero -or
      $captureTimeline[$index] -gt [datetimeoffset]::UtcNow.AddMinutes(5) -or
      $captureTimeline[$index] -lt [datetimeoffset]::UtcNow.AddHours(-24) -or
      ($index -gt 0 -and $captureTimeline[$index] -lt $captureTimeline[$index - 1])) {
    throw 'Release captures must be current, UTC, and ordered; restart with a new run ID.'
  }
}
if (($attestedAt - $captureStartedAt) -gt [timespan]::FromHours(2)) {
  throw 'Release capture window exceeded two hours; restart captures and backup with a new run ID.'
}

$rollbackRecord = [ordered]@{
  schema = 'medication-reminder-release-attestation/v3'
  captureStartedAtUtc = $captureStartedAt.ToString('o')
  capturedAtUtc = $attestedAt.ToString('o')
  releaseRunId = $releaseRunId
  operator = $releaseOperator
  releaseBranch = $expectedBranch
  releaseCommit = $expectedCommit
  backup = [ordered]@{
    path = $backupPath
    sha256 = $backupSha256
    length = $backupLength
    ownerSid = $backupOwnerSid
    capturedAtUtc = $backupCapturedAt.ToString('o')
  }
  worker = [ordered]@{
    versionId = $rollbackWorkerVersion
    deploymentsInventory = $workerDeploymentsPath
    deploymentsSha256 = (Get-FileHash -LiteralPath $workerDeploymentsPath -Algorithm SHA256).Hash
    deploymentsCapturedAtUtc = $workerDeploymentsCapturedAt.ToString('o')
    versionsInventory = $workerVersionsPath
    versionsSha256 = (Get-FileHash -LiteralPath $workerVersionsPath -Algorithm SHA256).Hash
    versionsCapturedAtUtc = $workerVersionsCapturedAt.ToString('o')
  }
  pages = [ordered]@{
    deploymentId = $rollbackPagesDeployment
    url = $rollbackPagesUrl
    commit = $rollbackPagesCommit
    inventory = $pagesDeploymentsPath
    inventorySha256 = (Get-FileHash -LiteralPath $pagesDeploymentsPath -Algorithm SHA256).Hash
    inventoryCapturedAtUtc = $pagesDeploymentsCapturedAt.ToString('o')
  }
  attestation = 'Operator confirmed both targets against captured CLI inventory payloads and independent Cloudflare current-status queries before mutation.'
}
[IO.File]::WriteAllText(
  $rollbackRecordPath,
  ($rollbackRecord | ConvertTo-Json -Depth 5),
  [Text.UTF8Encoding]::new($false)
)
if (-not (Test-Path -LiteralPath $rollbackRecordPath) -or
    (Get-Item -LiteralPath $rollbackRecordPath).Length -eq 0) {
  throw 'Rollback target attestation was not persisted safely; stop deployment.'
}

function Assert-ReleaseAttestation {
  param(
    [Parameter(Mandatory)]
    [string] $Path
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'Release attestation file is missing.'
  }
  $resolvedTmp = (Resolve-Path -LiteralPath 'F:\tmp').Path
  $resolvedRecord = (Resolve-Path -LiteralPath $Path).Path
  if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
      [IO.Path]::GetDirectoryName($resolvedRecord),
      $resolvedTmp
  ) -or
      -not [IO.Path]::GetFileName($resolvedRecord).Contains($releaseRunId, [StringComparison]::Ordinal)) {
    throw 'Release attestation must be an explicitly named file directly under F:\tmp.'
  }
  try {
    $record = Get-Content -Raw -LiteralPath $resolvedRecord | ConvertFrom-Json -DateKind String
    $recordCaptureStartedAt = [datetimeoffset]$record.captureStartedAtUtc
    $recordWorkerDeploymentsCapturedAt = [datetimeoffset]$record.worker.deploymentsCapturedAtUtc
    $recordWorkerVersionsCapturedAt = [datetimeoffset]$record.worker.versionsCapturedAtUtc
    $recordBackupCapturedAt = [datetimeoffset]$record.backup.capturedAtUtc
    $recordPagesCapturedAt = [datetimeoffset]$record.pages.inventoryCapturedAtUtc
    $recordAttestedAt = [datetimeoffset]$record.capturedAtUtc
    $recordPagesUri = [uri]$record.pages.url
  } catch {
    throw 'Release attestation is not valid JSON or contains invalid typed fields.'
  }
  $requiredUuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  $constantAttestation = 'Operator confirmed both targets against captured CLI inventory payloads and independent Cloudflare current-status queries before mutation.'
  if ($record.schema -cne 'medication-reminder-release-attestation/v3' -or
      $record.releaseRunId -cne $releaseRunId -or
      $record.releaseBranch -cne $expectedBranch -or
      $record.releaseCommit -cne $expectedCommit -or
      $record.attestation -cne $constantAttestation -or
      [string]::IsNullOrWhiteSpace($record.operator) -or
      $record.worker.versionId -notmatch $requiredUuidPattern -or
      $record.pages.deploymentId -notmatch $requiredUuidPattern -or
      $record.pages.commit -notmatch '^[0-9a-fA-F]{40}$' -or
      $recordPagesUri.Scheme -ne 'https' -or
      [string]::IsNullOrWhiteSpace($recordPagesUri.Host)) {
    throw 'Release attestation schema, constants, provenance, or targets are invalid.'
  }
  $recordTimeline = @(
    $recordCaptureStartedAt,
    $recordWorkerDeploymentsCapturedAt,
    $recordWorkerVersionsCapturedAt,
    $recordBackupCapturedAt,
    $recordPagesCapturedAt,
    $recordAttestedAt
  )
  $now = [datetimeoffset]::UtcNow
  for ($index = 0; $index -lt $recordTimeline.Count; $index++) {
    if ($recordTimeline[$index].Offset -ne [timespan]::Zero -or
        $recordTimeline[$index] -gt $now.AddMinutes(5) -or
        $recordTimeline[$index] -lt $now.AddHours(-24) -or
        ($index -gt 0 -and $recordTimeline[$index] -lt $recordTimeline[$index - 1])) {
      throw 'Release capture timestamps are stale, future-dated, non-UTC, or out of order.'
    }
  }
  if (($recordAttestedAt - $recordCaptureStartedAt) -gt [timespan]::FromHours(2)) {
    throw 'Release capture window exceeds two hours.'
  }

  $inventoryChecks = @(
    @{ Path = $record.worker.deploymentsInventory; Hash = $record.worker.deploymentsSha256; CapturedAt = $recordWorkerDeploymentsCapturedAt },
    @{ Path = $record.worker.versionsInventory; Hash = $record.worker.versionsSha256; CapturedAt = $recordWorkerVersionsCapturedAt },
    @{ Path = $record.pages.inventory; Hash = $record.pages.inventorySha256; CapturedAt = $recordPagesCapturedAt }
  )
  foreach ($inventoryCheck in $inventoryChecks) {
    if ($inventoryCheck.Hash -cnotmatch '^[A-F0-9]{64}$' -or
        -not (Test-Path -LiteralPath $inventoryCheck.Path -PathType Leaf)) {
      throw 'Release inventory path or recorded SHA-256 is invalid.'
    }
    $resolvedInventory = (Resolve-Path -LiteralPath $inventoryCheck.Path).Path
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetDirectoryName($resolvedInventory),
        $resolvedTmp
    ) -or
        -not [IO.Path]::GetFileName($resolvedInventory).Contains($releaseRunId, [StringComparison]::Ordinal)) {
      throw 'Release inventories must remain directly under F:\tmp.'
    }
    $actualHash = (Get-FileHash -LiteralPath $resolvedInventory -Algorithm SHA256).Hash
    if ($actualHash -cne $inventoryCheck.Hash) {
      throw "Release inventory hash drift detected: $resolvedInventory"
    }
    try {
      $inventoryRecord = Get-Content -Raw -LiteralPath $resolvedInventory | ConvertFrom-Json -DateKind String
    } catch {
      throw "Release inventory is not valid JSON: $resolvedInventory"
    }
    $inventoryCapturedAt = [datetimeoffset]$inventoryRecord.capturedAtUtc
    if ($inventoryRecord.schema -cne 'medication-reminder-release-inventory/v1' -or
        $inventoryRecord.releaseRunId -cne $releaseRunId -or
        $inventoryCapturedAt.Offset -ne [timespan]::Zero -or
        $inventoryCapturedAt -ne $inventoryCheck.CapturedAt -or
        $null -eq $inventoryRecord.payload) {
      throw "Release inventory run ID or capture timestamp does not match its attestation: $resolvedInventory"
    }
  }

  if ($record.backup.ownerSid -cnotmatch '^S-[0-9-]+$' -or
      $record.backup.length -isnot [long]) {
    throw 'Release backup owner SID or length metadata is invalid.'
  }
  Assert-ProtectedBackup `
    -Path $record.backup.path `
    -ExpectedLength $record.backup.length `
    -ExpectedSha256 $record.backup.sha256 `
    -ExpectedOwnerSid $record.backup.ownerSid
  $resolvedBackup = (Resolve-Path -LiteralPath $record.backup.path).Path

  $script:rollbackWorkerVersion = $record.worker.versionId
  $script:rollbackPagesDeployment = $record.pages.deploymentId
  $script:rollbackPagesUrl = $record.pages.url
  $script:rollbackPagesCommit = $record.pages.commit
  $script:releaseOperator = $record.operator
  $script:backupPath = $resolvedBackup
}

Assert-ReleaseAttestation -Path $rollbackRecordPath
Write-Output "Rollback inventories, protected D1 backup, and operator attestation retained under F:\tmp for run $releaseRunId."
```

The attestation expires 24 hours after capture. If it expires before migration or
deployment, stop and restart inventory capture and backup with a new release run ID.
If rollback is required after expiry, use the retained identifiers only through a
reviewed incident procedure or Cloudflare Dashboard; do not weaken or bypass
`Assert-ReleaseAttestation`.

Treat the D1 export as sensitive operational data: it may contain account metadata
and encrypted application records. Keep its protected ACL and exact `F:\tmp` path,
never open or print its contents during release verification, retain it only through
the approved rollback window, and later remove that exact path through the controlled
cleanup process recorded in the release ticket.

### Migrate and preflight

Revalidate the attested protected backup, inspect the ownership inventory, apply
migration 0003, then run the deployment blocker. This is one fail-stop sequence; do
not continue the session after any exception:

```powershell
Assert-ReleaseProvenance
Assert-ReleaseAttestation -Path $rollbackRecordPath
Push-Location (Join-Path $repoRoot 'worker')
try {
  & $wrangler whoami
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare authentication check failed.' }

  $inventoryJson = & $wrangler d1 execute medication-reminder-push --remote --json --command "SELECT COUNT(*) AS total_rows, SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS null_owner_rows, SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS account_owned_rows, SUM(CASE WHEN mobile_device_id IS NOT NULL THEN 1 ELSE 0 END) AS claimed_rows FROM sync_pairs;"
  if ($LASTEXITCODE -ne 0) { throw 'Pre-migration ownership inventory failed; stop deployment.' }
  $inventory = $inventoryJson | ConvertFrom-Json
  if ($inventory.Count -ne 1 -or $inventory[0].results.Count -ne 1 -or
      $null -eq $inventory[0].results[0].account_owned_rows) {
    throw 'Pre-migration inventory returned an unexpected shape; stop deployment.'
  }
  $inventoryRow = $inventory[0].results[0]
  Write-Output "Inventory: total=$($inventoryRow.total_rows), null-owner=$($inventoryRow.null_owner_rows), account-owned=$($inventoryRow.account_owned_rows), claimed=$($inventoryRow.claimed_rows)"
  if ([int]$inventoryRow.account_owned_rows -ne 0) {
    throw 'STOP MIGRATION: account-owned rows require an approved data migration before 0003.'
  }

  Assert-ReleaseProvenance
  Assert-ReleaseAttestation -Path $rollbackRecordPath
  & $wrangler d1 execute medication-reminder-push --remote --file migrations/0003_scoped_pairing_credentials.sql
  if ($LASTEXITCODE -ne 0) { throw 'Migration 0003 failed; stop deployment.' }

  $preflightJson = & $wrangler d1 execute medication-reminder-push --remote --json --command "SELECT COUNT(*) AS blocked_account_bearer_rows FROM sync_pairs WHERE user_id IS NOT NULL AND invitation_token_hash IS NULL;"
  if ($LASTEXITCODE -ne 0) { throw 'Post-migration account-bearer preflight failed; stop deployment.' }
  $preflight = $preflightJson | ConvertFrom-Json
  if ($preflight.Count -ne 1 -or $preflight[0].results.Count -ne 1 -or
      $null -eq $preflight[0].results[0].blocked_account_bearer_rows) {
    throw 'Post-migration account-bearer preflight returned an unexpected shape; stop deployment.'
  }
  $blocked = [int]$preflight[0].results[0].blocked_account_bearer_rows
  if ($blocked -ne 0) {
    throw "STOP DEPLOYMENT: $blocked account-owned legacy bearer row(s) require an approved data migration."
  }
  Write-Output 'Preflight passed: 0 account-owned legacy bearer rows.'
} finally {
  Pop-Location
}
```

Do not “fix” a non-zero result by assigning owners, generating invitation hashes, or
deleting rows ad hoc. Preserve the backup and investigate with an approved migration.

### Deployment order and verification

Only after the backup, secret-name check, migration, and zero-result blocker:

1. Deploy the backward-compatible Worker first.

   ```powershell
   Push-Location (Join-Path $repoRoot 'worker')
   try {
     $deployPreflightJson = & $wrangler d1 execute medication-reminder-push --remote --json --command "SELECT COUNT(*) AS blocked_account_bearer_rows FROM sync_pairs WHERE user_id IS NOT NULL AND invitation_token_hash IS NULL;"
     if ($LASTEXITCODE -ne 0) { throw 'Final account-bearer preflight failed; Worker was not deployed.' }
     $deployPreflight = $deployPreflightJson | ConvertFrom-Json
     if ($deployPreflight.Count -ne 1 -or $deployPreflight[0].results.Count -ne 1 -or
         $null -eq $deployPreflight[0].results[0].blocked_account_bearer_rows) {
       throw 'Final account-bearer preflight returned an unexpected shape; Worker was not deployed.'
     }
     $deployBlocked = [int]$deployPreflight[0].results[0].blocked_account_bearer_rows
     if ($deployBlocked -ne 0) {
       throw "STOP DEPLOYMENT: $deployBlocked account-owned legacy bearer row(s) require an approved data migration."
     }

     Assert-ReleaseProvenance
     Assert-ReleaseAttestation -Path $rollbackRecordPath
     & $wrangler deploy
     if ($LASTEXITCODE -ne 0) { throw 'Worker deployment failed; health check was not run.' }

     node -e "fetch('https://medication.bytesfx.com/api/health',{cache:'no-store'}).then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"
     if ($LASTEXITCODE -ne 0) { throw 'Deployed Worker health check failed; do not deploy Pages.' }
   } finally {
     Pop-Location
   }
   ```

2. Verify `/api/auth/config`, a fresh Google sign-in, cookie attributes in browser
   developer tools, CSRF rejection, and account status/entitlement behaviour. Do not
   print cookies or credentials.
3. In isolated live accounts A and B, create a pair as A and prove that B cannot
   read, update, refresh, claim, or revoke it. Record only status codes and safe
   result categories.
4. Verify a version 2 mobile invitation claims once, replay fails, scoped
   pair/device mismatches fail, encrypted sync works, an offline reload retains the
   schedule and reminders, entitlement pause retains local data, and verified
   revocation removes the mobile copy.
5. Verify the existing owner widget can read and update only its known null-owner
   legacy record. Do not expose its token or decrypted schedule.
6. Deploy Pages only after Worker checks pass.

   ```powershell
   Push-Location $repoRoot
   try {
     Assert-ReleaseProvenance
     Assert-ReleaseAttestation -Path $rollbackRecordPath
     if (-not (Get-Command git -ErrorAction SilentlyContinue) -or
         -not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
       throw 'Native git and tar.exe are required to build the immutable Pages artifact.'
     }
     & git archive --list *> $null
     if ($LASTEXITCODE -ne 0) { throw 'Native git archive is unavailable.' }
     & tar.exe --version *> $null
     if ($LASTEXITCODE -ne 0) { throw 'Native tar.exe is unavailable.' }

     $releaseStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
     $releaseArchivePath = Join-Path 'F:\tmp' "medication-pages-$releaseStamp-$releaseRunId.tar"
     $releaseStagePath = Join-Path 'F:\tmp' "medication-pages-$releaseStamp-$releaseRunId"
     $expectedManifestPath = Join-Path 'F:\tmp' "medication-pages-expected-$releaseStamp-$releaseRunId.txt"
     $actualManifestPath = Join-Path 'F:\tmp' "medication-pages-actual-$releaseStamp-$releaseRunId.txt"
     $pagesArtifactRecordPath = Join-Path 'F:\tmp' "medication-pages-artifact-$releaseStamp-$releaseRunId.json"
     foreach ($path in @(
       $releaseArchivePath,
       $releaseStagePath,
       $expectedManifestPath,
       $actualManifestPath,
       $pagesArtifactRecordPath
     )) {
       if (Test-Path -LiteralPath $path) {
         throw "Refusing to overwrite pre-existing Pages artifact path: $path"
       }
     }

     & git archive --format=tar --output=$releaseArchivePath $expectedCommit -- web
     if ($LASTEXITCODE -ne 0 -or
         -not (Test-Path -LiteralPath $releaseArchivePath -PathType Leaf) -or
         (Get-Item -LiteralPath $releaseArchivePath).Length -eq 0) {
       throw 'Failed to archive tracked web files from the reviewed commit.'
     }

     $treeLines = @(& git ls-tree -r $expectedCommit -- web)
     if ($LASTEXITCODE -ne 0 -or $treeLines.Count -eq 0) {
       throw 'Failed to obtain the expected tracked web manifest.'
     }
     $expectedManifest = foreach ($line in $treeLines) {
       if ($line -notmatch '^(?<mode>[0-9]{6}) blob (?<hash>[0-9a-f]{40})\t(?<path>web/.+)$') {
         throw "Unexpected git tree entry; links and submodules are forbidden: $line"
       }
       if ($Matches.mode -cnotin @('100644', '100755')) {
         throw "Unsupported git tree mode $($Matches.mode): $($Matches.path)"
       }
       "$($Matches.hash)`t$($Matches.path)"
     }
     $expectedManifest = @($expectedManifest | Sort-Object -CaseSensitive)
     [IO.File]::WriteAllLines($expectedManifestPath, $expectedManifest, [Text.UTF8Encoding]::new($false))

     New-Item -ItemType Directory -Path $releaseStagePath -ErrorAction Stop | Out-Null
     & tar.exe -xf $releaseArchivePath -C $releaseStagePath
     if ($LASTEXITCODE -ne 0) { throw 'Failed to extract the immutable Pages archive.' }

     function Get-StagedPagesManifest {
       param([Parameter(Mandatory)][string] $StagePath)
       $resolvedStage = (Resolve-Path -LiteralPath $StagePath).Path
       $entries = @(Get-ChildItem -LiteralPath $resolvedStage -Recurse -Force)
       foreach ($entry in $entries) {
         if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
           throw "Pages artifact contains a link or reparse point: $($entry.FullName)"
         }
         if (-not $entry.PSIsContainer -and -not ($entry -is [IO.FileInfo])) {
           throw "Pages artifact contains a non-regular file: $($entry.FullName)"
         }
       }
       $files = @($entries | Where-Object { -not $_.PSIsContainer })
       foreach ($file in $files) {
         $relativePath = [IO.Path]::GetRelativePath($resolvedStage, $file.FullName).Replace('\', '/')
         if (-not $relativePath.StartsWith('web/', [StringComparison]::Ordinal)) {
           throw "Pages artifact contains a file outside web/: $relativePath"
         }
         $blobHash = & git hash-object -- $file.FullName
         if ($LASTEXITCODE -ne 0 -or $blobHash -notmatch '^[0-9a-f]{40}$') {
           throw "Failed to hash staged Pages file: $relativePath"
         }
         "$blobHash`t$relativePath"
       }
     }

     $actualManifest = @(Get-StagedPagesManifest -StagePath $releaseStagePath | Sort-Object -CaseSensitive)
     $manifestDifference = @(Compare-Object -CaseSensitive -ReferenceObject $expectedManifest -DifferenceObject $actualManifest)
     if ($manifestDifference.Count -ne 0) {
       throw 'Staged Pages files differ from the reviewed commit or contain missing/extra files.'
     }
     [IO.File]::WriteAllLines($actualManifestPath, $actualManifest, [Text.UTF8Encoding]::new($false))

     $releaseStagedWeb = Join-Path $releaseStagePath 'web'
     $stagedVersionPath = Join-Path $releaseStagedWeb 'version.json'
     $expectedVersionBlob = & git rev-parse "${expectedCommit}:web/version.json"
     if ($LASTEXITCODE -ne 0 -or $expectedVersionBlob -notmatch '^[0-9a-f]{40}$') {
       throw 'Reviewed commit does not contain a valid web/version.json blob.'
     }
     $stagedVersionBlob = & git hash-object -- $stagedVersionPath
     if ($LASTEXITCODE -ne 0 -or $stagedVersionBlob -cne $expectedVersionBlob) {
       throw 'Staged version.json does not match the reviewed commit.'
     }
     try {
       $releaseVersion = Get-Content -Raw -LiteralPath $stagedVersionPath | ConvertFrom-Json
     } catch {
       throw 'Staged version.json is invalid.'
     }
     if ($releaseVersion.version -notmatch '^(?<year>[0-9]{4})\.(?<month>[0-9]{2})\.(?<day>[0-9]{2})\.(?<revision>[0-9]+)$') {
       throw 'Staged release version has an unexpected format.'
     }
     $assetVersion = "$($Matches.year)$($Matches.month)$($Matches.day).$($Matches.revision)"
     $stagedIndex = Get-Content -Raw -LiteralPath (Join-Path $releaseStagedWeb 'index.html')
     $stagedServiceWorker = Get-Content -Raw -LiteralPath (Join-Path $releaseStagedWeb 'sw.js')
     foreach ($asset in @('access.js', 'account.js', 'sync.js')) {
       if (-not (Test-Path -LiteralPath (Join-Path $releaseStagedWeb $asset) -PathType Leaf) -or
           -not $stagedIndex.Contains("$asset`?v=$assetVersion") -or
           -not $stagedServiceWorker.Contains("./$asset`?v=$assetVersion")) {
         throw "Staged release asset/version reference is inconsistent: $asset"
       }
     }

     $pagesArtifactRecord = [ordered]@{
       schema = 'medication-reminder-pages-artifact/v1'
       createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
       releaseRunId = $releaseRunId
       operator = $releaseOperator
       releaseBranch = $expectedBranch
       releaseCommit = $expectedCommit
       archive = $releaseArchivePath
       archiveSha256 = (Get-FileHash -LiteralPath $releaseArchivePath -Algorithm SHA256).Hash
       stage = $releaseStagePath
       expectedManifest = $expectedManifestPath
       expectedManifestSha256 = (Get-FileHash -LiteralPath $expectedManifestPath -Algorithm SHA256).Hash
       actualManifest = $actualManifestPath
       actualManifestSha256 = (Get-FileHash -LiteralPath $actualManifestPath -Algorithm SHA256).Hash
     }
     [IO.File]::WriteAllText(
       $pagesArtifactRecordPath,
       ($pagesArtifactRecord | ConvertTo-Json -Depth 3),
       [Text.UTF8Encoding]::new($false)
     )
     $pagesArtifactRecordSha256 = (
       Get-FileHash -LiteralPath $pagesArtifactRecordPath -Algorithm SHA256
     ).Hash

     function Assert-PagesReleaseArtifact {
       param([Parameter(Mandatory)][string] $Path)
       if (-not [StringComparer]::Ordinal.Equals($Path, $pagesArtifactRecordPath) -or
           -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
         throw 'Pages artifact record is missing.'
       }
       $resolvedTmp = (Resolve-Path -LiteralPath 'F:\tmp').Path
       $resolvedArtifactRecord = (Resolve-Path -LiteralPath $Path).Path
       if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
           [IO.Path]::GetDirectoryName($resolvedArtifactRecord),
           $resolvedTmp
       ) -or
           -not [StringComparer]::Ordinal.Equals(
             [IO.Path]::GetFileName($resolvedArtifactRecord),
             "medication-pages-artifact-$releaseStamp-$releaseRunId.json"
           ) -or
           (Get-FileHash -LiteralPath $resolvedArtifactRecord -Algorithm SHA256).Hash -cne $pagesArtifactRecordSha256) {
         throw 'Pages artifact record path or anchored hash changed.'
       }
       try {
         $artifact = Get-Content -Raw -LiteralPath $resolvedArtifactRecord | ConvertFrom-Json
       } catch {
         throw 'Pages artifact record is not valid JSON.'
       }
       if ($artifact.schema -cne 'medication-reminder-pages-artifact/v1' -or
           $artifact.releaseRunId -cne $releaseRunId -or
           $artifact.releaseBranch -cne $expectedBranch -or
           $artifact.releaseCommit -cne $expectedCommit -or
           $artifact.operator -cne $releaseOperator -or
           -not [StringComparer]::Ordinal.Equals($artifact.archive, $releaseArchivePath) -or
           -not [StringComparer]::Ordinal.Equals($artifact.stage, $releaseStagePath) -or
           -not [StringComparer]::Ordinal.Equals($artifact.expectedManifest, $expectedManifestPath) -or
           -not [StringComparer]::Ordinal.Equals($artifact.actualManifest, $actualManifestPath)) {
         throw 'Pages artifact record schema, provenance, or operator is invalid.'
       }
       foreach ($artifactFile in @(
         @{ Path = $artifact.archive; Expected = $releaseArchivePath; Hash = $artifact.archiveSha256 },
         @{ Path = $artifact.expectedManifest; Expected = $expectedManifestPath; Hash = $artifact.expectedManifestSha256 },
         @{ Path = $artifact.actualManifest; Expected = $actualManifestPath; Hash = $artifact.actualManifestSha256 }
       )) {
         if (-not [StringComparer]::Ordinal.Equals($artifactFile.Path, $artifactFile.Expected) -or
             -not [IO.Path]::GetFileName($artifactFile.Path).Contains($releaseRunId, [StringComparison]::Ordinal) -or
             $artifactFile.Hash -cnotmatch '^[A-F0-9]{64}$' -or
             -not (Test-Path -LiteralPath $artifactFile.Path -PathType Leaf)) {
           throw 'Pages artifact path or recorded SHA-256 is invalid.'
         }
         $resolvedArtifactFile = (Resolve-Path -LiteralPath $artifactFile.Path).Path
         if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
             [IO.Path]::GetDirectoryName($resolvedArtifactFile),
             $resolvedTmp
         ) -or
             -not [StringComparer]::OrdinalIgnoreCase.Equals(
               $resolvedArtifactFile,
               (Resolve-Path -LiteralPath $artifactFile.Expected).Path
             ) -or
             (Get-FileHash -LiteralPath $resolvedArtifactFile -Algorithm SHA256).Hash -cne $artifactFile.Hash) {
           throw "Pages artifact hash or location changed: $resolvedArtifactFile"
         }
       }
       if (-not [StringComparer]::Ordinal.Equals($artifact.stage, $releaseStagePath) -or
           -not [IO.Path]::GetFileName($artifact.stage).EndsWith($releaseRunId, [StringComparison]::Ordinal) -or
           -not (Test-Path -LiteralPath $artifact.stage -PathType Container)) {
         throw 'Pages staging directory is missing.'
       }
       $resolvedArtifactStage = (Resolve-Path -LiteralPath $artifact.stage).Path
       if (-not [StringComparer]::OrdinalIgnoreCase.Equals(
           [IO.Path]::GetDirectoryName($resolvedArtifactStage),
           $resolvedTmp
       ) -or
           -not [StringComparer]::OrdinalIgnoreCase.Equals(
             $resolvedArtifactStage,
             (Resolve-Path -LiteralPath $releaseStagePath).Path
           )) {
         throw 'Pages staging directory must remain directly under F:\tmp.'
       }

       $freshTreeLines = @(& git ls-tree -r $expectedCommit -- web)
       if ($LASTEXITCODE -ne 0 -or $freshTreeLines.Count -eq 0) {
         throw 'Could not recompute the reviewed commit web tree.'
       }
       $freshExpectedManifest = foreach ($line in $freshTreeLines) {
         if ($line -notmatch '^(?<mode>[0-9]{6}) blob (?<hash>[0-9a-f]{40})\t(?<path>web/.+)$' -or
             $Matches.mode -cnotin @('100644', '100755')) {
           throw "Reviewed commit contains a link, submodule, unsupported mode, or malformed tree entry: $line"
         }
         "$($Matches.hash)`t$($Matches.path)"
       }
       $freshExpectedManifest = @($freshExpectedManifest | Sort-Object -CaseSensitive)
       $currentManifest = @(
         Get-StagedPagesManifest -StagePath $resolvedArtifactStage | Sort-Object -CaseSensitive
       )
       $currentDifference = @(
         Compare-Object -CaseSensitive -ReferenceObject $freshExpectedManifest -DifferenceObject $currentManifest
       )
       if ($currentDifference.Count -ne 0) {
         throw 'Pages staging set or content differs from the freshly recomputed reviewed commit tree.'
       }
       $script:releaseStagedWeb = Join-Path $releaseStagePath 'web'
     }

     Assert-ReleaseProvenance
     Assert-ReleaseAttestation -Path $rollbackRecordPath
     Assert-PagesReleaseArtifact -Path $pagesArtifactRecordPath
     & $wrangler pages deploy $releaseStagedWeb --project-name medication-reminder --branch $expectedBranch --commit-hash $expectedCommit
     if ($LASTEXITCODE -ne 0) { throw 'Pages deployment failed; asset verification was not run.' }

     node -e "Promise.all(['/version.json','/access.js?v=20260723.17','/account.js?v=20260723.17','/sync.js?v=20260723.17'].map(p=>fetch('https://medication.bytesfx.com'+p,{cache:'no-store'}).then(async r=>[p,r.status,await r.text()]))).then(rows=>{for(const [p,s,b]of rows)console.log(p,s,b.length);if(rows.some(([,s])=>s!==200)||!rows[0][2].includes('2026.07.23.17'))process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"
     if ($LASTEXITCODE -ne 0) { throw 'Pages release asset verification failed.' }
   } finally {
     Pop-Location
   }
   ```

   Retain the uniquely named archive, staging directory, both manifests, artifact
   record, and rollback attestation under `F:\tmp` through release verification and
   the audit-retention window. The deployed directory contains only tracked `web/`
   files from the exact reviewed commit; ignored and dirty working-tree files are
   never included.

7. In a fresh private browser verify the privacy gate precedes all schedule content;
   local-only CRUD makes no `/api/sync` calls; notification consent is explicit;
   Google sign-in preserves local data; and **Keep**, **Erase**, and **Cancel** each
   have the documented sign-out result.
8. With one controlled update available, decline the prompt and confirm the running
   worker is not sent `SKIP_WAITING`, the page does not reload, and focus/visibility
   checks do not immediately offer the same worker again. In a fresh controlled
   session, accept the update and confirm exactly one `SKIP_WAITING` message is sent,
   `controllerchange` occurs, and the page reloads only after acceptance.
9. Using a synthetic timestamp with no schedule content, load
   `/?dueAt=<synthetic>` online and inspect Cache Storage: only the canonical `/`
   shell key may be written, never the `dueAt` URL. Repeat offline through a
   notification-style navigation and confirm the browser retains the query while the
   response comes from the canonical shell key. After activation, confirm only old
   `medication-reminder-web-*` generations were removed and an unrelated test cache
   on the same origin was preserved.

Record no secrets, tokens, cookies, medical schedule contents, encryption keys, or
push-subscription values during verification.

### Rollback

If Worker verification fails, use the captured version ID—not “the previous” mutable
position. Pinned Wrangler 4.112.0 accepts the version ID, an audit message, and
`--yes`; `--yes`, rather than the message, suppresses the confirmation prompt:

```powershell
Assert-ReleaseProvenance
Assert-ReleaseAttestation -Path $rollbackRecordPath
Push-Location (Join-Path $repoRoot 'worker')
try {
  & $wrangler rollback $rollbackWorkerVersion --message "Rollback reviewed release $expectedCommit to captured version $rollbackWorkerVersion" --yes
  if ($LASTEXITCODE -ne 0) { throw 'Worker rollback failed; begin incident response.' }

  node -e "fetch('https://medication.bytesfx.com/api/health',{cache:'no-store'}).then(async r=>{console.log(r.status);if(!r.ok)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"
  if ($LASTEXITCODE -ne 0) { throw 'Rolled-back Worker health check failed.' }
  node -e "fetch('https://medication.bytesfx.com/api/auth/config',{cache:'no-store'}).then(async r=>{console.log(r.status);if(!r.ok)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"
  if ($LASTEXITCODE -ne 0) { throw 'Rolled-back Worker auth/config check failed.' }

  $rollbackVerificationPath = Join-Path 'F:\tmp' "medication-worker-rollback-verification-$rollbackStamp-$releaseRunId.json"
  if (Test-Path -LiteralPath $rollbackVerificationPath) {
    throw "Refusing to overwrite rollback verification: $rollbackVerificationPath"
  }
  $rollbackVerificationJson = & $wrangler deployments list --name medication-reminder-push --json
  if ($LASTEXITCODE -ne 0) { throw 'Post-rollback Worker deployment inventory failed.' }
  $rollbackVerificationRaw = @($rollbackVerificationJson) -join [Environment]::NewLine
  try {
    $rollbackVerification = $rollbackVerificationRaw | ConvertFrom-Json
  } catch {
    throw 'Post-rollback Worker deployment inventory was not valid JSON.'
  }
  if ([string]::IsNullOrWhiteSpace($rollbackVerificationRaw) -or $null -eq $rollbackVerification) {
    throw 'Post-rollback Worker deployment inventory was empty.'
  }
  [IO.File]::WriteAllText($rollbackVerificationPath, $rollbackVerificationRaw, [Text.UTF8Encoding]::new($false))
} finally {
  Pop-Location
}
```

If Wrangler refuses the rollback because the captured version is incompatible with
current bindings or secrets, stop. Use a separately reviewed Cloudflare Dashboard
recovery procedure; do not change bindings, rotate secrets, or choose another
version during the incident command.

In Dashboard, confirm the newly created active Worker deployment targets the captured
`$rollbackWorkerVersion` at 100% traffic. Then perform the read-only legacy owner
check and current `/api` version/auth checks, recording only status codes and safe
revision metadata. A Worker rollback creates a new deployment; it does not revert D1
or other connected resources. See Cloudflare's
[Worker rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

If Pages verification fails, use Dashboard exactly as documented by Cloudflare:

1. Open **Workers & Pages** > **medication-reminder** > **Deployments** >
   **All deployments**.
2. Locate the captured prior successful **production** deployment. Verify the
   displayed deployment ID and commit exactly match
   `$rollbackPagesDeployment` and `$rollbackPagesCommit`.
3. Open its three-dot menu, select **Rollback to this deployment**, and confirm.
4. Verify the live `version.json`, versioned assets, privacy gate, local-only mode,
   and account entry against the captured deployment URL without recording
   application data.

Preview deployments are not valid Pages rollback targets. See Cloudflare's
[Pages rollback documentation](https://developers.cloudflare.com/pages/configuration/rollbacks/).

Migration 0003 is forward-only and additive and normally remains during either code
rollback. Restoring the D1 export is a disaster-recovery action, not a routine
rollback: never import it blindly over post-migration writes, because doing so can
discard later data. Restoration requires an explicit maintenance window,
reconciliation plan, and authorization. A secret rotation must be rolled back with
the preserved prior secret or in-flight deterministic retries remain broken.

## Local development and validation

The PWA in [`web/`](web/) is static and dependency-free. Serve it through local HTTPS
for complete installation and notification behaviour. Run the full repository checks
in a new PowerShell session started at the repository root. If the validator reports
that the registry is unreachable, stop before `npm ci` and manually confirm the exact
package spellings: `web-push` and Cloudflare's official `wrangler` package.

```powershell
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath '.').Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'worker\wrangler.jsonc'))) {
  throw 'Start these checks from the Medication Reminder repository root.'
}

node "C:\Users\fbmac\atlas\Codex\.codex_state\user_home\scripts\validate-packages.cjs" web-push
if ($LASTEXITCODE -ne 0) { throw 'Package validation rejected or could not validate web-push; dependencies were not installed.' }
node "C:\Users\fbmac\atlas\Codex\.codex_state\user_home\scripts\validate-packages.cjs" wrangler
if ($LASTEXITCODE -ne 0) { throw 'Package validation rejected or could not validate wrangler; dependencies were not installed.' }

Push-Location (Join-Path $repoRoot 'worker')
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'Locked Worker dependency installation failed.' }
} finally {
  Pop-Location
}

$wrangler = Join-Path $repoRoot 'worker\node_modules\.bin\wrangler.cmd'
if (-not (Test-Path -LiteralPath $wrangler -PathType Leaf)) {
  throw 'Pinned local Wrangler executable is missing after dependency bootstrap.'
}
$wranglerVersion = & $wrangler --version
if ($LASTEXITCODE -ne 0) { throw 'Pinned local Wrangler version check failed.' }
if ($wranglerVersion.Trim() -ne '4.112.0') {
  throw "Expected pinned Wrangler 4.112.0, found $($wranglerVersion.Trim())."
}

Push-Location (Join-Path $repoRoot 'worker')
try {
  $lock = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'worker\package-lock.json') | ConvertFrom-Json -AsHashtable
  $dependencyTreeJson = npm ls --all --json
  if ($LASTEXITCODE -ne 0) { throw 'Installed dependency tree does not agree with the lockfile.' }
  $dependencyTree = $dependencyTreeJson | ConvertFrom-Json
  if ($lock.packages.''.devDependencies.wrangler -cne '4.112.0' -or
      $lock.packages.'node_modules/wrangler'.version -cne '4.112.0' -or
      $dependencyTree.dependencies.wrangler.version -cne $lock.packages.'node_modules/wrangler'.version -or
      $dependencyTree.dependencies.'web-push'.version -cne $lock.packages.'node_modules/web-push'.version) {
    throw 'Installed direct dependencies, manifest, and lockfile do not agree.'
  }

  $runtimeAuditJson = npm audit --omit=dev --json
  if ($LASTEXITCODE -ne 0) { throw 'Production dependency audit failed.' }
  $runtimeAudit = $runtimeAuditJson | ConvertFrom-Json
  if ($runtimeAudit.metadata.vulnerabilities.total -ne 0) {
    throw 'Production dependency audit returned vulnerabilities.'
  }

  function Assert-ApprovedDevToolAuditException {
    param(
      [Parameter(Mandatory)][object] $Audit,
      [Parameter(Mandatory)][hashtable] $PackageLock
    )
    $findingNames = @($Audit.vulnerabilities.PSObject.Properties.Name | Sort-Object)
    $expectedNames = @('miniflare', 'sharp', 'wrangler')
    $sharpAdvisories = @($Audit.vulnerabilities.sharp.via | Where-Object {
      $_.url -eq 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj'
    })
    $fixMetadata = @(
      $Audit.vulnerabilities.sharp.fixAvailable
      $Audit.vulnerabilities.miniflare.fixAvailable
      $Audit.vulnerabilities.wrangler.fixAvailable
    )
    $allNoFix = @($fixMetadata | Where-Object { $_ -ne $false }).Count -eq 0
    $allKnownForcedDowngrade = @($fixMetadata | Where-Object {
      $_ -isnot [pscustomobject] -or
      $_.name -cne 'wrangler' -or
      $_.version -cne '4.15.2' -or
      $_.isSemVerMajor -ne $true
    }).Count -eq 0
    $checks = [ordered]@{
      exactFindingNames = @(Compare-Object -CaseSensitive $expectedNames $findingNames).Count -eq 0
      totalCount = $Audit.metadata.vulnerabilities.total -eq 3
      highCount = $Audit.metadata.vulnerabilities.high -eq 3
      infoCount = $Audit.metadata.vulnerabilities.info -eq 0
      lowCount = $Audit.metadata.vulnerabilities.low -eq 0
      moderateCount = $Audit.metadata.vulnerabilities.moderate -eq 0
      criticalCount = $Audit.metadata.vulnerabilities.critical -eq 0
      sharpViaCount = @($Audit.vulnerabilities.sharp.via).Count -eq 1
      sharpAdvisoryCount = $sharpAdvisories.Count -eq 1
      sharpAdvisorySource = $sharpAdvisories.Count -eq 1 -and $sharpAdvisories[0].source -eq 1124066
      sharpAdvisoryRange = $sharpAdvisories.Count -eq 1 -and $sharpAdvisories[0].range -eq '<0.35.0'
      miniflareVia = @($Audit.vulnerabilities.miniflare.via).Count -eq 1 -and $Audit.vulnerabilities.miniflare.via[0] -eq 'sharp'
      wranglerVia = @($Audit.vulnerabilities.wrangler.via).Count -eq 1 -and $Audit.vulnerabilities.wrangler.via[0] -eq 'miniflare'
      approvedFixMetadata = $allNoFix -or $allKnownForcedDowngrade
      wranglerVersion = $PackageLock.packages.'node_modules/wrangler'.version -eq '4.112.0'
      wranglerDevOnly = $PackageLock.packages.'node_modules/wrangler'.dev -eq $true
      miniflareVersion = $PackageLock.packages.'node_modules/wrangler'.dependencies.miniflare -eq '4.20260714.0'
      miniflareDevOnly = $PackageLock.packages.'node_modules/miniflare'.dev -eq $true
      sharpDependency = $PackageLock.packages.'node_modules/miniflare'.dependencies.sharp -eq '0.34.5'
      sharpVersion = $PackageLock.packages.'node_modules/sharp'.version -eq '0.34.5'
      sharpDevOnly = $PackageLock.packages.'node_modules/sharp'.dev -eq $true
    }
    $failedChecks = @(
      $checks.GetEnumerator() |
        Where-Object { -not [bool]$_.Value } |
        ForEach-Object { $_.Key }
    )
    if ($failedChecks.Count -ne 0) {
      throw "Full dependency audit differs from the approved dev-tool exception. Failed checks: $($failedChecks -join ', ')."
    }
  }

  $devAuditJson = npm audit --json
  $devAuditExit = $LASTEXITCODE
  if ($devAuditExit -notin @(0, 1)) { throw 'Full dependency audit could not complete.' }
  $devAudit = $devAuditJson | ConvertFrom-Json
  if ($devAuditExit -eq 1) {
    Assert-ApprovedDevToolAuditException -Audit $devAudit -PackageLock $lock
    Write-Warning 'Known dev-tool audit exception matched exactly; production dependency audit is clean.'
  }
} finally {
  Pop-Location
}

Push-Location $repoRoot
try {
  node --check web/access.js
  if ($LASTEXITCODE -ne 0) { throw 'web/access.js syntax check failed.' }
  node --check web/account.js
  if ($LASTEXITCODE -ne 0) { throw 'web/account.js syntax check failed.' }
  node --check web/app.js
  if ($LASTEXITCODE -ne 0) { throw 'web/app.js syntax check failed.' }
  node --check web/sync.js
  if ($LASTEXITCODE -ne 0) { throw 'web/sync.js syntax check failed.' }
  node --test tests/*.mjs
  if ($LASTEXITCODE -ne 0) { throw 'JavaScript tests failed.' }
  python -B -m unittest discover -s tests -p "test_*.py"
  if ($LASTEXITCODE -ne 0) { throw 'Python tests failed.' }

  Push-Location (Join-Path $repoRoot 'worker')
  try {
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Worker tests failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Worker dry-run build failed.' }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}
```

Every release and complete validation run executes the required package validator
for both direct packages, `web-push` and `wrangler`, then unconditionally runs
`npm ci` against `worker/package-lock.json`. This removes and recreates the installed
dependency tree from the lockfile so stale or modified `node_modules` content cannot
be trusted. It does not add or select packages. Wrangler is pinned and tested at
exactly `4.112.0`; all production commands invoke that freshly installed local
executable, so they cannot trigger an implicit package download. `npm run build`
also resolves the pinned local CLI and performs a dry run without deploying.

Treat a Wrangler upgrade as a deliberate dependency change: validate the exact
`wrangler` package name, update to an explicitly selected exact version with
`--save-dev --save-exact`, inspect the manifest and lockfile diff, run the complete
test suite and Worker dry-run build, and commit the version change. Do not introduce
or upgrade any package without the required validation for its exact package name.

### Temporary development-tool audit exception

As checked on **2026-07-23**, `npm audit` reports
`GHSA-f88m-g3jw-g9cj` through this dev-only chain:

```text
wrangler@4.112.0 -> miniflare@4.20260714.0 -> sharp@0.34.5
```

The advisory covers inherited libvips vulnerabilities in Sharp versions below
0.35.0. Depending on the npm registry response path, `fixAvailable` is either `false`
or an identical forced semver-major downgrade to Wrangler 4.15.2 for all three
nodes. That downgrade is not an approved remediation: the then-current Wrangler
4.113.0 still pinned Miniflare to Sharp 0.34.5. The release gate accepts only those
two exact metadata shapes and rejects any other advertised fix. Wrangler,
Miniflare, and Sharp are marked `dev: true` in the lockfile and inspection of the
Worker dry-run bundle confirms they are not bundled into the deployed Worker
runtime.

This is a constrained development-tool exception, not a production-runtime
exception. Run Wrangler and Miniflare only on trusted repository inputs in restricted
developer or CI environments, and do not use this toolchain to process untrusted
images. Keep `npm audit --omit=dev` as a zero-vulnerability deployment gate. The full
audit may proceed only when it matches the exact advisory, versions, dependency path,
and dev-only flags checked above; any other finding stops the release for review.

Track the upstream Wrangler/Miniflare chain and remove this exception immediately
when Wrangler ships a supported fixed dependency. Before upgrading, revalidate the
`wrangler` package, update the exact pin, inspect the lockfile, then rerun the complete
suite and Worker dry-run.

## Windows owner tool

The owner widget runs in the Windows system tray, uses an always-on-top reminder,
supports taken/snooze actions and CSV audit export, and catches up reminders after
sleep or restart. Build and run it only in the owner/developer environment:

1. Install Python 3.11 or newer for Windows.
2. Run `install_dependencies.bat`.
3. Run `run_medication_reminder.bat`, then use **Test reminder**.
4. To create a single executable, run `build_windows_exe.bat`; output is written to
   `dist`.

The widget registers the current-user
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value and uses a single-instance
guard. Its main files are:

- `medication_reminder.py` — tray application and scheduler;
- `sync_client.py` — encrypted legacy synchronization adapter;
- `medication_schedule.json` — editable source schedule;
- `%LOCALAPPDATA%\MedicationReminder` — protected schedule, state, audit, and
  credentials; and
- `medication_icon.ico` — application icon.
