/** Browser application. Views render the current state; event handlers call the backend API. */
import { tradeTools, tradeSearch, tradeResult, finderView } from './trade-tools.js';
let state,
  model,
  view = 'team',
  busy = false,
  lookupResult = null,
  authMode = 'register',
  partner = null,
  selectedA = new Set(),
  selectedB = new Set(),
  result = null,
  playerQuery = '',
  playerPosition = 'ALL',
  rosterTeam = null;
let assumptions = {},
  includeWaivers = true,
  tradeQuery = '',
  finder = null,
  goal = 'WR';
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
const fmt = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n),
  signed = (n) => (n === null || n === undefined ? 'Unavailable' : `${n > 0 ? '+' : ''}${fmt(n)}`);
/** Send JSON to the backend and keep unexpected-error request IDs visible to the user. */
async function api(path, method = 'GET', body) {
  const r = await fetch(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      (data.error || 'Request failed') +
        (r.status >= 500 && data.requestId ? ' Reference: ' + data.requestId : ''),
    );
  return data;
}
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('visible');
  setTimeout(() => $('#toast').classList.remove('visible'), 4000);
}
function intro(title, text, action = true) {
  return `<div class="page-intro"><div><div class="eyebrow">FANTASY FOOTBALL. CLEARER DECISIONS.</div><h1>${title}</h1><p>${text}</p></div>${action ? (state.connection ? '<button class="primary" data-sync>Refresh league data ↻</button>' : '<button class="primary" data-view="sleeper">Link your league ↗</button>') : ''}</div>`;
}
const currentTeam = () => model.teams.find((t) => t.id === model.ownTeam) || model.teams[0];
function playerTable(players) {
  return [
    `<div class="table-scroll"><table><thead><tr><th>PLAYER</th><th>${model.settings.mode.toUpperCase()} VALUE</th><th>FP / GAME</th><th>TARGET SHARE</th><th>WOPR</th><th>AGE</th><th>SAMPLE</th></tr>`,
    `</thead>`,
    `<tbody>${
      players
        .map((p) =>
          [
            `<tr><td><button class="player-name" data-player="${esc(p.id)}"><span class="position">${esc(p.position)}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.club)}${p.injury ? ' · ' + esc(p.injury) : ''}</small></span></button>`,
            `</td><td data-label="Value"><strong class="value-number">${fmt(p.value)}</strong></td><td data-label="FP / game">${p.games ? fmt(p.stats.ppg) : 'Not available'}</td><td data-label="Target share">${p.stats.targetShare === null ? 'Not available' : fmt(p.stats.targetShare) + '%'}</td><td data-label="WOPR">${p.stats.wopr === null ? 'Not available' : p.stats.wopr}</td><td data-label="Age">${p.age ?? 'Not available'}</td><td data-label="Sample"><span class="sample">${p.games ? p.games + ' games' : 'Estimate'}</span></td></tr>`,
          ].join(''),
        )
        .join('') || '<tr><td colspan="7" class="empty">No players match these filters.</td></tr>'
    }</tbody>`,
    `</table>`,
    `</div>`,
  ].join('');
}
function teamView() {
  const own = currentTeam(),
    team = model.teams.find((t) => t.id === rosterTeam) || own;
  const players = model.players
      .filter((p) => p.owner === team.id)
      .sort((a, b) => b.value - a.value),
    picks = model.picks.filter((p) => p.owner === team.id);
  return [
    `${intro('Know what your roster is worth.', `${model.settings.mode === 'dynasty' ? 'Long-term talent and draft capital' : 'Current production and opportunity'} · ${esc(team.name)}`)}<div class="stats"><article><span>Total roster value</span><h2>${fmt(team.playerValue + team.pickValue)} <small>VALUE</small></h2>`,
    `<p>Players${model.settings.mode === 'dynasty' ? ' + future picks' : ''}</p>`,
    `</article>`,
    `<article><span>Player value</span><h2>${fmt(team.playerValue)}</h2>`,
    `<p>${team.playerCount} rostered players</p>`,
    `</article>`,
    `<article><span>${model.settings.mode === 'dynasty' ? 'Draft capital' : 'Scoring format'}</span><h2>${model.settings.mode === 'dynasty' ? fmt(team.pickValue) : model.settings.scoring.toUpperCase()}</h2>`,
    `<p>${model.settings.mode === 'dynasty' ? `${picks.length} estimated future picks` : model.settings.superflex ? 'Superflex / 2QB' : 'One quarterback'}</p>`,
    `</article>`,
    `<article><span>Optimized starter pace</span><h2>${team.pace === null ? 'Unavailable' : fmt(team.pace)} ${team.pace === null ? '' : '<small>PTS/WK</small>'}</h2>`,
    `<p>Past production, not a forecast</p>`,
    `</article>`,
    `</div>`,
    `<div class="analysis-grid"><section class="panel"><div class="panel-heading"><div><span class="eyebrow">YOUR ROSTER, REVALUED</span><h2>Player breakdown</h2>`,
    `</div>`,
    `<select id="roster-team" aria-label="View team roster">${model.teams.map((t) => `<option value="${esc(t.id)}" ${team.id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`,
    `</div>${playerTable(players)}</section>`,
    `<section class="feature-card decision-card"><span class="eyebrow">BEFORE YOU MAKE A MOVE</span><h2>Explore the trade.<br>Keep the context.</h2>`,
    `<p>Compare players${model.settings.mode === 'dynasty' ? ' and draft picks' : ''}, roster value, position depth, and starter pace on both sides.</p>`,
    `<p>Switch between dynasty and redraft to see how time horizon changes the same players.</p>`,
    `<button class="light-button" data-view="trade">Build a trade →</button>`,
    `</section>`,
    `</div>${model.settings.mode === 'dynasty' ? `<section class="panel picks-panel"><div class="panel-heading"><div><span class="eyebrow">DYNASTY DRAFT CAPITAL</span><h2>Future picks</h2></div><span class="muted">Unknown slots use mid-round estimates</span></div><div class="pick-grid">${picks.map((p) => `<article class="pick-card"><span>${p.year}</span><strong>Round ${p.round}</strong><small>Originally ${esc(p.originalTeam)}</small><b>${fmt(p.value)} VALUE</b><small>Late to early range ${p.low} to ${p.high}</small></article>`).join('') || '<p class="empty">Future picks are not available for this league. Dynasty leagues need draft-round settings and the traded-pick feed; sync Sleeper to refresh.</p>'}</div></section>` : ''}<section class="panel league-panel"><div class="panel-heading"><h2>League roster values</h2>`,
    `</div>`,
    `<div class="league-value-list">${[...model.teams]
      .sort((a, b) => b.playerValue + b.pickValue - (a.playerValue + a.pickValue))
      .map(
        (t, i) =>
          `<button data-roster="${t.id}"><span>${i + 1}</span><strong>${esc(t.name)}</strong><span>${fmt(t.playerValue + t.pickValue)}</span></button>`,
      )
      .join('')}</div>`,
    `</section>`,
  ].join('');
}
function playersView() {
  const players = model.players
    .filter(
      (p) =>
        (playerPosition === 'ALL' || p.position === playerPosition) &&
        `${p.name} ${p.club}`.toLowerCase().includes(playerQuery.toLowerCase()),
    )
    .sort((a, b) => b.value - a.value);
  return `${intro('Every player. Two perspectives.', 'Explore model values and the statistics behind them. Select a player to see the calculation.')}<section class="panel"><div class="panel-heading"><h2>Player values <span class="pill">${players.length}</span></h2><div class="player-filters"><input id="player-query" aria-label="Search players" placeholder="Search player or team" value="${esc(playerQuery)}"><select id="player-position" aria-label="Filter position">${['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB', 'DL', 'DB'].map((p) => `<option ${p === playerPosition ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div><div id="player-results">${playerTable(players)}</div></section>`;
}
function assetList(team, side) {
  const selected = side === 'A' ? selectedA : selectedB;
  const players = model.players.filter((p) => p.owner === team).sort((a, b) => b.value - a.value),
    picks = model.picks.filter((p) => p.owner === team);
  return `<div class="asset-list">${[...players, ...picks].map((a) => `<label class="asset-option"><input type="checkbox" data-side="${side}" value="${esc(a.id)}" ${selected.has(a.id) ? 'checked' : ''}><span class="position">${a.kind === 'pick' ? 'PICK' : esc(a.position)}</span><span class="asset-name"><strong>${esc(a.name)}</strong><small>${a.kind === 'pick' ? `${esc(a.originalTeam)} · unknown slot` : esc(a.club) + ' · ' + (a.games ? a.games + ' games' : 'low-confidence estimate')}</small></span><b>${fmt(a.value)}</b></label>`).join('')}</div>`;
}
function tradeView() {
  if (!partner || !model.teams.some((t) => t.id === partner) || partner === model.ownTeam)
    partner = model.teams.find((t) => t.id !== model.ownTeam)?.id;
  const own = currentTeam();
  return [
    `${intro('Test the trade. See both sides.', `Choose players${model.settings.mode === 'dynasty' ? ' and dynasty picks' : ''} to exchange. This will not alter your real roster.`, false)}${tradeTools(model, selectedA, selectedB, assumptions, includeWaivers, tradeQuery)}<div class="trade-builder"><section class="panel"><div class="panel-heading"><div><span class="eyebrow">YOU SEND</span><h2>${esc(own.name)}</h2>`,
    `</div>`,
    `<span id="sum-A" class="value-number">${assetSum(selectedA)}</span></div>${assetList(own.id, 'A')}</section>`,
    `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">YOU RECEIVE</span><select id="trade-partner" aria-label="Trade partner">${model.teams
      .filter((t) => t.id !== own.id)
      .map(
        (t) =>
          `<option value="${t.id}" ${partner === t.id ? 'selected' : ''}>${esc(t.name)}</option>`,
      )
      .join('')}</select>`,
    `</div>`,
    `<span id="sum-B" class="value-number">${assetSum(selectedB)}</span></div>${assetList(partner, 'B')}</section>`,
    `</div>`,
    `<div class="trade-actions"><p id="trade-error" class="error" role="alert"></p>`,
    `<button class="trade-button" id="clear-trade">Clear selections</button>`,
    `<button class="primary" id="analyze-trade">Analyze trade ↗</button>`,
    `</div>`,
    `<div id="trade-result">${result ? resultView(result) : ''}</div>`,
  ].join('');
}
function assetSum(ids) {
  return fmt(
    [...model.players, ...model.picks]
      .filter((a) => ids.has(a.id))
      .reduce((s, a) => s + a.value, 0),
  );
}
function resultView(r) {
  return tradeResult(r, model);
}
function savedView() {
  return `${intro('Your trade notebook.', 'Saved comparisons stay with your account. Each shows the model and data at the time you saved it.', false)}<div class="saved-grid">${model.saved.map((s) => `<section class="panel result-card"><span class="eyebrow">${esc(s.result.settings.mode)} · Model ${esc(s.result.modelVersion || 'legacy / unversioned')} · ${esc(new Date(s.created).toLocaleString())}</span><h2>${esc(s.title)}</h2><p>${esc(s.result.summary)}</p><div class="result-metric"><span>Roster value change</span><strong>${signed(s.result.teamA.valueChange)}</strong></div><div class="result-metric"><span>Starter pace change</span><strong>${signed(s.result.teamA.paceChange)}${s.result.teamA.paceChange === null ? '' : ' PTS/WK'}</strong></div><button class="trade-button" data-load="${s.id}">Load selections →</button></section>`).join('') || '<section class="panel empty">Build and analyze a trade, then save the scenario here.</section>'}</div>`;
}
function sleeperView() {
  const c = state.connection;
  return [
    `${intro('Bring your real league.', 'Read-only Sleeper import. Your players, trade partners, scoring context, and dynasty draft capital.', false)}${c ? `<section class="panel linked-summary"><div class="panel-heading"><div><span class="eyebrow">SLEEPER CONNECTED</span><h2>${esc(c.league.name)}</h2></div><span class="pill">${esc(c.league.season)}</span></div><div class="link-content"><p>${esc(c.user.username)} · ${model.teams.length} teams · Last sync ${esc(new Date(c.syncedAt).toLocaleString())}</p><div class="link-actions"><button class="primary" data-sync>Sync Sleeper ↻</button><button class="trade-button" id="disconnect">Return to demo</button></div></div></section>` : ''}<section class="panel account-panel"><div class="panel-heading"><h2>Find your leagues</h2>`,
    `<span class="pill">NO PASSWORD</span></div>`,
    `<div class="link-content"><form id="sleeper-lookup"><label for="sleeper-username">Sleeper username</label>`,
    `<input id="sleeper-username" name="username" value="${esc(lookupResult?.user.username || c?.user.username || '')}" maxlength="40" required><label for="sleeper-season">Season (optional)</label>`,
    `<input id="sleeper-season" name="season" type="number" min="2017" max="2100" placeholder="Current NFL season"><button class="primary full" id="lookup-submit">Find my leagues ↗</button>`,
    `<p id="link-error" class="error" role="alert"></p>`,
    `</form>`,
    `<div id="league-results">${leagueResults()}</div>`,
    `<p class="fine-print">Public data lookup does not verify Sleeper ownership. Lineup changes and real trades remain in Sleeper.</p>`,
    `</div>`,
    `</section>`,
  ].join('');
}
function leagueResults() {
  if (!lookupResult) return '';
  return `<div class="results-heading"><span class="eyebrow">CHOOSE A LEAGUE</span><p>${lookupResult.leagues.length} leagues found in ${esc(lookupResult.season)}</p></div>${lookupResult.leagues.map((l) => `<div class="league-option"><div><strong>${esc(l.name)}</strong><small>${esc(l.season)} · ${l.teams} teams</small></div><button class="trade-button" data-link-league="${esc(l.id)}">Link league ↗</button></div>`).join('') || '<p>No NFL leagues found for that season.</p>'}`;
}
// HTML fragments are joined without adding whitespace so formatting preserves the existing markup.
/** Rebuild the active view from the current account, league and analysis state. */
function render() {
  const names = {
    team: 'My Team',
    players: 'Player Values',
    trade: 'Trade Simulator',
    finder: 'Trade Finder',
    saved: 'Saved Scenarios',
    sleeper: 'Link Sleeper',
    account: 'Your account',
  };
  $('#page-name').textContent = names[view];
  $('#account-button').textContent = state.user ? 'My account' : 'Sign up / Log in';
  $('#profile-team').textContent = currentTeam().name;
  $('#profile-avatar').textContent = 'FF';
  $('#profile-mode').textContent = state.user ? state.user.name : 'Guest · save with an account';
  $('#season-label').textContent = String(model.season);
  $('#week').textContent = model.settings.mode.toUpperCase();
  $('#format-switch').innerHTML = [
    `<div class="segmented format-modes"><button data-mode="redraft" class="${model.settings.mode === 'redraft' ? 'selected' : ''}">Redraft</button>`,
    `<button data-mode="dynasty" class="${model.settings.mode === 'dynasty' ? 'selected' : ''}">Dynasty</button>`,
    `</div>`,
    `<div class="format-options"><label>Scoring<select id="scoring" aria-label="Reception scoring"><option value="ppr" ${model.settings.scoring === 'ppr' ? 'selected' : ''}>PPR</option><option value="half" ${model.settings.scoring === 'half' ? 'selected' : ''}>Half PPR</option><option value="standard" ${model.settings.scoring === 'standard' ? 'selected' : ''}>Standard</option></select>`,
    `</label>`,
    `<label>QB format<select id="qb-format" aria-label="Quarterback format"><option value="single" ${!model.settings.superflex ? 'selected' : ''}>1 QB</option><option value="superflex" ${model.settings.superflex ? 'selected' : ''}>Superflex / 2QB</option></select>`,
    `</label>`,
    `<label>Pass TD<select id="pass-td" aria-label="Passing touchdown points"><option ${model.settings.passTD === 4 ? 'selected' : ''}>4</option><option ${model.settings.passTD === 6 ? 'selected' : ''}>6</option></select>`,
    `</label>`,
    `<label>TE bonus<select id="te-premium" aria-label="Tight end reception bonus">${[0, 0.5, 1].map((n) => `<option ${model.settings.tePremium === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`,
    `</label>`,
    `</div>`,
  ].join('');
  document
    .querySelectorAll('.nav')
    .forEach((n) =>
      n.classList.toggle('active', n.dataset.view === (view === 'finder' ? 'trade' : view)),
    );
  const notice = [
    `<div class="data-banner"><span class="dot"></span>${model.linked ? esc(state.connection.league.name) : 'Fictional demo league'} · ${esc(model.data.source)} · Model ${esc(model.modelVersion || 'legacy')} · ${model.data.season}, through week ${model.data.throughWeek} · ${model.data.matched}/${model.data.total} players with matched stats${model.linked ? ` · Analysis refreshed: ${model.data.refreshedAt ? esc(new Date(model.data.refreshedAt).toLocaleString()) : 'Not prepared'}${model.data.stale ? ' · Refresh recommended' : ''} <button class="text-button" data-sync>Refresh league data ↻</button>` : ''} <button class="text-button" id="methodology">How values work ↗</button>`,
    `</div>${model.data.warning ? `<p class="data-warning" role="status">${esc(model.data.warning)}</p>` : ''}`,
  ].join('');
  $('#main').innerHTML =
    notice +
    (view === 'team'
      ? teamView()
      : view === 'players'
        ? playersView()
        : view === 'trade'
          ? tradeView()
          : view === 'finder'
            ? finderView(model, finder, goal)
            : view === 'saved'
              ? savedView()
              : view === 'sleeper'
                ? sleeperView()
                : accountView());
  $('#footer-disclaimer').textContent =
    'Model estimates · No share trading · Simulations do not execute trades';
}
/** Load the account context before reading that account's active analysis. */
async function reload() {
  finder = null;
  assumptions = {};
  tradeQuery = '';
  state = await api('state');
  model = await api('analysis');
}
const tradeInput = () => ({
  teamA: model.ownTeam,
  teamB: partner,
  sendA: [...selectedA],
  sendB: [...selectedB],
  assumptions: Object.fromEntries(
    Object.entries(assumptions).filter(([id]) => selectedA.has(id) || selectedB.has(id)),
  ),
  includeWaivers,
});
async function changeSettings(settings) {
  model = await api('analysis/settings', 'PUT', { ...model.settings, ...settings });
  selectedA.clear();
  selectedB.clear();
  assumptions = {};
  finder = null;
  if (goal === 'picks' && model.settings.mode !== 'dynasty') goal = 'WR';
  result = null;
  render();
}
function showDetails(html) {
  $('#details-content').innerHTML = html;
  $('#details-dialog').showModal();
}
// Route button actions through one delegated click handler.
document.addEventListener('click', async (e) => {
  const close = e.target.closest('[data-close]');
  if (close) {
    close.closest('dialog').close();
    return;
  }
  if (busy || !model) return;
  const nav = e.target.closest('[data-view]');
  if (nav) {
    view = nav.dataset.view;
    render();
    return;
  }
  if (e.target.closest('#open-finder')) {
    view = 'finder';
    render();
    return;
  }
  const player = e.target.closest('[data-trade-player]');
  if (player) {
    const p = model.players.find((p) => p.id === player.dataset.tradePlayer);
    if (p.owner === model.ownTeam) selectedA.add(p.id);
    else {
      if (partner !== p.owner) {
        partner = p.owner;
        selectedB.clear();
        toast('Trade partner selected from player ownership.');
      }
      selectedB.add(p.id);
    }
    result = null;
    render();
    return;
  }
  const mode = e.target.closest('[data-auth-mode]');
  if (mode) {
    authMode = mode.dataset.authMode;
    render();
    return;
  }
  const roster = e.target.closest('[data-roster]');
  if (roster) {
    rosterTeam = roster.dataset.roster;
    view = 'team';
    render();
    return;
  }
  const pbutton = e.target.closest('[data-player]');
  if (pbutton) {
    const p = model.players.find((p) => p.id === pbutton.dataset.player);
    showDetails(
      [
        `<span class="eyebrow">${esc(p.position)} · ${esc(p.club)}</span><h2>${esc(p.name)}</h2>`,
        `<div class="stat-pair"><span>Redraft <b>${p.redraft}</b></span><span>Dynasty <b>${p.dynasty}</b></span></div>`,
        `<p>${esc(p.confidence)} · ${p.games} games · age ${p.age ?? 'unknown'}</p>`,
        `<table><tbody>${Object.entries(p.stats)
          .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v ?? 'Not available'}</td></tr>`)
          .join('')}</tbody>`,
        `</table>${p.prospect ? `<h3>Dynasty prospect protection</h3><p>${esc(p.prospect.source)} · ${Math.round(p.prospect.priorWeight * 100)}% retained weight · ${p.prospect.opportunities} observed opportunities.</p><p>Prospect starting value: ${fmt(p.prospect.capital)} before age/QB adjustments. ${p.prospect.rookieDraft ? `League rookie pick #${p.prospect.rookieDraft.overall}; league context, not consensus ranking.` : 'Verified rookie draft position unavailable; no ranking assumed.'}</p>` : ''}<h3>Model components</h3>`,
        `<p>${Object.entries(p.breakdown)
          .map(([k, v]) => esc(k) + ': ' + v)
          .join(' · ')}</p>`,
        `<p>${p.notes.map(esc).join(' ')}</p>`,
      ].join(''),
    );
    return;
  }
  if (e.target.closest('#methodology,#rules')) {
    showDetails(
      [
        `<span class="eyebrow">TRANSPARENT MODEL · VERSION ${esc(model.modelVersion || 'legacy')}</span><h2>Values, not tokens.</h2>`,
        `<p>${esc(model.methodology)}</p>`,
        `<h3>Redraft</h3>`,
        `<p>60% recent four-game scoring pace + 40% season pace, position baselines, usage, target share, WOPR, efficiency, and consistency. Listed injury statuses receive a simple availability discount, not an injury-duration prediction.</p>`,
        `<h3>Dynasty</h3>`,
        `<p>Adds position-specific age curves and NFL draft capital. Players in their first three NFL seasons retain a prospect prior that fades with tenure, games and opportunities. Verified rookie-only league draft results add limited context; they are not consensus rankings. Strong NFL production can exceed the prior. Age alone never identifies a rookie. Superflex increases QB value. Players without a statistical match receive explicitly low-confidence estimates.</p>`,
        `<h3>Future picks</h3>`,
        `<p>Heuristic round values are 1st 1,050; 2nd 500; 3rd 250; 4th 125. Early picks are +30%, late −25%; each additional future year discounts 15%. These are estimates, not consensus draft rankings. Inventory assumes original picks and applies Sleeper’s traded-pick feed.</p>`,
        `<h3>Scoring and limits</h3>`,
        `<p>The selected scoring preset, passing TD value, and TE reception bonus drive the model. Custom league bonuses, exact D/ST scoring, schedules, snap counts, route participation, and opponent adjustments are not included. Starter pace is optimized past production, not a rest-of-season forecast. Dynasty pick slots are unknown and use mid-round estimates.</p>`,
        `<p>Sources: <a href="https://docs.sleeper.com/" target="_blank" rel="noopener">Sleeper</a> and <a href="https://github.com/nflverse/nflverse-data/releases/tag/stats_player" target="_blank" rel="noopener">nflverse</a>. Stats cache refreshes after six hours; player metadata after 24 hours.</p>`,
      ].join(''),
    );
    return;
  }
  try {
    busy = true;
    if (e.target.closest('#find-trades')) {
      const button = $('#find-trades');
      button.disabled = true;
      button.textContent = 'Searching…';
      try {
        finder = await api('analysis/find', 'POST', { goal, includeWaivers });
        render();
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = 'Find trade ideas ↗';
        }
      }
      return;
    }
    const offer = e.target.closest('[data-offer]');
    if (offer) {
      const o = finder.offers[Number(offer.dataset.offer)];
      partner = o.input.teamB;
      selectedA = new Set(o.input.sendA);
      selectedB = new Set(o.input.sendB);
      assumptions = {};
      includeWaivers = o.input.includeWaivers;
      view = 'trade';
      result = await api('analysis/trade', 'POST', tradeInput());
      render();
      return;
    }
    if (e.target.closest('#reset-assumptions')) {
      assumptions = {};
      result = null;
      render();
      return;
    }
    const newMode = e.target.closest('[data-mode]');
    if (newMode) {
      await changeSettings({ mode: newMode.dataset.mode });
      return;
    }
    const link = e.target.closest('[data-link-league]');
    if (link || e.target.closest('[data-sync],#disconnect')) {
      toast('Updating league data…');
      if (link)
        state = await api('sleeper/link', 'POST', {
          username: lookupResult.user.username,
          leagueId: link.dataset.linkLeague,
        });
      else
        state = await api(
          e.target.closest('#disconnect') ? 'sleeper/disconnect' : 'sleeper/sync',
          'POST',
        );
      model = await api('analysis');
      selectedA.clear();
      selectedB.clear();
      assumptions = {};
      finder = null;
      tradeQuery = '';
      result = null;
      partner = null;
      rosterTeam = null;
      view = 'team';
      render();
      toast('League data updated.');
      return;
    }
    if (e.target.closest('#logout')) {
      await api('auth/logout', 'POST');
      await reload();
      lookupResult = null;
      authMode = 'login';
      view = 'account';
      selectedA.clear();
      selectedB.clear();
      assumptions = {};
      finder = null;
      tradeQuery = '';
      result = null;
      render();
      return;
    }
    if (e.target.closest('#clear-trade')) {
      selectedA.clear();
      selectedB.clear();
      assumptions = {};
      result = null;
      render();
      return;
    }
    if (e.target.closest('#analyze-trade')) {
      result = await api('analysis/trade', 'POST', tradeInput());
      $('#trade-result').innerHTML = resultView(result);
      return;
    }
    if (e.target.closest('#save-scenario')) {
      model = await api('analysis/save', 'POST', {
        ...tradeInput(),
        title: $('#scenario-title').value,
      });
      toast('Scenario saved. Your actual roster is unchanged.');
      return;
    }
    const load = e.target.closest('[data-load]');
    if (load) {
      const s = model.saved.find((s) => s.id === load.dataset.load);
      await changeSettings(s.result.settings);
      partner = s.input.teamB;
      selectedA = new Set(s.input.sendA);
      selectedB = new Set(s.input.sendB);
      assumptions = s.input.assumptions || {};
      includeWaivers = s.input.includeWaivers !== false;
      view = 'trade';
      result = null;
      render();
      toast('Selections loaded. Analyze again against current values.');
      return;
    }
  } catch (error) {
    if ($('#trade-error')) $('#trade-error').textContent = error.message;
    else if ($('#link-error')) $('#link-error').textContent = error.message;
    else toast(error.message);
  } finally {
    busy = false;
  }
});
// Apply selection, assumption and scoring changes from the active view.
document.addEventListener('change', async (e) => {
  if (busy) return;
  const t = e.target;
  if (t.id === 'trade-goal') {
    goal = t.value;
    finder = null;
    render();
    return;
  }
  if (t.matches('[data-assumption]')) {
    const id = t.dataset.asset,
      key = t.dataset.assumption;
    assumptions[id] = {
      ...(assumptions[id] || {}),
      [key]: key === 'tier' ? t.value : Number(t.value),
    };
    result = null;
    $('#trade-result').innerHTML = '';
    return;
  }
  if (t.id === 'include-waivers') {
    includeWaivers = t.checked;
    result = null;
    $('#trade-result').innerHTML = '';
    return;
  }
  if (t.matches('[data-side]')) {
    const set = t.dataset.side === 'A' ? selectedA : selectedB;
    t.checked ? set.add(t.value) : set.delete(t.value);
    $('#sum-A').textContent = assetSum(selectedA);
    $('#sum-B').textContent = assetSum(selectedB);
    result = null;
    const scrolls = [...document.querySelectorAll('.asset-list')].map((n) => n.scrollTop);
    render();
    document.querySelectorAll('.asset-list').forEach((n, i) => (n.scrollTop = scrolls[i] || 0));
    return;
  }
  if (t.id === 'trade-partner') {
    partner = t.value;
    selectedB.clear();
    result = null;
    render();
    return;
  }
  if (t.id === 'roster-team') {
    rosterTeam = t.value;
    render();
    return;
  }
  if (t.id === 'player-position') {
    playerPosition = t.value;
    $('#player-results').innerHTML = playerTable(filteredPlayers());
    return;
  }
  if (['scoring', 'qb-format', 'pass-td', 'te-premium'].includes(t.id)) {
    busy = true;
    try {
      await changeSettings({
        scoring: $('#scoring').value,
        superflex: $('#qb-format').value === 'superflex',
        passTD: Number($('#pass-td').value),
        tePremium: Number($('#te-premium').value),
      });
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
    }
  }
});
const filteredPlayers = () =>
  model.players
    .filter(
      (p) =>
        (playerPosition === 'ALL' || p.position === playerPosition) &&
        `${p.name} ${p.club}`.toLowerCase().includes(playerQuery.toLowerCase()),
    )
    .sort((a, b) => b.value - a.value);
document.addEventListener('input', (e) => {
  if (e.target.id === 'trade-search') {
    tradeQuery = e.target.value;
    $('#trade-search-results').innerHTML = tradeSearch(model, tradeQuery);
  }
  if (e.target.id === 'player-query') {
    playerQuery = e.target.value;
    $('#player-results').innerHTML = playerTable(filteredPlayers());
  }
});
// Handle account and Sleeper lookup forms without navigating away.
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  busy = true;
  const form = e.target,
    button = form.querySelector('button[type="submit"],button.primary');
  if (button) button.disabled = true;
  try {
    if (form.id === 'sleeper-lookup') {
      lookupResult = null;
      $('#league-results').innerHTML = '';
      $('#link-error').textContent = '';
      lookupResult = await api('sleeper/lookup', 'POST', {
        username: $('#sleeper-username').value.trim(),
        season: $('#sleeper-season').value || undefined,
      });
      $('#league-results').innerHTML = leagueResults();
    }
    if (form.id === 'auth-form') {
      const response = await api(
          `auth/${authMode}`,
          'POST',
          Object.fromEntries(new FormData(form)),
        ),
        code = response.recoveryCode;
      delete response.recoveryCode;
      state = response;
      model = await api('analysis');
      lookupResult = null;
      selectedA.clear();
      selectedB.clear();
      assumptions = {};
      finder = null;
      tradeQuery = '';
      result = null;
      render();
      if (code) {
        $('#recovery-code').textContent = code;
        $('#recovery-dialog').showModal();
      }
      toast('Your account is ready.');
    }
  } catch (error) {
    const errorBox = $('#auth-error') || $('#link-error');
    if (errorBox) errorBox.textContent = error.message;
    else toast(error.message);
  } finally {
    busy = false;
    if (button?.isConnected) button.disabled = false;
  }
});
try {
  await reload();
  render();
} catch (error) {
  $('#main').innerHTML =
    `<section class="panel empty">Could not load the analysis workspace: ${esc(error.message)}<br>Refresh to try again.</section>`;
}

function accountView() {
  if (state.user)
    return [
      `${intro('Your league. Your account.', 'Your linked leagues and analyses are saved to your FF Trading account.', false)}<section class="panel account-panel"><div class="panel-heading"><h2>${esc(state.user.name)}</h2>`,
      `<span class="pill positive">SIGNED IN</span></div>`,
      `<div class="link-content"><p>${esc(state.user.email)}</p>`,
      `<p>Log in from another browser using the same FF Trading server to access this workspace. Your Sleeper import is separate from this login.</p>`,
      `<p class="muted">Email is your sign-in identifier; email verification and emailed resets are not enabled. Keep your recovery code somewhere safe.</p>`,
      `<div class="link-actions"><button class="primary" data-view="sleeper">Manage Sleeper link</button>`,
      `<button class="trade-button" id="logout">Log out</button>`,
      `</div>`,
      `<p id="auth-error" class="error" role="alert"></p>`,
      `</div>`,
      `</section>`,
    ].join('');
  const signup = authMode === 'register',
    recovery = authMode === 'recover';
  return [
    `${intro('Keep your edge.', 'Create a free FF Trading account to save your leagues and analyses.', false)}<div class="roster-layout"><section class="panel"><div class="panel-heading"><h2>${signup ? 'Create account' : recovery ? 'Recover your account' : 'Welcome back'}</h2>`,
    `<span class="pill">FREE</span></div>`,
    `<div class="link-content"><div class="segmented"><button data-auth-mode="register" class="${signup ? 'selected' : ''}">Sign up</button>`,
    `<button data-auth-mode="login" class="${authMode === 'login' ? 'selected' : ''}">Log in</button>`,
    `</div>`,
    `<form id="auth-form">${signup ? '<label for="auth-name">Display name</label><input id="auth-name" name="name" autocomplete="nickname" minlength="2" maxlength="60" required>' : ''}<label for="auth-email">Email</label>`,
    `<input id="auth-email" name="email" type="email" autocomplete="username" maxlength="254" required>${recovery ? '<label for="auth-recovery">Saved recovery code</label><input id="auth-recovery" name="recoveryCode" autocomplete="off" maxlength="48" required>' : ''}<label for="auth-password">${recovery ? 'New password' : 'Password'}</label>`,
    `<input id="auth-password" name="password" type="password" autocomplete="${signup || recovery ? 'new-password' : 'current-password'}" minlength="12" maxlength="128" required><p class="fine-print">Use 12 to 128 characters. ${signup ? 'Your current guest workspace and league links will be saved to this account.' : 'Logging in opens the saved workspace for that account.'}</p>`,
    `<button class="primary full" id="auth-submit">${signup ? 'Create free account' : recovery ? 'Reset password' : 'Log in'}</button>`,
    `<p id="auth-error" class="error" role="alert"></p>`,
    `</form>`,
    `<button class="trade-button" data-auth-mode="recover">Forgot password? Use a recovery code</button>`,
    `</div>`,
    `</section>`,
    `<section class="feature-card link-explainer"><span class="eyebrow">YOUR FF TRADING IDENTITY</span><h2>One login.<br>Your analyses.</h2>`,
    `<p>Sign up once. Keep your roster imports, player values and saved trade scenarios.</p>`,
    `<p>Your FF Trading password is separate from Sleeper. We never ask for your Sleeper password.</p>`,
    `<h3>Save your recovery code.</h3>`,
    `<p>You’ll receive a recovery code once at sign-up. It lets you reset a forgotten password without an email service. Email verification and email delivery aren’t enabled.</p>`,
    `<p>This app is currently hosted on this computer. Cross-device access becomes available when the same app and database are hosted online.</p>`,
    `</section>`,
    `</div>`,
  ].join('');
}
