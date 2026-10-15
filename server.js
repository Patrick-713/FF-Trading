/** HTTP entry point. Routes identify the account, validate input and call the service modules. */
import http from 'node:http';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, transaction } from './database.js';
import { AppError, invalid, publicError, logRequest } from './errors.js';
import { createAuth } from './auth.js';
import { createSleeperClient, validLeague } from './sleeper.js';
import { createFantasy } from './fantasy.js';
import { loadRookieDrafts } from './prospects.js';
import { analyzeTrade, findTrades } from './trade-engine.js';

const root = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || resolve(root, 'data/ff-trading.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
const existing = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'")
  .get();
const hasMigrations = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
  .get();
if (
  existing &&
  (!hasMigrations || !db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get())
) {
  const backupFolder = resolve(dirname(dbPath), 'backups');
  mkdirSync(backupFolder, { recursive: true });
  await backup(db, resolve(backupFolder, 'before-backend-v3-' + Date.now() + '.sqlite'));
}
migrate(db);
const auth = createAuth(db),
  fantasy = createFantasy(db);
const sleeper = createSleeperClient({
  cache: {
    get(path) {
      const r = db.prepare('SELECT expires,data FROM sleeper_cache WHERE path=?').get(path);
      return r ? { expires: r.expires, data: JSON.parse(r.data) } : undefined;
    },
    set(path, value) {
      db.prepare(
        'INSERT INTO sleeper_cache VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET expires=excluded.expires,data=excluded.data',
      ).run(path, value.expires, JSON.stringify(value.data));
    },
  },
});
const imports = new Set();
function connection(account) {
  const row = db
    .prepare(
      'SELECT l.league,l.data FROM sleeper_links l JOIN active_links a ON a.account=l.account AND a.league=l.league WHERE a.account=?',
    )
    .get(account);
  return row ? { league: row.league, data: JSON.parse(row.data) } : null;
}
/** Resolve a signed-in account or create a separate guest workspace. */
function session(req, res) {
  const signedIn = auth.identify(req);
  if (signedIn) return signedIn.account;
  let account = /(?:^|;\s*)ff_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (
    !account ||
    !db.prepare('SELECT 1 FROM accounts WHERE id=?').get(account) ||
    auth.profile(account)
  ) {
    account = randomUUID();
    db.prepare('INSERT INTO accounts(id) VALUES (?)').run(account);
    res.setHeader(
      'Set-Cookie',
      `ff_session=${account}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
    );
  }
  return account;
}
function state(account) {
  return {
    account: { id: account },
    connection: connection(account)?.data || null,
    user: auth.profile(account),
  };
}
function cached(path) {
  const r = db.prepare('SELECT data FROM sleeper_cache WHERE path=?').get(path);
  return r ? JSON.parse(r.data) : null;
}
function snapshot(account) {
  const linked = connection(account);
  if (!linked) return null;
  const s = structuredClone(linked.data),
    raw = cached(`league/${linked.league}`),
    rosters = cached(`league/${linked.league}/rosters`);
  // Enrich imports created before roster capacity and draft metadata were persisted.
  if (raw && !s.analysisRefreshedAt) {
    s.league = {
      ...s.league,
      type: Number(raw.settings?.type || 0),
      draftRounds: Number(raw.settings?.draft_rounds || 0),
      scoring: raw.scoring_settings || {},
    };
    s.rosterLimit = (raw.roster_positions || []).filter((p) => !['IR', 'TAXI'].includes(p)).length;
  }
  s.teams = s.teams.map((t) => {
    const r = rosters?.find((r) => r.roster_id === t.rosterId);
    return {
      ...t,
      playerIds: t.playerIds || r?.players || [],
      protectedIds: t.protectedIds || [...(r?.reserve || []), ...(r?.taxi || [])],
    };
  });
  return s;
}
/** Read saved analysis inputs. Provider requests belong to importLeague. */
function analysis(account, input) {
  return fantasy.model(account, snapshot(account), cached('players/nfl') || {}, input);
}
/** Prepare provider data first, then commit the league and its inputs together. */
async function importLeague(account, username, leagueId) {
  if (imports.has(account))
    throw new AppError(409, 'REFRESH_IN_PROGRESS', 'A league refresh is already running.');
  imports.add(account);
  try {
    const s = await sleeper.snapshot(username, leagueId),
      catalog = cached('players/nfl') || {};
    if (s.league.type === 2) s.tradedPicks = await sleeper.get(`league/${leagueId}/traded_picks`);
    s.rookieDrafts = await loadRookieDrafts(
      sleeper.get,
      s.league,
      Number(s.league.season),
      catalog,
    );
    const inputs = await fantasy.prepareSnapshot(s, catalog);
    s.analysisRefreshedAt = new Date().toISOString();
    transaction(db, () => {
      db.prepare(
        'INSERT INTO sleeper_links VALUES (?,?,?) ON CONFLICT(account,league) DO UPDATE SET data=excluded.data',
      ).run(account, leagueId, JSON.stringify(s));
      db.prepare(
        'INSERT INTO active_links VALUES (?,?) ON CONFLICT(account) DO UPDATE SET league=excluded.league',
      ).run(account, leagueId);
      fantasy.storeSnapshot(account, s, inputs);
    });
    return state(account);
  } finally {
    imports.delete(account);
  }
}
/** Accept a bounded JSON object and return clear validation errors. */
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 8192)
      throw new AppError(413, 'BODY_TOO_LARGE', 'Request is too large.');
  }
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw invalid('Invalid JSON request.');
  }
  if (!input || Array.isArray(input) || typeof input !== 'object')
    throw invalid('Send a JSON object.');
  return input;
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
  const requestId = randomUUID(),
    started = performance.now();
  let path = 'unknown',
    errorCode;
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  );
  res.once('finish', () =>
    logRequest({
      requestId,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
      errorCode,
    }),
  );
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    path = url.pathname;
    // Log only a fixed route name, never caller-controlled path/query values.
    const routes = new Set([
      '/api/state',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/register',
      '/api/auth/recover',
      '/api/analysis',
      '/api/analysis/settings',
      '/api/analysis/refresh',
      '/api/analysis/trade',
      '/api/analysis/find',
      '/api/analysis/save',
      '/api/sleeper/lookup',
      '/api/sleeper/link',
      '/api/sleeper/sync',
      '/api/sleeper/disconnect',
      '/api/sleeper/activate',
      '/',
      '/app.js',
      '/trade-tools.js',
      '/styles.css',
    ]);
    path = routes.has(url.pathname) ? url.pathname : 'unknown';
    if (url.pathname.startsWith('/api/')) {
      if (!routes.has(url.pathname)) throw new AppError(404, 'NOT_FOUND', 'Endpoint not found.');
      if (req.method !== 'GET') {
        const origin = process.env.APP_ORIGIN || `http://${req.headers.host}`;
        if (
          (req.headers.origin && req.headers.origin !== origin) ||
          req.headers['sec-fetch-site'] === 'cross-site'
        )
          throw new AppError(403, 'ORIGIN_DENIED', 'Origin not allowed.');
        if (!req.headers['content-type']?.startsWith('application/json'))
          throw new AppError(415, 'JSON_REQUIRED', 'Use application/json.');
      }
      if (req.method === 'POST' && path === '/api/auth/logout') {
        auth.logout(req, res);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/api/auth/login')
        return json(res, 200, state(await auth.login(req, res, await body(req))));
      if (req.method === 'POST' && path === '/api/auth/recover') {
        const r = await auth.recover(req, res, await body(req));
        return json(res, 200, { ...state(r.account), recoveryCode: r.recoveryCode });
      }
      const account = session(req, res);
      if (req.method === 'POST' && path === '/api/auth/register') {
        if (imports.has(account))
          throw new AppError(409, 'REFRESH_IN_PROGRESS', 'Wait for the league refresh to finish.');
        const r = await auth.register(req, res, await body(req), account);
        return json(res, 200, { ...state(r.account), recoveryCode: r.recoveryCode });
      }
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, state(account));
      if (req.method === 'GET' && path === '/api/analysis')
        return json(res, 200, await analysis(account));
      if (req.method === 'PUT' && path === '/api/analysis/settings') {
        const input = await body(req),
          model = await analysis(account, input);
        fantasy.saveSettings(account, snapshot(account), model.settings);
        return json(res, 200, model);
      }
      if (
        req.method === 'POST' &&
        ['/api/analysis/trade', '/api/analysis/find', '/api/analysis/save'].includes(path)
      ) {
        const input = await body(req),
          model = await analysis(account);
        if (!model.data.ready)
          throw new AppError(
            409,
            'ANALYSIS_NOT_READY',
            'Refresh league data before analyzing trades.',
          );
        if (path === '/api/analysis/find') return json(res, 200, findTrades(model, input));
        const result = analyzeTrade(model, input);
        if (path === '/api/analysis/trade') return json(res, 200, result);
        const title = String(input.title || 'Trade scenario')
          .trim()
          .slice(0, 80);
        db.prepare('INSERT INTO trade_scenarios VALUES (?,?,?,?)').run(
          randomUUID(),
          account,
          JSON.stringify({
            title,
            input: {
              teamA: input.teamA,
              teamB: input.teamB,
              sendA: input.sendA,
              sendB: input.sendB,
              assumptions: result.assumptions,
              includeWaivers: input.includeWaivers !== false,
            },
            result,
            league: connection(account)?.league || 'demo',
          }),
          new Date().toISOString(),
        );
        return json(res, 200, await analysis(account));
      }
      if (req.method === 'POST' && path === '/api/sleeper/lookup') {
        const { username, season } = await body(req);
        return json(res, 200, await sleeper.lookup(username, season));
      }
      if (req.method === 'POST' && path === '/api/sleeper/link') {
        const { username, leagueId } = await body(req);
        return json(res, 200, await importLeague(account, username, leagueId));
      }
      if (req.method === 'POST' && ['/api/sleeper/sync', '/api/analysis/refresh'].includes(path)) {
        const link = connection(account);
        if (!link) throw invalid('Link a Sleeper league first.');
        const result = await importLeague(account, link.data.user.id, link.league);
        return json(res, 200, path === '/api/analysis/refresh' ? await analysis(account) : result);
      }
      if (req.method === 'POST' && path === '/api/sleeper/activate') {
        if (imports.has(account))
          throw new AppError(409, 'REFRESH_IN_PROGRESS', 'Wait for the league refresh to finish.');
        const { leagueId } = await body(req);
        validLeague(leagueId);
        if (
          !db
            .prepare('SELECT 1 FROM sleeper_links WHERE account=? AND league=?')
            .get(account, leagueId)
        )
          throw new AppError(404, 'NOT_FOUND', 'Linked league not found.');
        db.prepare(
          'INSERT INTO active_links VALUES (?,?) ON CONFLICT(account) DO UPDATE SET league=excluded.league',
        ).run(account, leagueId);
        return json(res, 200, state(account));
      }
      if (req.method === 'POST' && path === '/api/sleeper/disconnect') {
        if (imports.has(account))
          throw new AppError(409, 'REFRESH_IN_PROGRESS', 'Wait for the league refresh to finish.');
        db.prepare('DELETE FROM active_links WHERE account=?').run(account);
        return json(res, 200, state(account));
      }
      throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }
    if (req.method !== 'GET') throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    const files = {
      '/': 'index.html',
      '/app.js': 'app.js',
      '/trade-tools.js': 'trade-tools.js',
      '/styles.css': 'styles.css',
    };
    const file = files[url.pathname];
    if (!file) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    res.writeHead(200, {
      'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[
        extname(file)
      ],
    });
    res.end(readFileSync(resolve(root, 'public', file)));
  } catch (error) {
    const out = publicError(error);
    errorCode = out.code;
    json(res, out.status, { error: out.message, code: out.code, requestId });
  }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () =>
  console.log(
    `FF Trading running at http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`,
  ),
);
