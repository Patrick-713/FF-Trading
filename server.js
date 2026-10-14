import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { players, slots, initialRoster, teams, validateRoster, tradeAmounts, nextPrice } from './market.js';

const root = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || resolve(root, 'data/ff-trading.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, cash INTEGER NOT NULL, week INTEGER NOT NULL DEFAULT 8, roster TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS quotes (account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, price INTEGER NOT NULL, previous INTEGER NOT NULL, points REAL NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL, PRIMARY KEY(account, team));
  CREATE TABLE IF NOT EXISTS holdings (account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, shares INTEGER NOT NULL, cost INTEGER NOT NULL, PRIMARY KEY(account, team));
  CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, side TEXT NOT NULL, quantity INTEGER NOT NULL, price INTEGER NOT NULL, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS history (account TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL, week INTEGER NOT NULL, price INTEGER NOT NULL, PRIMARY KEY(account, team, week));`);
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } }
function session(req, res) {
  let id = /(?:^|;\s*)ff_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!id || !db.prepare('SELECT id FROM accounts WHERE id=?').get(id)) {
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
  const account = db.prepare('SELECT cash,week,roster FROM accounts WHERE id=?').get(id);
  const quotes = db.prepare('SELECT * FROM quotes WHERE account=?').all(id).map(q => ({ ...teams.find(t => t.id === q.team), ...q, account: undefined, history: db.prepare('SELECT week,price FROM history WHERE account=? AND team=? ORDER BY week').all(id, q.team) }));
  const holdings = db.prepare('SELECT team,shares,cost FROM holdings WHERE account=? AND shares>0').all(id);
  const trades = db.prepare('SELECT team,side,quantity,price,created FROM trades WHERE account=? ORDER BY rowid DESC LIMIT 30').all(id);
  const invested = holdings.reduce((sum, h) => sum + h.shares * quotes.find(t => t.id === h.team).price, 0);
  const basis = holdings.reduce((sum, h) => sum + h.shares * h.cost, 0);
  return { account: { ...account, roster: JSON.parse(account.roster), invested, equity: account.cash + invested, gain: invested - basis }, teams: quotes, holdings, trades, players, slots };
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
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Origin not allowed.' });
      const id = session(req, res);
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state(id));
      if (req.method === 'POST' && url.pathname === '/api/trades') {
        const order = await body(req);
        transaction(() => {
          const quote = db.prepare('SELECT price FROM quotes WHERE account=? AND team=?').get(id, order.team);
          if (!quote) throw new Error('Unknown team.');
          const account = db.prepare('SELECT cash FROM accounts WHERE id=?').get(id);
          const holding = db.prepare('SELECT shares,cost FROM holdings WHERE account=? AND team=?').get(id, order.team) || { shares: 0, cost: 0 };
          const result = tradeAmounts(order.side, order.quantity, quote.price, account.cash, holding.shares);
          const cost = order.side === 'buy' ? Math.round((holding.shares * holding.cost + result.total) / result.shares) : holding.cost;
          db.prepare('UPDATE accounts SET cash=? WHERE id=?').run(result.cash, id);
          db.prepare('INSERT INTO holdings VALUES (?,?,?,?) ON CONFLICT(account,team) DO UPDATE SET shares=excluded.shares,cost=excluded.cost').run(id, order.team, result.shares, cost);
          db.prepare('INSERT INTO trades VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, order.team, order.side, order.quantity, quote.price, new Date().toISOString());
        });
        return json(res, 200, state(id));
      }
      if (req.method === 'PUT' && url.pathname === '/api/roster') {
        const { roster } = await body(req); validateRoster(roster);
        db.prepare('UPDATE accounts SET roster=? WHERE id=?').run(JSON.stringify(roster), id);
        return json(res, 200, state(id));
      }
      if (req.method === 'POST' && url.pathname === '/api/simulate') {
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
        transaction(() => {
          for (const table of ['trades', 'holdings', 'history', 'quotes']) db.prepare(`DELETE FROM ${table} WHERE account=?`).run(id);
          db.prepare('DELETE FROM accounts WHERE id=?').run(id);
        });
        session(req, res); return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Endpoint not found.' });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
    const files = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
    const file = files[url.pathname]; if (!file) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] });
    res.end(readFileSync(resolve(root, 'public', file)));
  } catch (e) { json(res, 400, { error: e.message }); }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`FF Trading running at http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`));
