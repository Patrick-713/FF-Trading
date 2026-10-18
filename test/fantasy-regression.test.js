import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/storage/database.js';
import { createFantasy } from '../src/analysis/fantasy.js';
import { analyzeTrade, findTrades } from '../src/analysis/trade-engine.js';
import { leagueDefaults } from '../src/analysis/league-format.js';
import { pickValue, settingsFor } from '../src/analysis/valuation.js';
import { tradeResult } from '../public/trade-tools.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("INSERT INTO accounts(id) VALUES('test');");
  const fantasy = createFantasy(db, {
    fetcher: async () => {
      throw new Error('Offline regression test');
    },
  });
  const catalog = {
    rookie: {
      full_name: 'Rookie Runner',
      position: 'RB',
      active: true,
      age: 21,
      years_exp: 0,
      draft_round: 1,
      draft_year: 2026,
      draft_pick: 8,
      gsis_id: 'G',
    },
    other: {
      full_name: 'Rookie Receiver',
      position: 'WR',
      active: true,
      age: 22,
      years_exp: 0,
      draft_round: 1,
      draft_year: 2026,
      draft_pick: 20,
      gsis_id: 'H',
    },
    unknown: { full_name: 'Unknown Veteran', position: 'WR', age: 30, years_exp: 8 },
  };
  const statistics = {
    season: 2026,
    source: 'Synthetic regression fixture',
    fetched: Date.now(),
    rows: Array.from({ length: 4 }, (_, i) => ({
      player_id: 'G',
      position: 'RB',
      week: i + 1,
      carries: 5,
      targets: 1,
      rushing_yards: 15,
      receptions: 1,
      receiving_yards: 5,
    })),
  };
  async function model(
    id,
    { rostered = true, week = 4, scoring = { rec: 1 }, mode = 'dynasty', prepared = true } = {},
  ) {
    const snapshot = {
      league: { id, season: '2026', type: 2, draftRounds: 3, scoring },
      teams: [
        {
          id: 'a',
          name: 'A',
          rosterId: 1,
          playerIds: rostered ? ['rookie', 'unknown'] : ['unknown'],
        },
        { id: 'b', name: 'B', rosterId: 2, playerIds: ['other'] },
      ],
      players: [],
      slots: ['RB', 'WR'],
      settledWeek: week,
      ownTeam: 'a',
      analysisRefreshedAt: '2026-10-14T12:00:00Z',
      rookieDrafts: {
        players: { rookie: { overall: 1, teams: 12, season: 2026, verified: true } },
      },
    };
    if (prepared)
      await fantasy.storeSnapshot('test', snapshot, {
        statistics,
        metadata: { G: { draftRound: 1, draftYear: 2026, draftPick: 8 } },
        catalog,
        asOf: snapshot.analysisRefreshedAt,
      });
    return fantasy.model('test', snapshot, catalog, { mode });
  }
  return { db, fantasy, model };
}

test('identical players retain identical metadata, values and confidence across ownership states', async () => {
  const f = fixture();
  try {
    const owned = (await f.model('owned')).players.find((p) => p.id === 'rookie');
    const free = (await f.model('free', { rostered: false })).players.find(
      (p) => p.id === 'rookie',
    );
    assert.equal(free.owner, 'free_agent');
    assert.deepEqual({ ...owned, owner: null }, { ...free, owner: null });
    assert.ok(free.prospect);
    assert.ok(
      free.dynasty >=
        Math.round(
          pickValue({ round: 1, year: 2027 }, settingsFor({ mode: 'dynasty' }), 2026, 'first') *
            0.9,
        ),
    );
  } finally {
    f.db.close();
  }
});

test('league scoring imports supported TE bonuses and preserves explicit per-league overrides', async () => {
  const f = fixture();
  try {
    const premium = await f.model('premium', {
      scoring: { rec: 0.5, bonus_rec_te: 0.5, pass_td: 6 },
    });
    assert.equal(premium.settings.tePremium, 0.5);
    assert.equal(premium.settings.scoring, 'half');
    assert.equal(premium.settings.passTD, 6);
    await f.fantasy.saveSettings(
      'test',
      { league: { id: 'premium' } },
      { ...premium.settings, tePremium: 1 },
    );
    assert.equal(
      (await f.model('premium', { scoring: { rec: 0.5, bonus_rec_te: 0.5 } })).settings.tePremium,
      1,
    );
    assert.equal((await f.model('ordinary')).settings.tePremium, 0);
    assert.match(
      (await f.model('unsupported', { scoring: { rec: 1, bonus_rec_te: 0.75 } })).data.warning,
      /outside the supported/,
    );
    assert.equal(
      leagueDefaults({ league: { scoring: { bonus_rec_te: 1 } }, slots: ['QB', 'QB'] }).settings
        .superflex,
      true,
    );
  } finally {
    f.db.close();
  }
});

test('prepared preseason dynasty snapshots support prospects and picks without manufacturing current production', async () => {
  const f = fixture();
  try {
    const model = await f.model('preseason', { week: 0 });
    assert.equal(model.data.ready, true);
    assert.equal(model.data.prospectOnly, true);
    assert.equal(model.data.productionAvailable, false);
    assert.equal(model.teams[0].pace, null);
    const result = analyzeTrade(model, {
      teamA: 'a',
      teamB: 'b',
      sendA: ['rookie'],
      sendB: ['other'],
    });
    assert.equal(result.teamA.beforePace, null);
    assert.equal(result.teamA.paceChange, null);
    assert.equal(result.teamA.current.change, null);
    assert.ok(Number.isFinite(result.teamA.future.change));
    assert.ok(tradeResult(result, model).includes('Unavailable'));
    const a = model.picks.find((p) => p.owner === 'a'),
      b = model.picks.find((p) => p.owner === 'b');
    assert.ok(analyzeTrade(model, { teamA: 'a', teamB: 'b', sendA: [a.id], sendB: [b.id] }));
    assert.throws(
      () => analyzeTrade(model, { teamA: 'a', teamB: 'b', sendA: ['unknown'], sendB: ['other'] }),
      /no verified prospect metadata/,
    );
    assert.equal(findTrades(model, { goal: 'contend' }).offers.length, 0);
    assert.equal((await f.model('redraft', { week: 0, mode: 'redraft' })).settings.mode, 'dynasty');
    assert.equal((await f.model('redraft', { week: 0, mode: 'redraft' })).data.prospectOnly, true);
    assert.equal((await f.model('missing', { week: 0, prepared: false })).data.ready, false);
  } finally {
    f.db.close();
  }
});
