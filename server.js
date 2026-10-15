import {loadRookieDrafts} from './prospects.js';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { players, slots, initialRoster, teams, validateRoster, tradeAmounts, nextPrice } from './market.js';
import { createSleeperClient } from './sleeper.js';
import { createAuth } from './auth.js';
import { createFantasy } from './fantasy.js';
import { analyzeTrade, findTrades } from './valuation.js';

const root = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || resolve(root, 'data/ff-trading.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, cash INTEGER NOT NULL, week INTEGER NOT NULL DEFAULT 8, roster TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS quotes (account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, price INTEGER NOT NULL, previous INTEGER NOT NULL, points REAL NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL, PRIMARY KEY(account, team));
  CREATE TABLE IF NOT EXISTS holdings (account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, shares INTEGER NOT NULL, cost INTEGER NOT NULL, PRIMARY KEY(account, team));
  CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, side TEXT NOT NULL, quantity INTEGER NOT NULL, price INTEGER NOT NULL, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS history (account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, week INTEGER NOT NULL, price INTEGER NOT NULL, PRIMARY KEY(account, team, week));
  CREATE TABLE IF NOT EXISTS market_teams (account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account,team));
  CREATE TABLE IF NOT EXISTS sleeper_links (account TEXT NOT NULL REFERENCES accounts(id), league TEXT NOT NULL, market TEXT NOT NULL REFERENCES accounts(id), data TEXT NOT NULL, PRIMARY KEY(account,league));
  CREATE TABLE IF NOT EXISTS active_links (account TEXT PRIMARY KEY REFERENCES accounts(id), league TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sleeper_cache (path TEXT PRIMARY KEY, expires INTEGER NOT NULL, data TEXT NOT NULL);`);
const auth = createAuth(db);
const fantasy = createFantasy(db);
const sleeper = createSleeperClient({ cache: {
  get(path) { const row = db.prepare('SELECT expires,data FROM sleeper_cache WHERE path=?').get(path); return row ? { expires: row.expires, data: JSON.parse(row.data) } : undefined; },
  set(path, value) { db.prepare('INSERT INTO sleeper_cache VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET expires=excluded.expires,data=excluded.data').run(path, value.expires, JSON.stringify(value.data)); }
} });
function connection(id) { const row = db.prepare('SELECT l.* FROM sleeper_links l JOIN active_links a ON a.account=l.account AND a.league=l.league WHERE a.account=?').get(id); return row ? { ...row, data: JSON.parse(row.data) } : null; }
function marketId(id) { return connection(id)?.market || id; }
const linkRequests = new Map();
async function importSleeper(id, username, leagueId) {
  if (linkRequests.has(id)) throw new Error('A Sleeper import is already running. Please wait.');
  linkRequests.set(id, true);
  try {
    const snapshot = await sleeper.snapshot(username, leagueId);
    if(snapshot.league.type===2) snapshot.tradedPicks=await sleeper.get(`league/${leagueId}/traded_picks`);
    transaction(() => {
      const previous = db.prepare('SELECT market FROM sleeper_links WHERE account=? AND league=?').get(id, leagueId);
      const key = previous?.market || randomUUID();
      if (!previous) db.prepare('INSERT INTO accounts (id,cash,week,roster) VALUES (?,?,?,?)').run(key, 2500000, snapshot.settledWeek, JSON.stringify(snapshot.roster));
      db.prepare('UPDATE accounts SET week=?,roster=? WHERE id=?').run(snapshot.settledWeek, JSON.stringify(snapshot.roster), key);
      // Rebuild deterministic prices from the same baseline; repeat syncs never compound a week twice.
      for (const team of snapshot.teams) {
        db.prepare('INSERT INTO market_teams VALUES (?,?,?) ON CONFLICT(account,team) DO UPDATE SET data=excluded.data').run(key, team.id, JSON.stringify(team));
        db.prepare('INSERT INTO quotes VALUES (?,?,?,?,?,?,?) ON CONFLICT(account,team) DO UPDATE SET price=excluded.price,previous=excluded.previous,points=excluded.points,wins=excluded.wins,losses=excluded.losses').run(key, team.id, team.price, team.previous, team.points, team.wins, team.losses);
        db.prepare('DELETE FROM history WHERE account=? AND team=?').run(key, team.id);
        for (const h of team.history) db.prepare('INSERT INTO history VALUES (?,?,?,?)').run(key, team.id, h.week, h.price);
      }
      db.prepare('INSERT INTO sleeper_links VALUES (?,?,?,?) ON CONFLICT(account,league) DO UPDATE SET data=excluded.data').run(id, leagueId, key, JSON.stringify(snapshot));
      db.prepare('INSERT INTO active_links VALUES (?,?) ON CONFLICT(account) DO UPDATE SET league=excluded.league').run(id, leagueId);
    });
    return state(id);
  } finally { linkRequests.delete(id); }
}
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }
function session(req, res) {
  const signedIn=auth.identify(req);
  if(signedIn) return signedIn.account;
  let id = /(?:^|;\s*)ff_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!id || !db.prepare('SELECT id FROM accounts WHERE id=?').get(id) || auth.profile(id) || db.prepare('SELECT market FROM sleeper_links WHERE market=?').get(id)) {
    id = randomUUID();
    transaction(() => {
      db.prepare('INSERT INTO accounts (id,cash,roster) VALUES (?,?,?)').run(id, 2500000, JSON.stringify(initialRoster));
      for (const t of teams) {
        db.prepare('INSERT INTO quotes VALUES (?,?,?,?,?,?,?)').run(id, t.id, t.price, t.previous, t.points, t.wins, t.losses);
        for (let week = 1; week <= 8; week++) {
          const price = week === 8 ? t.price : Math.round(t.price * (0.78 + week * 0.025 + Math.sin(week + t.price) * 0.035));
          db.prepare('INSERT INTO history VALUES (?,?,?,?)').run(id, t.id, week, price);
        }
      }
      db.prepare('INSERT INTO holdings VALUES (?,?,?,?)').run(id, 'grid', 20, 11000);
      db.prepare('INSERT INTO holdings VALUES (?,?,?,?)').run(id, 'blitz', 10, 13700);
    });
    res.setHeader('Set-Cookie', `ff_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
  }
  return id;
}
function state(id) {
  const link = connection(id), key = link?.market || id;
  const account = db.prepare('SELECT cash,week,roster FROM accounts WHERE id=?').get(key);
  const quotes = db.prepare('SELECT * FROM quotes WHERE account=?').all(key).map(q => {
    const metadata = db.prepare('SELECT data FROM market_teams WHERE account=? AND team=?').get(key, q.team);
    return { ...(metadata ? JSON.parse(metadata.data) : teams.find(t => t.id === q.team)), ...q, account: undefined, history: db.prepare('SELECT week,price FROM history WHERE account=? AND team=? ORDER BY week').all(key, q.team) };
  });
  const holdings = db.prepare('SELECT team,shares,cost FROM holdings WHERE account=? AND shares>0').all(key);
  const trades = db.prepare('SELECT team,side,quantity,price,created FROM trades WHERE account=? ORDER BY rowid DESC LIMIT 30').all(key);
  const invested = holdings.reduce((sum, h) => sum + h.shares * quotes.find(t => t.id === h.team).price, 0);
  const basis = holdings.reduce((sum, h) => sum + h.shares * h.cost, 0);
  return { account: { ...account, roster: JSON.parse(account.roster), invested, equity: account.cash + invested, gain: invested - basis }, teams: quotes, holdings, trades,
    players: link?.data.players || players, slots: link?.data.slots || slots, ownTeam: link?.data.ownTeam || 'grid', connection: link?.data || null, user: auth.profile(id) };
}
async function analysis(id,input) {
  const link=connection(id);
  let snapshot=link?structuredClone(link.data):null,catalog={};
  const cached=path=>{const row=db.prepare('SELECT data FROM sleeper_cache WHERE path=?').get(path);return row?JSON.parse(row.data):null;};
  if(snapshot){
    catalog=cached('players/nfl')||{};
    const raw=cached(`league/${link.league}`),rosters=cached(`league/${link.league}/rosters`);
    if(raw){snapshot.league.type=Number(raw.settings?.type||0);snapshot.league.draftRounds=Number(raw.settings?.draft_rounds||0);snapshot.league.scoring=raw.scoring_settings||{};snapshot.rosterLimit=(raw.roster_positions||[]).filter(p=>!['IR','TAXI'].includes(p)).length;}
    snapshot.teams=snapshot.teams.map(t=>({...t,protectedIds:t.protectedIds||[...(rosters?.find(r=>r.roster_id===t.rosterId)?.reserve||[]),...(rosters?.find(r=>r.roster_id===t.rosterId)?.taxi||[])],playerIds:t.playerIds||rosters?.find(r=>r.roster_id===t.rosterId)?.players||(t.id===snapshot.ownTeam?snapshot.players.map(p=>p.id):[])}));
    if(snapshot.league.type===2&&!snapshot.tradedPicks)snapshot.tradedPicks=await sleeper.get(`league/${link.league}/traded_picks`);
  }
  if(snapshot)snapshot.rookieDrafts=await loadRookieDrafts(sleeper.get,snapshot.league,Number(snapshot.league.season),catalog);
  return fantasy.model(id,snapshot,catalog,input);
}
async function body(req) {
  let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 8192) throw new Error('Request too large.'); }
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON request.'); }
}
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      if(req.method!=='GET') {
        const origin=process.env.APP_ORIGIN || `http://${req.headers.host}`;
        if((req.headers.origin && req.headers.origin!==origin) || req.headers['sec-fetch-site']==='cross-site') return json(res,403,{error:'Origin not allowed.'});
        if(!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'Use application/json.'});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/logout') {
        auth.logout(req,res); return json(res,200,{ok:true});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/login') {
        const account=await auth.login(req,res,await body(req)); return json(res,200,state(account));
      }
      if(req.method==='POST' && url.pathname==='/api/auth/recover') {
        const result=await auth.recover(req,res,await body(req)); return json(res,200,{...state(result.account),recoveryCode:result.recoveryCode});
      }
      const id = session(req, res);
      if(req.method==='POST' && url.pathname==='/api/auth/register') {
        if(linkRequests.has(id)) throw new Error('Wait for your league import to finish before signing up.');
        const result=await auth.register(req,res,await body(req),id);return json(res,200,{...state(result.account),recoveryCode:result.recoveryCode});
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state(id));
      if(req.method==='GET'&&url.pathname==='/api/analysis')return json(res,200,await analysis(id));
      if(req.method==='PUT'&&url.pathname==='/api/analysis/settings')return json(res,200,await analysis(id,await body(req)));
      if(req.method==='POST'&&url.pathname==='/api/analysis/find'){
        const input=await body(req),model=await analysis(id);if(!model.data.ready)throw new Error('Load statistics before finding trades.');return json(res,200,findTrades(model,input));
      }
      if(req.method==='POST'&&url.pathname==='/api/analysis/trade'){
        const input=await body(req),model=await analysis(id);if(!model.data.ready)throw new Error('Load statistics before analyzing a trade.');
        return json(res,200,analyzeTrade(model,input));
      }
      if(req.method==='POST'&&url.pathname==='/api/analysis/save'){
        const input=await body(req),model=await analysis(id);if(!model.data.ready)throw new Error('Load statistics before saving a trade.');
        const result=analyzeTrade(model,input);const title=String(input.title||'Trade scenario').trim().slice(0,80);
        db.prepare('INSERT INTO trade_scenarios VALUES (?,?,?,?)').run(randomUUID(),id,JSON.stringify({title,input:{teamA:input.teamA,teamB:input.teamB,sendA:input.sendA,sendB:input.sendB,assumptions:result.assumptions,includeWaivers:input.includeWaivers!==false},result,league:connection(id)?.league||'demo'}),new Date().toISOString());
        return json(res,200,await analysis(id));
      }
      if (req.method === 'POST' && url.pathname === '/api/sleeper/lookup') {
        const { username, season } = await body(req);
        return json(res, 200, await sleeper.lookup(username, season));
      }
      if (req.method === 'POST' && url.pathname === '/api/sleeper/link') {
        const { username, leagueId } = await body(req);
        return json(res, 200, await importSleeper(id, username, leagueId));
      }
      if (req.method === 'POST' && url.pathname === '/api/sleeper/sync') {
        const link = connection(id);
        if (!link) throw new Error('Link a Sleeper league first.');
        return json(res, 200, await importSleeper(id, link.data.user.id, link.league));
      }
      if (req.method === 'POST' && url.pathname === '/api/sleeper/disconnect') {
        if (linkRequests.has(id)) throw new Error('Wait for the Sleeper import to finish.');
        db.prepare('DELETE FROM active_links WHERE account=?').run(id);
        return json(res, 200, state(id));
      }
      if (req.method === 'POST' && url.pathname === '/api/trades') {
        const order = await body(req);
        const key = marketId(id);
        transaction(() => {
          const quote = db.prepare('SELECT price FROM quotes WHERE account=? AND team=?').get(key, order.team);
          if (!quote) throw new Error('Unknown team.');
          const account = db.prepare('SELECT cash FROM accounts WHERE id=?').get(key);
          const holding = db.prepare('SELECT shares,cost FROM holdings WHERE account=? AND team=?').get(key, order.team) || { shares: 0, cost: 0 };
          const result = tradeAmounts(order.side, order.quantity, quote.price, account.cash, holding.shares);
          const cost = order.side === 'buy' ? Math.round((holding.shares * holding.cost + result.total) / result.shares) : holding.cost;
          db.prepare('UPDATE accounts SET cash=? WHERE id=?').run(result.cash, key);
          db.prepare('INSERT INTO holdings VALUES (?,?,?,?) ON CONFLICT(account,team) DO UPDATE SET shares=excluded.shares,cost=excluded.cost').run(key, order.team, result.shares, cost);
          db.prepare('INSERT INTO trades VALUES (?,?,?,?,?,?,?)').run(randomUUID(), key, order.team, order.side, order.quantity, quote.price, new Date().toISOString());
        });
        return json(res, 200, state(id));
      }
      if (req.method === 'PUT' && url.pathname === '/api/roster') {
        if (connection(id)) throw new Error('Manage your linked lineup in Sleeper, then sync here.');
        const { roster } = await body(req); validateRoster(roster);
        db.prepare('UPDATE accounts SET roster=? WHERE id=?').run(JSON.stringify(roster), id);
        return json(res, 200, state(id));
      }
      if (req.method === 'POST' && url.pathname === '/api/simulate') {
        if (connection(id)) throw new Error('Linked leagues use real Sleeper results. Sync instead of simulating.');
        transaction(() => {
          const account = db.prepare('SELECT week,roster FROM accounts WHERE id=?').get(id);
          if (account.week >= 18) throw new Error('Demo season complete. Start a new season to keep playing.');
          const week = account.week + 1;
          for (const quote of db.prepare('SELECT * FROM quotes WHERE account=?').all(id)) {
            const projected = quote.team === 'grid' ? JSON.parse(account.roster).reduce((sum, p) => sum + players.find(x => x.id === p).projection, 0) : teams.find(t => t.id === quote.team).points;
            const points = Math.round(projected * randomInt(80, 121) / 10) / 10;
            const price = nextPrice(quote.price, points);
            db.prepare('UPDATE quotes SET previous=price,price=?,points=?,wins=wins+?,losses=losses+? WHERE account=? AND team=?').run(price, points, points >= 120 ? 1 : 0, points < 120 ? 1 : 0, id, quote.team);
            db.prepare('INSERT INTO history VALUES (?,?,?,?)').run(id, quote.team, week, price);
          }
          db.prepare('UPDATE accounts SET week=? WHERE id=?').run(week, id);
        });
        return json(res, 200, state(id));
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        if (connection(id) || linkRequests.has(id)) throw new Error('Return to the demo before resetting it.');
        transaction(() => {
          for (const table of ['trades', 'holdings', 'history', 'quotes']) db.prepare(`DELETE FROM ${table} WHERE account=?`).run(id);
          db.prepare('UPDATE accounts SET cash=2500000,week=8,roster=? WHERE id=?').run(JSON.stringify(initialRoster), id);
          for (const t of teams) {
            db.prepare('INSERT INTO quotes VALUES (?,?,?,?,?,?,?)').run(id,t.id,t.price,t.previous,t.points,t.wins,t.losses);
            for (let week=1;week<=8;week++) db.prepare('INSERT INTO history VALUES (?,?,?,?)').run(id,t.id,week,week===8?t.price:Math.round(t.price*(0.78+week*0.025+Math.sin(week+t.price)*0.035)));
          }
          db.prepare('INSERT INTO holdings VALUES (?,?,?,?)').run(id,'grid',20,11000);
          db.prepare('INSERT INTO holdings VALUES (?,?,?,?)').run(id,'blitz',10,13700);
        });
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Endpoint not found.' });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
    const files = { '/': 'index.html', '/app.js': 'app.js', '/trade-tools.js':'trade-tools.js', '/styles.css': 'styles.css' };
    const file = files[url.pathname]; if (!file) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] });
    res.end(readFileSync(resolve(root, 'public', file)));
  } catch (e) { json(res, e.status || 400, { error: e.message }); }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`FF Trading running at http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`));
