let state, view = 'overview', selected = 'grid', side = 'buy', busy = false, lookupResult = null, authMode = 'register';
const $ = s => document.querySelector(s);
const money = cents => new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const pct = t => (t.price - t.previous) / t.previous * 100;
const signed = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data;
}
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
function badge(t) { return `<span class="team-badge badge-${esc(t.id)}">${esc(t.ticker.slice(0, 2))}</span>`; }
function change(t) { return `<span class="${pct(t) >= 0 ? 'positive' : 'negative'}">${pct(t) >= 0 ? '↗' : '↘'} ${signed(pct(t))}</span>`; }
function chart(t, small = false) {
  const values = t.history.length === 1 ? [t.price, t.price] : t.history.map(x => x.price), min = Math.min(...values) * .97, max = Math.max(...values) * 1.02;
  const w = 700, h = small ? 55 : 200;
  const coordinates = values.map((p, i) => `${i / (values.length - 1) * w},${h - (p - min) / (max - min) * (h - 15)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="${small ? 'spark' : 'chart'}" role="img" aria-label="${esc(t.name)} price history over ${values.length} weeks">${small ? '' : `<defs><linearGradient id="fill-${t.id}"><stop stop-color="#00ceb8" stop-opacity=".22"/><stop offset="1" stop-color="#00ceb8" stop-opacity="0"/></linearGradient></defs><path d="M0 ${h} L${coordinates.replaceAll(' ', ' L')} L${w} ${h} Z" fill="url(#fill-${t.id})"/>`}<polyline points="${coordinates}" fill="none" stroke="${pct(t) >= 0 ? '#00ceb8' : '#ff8397'}" stroke-width="${small ? 3 : 2.5}" vector-effect="non-scaling-stroke"/></svg>`;
}
function marketTable() {
  return `<div class="table-scroll"><table><thead><tr><th>TEAM / TICKER</th><th>SHARE PRICE</th><th>WEEKLY CHANGE</th><th>RECORD</th><th>SEASON TREND</th><th></th></tr></thead><tbody>${state.teams.map(t => `<tr><td><div class="team-cell">${badge(t)}<div><strong>${esc(t.name)}</strong><small>${esc(t.ticker)} <span>· ${esc(t.manager)}</span></small></div></div></td><td class="number">${money(t.price)} <small>CR</small></td><td>${change(t)}</td><td>${t.wins}–${t.losses}</td><td class="spark-cell">${chart(t, true)}</td><td><button class="trade-button" data-trade="${t.id}">Trade <span>↗</span></button></td></tr>`).join('')}</tbody></table></div>`;
}
function intro(title, description, action = true) { return `<div class="page-intro"><div><div class="eyebrow">FANTASY FOOTBALL, REVALUED.</div><h1>${title}</h1><p>${description}</p></div>${action ? state.connection ? `<button class="primary" data-sync>Sync Sleeper <span>↻</span></button>` : `<button class="primary" id="simulate" ${state.account.week >= 18 ? 'disabled' : ''}>${state.account.week >= 18 ? 'Season complete' : 'Simulate next week'} <span>↗</span></button>` : ''}</div>`; }
function overview() {
  const own = state.teams.find(t => t.id === state.ownTeam), a = state.account;
  return `${intro('The game has a market.', 'Build a contender. Back your instincts. Own a piece of game day.')}<div class="stats"><article><span>Total portfolio value <span>◷</span></span><h2>${money(a.equity)} <small>CR</small></h2><p class="${a.gain >= 0 ? 'positive' : 'negative'}">${a.gain >= 0 ? '+' : '−'}${money(Math.abs(a.gain))} <span>unrealized return</span></p></article><article><span>Your team share price <span>↗</span></span><h2>${money(own.price)} <small>CR</small></h2><p>${change(own)} <span>this week</span></p></article><article><span>Available buying power <span>◇</span></span><h2>${money(a.cash)} <small>CR</small></h2><p class="muted">Ready for your next move</p></article><article><span>Fantasy performance <span>▦</span></span><h2>${own.points.toFixed(1)} <small>PTS</small></h2><p><span class="positive">${own.wins}–${own.losses}</span> <span>season record</span></p></article></div><div class="overview-grid"><section class="panel performance"><div class="panel-heading"><div><span class="eyebrow">YOUR TEAM ON THE EXCHANGE</span><h2>${esc(own.name)} <span class="pill">${esc(own.ticker)}</span></h2></div><span class="period">Season to date</span></div><div class="chart-value">${money(own.price)} <small>CR</small> ${change(own)}</div><div class="chart-grid">${chart(own)}</div><div class="chart-labels">${own.history.map(h => `<span>${h.week === 0 ? 'BASE' : 'W' + h.week}</span>`).join('')}</div><div class="chart-note"><span class="dot"></span> Price follows performance. Every week counts.</div></section><section class="feature-card"><div class="eyebrow">FANTASY MEETS FINANCE</div><div class="field-art"><div class="yard y1"></div><div class="yard y2"></div><div class="yard y3"></div><div class="ball">◇</div><div class="floating-quote">${esc(own.ticker)} <strong>${signed(pct(own))} ${pct(own) >= 0 ? '↗' : '↘'}</strong></div></div><h2>Your roster.<br>Your edge.</h2><p>Seven starters. One team stock.<br>Make your next week worth more.</p><button class="light-button" data-view="roster">Manage your roster <span>→</span></button></section></div><section class="panel market-panel"><div class="panel-heading"><div><span class="eyebrow">THE EXCHANGE</span><h2>Teams worth watching</h2></div><span class="live-label"><span class="dot"></span> DEMO MARKET</span></div>${marketTable()}</section>`;
}
function roster() {
  if (state.connection) return linkedRoster();
  const ids = state.account.roster, projected = ids.reduce((sum, id) => sum + state.players.find(p => p.id === id).projection, 0);
  return `${intro('Build your edge.', 'Set your starters before simulating the next week.', false)}<div class="roster-layout"><section class="panel"><div class="panel-heading"><h2>Starting lineup</h2><span class="pill">7 PLAYERS</span></div><form id="roster-form">${state.slots.map((slot, i) => `<div class="roster-row"><span class="position">${slot}</span><label class="sr-only" for="slot-${i}">Player for ${slot} slot ${i + 1}</label><select id="slot-${i}" name="slot-${i}">${state.players.filter(p => slot === 'FLEX' ? ['RB', 'WR', 'TE'].includes(p.position) : p.position === slot).map(p => `<option value="${p.id}" ${p.id === ids[i] ? 'selected' : ''}>${p.name} · ${p.club} · ${p.projection} projected</option>`).join('')}</select></div>`).join('')}<div class="form-actions"><button class="primary">Save lineup ↗</button><span id="roster-message" role="status"></span></div></form></section><section class="feature-card roster-summary"><span class="eyebrow">WEEK ${state.account.week + 1} PROJECTION</span><h2>${projected.toFixed(1)} <small>PTS</small></h2><p>Your saved lineup’s projected score. Weekly results vary by ±20% in this simulation.</p><h3>Make performance pay.</h3><p>Beat the 120-point benchmark to lift your team’s price. No salary cap in this draft; each player can start once.</p><button class="light-button" id="simulate" ${state.account.week >= 18 ? 'disabled' : ''}>Simulate next week →</button></section></div>`;
}
function portfolio() {
  return `${intro('Own your convictions.', 'Your shares, cost basis, and unrealized returns.', false)}<section class="panel"><div class="panel-heading"><h2>Your holdings</h2><span class="muted">${money(state.account.cash)} CR available</span></div><div class="table-scroll"><table><thead><tr><th>TEAM</th><th>SHARES</th><th>AVG. COST</th><th>MARKET VALUE</th><th>RETURN</th><th></th></tr></thead><tbody>${state.holdings.map(h => { const t = state.teams.find(x => x.id === h.team), gain = (t.price - h.cost) * h.shares; return `<tr><td><div class="team-cell">${badge(t)}<strong>${esc(t.name)}</strong></div></td><td>${h.shares}</td><td>${money(h.cost)} CR</td><td>${money(t.price * h.shares)} CR</td><td class="${gain >= 0 ? 'positive' : 'negative'}">${gain >= 0 ? '+' : '−'}${money(Math.abs(gain))} CR</td><td><button class="trade-button" data-trade="${t.id}">Trade ↗</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Your portfolio is empty. Visit the market to buy team shares.</td></tr>'}</tbody></table></div></section>`;
}
function activity() {
  return `${intro('Every move, recorded.', 'Executed orders at the price you traded.', false)}<section class="panel"><div class="panel-heading"><h2>Recent trades</h2><span class="muted">Last 30 orders</span></div><div class="table-scroll"><table><thead><tr><th>TEAM</th><th>SIDE</th><th>SHARES</th><th>EXECUTED PRICE</th><th>TOTAL</th><th>TIME</th></tr></thead><tbody>${state.trades.map(t => `<tr><td>${esc(state.teams.find(x => x.id === t.team)?.name || t.team)}</td><td><span class="pill ${t.side === 'buy' ? 'positive' : 'negative'}">${t.side.toUpperCase()}</span></td><td>${t.quantity}</td><td>${money(t.price)} CR</td><td>${money(t.price * t.quantity)} CR</td><td>${esc(new Date(t.created).toLocaleString())}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Your first move starts here. Place a trade to see it recorded.</td></tr>'}</tbody></table></div></section>`;
}
function render() {
  const names = { overview: 'Overview', market: 'Team market', roster: 'My roster', portfolio: 'Portfolio', activity: 'Trade activity', sleeper: 'Link Sleeper', account:'Your account' };
  $('#page-name').textContent = names[view]; $('#week').textContent = `WEEK ${state.account.week}`;
  $('#season-label').textContent = state.connection ? `${state.connection.league.season} · SLEEPER` : 'DEMO SEASON';
  const own = state.teams.find(t => t.id === state.ownTeam);
  $('#profile-team').textContent = own.name;
  $('#profile-avatar').textContent = own.ticker.slice(0, 2);
  $('#profile-mode').textContent = state.user ? `Signed in · ${state.user.name}` : 'Guest · save with an account';
  $('#account-button').textContent = state.user ? 'My account' : 'Sign up / Log in';
  $('#footer-disclaimer').textContent = state.connection ? 'Data from Sleeper. Demo-credit market. Refresh with Sync Sleeper.' : 'Fictional players. Simulated performance. Demo credits.';
  $('#reset').hidden = Boolean(state.connection);
  document.querySelectorAll('.nav').forEach(n => { n.classList.toggle('active', n.dataset.view === view); n.setAttribute('aria-current', n.dataset.view === view ? 'page' : 'false'); });
  $('#ticker').innerHTML = state.teams.map(t => `<button data-trade="${t.id}"><strong>${esc(t.ticker)}</strong> <span>${money(t.price)}</span> ${change(t)}</button>`).join('');
  const banner = state.connection && view !== 'sleeper' ? `<div class="connection-banner"><span><span class="dot"></span> ${esc(state.connection.league.name)} · Scores through week ${state.account.week} · Synced ${esc(new Date(state.connection.syncedAt).toLocaleString())}</span><button class="trade-button" data-view="sleeper">Manage link →</button></div>` : '';
  $('#main').innerHTML = banner + (view === 'overview' ? overview() : view === 'market' ? `${intro('Find your next winner.', 'Buy and sell shares in fantasy teams across the league.')}<section class="panel">${marketTable()}</section>` : view === 'roster' ? roster() : view === 'portfolio' ? portfolio() : view === 'sleeper' ? sleeperView() : view==='account' ? accountView() : activity());
  if (state.connection && view === 'overview') {
    $('.feature-card p').textContent = 'Your Sleeper lineup. Your league’s scores. A new way to follow every week.';
    $('.feature-card .light-button').textContent = 'View your Sleeper roster →';
    $('.live-label').textContent = 'LINKED PAPER MARKET';
  }
}
function accountView() {
  if(state.user) return `${intro('Your league. Your account.','Your linked leagues and portfolios are saved to your FF Trading account.',false)}<section class="panel account-panel"><div class="panel-heading"><h2>${esc(state.user.name)}</h2><span class="pill positive">SIGNED IN</span></div><div class="link-content"><p>${esc(state.user.email)}</p><p>Log in from another browser using the same FF Trading server to access this portfolio. Your Sleeper import is separate from this login.</p><p class="muted">Email is your sign-in identifier; email verification and emailed resets are not enabled. Keep your recovery code somewhere safe.</p><div class="link-actions"><button class="primary" data-view="sleeper">Manage Sleeper link</button><button class="trade-button" id="logout">Log out</button></div><p id="auth-error" class="error" role="alert"></p></div></section>`;
  const signup=authMode==='register', recovery=authMode==='recover';
  return `${intro('Keep your edge.','Create a free FF Trading account to save your leagues and portfolios.',false)}<div class="roster-layout"><section class="panel"><div class="panel-heading"><h2>${signup?'Create account':recovery?'Recover your account':'Welcome back'}</h2><span class="pill">FREE</span></div><div class="link-content"><div class="segmented"><button data-auth-mode="register" class="${signup?'selected':''}">Sign up</button><button data-auth-mode="login" class="${authMode==='login'?'selected':''}">Log in</button></div><form id="auth-form">${signup?'<label for="auth-name">Display name</label><input id="auth-name" name="name" autocomplete="nickname" minlength="2" maxlength="60" required>':''}<label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="username" maxlength="254" required>${recovery?'<label for="auth-recovery">Saved recovery code</label><input id="auth-recovery" name="recoveryCode" autocomplete="off" maxlength="48" required>':''}<label for="auth-password">${recovery?'New password':'Password'}</label><input id="auth-password" name="password" type="password" autocomplete="${signup||recovery?'new-password':'current-password'}" minlength="12" maxlength="128" required><p class="fine-print">Use 12–128 characters. ${signup?'Your current guest portfolio and league links will be saved to this account.':'Logging in opens the saved portfolio for that account.'}</p><button class="primary full" id="auth-submit">${signup?'Create free account':recovery?'Reset password':'Log in'}</button><p id="auth-error" class="error" role="alert"></p></form><button class="trade-button" data-auth-mode="recover">Forgot password? Use a recovery code</button></div></section><section class="feature-card link-explainer"><span class="eyebrow">YOUR FF TRADING IDENTITY</span><h2>One login.<br>Your portfolios.</h2><p>Sign up once. Keep your roster imports, demo credits, holdings, and trade history.</p><p>Your FF Trading password is separate from Sleeper. We never ask for your Sleeper password.</p><h3>Save your recovery code.</h3><p>You’ll receive a recovery code once at sign-up. It lets you reset a forgotten password without an email service. Email verification and email delivery aren’t enabled.</p><p>This app is currently hosted on this computer. Cross-device access becomes available when the same app and database are hosted online.</p></section></div>`;
}
function playerRow(id, slot) {
  const p = state.players.find(p => p.id === id);
  return `<div class="roster-row"><span class="position">${esc(slot)}</span><div class="imported-player"><strong>${p ? esc(p.name) : 'Empty slot'}</strong><small>${p ? `${esc(p.position)} · ${esc(p.club)}${p.injury ? ' · ' + esc(p.injury) : ''}` : 'Set your lineup in Sleeper'}</small></div></div>`;
}
function linkedRoster() {
  const c = state.connection;
  return `${intro('Your real roster.', 'Starters and bench imported from Sleeper. Make lineup changes there, then sync here.')}<div class="roster-layout"><section class="panel"><div class="panel-heading"><h2>Starting lineup</h2><span class="pill">SLEEPER</span></div>${state.slots.map((slot,i) => playerRow(state.account.roster[i],slot)).join('')}<div class="panel-heading"><h2>Bench, IR & taxi</h2></div>${c.bench.map(id => playerRow(id,'BN')).join('') || '<p class="empty">No bench players.</p>'}</section><section class="feature-card roster-summary"><span class="eyebrow">SCORES THROUGH WEEK ${state.account.week}</span><h2>${state.teams.find(t => t.id === state.ownTeam).points.toFixed(1)} <small>PTS</small></h2><p>Latest imported completed-week score, using your league’s scoring settings.</p><h3>Your lineup stays in Sleeper.</h3><p>This connection reads public league data. It cannot edit starters, submit waivers, or trade players in Sleeper.</p><a class="light-button" href="https://sleeper.com/leagues/${esc(c.league.id)}" target="_blank" rel="noopener noreferrer">Open league in Sleeper ↗</a></section></div>`;
}
function sleeperView() {
  const c = state.connection;
  const linked = c ? `<section class="panel linked-summary"><div class="panel-heading"><div><span class="eyebrow">CONNECTED · READ ONLY</span><h2>${esc(c.league.name)}</h2></div><span class="pill">${esc(c.league.season)}</span></div><div class="link-content"><p><strong>${esc(c.user.username)}</strong> · ${esc(state.teams.find(t => t.id === state.ownTeam).name)} · ${state.teams.length} teams</p><p>Scores priced through week ${c.settledWeek}. Last synced ${esc(new Date(c.syncedAt).toLocaleString())}.</p>${c.skippedWeeks.length ? `<p class="error">Incomplete scores were skipped for weeks ${c.skippedWeeks.join(', ')}.</p>` : ''}<div class="link-actions"><button class="primary" data-sync>Sync Sleeper ↻</button><button class="trade-button" data-view="roster">View imported roster</button><button class="trade-button" id="disconnect">Return to demo</button></div><p class="fine-print">Returning to demo preserves this league’s paper portfolio. Reconnect the same league to resume it.</p></div></section>` : '';
  return `${intro('Bring your league to market.', 'Connect your Sleeper roster and give every team in your league a stock price.',false)}${linked}<div class="roster-layout"><section class="panel"><div class="panel-heading"><div><span class="eyebrow">STEP 1 · FIND YOUR LEAGUES</span><h2>${c ? 'Link another league' : 'Link Sleeper'}</h2></div><span class="pill">NO PASSWORD</span></div><div class="link-content"><form id="sleeper-lookup"><label for="sleeper-username">Sleeper username</label><input id="sleeper-username" name="username" autocomplete="off" maxlength="40" placeholder="Your Sleeper username" value="${esc(lookupResult?.user.username || c?.user.username || '')}" required><label for="sleeper-season">Season <span class="muted">(optional)</span></label><input id="sleeper-season" name="season" type="number" min="2017" max="2100" placeholder="Current NFL season" value="${esc(lookupResult?.season || '')}"><p class="fine-print">Public league lookup. No password or API key required. A username does not verify team ownership.</p><button class="primary full" id="lookup-submit">Find my leagues ↗</button><p class="error" id="link-error" role="alert"></p></form><div id="league-results">${leagueResults()}</div></div></section><section class="feature-card link-explainer"><span class="eyebrow">HOW THE LINK WORKS</span><h2>Real football.<br>A new market.</h2><p>1. Enter your username and select a league.</p><p>2. Import teams, starters, bench, records, and completed weekly scores.</p><p>3. Trade team shares with 25,000 demo credits in your own paper portfolio.</p><h3>Performance drives price.</h3><p>Every team starts at 100 CR. Weekly scores above your league average raise the price; below it, the price falls. Movement is capped at ±12%.</p><p>Sync after a week completes to update prices. Repeated syncs don’t count a week twice. This prototype’s market is private to your browser.</p><a href="https://docs.sleeper.com/" target="_blank" rel="noopener noreferrer" class="light-button">Data provided by Sleeper ↗</a></section></div>`;
}
function leagueResults() {
  if (!lookupResult) return '';
  if (!lookupResult.leagues.length) return `<p class="empty">No NFL leagues found for ${esc(lookupResult.user.username)} in ${esc(lookupResult.season)}. Try a different season.</p>`;
  return `<div class="results-heading"><span class="eyebrow">STEP 2 · CHOOSE YOUR LEAGUE</span><p>${lookupResult.leagues.length} leagues found for ${esc(lookupResult.user.username)} in ${esc(lookupResult.season)}</p></div>${lookupResult.leagues.map(l => `<div class="league-option"><div><strong>${esc(l.name)}</strong><small>${esc(l.season)} · ${Number(l.teams)} teams · ${esc(l.status.replaceAll('_',' '))}</small></div><button class="trade-button" data-link-league="${esc(l.id)}">${state.connection?.league.id === l.id ? 'Sync league' : 'Link league'} ↗</button></div>`).join('')}`;
}
function orderUpdate() {
  const t = state.teams.find(t => t.id === selected);
  $('#trade-name').textContent = t.name; $('#trade-price').textContent = `${esc(t.ticker)} · ${money(t.price)} CR per share · ${state.holdings.find(h => h.team === selected)?.shares || 0} shares owned`;
  $('#order-total').textContent = `${money(Number($('#quantity').value) * t.price)} CR`;
  $('#order-cash').textContent = `${money(state.account.cash)} CR`;
  $('#buy-toggle').classList.toggle('selected', side === 'buy'); $('#sell-toggle').classList.toggle('selected', side === 'sell');
  $('#submit-order').textContent = `Place ${side} order`; $('#order-error').textContent = '';
}
document.addEventListener('click', async e => {
  const mode=e.target.closest('[data-auth-mode]');if(mode && !busy){authMode=mode.dataset.authMode;render();}
  if(e.target.closest('#logout') && !busy) {
    busy=true;
    try {await api('auth/logout','POST'); lookupResult=null;state=await api('state');view='account';authMode='login';render();toast('Logged out. Your portfolio is saved.');}
    catch(error){$('#auth-error').textContent=error.message;}finally{busy=false;}
  }
  const close = e.target.closest('[data-close]'); if (close) close.closest('dialog').close();
  const nav = e.target.closest('[data-view]'); if (nav && state && !busy) { view = nav.dataset.view; render(); }
  const trade = e.target.closest('[data-trade]'); if (trade && state && !busy) { selected = trade.dataset.trade; side = 'buy'; $('#quantity').value = 1; orderUpdate(); $('#trade-dialog').showModal(); }
  const linking = e.target.closest('[data-link-league]');
  const syncing = e.target.closest('[data-sync]');
  const disconnecting = e.target.closest('#disconnect');
  if ((linking || syncing || disconnecting) && !busy) {
    busy = true; const button = linking || syncing || disconnecting;
    document.querySelectorAll('[data-link-league],[data-sync],#disconnect,#lookup-submit').forEach(b => b.disabled = true);
    const original = button.textContent; button.textContent = disconnecting ? 'Returning…' : 'Importing Sleeper…';
    try {
      state = disconnecting ? await api('sleeper/disconnect','POST') : syncing ? await api('sleeper/sync','POST') : await api('sleeper/link','POST',{ username: lookupResult.user.username, leagueId: linking.dataset.linkLeague });
      if (linking) view = 'overview';
      render(); toast(disconnecting ? 'Back to demo. Your linked portfolio is saved.' : `Sleeper synced. Scores through week ${state.account.week}.`);
    } catch(error) {
      if ($('#link-error')) $('#link-error').textContent = error.message; else toast(error.message);
      document.querySelectorAll('[data-link-league],[data-sync],#disconnect,#lookup-submit').forEach(b => b.disabled = false);
      button.textContent = original;
    } finally { busy = false; }
  }
  if (e.target.closest('#simulate') && !busy) {
    busy = true; const button = e.target.closest('#simulate'); button.disabled = true; button.textContent = 'Playing the week…';
    try { state = await api('simulate', 'POST'); render(); toast(`Week ${state.account.week} results are in. Team prices updated.`); } catch (error) { toast(error.message); render(); } finally { busy = false; }
  }
});
$('#rules').onclick = () => {
  $('#rules-dialog').innerHTML = `<div class="dialog-head"><span class="eyebrow">THE PLAYBOOK</span><button class="icon-button" data-close aria-label="Close">×</button></div><h2>Game day. Meet market day.</h2><p>${state.connection ? 'Your real Sleeper teams have paper stock prices. Buy and sell shares with FF Trading demo credits.' : 'Build a seven-player roster. Buy and sell team shares with demo credits.'}</p><h3>What moves the price?</h3><p>${state.connection ? 'All teams start at 100 CR. Each completed week moves the price based on that team’s score relative to the league average. Current, partial weeks are excluded.' : 'A simulated 120-point week keeps the price steady. Above that, it rises; below it, it falls.'}</p><code>Change = (points − ${state.connection ? 'league average' : '120'}) / ${state.connection ? 'league average' : '120'} × 25%</code><p>Weekly movement is capped at ±12%. Trading volume does not move prices. Orders use the current server price.</p><p class="muted">${state.connection ? 'Use Sync Sleeper to refresh. Prices rebuild from completed score history, so repeated syncs never compound a week twice; corrected scores can revise valuations. An all-zero scoring week leaves prices unchanged. This is a public data import, not verified Sleeper ownership.' : 'All demo players and results are fictional.'} Each browser has its own paper market. No real money or shared multiplayer exchange.</p>`;
  $('#rules-dialog').showModal();
};
$('#buy-toggle').onclick = () => { side = 'buy'; orderUpdate(); };
$('#sell-toggle').onclick = () => { side = 'sell'; orderUpdate(); };
$('#quantity').oninput = orderUpdate;
$('#trade-form').onsubmit = async e => {
  e.preventDefault(); if (busy) return; busy = true; $('#submit-order').disabled = true;
  try { state = await api('trades', 'POST', { team: selected, side, quantity: Number($('#quantity').value) }); $('#trade-dialog').close(); render(); toast('Order filled. Your portfolio is updated.'); } catch (error) { $('#order-error').textContent = error.message; } finally { busy = false; $('#submit-order').disabled = false; }
};
document.addEventListener('submit', async e => {
  if(e.target.id==='auth-form') {
    e.preventDefault();if(busy)return;busy=true;$('#auth-submit').disabled=true;$('#auth-error').textContent='';
    try {
      const input=Object.fromEntries(new FormData(e.target));const result=await api(`auth/${authMode}`,'POST',input);
      const recoveryCode=result.recoveryCode;delete result.recoveryCode;state=result;lookupResult=null;render();
      if(recoveryCode){$('#recovery-code').textContent=recoveryCode;$('#recovery-dialog').showModal();}
      toast(authMode==='register'?'Account created. Your portfolio is saved.':'You are signed in.');
    }catch(error){$('#auth-error').textContent=error.message;$('#auth-submit').disabled=false;}finally{busy=false;}
    return;
  }
  if (e.target.id === 'sleeper-lookup') {
    e.preventDefault(); if (busy) return; busy = true; $('#lookup-submit').disabled = true; $('#lookup-submit').textContent = 'Finding leagues…'; $('#link-error').textContent = '';
    // Clear old results so a new username can never import a previously looked-up user’s team.
    lookupResult = null; $('#league-results').innerHTML = '';
    try {
      lookupResult = await api('sleeper/lookup','POST',{ username: $('#sleeper-username').value.trim(), season: $('#sleeper-season').value || undefined });
      $('#league-results').innerHTML = leagueResults();
    } catch(error) { $('#link-error').textContent = error.message; }
    finally { busy = false; $('#lookup-submit').disabled = false; $('#lookup-submit').textContent = 'Find my leagues ↗'; }
    return;
  }
  if (e.target.id !== 'roster-form') return; e.preventDefault(); if (busy) return; busy = true;
  try { state = await api('roster', 'PUT', { roster: state.slots.map((_, i) => $(`#slot-${i}`).value) }); render(); toast('Lineup saved. Ready for game day.'); } catch (error) { $('#roster-message').textContent = error.message; } finally { busy = false; }
});
$('#reset').onclick = async () => {
  if (busy || !confirm('Reset your demo season, trades, roster, and credits?')) return;
  busy = true;
  try { await api('reset', 'POST'); state = await api('state'); render(); toast('New season. Fresh start.'); } catch (e) { toast(e.message); } finally { busy = false; }
};
try { state = await api('state'); render(); } catch (error) { $('#main').innerHTML = `<div class="empty">Could not open the exchange. ${esc(error.message)}<br>Refresh to try again.</div>`; }
