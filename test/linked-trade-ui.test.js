import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFantasy } from '../src/analysis/fantasy.js';
import { analyzeTrade } from '../src/analysis/trade-engine.js';

test('linked search preserves mixed-roster selections and expanded roster lists', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('guest');");
  const model = await createFantasy(db).model('guest', null, {}, {});
  const elements = new Map(),
    handlers = {};
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: '',
        textContent: '',
        value: '',
        classList: { add() {}, remove() {}, toggle() {} },
        close() {},
        showModal() {},
      });
    return elements.get(selector);
  };
  const originalFetch = globalThis.fetch,
    originalTimeout = globalThis.setTimeout,
    timers = [];
  globalThis.setTimeout = (fn, ms) => {
    const timer = originalTimeout(fn, ms);
    timer.unref();
    timers.push(timer);
    return timer;
  };
  model.linked = true;
  model.settings.mode = 'dynasty';
  model.teams.push({ id: 'third', name: 'Third roster' });
  model.players.find((p) => p.id === 'demo_0').owner = 'third';
  const rosterNode = { dataset: { rosterSide: 'A' }, open: true };
  globalThis.document = {
    querySelector: element,
    querySelectorAll: (selector) => (selector === '[data-roster-side]' ? [rosterNode] : []),
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
  };
  globalThis.addEventListener = (type, fn) => {
    handlers[type] = fn;
  };
  let lastInput;
  globalThis.fetch = async (path, options = {}) => {
    const input = options.body ? JSON.parse(options.body) : {};
    let data;
    if (path === '/api/state')
      data = {
        user: null,
        connection: {
          user: { username: 'TestManager' },
          league: { name: 'Test league', season: 2026 },
          syncedAt: new Date().toISOString(),
        },
        preferences: {},
      };
    else if (path === '/api/analysis') data = model;
    else if (path === '/api/analysis/trade') {
      lastInput = input;
      data = analyzeTrade(model, input);
    } else throw new Error('Unexpected request ' + path);
    return { ok: true, json: async () => structuredClone(data) };
  };
  const click = (selector, dataset = {}) =>
    handlers.click({
      target: { closest: (s) => (s.split(',').includes(selector) ? { dataset } : null) },
    });
  try {
    await import('../public/app.js?linked-search-controls');
    await click('button[data-view]', { view: 'trade' });
    const change = (target) => handlers.change({ target: { matches: () => false, ...target } });
    await click('[data-add-side]', { asset: 'demo_3', addSide: 'A' });
    await click('[data-add-side]', { asset: 'demo_7', addSide: 'B' });
    await change({
      dataset: { side: 'A' },
      value: 'demo_1',
      checked: true,
      matches: (selector) => selector === '[data-side]',
    });
    assert.ok(element('#main').innerHTML.includes('data-roster-side="A" open'));
    await click('[data-add-side]', { asset: 'demo_0', addSide: 'A' });
    await click('#analyze-trade');
    assert.equal(lastInput.customTeams, true);
    assert.deepEqual(lastInput.sendA, ['demo_3', 'demo_1', 'demo_0']);
    assert.deepEqual(lastInput.sendB, ['demo_7']);
    await change({ id: 'trade-team', value: 'third' });
    await click('#analyze-trade');
    assert.deepEqual(lastInput.sendA, ['demo_3', 'demo_1', 'demo_0']);
    await click('[data-add-side]', { asset: 'demo_1', addSide: 'B' });
    await click('#analyze-trade');
    assert.deepEqual(lastInput.sendA, ['demo_3', 'demo_0']);
    assert.deepEqual(lastInput.sendB, ['demo_7', 'demo_1']);
    assert.ok(element('#trade-result').innerHTML.includes('using dynasty values'));
    await change({
      dataset: { side: 'A' },
      value: 'demo_1',
      checked: true,
      matches: (selector) => selector === '[data-side]',
    });
    await click('#analyze-trade');
    assert.deepEqual(lastInput.sendA, ['demo_3', 'demo_0', 'demo_1']);
    assert.deepEqual(lastInput.sendB, ['demo_7']);
    await change({ id: 'custom-trade-mode', value: 'redraft' });
    await click('#analyze-trade');
    assert.equal(lastInput.comparisonMode, 'redraft');
    assert.equal(model.settings.mode, 'dynasty');
    assert.ok(element('#trade-result').innerHTML.includes('using redraft values'));
    assert.ok(
      element('#trade-result').innerHTML.includes(
        model.players.find((p) => p.id === 'demo_3').name,
      ),
    );
    await change({ id: 'custom-trade-mode', value: 'dynasty' });
    await click('#analyze-trade');
    assert.equal(lastInput.comparisonMode, 'dynasty');
    await change({ id: 'trade-comparison', value: 'league' });
    assert.equal(element('#main').innerHTML.includes('id="custom-trade-mode"'), false);
    assert.equal(model.players.find((p) => p.id === 'demo_0').owner, 'third');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    globalThis.setTimeout = originalTimeout;
    globalThis.fetch = originalFetch;
    delete globalThis.document;
    delete globalThis.addEventListener;
    db.close();
  }
});
