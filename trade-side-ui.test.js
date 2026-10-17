import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFantasy } from './fantasy.js';
import { analyzeTrade } from './trade-engine.js';

test('public side controls add, move, deduplicate and remove players regardless of example ownership', async () => {
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
  globalThis.document = {
    querySelector: element,
    querySelectorAll: () => [],
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
    if (path === '/api/state') data = { user: null, connection: null, preferences: {} };
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
    await import('./public/app.js?public-side-controls');
    await click('button[data-view]', { view: 'trade' });
    assert.equal(element('#main').innerHTML.includes('id="trade-team"'), false);
    assert.ok(element('#main').innerHTML.includes('data-add-side="A"'));
    assert.ok(element('#main').innerHTML.includes('data-add-side="B"'));
    await click('[data-add-side]', { asset: 'demo_7', addSide: 'A' });
    await click('[data-add-side]', { asset: 'demo_3', addSide: 'B' });
    await click('#analyze-trade');
    assert.equal(lastInput.customTeams, true);
    assert.deepEqual(lastInput.sendA, ['demo_7']);
    assert.deepEqual(lastInput.sendB, ['demo_3']);
    await click('[data-add-side]', { asset: 'demo_7', addSide: 'B' });
    await click('[data-add-side]', { asset: 'demo_0', addSide: 'A' });
    await click('[data-add-side]', { asset: 'demo_7', addSide: 'B' });
    await click('#analyze-trade');
    assert.deepEqual(lastInput.sendA, ['demo_0']);
    assert.deepEqual(lastInput.sendB, ['demo_3', 'demo_7']);
    await click('[data-remove-asset]', { removeAsset: 'demo_7' });
    await click('#analyze-trade');
    assert.deepEqual(lastInput.sendB, ['demo_3']);
    assert.equal(model.players.find((p) => p.id === 'demo_7').owner, 'demo_b');
  } finally {
    for (const timer of timers) clearTimeout(timer);
    globalThis.setTimeout = originalTimeout;
    globalThis.fetch = originalFetch;
    delete globalThis.document;
    delete globalThis.addEventListener;
    db.close();
  }
});
