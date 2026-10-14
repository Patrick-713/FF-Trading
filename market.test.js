import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRoster, validateRoster, tradeAmounts, nextPrice } from './market.js';
test('buy and sell conserve credits and shares', () => {
  const buy = tradeAmounts('buy', 5, 12450, 100000, 2);
  assert.deepEqual(buy, { total: 62250, cash: 37750, shares: 7 });
  assert.equal(tradeAmounts('sell', 5, 12450, buy.cash, buy.shares).cash, 100000);
});
test('invalid and unaffordable orders are rejected', () => {
  for (const qty of [0, -1, 1.5, 10001, '2']) assert.throws(() => tradeAmounts('buy', qty, 100, 10000, 0));
  assert.throws(() => tradeAmounts('buy', 2, 100, 100, 0));
  assert.throws(() => tradeAmounts('sell', 2, 100, 100, 1));
});
test('roster enforces unique players and correct positions', () => {
  assert.deepEqual(validateRoster(initialRoster), initialRoster);
  assert.throws(() => validateRoster(Array(7).fill('qb1')));
  assert.throws(() => validateRoster(['wr3', ...initialRoster.slice(1)]));
});
test('valuation rewards performance and caps weekly volatility', () => {
  assert.equal(nextPrice(10000, 120), 10000);
  assert.equal(nextPrice(10000, 180), 11200);
  assert.equal(nextPrice(10000, 0), 8800);
});
