import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('site templates avoid double hyphens and long dash punctuation', () => {
  for (const file of [
    'public/index.html',
    'public/app.js',
    'public/trade-tools.js',
    'public/player-profile.js',
  ]) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.equal(/\u2013|\u2014/.test(source), false, file + ' contains long dash punctuation');
    assert.equal(
      source.includes(String.fromCharCode(0xfffd)),
      false,
      file + ' contains a broken character',
    );
    assert.equal(source.includes('-'.repeat(2)), false, file + ' contains a double hyphen');
  }
});
