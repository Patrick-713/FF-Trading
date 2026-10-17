// Exercise the actual event handlers without a preview server or a browser process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFantasy } from './fantasy.js';
import { analyzeTrade, findTrades } from './trade-engine.js';

test('builder supports player search, assumptions, analysis, finder and loading saved selections offline', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('guest');");
  const fantasy = createFantasy(db);
  let model = await fantasy.model('guest', null, {}, {}),
    lastInput;
  const handlers = {},
    elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: '',
        textContent: '',
        value: '',
        isConnected: true,
        classList: { add() {}, remove() {}, toggle() {} },
        showModal() {},
        close() {},
      });
    return elements.get(selector);
  };
  globalThis.document = {
    querySelector: element,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => (handlers[type] = fn),
  };
  globalThis.fetch = async (path, options = {}) => {
    const input = options.body ? JSON.parse(options.body) : {};
    let data;
    if (path === '/api/state')
      data = {
        connection: {
          user: { username: '<TestManager>' },
          league: { name: 'Test league', season: 2026 },
          syncedAt: new Date().toISOString(),
        },
        user: null,
      };
    else if (path === '/api/analysis') data = model;
    else if (path === '/api/analysis/settings') {
      model = await fantasy.model('guest', null, {}, input);
      data = model;
    } else if (path === '/api/analysis/trade') {
      lastInput = input;
      data = analyzeTrade(model, input);
    } else if (path === '/api/analysis/find') data = findTrades(model, input);
    else if (path === '/api/analysis/save') {
      model.saved = [
        {
          id: 'saved',
          title: input.title,
          created: new Date().toISOString(),
          input,
          result: analyzeTrade(model, input),
        },
      ];
      data = model;
    } else throw new Error('Unexpected request ' + path);
    return { ok: true, json: async () => structuredClone(data) };
  };
  // Avoid toast timers keeping the test alive; production timers are unchanged.
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    const timer = realTimeout(fn, ms);
    timer.unref();
    return timer;
  };
  const click = async (selector, dataset = {}) =>
    handlers.click({
      target: {
        closest: (s) => {
          // Match the real root attribute: every descendant has a data-view ancestor.
          if (s === '[data-view]') return { dataset: { view: 'account' } };
          return s.split(',').includes(selector) ? { dataset } : null;
        },
      },
    });
  const change = async (target) => handlers.change({ target: { matches: () => false, ...target } });
  try {
    await import('./public/app.js');
    assert.ok(element('#main').innerHTML.includes('Know what your roster'));
    await click('button[data-view]', { view: 'account' });
    assert.ok(element('#main').innerHTML.includes('id="sleeper-lookup"'));
    assert.equal((element('#main').innerHTML.match(/id="favorite-team"/g) || []).length, 1);
    assert.equal(element('#sleeper-status').textContent, 'Sleeper linked � <TestManager>');
    assert.equal(element('#sleeper-status').hidden, false);
    await click('[data-auth-mode]', { authMode: 'login' });
    assert.ok(element('#main').innerHTML.includes('Welcome back'));
    const loginMarkup = element('#main').innerHTML;
    await click('input');
    assert.equal(element('#main').innerHTML, loginMarkup);
    await click('[data-auth-mode]', { authMode: 'register' });
    assert.ok(element('#main').innerHTML.includes('Create account'));
    await click('button[data-view]', { view: 'trade' });
    assert.ok(element('#main').innerHTML.includes('trade-search'));
    handlers.input({ target: { id: 'trade-search', value: 'Leo' } });
    assert.ok(element('#trade-search-results').innerHTML.includes('Leo Walker'));
    await click('[data-trade-player]', { tradePlayer: 'demo_7' });
    await click('[data-trade-player]', { tradePlayer: 'demo_3' });
    assert.ok(element('#main').innerHTML.includes('Dynasty development'));
    await change({
      id: '',
      dataset: { asset: 'demo_7', assumption: 'workload' },
      value: '0.85',
      matches: (s) => s === '[data-assumption]',
    });
    await change({ id: 'include-waivers', checked: false });
    await click('#analyze-trade');
    assert.deepEqual(lastInput.sendB, ['demo_7']);
    assert.deepEqual(lastInput.sendA, ['demo_3']);
    assert.equal(lastInput.assumptions.demo_7.workload, 0.85);
    assert.equal(lastInput.includeWaivers, false);
    assert.ok(element('#trade-result').innerHTML.includes('How sensitive is this trade?'));
    element('#scenario-title').value = 'Offline trade';
    await click('#save-scenario');
    await click('#clear-trade');
    await click('[data-load]', { load: 'saved' });
    await click('#analyze-trade');
    assert.equal(lastInput.assumptions.demo_7.workload, 0.85);
    assert.equal(lastInput.includeWaivers, false);
    await click('#open-finder');
    assert.ok(element('#main').innerHTML.includes('Find your next move'));
    await click('#find-trades');
    assert.ok(element('#main').innerHTML.includes('candidate offers'));
    await click('[data-mode]', { mode: 'dynasty' });
    await click('button[data-view]', { view: 'trade' });
    assert.ok(element('#main').innerHTML.includes('PICK'));
  } finally {
    globalThis.setTimeout = realTimeout;
    delete globalThis.document;
    delete globalThis.fetch;
    db.close();
  }
});
