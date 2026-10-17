/** Browser application. Views render the current state; event handlers call the backend API. */
import { NFL_TEAMS, favoriteTeam } from './nfl-teams.js';
import { tradeTools, tradeSearch, tradeResult, finderView } from './trade-tools.js';
let state,
  model,
  view = 'team',
  busy = false,
  lookupResult = null,
  authMode = 'login',
  accountSection = 'identity',
  emailAction = null,
  emailToken = '',
  authNotice = '',
  scoringExpanded = false,
  partner = null,
  selectedA = new Set(),
  selectedB = new Set(),
  result = null,
  playerQuery = '',
  playerPosition = 'ALL',
  rosterTeam = null,
  tradeTeam = null,
  showStandings = false;
let tradeQuery = '',
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
  return `<div class="page-intro"><div><h1>${title}</h1><p>${text}</p></div>${action ? (state.connection ? '' : '<button class="primary" data-account-section="sleeper">Link your league ↗</button>') : ''}</div>`;
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
const tradeOwn = () => model.teams.find((t) => t.id === tradeTeam) || currentTeam();
const tradeModel = () => ({ ...model, ownTeam: tradeOwn().id });
function standingsView() {
  const points = (value) =>
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      value,
    );
  const record = (team) => {
    const games = (team.wins || 0) + (team.losses || 0) + (team.ties || 0);
    return games ? ((team.wins || 0) + (team.ties || 0) / 2) / games : 0;
  };
  const teams = [...model.teams].sort(
    (a, b) =>
      record(b) - record(a) ||
      (b.wins || 0) - (a.wins || 0) ||
      (b.pointsFor ?? -1) - (a.pointsFor ?? -1),
  );
  return `<section class="panel standings-panel" id="league-standings"><div class="panel-heading"><div><span class="eyebrow">YOUR WHOLE LEAGUE</span><h2>League standings</h2></div><button class="text-button" data-standings>Hide standings</button></div><div class="link-content"><p class="muted">Ordered by record, with total points breaking ties. Records and points are from your last Sleeper sync. FF Score is our combined player${model.settings.mode === 'dynasty' ? ' and draft pick' : ''} value.</p><div class="table-scroll"><table><thead><tr><th>RANK</th><th>TEAM</th><th>RECORD</th><th>POINTS FOR</th><th>POINTS AGAINST</th><th>FF SCORE</th><th>ROSTER</th></tr></thead><tbody>${teams.map((t, i) => `<tr><td data-label="Rank">${i + 1}</td><td data-label="Team"><strong>${esc(t.name)}</strong>${t.id === model.ownTeam ? ' (You)' : ''}<small class="standings-manager">${esc(t.manager)}</small></td><td data-label="Record">${t.wins ?? 0} W / ${t.losses ?? 0} L${t.ties ? ` / ${t.ties} T` : ''}</td><td data-label="Points for">${t.pointsFor === null ? 'Sync needed' : points(t.pointsFor)}</td><td data-label="Points against">${t.pointsAgainst === null ? 'Unavailable' : points(t.pointsAgainst)}</td><td data-label="FF Score"><strong>${fmt((t.playerValue || 0) + (t.pickValue || 0))}</strong></td><td><button class="trade-button" data-roster="${esc(t.id)}">View team</button></td></tr>`).join('')}</tbody></table></div></div></section>`;
}
function teamView() {
  const own = currentTeam(),
    team = model.teams.find((t) => t.id === rosterTeam) || own;
  const players = model.players
      .filter((p) => p.owner === team.id)
      .sort((a, b) => b.value - a.value),
    picks = model.picks.filter((p) => p.owner === team.id);
  return [
    `${intro('Team Overview', `${model.settings.mode === 'dynasty' ? 'Long-term talent and draft capital' : 'Current production and opportunity'} · ${esc(team.name)}`)}${model.linked ? `<div class="league-overview-actions"><button class="primary" data-standings aria-expanded="${showStandings}" aria-controls="league-standings">${showStandings ? 'Hide' : 'View all teams and'} standings</button><span>Season points and records for every team</span></div>${showStandings ? standingsView() : ''}` : ''}<div class="stats"><article><span>Total roster value</span><h2>${fmt(team.playerValue + team.pickValue)} <small>VALUE</small></h2>`,
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
    `<p>${model.linked ? 'Your league format is applied automatically. Choose either team in the trade builder.' : 'Try redraft trades with real NFL players on example rosters. Link Sleeper to use your own league.'}</p>`,
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
  return `${intro('Player Values', 'Explore model values and the statistics behind them. Select a player to see the calculation.')}<section class="panel"><div class="panel-heading"><h2>Player values <span class="pill">${players.length}</span></h2><div class="player-filters"><input id="player-query" aria-label="Search players" placeholder="Search player or team" value="${esc(playerQuery)}"><select id="player-position" aria-label="Filter position">${['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB', 'DL', 'DB'].map((p) => `<option ${p === playerPosition ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div><div id="player-results">${playerTable(players)}</div></section>`;
}
function assetList(team, side) {
  const selected = side === 'A' ? selectedA : selectedB;
  const players = model.players.filter((p) => p.owner === team).sort((a, b) => b.value - a.value),
    picks = model.picks.filter((p) => p.owner === team);
  return `<div class="asset-list">${[...players, ...picks].map((a) => `<label class="asset-option"><input type="checkbox" data-side="${side}" value="${esc(a.id)}" ${selected.has(a.id) ? 'checked' : ''}><span class="position">${a.kind === 'pick' ? 'PICK' : esc(a.position)}</span><span class="asset-name"><strong>${esc(a.name)}</strong><small>${a.kind === 'pick' ? `${esc(a.originalTeam)} · unknown slot` : esc(a.club) + ' · ' + (a.games ? a.games + ' games' : 'low-confidence estimate')}</small></span><b>${fmt(a.value)}</b></label>`).join('')}</div>`;
}
function selectedPlayers(side) {
  const ids = side === 'A' ? selectedA : selectedB;
  const assets = [...model.players, ...model.picks].filter((p) => ids.has(p.id));
  return `<div class="selected-trade-assets">${assets.map((p) => `<article class="selected-trade-asset"><div><strong>${esc(p.name)}</strong><small>${esc(p.position || 'PICK')} · ${fmt(p.value)} value</small></div><div class="player-side-actions"><button class="text-button" data-add-side="${side === 'A' ? 'B' : 'A'}" data-asset="${esc(p.id)}" aria-label="Move ${esc(p.name)} to Team ${side === 'A' ? 'B' : 'A'}">Move to ${side === 'A' ? 'B' : 'A'}</button><button class="text-button" data-remove-asset="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button></div></article>`).join('') || `<p class="empty">No players selected. Use + Team ${side} above.</p>`}</div>`;
}
/** Assign a side without duplicates. Linked comparisons swap teams instead of inventing ownership. */
function addPlayerToSide(id, side) {
  const asset = [...model.players, ...model.picks].find((p) => p.id === id);
  if (!asset || !['A', 'B'].includes(side)) return;
  if (model.linked) {
    const owner = model.teams.find((t) => t.id === asset.owner);
    if (!owner) {
      toast('Free agents cannot be traded in a linked league.');
      return;
    }
    const a = tradeOwn().id,
      b = partner || model.teams.find((t) => t.id !== a)?.id;
    partner = b;
    if (owner.id === (side === 'A' ? b : a)) {
      tradeTeam = b;
      partner = a;
      [selectedA, selectedB] = [selectedB, selectedA];
    } else if (owner.id !== (side === 'A' ? a : b)) {
      if (side === 'A') {
        tradeTeam = owner.id;
        selectedA.clear();
      } else {
        partner = owner.id;
        selectedB.clear();
      }
      toast(`Team ${side} changed to ${owner.name}.`);
    }
  }
  const target = side === 'A' ? selectedA : selectedB,
    other = side === 'A' ? selectedB : selectedA;
  other.delete(id);
  target.add(id);
  result = null;
  finder = null;
  view = 'trade';
  $('#details-dialog').close();
  render();
  toast(`${asset.name} added to Team ${side}.`);
}
function tradeView() {
  if (!partner || !model.teams.some((t) => t.id === partner) || partner === tradeOwn().id)
    partner = model.teams.find((t) => t.id !== tradeOwn().id)?.id;
  const own = tradeOwn();
  return [
    `${intro('Trade Simulator', `Choose players${model.settings.mode === 'dynasty' ? ' and dynasty picks' : ''} to exchange. ${model.linked ? 'Uses your Sleeper league format. Your real roster stays unchanged.' : `Search ${model.players.length} real NFL players. Add them to Team A or Team B, then compare the trade. No roster setup needed.`}`, false)}${tradeTools(tradeModel(), tradeQuery)}<div class="trade-builder"><section class="panel"><div class="panel-heading"><div><span class="eyebrow">TEAM A SENDS</span><label class="sr-only" for="trade-team">Team to trade from</label>${model.linked ? `<select id="trade-team" aria-label="Team to trade from">${model.teams.map((t) => `<option value="${esc(t.id)}" ${own.id === t.id ? 'selected' : ''}>${esc(t.name)}${t.id === model.ownTeam && model.linked ? ' (Your team)' : ''}</option>`).join('')}</select>` : '<h2>Team A</h2>'}`,
    `</div>`,
    `<span id="sum-A" class="value-number">${assetSum(selectedA)}</span></div>${selectedPlayers('A')}${model.linked ? `<details class="team-roster-picker"><summary>Choose from this roster</summary>${assetList(own.id, 'A')}</details>` : ''}</section>`,
    `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">TEAM B SENDS</span>${
      model.linked
        ? `<select id="trade-partner" aria-label="Trade partner">${model.teams
            .filter((t) => t.id !== own.id)
            .map(
              (t) =>
                `<option value="${t.id}" ${partner === t.id ? 'selected' : ''}>${esc(t.name)}</option>`,
            )
            .join('')}</select>`
        : '<h2>Team B</h2>'
    }`,
    `</div>`,
    `<span id="sum-B" class="value-number">${assetSum(selectedB)}</span></div>${selectedPlayers('B')}${model.linked ? `<details class="team-roster-picker"><summary>Choose from this roster</summary>${assetList(partner, 'B')}</details>` : ''}</section>`,
    `</div>`,
    `<div class="trade-actions"><p id="trade-error" class="error" role="alert">${!selectedA.size || !selectedB.size ? 'Add at least one player to each side.' : ''}</p>`,
    `<button class="trade-button" id="clear-trade">Clear selections</button>`,
    `<button class="primary" id="analyze-trade" ${!selectedA.size || !selectedB.size ? 'disabled' : ''}>Analyze trade ↗</button>`,
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
/** Saved result assets preserve the names and picks as they were when analyzed. */
function savedTradeSide(saved, side) {
  const recorded = side === 'A' ? saved.result.sent : saved.result.received;
  const assets =
    recorded ||
    (saved.input?.[side === 'A' ? 'sendA' : 'sendB'] || []).map(
      (id) =>
        [...model.players, ...model.picks].find((asset) => asset.id === id) || {
          name: 'Asset no longer in current data',
        },
    );
  return `<section><h3>Team ${side} sends</h3><ul>${assets.map((asset) => `<li><strong>${esc(asset.name)}</strong>${asset.kind === 'pick' ? '<small>Draft pick</small>' : asset.position ? `<small>${esc(asset.position)}${asset.club ? ' · ' + esc(asset.club) : ''}</small>` : ''}</li>`).join('') || '<li>Selections unavailable</li>'}</ul></section>`;
}
function savedView() {
  const stories = state.preferences?.savedStories || [];
  return `${intro('Saved Notes', 'Your trade comparisons and stories to revisit.', false)}
    <section class="saved-section" aria-labelledby="saved-trades-heading"><h2 id="saved-trades-heading">Saved trades <span class="pill">${model.saved.length}</span></h2><div class="saved-grid">${model.saved.map((s) => `<article class="panel result-card"><span class="eyebrow">${esc(s.result.settings.mode)} · Model ${esc(s.result.modelVersion || 'legacy / unversioned')} · ${esc(new Date(s.created).toLocaleString())}</span><h2>${esc(s.title)}</h2><div class="saved-trade-sides">${savedTradeSide(s, 'A')}${savedTradeSide(s, 'B')}</div><p>${esc(s.result.summary)}</p><div class="result-metric"><span>Roster value change</span><strong>${signed(s.result.teamA.valueChange)}</strong></div>${s.result.customTeams ? '' : `<div class="result-metric"><span>Starter pace change</span><strong>${signed(s.result.teamA.paceChange)}${s.result.teamA.paceChange === null ? '' : ' PTS/WK'}</strong></div>`}<button class="trade-button" data-load="${esc(s.id)}">Load selections →</button></article>`).join('') || '<div class="panel empty">Analyze a trade and save it to see the players on both sides here.</div>'}</div></section>
    <section class="saved-section" aria-labelledby="saved-stories-heading"><h2 id="saved-stories-heading">Saved stories <span class="pill">${stories.length}</span></h2><p class="muted">Bookmarks stay here after headlines leave the news feed.</p><div class="news-grid saved-stories">${stories.map((article) => `<article class="news-card"><div class="news-meta"><span>ESPN</span><time datetime="${esc(article.publishedAt)}">${esc(new Date(article.publishedAt).toLocaleDateString())}</time></div><h3><a href="${esc(article.url)}" target="_blank" rel="noopener noreferrer">${esc(article.title)}</a></h3><div class="news-card-actions"><a class="news-read" href="${esc(article.url)}" target="_blank" rel="noopener noreferrer">Read on ESPN ↗</a><button class="story-save" data-story-remove="${esc(article.url)}" aria-label="Remove saved story: ${esc(article.title)}">Remove</button></div></article>`).join('') || '<div class="panel empty">Find a story in NFL News and select Save story. <button class="text-button" data-view="news">Browse NFL News →</button></div>'}</div></section>`;
}

function sleeperView() {
  const c = state.connection;
  return [
    `<div class="account-connections"><h2>Sleeper connection</h2><p class="muted">Import your league to analyze your players, trade partners, and dynasty picks.</p>${c ? `<section class="panel linked-summary"><div class="panel-heading"><div><span class="eyebrow">SLEEPER CONNECTED</span><h2>${esc(c.league.name)}</h2></div><span class="pill">${esc(c.league.season)}</span></div><div class="link-content"><p>${esc(c.user.username)} · ${model.teams.length} teams · Last sync ${esc(new Date(c.syncedAt).toLocaleString())}</p><div class="link-actions"><button class="primary" data-sync>Sync Sleeper ↻</button><button class="trade-button" id="disconnect">Return to demo</button></div></div></section>` : ''}<section class="panel account-panel"><div class="panel-heading"><h2>Find your leagues</h2>`,
    `<span class="pill">NO PASSWORD</span></div>`,
    `<div class="link-content"><form id="sleeper-lookup"><label for="sleeper-username">Sleeper username</label>`,
    `<input id="sleeper-username" name="username" value="${esc(lookupResult?.user.username || c?.user.username || '')}" maxlength="40" required>`,
    `<button class="primary full" id="lookup-submit">Find my leagues ↗</button>`,
    `<p id="link-error" class="error" role="alert"></p>`,
    `</form>`,
    `<div id="league-results">${leagueResults()}</div>`,
    `<p class="fine-print">Public data lookup does not verify Sleeper ownership. Lineup changes and real trades remain in Sleeper.</p>`,
    `</div>`,
    `</section></div>`,
  ].join('');
}
function leagueResults() {
  if (!lookupResult) return '';
  return `<div class="results-heading"><span class="eyebrow">CHOOSE A LEAGUE</span><p>${lookupResult.leagues.length} leagues found in ${esc(lookupResult.season)}</p></div>${lookupResult.leagues.map((l) => `<div class="league-option"><div><strong>${esc(l.name)}</strong><small>${esc(l.season)} · ${l.teams} teams</small></div><button class="trade-button" data-link-league="${esc(l.id)}">Link league ↗</button></div>`).join('') || '<p>No NFL leagues found for that season.</p>'}`;
}
// HTML fragments are joined without adding whitespace so formatting preserves the existing markup.
/** Rebuild the active view from the current account, league and analysis state. */

/** Cosmetic preferences never change fantasy valuations or a linked roster. */
function teamPicker() {
  return (
    '<div class="team-preference"><label for="favorite-team">Favorite NFL team</label><select id="favorite-team" name="favoriteTeam"><option value="">Choose a team (optional)</option>' +
    NFL_TEAMS.map(
      (team) =>
        '<option value="' +
        team.id +
        '"' +
        (state.preferences?.favoriteTeam === team.id ? ' selected' : '') +
        '>' +
        esc(team.name) +
        '</option>',
    ).join('') +
    '</select><p class="preference-note">A team badge and colors for your workspace. You can change this anytime.</p><p id="preference-status" class="preference-status" role="status"></p></div>'
  );
}
function applyFavoriteTheme() {
  const team = favoriteTeam(state.preferences?.favoriteTeam);
  document.documentElement?.setAttribute('data-favorite-team', team?.id || '');
  const mark = $('#brand-mark');
  mark.innerHTML = team ? team.id : 'ff<span>↗</span>';
  mark.classList.toggle('team-mark', Boolean(team));
  mark.title = team ? team.name + ' fan' : 'FF Trading';
  $('#brand-subtitle').textContent = team ? team.id + ' FAN WORKSPACE' : 'ROSTER INTELLIGENCE';
  $('#profile-avatar').textContent = team?.id || 'FF';
}

// News refreshes only while this view is visible. It never changes player valuations.
let newsData = null,
  newsLoading = false,
  newsError = '',
  newsRequestedAt = 0;
function newsView() {
  const date = (value) =>
    new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  return (
    intro('NFL News', 'Latest headlines and updates from ESPN.', false) +
    `<section class="news-toolbar"><div><strong>NFL news</strong><p>Checks for updates every 10 minutes while this tab is open.</p></div><div class="news-toolbar-actions"><button class="trade-button" data-account-section="saved">Saved stories (${state.preferences?.savedStories?.length || 0})</button><button class="light-button" data-news-refresh ${newsLoading ? 'disabled' : ''}>${newsLoading ? 'Checking…' : 'Check for updates'}</button></div></section>
    <p class="news-status" role="status">${newsError ? esc(newsError) : newsData?.checkedAt ? `Last checked ${esc(date(newsData.checkedAt))}.` : newsData ? 'News is temporarily unavailable.' : 'Loading headlines…'}${newsData?.stale ? ' Updates are delayed. Showing the last available headlines.' : ''}</p>
    <div class="news-grid">${(newsData?.articles || []).map((article) => `<article class="news-card"><div class="news-meta"><span>ESPN</span><time datetime="${esc(article.publishedAt)}">${esc(date(article.publishedAt))}</time></div><h2><a href="${esc(article.url)}" target="_blank" rel="noopener noreferrer">${esc(article.title)}</a></h2>${article.summary ? `<details class="news-summary"><summary>Quick summary<span class="sr-only">: ${esc(article.title)}</span></summary><div><p>${esc(article.summary)}</p><small>ESPN article preview</small></div></details>` : '<p class="news-preview-unavailable">Preview unavailable for this story.</p>'}<a class="news-read" href="${esc(article.url)}" target="_blank" rel="noopener noreferrer">Read full article on ESPN ↗<span class="sr-only">: ${esc(article.title)}</span></a><button class="story-save" data-story-save="${esc(article.url)}" aria-pressed="${Boolean(state.preferences?.savedStories?.some((saved) => saved.url === article.url))}" aria-label="${state.preferences?.savedStories?.some((saved) => saved.url === article.url) ? 'Unsave' : 'Save'} story: ${esc(article.title)}">${state.preferences?.savedStories?.some((saved) => saved.url === article.url) ? 'Saved ✓' : 'Save story'}</button></article>`).join('')}</div>
    ${newsData && !newsData.articles.length ? '<p>No recent headlines are available. Please check again later.</p>' : ''}
    <p class="news-credit">Headlines and previews provided by ESPN. Articles open on the publisher’s website. News does not automatically change player values.</p>`
  );
}
async function loadNews() {
  if (newsLoading || Date.now() - newsRequestedAt < 60000) return;
  newsLoading = true;
  newsRequestedAt = Date.now();
  newsError = '';
  if (view === 'news') render();
  try {
    const response = await fetch('/api/news', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('News is unavailable right now. Please try again shortly.');
    newsData = await response.json();
  } catch {
    newsError = 'News is unavailable right now. Please try again shortly.';
  } finally {
    newsLoading = false;
    if (view === 'news') render();
  }
}
setInterval(() => {
  if (view === 'news' && !document.hidden) void loadNews();
}, 600000).unref?.();
document.addEventListener('visibilitychange', () => {
  if (view === 'news' && !document.hidden && Date.now() - newsRequestedAt >= 600000)
    void loadNews();
});
function render() {
  if (view === 'saved') {
    view = 'account';
    accountSection = 'saved';
  }
  const names = {
    team: 'Team Overview',
    players: 'Player Values',
    trade: 'Trade Simulator',
    finder: 'Trade Finder',
    saved: 'Saved Notes',
    news: 'NFL News',
    account: 'Account',
  };
  document.documentElement?.setAttribute('data-view', view);
  $('#page-name').textContent = names[view];
  document.title = `${names[view] || 'Team Overview'} | FF Trading`;
  const sleeperStatus = $('#sleeper-status');
  sleeperStatus.hidden = !state.connection;
  sleeperStatus.textContent = state.connection
    ? `Sleeper linked: ${state.connection.user.username}`
    : '';
  sleeperStatus.innerHTML = state.connection
    ? `<span>Sleeper linked: </span><strong>${esc(state.connection.user.username)}</strong>`
    : '';
  sleeperStatus.title = state.connection ? `Sleeper linked: ${state.connection.user.username}` : '';
  $('#account-button').textContent = state.user ? 'My account' : 'Sign up / Log in';
  $('#profile-team').textContent = currentTeam().name;
  applyFavoriteTheme();
  $('#profile-mode').textContent = state.user ? state.user.name : 'Guest · save with an account';
  $('#season-label').textContent = String(model.season);
  $('#week').textContent = model.settings.mode.toUpperCase();
  $('#format-switch').innerHTML = [
    `<div class="league-format-label"><strong>${model.settings.mode === 'dynasty' ? 'Dynasty league' : 'Redraft'}</strong><small>${model.linked ? 'From your Sleeper league' : 'Link a Sleeper dynasty league to include picks'}</small></div>`,
    `<div id="scoring-controls" class="format-details ${scoringExpanded ? 'expanded' : ''}"><button id="scoring-toggle" class="format-toggle" aria-expanded="${scoringExpanded}" aria-controls="league-scoring"><span>League scoring</span><span>${esc(model.settings.scoring.toUpperCase())} · ${model.settings.superflex ? 'Superflex' : '1 QB'} <b aria-hidden="true">⌄</b></span></button><div class="format-options" id="league-scoring"><label>Scoring<select id="scoring" aria-label="Reception scoring"><option value="ppr" ${model.settings.scoring === 'ppr' ? 'selected' : ''}>PPR</option><option value="half" ${model.settings.scoring === 'half' ? 'selected' : ''}>Half PPR</option><option value="standard" ${model.settings.scoring === 'standard' ? 'selected' : ''}>Standard</option></select>`,
    `</label>`,
    `<label>QB format<select id="qb-format" aria-label="Quarterback format"><option value="single" ${!model.settings.superflex ? 'selected' : ''}>1 QB</option><option value="superflex" ${model.settings.superflex ? 'selected' : ''}>Superflex / 2QB</option></select>`,
    `</label>`,
    `<label>Pass TD<select id="pass-td" aria-label="Passing touchdown points"><option ${model.settings.passTD === 4 ? 'selected' : ''}>4</option><option ${model.settings.passTD === 6 ? 'selected' : ''}>6</option></select>`,
    `</label>`,
    `<label>TE bonus<select id="te-premium" aria-label="Tight end reception bonus">${[0, 0.5, 1].map((n) => `<option ${model.settings.tePremium === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`,
    `</label>`,
    `</div></div>`,
  ].join('');
  document
    .querySelectorAll('.nav')
    .forEach((n) =>
      n.classList.toggle('active', n.dataset.view === (view === 'finder' ? 'trade' : view)),
    );
  // Keep valuation provenance available without crowding each page introduction.
  $('#footer-data').innerHTML = `
    <div class="footer-tools">
      <details class="footer-provenance"><summary>Data &amp; model <span>Model ${esc(model.modelVersion || 'legacy')}</span></summary>
        <dl><div><dt>Valuation source</dt><dd>${esc(model.data.source)}</dd></div>
        <div><dt>Coverage</dt><dd>${model.data.season}, through week ${model.data.throughWeek} · ${model.data.matched}/${model.data.total} players matched</dd></div>
        <div><dt>${model.linked ? 'League' : 'Reference rosters'}</dt><dd>${model.linked ? esc(state.connection.league.name) : 'Example teams with real NFL players'}</dd></div>
        <div><dt>${model.linked ? 'Analysis refreshed' : 'Reference captured'}</dt><dd>${model.linked ? (model.data.refreshedAt ? esc(new Date(model.data.refreshedAt).toLocaleString()) : 'Not prepared') : esc(new Date(model.data.fetched).toLocaleDateString())}${model.linked && model.data.stale ? ' · Refresh recommended' : ''}</dd></div></dl>
      </details>
      <div class="footer-actions">${model.linked ? '<button data-sync>Refresh league data <span aria-hidden="true">↻</span></button>' : ''}<button id="methodology">How values work <span aria-hidden="true">↗</span></button></div>
    </div>`;
  const notice = model.data.warning
    ? `<p class="data-warning" role="status">${esc(model.data.warning)}</p>`
    : '';
  $('#main').innerHTML =
    (['news', 'account'].includes(view) ? '' : notice) +
    (view === 'team'
      ? teamView()
      : view === 'players'
        ? playersView()
        : view === 'trade'
          ? tradeView()
          : view === 'finder'
            ? finderView(tradeModel(), finder, goal)
            : view === 'saved'
              ? savedView()
              : view === 'news'
                ? newsView()
                : accountView());
  $('#footer-disclaimer').textContent =
    'Model estimates · No share trading · Simulations do not execute trades';
}
/** Load the account context before reading that account's active analysis. */
async function reload() {
  finder = null;
  tradeTeam = null;

  tradeQuery = '';
  state = await api('state');
  model = await api('analysis');
}
const tradeInput = () => ({
  teamA: tradeOwn().id,
  teamB: partner,
  sendA: [...selectedA],
  sendB: [...selectedB],
  customTeams: !model.linked,
  includeWaivers: false,
});
async function changeSettings(settings) {
  model = await api('analysis/settings', 'PUT', { ...model.settings, ...settings });
  selectedA.clear();
  selectedB.clear();

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
  const scoringToggle = e.target.closest('#scoring-toggle');
  if (scoringToggle) {
    scoringExpanded = !scoringExpanded;
    $('#scoring-controls').classList.toggle('expanded', scoringExpanded);
    scoringToggle.setAttribute('aria-expanded', String(scoringExpanded));
    return;
  }
  // The root also carries data-view for responsive styling. Only buttons navigate.
  if (e.target.closest('[data-news-refresh]')) {
    void loadNews();
    return;
  }
  if (e.target.closest('[data-standings]')) {
    showStandings = !showStandings;
    render();
    return;
  }
  const accountTab = e.target.closest('[data-account-section]');
  if (accountTab) {
    accountSection = accountTab.dataset.accountSection;
    view = 'account';
    render();
    return;
  }
  const nav = e.target.closest('button[data-view]');
  if (nav) {
    if (nav.dataset.view === 'saved') {
      accountSection = 'saved';
      view = 'account';
    } else if (nav.dataset.view === 'sleeper') {
      accountSection = 'sleeper';
      view = 'account';
    } else {
      view = nav.dataset.view === 'more' ? 'account' : nav.dataset.view;
    }
    if (nav.id === 'account-button') accountSection = 'identity';
    render();
    if (view === 'news' && (!newsData || Date.now() - newsRequestedAt >= 600000)) void loadNews();
    if (globalThis.matchMedia?.('(max-width: 760px)').matches)
      globalThis.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  if (e.target.closest('#open-finder')) {
    view = 'finder';
    render();
    return;
  }
  const add = e.target.closest('[data-add-side]');
  if (add) {
    addPlayerToSide(add.dataset.asset, add.dataset.addSide);
    return;
  }
  const remove = e.target.closest('[data-remove-asset]');
  if (remove) {
    selectedA.delete(remove.dataset.removeAsset);
    selectedB.delete(remove.dataset.removeAsset);
    result = null;
    render();
    return;
  }
  const player = e.target.closest('[data-trade-player]');
  if (player) {
    const p = model.players.find((p) => p.id === player.dataset.tradePlayer);
    if (p) addPlayerToSide(p.id, p.owner === tradeOwn().id ? 'A' : 'B');
    return;
  }
  const mode = e.target.closest('[data-auth-mode]');
  if (mode) {
    accountSection = 'identity';
    authMode = mode.dataset.authMode;
    authNotice = '';
    emailAction = null;
    emailToken = '';
    render();
    return;
  }
  const roster = e.target.closest('[data-roster]');
  if (roster) {
    rosterTeam = roster.dataset.roster;
    showStandings = false;
    view = 'team';
    render();
    return;
  }
  const pbutton = e.target.closest('[data-player]');
  if (pbutton) {
    const p = model.players.find((p) => p.id === pbutton.dataset.player);
    showDetails(
      [
        `<span class="eyebrow">${esc(p.position)} · ${esc(p.club)}</span><h2>${esc(p.name)}</h2>${model.teams.some((t) => t.id === p.owner) ? `<button class="primary" data-trade-player="${esc(p.id)}">Add to trade →</button>` : ''}`,
        `<div class="stat-pair"><span>Redraft <b>${p.redraft}</b></span><span>Dynasty <b>${p.dynasty}</b></span></div>`,
        `${p.history ? `<p><strong>${p.history.season}:</strong> ${fmt(p.history.ppg)} fantasy points per game across ${p.history.games} games. Last-season context supplies ${Math.round(p.history.weight * 100)}% of the scoring estimate.</p>` : ''}`,
        `<p>${esc(p.confidence)} · ${p.games} games · age ${p.age ?? 'unknown'}</p>`,
        `${p.gameSample?.excluded.length ? `<p class="game-exclusions"><strong>Adjusted game sample:</strong> ${p.games} games included. ${p.gameSample.excluded.map((game) => `${game.season} Week ${game.week}: ${esc(game.reason)}${game.source ? ` (<a href="${esc(game.source)}" target="_blank" rel="noopener noreferrer">source</a>)` : ''}`).join('; ')}. Excluded from averages and usage. Recorded-game PPG before exclusions: ${p.gameSample.recordedPPG}.</p>` : ''}`,
        `<table><tbody>${Object.entries(p.stats)
          .map(
            ([k, v]) =>
              `<tr><td>${esc({ ppg: 'This season FP / game', recentPPG: 'Last four games FP / game', scoringEstimate: 'Scoring estimate', lastSeasonPPG: 'Last season FP / game', targetsPerGame: 'Targets / game', carriesPerGame: 'Carries / game', targetShare: 'Target share (%)', wopr: 'Receiving opportunity (WOPR)', adot: 'Average target depth', epaPerOpportunity: 'EPA / opportunity', consistency: 'Consistency', yardsPerTouch: 'Yards / touch' }[k] || k)}</td><td>${v ?? 'Not available'}</td></tr>`,
          )
          .join('')}</tbody>`,
        `</table>${p.pickAnchor ? `<h3>Next-year pick anchor</h3><p>${p.pickAnchor.year} pick ${Math.ceil(p.pickAnchor.overall / p.pickAnchor.teams)}.${String(((p.pickAnchor.overall - 1) % p.pickAnchor.teams) + 1).padStart(2, '0')} · ${fmt(p.pickAnchor.pickValue)} value, less ${Math.round(p.pickAnchor.discount * 100)}% for observed performance: ${fmt(p.pickAnchor.value)}. Strong production can exceed this anchor. Source: ${esc(p.pickAnchor.source)}. This is a model assumption, not consensus ADP.</p>` : ''}${p.prospect ? `<h3>Dynasty prospect protection</h3><p>${esc(p.prospect.source)} · ${Math.round(p.prospect.priorWeight * 100)}% retained weight · ${p.prospect.opportunities} observed opportunities.</p><p>Prospect starting value: ${fmt(p.prospect.capital)} before age/QB adjustments. ${p.prospect.rookieDraft ? `Rookie pick #${p.prospect.rookieDraft.overall}; ${esc(p.prospect.rookieDraft.source || 'verified league context')}, not consensus ranking.` : 'Verified rookie draft position unavailable; no ranking assumed.'}</p>` : ''}<h3>Model components</h3>`,
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
        `<h2>How player values work</h2>`,
        `<p>Use values to compare players and picks in your league. A higher number means more value in the format you selected.</p>`,
        `<h3>Redraft</h3><p>This season's scoring, targets, and carries matter most. Last season provides a starting point when there are only a few new games. It matters less as this season develops.</p><p>Missed games do not count as zeroes. Confirmed injury games are excluded from averages and usage, with the exclusions listed in player details. Injury coverage is reviewed and incomplete; low scores alone never remove a game. Current injury status can still reduce a player's availability estimate.</p>`,
        `<h3>Dynasty</h3><p>We also consider age, draft position, and future potential. A highly drafted rookie can keep value through a slow start. For rookies with draft context, next year's equivalent pick is a starting point, adjusted for performance.</p>`,
        `<h3>Draft picks</h3><p>Earlier picks are worth more. An unknown first is worth less than a proven elite player. Early picks carry a premium; later rounds and distant years are worth less. Unknown slots use a mid-round estimate.</p>`,
        `<p>Values are estimates. Injuries and role changes can move faster than the data. Starter pace shows this season's past scoring, not a prediction.</p>`,
        `<details><summary>Data sources and updates</summary><p>League data comes from Sleeper. Game statistics come from nflverse. Current stats are cached for six hours; last-season summaries for 30 days. Refresh league data to update your analysis.</p><p>We do not currently include expert projections, route participation, matchup forecasts, or every custom scoring bonus. Model ${esc(model.modelVersion)}.</p><p><a href="https://docs.sleeper.com/" target="_blank" rel="noopener">Sleeper documentation</a> · <a href="https://github.com/nflverse/nflverse-data/releases/tag/stats_player" target="_blank" rel="noopener">nflverse statistics</a></p></details>`,
      ].join(''),
    );
    return;
  }
  try {
    busy = true;
    const storyButton = e.target.closest('[data-story-save],[data-story-remove]');
    if (storyButton) {
      const url = storyButton.dataset.storySave || storyButton.dataset.storyRemove;
      const remove =
        Boolean(storyButton.dataset.storyRemove) ||
        state.preferences?.savedStories?.some((story) => story.url === url);
      storyButton.disabled = true;
      try {
        const response = await api('news/saved', remove ? 'DELETE' : 'POST', { url });
        state.preferences = response.preferences;
        render();
        toast(remove ? 'Story removed from Saved Notes.' : 'Story saved to Account, Saved Notes.');
      } finally {
        storyButton.disabled = false;
      }
      return;
    }
    if (e.target.closest('#find-trades')) {
      const button = $('#find-trades');
      button.disabled = true;
      button.textContent = 'Searching…';
      try {
        finder = await api('analysis/find', 'POST', {
          goal,
          includeWaivers: false,
          teamA: tradeOwn().id,
        });
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
      tradeTeam = o.input.teamA;
      partner = o.input.teamB;
      selectedA = new Set(o.input.sendA);
      selectedB = new Set(o.input.sendB);

      view = 'trade';
      result = await api('analysis/trade', 'POST', tradeInput());
      render();
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

      finder = null;
      tradeQuery = '';
      result = null;
      partner = null;
      rosterTeam = null;
      tradeTeam = null;
      showStandings = false;
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
      accountSection = 'identity';
      authNotice = '';
      view = 'account';
      selectedA.clear();
      selectedB.clear();

      finder = null;
      tradeQuery = '';
      result = null;
      render();
      return;
    }
    if (e.target.closest('#clear-trade')) {
      selectedA.clear();
      selectedB.clear();

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
      tradeTeam = s.input.teamA;
      partner = s.input.teamB;
      selectedA = new Set(s.input.sendA);
      selectedB = new Set(s.input.sendB);

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
// Apply player selections and scoring changes from the active view.
document.addEventListener('change', async (e) => {
  if (busy) return;
  const t = e.target;
  if (t.id === 'favorite-team') {
    busy = true;
    t.disabled = true;
    try {
      const response = await api('preferences', 'PUT', { favoriteTeam: t.value || null });
      state.preferences = response.preferences;
      applyFavoriteTheme();
      $('#preference-status').textContent = 'Team preference saved.';
    } catch (error) {
      t.value = state.preferences?.favoriteTeam || '';
      $('#preference-status').textContent = error.message;
    } finally {
      t.disabled = false;
      busy = false;
    }
    return;
  }

  if (t.id === 'trade-goal') {
    goal = t.value;
    finder = null;
    render();
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
  if (t.id === 'trade-team') {
    tradeTeam = t.value;
    partner = null;
    selectedA.clear();
    selectedB.clear();

    result = null;
    finder = null;
    render();
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
    $('#trade-search-results').innerHTML = tradeSearch(tradeModel(), tradeQuery);
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
      });
      $('#league-results').innerHTML = leagueResults();
    }
    if (form.id === 'auth-form') {
      const input = Object.fromEntries(new FormData(form));
      if (['forgot', 'verification', 'reset', 'verify'].includes(authMode)) {
        if (emailToken) input.token = emailToken;
        const response = await api(`auth/${authMode}`, 'POST', input);
        authNotice = response.message;
        if (authMode === 'reset' || authMode === 'verify') {
          emailToken = '';
          emailAction = null;
          authMode = 'login';
          await reload();
        }
        render();
        return;
      }
      const response = await api(`auth/${authMode}`, 'POST', input);
      authNotice =
        authMode === 'register'
          ? response.emailSent
            ? 'Check your inbox to verify your email.'
            : 'Account created. Verification email could not be sent. Use Send verification email to try again.'
          : '';
      state = response;
      model = await api('analysis');
      lookupResult = null;
      selectedA.clear();
      selectedB.clear();

      finder = null;
      tradeQuery = '';
      result = null;
      render();
      toast('Your account is ready.');
    }
  } catch (error) {
    const errorBox = form.id === 'sleeper-lookup' ? $('#link-error') : $('#auth-error');
    if (errorBox) errorBox.textContent = error.message;
    else toast(error.message);
  } finally {
    busy = false;
    if (button?.isConnected) button.disabled = false;
  }
});
/** Handle email links on both fresh loads and navigation within an already-open tab. */
function openEmailLink() {
  const link = new URLSearchParams(globalThis.location?.hash?.slice(1) || '');
  if (!['verify', 'reset'].includes(link.get('action')) || !link.get('token')) return false;
  emailAction = link.get('action');
  emailToken = link.get('token');
  authMode = emailAction;
  accountSection = 'identity';
  view = 'account';
  authNotice = '';
  globalThis.history?.replaceState(null, '', globalThis.location.pathname);
  return true;
}
globalThis.addEventListener?.('hashchange', () => {
  if (openEmailLink() && model) render();
});
try {
  openEmailLink();
  await reload();
  render();
} catch (error) {
  $('#main').innerHTML =
    `<section class="panel empty">Could not load the analysis workspace: ${esc(error.message)}<br>Refresh to try again.</section>`;
}

function accountView() {
  const sections = [
    ['identity', state.user ? 'Info' : 'Log in'],
    ['sleeper', 'Sleeper'],
    ['saved', 'Saved Notes'],
  ];
  const content =
    accountSection === 'sleeper'
      ? sleeperView()
      : accountSection === 'saved'
        ? `${!state.user ? '<p class="account-save-note">Log in to access your saved notes across devices. <button class="text-button" data-account-section="identity">Log in or sign up</button></p>' : ''}${savedView()}`
        : `${accountIdentity()}${!state.user ? `<details class="account-help"><summary>About your account</summary>${accountExplanation()}</details>` : ''}`;
  return `<div class="account-tabs" role="tablist" aria-label="Account sections">${sections.map(([id, label]) => `<button id="account-tab-${id}" role="tab" data-account-section="${id}" aria-selected="${accountSection === id}" aria-controls="account-panel" tabindex="${accountSection === id ? 0 : -1}">${label}</button>`).join('')}</div><section id="account-panel" role="tabpanel" aria-labelledby="account-tab-${accountSection}" tabindex="0">${content}</section>${state.user ? '<div class="account-signout"><button class="trade-button" id="logout">Sign out</button></div>' : ''}`;
}

function accountIdentity() {
  if (state.user && !emailAction && authMode !== 'verification')
    return [
      `${intro('My Account', 'Manage your profile, preferences and account security.', false)}<section class="panel account-panel"><div class="panel-heading"><h2>${esc(state.user.name)}</h2>`,
      `<span class="pill positive">SIGNED IN</span></div>`,
      `<div class="link-content"><p>${esc(state.user.email)}</p>${teamPicker()}`,
      `<p>Log in from another browser using the same FF Trading server to access this workspace. Your Sleeper import is separate from this login.</p>`,
      `<p class="${state.user.emailVerified ? 'positive' : 'muted'}">${state.user.emailVerified ? 'Email verified' : 'Email not verified yet'}</p>`,
      `${!state.user.emailVerified ? '<button class="trade-button" data-auth-mode="verification">Send verification email</button>' : ''}`,
      `<p class="preference-status" role="status">${esc(authNotice)}</p>`,
      `<p id="auth-error" class="error" role="alert"></p>`,
      `</div>`,
      `</section>`,
    ].join('');
  const signup = authMode === 'register',
    emailOnly = ['forgot', 'verification'].includes(authMode),
    reset = authMode === 'reset',
    verify = authMode === 'verify';
  return [
    `${intro(signup ? 'Create Account' : reset || authMode === 'forgot' ? 'Reset Password' : verify || authMode === 'verification' ? 'Email Verification' : 'Sign In', 'Access your leagues, saved trades and bookmarked stories.', false)}<section class="panel account-panel"><div class="panel-heading"><h2>${signup ? 'Create account' : emailOnly ? (authMode === 'forgot' ? 'Reset your password' : 'Verify your email') : reset ? 'Choose a new password' : verify ? 'Confirm your email' : 'Welcome back'}</h2>`,
    `<span class="pill">FREE</span></div>`,
    `<div class="link-content"><div class="segmented"><button data-auth-mode="register" class="${signup ? 'selected' : ''}">Sign up</button>`,
    `<button data-auth-mode="login" class="${authMode === 'login' ? 'selected' : ''}">Log in</button>`,
    `</div>`,
    `<form id="auth-form">${signup ? '<label for="auth-name">Display name</label><input id="auth-name" name="name" autocomplete="nickname" minlength="2" maxlength="60" required>' : ''}${!reset && !verify ? '<label for="auth-email">Email</label>' : ''}`,
    `${!reset && !verify ? '<input id="auth-email" name="email" type="email" autocomplete="username" maxlength="254" required value="' + esc(state.user?.email || '') + '">' : ''}`,
    `${!emailOnly && !verify ? '<label for="auth-password">' + (reset ? 'New password' : 'Password') + '</label><input id="auth-password" name="password" type="password" autocomplete="' + (signup || reset ? 'new-password' : 'current-password') + '" minlength="12" maxlength="128" required><p class="fine-print">Use 12 to 128 characters.</p>' : ''}`,
    `<p class="preference-status" role="status">${esc(authNotice)}</p>`,
    `<button class="primary full" id="auth-submit">${signup ? 'Create free account' : emailOnly ? (authMode === 'forgot' ? 'Email reset link' : 'Send verification email') : reset ? 'Update password' : verify ? 'Verify email' : 'Log in'}</button>`,
    `<p id="auth-error" class="error" role="alert"></p>`,
    `</form>${!emailAction ? teamPicker() : ''}`,
    `<button class="trade-button" data-auth-mode="forgot">Forgot password?</button>`,
    `<button class="trade-button" data-auth-mode="verification">Resend verification email</button>`,
    `</div>`,
    `</section>`,
  ].join('');
}

/** Supporting account guidance follows the forms so linking stays easy to find. */
function accountExplanation() {
  return [
    `<section class="feature-card link-explainer"><span class="eyebrow">YOUR FF TRADING IDENTITY</span><h2>One login.<br>Your analyses.</h2>`,
    `<p>Sign up once. Keep your roster imports, player values and saved trade scenarios.</p>`,
    `<p>Your FF Trading password is separate from Sleeper. We never ask for your Sleeper password.</p>`,
    `<h3>Keep your account secure.</h3>`,
    `<p>Verify your email using the link in your inbox. If you forget your password, request a secure reset link from this page.</p>`,
    `<p>Your account works across phones and computers. Sign in to access your saved leagues and analyses.</p>`,
    `</section>`,
  ].join('');
}

// Arrow keys follow the standard horizontal tab navigation pattern.
document.addEventListener('keydown', (event) => {
  const tab = event.target.closest?.('[role="tab"][data-account-section]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
  event.preventDefault();
  const tabs = ['identity', 'sleeper', 'saved'];
  const index = tabs.indexOf(accountSection);
  accountSection =
    tabs[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 2
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3
    ];
  render();
  $(`#account-tab-${accountSection}`).focus?.();
});
