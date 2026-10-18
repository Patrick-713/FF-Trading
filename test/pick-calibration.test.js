import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickValue, settingsFor, valuePlayer } from '../src/analysis/valuation.js';
import { analyzeTrade } from '../src/analysis/trade-engine.js';
const demo = JSON.parse(
  readFileSync(new URL('../resources/demo-data.json', import.meta.url), 'utf8'),
);

test('Chase benchmark compares with three mid firsts across the next three drafts, not one', () => {
  const source = demo.players.find((p) => p.name === "Ja'Marr Chase");
  assert.ok(source, 'The dated public calibration input must contain Chase');
  const player = {
    ...source,
    owner: 'a',
    age: Math.floor((new Date(demo.asOf) - new Date(source.birth)) / (365.2425 * 86400000)),
  };
  const rows = demo.rows.filter((r) => r.player_id === source.gsis);
  for (const superflex of [false, true]) {
    const settings = settingsFor({ mode: 'dynasty', superflex });
    const chase = valuePlayer(player, rows, settings, demo.season);
    const picks = [1, 2, 3].map((offset) => {
      const p = {
        id: 'first-' + offset,
        kind: 'pick',
        owner: 'b',
        round: 1,
        year: demo.season + offset,
      };
      return { ...p, value: pickValue(p, settings, demo.season) };
    });
    const total = picks.reduce((n, p) => n + p.value, 0);
    assert.ok(
      picks[0].value < chase.value / 2,
      'One generic first must not match an elite established WR',
    );
    assert.ok(
      total / chase.value >= 0.85 && total / chase.value <= 1.15,
      'Three mixed-year mid firsts should be near the reference player',
    );
    const model = {
      settings,
      season: demo.season,
      players: [chase],
      picks,
      slots: ['WR'],
      teams: [
        { id: 'a', name: 'Star', rosterLimit: null },
        { id: 'b', name: 'Picks', rosterLimit: null },
      ],
      data: { productionAvailable: true },
    };
    const result = analyzeTrade(model, {
      teamA: 'a',
      teamB: 'b',
      sendA: [chase.id],
      sendB: picks.map((p) => p.id),
      includeWaivers: false,
    });
    assert.equal(result.verdict, 'Balanced');
    const one = analyzeTrade(model, {
      teamA: 'a',
      teamB: 'b',
      sendA: [chase.id],
      sendB: [picks[0].id],
      includeWaivers: false,
    });
    assert.equal(one.verdict, 'Favors partner');
  }
});
test('the entire pick curve decreases by slot, round and distance while redraft stays zero', () => {
  for (const teams of [10, 12, 14])
    for (const superflex of [false, true]) {
      const settings = settingsFor({ mode: 'dynasty', superflex });
      const values = Array.from({ length: teams * 5 }, (_, i) =>
        pickValue(
          { overall: i + 1, round: Math.floor(i / teams) + 1, teams, year: 2027 },
          settings,
          2026,
        ),
      );
      assert.ok(values.every((v, i) => Number.isFinite(v) && v > 0 && (!i || v <= values[i - 1])));
      const pick = { round: 1, teams, year: 2027 };
      assert.ok(pickValue(pick, settings, 2026, 'early') > pickValue(pick, settings, 2026));
      assert.ok(pickValue(pick, settings, 2026) > pickValue(pick, settings, 2026, 'late'));
      assert.ok(
        pickValue(pick, settings, 2026) > pickValue({ ...pick, year: 2028 }, settings, 2026),
      );
      assert.equal(pickValue(pick, { ...settings, mode: 'redraft' }, 2026), 0);
    }
});
