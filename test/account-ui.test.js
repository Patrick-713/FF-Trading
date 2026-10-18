import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFantasy } from '../src/analysis/fantasy.js';

test('Account has three accessible sections, Info for signed-in users and a separate working sign-out', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('test');");
  const model = await createFantasy(db).model('test', null, {}, {});
  let user = { name: 'Test Manager', email: 'test@example.test', emailVerified: true },
    loggedOut = false,
    focused = '';
  const handlers = {},
    elements = new Map(),
    timers = [];
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: '',
        textContent: '',
        value: '',
        classList: { add() {}, remove() {}, toggle() {} },
        close() {},
        focus() {
          focused = selector;
        },
      });
    return elements.get(selector);
  };
  const originalFetch = globalThis.fetch,
    originalTimeout = globalThis.setTimeout;
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
  globalThis.fetch = async (path) => {
    let data;
    if (path === '/api/state') data = { user, connection: null, preferences: {} };
    else if (path === '/api/analysis') data = model;
    else if (path === '/api/auth/logout') {
      user = null;
      loggedOut = true;
      data = { ok: true };
    } else throw new Error(path);
    return { ok: true, json: async () => structuredClone(data) };
  };
  const click = (selector, dataset = {}) =>
    handlers.click({
      target: { closest: (s) => (s.split(',').includes(selector) ? { dataset } : null) },
    });
  try {
    await import('../public/app.js?account-sections');
    await click('button[data-view]', { view: 'account' });
    assert.ok(element('#main').innerHTML.includes('>Info</button>'));
    assert.ok(element('#main').innerHTML.includes('test@example.test'));
    assert.equal((element('#main').innerHTML.match(/id="logout"/g) || []).length, 1);
    assert.equal(element('#main').innerHTML.includes('id="auth-form"'), false);
    handlers.keydown({ key: 'ArrowRight', preventDefault() {}, target: { closest: () => ({}) } });
    assert.ok(element('#main').innerHTML.includes('id="sleeper-lookup"'));
    assert.equal(focused, '#account-tab-sleeper');
    handlers.keydown({ key: 'End', preventDefault() {}, target: { closest: () => ({}) } });
    assert.ok(element('#main').innerHTML.includes('Saved Notes'));
    assert.equal(focused, '#account-tab-saved');
    await click('#logout');
    assert.equal(loggedOut, true);
    assert.ok(element('#main').innerHTML.includes('>Log in</button>'));
    assert.ok(element('#main').innerHTML.includes('id="auth-form"'));
    assert.equal(element('#main').innerHTML.includes('id="logout"'), false);
    await click('[data-auth-mode]', { authMode: 'register' });
    assert.ok(element('#main').innerHTML.includes('Create account'));
  } finally {
    for (const timer of timers) clearTimeout(timer);
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
    delete globalThis.document;
    delete globalThis.addEventListener;
    db.close();
  }
});
