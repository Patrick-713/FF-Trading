import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './database.js';
import { createFantasy } from './fantasy.js';
import { compactRows, summarizeHistory, compactInputs, historyNameIndex } from './stat-inputs.js';
import { valuePlayer, settingsFor, pointsFor } from './valuation.js';
import { historyWeight } from './redraft-signal.js';

const settings = settingsFor();
const veteran = { id: 'v', position: 'WR', experience: 5, draftYear: 2021, gsis: 'G' };
const weeks = (n, yards = 100) =>
  Array.from({ length: n }, (_, i) => ({
    player_id: 'G',
    player_display_name: 'Veteran',
    position: 'WR',
    season: 2025,
    season_type: 'REG',
    week: i + 1,
    team: 'BUF',
    receptions: 6,
    targets: 9,
    receiving_yards: yards,
    target_share: 0,
    wopr: 0,
    receiving_epa: 0,
    passing_interceptions: 0,
    unused_large_field: 'x'.repeat(2000),
  }));
const previous = { ...summarizeHistory(weeks(16), 2025).players.G, season: 2025 };

test('history stabilizes early values, fades, respects scoring and never creates current games', () => {
  const slow = weeks(1, 10);
  const original = valuePlayer(veteran, slow, settings, 2026);
  const refined = valuePlayer(veteran, slow, settings, 2026, previous);
  assert.ok(refined.redraft > original.redraft);
  assert.equal(refined.games, 1);
  assert.equal(refined.pace, original.pace);
  assert.equal(refined.history.ppg, 16);
  assert.equal(
    valuePlayer(veteran, slow, { ...settings, scoring: 'standard' }, 2026, previous).history.ppg,
    10,
  );
  assert.ok(historyWeight(1, 16) > historyWeight(8, 16));
  assert.equal(historyWeight(17, 16), 0);
  const preseason = valuePlayer(veteran, [], settings, 2026, previous);
  assert.equal(preseason.games, 0);
  assert.equal(preseason.pace, 0);
  assert.ok(preseason.redraft > 500);
  assert.equal(preseason.confidence, 'Last-season baseline');
  for (const invalid of [
    { ...previous, season: 2026 },
    { ...previous, position: 'TE' },
    { ...previous, games: 2 },
  ])
    assert.equal(valuePlayer(veteran, slow, settings, 2026, invalid).history, null);
  assert.equal(
    valuePlayer({ ...veteran, experience: 0, draftYear: 2026 }, slow, settings, 2026, previous)
      .history,
    null,
  );
});

test('compact inputs preserve scoring, values and explicit zero usage while dropping unused fields', () => {
  const rows = weeks(8),
    compact = compactRows(rows);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(rows).length / 3);
  assert.equal(compact[0].target_share, 0);
  for (const scoring of ['ppr', 'half', 'standard']) {
    const s = settingsFor({ scoring });
    assert.equal(pointsFor(rows[0], s), pointsFor(compact[0], s));
    assert.deepEqual(valuePlayer(veteran, rows, s, 2026), valuePlayer(veteran, compact, s, 2026));
  }
  const packed = compactInputs(
    {
      statistics: { rows },
      catalog: { v: { active: false, gsis_id: 'G' }, unused: { active: false, gsis_id: 'H' } },
      metadata: { G: { draftRound: 1 }, H: { draftRound: 2 } },
    },
    ['v'],
  );
  assert.deepEqual(Object.keys(packed.catalog), ['v']);
  assert.deepEqual(Object.keys(packed.metadata), ['G']);
});

test('history is shared and cached; frozen history survives cache changes and model reads stay offline', async () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("INSERT INTO accounts(id) VALUES('test');");
  let payloadReads = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (sql.startsWith('SELECT data,refreshed FROM analysis_snapshots')) payloadReads++;
    return prepare(sql);
  };
  const calls = [];
  const fantasy = createFantasy(db, {
    fetcher: async (url) => {
      calls.push(url);
      if (url.includes('/players/'))
        return new Response('gsis_id,birth_date,draft_round\nG,1999-01-01,2\n');
      const year = url.includes('2025') ? 2025 : 2026;
      const rows = weeks(year === 2025 ? 16 : 2, year === 2025 ? 100 : 10);
      return new Response(
        'player_id,player_display_name,position,season,season_type,week,receptions,targets,receiving_yards\n' +
          rows.map((r) => `G,Veteran,WR,${year},REG,${r.week},6,9,${r.receiving_yards}`).join('\n'),
      );
    },
  });
  const snapshot = {
    league: { id: 'league', season: 2026, type: 0, scoring: {} },
    teams: [{ id: 'a', name: 'Team', playerIds: ['v'] }],
    players: [],
    slots: ['WR'],
    settledWeek: 1,
    ownTeam: 'a',
    analysisRefreshedAt: new Date().toISOString(),
  };
  const catalog = {
    v: { full_name: 'Veteran', position: 'WR', active: true, years_exp: 5, gsis_id: 'G' },
  };
  try {
    const inputs = await fantasy.prepareSnapshot(snapshot, catalog);
    await fantasy.prepareSnapshot(snapshot, catalog);
    assert.equal(calls.filter((u) => u.includes('2025')).length, 1);
    await fantasy.storeSnapshot('test', snapshot, inputs);
    const before = await fantasy.model('test', snapshot, {});
    assert.equal(before.players[0].history.games, 16);
    assert.equal(before.players[0].games, 1, 'future weeks stay excluded');
    const fetched = calls.length,
      changes = db.prepare('SELECT total_changes() AS n').get().n;
    await fantasy.model('test', snapshot, {});
    assert.equal(calls.length, fetched);
    assert.equal(
      payloadReads,
      1,
      'repeated reads reuse the frozen input payload after checking its version',
    );
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
    db.prepare('UPDATE fantasy_cache SET data=? WHERE key=?').run(
      JSON.stringify({ season: 2025, players: {} }),
      'history:2025',
    );
    const after = await fantasy.model('test', snapshot, {});
    assert.deepEqual(before.players, after.players);
  } finally {
    db.close();
  }
});

test('history name fallback is retained only for an unambiguous name and position', () => {
  const history = {
    season: 2025,
    players: {
      G: { name: 'Veteran', position: 'WR' },
      H: { name: 'Other', position: 'RB' },
      I: { name: 'Other', position: 'RB' },
    },
  };
  const packed = compactInputs(
    {
      statistics: { rows: [] },
      catalog: {
        v: { full_name: 'Veteran', position: 'WR' },
        o: { full_name: 'Other', position: 'RB' },
      },
      metadata: {},
      history,
    },
    ['v', 'o'],
  );
  assert.deepEqual(Object.keys(packed.history.players), ['G']);
  assert.equal(historyNameIndex(history.players).get('other:RB').size, 2);
});
