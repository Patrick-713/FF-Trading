/** Pure trade calculations. These functions never submit trades or update imported rosters. */
import { MODEL_VERSION } from './model-version.js';
import { invalid } from '../http/errors.js';
import { lineup, pickValue } from './valuation.js';
const round = (n) => Math.round(n * 10) / 10;
const sum = (list, key = 'value') => list.reduce((s, a) => s + (a[key] || 0), 0);
const isPlayer = (a) => a.kind !== 'pick';
const hasProspectData = (asset) =>
  asset.prospect && asset.prospect.source !== 'Limited metadata prior';
const verdict = (n) => (Math.abs(n) <= 10 ? 'Balanced' : n > 0 ? 'Favors you' : 'Favors partner');

/** Use the model's standard values, including the default midpoint for unknown pick slots. */
function standardAsset(asset, model) {
  if (asset.kind === 'pick')
    return {
      ...asset,
      value: pickValue(asset, model.settings, model.season),
      dynasty: pickValue(asset, { ...model.settings, mode: 'dynasty' }, model.season),
      redraft: 0,
    };
  const redraft = Math.round(asset.redraft ?? asset.value),
    dynasty = Math.round(asset.dynasty ?? asset.value);
  return {
    ...asset,
    redraft,
    dynasty,
    value: model.settings.mode === 'dynasty' ? dynasty : redraft,
  };
}
/** Calculate one team's hypothetical lineup, cuts, replacements and value changes. */
function rosterReport(model, assets, id, outgoing, incoming, options = {}) {
  const team = model.teams.find((t) => t.id === id),
    before = assets.filter((a) => a.owner === id);
  // IR and taxi players do not count against active capacity and cannot be auto-started/cut.
  const protectedIds = new Set(team.protectedIds || []);
  const active = (list) => list.filter((a) => isPlayer(a) && !protectedIds.has(a.id));
  const beforeActive = active(before),
    beforeLineup = lineup(beforeActive, model.slots);
  let after = [
    ...before.filter((a) => !outgoing.some((o) => o.id === a.id)),
    ...incoming.map((a) => ({ ...a, owner: id })),
  ];
  // Incoming reserves default to active: actual IR/taxi eligibility needs league review.
  for (const a of incoming) protectedIds.delete(a.id);
  const capacity =
    Number.isInteger(team.rosterLimit) && team.rosterLimit > 0 ? team.rosterLimit : null;
  const requiredCuts = capacity ? Math.max(0, active(after).length - capacity) : 0,
    cuts = [],
    replacements = [];
  for (let i = 0; i < requiredCuts; i++) {
    const current = active(after),
      pace = lineup(current, model.slots).pace;
    const candidate = current
      .map((p) => ({
        p,
        loss:
          pace -
          lineup(
            current.filter((a) => a.id !== p.id),
            model.slots,
          ).pace,
      }))
      .sort(
        (a, b) => a.loss - b.loss || a.p.value - b.p.value || a.p.id.localeCompare(b.p.id),
      )[0]?.p;
    if (!candidate) break;
    cuts.push(candidate);
    after = after.filter((a) => a.id !== candidate.id);
  }
  const opened = Math.max(0, beforeActive.length - active(after).length);
  let pool = assets.filter(
    (a) =>
      a.owner === 'free_agent' &&
      isPlayer(a) &&
      !options.claimed?.has(a.id) &&
      (!model.data?.prospectOnly || hasProspectData(a)),
  );
  // Fill only trade-created openings, never unrelated pre-existing vacancies.
  if (options.waivers !== false)
    for (let i = 0; i < opened; i++) {
      const current = active(after),
        pace = lineup(current, model.slots).pace;
      const candidate = pool
        .map((p) => ({ p, gain: lineup([...current, p], model.slots).pace - pace }))
        .sort(
          (a, b) => b.gain - a.gain || b.p.value - a.p.value || a.p.id.localeCompare(b.p.id),
        )[0]?.p;
      if (!candidate) break;
      replacements.push(candidate);
      after.push({ ...candidate, owner: id });
      pool = pool.filter((p) => p.id !== candidate.id);
      options.claimed?.add(candidate.id);
    }
  const afterActive = active(after),
    afterLineup = lineup(afterActive, model.slots);
  const metric = (key) => ({
    before: sum(before, key),
    after: sum(after, key),
    change: sum(after, key) - sum(before, key),
  });
  const paceAvailable = model.data?.productionAvailable !== false;
  const current = paceAvailable ? metric('redraft') : { before: null, after: null, change: null },
    future = metric('dynasty');
  const ages = (list) => {
    const known = list.filter((p) => Number.isFinite(p.age));
    return known.length ? round(sum(known, 'age') / known.length) : null;
  };
  return {
    team: id,
    beforeValue: sum(before),
    afterValue: sum(after),
    valueChange: sum(after) - sum(before),
    exchangeValueChange: sum(incoming) - sum(outgoing),
    paceAvailable,
    beforePace: paceAvailable ? beforeLineup.pace : null,
    afterPace: paceAvailable ? afterLineup.pace : null,
    paceChange: paceAvailable ? round(afterLineup.pace - beforeLineup.pace) : null,
    current,
    future,
    beforeLineup,
    afterLineup,
    roster: {
      capacity,
      beforeCount: beforeActive.length,
      afterCount: afterActive.length,
      requiredCuts,
      cuts,
      replacements,
      unfilled: Math.max(0, opened - replacements.length),
      protectedCount: protectedIds.size,
      waivers: options.waivers !== false,
    },
    depth: {
      before: beforeLineup.bench.length,
      after: afterLineup.bench.length,
      beforeValue: sum(beforeLineup.bench),
      afterValue: sum(afterLineup.bench),
    },
    age: { before: ages(before.filter(isPlayer)), after: ages(after.filter(isPlayer)) },
    positions: Object.fromEntries(
      ['QB', 'RB', 'WR', 'TE'].map((pos) => [
        pos,
        {
          before: beforeActive.filter((a) => a.position === pos).length,
          after: afterActive.filter((a) => a.position === pos).length,
        },
      ]),
    ),
  };
}
function compare(model, input) {
  const assets = [...model.players, ...model.picks].map((a) => standardAsset(a, model));
  const a = input.sendA.map((id) => assets.find((p) => p.id === id)),
    b = input.sendB.map((id) => assets.find((p) => p.id === id));
  const options = { waivers: input.includeWaivers !== false, claimed: new Set() };
  const give = sum(a),
    get = sum(b),
    difference = round(((get - give) / Math.max((get + give) / 2, 1)) * 100);
  return {
    sent: a,
    received: b,
    give,
    get,
    difference,
    teamA: rosterReport(model, assets, input.teamA, a, b, options),
    teamB: rosterReport(model, assets, input.teamB, b, a, options),
  };
}
/** Validate both sides and compare the standard model values without manual adjustments. */
export function analyzeTrade(model, input) {
  if (input?.comparisonMode !== undefined) {
    if (input.customTeams !== true || !['redraft', 'dynasty'].includes(input.comparisonMode))
      throw invalid('Choose a valid format for a custom comparison.');
    model = { ...model, settings: { ...model.settings, mode: input.comparisonMode } };
  }
  if (
    !input ||
    input.teamA === input.teamB ||
    !model.teams.some((t) => t.id === input.teamA) ||
    !model.teams.some((t) => t.id === input.teamB)
  )
    throw invalid('Choose two different teams.');
  const { sendA, sendB } = input;
  if (
    !Array.isArray(sendA) ||
    !Array.isArray(sendB) ||
    !sendA.length ||
    !sendB.length ||
    sendA.length + sendB.length > 40
  )
    throw invalid('Select at least one asset on each side (maximum 40).');
  if (input.customTeams !== undefined && typeof input.customTeams !== 'boolean')
    throw invalid('Invalid comparison setting.');
  const ids = [...sendA, ...sendB];
  if (input.customTeams) {
    // Build an ephemeral comparison from selected assets only. Never write to imported rosters.
    model = {
      ...model,
      teams: model.teams
        .filter((t) => [input.teamA, input.teamB].includes(t.id))
        .map((t) => ({
          ...t,
          name: t.id === input.teamA ? 'Team A' : 'Team B',
          rosterLimit: null,
          protectedIds: [],
        })),
      players: model.players
        .filter((p) => ids.includes(p.id))
        .map((p) => ({ ...p, owner: sendA.includes(p.id) ? input.teamA : input.teamB })),
      picks: model.picks
        .filter((p) => ids.includes(p.id))
        .map((p) => ({ ...p, owner: sendA.includes(p.id) ? input.teamA : input.teamB })),
    };
    input = { ...input, includeWaivers: false };
  }
  const assets = [...model.players, ...model.picks];
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length)
    throw invalid('An asset can appear only once.');
  for (const [list, owner] of [
    [sendA, input.teamA],
    [sendB, input.teamB],
  ])
    for (const id of list) {
      const asset = assets.find((a) => a.id === id && a.owner === owner);
      if (!asset) throw invalid('An asset is no longer on the selected team. Refresh your league.');
      if (model.data?.prospectOnly && asset.kind !== 'pick' && !hasProspectData(asset))
        throw invalid(
          'This player has no verified prospect metadata or completed-game production in the saved snapshot. Compare supported prospects or picks, or refresh league data.',
        );
      if (asset.kind === 'pick' && model.settings.mode !== 'dynasty')
        throw invalid('Draft picks are only valued in dynasty mode.');
    }
  if (input.includeWaivers !== undefined && typeof input.includeWaivers !== 'boolean')
    throw invalid('Invalid waiver setting.');
  if (
    input.assumptions !== undefined &&
    (!input.assumptions ||
      typeof input.assumptions !== 'object' ||
      Array.isArray(input.assumptions) ||
      Object.keys(input.assumptions).length)
  )
    throw invalid('Manual value adjustments are no longer supported. Use standard model values.');
  const r = compare(model, input);
  return {
    ...r,
    modelVersion: MODEL_VERSION,
    dataSnapshot: {
      refreshedAt: model.data?.refreshedAt || null,
      statsFetched: model.data?.fetched || null,
      season: model.data?.season || model.season,
      throughWeek: model.data?.throughWeek ?? null,
    },
    settings: model.settings,
    customTeams: input.customTeams === true,
    verdict: verdict(r.difference),
    summary:
      Math.abs(r.difference) <= 10
        ? 'Values are within 10%'
        : r.difference > 0
          ? input.customTeams
            ? 'Team B sends more model value'
            : 'You receive more model value'
          : input.customTeams
            ? 'Team A sends more model value'
            : 'Your partner receives more model value',
    notes: input.customTeams
      ? [
          'Custom asset comparison only. Actual rosters, starter lineups, cuts and waiver additions are not modeled.',
          'Player values are model estimates, not forecasts. Nothing is submitted to Sleeper.',
        ]
      : [
          ...(model.data?.prospectOnly
            ? [
                'Prospect-only dynasty comparison. Starter pace and current-production comparisons are unavailable.',
              ]
            : []),
          'A hypothetical comparison only. Nothing is submitted to Sleeper.',
          'Starter pace uses past weekly production, not a rest-of-season forecast.',
          'Cuts minimize starter-pace loss, then model value. Waiver suggestions assume availability and are not claims. Incoming players use active spots; IR/taxi eligibility needs review.',
          ...(!r.teamA.roster.capacity || !r.teamB.roster.capacity
            ? [
                'Active roster capacity is unavailable for at least one team; required cuts cannot be verified.',
              ]
            : []),
        ],
  };
}

export const tradeGoals = ['WR', 'RB', 'QB', 'TE', 'younger', 'picks', 'contend', 'rebuild'];
/** Search a bounded set of offers that advance a goal and benefit the other manager. */
export function findTrades(model, input = {}) {
  const goal = input.goal || 'WR';
  if (!tradeGoals.includes(goal)) throw invalid('Choose a valid trade goal.');
  if (goal === 'picks' && model.settings.mode !== 'dynasty')
    throw invalid('Switch to dynasty to collect draft picks.');
  if (goal === 'contend' && model.data?.productionAvailable === false)
    return {
      goal,
      offers: [],
      evaluated: 0,
      note: 'Starter improvement cannot be estimated without completed-game production. Choose a dynasty prospect or pick goal.',
    };
  const assets = [...model.players, ...model.picks].filter(
      (asset) => !model.data?.prospectOnly || asset.kind === 'pick' || hasProspectData(asset),
    ),
    own = assets.filter((a) => a.owner === model.ownTeam);
  const candidates = [];
  const score = (r) => {
    const a = r.teamA;
    if (['WR', 'RB', 'QB', 'TE'].includes(goal))
      return (
        sum(r.received.filter((p) => p.position === goal)) -
        sum(r.sent.filter((p) => p.position === goal))
      );
    if (goal === 'picks')
      return (
        sum(r.received.filter((p) => p.kind === 'pick')) -
        sum(r.sent.filter((p) => p.kind === 'pick'))
      );
    if (goal === 'younger')
      return a.age.before !== null && a.age.after !== null ? (a.age.before - a.age.after) * 500 : 0;
    return goal === 'contend' ? a.paceChange * 100 : a.future.change;
  };
  // Bound search: singles and two-for-one packages, pre-filter by exchange value.
  const ownPool = [...own].sort((a, b) => b.value - a.value).slice(0, 28);
  for (const team of model.teams.filter((t) => t.id !== model.ownTeam)) {
    const other = assets
      .filter((a) => a.owner === team.id)
      .sort((a, b) => b.value - a.value)
      .slice(0, 28);
    const targets = other
      .filter((a) =>
        ['WR', 'RB', 'QB', 'TE'].includes(goal)
          ? a.position === goal
          : goal === 'picks'
            ? a.kind === 'pick'
            : true,
      )
      .slice(0, 12);
    const packages = (list) => {
      const out = list.map((a) => [a]);
      for (let i = 0; i < Math.min(list.length, 14); i++)
        for (let j = i + 1; j < Math.min(list.length, 14); j++) out.push([list[i], list[j]]);
      return out;
    };
    const tryOffer = (send, receive) => {
      const difference = Math.abs(sum(send) - sum(receive)) / Math.max(sum(send), sum(receive), 1);
      if (difference > 0.2) return;
      // Remove exchanges that cannot serve the requested goal before the expensive roster pass.
      if (
        ['WR', 'RB', 'QB', 'TE'].includes(goal) &&
        sum(receive.filter((p) => p.position === goal)) <=
          sum(send.filter((p) => p.position === goal))
      )
        return;
      if (
        goal === 'picks' &&
        sum(receive.filter((p) => p.kind === 'pick')) <= sum(send.filter((p) => p.kind === 'pick'))
      )
        return;
      if (goal === 'contend' && !receive.some(isPlayer)) return;
      if (goal === 'younger') {
        const roster = own.filter(isPlayer),
          after = [
            ...roster.filter((p) => !send.some((s) => s.id === p.id)),
            ...receive.filter(isPlayer),
          ];
        const known = roster.filter((p) => Number.isFinite(p.age)),
          next = after.filter((p) => Number.isFinite(p.age));
        if (
          !known.length ||
          !next.length ||
          sum(next, 'age') / next.length >= sum(known, 'age') / known.length
        )
          return;
      }
      if (
        goal === 'rebuild' &&
        sum(receive, 'dynasty') <= sum(send, 'dynasty') &&
        !receive.some((p) => p.kind === 'pick')
      )
        return;
      candidates.push({
        input: {
          teamA: model.ownTeam,
          teamB: team.id,
          sendA: send.map((a) => a.id),
          sendB: receive.map((a) => a.id),
          includeWaivers: input.includeWaivers !== false,
        },
        distance: difference,
      });
    };
    for (const target of targets) for (const pack of packages(ownPool)) tryOffer(pack, [target]);
    // Also explore consolidation from the partner's side.
    for (const offer of ownPool.slice(0, 14))
      for (const pack of packages(other).filter(
        (p) => p.length === 2 && p.some((a) => targets.some((t) => t.id === a.id)),
      ))
        tryOffer([offer], pack);
  }
  const seen = new Set(),
    perTeam = new Map(),
    shortlist = candidates
      .sort((a, b) => a.distance - b.distance)
      .filter((c) => {
        const key =
          c.input.teamB +
          c.input.sendA.slice().sort().join(',') +
          '>' +
          c.input.sendB.slice().sort().join(',');
        if (seen.has(key)) return false;
        seen.add(key);
        const count = perTeam.get(c.input.teamB) || 0;
        if (count >= Math.max(8, Math.ceil(100 / Math.max(1, model.teams.length - 1))))
          return false;
        perTeam.set(c.input.teamB, count + 1);
        return true;
      })
      .slice(0, 100);
  const offers = [];
  for (const c of shortlist) {
    const r = analyzeTrade(model, c.input),
      gain = score(r),
      partner = r.teamB;
    // Both sides need a measurable benefit, without a large modeled roster-value loss.
    const partnerBenefit =
      partner.paceChange > 0 || partner.future.change > 0 || partner.current.change > 0;
    if (
      gain <= 0 ||
      !partnerBenefit ||
      r.teamA.valueChange < -Math.max(r.give * 0.25, 100) ||
      partner.valueChange < -Math.max(r.get * 0.25, 100)
    )
      continue;
    const reason =
      goal === 'younger'
        ? `Your average roster age changes ${r.teamA.age.before} → ${r.teamA.age.after}.`
        : goal === 'contend'
          ? `Your starter pace changes ${r.teamA.paceChange > 0 ? '+' : ''}${r.teamA.paceChange} points/week.`
          : goal === 'rebuild'
            ? `Your dynasty value changes +${r.teamA.future.change}.`
            : goal === 'picks'
              ? `You add ${score(r)} net draft-pick value.`
              : `Your ${goal} room gains ${Math.round(gain)} exchange value.`;
    const partnerReason = `Partner: ${partner.paceChange > 0 ? '+' + partner.paceChange + ' starter points/week' : partner.future.change > 0 ? '+' + partner.future.change + ' dynasty value' : '+' + partner.current.change + ' current value'}.`;
    offers.push({ input: c.input, result: r, reason, partnerReason, score: gain });
  }
  const counts = new Map();
  const diverse = offers
    .sort((a, b) => b.score - a.score)
    .filter((o) => {
      const id = o.input.teamB,
        n = counts.get(id) || 0;
      counts.set(id, n + 1);
      return n < 2;
    })
    .slice(0, 8);
  return {
    goal,
    offers: diverse,
    evaluated: shortlist.length,
    note: 'Bounded search of singles and two-for-one packages within 20% exchange value. Suggestions are model-based starting points; manager preferences and willingness to trade are unknown.',
  };
}
