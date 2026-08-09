# Privacy Policy — Medication Reminder

**DRAFT — NOT LEGAL ADVICE.** Written from the actual behaviour of the code as
of 2026-08-08. It is accurate about the system; it has not been reviewed by a
lawyer. Health data is a special category under UK/EU GDPR, so have a qualified
person review this before publishing. Items in `[SQUARE BRACKETS]` are facts
only you can supply.

- **Controller:** `[LEGAL NAME / SOLE TRADER NAME]`, `[POSTAL ADDRESS]`
- **Contact:** `[PRIVACY CONTACT EMAIL]`
- **Last updated:** `[DATE OF PUBLICATION]`

## The short version

Your medication schedule — what you take, when, the instructions, and your
record of doses taken or missed — is **encrypted on your own device before it is
sent anywhere**. The server stores an unreadable block of ciphertext and never
receives the key. We cannot read your medicines, and we could not hand them to
anyone else even if compelled.

We do hold your account identity and some operational metadata, and there is one
honest limit to the encryption, described under "What we can still infer".

## What we collect

**From Google Sign-In**, when you choose to sign in: your email address, display
name, profile picture URL, and Google's account identifier. Sign-in is the only
way to use cloud sync. You may instead choose "Continue on this device", in
which case no account is created and nothing leaves your browser.

**Your schedule, encrypted.** The relay stores ciphertext and an initialisation
vector. Encryption is AES-GCM, performed in your browser or widget. The key is
generated on your device and is shared with your other devices through a link
fragment, which browsers never transmit to a server.

**Devices you connect:** a device type (browser, phone, Windows), a display name
you or your device supplies, and timestamps of first and most recent use.
Authentication tokens are stored only as **cryptographic hashes**, never in a
form that could be replayed.

**Push notification subscriptions**, if you enable reminders on a phone: the
push endpoint URL supplied by your browser vendor, its encryption keys, your
timezone, and the **times** at which reminders are due.

**Account activity:** a log of security-relevant events such as sign-in,
sign-out and device revocation.

**Operational data:** rate-limiting counters and service health records.

## What we cannot see

Medication names, dosages, instructions, schedule labels, and your history of
doses taken or missed. These exist on the server only as ciphertext.

Push notifications are deliberately generic — they say "Medication reminder due"
and never name a medicine — so that your medication is not disclosed to your
browser vendor's push service, or to anyone reading your lock screen.

## What we can still infer

Encryption protects contents, not the fact of activity. From the metadata above,
the service can determine **the times of day you are scheduled to take
something**, how many reminders you have, when your devices sync, and your
timezone. Someone with access to the database could tell that you take something
at 08:00 and 20:00 — but not what.

This is stated plainly because a policy claiming "we can see nothing" would be
untrue.

## Why we process it (UK/EU GDPR)

- **Contract** — providing the service you asked for.
- **Explicit consent** — your schedule concerns health, a special category under
  Article 9. The service is only usable by deliberately entering that data, and
  you may delete it at any time. `[CONFIRM THIS BASIS WITH A REVIEWER.]`
- **Legitimate interests** — security logging and abuse prevention.

## How long we keep it

| Data | Retention |
| --- | --- |
| Account and encrypted schedule | Until you delete your account |
| Account activity log | 180 days, then deleted automatically |
| Push subscriptions | Deleted after 30 days idle with nothing pending |
| Sessions | Expire automatically; deleted on sign-out |
| Rate-limit counters | 24 hours |

Deleting your account removes all of the above immediately.

## Your rights

You can exercise the two most important ones yourself, in the app, without
contacting anyone:

- **Access and portability** — *Settings → Export my data* downloads everything
  the server holds about you as JSON. Your schedule appears there as ciphertext,
  because that is genuinely all the server has; export a readable copy from a
  device that holds the key.
- **Erasure** — *Settings → Delete my account* permanently removes your account,
  encrypted schedule, devices, push subscriptions and activity log. It cannot be
  undone.

You also have rights to rectification, restriction, objection, and to complain
to a supervisory authority (in the UK, the ICO at `ico.org.uk`).

## Who else is involved

- **Cloudflare, Inc.** hosts the service (Workers, D1, Pages) and processes data
  on our behalf.
- **Google LLC** provides sign-in, and receives the fact that you signed in.
- **Your browser vendor's push service** (Google, Apple, Mozilla) delivers
  notifications, and receives only the generic text described above.

`[CONFIRM WHERE DATA IS STORED AND WHETHER INTERNATIONAL TRANSFER TERMS ARE
NEEDED FOR YOUR USERS.]`

## Security

Traffic is HTTPS. Session and device tokens are stored hashed. Access to your
schedule is scoped to your account, and a device you revoke loses access
immediately. On Windows, the desktop widget encrypts its local copy using the
operating system's data protection facilities.

No system is perfectly secure, and this one is maintained by a small team.

## Children

`[STATE YOUR POSITION. A medication reminder may legitimately be operated by a
parent for a child; decide whether accounts are restricted to adults.]`

## Changes

Material changes will be notified in the app before taking effect.
