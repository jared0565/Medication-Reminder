# Browser Account Boundary and Local-Only Access

Date: 2026-07-23  
Status: Approved design, awaiting implementation plan

## Objective

Make the browser application the primary product for public users while preserving
private, offline-capable use on any single desktop or mobile device. Cloud pairing,
cross-device synchronization, and account recovery require an authenticated account.
The Windows widget remains a developer/owner-only application and is not part of
public onboarding.

## Product Model

### Local-only user

A new visitor may explicitly choose **Continue on this device**. Local-only mode
provides:

- schedule and medication add, edit, and remove operations;
- local reminder notifications, due modals, sounds, and volume settings;
- taken-status tracking;
- PWA installation; and
- offline operation after the application assets have been cached.

Local-only schedules and taken-state data remain in that browser profile or installed
PWA. The application does not upload the schedule, create a cloud pairing, or imply
that the data can be recovered elsewhere.

### Authenticated user

An authenticated browser user receives all local functionality plus account-owned
cloud features:

- one encrypted schedule pairing with a mobile device;
- encrypted cross-device synchronization;
- account-scoped device management;
- schedule recovery features added in later releases; and
- other entitled cloud conveniences.

Authentication does not make medication content readable by Cloudflare. Schedule
payloads remain encrypted on the client.

### Paired mobile device

The mobile PWA is paired from an authenticated browser by a short-lived, single-use
invitation. A successful claim gives the installed mobile application its own scoped
device credential. The mobile application retains its schedule locally and continues
issuing reminders when offline or when the account browser is closed.

### Owner Windows widget

The Windows widget is private to the developer/owner. Existing encrypted widget
pairings remain compatible during this release. Public users cannot obtain or depend
on the widget. A future owner-device authorization flow should bind the widget to the
owner account without embedding a reusable account secret in the executable.

## First-Run and Session Experience

The application begins in a privacy-locked state while it restores account state and
loads the user's access-mode decision. Schedule content must not render underneath
the access screen.

On a device with neither a valid session nor an explicit local-only decision, a modal
offers:

1. **Sign in with Google**
2. **Continue on this device**

The modal explains that local-only data stays on the current device and cannot be
paired or recovered through the cloud.

A remembered local-only decision opens the local workspace directly on later visits.
The user can sign in from the application at any time. Signing in upgrades the current
workspace without deleting its local schedule.

An expired account session locks cloud controls and requests sign-in again. Local
reminders and local schedule editing continue. Signing out asks whether to retain the
local schedule or erase local application data; neither choice silently deletes the
other paired device.

## Pairing-Link Behavior

Opening a pairing link on an unauthenticated desktop browser does not decrypt or
display the linked schedule. The invitation is retained only in memory or
session-scoped storage while the user signs in, then removed from the address bar and
temporary storage.

Local-only users cannot process cloud pairing invitations. They may sign in to
continue.

Mobile pairing invitations:

- expire after a short server-defined interval;
- can be claimed once;
- are bound to the owning account's pairing record;
- exchange for a device-scoped credential; and
- do not become permanent synchronization credentials.

The encryption key stays in the URL fragment and on participating devices. It is
never included in an HTTP request to Cloudflare.

## Trust Boundaries

### Same-origin account API

Account endpoints are exposed under `https://medication.bytesfx.com/api/`. Browser
sessions use a `Secure`, `HttpOnly`, `SameSite` cookie. JavaScript does not receive or
store the account session token.

State-changing cookie-authenticated requests require:

- an allowed `Origin`;
- a non-simple, application-specific CSRF header;
- an authenticated active account; and
- server-side authorization for the targeted resource.

The Worker rejects browser-account operations received through an unexpected origin.
Security headers and the existing restrictive Content Security Policy remain in
force.

### Tenant isolation

Every browser-created cloud pairing is assigned a non-null `user_id`. The Worker
derives that value from the authenticated session, never from request JSON.

Every account-side read, update, invitation creation, and revocation query includes
the authenticated `user_id`. A valid identifier, encryption token, or device
identifier cannot override ownership.

Mobile operations use the pair identifier plus the hashed, scoped mobile credential
and registered mobile device identifier. Mobile credentials cannot create pairings
or operate on another pairing.

Account identifiers and medication metadata must not be written into logs together.
Audit records contain account and operation identifiers, result categories, and safe
failure reasons, but never schedules, medicines, encryption keys, invitation tokens,
session tokens, or push-subscription secrets.

### Local-only isolation

Local-only mode does not call pairing or synchronization endpoints. The UI cannot be
the sole enforcement point: the Worker independently requires authentication and
entitlement for browser-created cloud resources.

## Data Model Changes

A forward-only D1 migration adds the fields required for scoped invitations and
mobile credentials while preserving existing records:

- pairing owner account identifier;
- invitation-token hash;
- invitation expiry and consumption timestamps;
- mobile credential hash;
- mobile device identifier and claim timestamp; and
- revocation/update timestamps needed for auditing and conflict handling.

New browser-created pairings require an owner account. Existing records with a null
owner remain on the compatibility path so current widget pairings continue to work.
New anonymous browser pairing creation is rejected.

The migration is additive and runs before the new Worker. The Worker tolerates both
legacy and account-owned records during the compatibility period.

## Client Components

### Access controller

A dedicated browser access controller owns:

- account restoration;
- the local-only decision;
- privacy-lock state;
- first-run modal rendering;
- pending invitation handling;
- sign-in and sign-out transitions; and
- cloud-feature availability events.

Schedule code consumes the resulting access state and does not independently infer
authentication from DOM elements or stored values.

### Account client

The account client uses same-origin credentialed requests. It exposes account state
and capability checks without exposing session material.

### Sync client

The browser sync client requires authenticated cloud capability before creating or
operating an account-owned pairing. The installed mobile sync client uses only its
scoped device credential. Local-only mode cannot accidentally invoke either path.

## Failure Handling

- Google or Cloudflare outages leave local functionality available.
- Account restoration failures distinguish expired authentication from temporary
  service failure.
- Failed sign-in does not erase or upload local data.
- Expired, malformed, reused, revoked, or already-claimed invitations fail without
  changing either device.
- Concurrent schedule revisions retain the existing explicit conflict decision.
- Server errors expose safe user messages and structured internal result codes,
  without returning secrets or tenant existence details.
- A lost mobile credential requires a new invitation; it cannot be recovered from
  the relay.

## Deployment and Migration

Deployment order:

1. Back up and migrate D1.
2. Deploy the backward-compatible Worker and same-origin API route.
3. Verify account, legacy widget, and mobile endpoints.
4. Deploy the privacy-gated browser/PWA client.
5. Verify a new private browser, an existing local browser, authenticated pairing,
   mobile offline behavior, and the existing widget compatibility record.

The Worker deploy is rolled back before the client if API validation fails. The
browser client is rolled back independently if first-run or local-data migration
checks fail. The additive database migration remains in place during rollback.

## Validation Requirements

Automated tests must prove:

- a first-time user sees the access decision before schedule content;
- local-only mode performs no schedule cloud requests;
- local schedule CRUD and reminders work without authentication;
- sign-in preserves existing local data;
- expired sessions retain local operation while locking cloud controls;
- session cookies have the required security attributes;
- CSRF and origin checks reject invalid state-changing requests;
- Account A cannot read, change, claim, or revoke Account B's pairing;
- invitations expire, are single-use, and cannot become mobile credentials;
- mobile credentials are scoped to one pair and device;
- mobile reminders continue with the network unavailable;
- existing widget pairing records remain readable and updateable;
- schedule encryption keys and medication details are absent from server logs and
  persistent plaintext storage; and
- upgrades do not silently erase existing schedules or taken-state data.

Live release verification must repeat the critical first-run, tenant-isolation,
pairing, offline-mobile, and legacy-widget scenarios against production configuration.

## Out of Scope

- Public distribution of the Windows widget;
- organization or family accounts;
- multiple mobile devices per account;
- billing and donation processing;
- server-side plaintext schedule recovery; and
- the future owner-device authorization flow for creating new widget pairings.

