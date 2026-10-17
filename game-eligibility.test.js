import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { valuePlayer, settingsFor } from './valuation.js';
import { compactRows, summarizeHistory } from './stat-inputs.js';
import { eligibleGames } from './game-eligibility.js';

const settings = settingsFor();
const player = { id: 'test', position: 'QB', age: 28, experience: 6, draftRound: 1 };
const game = (week, extra = {}) => ({
  player_id: 'test',
  position: 'QB',
  week,
  season: 2026,
  passing_yards: 250,
  attempts: 30,
  passing_tds: 2,
  ...extra,
});
const evidence =
  'https://www.vikings.com/news/kyler-murray-quarterback-injury-concussion-evaluation-week-1-packers';

test('confirmed injury games and DNP rows leave all production metrics, without mutating raw stats', () => {
  const healthy = [game(1), game(4)];
  // A positive injury game must also be excluded: this is not a low-score filter.
  const rows = [
    healthy[0],
    game(2, {
      passing_yards: 400,
      game_participation: 'injury_exit',
      game_evidence_source: evidence,
    }),
    game(3, { game_participation: 'did_not_play', passing_yards: 0, passing_tds: 0, attempts: 0 }),
    healthy[1],
  ];
  const original = structuredClone(rows);
  const actual = valuePlayer(player, rows, settings, 2026);
  const expected = valuePlayer(player, healthy, settings, 2026);
  assert.equal(actual.games, 2);
  assert.deepEqual(actual.stats, expected.stats);
  assert.deepEqual(actual.breakdown, expected.breakdown);
  assert.equal(actual.redraft, expected.redraft);
  assert.equal(actual.pace, expected.pace);
  assert.equal(actual.gameSample.excluded.length, 2);
  assert.deepEqual(rows, original);
});

test('zero points, low workload, and current injury status cannot erase a completed game', () => {
  const rows = [game(1, { passing_yards: 0, passing_tds: 0, attempts: 1 }), game(2)];
  assert.equal(valuePlayer({ ...player, injury: 'Out' }, rows, settings, 2026).games, 2);
  assert.equal(
    eligibleGames([game(1, { game_participation: 'injury_exit' })], player, 2026).included.length,
    1,
  );
});

test('compaction and historical summaries retain and apply sourced exclusions', () => {
  const rows = [
    game(1),
    game(2, { game_participation: 'injury_exit', game_evidence_source: evidence }),
  ];
  const compact = compactRows(rows);
  assert.deepEqual(eligibleGames(compact, player, 2026), eligibleGames(rows, player, 2026));
  const previous = summarizeHistory(compact, 2026).players.test;
  assert.equal(previous.games, 1);
  assert.equal(previous.averages.passing_yards, 250);
  assert.equal(previous.excluded[0].week, 2);
  const empty = valuePlayer(player, [rows[1]], settings, 2026);
  assert.equal(empty.games, 0);
  assert.ok(Number.isFinite(empty.redraft));
});

test('Kyler reference data excludes confirmed Week 1, never creates a zero for missed Week 2', () => {
  const reference = JSON.parse(readFileSync(new URL('./demo-data.json', import.meta.url)));
  const kyler = reference.players.find((p) => p.name === 'Kyler Murray');
  const rows = reference.rows.filter((row) => row.player_id === kyler.gsis);
  const actual = valuePlayer(kyler, rows, settings, 2026);
  assert.equal(rows.length, 4);
  assert.equal(actual.games, 3);
  assert.equal(actual.stats.ppg, 13.4);
  assert.equal(actual.gameSample.recordedPPG, 9.9);
  assert.equal(actual.gameSample.excluded[0].week, 1);
  assert.equal(actual.gameSample.excluded[0].source, evidence);
  // A different season or postseason week must not inherit the reviewed exclusion.
  assert.equal(eligibleGames([{ ...rows[0], season: 2025 }], kyler, 2025).included.length, 1);
  assert.equal(
    eligibleGames([{ ...rows[0], season_type: 'POST' }], kyler, 2026).included.length,
    1,
  );
});
