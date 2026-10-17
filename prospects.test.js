import test from 'node:test';
import assert from 'node:assert/strict';
import { valuePlayer, settingsFor, pickValue } from './valuation.js';
import { loadRookieDrafts } from './prospects.js';
const settings = settingsFor({ mode: 'dynasty' });
const prospect = {
  id: 'rookie',
  position: 'RB',
  experience: 0,
  draftYear: 2026,
  draftRound: 1,
  draftPick: 8,
  age: 21,
};
const slow = Array.from({ length: 4 }, () => ({
  position: 'RB',
  carries: 5,
  targets: 1,
  rushing_yards: 15,
  receptions: 1,
  receiving_yards: 5,
}));
test('elite rookies retain dynasty capital through a slow start while redraft reflects production', () => {
  const preseason = valuePlayer(prospect, [], settings, 2026),
    start = valuePlayer(prospect, slow, settings, 2026);
  const veteran = valuePlayer(
    { ...prospect, experience: 5, draftYear: 2021 },
    slow,
    settings,
    2026,
  );
  assert.ok(start.dynasty > pickValue({ round: 1, year: 2027 }, settings, 2026));
  assert.ok(start.dynasty > veteran.dynasty * 1.5);
  assert.equal(start.redraft, veteran.redraft);
  assert.ok(start.dynasty >= preseason.dynasty * 0.7);
  assert.equal(start.prospect.source, 'NFL draft capital');
  assert.ok(start.pace < 10);
});
test('protection fades with sustained poor production, opportunities and NFL tenure', () => {
  const few = valuePlayer(prospect, slow, settings, 2026);
  const full = valuePlayer(
    prospect,
    Array.from({ length: 17 }, () => slow[0]),
    settings,
    2026,
  );
  const second = valuePlayer({ ...prospect, experience: 1, draftYear: 2025 }, slow, settings, 2026);
  const third = valuePlayer({ ...prospect, experience: 2, draftYear: 2024 }, slow, settings, 2026);
  assert.ok(few.dynasty > full.dynasty);
  assert.ok(few.dynasty > second.dynasty);
  assert.ok(second.dynasty > third.dynasty);
  assert.equal(
    valuePlayer({ ...prospect, draftYear: 2023, experience: 3 }, slow, settings, 2026).prospect,
    null,
  );
  const usage = valuePlayer(
    prospect,
    slow.map((r) => ({ ...r, carries: 60 })),
    settings,
    2026,
  );
  assert.ok(usage.prospect.priorWeight < few.prospect.priorWeight);
});
test('draft capital distinguishes prospects without boosting young veterans or guessing missing experience', () => {
  const early = valuePlayer(prospect, slow, settings, 2026),
    late = valuePlayer({ ...prospect, draftRound: 7, draftPick: 250 }, slow, settings, 2026);
  assert.ok(early.dynasty > late.dynasty);
  assert.equal(
    valuePlayer({ id: 'unknown', position: 'WR', age: 21 }, slow, settings, 2026).prospect,
    null,
  );
  assert.equal(valuePlayer({ ...prospect, draftYear: 2027 }, slow, settings, 2026).prospect, null);
});
test('verified rookie 1.01 is limited league context; startup selections are not used', () => {
  const local = { overall: 1, teams: 12, season: 2026, verified: true };
  const baseline = valuePlayer(prospect, slow, settings, 2026),
    first = valuePlayer({ ...prospect, rookieDraft: local }, slow, settings, 2026);
  assert.equal(first.prospect.capital, 863);
  assert.ok(first.dynasty > baseline.dynasty);
  assert.equal(
    valuePlayer({ ...prospect, rookieDraft: { ...local, verified: false } }, slow, settings, 2026)
      .dynasty,
    baseline.dynasty,
  );
  assert.equal(
    valuePlayer({ ...prospect, rookieDraft: { ...local, season: 2025 } }, slow, settings, 2026)
      .dynasty,
    baseline.dynasty,
  );
  assert.match(first.prospect.source, /verified league/);
});
test('breakout production can exceed the prospect prior and superflex affects QBs appropriately', () => {
  const breakout = valuePlayer(
    prospect,
    slow.map((r) => ({ ...r, carries: 25, rushing_yards: 180, rushing_tds: 3 })),
    settings,
    2026,
  );
  assert.ok(breakout.dynasty > valuePlayer(prospect, [], settings, 2026).dynasty);
  assert.equal(
    breakout.dynasty,
    valuePlayer(
      { ...prospect, experience: 5, draftYear: 2021 },
      slow.map((r) => ({ ...r, carries: 25, rushing_yards: 180, rushing_tds: 3 })),
      settings,
      2026,
    ).dynasty,
  );
  const qb = { ...prospect, position: 'QB' };
  assert.ok(
    valuePlayer(qb, [], { ...settings, superflex: true }, 2026).dynasty >
      valuePlayer(qb, [], settings, 2026).dynasty,
  );
});
test('draft importer validates contents, seasons, keeper status and optional-provider failure', async () => {
  const season = new Date().getUTCFullYear(),
    league = { id: '123456', type: 2 },
    draft = {
      draft_id: '987654',
      sport: 'nfl',
      season,
      status: 'complete',
      settings: { teams: 12 },
    };
  const picks = [
    { player_id: 'a', pick_no: 1 },
    { player_id: 'b', pick_no: 2 },
  ];
  const catalog = { a: { years_exp: 0 }, b: { years_exp: 0 } };
  const get = async (path) => (path.endsWith('/drafts') ? [draft] : picks);
  const r = await loadRookieDrafts(get, league, season, catalog);
  assert.equal(r.players.a.overall, 1);
  assert.equal(r.players.a.verified, true);
  assert.deepEqual(
    (await loadRookieDrafts(get, league, season, { ...catalog, b: { years_exp: 4 } })).players,
    {},
  );
  picks[0].is_keeper = true;
  assert.deepEqual((await loadRookieDrafts(get, league, season, catalog)).players, {});
  delete picks[0].is_keeper;
  const failed = await loadRookieDrafts(
    async () => {
      throw new Error('offline');
    },
    league,
    season,
    catalog,
  );
  assert.match(failed.warning, /unavailable/);
  assert.equal(
    (await loadRookieDrafts(get, { ...league, type: 0 }, season, catalog)).warning,
    null,
  );
});
