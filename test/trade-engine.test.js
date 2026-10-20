import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrade, findTrades } from '../src/analysis/trade-engine.js';
import { tradeSearch, tradeTools, tradeResult, finderView } from '../public/trade-tools.js';
const player = (id, owner, position, pace, value, age = 25) => ({
  id,
  owner,
  position,
  pace,
  value,
  redraft: value,
  dynasty: value,
  age,
  name: id,
  kind: 'player',
  club: 'NFL',
  games: 6,
});
function fixture() {
  return {
    ownTeam: 'a',
    season: 2026,
    settings: { mode: 'dynasty', superflex: false },
    slots: ['QB', 'WR'],
    teams: [
      { id: 'a', name: 'A', rosterLimit: 3 },
      { id: 'b', name: 'B', rosterLimit: 3 },
    ],
    players: [
      player('aq', 'a', 'QB', 40, 1500),
      player('aq2', 'a', 'QB', 30, 1100),
      player('aw', 'a', 'WR', 10, 500),
      player('bq', 'b', 'QB', 10, 500),
      player('bw', 'b', 'WR', 40, 1500),
      player('bw2', 'b', 'WR', 30, 1100),
      player('fa', 'free_agent', 'WR', 8, 200),
    ],
    picks: [],
  };
}
const input = { teamA: 'a', teamB: 'b', sendA: ['aq'], sendB: ['bw'] };
test('complementary trades show both horizons and complete nonduplicated lineups without mutating imports', () => {
  const m = fixture(),
    original = JSON.stringify(m),
    r = analyzeTrade(m, input);
  assert.equal(r.teamA.paceChange, 20);
  assert.equal(r.teamB.paceChange, 20);
  assert.equal(r.teamA.current.change, 0);
  assert.equal(r.teamA.future.change, 0);
  const ids = r.teamA.afterLineup.starters.map((s) => s.player?.id);
  assert.equal(new Set(ids).size, 2);
  assert.equal(r.teamA.roster.requiredCuts, 0);
  assert.equal(JSON.stringify(m), original);
});
test('two-for-one includes required cuts, trade-created openings and conditional replacements', () => {
  const m = fixture(),
    r = analyzeTrade(m, { ...input, sendA: ['aq', 'aw'] });
  assert.equal(r.teamB.roster.requiredCuts, 1);
  assert.equal(r.teamB.roster.cuts.length, 1);
  assert.equal(r.teamB.roster.afterCount, 3);
  assert.equal(r.teamA.roster.replacements[0].id, 'fa');
  assert.equal(r.teamA.roster.afterCount, 3);
  assert.equal(r.teamA.valueChange, r.teamA.exchangeValueChange + 200);
  assert.equal(r.teamB.valueChange, r.teamB.exchangeValueChange - r.teamB.roster.cuts[0].value);
  const noWaivers = analyzeTrade(m, { ...input, sendA: ['aq', 'aw'], includeWaivers: false });
  assert.equal(noWaivers.teamA.roster.replacements.length, 0);
  assert.equal(noWaivers.teamA.roster.unfilled, 1);
});
test('IR/taxi is excluded from active capacity, auto cuts and starters', () => {
  const m = fixture();
  m.players.push(player('ir', 'b', 'WR', 100, 100));
  m.teams[1].protectedIds = ['ir'];
  const r = analyzeTrade(m, { ...input, sendA: ['aq', 'aw'] });
  assert.equal(r.teamB.beforePace, 50);
  assert.equal(r.teamB.roster.requiredCuts, 1);
  assert.ok(!r.teamB.roster.cuts.some((p) => p.id === 'ir'));
  assert.equal(r.teamB.roster.afterCount, 3);
});
test('unknown capacity is explicit and an empty waiver pool does not fabricate replacements', () => {
  const m = fixture();
  m.teams[1].rosterLimit = null;
  m.players = m.players.filter((p) => p.owner !== 'free_agent');
  const r = analyzeTrade(m, { ...input, sendA: ['aq', 'aw'] });
  assert.equal(r.teamA.roster.unfilled, 1);
  assert.equal(r.teamB.roster.capacity, null);
  assert.match(r.notes.join(' '), /capacity is unavailable/);
});
test('trade comparisons use standard values and reject manual adjustments', () => {
  const m = fixture(),
    r = analyzeTrade(m, input);
  const asset = m.players.find((p) => p.id === 'bw');
  assert.equal(r.received[0].redraft, asset.redraft);
  assert.equal(r.received[0].dynasty, asset.dynasty);
  assert.equal(r.received[0].pace, asset.pace);
  assert.equal(r.sensitivity, undefined);
  for (const assumptions of [
    { bw: { workload: 0.7 } },
    { bw: { development: 1.5 } },
    { bw: { tier: 'early' } },
  ])
    assert.throws(() => analyzeTrade(m, { ...input, assumptions }), /no longer supported/);
});

test('dynasty picks use standard midpoint values without inventing immediate points', () => {
  const m = fixture();
  m.picks = [
    { id: 'pick', kind: 'pick', owner: 'b', name: '2027 first', round: 1, year: 2027, value: 1050 },
  ];
  const r = analyzeTrade(m, {
    ...input,
    sendB: ['pick'],
    includeWaivers: false,
  });
  assert.equal(r.received[0].value, 550);
  assert.equal(r.received[0].redraft, 0);
  assert.equal(r.received[0].pace, undefined);
  assert.equal(r.teamA.current.change, -1500);
  m.settings.mode = 'redraft';
  assert.throws(() => analyzeTrade(m, { ...input, sendB: ['pick'] }));
});
test('finder produces league-owned actionable offers with a benefit for each side', () => {
  const m = fixture(),
    before = JSON.stringify(m),
    r = findTrades(m, { goal: 'WR' });
  assert.ok(r.offers.length > 0);
  assert.ok(r.evaluated <= 100);
  for (const offer of r.offers) {
    const result = analyzeTrade(m, offer.input);
    assert.equal(offer.input.teamA, 'a');
    assert.ok(result.teamA.paceChange > 0 || result.teamA.future.change >= 0);
    assert.ok(
      result.teamB.paceChange > 0 ||
        result.teamB.future.change > 0 ||
        result.teamB.current.change > 0,
    );
    assert.ok(offer.reason);
    assert.ok(offer.partnerReason);
  }
  assert.equal(JSON.stringify(m), before);
  assert.throws(() => findTrades(m, { goal: 'unknown' }));
  m.settings.mode = 'redraft';
  assert.throws(() => findTrades(m, { goal: 'picks' }));
});
test('player search shows ownership, handles free agents and escapes imported names', () => {
  const m = fixture();
  m.players[0].name = '<script>alert(1)</script>';
  const html = tradeSearch(m, 'script');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('data-add-side="A"'));
  assert.ok(html.includes('data-add-side="B"'));
  assert.ok(html.includes('data-asset="aq"'));
  assert.ok(!html.includes('<script>'));
  const fa = tradeSearch(m, 'fa');
  assert.ok(fa.includes('Free agent'));
  assert.ok(!fa.includes('data-trade-player="fa"'));
  assert.equal(tradeTools(m, '').includes('Scenario assumptions'), false);
  assert.ok(tradeResult(analyzeTrade(m, input), m).includes('Optimized lineup before / after'));
  assert.ok(finderView(m, findTrades(m, { goal: 'WR' }), 'WR').includes('data-offer'));
});

test('custom public comparisons allow either side without changing ownership or bypassing linked rosters', () => {
  const m = fixture();
  m.linked = false;
  m.settings.mode = 'redraft';
  const before = JSON.stringify(m);
  const reversed = {
    teamA: 'a',
    teamB: 'b',
    sendA: ['bw'],
    sendB: ['aq'],
    customTeams: true,
    includeWaivers: true,
  };
  const result = analyzeTrade(m, reversed);
  assert.equal(result.customTeams, true);
  assert.equal(result.sent[0].id, 'bw');
  assert.equal(result.received[0].id, 'aq');
  assert.equal(result.teamA.roster.replacements.length, 0);
  assert.equal(JSON.stringify(m), before);
  assert.throws(() => analyzeTrade(m, { ...reversed, sendB: ['bw'] }), /only once/);
  assert.throws(() => analyzeTrade(m, { ...reversed, sendA: ['unknown'] }), /no longer/);
  assert.equal(analyzeTrade({ ...m, linked: true }, reversed).customTeams, true);
  assert.throws(
    () => analyzeTrade({ ...m, linked: true }, { ...reversed, customTeams: false }),
    /no longer/,
  );
  assert.equal(tradeResult(result, m).includes('Roster consequences'), false);
});

test('linked custom dynasty comparisons retain picks and use dynasty totals without changing imported assets', () => {
  const m = fixture();
  m.linked = true;
  m.picks = [
    {
      id: 'custom-pick',
      kind: 'pick',
      owner: 'b',
      name: '2027 Round 3',
      round: 3,
      teams: 12,
      year: 2027,
    },
  ];
  m.players[0].dynasty = 900;
  const before = JSON.stringify(m);
  const input = {
    teamA: 'a',
    teamB: 'b',
    sendA: ['custom-pick', 'bw'],
    sendB: ['aq'],
    customTeams: true,
  };
  const result = analyzeTrade(m, input);
  assert.equal(result.sent.length, 2);
  assert.ok(result.sent.some((a) => a.kind === 'pick' && a.value > 0));
  assert.equal(result.teamA.roster.replacements.length, 0);
  assert.ok(tradeResult(result, m).includes('using dynasty values'));
  assert.equal(JSON.stringify(m), before);
  assert.throws(() => analyzeTrade(m, { ...input, customTeams: false }), /no longer/);
  assert.throws(
    () => analyzeTrade({ ...m, settings: { ...m.settings, mode: 'redraft' } }, input),
    /only valued in dynasty/,
  );
});

test('custom comparison format is request-scoped, validated, and applied to displayed asset values', () => {
  const m = fixture();
  m.linked = true;
  m.players[0].dynasty = 2300;
  const original = JSON.stringify(m);
  const request = { ...input, customTeams: true, comparisonMode: 'redraft' };
  const redraft = analyzeTrade(m, request);
  const dynasty = analyzeTrade(m, { ...request, comparisonMode: 'dynasty' });
  assert.equal(redraft.settings.mode, 'redraft');
  assert.equal(redraft.sent[0].value, m.players[0].redraft);
  assert.equal(dynasty.sent[0].value, 2300);
  assert.equal(JSON.stringify(m), original);
  assert.throws(() => analyzeTrade(m, { ...request, comparisonMode: 'invalid' }), /valid format/);
  assert.throws(() => analyzeTrade(m, { ...request, customTeams: false }), /valid format/);
  for (const result of [redraft, dynasty, analyzeTrade(m, input)]) {
    const html = tradeResult(result, m);
    assert.ok(html.includes('<h4>Sends</h4>'));
    assert.ok(html.includes('<h4>Receives</h4>'));
    assert.ok(html.includes('<strong>aq</strong>'));
    assert.ok(html.includes('<strong>bw</strong>'));
  }
  const unsafe = { ...dynasty, sent: [{ ...dynasty.sent[0], name: '<script>test</script>' }] };
  assert.equal(tradeResult(unsafe, m).includes('<script>test</script>'), false);
});
