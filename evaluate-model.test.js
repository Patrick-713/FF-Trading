import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateModel } from './evaluate-model.js';
test('versioned archetype evaluation passes behavioral checks without claiming predictive accuracy', () => {
  const r = evaluateModel();
  assert.equal(r.passed, true);
  assert.equal(r.cases.length, 10);
  assert.equal(r.checks.length, 9);
  assert.equal(r.rookiePickExample.rookieValue, 945);
  assert.equal(r.modelVersion, '2.5.0');
  assert.match(r.evaluationType, /not predictive/);
});
