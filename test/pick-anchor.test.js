import test from 'node:test';
import assert from 'node:assert/strict';
import { valuePlayer, pickValue, settingsFor } from '../src/analysis/valuation.js';
const settings = settingsFor({ mode: 'dynasty' });
const rookie = {
  id: 'synthetic-rookie',
  position: 'RB',
  age: 21,
  experience: 0,
  draftYear: 2026,
  draftRound: 1,
  draftPick: 8,
  rookieDraft: { overall: 1, teams: 12, season: 2026, verified: true },
};
const slow = Array.from({ length: 4 }, () => ({
  position: 'RB',
  carries: 5,
  targets: 1,
  receptions: 1,
  rushing_yards: 15,
  receiving_yards: 5,
}));
test('a slow rookie 1.01 equals 90% of next years 1.01 on the same pick curve', () => {
  const player = valuePlayer(rookie, slow, settings, 2026);
  const pick = pickValue({ round: 1, year: 2027 }, settings, 2026, 'first');
  assert.equal(pick, 1050);
  assert.equal(player.dynasty, Math.round(pick * 0.9));
  assert.equal(player.pickAnchor.discount, 0.1);
  assert.equal(player.pickAnchor.year, 2027);
  assert.equal(valuePlayer(rookie, [], settings, 2026).dynasty, pick);
});
test('the owner-supplied Love benchmark works when Sleeper has no rookie selection', () => {
  const p = valuePlayer({ ...rookie, id: '13287', rookieDraft: null }, slow, settings, 2026);
  assert.equal(p.dynasty, 945);
  assert.match(p.pickAnchor.source, /Owner-supplied/);
  assert.equal(p.prospect.rookieDraft.verified, undefined);
  assert.equal(
    valuePlayer({ ...rookie, id: 'unranked', rookieDraft: null }, slow, settings, 2026).pickAnchor,
    null,
  );
});
test('pick anchor respects league size and superflex without changing redraft or scoring pace', () => {
  for (const teams of [10, 12, 14])
    for (const superflex of [false, true]) {
      const s = { ...settings, superflex };
      const r = valuePlayer(
        { ...rookie, rookieDraft: { ...rookie.rookieDraft, teams } },
        slow,
        s,
        2026,
      );
      assert.equal(
        r.dynasty,
        Math.round(pickValue({ round: 1, year: 2027, teams }, s, 2026, 'first') * 0.9),
      );
      const unanchored = valuePlayer({ ...rookie, rookieDraft: null }, slow, s, 2026);
      assert.equal(r.redraft, unanchored.redraft);
      assert.equal(r.pace, unanchored.pace);
      assert.equal(valuePlayer(rookie, slow, { ...s, mode: 'redraft' }, 2026).value, r.redraft);
    }
});
test('sustained poor play reduces the anchor and a breakout can exceed it', () => {
  const full = valuePlayer(
    rookie,
    Array.from({ length: 17 }, () => slow[0]),
    settings,
    2026,
  );
  assert.equal(full.pickAnchor.discount, 0.35);
  assert.ok(full.dynasty < valuePlayer(rookie, slow, settings, 2026).dynasty);
  const breakout = valuePlayer(
    rookie,
    slow.map((r) => ({ ...r, carries: 25, rushing_yards: 180, rushing_tds: 3 })),
    settings,
    2026,
  );
  assert.ok(breakout.dynasty > breakout.pickAnchor.pickValue);
  for (const p of [
    { ...rookie, rookieDraft: { ...rookie.rookieDraft, verified: false } },
    { ...rookie, draftYear: 2025, experience: 1 },
    { ...rookie, rookieDraft: null },
  ])
    assert.equal(valuePlayer(p, slow, settings, 2026).pickAnchor, null);
});
