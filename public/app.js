let state, view = 'overview', selected = 'grid', side = 'buy', busy = false;
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
function badge(t) { return `<span class="team-badge badge-${t.id}">${t.ticker.slice(0, 2)}</span>`; }
function change(t) { return `<span class="${pct(t) >= 0 ? 'positive' : 'negative'}">${pct(t) >= 0 ? '↗' : '↘'} ${signed(pct(t))}</span>`; }
function chart(t, small = false) {
  const values = t.history.map(x => x.price), min = Math.min(...values) * .97, max = Math.max(...values) * 1.02;
  const w = 700, h = small ? 55 : 200;
  const coordinates = values.map((p, i) => `${i / (values.length - 1) * w},${h - (p - min) / (max - min) * (h - 15)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="${small ? 'spark' : 'chart'}" role="img" aria-label="${esc(t.name)} price history over ${values.length} weeks">${small ? '' : `<defs><linearGradient id="fill-${t.id}"><stop stop-color="#00ceb8" stop-opacity=".22"/><stop offset="1" stop-color="#00ceb8" stop-opacity="0"/></linearGradient></defs><path d="M0 ${h} L${coordinates.replaceAll(' ', ' L')} L${w} ${h} Z" fill="url(#fill-${t.id})"/>`}<polyline points="${coordinates}" fill="none" stroke="${pct(t) >= 0 ? '#00ceb8' : '#ff8397'}" stroke-width="${small ? 3 : 2.5}" vector-effect="non-scaling-stroke"/></svg>`;
}
function marketTable() {
  return `<div class="table-scroll"><table><thead><tr><th>TEAM / TICKER</th><th>SHARE PRICE</th><th>WEEKLY CHANGE</th><th>RECORD</th><th>SEASON TREND</th><th></th></tr></thead><tbody>${state.teams.map(t => `<tr><td><div class="team-cell">${badge(t)}<div><strong>${t.name}</strong><small>${t.ticker} <span>· ${t.manager}</span></small></div></div></td><td class="number">${money(t.price)} <small>CR</small></td><td>${change(t)}</td><td>${t.wins}–${t.losses}</td><td class="spark-cell">${chart(t, true)}</td><td><button class="trade-button" data-trade="${t.id}">Trade <span>↗</span></button></td></tr>`).join('')}</tbody></table></div>`;
}
function intro(title, description, action = true) { return `<div class="page-intro"><div><div class="eyebrow">FANTASY FOOTBALL, REVALUED.</div><h1>${title}</h1><p>${description}</p></div>${action ? `<button class="primary" id="simulate" ${state.account.week >= 18 ? 'disabled' : ''}>${state.account.week >= 18 ? 'Season complete' : 'Simulate next week'} <span>↗</span></button>` : ''}</div>`; }
function overview() {
  const own = state.teams.find(t => t.id === 'grid'), a = state.account;
  return `${intro('The game has a market.', 'Build a contender. Back your instincts. Own a piece of game day.')}<div class="stats"><article><span>Total portfolio value <span>◷</span></span><h2>${money(a.equity)} <small>CR</small></h2><p class="${a.gain >= 0 ? 'positive' : 'negative'}">${a.gain >= 0 ? '+' : '−'}${money(Math.abs(a.gain))} <span>unrealized return</span></p></article><article><span>Your team share price <span>↗</span></span><h2>${money(own.price)} <small>CR</small></h2><p>${change(own)} <span>this week</span></p></article><article><span>Available buying power <span>◇</span></span><h2>${money(a.cash)} <small>CR</small></h2><p class="muted">Ready for your next move</p></article><article><span>Fantasy performance <span>▦</span></span><h2>${own.points.toFixed(1)} <small>PTS</small></h2><p><span class="positive">${own.wins}–${own.losses}</span> <span>season record</span></p></article></div><div class="overview-grid"><section class="panel performance"><div class="panel-heading"><div><span class="eyebrow">YOUR TEAM ON THE EXCHANGE</span><h2>Gridiron Capital <span class="pill">GRID</span></h2></div><span class="period">Season to date</span></div><div class="chart-value">${money(own.price)} <small>CR</small> ${change(own)}</div><div class="chart-grid">${chart(own)}</div><div class="chart-labels">${own.history.map(h => `<span>W${h.week}</span>`).join('')}</div><div class="chart-note"><span class="dot"></span> Price follows performance. Every week counts.</div></section><section class="feature-card"><div class="eyebrow">FANTASY MEETS FINANCE</div><div class="field-art"><div class="yard y1"></div><div class="yard y2"></div><div class="yard y3"></div><div class="ball">◇</div><div class="floating-quote">GRID <strong>${signed(pct(own))} ${pct(own) >= 0 ? '↗' : '↘'}</strong></div></div><h2>Your roster.<br>Your edge.</h2><p>Seven starters. One team stock.<br>Make your next week worth more.</p><button class="light-button" data-view="roster">Manage your roster <span>→</span></button></section></div><section class="panel market-panel"><div class="panel-heading"><div><span class="eyebrow">THE EXCHANGE</span><h2>Teams worth watching</h2></div><span class="live-label"><span class="dot"></span> DEMO MARKET</span></div>${marketTable()}</section>`;
}
function roster() {
  const ids = state.account.roster, projected = ids.reduce((sum, id) => sum + state.players.find(p => p.id === id).projection, 0);
  return `${intro('Build your edge.', 'Set your starters before simulating the next week.', false)}<div class="roster-layout"><section class="panel"><div class="panel-heading"><h2>Starting lineup</h2><span class="pill">7 PLAYERS</span></div><form id="roster-form">${state.slots.map((slot, i) => `<div class="roster-row"><span class="position">${slot}</span><label class="sr-only" for="slot-${i}">Player for ${slot} slot ${i + 1}</label><select id="slot-${i}" name="slot-${i}">${state.players.filter(p => slot === 'FLEX' ? ['RB', 'WR', 'TE'].includes(p.position) : p.position === slot).map(p => `<option value="${p.id}" ${p.id === ids[i] ? 'selected' : ''}>${p.name} · ${p.club} · ${p.projection} projected</option>`).join('')}</select></div>`).join('')}<div class="form-actions"><button class="primary">Save lineup ↗</button><span id="roster-message" role="status"></span></div></form></section><section class="feature-card roster-summary"><span class="eyebrow">WEEK ${state.account.week + 1} PROJECTION</span><h2>${projected.toFixed(1)} <small>PTS</small></h2><p>Your saved lineup’s projected score. Weekly results vary by ±20% in this simulation.</p><h3>Make performance pay.</h3><p>Beat the 120-point benchmark to lift your team’s price. No salary cap in this draft; each player can start once.</p><button class="light-button" id="simulate" ${state.account.week >= 18 ? 'disabled' : ''}>Simulate next week →</button></section></div>`;
}
function portfolio() {
  return `${intro('Own your convictions.', 'Your shares, cost basis, and unrealized returns.', false)}<section class="panel"><div class="panel-heading"><h2>Your holdings</h2><span class="muted">${money(state.account.cash)} CR available</span></div><div class="table-scroll"><table><thead><tr><th>TEAM</th><th>SHARES</th><th>AVG. COST</th><th>MARKET VALUE</th><th>RETURN</th><th></th></tr></thead><tbody>${state.holdings.map(h => { const t = state.teams.find(x => x.id === h.team), gain = (t.price - h.cost) * h.shares; return `<tr><td><div class="team-cell">${badge(t)}<strong>${t.name}</strong></div></td><td>${h.shares}</td><td>${money(h.cost)} CR</td><td>${money(t.price * h.shares)} CR</td><td class="${gain >= 0 ? 'positive' : 'negative'}">${gain >= 0 ? '+' : '−'}${money(Math.abs(gain))} CR</td><td><button class="trade-button" data-trade="${t.id}">Trade ↗</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Your portfolio is empty. Visit the market to buy team shares.</td></tr>'}</tbody></table></div></section>`;
}
function activity() {
  return `${intro('Every move, recorded.', 'Executed orders at the price you traded.', false)}<section class="panel"><div class="panel-heading"><h2>Recent trades</h2><span class="muted">Last 30 orders</span></div><div class="table-scroll"><table><thead><tr><th>TEAM</th><th>SIDE</th><th>SHARES</th><th>EXECUTED PRICE</th><th>TOTAL</th><th>TIME</th></tr></thead><tbody>${state.trades.map(t => `<tr><td>${state.teams.find(x => x.id === t.team).name}</td><td><span class="pill ${t.side === 'buy' ? 'positive' : 'negative'}">${t.side.toUpperCase()}</span></td><td>${t.quantity}</td><td>${money(t.price)} CR</td><td>${money(t.price * t.quantity)} CR</td><td>${esc(new Date(t.created).toLocaleString())}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Your first move starts here. Place a trade to see it recorded.</td></tr>'}</tbody></table></div></section>`;
}
function render() {
  const names = { overview: 'Overview', market: 'Team market', roster: 'My roster', portfolio: 'Portfolio', activity: 'Trade activity' };
  $('#page-name').textContent = names[view]; $('#week').textContent = `WEEK ${state.account.week}`;
  document.querySelectorAll('.nav').forEach(n => { n.classList.toggle('active', n.dataset.view === view); n.setAttribute('aria-current', n.dataset.view === view ? 'page' : 'false'); });
  $('#ticker').innerHTML = state.teams.map(t => `<button data-trade="${t.id}"><strong>${t.ticker}</strong> <span>${money(t.price)}</span> ${change(t)}</button>`).join('');
  $('#main').innerHTML = view === 'overview' ? overview() : view === 'market' ? `${intro('Find your next winner.', 'Buy and sell shares in fantasy teams across the league.')}<section class="panel">${marketTable()}</section>` : view === 'roster' ? roster() : view === 'portfolio' ? portfolio() : activity();
}
function orderUpdate() {
  const t = state.teams.find(t => t.id === selected);
  $('#trade-name').textContent = t.name; $('#trade-price').textContent = `${t.ticker} · ${money(t.price)} CR per share · ${state.holdings.find(h => h.team === selected)?.shares || 0} shares owned`;
  $('#order-total').textContent = `${money(Number($('#quantity').value) * t.price)} CR`;
  $('#order-cash').textContent = `${money(state.account.cash)} CR`;
  $('#buy-toggle').classList.toggle('selected', side === 'buy'); $('#sell-toggle').classList.toggle('selected', side === 'sell');
  $('#submit-order').textContent = `Place ${side} order`; $('#order-error').textContent = '';
}
document.addEventListener('click', async e => {
  const close = e.target.closest('[data-close]'); if (close) close.closest('dialog').close();
  const nav = e.target.closest('[data-view]'); if (nav && state) { view = nav.dataset.view; render(); }
  const trade = e.target.closest('[data-trade]'); if (trade && state) { selected = trade.dataset.trade; side = 'buy'; $('#quantity').value = 1; orderUpdate(); $('#trade-dialog').showModal(); }
  if (e.target.closest('#simulate') && !busy) {
    busy = true; const button = e.target.closest('#simulate'); button.disabled = true; button.textContent = 'Playing the week…';
    try { state = await api('simulate', 'POST'); render(); toast(`Week ${state.account.week} results are in. Team prices updated.`); } catch (error) { toast(error.message); render(); } finally { busy = false; }
  }
});
$('#rules').onclick = () => $('#rules-dialog').showModal();
$('#buy-toggle').onclick = () => { side = 'buy'; orderUpdate(); };
$('#sell-toggle').onclick = () => { side = 'sell'; orderUpdate(); };
$('#quantity').oninput = orderUpdate;
$('#trade-form').onsubmit = async e => {
  e.preventDefault(); if (busy) return; busy = true; $('#submit-order').disabled = true;
  try { state = await api('trades', 'POST', { team: selected, side, quantity: Number($('#quantity').value) }); $('#trade-dialog').close(); render(); toast('Order filled. Your portfolio is updated.'); } catch (error) { $('#order-error').textContent = error.message; } finally { busy = false; $('#submit-order').disabled = false; }
};
document.addEventListener('submit', async e => {
  if (e.target.id !== 'roster-form') return; e.preventDefault(); if (busy) return; busy = true;
  try { state = await api('roster', 'PUT', { roster: state.slots.map((_, i) => $(`#slot-${i}`).value) }); render(); toast('Lineup saved. Ready for game day.'); } catch (error) { $('#roster-message').textContent = error.message; } finally { busy = false; }
});
$('#reset').onclick = async () => {
  if (busy || !confirm('Reset your demo season, trades, roster, and credits?')) return;
  busy = true;
  try { await api('reset', 'POST'); state = await api('state'); render(); toast('New season. Fresh start.'); } catch (e) { toast(e.message); } finally { busy = false; }
};
try { state = await api('state'); render(); } catch (error) { $('#main').innerHTML = `<div class="empty">Could not open the exchange. ${esc(error.message)}<br>Refresh to try again.</div>`; }
