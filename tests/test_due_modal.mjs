import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('PWA due reminder opens a modal with one safe list row per medication', () => {
  const dialog = {
    open: false,
    showCount: 0,
    closeCount: 0,
    showModal() { this.open = true; this.showCount += 1; },
    close() { this.open = false; this.closeCount += 1; },
  };
  const title = { textContent: '' };
  const time = { textContent: '' };
  const instructions = { textContent: '' };
  const list = { children: [], replaceChildren(...children) { this.children = children; } };
  const window = {};
  const context = {
    window,
    document: { createElement: tagName => ({ tagName, textContent: '' }) },
  };
  vm.runInNewContext(readFileSync('web/due-modal.js', 'utf8'), context);
  const modal = window.createMedicationDueModal({ dialog, title, time, list, instructions });

  modal.show({
    label: 'Breakfast medicines',
    time: '08:00',
    medicines: ['Medicine A', '<img src=x onerror=alert(1)>', 'Medicine C'],
    instructions: 'Take with food.',
  });

  assert.equal(dialog.showCount, 1);
  assert.equal(title.textContent, 'Breakfast medicines');
  assert.equal(time.textContent, '08:00');
  assert.equal(instructions.textContent, 'Take with food.');
  assert.deepEqual(list.children.map(row => row.tagName), ['li', 'li', 'li']);
  assert.deepEqual(list.children.map(row => row.textContent), ['Medicine A', '<img src=x onerror=alert(1)>', 'Medicine C']);
  modal.close();
  assert.equal(dialog.closeCount, 1);
});

test('notification taps route the private due timestamp back to local modal data', () => {
  const serviceWorker = readFileSync('web/sw.js', 'utf8');
  const worker = readFileSync('worker/src/index.js', 'utf8');
  assert.match(serviceWorker, /dueAt/);
  assert.match(serviceWorker, /\/\?dueAt=/);
  assert.match(worker, /dueAt: Number\(item\.dueAt\)/);
  assert.doesNotMatch(worker, /item\.medicines/);
});

test('Windows reminder is modal and creates one visible label for every medicine', () => {
  const widget = readFileSync('medication_reminder.py', 'utf8');
  assert.match(widget, /popup\.grab_set\(\)/);
  assert.match(widget, /for item in occurrence\.medicines:/);
  assert.match(widget, /text=f"•  \{item\}"/);
  assert.match(widget, /popup\.grab_release\(\)/);
});
