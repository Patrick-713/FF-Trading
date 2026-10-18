import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFantasy } from '../src/analysis/fantasy.js';
import { playerGameLog, settingsFor } from '../src/analysis/valuation.js';
import { profileStats, profileGameLog } from '../public/player-profile.js';

test('profile logs are on demand, reuse frozen input and retain injury exclusions without changing averages', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('test');");
  const fantasy = createFantasy(db, {
    fetcher: () => {
      throw new Error('No provider request expected');
    },
  });
  const model = await fantasy.model('test', null, {}, {});
  assert.ok(model.players.every((player) => !Object.hasOwn(player, 'gameLog')));
  const kyler = model.players.find((player) => player.name === 'Kyler Murray');
  const profile = await fantasy.model('test', null, {}, {}, kyler.id);
  assert.equal(profile.gameLog.length, 4);
  assert.deepEqual(
    profile.gameLog.map((row) => row.week),
    [5, 4, 3, 1],
  );
  assert.equal(profile.gameLog[3].exclusion.reason, 'Left the game with a concussion');
  assert.equal(profile.gameLog[3].points, -0.38);
  assert.equal(kyler.stats.ppg, 13.4);
  assert.equal(
    profile.gameLog.some((row) => row.week === 2),
    false,
  );
  assert.equal(await fantasy.model('test', null, {}, {}, 'not-a-player'), null);
  db.close();
});

test('game logs score league settings, stay compact and do not modify input rows', () => {
  const row = {
    week: 2,
    season: 2026,
    position: 'TE',
    receptions: 5,
    receiving_yards: 60,
    receiving_tds: 1,
  };
  const original = structuredClone(row);
  const ppr = playerGameLog(
    { position: 'TE' },
    [row],
    settingsFor({ scoring: 'ppr', tePremium: 0.5 }),
    2026,
  );
  const standard = playerGameLog(
    { position: 'TE' },
    [row],
    settingsFor({ scoring: 'standard' }),
    2026,
  );
  assert.equal(ppr[0].points, 19.5);
  assert.equal(standard[0].points, 12);
  assert.deepEqual(row, original);
  assert.deepEqual(playerGameLog({}, [], settingsFor(), 2026), []);
  assert.ok(JSON.stringify(ppr).length < 500);
});

test('stat definitions and logs provide touch-accessible explanations and escape provider text', () => {
  const stats = profileStats({ consistency: 70, ppg: 12, lastSeasonPPG: null });
  assert.equal((stats.match(/class="stat-definition"/g) || []).length, 3);
  assert.ok(stats.includes('Explain Consistency'));
  assert.ok(stats.includes('0 to 100'));
  assert.ok(stats.includes('not better scoring'));
  assert.ok(stats.includes('Not available'));
  const rows = playerGameLog({}, [{ week: 1, passing_yards: 100 }], settingsFor(), 2026);
  rows[0].exclusion = { reason: '<script>unsafe</script>' };
  const html = profileGameLog({ season: 2026, position: 'QB', gameLog: rows });
  assert.ok(html.includes('Week 1'));
  assert.ok(html.includes('Excluded from averages'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(html.includes('<script>'), false);
  assert.ok(
    profileGameLog({ season: 2026, position: 'QB', gameLog: [] }).includes('No weekly game data'),
  );
});
