/** Trade view templates. Dynamic provider and user text is escaped before it is inserted into HTML. */
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const fmt = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n),
  signed = (n) => (n === null || n === undefined ? 'Unavailable' : `${n > 0 ? '+' : ''}${fmt(n)}`);
const change = (n) =>
  `<strong class="${n === null || n === undefined ? 'muted' : n >= 0 ? 'positive' : 'negative'}">${signed(n)}</strong>`;
/** Search the imported player pool and keep ownership visible in each result. */
export function tradeSearch(model, query = '') {
  const publicPool = model.linked === false,
    customPool = publicPool || model.customTeams;
  const players = model.players
    .filter(
      (p) =>
        !query.trim() ||
        `${p.name} ${p.club} ${p.position}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, query.trim() ? 20 : 6);
  return `${query.trim() ? '' : `<p class="muted">${publicPool ? 'Search all 300 players, or start with a player below. Add anyone to either side.' : 'Search your league or browse a roster below. Custom comparison lets you combine players from different teams.'}</p>`}${
    players
      .map((p) => {
        const team = model.teams.find((t) => t.id === p.owner);
        return `<div class="search-player"><div><strong>${esc(p.name)}</strong><small>${esc(p.position)} · ${esc(p.club)}${!publicPool ? ` · ${esc(team?.name || 'Free agent')}` : ''} · ${fmt(p.value)} value</small></div>${customPool || team ? `<div class="player-side-actions"><button class="trade-button" data-add-side="A" data-asset="${esc(p.id)}" aria-label="Add ${esc(p.name)} to Team A">+ Team A</button><button class="trade-button" data-add-side="B" data-asset="${esc(p.id)}" aria-label="Add ${esc(p.name)} to Team B">+ Team B</button></div>` : `<button class="text-button" data-player="${esc(p.id)}">View stats</button>`}</div>`;
      })
      .join('') || '<p class="empty">No matching players.</p>'
  }`;
}

export function tradeTools(model, query = '') {
  return [
    `<section class="panel trade-tools"><div class="panel-heading"><h2>Add players to either side</h2>`,
    model.linked ? `<button class="trade-button" id="open-finder">Find trade ideas →</button>` : '',
    `</div>`,
    `<div class="link-content"><label for="trade-search">Search all ${model.players.length} players</label>${!model.linked ? `<button class="text-button" data-view="players">Browse all ${model.players.length} players →</button>` : ''}`,
    `<input id="trade-search" type="search" placeholder="Player name, position or NFL team" value="${esc(query)}" autocomplete="off"><div id="trade-search-results" aria-live="polite">${tradeSearch(model, query)}</div>`,
    `</div>`,
    `</section>`,
  ].join('');
}
function lineupTable(before, after, available = true) {
  if (!available)
    return '<p>Starter comparisons are unavailable without completed-game production.</p>';
  return `<div class="lineup-comparison"><div class="lineup-row lineup-labels"><span>Slot</span><span>Before</span><span>After cuts / waivers</span></div>${before.starters.map((s, i) => `<div class="lineup-row"><b>${esc(s.slot)}</b><span>${esc(s.player?.name || 'Empty')}<small>${s.player ? fmt(s.player.pace) : '0'} pts/wk</small></span><span>${esc(after.starters[i]?.player?.name || 'Empty')}<small>${fmt(after.starters[i]?.player?.pace || 0)} pts/wk</small></span></div>`).join('')}</div>`;
}
/** Explain both teams' outcomes, uncertainty and scenario-saving controls. */
export function tradeResult(r, model) {
  const panel = (report) => {
    if (r.customTeams) {
      const totals = model.settings.mode === 'dynasty' ? report.future : report.current;
      return `<article class="panel result-card"><h3>${report.team === r.teamA.team ? 'Team A' : 'Team B'}</h3><div class="result-metric"><span>Asset value sent</span><strong>${fmt(totals.before)}</strong></div><div class="result-metric"><span>Asset value received</span><strong>${fmt(totals.after)}</strong></div><div class="result-metric"><span>Value change</span>${change(totals.change)}</div><p class="muted">Selected assets only, using ${esc(model.settings.mode)} values. Actual rosters, starter lineups and required cuts are not evaluated.</p></article>`;
    }
    const roster = report.roster;
    return [
      `<article class="panel result-card"><h3>${esc(model.teams.find((t) => t.id === report.team)?.name || 'Team')}</h3>`,
      `<div class="horizon-grid"><div><span>Help now · current value</span>${change(report.current.change)}<small>${report.paceAvailable === false ? 'No completed-game production' : fmt(report.current.before) + ' → ' + fmt(report.current.after)}</small></div>`,
      model.settings.mode === 'dynasty'
        ? `<div><span>Long term · dynasty value</span>${change(report.future.change)}<small>${fmt(report.future.before)} → ${fmt(report.future.after)}</small></div>`
        : '',
      `</div>`,
      `<div class="result-metric"><span>Starter pace change</span>${change(report.paceChange)}</div>`,
      `<p>${report.paceAvailable === false ? 'No completed-game production. Starter pace is unavailable.' : fmt(report.beforePace) + ' → ' + fmt(report.afterPace) + ' pts/week · past production'}</p>`,
      `<p>${model.settings.mode === 'dynasty' && report.paceChange > 0 && report.future.change < 0 ? 'Contender trade-off: better starter pace, lower dynasty value.' : model.settings.mode === 'dynasty' && report.paceChange < 0 && report.future.change > 0 ? 'Rebuilding trade-off: more dynasty value, lower starter pace.' : 'Consider both your competitive window and roster depth.'}</p>`,
      `<div class="position-depth">${Object.entries(report.positions)
        .map(([p, n]) => `<span>${p} ${n.before} → ${n.after}</span>`)
        .join('')}</div>`,
      `<h4>Roster consequences</h4>`,
      `<p>Active spots: ${roster.beforeCount} → ${roster.afterCount}${roster.capacity ? ' / ' + roster.capacity : ' · capacity unavailable'}. Bench depth: ${report.depth.before} → ${report.depth.after}.</p>`,
      `<p>${roster.requiredCuts ? `${roster.requiredCuts} required cut${roster.requiredCuts === 1 ? '' : 's'} · Suggested: <b>${roster.cuts.map((p) => esc(p.name)).join(', ')}</b>.` : 'No required cuts identified.'}</p>`,
      `<p>${roster.replacements.length ? `Suggested waiver additions: <b>${roster.replacements.map((p) => esc(p.name)).join(', ')}</b>.` : roster.waivers ? 'No waiver additions suggested.' : 'Waiver additions disabled.'}${roster.unfilled ? ' ' + roster.unfilled + ' trade-created spot(s) remain open.' : ''}</p>`,
      `<div class="result-metric"><span>Net roster value, including cuts / additions</span>${change(report.valueChange)}</div>`,
      `<p>Exchange alone: ${signed(report.exchangeValueChange)}. Bench value: ${fmt(report.depth.beforeValue)} → ${fmt(report.depth.afterValue)}.</p>`,
      `<details><summary>Optimized lineup before / after</summary>${lineupTable(report.beforeLineup, report.afterLineup, report.paceAvailable !== false)}</details>`,
      `</article>`,
    ].join('');
  };
  return [
    `<section class="result-summary"><span class="eyebrow">${esc(r.settings.mode.toUpperCase())} · MODEL ${esc(r.modelVersion || 'legacy')} · ${model.settings.mode === 'dynasty' ? 'BOTH TIME HORIZONS' : 'THIS SEASON'}</span><h2>${esc(r.summary)}</h2>`,
    `<p>${r.customTeams ? 'Team A sends' : 'Send'} ${fmt(r.give)} · ${r.customTeams ? 'Team B sends' : 'Receive'} ${fmt(r.get)} · ${signed(r.difference)}% exchange difference</p>`,
    `</section>`,
    `<div class="trade-builder">${panel(r.teamA)}${panel(r.teamB)}</div>`,
    `<div class="scenario-save"><label for="scenario-title">Scenario name</label>`,
    `<input id="scenario-title" maxlength="80" placeholder="e.g. Improve my WR room"><button class="primary" id="save-scenario">Save this scenario</button>`,
    `</div>`,
    `<p class="method-note">${r.notes.map(esc).join(' ')}</p>`,
  ].join('');
}
export function finderView(model, finder, goal) {
  const goals = {
    WR: 'Improve WR',
    RB: 'Improve RB',
    QB: 'Improve QB',
    TE: 'Improve TE',
    younger: 'Get younger',
    picks: 'Collect dynasty picks',
    contend: 'Improve starters now',
    rebuild: 'Build long-term value',
  };
  return [
    `<div class="page-intro"><div><div class="eyebrow">A PLAN FOR YOUR ACTUAL LEAGUE</div>`,
    `<h1>Trade Finder</h1>`,
    `<p>Choose a goal. Explore offers with a measurable benefit for each roster.</p>`,
    `</div>`,
    `<button class="trade-button" data-view="trade">Back to trade builder</button>`,
    `</div>`,
    `<section class="panel result-card"><label for="trade-goal">Your goal</label>`,
    `<select id="trade-goal">${Object.entries(goals)
      .filter(
        ([id]) =>
          model.settings.mode === 'dynasty' || !['younger', 'picks', 'rebuild'].includes(id),
      )
      .map(
        ([id, name]) =>
          `<option value="${id}" ${id === goal ? 'selected' : ''} ${(id === 'picks' && model.settings.mode !== 'dynasty') || (id === 'contend' && model.data?.productionAvailable === false) ? 'disabled' : ''}>${name}</option>`,
      )
      .join('')}</select>`,
    `<button class="primary" id="find-trades">Find trade ideas ↗</button>`,
    `<p class="muted">${model.settings.mode === 'redraft' ? 'Switch to Dynasty to include draft picks. ' : ''}Offers are starting points, with no claim that another manager will accept.</p>`,
    `<p id="trade-error" class="error" role="alert"></p>`,
    `</section>${
      finder
        ? [
            `<p class="method-note">${esc(finder.note)} Evaluated ${finder.evaluated} candidate offers.</p>`,
            `<div class="saved-grid">${
              finder.offers
                .map((o, i) =>
                  [
                    `<section class="panel result-card"><span class="eyebrow">TRADE WITH ${esc(model.teams.find((t) => t.id === o.input.teamB)?.name)}</span><h3>${esc(o.reason)}</h3>`,
                    `<p><b>Send:</b> ${o.result.sent.map((a) => esc(a.name)).join(' + ')}</p>`,
                    `<p><b>Receive:</b> ${o.result.received.map((a) => esc(a.name)).join(' + ')}</p>`,
                    `<p>${esc(o.partnerReason)}</p>`,
                    `<p>You: ${signed(o.result.teamA.paceChange)} starter pts/wk${model.settings.mode === 'dynasty' ? ` · ${signed(o.result.teamA.future.change)} dynasty value` : ''}</p>`,
                    `<p>Partner: ${signed(o.result.teamB.paceChange)} starter pts/wk · ${signed(o.result.teamB.future.change)} dynasty value</p>`,
                    `<p class="muted">Suggested cuts: you ${o.result.teamA.roster.requiredCuts}, partner ${o.result.teamB.roster.requiredCuts}. Assumed waiver additions: you ${o.result.teamA.roster.replacements.length}, partner ${o.result.teamB.roster.replacements.length}.</p>`,
                    `<button class="trade-button" data-offer="${i}">Explore and adjust →</button>`,
                    `</section>`,
                  ].join(''),
                )
                .join('') ||
              '<section class="panel empty">No offers met this goal and the benefit checks in the bounded search. Try another goal or build your own trade.</section>'
            }</div>`,
          ].join('')
        : '<section class="panel empty">Pick a goal above to search the league.</section>'
    }`,
  ].join('');
}
