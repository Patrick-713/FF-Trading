import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFantasy } from '../src/analysis/fantasy.js';
import { migrate } from '../src/storage/database.js';
test('settings are league-scoped and model reads never fetch or write', async () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("INSERT INTO accounts(id) VALUES('a');");
  let fetches = 0;
  const fantasy = createFantasy(db, {
    fetcher: async () => {
      fetches++;
      throw new Error('Reads must be offline');
    },
  });
  const snapshot = (id) => ({
    league: { id, season: '2026', type: 0, scoring: {} },
    teams: [{ id: 't', name: 'Team', playerIds: [] }],
    slots: ['QB'],
    players: [],
    settledWeek: 2,
    ownTeam: 't',
  });
  const before = db.prepare('SELECT total_changes() AS n').get().n;
  await fantasy.model('a', snapshot('one'), {});
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
  await fantasy.saveSettings('a', snapshot('one'), { mode: 'dynasty', scoring: 'half' });
  await fantasy.saveSettings('a', snapshot('two'), { mode: 'redraft', scoring: 'standard' });
  assert.equal((await fantasy.model('a', snapshot('one'), {})).settings.scoring, 'half');
  assert.equal((await fantasy.model('a', snapshot('two'), {})).settings.scoring, 'standard');
  assert.equal(fetches, 0);
  db.close();
});
test('analysis uses a frozen input snapshot despite shared cache changes', async () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("INSERT INTO accounts(id) VALUES('a');");
  const fantasy = createFantasy(db, {
    fetcher: async () => {
      throw new Error('No network');
    },
  });
  const snapshot = {
    league: { id: 'one', season: '2026', type: 0, scoring: {} },
    teams: [{ id: 't', name: 'Team', playerIds: ['1'] }],
    players: [],
    slots: ['QB'],
    settledWeek: 2,
    ownTeam: 't',
    analysisRefreshedAt: new Date().toISOString(),
  };
  await fantasy.storeSnapshot('a', snapshot, {
    statistics: {
      season: 2026,
      source: 'Test',
      fetched: Date.now(),
      rows: [{ player_id: 'G', position: 'QB', week: 1, passing_yards: 250 }],
    },
    metadata: {},
    catalog: { 1: { full_name: 'Quarterback', position: 'QB', gsis_id: 'G' } },
  });
  const before = await fantasy.model('a', snapshot, {});
  db.prepare('INSERT INTO fantasy_cache VALUES (?,?,?)').run(
    'stats:2026',
    JSON.stringify({ season: 2026, rows: [] }),
    Date.now(),
  );
  const after = await fantasy.model('a', snapshot, { 1: { full_name: 'Changed', position: 'WR' } });
  assert.deepEqual(before.players, after.players);
  assert.equal(after.data.refreshedAt, snapshot.analysisRefreshedAt);
  db.close();
});
