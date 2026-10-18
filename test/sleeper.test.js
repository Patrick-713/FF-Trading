import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSleeperClient,
  buildSnapshot,
  completedWeeks,
  validUsername,
  validLeague,
} from '../src/integrations/sleeper.js';
const user = { user_id: 'u1', username: 'one' };
const league = {
  league_id: '1234567890',
  name: 'Test',
  season: '2026',
  status: 'in_season',
  roster_positions: ['QB', 'SUPER_FLEX', 'BN', 'IR'],
};
const rosters = [
  {
    roster_id: 1,
    owner_id: 'u1',
    players: ['101', '102'],
    starters: ['101', '0'],
    settings: { wins: 1, losses: 1 },
  },
  { roster_id: 2, owner_id: 'u2', players: [], starters: [], settings: { wins: 1, losses: 1 } },
];
const members = [
  { user_id: 'u1', display_name: 'One', metadata: { team_name: 'Team One' } },
  { user_id: 'u2', display_name: 'Two' },
];
const catalog = {
  101: { first_name: 'First', last_name: 'Player', position: 'QB', team: 'SEA' },
  102: { full_name: 'Bench Player', position: 'WR', team: 'BUF' },
};
const nfl = { season: '2026', week: 3, leg: 3, season_type: 'regular' };
const weeks = [
  {
    week: 1,
    matchups: [
      { roster_id: 1, points: 150 },
      { roster_id: 2, points: 100 },
    ],
  },
  {
    week: 2,
    matchups: [
      { roster_id: 1, points: 100 },
      { roster_id: 2, points: 150 },
    ],
  },
];
test('real rosters map players, empty slots, bench, and league-specific positions', () => {
  const data = buildSnapshot(user, league, rosters, members, catalog, structuredClone(weeks), nfl);
  assert.deepEqual(data.slots, ['QB', 'SUPER_FLEX']);
  assert.equal(data.ownTeam, 'sl_1');
  assert.deepEqual(data.bench, ['102']);
  assert.equal(data.players[0].name, 'First Player');
  assert.equal(data.teams[0].name, 'Team One');
  assert.equal(data.teams[0].points, 100);
  assert.equal('price' in data.teams[0], false);
  assert.equal(data.settledWeek, 2);
});
test('repeat sync is idempotent and commissioner overrides change saved points', () => {
  const a = buildSnapshot(user, league, rosters, members, catalog, structuredClone(weeks), nfl);
  const b = buildSnapshot(user, league, rosters, members, catalog, structuredClone(weeks), nfl);
  assert.deepEqual(a.teams, b.teams);
  const corrected = structuredClone(weeks);
  corrected[1].matchups[0].custom_points = 175;
  const c = buildSnapshot(user, league, rosters, members, catalog, corrected, nfl);
  assert.equal(c.teams[0].points, 175);
});
test('zero-score weeks stay flat; incomplete scoring is skipped', () => {
  const data = buildSnapshot(
    user,
    league,
    rosters,
    members,
    catalog,
    [
      {
        week: 1,
        matchups: [
          { roster_id: 1, points: 0 },
          { roster_id: 2, points: 0 },
        ],
      },
      { week: 2, matchups: [{ roster_id: 1, points: 100 }] },
    ],
    nfl,
  );
  assert.equal(data.teams[0].points, 0);
  assert.equal(data.settledWeek, 1);
  assert.deepEqual(data.skippedWeeks, [2]);
});
test('current partial weeks excluded; pre-draft and historical seasons handled', () => {
  assert.equal(completedWeeks(league, nfl), 2);
  assert.equal(completedWeeks({ ...league, status: 'pre_draft' }, nfl), 0);
  assert.equal(completedWeeks({ ...league, status: 'complete' }, nfl), 2);
  assert.equal(completedWeeks({ ...league, season: '2025' }, nfl), 18);
  assert.equal(completedWeeks({ ...league, season: '2027' }, nfl), 0);
  assert.equal(completedWeeks(league, { ...nfl, season_type: 'post' }), 18);
});
test('input validation and membership prevent arbitrary URLs or foreign roster linking', () => {
  assert.throws(() => validUsername('https://example.com'));
  assert.throws(() => validLeague('http://localhost'));
  assert.throws(() => validLeague(1234567890123456789));
  assert.throws(() =>
    buildSnapshot({ user_id: 'outsider' }, league, rosters, members, catalog, [], nfl),
  );
});
test('client coalesces requests, caches players for 24 hours, and explains upstream errors', async () => {
  let time = 0,
    calls = 0;
  const client = createSleeperClient({
    clock: () => time,
    fetcher: async (url) => {
      calls++;
      const p = new URL(url).pathname;
      const data = p.endsWith('/state/nfl')
        ? { ...nfl, leg: 1 }
        : p.includes('/user/')
          ? user
          : p.endsWith('/rosters')
            ? rosters
            : p.endsWith('/users')
              ? members
              : p.endsWith('/players/nfl')
                ? catalog
                : { ...league, sport: 'nfl' };
      return new Response(JSON.stringify(data));
    },
  });
  await Promise.all([client.snapshot('one', '1234567890'), client.snapshot('one', '1234567890')]);
  assert.equal(calls, 6);
  time = 31000;
  await client.snapshot('one', '1234567890');
  assert.equal(calls, 11);
  const limited = createSleeperClient({ fetcher: async () => new Response('{}', { status: 429 }) });
  await assert.rejects(() => limited.lookup('one'), /too many requests/);
});

test('season standings preserve fractional totals and distinguish missing scores from zero', async () => {
  const { rosterStandings } = await import('../src/integrations/sleeper.js');
  assert.deepEqual(
    rosterStandings({
      wins: 4,
      losses: 1,
      ties: 0,
      fpts: 623,
      fpts_decimal: 45,
      fpts_against: 500,
      fpts_against_decimal: 7,
    }),
    { wins: 4, losses: 1, ties: 0, pointsFor: 623.45, pointsAgainst: 500.07 },
  );
  assert.equal(rosterStandings({}).pointsFor, null);
  assert.equal(rosterStandings({ fpts: 0 }).pointsFor, 0);
});
