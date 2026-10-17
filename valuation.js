/** Valuation functions use relative model units. They are transparent estimates rather than forecasts. */
import { invalid } from './errors.js';
import { prospectProfile } from './prospects.js';
import { scoringSignal } from './redraft-signal.js';
import { draftPickValue } from './draft-values.js';
// FF Trading model v1: transparent heuristic values, not market prices or calibrated forecasts.
export function parseCSV(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if (c === '\n' && !quoted) {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows
    .filter((r) => r.length === headers.length)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h.replace(/^\uFEFF/, ''), r[i]])));
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v, p = 1) => Math.round(v * 10 ** p) / 10 ** p;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Normalize and validate the scoring controls supported by this model. */
export function settingsFor(input = {}, defaults = {}) {
  const out = {
    mode: input.mode || defaults.mode || 'redraft',
    scoring: input.scoring || defaults.scoring || 'ppr',
    superflex: input.superflex ?? defaults.superflex ?? false,
    tePremium: num(input.tePremium ?? defaults.tePremium ?? 0),
    passTD: num(input.passTD ?? defaults.passTD ?? 4),
  };
  if (
    !['dynasty', 'redraft'].includes(out.mode) ||
    !['ppr', 'half', 'standard'].includes(out.scoring) ||
    typeof out.superflex !== 'boolean' ||
    ![4, 6].includes(out.passTD) ||
    ![0, 0.5, 1].includes(out.tePremium)
  )
    throw invalid('Choose valid league format and scoring settings.');
  return out;
}
export function pointsFor(row, s) {
  const rec = s.scoring === 'ppr' ? 1 : s.scoring === 'half' ? 0.5 : 0;
  return (
    num(row.passing_yards) * 0.04 +
    num(row.passing_tds) * s.passTD -
    num(row.passing_interceptions) * 2 +
    num(row.rushing_yards) * 0.1 +
    num(row.rushing_tds) * 6 +
    num(row.receiving_yards) * 0.1 +
    num(row.receiving_tds) * 6 +
    num(row.receptions) * (rec + (row.position === 'TE' ? s.tePremium : 0)) -
    (num(row.rushing_fumbles_lost) + num(row.receiving_fumbles_lost) + num(row.sack_fumbles_lost)) *
      2 +
    (num(row.passing_2pt_conversions) +
      num(row.rushing_2pt_conversions) +
      num(row.receiving_2pt_conversions)) *
      2 +
    num(row.special_teams_tds) * 6 +
    num(row.fg_made) * 3 +
    num(row.pat_made) +
    num(row.def_tackles_solo) +
    num(row.def_tackle_assists) * 0.5 +
    num(row.def_sacks) * 3 +
    num(row.def_interceptions) * 3 +
    num(row.def_pass_defended) +
    num(row.def_tds) * 6 +
    num(row.def_fumbles_forced) * 2
  );
}
/** Combine observed production with an age-adjusted, fading dynasty prospect prior. */
export function valuePlayer(
  player,
  rows,
  s,
  season = new Date().getUTCFullYear(),
  previous = null,
) {
  const games = rows.length,
    score = rows.map((r) => pointsFor(r, s)),
    ppg = games ? score.reduce((a, b) => a + b, 0) / games : 0;
  const recent = score.slice(-4),
    recentPPG = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const sum = (k) => rows.reduce((a, r) => a + num(r[k]), 0),
    avg = (k) => {
      const available = rows.filter((r) => r[k] !== '' && r[k] != null);
      return available.length
        ? available.reduce((a, r) => a + num(r[k]), 0) / available.length
        : null;
    };
  const targets = sum('targets'),
    carries = sum('carries'),
    attempts = sum('attempts');
  const cv =
    games > 1 && ppg > 0
      ? Math.sqrt(score.reduce((a, n) => a + (n - ppg) ** 2, 0) / games) / ppg
      : null;
  const opportunity = games
    ? player.position === 'QB'
      ? attempts / games / 35
      : (carries + 1.5 * targets) / games / 18
    : 0;
  const plays = player.position === 'QB' ? attempts : carries + targets;
  const epa = plays
    ? (sum('passing_epa') + sum('rushing_epa') + sum('receiving_epa')) / plays
    : null;
  const replacement =
    {
      QB: s.superflex ? 12 : 16,
      RB: 7,
      WR: s.scoring === 'standard' ? 6 : 8,
      TE: 5 + s.tePremium * 2,
      K: 5,
    }[player.position] ?? 3;
  const injury = String(player.injury || '').toLowerCase(),
    availability = /ir|injured reserve/.test(injury)
      ? 0.65
      : /out/.test(injury)
        ? 0.8
        : /doubtful/.test(injury)
          ? 0.85
          : /questionable/.test(injury)
            ? 0.95
            : 1;
  const history =
    previous?.season === season - 1 &&
    previous.position === player.position &&
    previous.games >= 4 &&
    player.experience !== 0 &&
    player.draftYear !== season
      ? previous
      : null;
  const previousPPG = history
    ? pointsFor({ ...history.averages, position: player.position }, s)
    : null;
  const signal = scoringSignal(score, previousPPG, history?.games || 0);
  // Starter pace remains observed current-season production, separate from value estimation.
  const pace = signal.current * availability;
  const production = Math.max(0, signal.estimate * availability - replacement) * 110;
  const blend = (current, key) =>
    history?.averages[key] == null
      ? current
      : current * (1 - signal.historyWeight) + history.averages[key] * signal.historyWeight;
  const historicalOpportunity = history
    ? player.position === 'QB'
      ? (history.averages.attempts || 0) / 35
      : ((history.averages.carries || 0) + 1.5 * (history.averages.targets || 0)) / 18
    : 0;
  const weightedOpportunity =
    opportunity * (1 - signal.historyWeight) + historicalOpportunity * signal.historyWeight;
  const usage =
    clamp(weightedOpportunity, 0, 2) * 120 +
    blend(avg('target_share') || 0, 'target_share') * 220 +
    blend(avg('wopr') || 0, 'wopr') * 90;
  const efficiency = epa === null ? 0 : clamp(epa, -0.5, 0.5) * 120;
  const consistency = cv === null ? 0 : clamp(1 - cv, 0, 1) * 80;
  const sampleWeight = clamp((games + (history?.games || 0) * signal.historyWeight) / 4, 0, 1);
  const prior = { 1: 550, 2: 350, 3: 220, 4: 130, 5: 90, 6: 65, 7: 50 }[player.draftRound] ?? 35;
  let redraft = Math.round(
    Math.max(
      10,
      (100 + production + usage + efficiency + consistency) * sampleWeight +
        35 * (1 - sampleWeight),
    ),
  );
  const age = player.age,
    peak = { QB: 29, RB: 24, WR: 26, TE: 27 }[player.position] ?? 26;
  const decay = { QB: 0.04, RB: 0.1, WR: 0.065, TE: 0.055 }[player.position] ?? 0.07;
  const ageFactor =
    age == null
      ? 1
      : clamp(1 + Math.max(0, peak - age) * 0.035 - Math.max(0, age - peak) * decay, 0.35, 1.22);
  const qbPremium = player.position === 'QB' ? (s.superflex ? 1.6 : 0.85) : 1;
  const established = (redraft * 0.85 + prior * 0.35) * sampleWeight + prior * (1 - sampleWeight);
  const prospect = prospectProfile(player, rows, season);
  const longTerm = prospect
    ? Math.max(
        established,
        established * (1 - prospect.priorWeight) + prospect.capital * prospect.priorWeight,
      )
    : established;
  const productionDynasty = established * ageFactor * qbPremium;
  let pickAnchor = null;
  if (prospect?.years === 0 && prospect.rookieDraft) {
    const draft = prospect.rookieDraft;
    const nextPick = draftPickValue(
      {
        overall: draft.overall,
        teams: draft.teams,
        round: Math.ceil(draft.overall / draft.teams),
        year: season + 1,
      },
      { ...s, mode: 'dynasty' },
      season,
    );
    const exposure = Math.max(
      games / 17,
      prospect.opportunities /
        (player.position === 'QB' ? 450 : player.position === 'RB' ? 200 : 150),
    );
    const discount = games ? Math.min(0.35, 0.1 + 0.25 * Math.max(0, (exposure - 0.5) / 0.5)) : 0;
    pickAnchor = {
      year: season + 1,
      overall: draft.overall,
      teams: draft.teams,
      pickValue: nextPick,
      discount: Math.round(discount * 1000) / 1000,
      value: Math.round(nextPick * (1 - discount)),
      source: draft.source || 'Verified league rookie selection',
    };
  }
  const dynasty = Math.round(
    Math.max(
      10,
      pickAnchor ? Math.max(productionDynasty, pickAnchor.value) : longTerm * ageFactor * qbPremium,
    ),
  );
  const confidence =
    games >= 8
      ? 'Higher sample'
      : games >= 4
        ? 'Moderate sample'
        : games
          ? 'Small sample'
          : 'Prospect / metadata estimate';
  return {
    ...player,
    redraft,
    dynasty,
    value: s.mode === 'dynasty' ? dynasty : redraft,
    pace: round(pace),
    confidence: !games && history ? 'Last-season baseline' : confidence,
    games,
    prospect,
    pickAnchor,
    history: history
      ? {
          season: history.season,
          games: history.games,
          ppg: round(previousPPG),
          weight: round(signal.historyWeight, 3),
          team: history.team || null,
        }
      : null,
    stats: {
      ppg: round(ppg),
      recentPPG: round(recentPPG),
      scoringEstimate: round(signal.estimate),
      lastSeasonPPG: history ? round(previousPPG) : null,
      targetsPerGame: games ? round(targets / games) : null,
      carriesPerGame: games ? round(carries / games) : null,
      targetShare: avg('target_share') === null ? null : round(avg('target_share') * 100),
      wopr: avg('wopr') === null ? null : round(avg('wopr'), 2),
      adot: targets ? round(sum('receiving_air_yards') / targets) : null,
      epaPerOpportunity: epa === null ? null : round(epa, 2),
      consistency: cv === null ? null : round(clamp(1 - cv, 0, 1) * 100),
      yardsPerTouch:
        carries + sum('receptions')
          ? round((sum('rushing_yards') + sum('receiving_yards')) / (carries + sum('receptions')))
          : null,
    },
    breakdown: {
      production: Math.round(production),
      opportunity: Math.round(usage),
      efficiency: Math.round(efficiency),
      consistency: Math.round(consistency),
      ageFactor: round(ageFactor, 2),
      draftPrior: prior,
    },
    notes: [
      ...(pickAnchor
        ? [
            `Dynasty pick anchor: ${pickAnchor.year} rookie pick #${pickAnchor.overall}, ${pickAnchor.pickValue} value with a ${Math.round(pickAnchor.discount * 100)}% evidence discount. Established production can exceed this estimate.`,
          ]
        : []),
      ...(prospect
        ? [
            `Prospect prior: ${prospect.source}; ${Math.round(prospect.priorWeight * 100)}% retained weight. Limited NFL production does not erase draft capital.`,
          ]
        : []),
      ...(!games
        ? [
            history
              ? `No current-season games. Value uses ${history.season} history; this is not current production.`
              : 'No matched weekly stats: value is a low-confidence metadata estimate.',
          ]
        : []),
      ...(age == null ? ['Age unavailable; neutral dynasty age adjustment.'] : []),
      ...(player.draftRound == null ? ['NFL draft round unavailable; neutral draft prior.'] : []),
      ...(injury ? [`Availability adjustment for listed status: ${player.injury}.`] : []),
    ],
  };
}
/** Estimate future draft capital from round, year, format and assumed pick position. */
export function pickValue(pick, settings, season, tier = 'mid') {
  return draftPickValue(pick, settings, season, tier);
}
export function pickInventory(snapshot) {
  const rounds = Number(snapshot.league.draftRounds),
    season = Number(snapshot.league.season);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10 || snapshot.league.type !== 2)
    return [];
  const traded = snapshot.tradedPicks || [],
    years = [
      ...new Set([
        season + 1,
        season + 2,
        season + 3,
        ...traded.map((p) => Number(p.season)).filter((y) => y > season && y <= season + 5),
      ]),
    ];
  const picks = [];
  for (const year of years)
    for (const team of snapshot.teams)
      for (let r = 1; r <= rounds; r++) {
        const move = traded.find(
          (p) =>
            Number(p.season) === year &&
            Number(p.round) === r &&
            Number(p.roster_id) === team.rosterId,
        );
        const owner = move ? `sl_${move.owner_id}` : team.id;
        picks.push({
          id: `pick_${year}_${r}_${team.rosterId}`,
          kind: 'pick',
          name: `${year} Round ${r}`,
          year,
          round: r,
          teams: snapshot.teams.length,
          owner,
          originalTeam: team.name,
          tier: 'mid',
          estimated: true,
        });
      }
  return picks;
}
function eligible(position, slot) {
  if (['FLEX', 'WRRB_FLEX', 'RB_WR_TE'].includes(slot))
    return ['RB', 'WR', 'TE'].includes(position);
  if (['SUPER_FLEX', 'OP'].includes(slot)) return ['QB', 'RB', 'WR', 'TE'].includes(position);
  if (['REC_FLEX', 'WR_TE'].includes(slot)) return ['WR', 'TE'].includes(position);
  if (slot === 'IDP_FLEX') return ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'].includes(position);
  return position === slot || (slot === 'DEF' && position === 'DST');
}
// Hungarian assignment with dummy empty spots: optimizes weekly pace without using a player twice.
export function lineup(players, slots) {
  const n = slots.length,
    m = players.length + n;
  if (!n) return { pace: 0, starters: [], bench: players };
  const u = Array(n + 1).fill(0),
    v = Array(m + 1).fill(0),
    p = Array(m + 1).fill(0),
    way = Array(m + 1).fill(0);
  const cost = (i, j) =>
    j > players.length
      ? 0
      : eligible(players[j - 1].position, slots[i - 1])
        ? -players[j - 1].pace
        : 1e6;
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = Array(m + 1).fill(Infinity),
      used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= m; j++)
        if (!used[j]) {
          const cur = cost(i0, j) - u[i0] - v[j];
          if (cur < min[j]) {
            min[j] = cur;
            way[j] = j0;
          }
          if (min[j] < delta) {
            delta = min[j];
            j1 = j;
          }
        }
      for (let j = 0; j <= m; j++)
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else min[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const starters = slots.map((slot, i) => ({
    slot,
    player:
      players.find((player, j) => p[j + 1] === i + 1 && eligible(player.position, slot)) || null,
  }));
  const usedIds = new Set(starters.filter((s) => s.player).map((s) => s.player.id));
  return {
    pace: round(starters.reduce((sum, s) => sum + (s.player?.pace || 0), 0)),
    starters,
    bench: players.filter((p) => !usedIds.has(p.id)),
  };
}
export function lineupPace(players, slots) {
  return lineup(players, slots).pace;
}
export { analyzeTrade, findTrades } from './trade-engine.js';
