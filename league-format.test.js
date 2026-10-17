import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './database.js';
import { createFantasy } from './fantasy.js';
import { leagueDefaults } from './league-format.js';

test('Sleeper QB format comes from Superflex or repeated QB starter slots', () => {
  for (const [slots, expected] of [
    [['QB', 'SUPER_FLEX'], true],
    [['QB', 'QB'], true],
    [['QB', 'FLEX'], false],
    [[], false],
  ])
    assert.equal(leagueDefaults({ league: {}, slots }).settings.superflex, expected);
  assert.equal(leagueDefaults({ league: {} }).settings.superflex, false);
});

test('legacy copied QB settings no longer mask Sleeper; explicit overrides and reset remain isolated', async () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("INSERT INTO accounts(id) VALUES('a'),('b');");
  let fetches = 0;
  const fantasy = createFantasy(db, {
    fetcher: () => {
      fetches++;
      throw new Error('Offline read');
    },
  });
  const snapshot = (id, slots = ['QB', 'SUPER_FLEX']) => ({
    league: { id, season: '2026', type: 2, scoring: { rec: 1, pass_td: 6 } },
    slots,
    teams: [{ id: 'team', name: 'Team', playerIds: [] }],
    players: [],
    ownTeam: 'team',
    settledWeek: 0,
  });
  const linked = snapshot('sf');
  db.prepare('INSERT INTO league_settings VALUES (?,?,?)').run(
    'a',
    'sf',
    JSON.stringify({ scoring: 'ppr', superflex: false, passTD: 6, tePremium: 0 }),
  );
  const initial = await fantasy.model('a', linked, {});
  assert.equal(initial.settings.superflex, true);
  assert.ok(initial.slots.includes('SUPER_FLEX'));
  assert.equal(initial.leagueSettings.imported.superflex, true);
  assert.deepEqual(initial.leagueSettings.overrides, {});
  await fantasy.saveSettings('a', linked, { scoring: 'half' });
  assert.deepEqual(
    JSON.parse(
      db.prepare('SELECT data FROM league_settings WHERE account=? AND league=?').get('a', 'sf')
        .data,
    ),
    { version: 1, overrides: { scoring: 'half' } },
  );
  assert.equal((await fantasy.model('a', linked, {})).settings.superflex, true);
  await fantasy.saveSettings('a', linked, { superflex: false });
  const manual = await fantasy.model('a', linked, {});
  assert.equal(manual.settings.superflex, false);
  assert.equal(manual.leagueSettings.overrides.superflex, false);
  assert.equal(manual.leagueSettings.imported.superflex, true);
  assert.equal((await fantasy.model('b', linked, {})).settings.superflex, true);
  assert.equal((await fantasy.model('a', snapshot('other', ['QB']), {})).settings.superflex, false);
  await fantasy.resetSettings('a', linked);
  const reset = await fantasy.model('a', linked, {});
  assert.equal(reset.settings.superflex, true);
  assert.equal(reset.settings.scoring, 'ppr');
  assert.equal(reset.settings.passTD, 6);
  assert.deepEqual(reset.leagueSettings.overrides, {});
  assert.ok(reset.slots.includes('SUPER_FLEX'));
  assert.equal(fetches, 0);
  db.close();
});
