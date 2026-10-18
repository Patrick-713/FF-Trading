import test from 'node:test';
import assert from 'node:assert/strict';
import {
  valuePlayer,
  settingsFor,
  pickValue,
  playerGameLog,
  lineupPace,
} from '../src/analysis/valuation.js';
const settings = settingsFor({ mode: 'dynasty' });
const player = { id: 'k', position: 'K', age: 24, experience: 3 };
const rows = (fg, pat = 2, count = 8) =>
  Array.from({ length: count }, (_, i) => ({
    week: i + 1,
    position: 'K',
    fg_made: fg,
    pat_made: pat,
  }));
test('kicker values stay in third-round territory even with extreme scoring or rookie metadata', () => {
  const ceiling = pickValue({ round: 3, teams: 12, year: 2027 }, settings, 2026);
  for (const superflex of [false, true]) {
    for (const metadata of [
      { age: 40 },
      {
        age: 21,
        experience: 0,
        draftYear: 2026,
        draftRound: 1,
        draftPick: 1,
        rookieDraft: { verified: true, overall: 1, teams: 12, season: 2026 },
      },
    ]) {
      const value = valuePlayer(
        { ...player, ...metadata },
        rows(10),
        { ...settings, superflex },
        2026,
      );
      assert.equal(value.redraft, ceiling);
      assert.equal(value.dynasty, Math.round(ceiling * 0.9));
      assert.equal(value.prospect, null);
      assert.equal(value.pickAnchor, null);
      assert.equal(value.breakdown.tradeValueCeiling, ceiling);
    }
  }
});
test('kicker scoring, logs and lineup pace retain actual fantasy production', () => {
  const weekly = rows(3);
  const value = valuePlayer(player, weekly, settings, 2026);
  assert.equal(value.stats.ppg, 11);
  assert.equal(value.pace, 11);
  assert.equal(playerGameLog(player, weekly, settings, 2026)[0].points, 11);
  assert.equal(lineupPace([value], ['K']), 11);
  assert.equal(value.redraft, 75);
  assert.equal(value.dynasty, 68);
  const receiver = valuePlayer(
    { id: 'wr', position: 'WR', age: 24 },
    weekly.map((r) => ({ week: r.week, receptions: 5, receiving_yards: 60, targets: 8 })),
    settings,
    2026,
  );
  assert.ok(receiver.dynasty > value.dynasty * 3);
});
test('kicker injury and sample uncertainty lower trade value without inventing prospect upside', () => {
  const healthy = valuePlayer(player, rows(3), settings, 2026);
  const injured = valuePlayer({ ...player, injury: 'Out' }, rows(3), settings, 2026);
  const small = valuePlayer(player, rows(3, 2, 1), settings, 2026);
  const unknown = valuePlayer(player, [], settings, 2026);
  assert.ok(injured.dynasty < healthy.dynasty);
  assert.ok(small.dynasty < healthy.dynasty);
  assert.equal(unknown.dynasty, 10);
  assert.equal(injured.stats.ppg, healthy.stats.ppg);
});
