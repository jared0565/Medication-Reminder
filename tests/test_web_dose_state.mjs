import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// F3: a schedule edit arriving from another device must not destroy dose state.
// The PWA used to drop a "Taken" mark as soon as the event's time moved later
// than the wall clock, so retiming a dose on the widget erased the record that
// it had already been taken here.

// Local components, so the fixed clock is 09:00 local whatever TZ the test runs in.
const FIXED = new Date(2026, 6, 22, 9, 0, 0).getTime();
const TODAY = '2026-07-22';

function event(overrides = {}) {
  return {
    id: 'morning',
    enabled: true,
    time: '08:00',
    label: 'Morning medicines',
    medicines: ['Example medicine'],
    instructions: '',
    days: ['daily'],
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

/** The rendered status badge text -- the part of the card that states a fact. */
function badge(app) {
  const found = app.todayList.innerHTML.match(/<span class="status-badge">([^<]*)<\/span>/);
  assert.ok(found, 'no status badge was rendered');
  return found[1];
}

function fakeElement() {
  return {
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    hidden: false,
    checked: false,
    open: false,
    dataset: {},
    onclick: null,
    oninput: null,
    listeners: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    append() {},
    remove() {},
    // due-modal.js calls this to fill the medicine list; without it show() throws
    // and the dialog silently never opens, which made prompt tests unfalsifiable.
    replaceChildren() {},
    closest() { return null; },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
}

/** Run web/app.js against a stub DOM with a fixed clock and seeded storage. */
function runApp({ taken = {}, events = [event()], search = '' } = {}) {
  const store = new Map([
    ['medication-reminder-schedule-v1', JSON.stringify({ version: 1, timezone: 'Europe/London', events })],
    ['medication-reminder-taken-v1', JSON.stringify(taken)],
  ]);
  const localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: key => void store.delete(key),
  };

  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(FIXED);
      else super(...args);
    }
    static now() { return FIXED; }
  }

  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, fakeElement());
    return elements.get(selector);
  };

  // sync.js listens for 'medication-schedule-changed' to mark the pairing dirty
  // and schedule a push, so capturing it is how we prove a take actually syncs.
  const syncSignals = [];
  const window = {
    addEventListener() {},
    dispatchEvent: event => void syncSignals.push({ type: event.type, detail: event.detail }),
  };
  const context = {
    window,
    // Must carry `detail`: sync.js reads event.detail.doseOnly to decide whether
    // the relay should notify the other device. A stub that dropped it would make
    // the assertions below unfalsifiable.
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    console,
    Date: FixedDate,
    Intl,
    URLSearchParams,
    structuredClone,
    localStorage,
    navigator: {},
    location: { search, pathname: '/', hash: '' },
    history: { replaceState() {} },
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    alert: () => {},
    confirm: () => false,
    prompt: () => null,
    document: {
      querySelector: $,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: tagName => ({ tagName, ...fakeElement() }),
    },
  };
  context.globalThis = context;
  // app.js expects the due-modal factory to already be on window.
  vm.runInNewContext(readFileSync('web/due-modal.js', 'utf8'), context);
  vm.runInNewContext(readFileSync('web/app.js', 'utf8'), context);
  const todayList = $('#todayList');
  /** Drive the real click handler the way a user's tap does. */
  const click = attrs => todayList.listeners.click({
    target: { closest: selector => (selector === '[data-taken]' && attrs.taken
      ? { dataset: { taken: attrs.taken, event: attrs.event } }
      : selector === '[data-undo-taken]' && attrs.undo
        ? { dataset: { undoTaken: attrs.undo } }
        : selector === '[data-missed]' && attrs.missed
          ? { dataset: { missed: attrs.missed, event: attrs.event } }
          : null) },
  });
  return {
    window,
    todayList,
    scheduleList: $('#scheduleList'),
    syncSignals,
    dueDialog: $('#dueDialog'),
    markTaken: (key, eventId) => click({ taken: key, event: eventId }),
    undoTaken: key => click({ undo: key }),
    markMissed: (key, eventId) => click({ missed: key, event: eventId }),
    storedTaken: () => JSON.parse(store.get('medication-reminder-taken-v1') || '{}'),
  };
}

test('a taken dose stays taken when another device moves the reminder later', () => {
  const app = runApp({ taken: { [`${TODAY}|morning`]: FIXED } });
  assert.match(app.todayList.innerHTML, /Taken/, 'precondition: the dose starts out marked taken');

  // The widget retimes the morning dose from 08:00 to 22:00 and syncs it here.
  app.window.applySyncedSchedule({
    version: 1,
    timezone: 'Europe/London',
    events: [event({ time: '22:00' })],
  });

  assert.match(
    app.todayList.innerHTML,
    /Taken/,
    'retiming the reminder on another device erased the record that it was taken',
  );
  assert.ok(
    app.storedTaken()[`${TODAY}|morning`],
    'the taken mark was deleted from local storage by the synced schedule change',
  );
});

// F2: dose state travels in the synced payload.

const iso = ms => new Date(ms).toISOString();

test('the published payload carries the schedule and this device\'s doses', () => {
  const stamp = iso(FIXED);
  const app = runApp({ taken: { [`${TODAY}|morning`]: { taken_at: stamp, updated_at: stamp } } });

  const payload = app.window.getMedicationSchedule();

  assert.equal(payload.version, 2);
  assert.equal(payload.schedule.events[0].id, 'morning');
  assert.equal(payload.doses[`${TODAY}|morning`].taken_at, stamp);
});

test('a dose taken on the other device shows as taken here', () => {
  const app = runApp();
  const stamp = iso(FIXED);

  app.window.applySyncedSchedule({
    version: 2,
    schedule: { version: 1, timezone: 'Europe/London', events: [event()] },
    doses: { [`${TODAY}|morning`]: { taken_at: stamp, updated_at: stamp } },
  });

  assert.match(app.todayList.innerHTML, /Taken/, 'the phone never learned the dose was taken');
});

test('a dose taken here is not wiped by the other device marking a different one', () => {
  const stamp = iso(FIXED);
  const app = runApp({ taken: { [`${TODAY}|morning`]: { taken_at: stamp, updated_at: stamp } } });

  app.window.applySyncedSchedule({
    version: 2,
    schedule: { version: 1, timezone: 'Europe/London', events: [event()] },
    doses: { '2026-07-21|morning': { taken_at: iso(FIXED - 86400000), updated_at: iso(FIXED - 86400000) } },
  });

  assert.ok(app.storedTaken()[`${TODAY}|morning`]?.taken_at, 'this device\'s own take was lost');
  assert.ok(app.storedTaken()['2026-07-21|morning']?.taken_at, 'the remote take was not merged in');
});

test('an undo on the other device clears the take here', () => {
  const stamp = iso(FIXED);
  const app = runApp({ taken: { [`${TODAY}|morning`]: { taken_at: stamp, updated_at: stamp } } });

  app.window.applySyncedSchedule({
    version: 2,
    schedule: { version: 1, timezone: 'Europe/London', events: [event()] },
    doses: { [`${TODAY}|morning`]: { taken_at: null, updated_at: iso(FIXED + 60000) } },
  });

  assert.doesNotMatch(app.todayList.innerHTML, /Taken/, 'the undo did not propagate');
});

test('a stale remote entry does not overwrite a newer local take', () => {
  const stamp = iso(FIXED);
  const app = runApp({ taken: { [`${TODAY}|morning`]: { taken_at: stamp, updated_at: stamp } } });

  app.window.applySyncedSchedule({
    version: 2,
    schedule: { version: 1, timezone: 'Europe/London', events: [event()] },
    doses: { [`${TODAY}|morning`]: { taken_at: null, updated_at: iso(FIXED - 60000) } },
  });

  assert.match(app.todayList.innerHTML, /Taken/, 'a stale undo beat a newer take');
});

test('a payload from a build without dose sync still applies its schedule', () => {
  const app = runApp();

  app.window.applySyncedSchedule({ version: 1, timezone: 'Europe/London', events: [event({ time: '22:00' })] });

  assert.match(app.todayList.innerHTML, /22:00/);
  assert.match(app.todayList.innerHTML, /Upcoming/);
});

test('a legacy numeric taken mark is migrated rather than dropped', () => {
  const app = runApp({ taken: { [`${TODAY}|morning`]: FIXED } });

  assert.match(app.todayList.innerHTML, /Taken/, 'existing local history was lost on upgrade');
  assert.ok(app.window.getMedicationSchedule().doses[`${TODAY}|morning`].taken_at);
});

test('marking a dose taken here queues it for the other device', () => {
  const app = runApp();

  app.markTaken(`${TODAY}|morning`, 'morning');

  assert.match(app.todayList.innerHTML, /Taken/);
  const signal = app.syncSignals.find(event => event.type === 'medication-schedule-changed');
  assert.ok(signal, 'the take was recorded locally but never queued for sync');
  assert.equal(signal.detail?.doseOnly, true,
    'the signal was not tagged dose-only, so the relay notifies the other device');
  assert.ok(app.window.getMedicationSchedule().doses[`${TODAY}|morning`].taken_at);
});

test('undoing a take publishes a tombstone rather than forgetting the dose', () => {
  const stamp = iso(FIXED);
  const app = runApp({ taken: { [`${TODAY}|morning`]: { taken_at: stamp, updated_at: stamp } } });

  app.undoTaken(`${TODAY}|morning`);

  const entry = app.window.getMedicationSchedule().doses[`${TODAY}|morning`];
  assert.ok(entry, 'the record was deleted, so the other device will resurrect the take');
  assert.equal(entry.taken_at, null);
  assert.equal(
    app.syncSignals.find(event => event.type === 'medication-schedule-changed')?.detail?.doseOnly,
    true,
  );
});

test('an untaken dose is still reported by its current time after a sync', () => {
  const app = runApp();
  assert.match(app.todayList.innerHTML, />Overdue</, 'precondition: 08:00 has passed at 09:00');

  app.window.applySyncedSchedule({
    version: 1,
    timezone: 'Europe/London',
    events: [event({ time: '22:00' })],
  });

  assert.match(app.todayList.innerHTML, /Upcoming/);
  assert.doesNotMatch(app.todayList.innerHTML, /Taken/);
});

// F5: a dose that was genuinely missed must survive this device, not be silently
// downgraded to "no record" -- which would let the widget alarm for it again.

test('a dose marked missed on the other device is not shown as taken here', () => {
  const app = runApp();
  const stamp = iso(FIXED);

  app.window.applySyncedSchedule({
    version: 2,
    schedule: { version: 1, timezone: 'Europe/London', events: [event()] },
    doses: { [`${TODAY}|morning`]: { taken_at: null, missed_at: stamp, updated_at: stamp } },
  });

  assert.doesNotMatch(app.todayList.innerHTML, /Taken/, 'a missed dose was rendered as taken');
});

// The reported cross-device symptom: "the widget says taken but the mobile says
// missed". Both devices share one record, so this was never a storage conflict --
// this device INVENTED the miss. With no record at all, the clock alone drove the
// badge to "Missed" the moment the dose time passed, which is indistinguishable
// from a miss the user actually recorded. Absence of evidence is not a miss: until
// a device says otherwise, an unrecorded past dose is only overdue.

test('a dose with no record is overdue, not missed, once its time has passed', () => {
  const app = runApp(); // 08:00 dose, 09:00 clock, nothing recorded

  assert.match(app.todayList.innerHTML, />Overdue</,
    'an unrecorded dose past its time must not claim to be missed');
});

test('a recorded miss is distinguishable from a dose that simply has no record', () => {
  const stamp = iso(FIXED);
  const recorded = runApp({
    taken: { [`${TODAY}|morning`]: { taken_at: null, missed_at: stamp, updated_at: stamp } },
  });
  const unrecorded = runApp();

  // The badge specifically, not the whole card: the two already differ by their
  // buttons, so comparing innerHTML passes without the badge ever being fixed.
  assert.equal(badge(recorded), 'Missed', 'a miss the user recorded must still read as Missed');
  assert.notEqual(
    badge(unrecorded), badge(recorded),
    'a recorded miss and an absent record show the same badge -- the whole defect',
  );
});

test('an overdue dose can still be resolved either way', () => {
  const app = runApp();

  assert.match(app.todayList.innerHTML, /data-taken=/, 'overdue must still offer Mark taken');
  assert.match(app.todayList.innerHTML, /data-missed=/, 'overdue must still offer Mark missed');
});

test('an overdue dose that the other device marks taken stops being overdue', () => {
  const app = runApp();
  const stamp = iso(FIXED);
  assert.match(app.todayList.innerHTML, />Overdue</, 'precondition: nothing recorded yet');

  // Exactly the reported case: the widget recorded the take, and it lands here.
  app.window.applySyncedSchedule({
    version: 2,
    schedule: { version: 1, timezone: 'Europe/London', events: [event()] },
    doses: { [`${TODAY}|morning`]: { taken_at: stamp, missed_at: null, updated_at: stamp } },
  });

  assert.match(app.todayList.innerHTML, />Taken</, 'the widget take must win over this clock');
  assert.doesNotMatch(app.todayList.innerHTML, />Overdue</);
});

test('a missed mark survives a round trip through this device', () => {
  const stamp = iso(FIXED);
  const app = runApp();

  app.window.applySyncedSchedule({
    version: 2,
    schedule: { version: 1, timezone: 'Europe/London', events: [event()] },
    doses: { [`${TODAY}|morning`]: { taken_at: null, missed_at: stamp, updated_at: stamp } },
  });
  const republished = app.window.getMedicationSchedule().doses[`${TODAY}|morning`];

  assert.equal(republished.missed_at, stamp, 'this device stripped missed_at and destroyed the record');
  assert.equal(republished.taken_at, null);
});

test('a later take overrides an earlier missed mark', () => {
  const missedAt = iso(FIXED);
  const app = runApp({ taken: { [`${TODAY}|morning`]: { taken_at: null, missed_at: missedAt, updated_at: missedAt } } });
  const takenAt = iso(FIXED + 60000);

  app.window.mergeRemoteDoses({ [`${TODAY}|morning`]: { taken_at: takenAt, missed_at: null, updated_at: takenAt } });

  const entry = app.storedTaken()[`${TODAY}|morning`];
  assert.equal(entry.taken_at, takenAt);
  assert.equal(entry.missed_at, null);
});

test('a later missed mark overrides an earlier take', () => {
  const takenAt = iso(FIXED);
  const app = runApp({ taken: { [`${TODAY}|morning`]: { taken_at: takenAt, updated_at: takenAt } } });
  const missedAt = iso(FIXED + 60000);

  app.window.mergeRemoteDoses({ [`${TODAY}|morning`]: { taken_at: null, missed_at: missedAt, updated_at: missedAt } });

  const entry = app.storedTaken()[`${TODAY}|morning`];
  assert.equal(entry.taken_at, null);
  assert.equal(entry.missed_at, missedAt);
});

test('marking a dose missed here records it and queues it for the other device', () => {
  const app = runApp();

  app.markMissed(`${TODAY}|morning`, 'morning');

  const entry = app.window.getMedicationSchedule().doses[`${TODAY}|morning`];
  assert.ok(entry, 'nothing was recorded, so the other device learns nothing');
  assert.equal(entry.taken_at, null, 'a missed dose must never be recorded as taken');
  assert.ok(entry.missed_at, 'no missed_at stamp was written');
  assert.equal(
    app.syncSignals.find(e => e.type === 'medication-schedule-changed')?.detail?.doseOnly,
    true,
    'the missed mark was not queued as a dose-only push',
  );
});

test('a recorded missed dose offers an undo rather than another mark-missed', () => {
  const stamp = iso(FIXED);
  const app = runApp({ taken: { [`${TODAY}|morning`]: { taken_at: null, missed_at: stamp, updated_at: stamp } } });

  assert.match(app.todayList.innerHTML, /data-undo-taken/,
    'a recorded missed dose gave the user no way to correct it');
});

// The core complaint: without a recorded miss the only way to silence a reminder
// was to claim the dose. A recorded miss must actually stop the prompt.
const DUE_AT = new Date(2026, 6, 22, 8, 0, 0).getTime();

test('a dose already marked missed does not re-open the due prompt', () => {
  const stamp = iso(FIXED);
  const app = runApp({
    taken: { [`${TODAY}|morning`]: { taken_at: null, missed_at: stamp, updated_at: stamp } },
    search: `?dueAt=${DUE_AT}`,
  });

  assert.equal(app.dueDialog.open, false,
    'a dose the user already marked missed prompted them again');
});

test('an unresolved dose still opens the due prompt', () => {
  // Control: proves the test above is not passing simply because the prompt never opens.
  const app = runApp({ search: `?dueAt=${DUE_AT}` });

  assert.equal(app.dueDialog.open, true,
    'precondition failed: the due prompt never opens, so the missed test proves nothing');
});

// First run. A stranger's entry point is this browser, and until now an empty
// account showed "No schedules yet. Add your first reminder." and nothing else:
// no indication that pairing a phone is the next step, or that it should come
// after there is something to pair. The owner never saw this screen, because the
// owner has had a schedule since before any of it was written.
test('an empty account is told what to do, in order', () => {
  const app = runApp({ events: [] });
  const html = app.scheduleList.innerHTML;
  assert.match(html, /first reminder/i, 'step one is having something to be reminded about');
  // Assert the STEP, not just the word: an earlier version matched /phone|mobile/
  // and survived deleting the pairing step entirely, because "Pair mobile" still
  // appeared in the surrounding prose.
  assert.match(html, /pair your phone/i, 'pairing a phone must be an explicit step, not an aside');
  assert.match(html, /getting-started/, 'the guidance should be a distinct block, not a bare sentence');
});

test('the guidance disappears once there is a schedule', () => {
  // Onboarding that keeps talking after you have onboarded is just noise.
  const app = runApp({ events: [event()] });
  assert.doesNotMatch(app.scheduleList.innerHTML, /getting-started/,
    'a set-up account must not keep being told how to set up');
});

test("today's empty state points somewhere useful instead of dead-ending", () => {
  const app = runApp({ events: [] });
  assert.match(app.todayList.innerHTML, /schedule/i,
    'an empty day should say where reminders come from');
});
