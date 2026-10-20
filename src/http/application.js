/** HTTP entry point. Routes identify the account, validate input and call the service modules. */
import { createNews } from '../integrations/news.js';
import { storyUrl, saveStory, removeStory } from '../auth/saved-news.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction } from '../storage/database.js';
import { AppError, invalid, publicError, logRequest } from './errors.js';
import { openDatabase } from '../storage/storage.js';
import { consumeLimit, clientAddress } from './security.js';
import { createAuth } from '../auth/auth.js';
import { readPreferences, savePreferences } from '../auth/preferences.js';
import { createSleeperClient, validLeague, rosterStandings } from '../integrations/sleeper.js';
import { createFantasy, DEMO_LEAGUE } from '../analysis/fantasy.js';
import { loadRookieDrafts } from '../analysis/prospects.js';
import { analyzeTrade, findTrades } from '../analysis/trade-engine.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function createApplication() {
  const db = await openDatabase();
  const auth = createAuth(db),
    fantasy = createFantasy(db);
  const news = createNews(db);
  const sleeper = createSleeperClient({
    cache: {
      async get(path) {
        const r = await db.prepare('SELECT expires,data FROM sleeper_cache WHERE path=?').get(path);
        return r ? { expires: r.expires, data: JSON.parse(r.data) } : undefined;
      },
      async set(path, value) {
        await db
          .prepare(
            'INSERT INTO sleeper_cache VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET expires=excluded.expires,data=excluded.data',
          )
          .run(path, value.expires, JSON.stringify(value.data));
      },
    },
  });
  /** A lease prevents two cloud instances from refreshing one account simultaneously. */
  async function isRefreshing(account) {
    return Boolean(
      await db
        .prepare('SELECT 1 FROM refresh_locks WHERE account=? AND expires>?')
        .get(account, Date.now()),
    );
  }
  async function acquireRefresh(account) {
    const now = Date.now(),
      token = randomUUID();
    const row = await db
      .prepare(
        'INSERT INTO refresh_locks VALUES (?,?,?) ON CONFLICT(account) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE refresh_locks.expires<=? RETURNING token',
      )
      .get(account, token, now + 360000, now);
    if (!row)
      throw new AppError(409, 'REFRESH_IN_PROGRESS', 'A league refresh is already running.');
    return token;
  }
  async function connection(account) {
    const row = await db
      .prepare(
        'SELECT l.league,l.data FROM sleeper_links l JOIN active_links a ON a.account=l.account AND a.league=l.league WHERE a.account=?',
      )
      .get(account);
    return row ? { league: row.league, data: JSON.parse(row.data) } : null;
  }
  /** Resolve a signed-in account or create a separate guest workspace. */
  async function session(req, res) {
    const signedIn = await auth.identify(req);
    if (signedIn) return signedIn.account;
    let account = /(?:^|;\s*)ff_session=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (
      !account ||
      !(await db.prepare('SELECT 1 FROM accounts WHERE id=?').get(account)) ||
      (await auth.profile(account))
    ) {
      await consumeLimit(db, 'guest:' + clientAddress(req), 60, 3600000);
      account = randomUUID();
      await db.prepare('INSERT INTO accounts(id) VALUES (?)').run(account);
      res.setHeader(
        'Set-Cookie',
        `ff_session=${account}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE === 'true' || process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
      );
    }
    return account;
  }
  async function state(account) {
    return {
      account: { id: account },
      connection: (await connection(account))?.data || null,
      user: await auth.profile(account),
      preferences: await readPreferences(db, account),
    };
  }
  async function cached(path) {
    const r = await db.prepare('SELECT data FROM sleeper_cache WHERE path=?').get(path);
    return r ? JSON.parse(r.data) : null;
  }
  async function snapshot(account) {
    const linked = await connection(account);
    if (!linked) return null;
    const s = structuredClone(linked.data),
      raw = s.analysisRefreshedAt ? null : await cached(`league/${linked.league}`),
      rosters = s.teams.every(
        (t) =>
          Array.isArray(t.playerIds) &&
          Array.isArray(t.protectedIds) &&
          Object.hasOwn(t, 'pointsFor'),
      )
        ? null
        : await cached(`league/${linked.league}/rosters`);
    // Enrich imports created before roster capacity and draft metadata were persisted.
    if (raw && !s.analysisRefreshedAt) {
      s.league = {
        ...s.league,
        type: Number(raw.settings?.type || 0),
        draftRounds: Number(raw.settings?.draft_rounds || 0),
        scoring: raw.scoring_settings || {},
      };
      s.rosterLimit = (raw.roster_positions || []).filter(
        (p) => !['IR', 'TAXI'].includes(p),
      ).length;
    }
    s.teams = s.teams.map((t) => {
      const r = rosters?.find((r) => r.roster_id === t.rosterId);
      return {
        ...t,
        ...(r ? rosterStandings(r.settings) : {}),
        playerIds: t.playerIds || r?.players || [],
        protectedIds: t.protectedIds || [...(r?.reserve || []), ...(r?.taxi || [])],
      };
    });
    return s;
  }
  /** Read saved analysis inputs. Provider requests belong to importLeague. */
  async function analysis(account, input, profilePlayer = null) {
    const s = await snapshot(account);
    // Prepared inputs already contain a small frozen catalog. Never reread the full provider catalog for them or demos.
    const catalog = s && !s.analysisRefreshedAt ? (await cached('players/nfl')) || {} : {};
    return fantasy.model(account, s, catalog, input, profilePlayer);
  }
  /** Prepare provider data first, then commit the league and its inputs together. */
  async function importLeague(account, username, leagueId) {
    const token = await acquireRefresh(account);
    try {
      await consumeLimit(db, 'refresh:' + account, 6, 600000);
      const s = await sleeper.snapshot(username, leagueId),
        catalog = (await cached('players/nfl')) || {};
      if (s.league.type === 2) s.tradedPicks = await sleeper.get(`league/${leagueId}/traded_picks`);
      s.rookieDrafts = await loadRookieDrafts(
        sleeper.get,
        s.league,
        Number(s.league.season),
        catalog,
      );
      const inputs = await fantasy.prepareSnapshot(s, catalog);
      s.analysisRefreshedAt = new Date().toISOString();
      await transaction(db, async () => {
        await db
          .prepare(
            'INSERT INTO sleeper_links VALUES (?,?,?) ON CONFLICT(account,league) DO UPDATE SET data=excluded.data',
          )
          .run(account, leagueId, JSON.stringify(s));
        await db
          .prepare(
            'INSERT INTO active_links VALUES (?,?) ON CONFLICT(account) DO UPDATE SET league=excluded.league',
          )
          .run(account, leagueId);
        await fantasy.storeSnapshot(account, s, inputs);
      });
      return await state(account);
    } finally {
      await db.prepare('DELETE FROM refresh_locks WHERE account=? AND token=?').run(account, token);
    }
  }
  /** Accept a bounded JSON object and return clear validation errors. */
  async function body(req) {
    const chunks = [];
    let size = 0;
    if (req.body !== undefined) {
      const encoded =
        typeof req.body === 'object' && !Buffer.isBuffer(req.body)
          ? JSON.stringify(req.body)
          : req.body;
      const chunk = Buffer.from(encoded);
      chunks.push(chunk);
      size = chunk.length;
    } else
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 8192) throw new AppError(413, 'BODY_TOO_LARGE', 'Request is too large.');
        chunks.push(bytes);
      }
    if (size > 8192) throw new AppError(413, 'BODY_TOO_LARGE', 'Request is too large.');
    const text = Buffer.concat(chunks).toString('utf8');
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
  const handler = async (req, res) => {
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
        '/api/health',
        '/api/news',
        '/api/news/saved',
        '/api/state',
        '/api/preferences',
        '/api/auth/login',
        '/api/auth/logout',
        '/api/auth/register',
        '/api/auth/forgot',
        '/api/auth/verification',
        '/api/auth/reset',
        '/api/auth/verify',
        '/api/analysis',
        '/api/analysis/player',
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
        '/player-profile.js',
        '/nfl-teams.js',
        '/styles.css',
      ]);
      path = routes.has(url.pathname) ? url.pathname : 'unknown';
      if (url.pathname.startsWith('/api/')) {
        if (!routes.has(url.pathname)) throw new AppError(404, 'NOT_FOUND', 'Endpoint not found.');
        if (req.method === 'GET' && path === '/api/health') {
          await db.prepare('SELECT 1 AS ready').get();
          return json(res, 200, { ok: true, storage: db.remote ? 'postgres' : 'sqlite' });
        }
        if (req.method === 'GET' && path === '/api/news') {
          const headlines = await news();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=60',
          });
          return res.end(JSON.stringify(headlines));
        }
        if (req.method !== 'GET') {
          const origin =
            process.env.APP_ORIGIN ||
            `${process.env.VERCEL ? 'https' : 'http'}://${req.headers.host}`;
          if (
            (req.headers.origin && req.headers.origin !== origin) ||
            req.headers['sec-fetch-site'] === 'cross-site'
          )
            throw new AppError(403, 'ORIGIN_DENIED', 'Origin not allowed.');
          if (!req.headers['content-type']?.startsWith('application/json'))
            throw new AppError(415, 'JSON_REQUIRED', 'Use application/json.');
        }
        if (req.method === 'POST' && path === '/api/auth/logout') {
          await auth.logout(req, res);
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && path === '/api/auth/login')
          return json(res, 200, await state(await auth.login(req, res, await body(req))));
        if (req.method === 'POST' && ['/api/auth/forgot', '/api/auth/verification'].includes(path))
          return json(
            res,
            200,
            await auth.requestEmail(
              req,
              await body(req),
              path.endsWith('/forgot') ? 'reset' : 'verify',
            ),
          );
        if (req.method === 'POST' && ['/api/auth/reset', '/api/auth/verify'].includes(path))
          return json(
            res,
            200,
            await auth.consumeLink(
              req,
              await body(req),
              path.endsWith('/reset') ? 'reset' : 'verify',
            ),
          );
        const account = await session(req, res);
        if (path === '/api/news/saved') {
          if (req.method === 'GET')
            return json(res, 200, { preferences: await readPreferences(db, account) });
          if (['POST', 'DELETE'].includes(req.method)) {
            await consumeLimit(db, 'saved-news:' + account, 60, 60000);
            const input = await body(req),
              url = storyUrl(input.url);
            if (req.method === 'DELETE')
              return json(res, 200, { preferences: await removeStory(db, account, url) });
            const preferences = await readPreferences(db, account);
            if (preferences.savedStories?.some((story) => story.url === url))
              return json(res, 200, { preferences });
            // The client supplies only a URL. Titles and dates come from the validated feed.
            const article = (await news()).articles.find((article) => article.url === url);
            if (!article)
              throw invalid(
                'This headline has left the news feed. Refresh news and choose a current story.',
              );
            return json(res, 200, { preferences: await saveStory(db, account, article) });
          }
        }
        if (req.method === 'PUT' && path === '/api/preferences') {
          await consumeLimit(db, 'preferences:' + account, 60, 3600000);
          const preferences = await savePreferences(db, account, await body(req));
          return json(res, 200, { preferences });
        }
        if (req.method === 'POST' && path === '/api/auth/register') {
          if (await isRefreshing(account))
            throw new AppError(
              409,
              'REFRESH_IN_PROGRESS',
              'Wait for the league refresh to finish.',
            );
          const r = await auth.register(req, res, await body(req), account);
          return json(res, 200, { ...(await state(r.account)), emailSent: r.emailSent });
        }
        if (req.method === 'GET' && path === '/api/state')
          return json(res, 200, await state(account));
        if (req.method === 'GET' && path === '/api/analysis')
          return json(res, 200, await analysis(account));
        if (req.method === 'GET' && path === '/api/analysis/player') {
          const playerId = url.searchParams.get('id') || '';
          if (!/^[A-Za-z0-9_-]{1,80}$/.test(playerId)) throw invalid('Choose a valid player.');
          const profile = await analysis(account, undefined, playerId);
          if (!profile) throw new AppError(404, 'NOT_FOUND', 'Player is not in this analysis.');
          return json(res, 200, profile);
        }
        if (req.method === 'PUT' && path === '/api/analysis/settings') {
          const input = await body(req),
            linked = await snapshot(account);
          if (input.reset === true) await fantasy.resetSettings(account, linked);
          else await fantasy.saveSettings(account, linked, input);
          return json(res, 200, await analysis(account));
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
          if (path === '/api/analysis/find') {
            await consumeLimit(db, 'finder:' + account, 15, 60000);
            if (input.teamA && !model.teams.some((t) => t.id === input.teamA))
              throw invalid('Choose a team in this league.');
            return json(
              res,
              200,
              findTrades(input.teamA ? { ...model, ownTeam: input.teamA } : model, input),
            );
          }
          const result = analyzeTrade(model, input);
          if (path === '/api/analysis/trade') return json(res, 200, result);
          await consumeLimit(db, 'save:' + account, 60, 3600000);
          const count = await db
            .prepare('SELECT COUNT(*) AS count FROM trade_scenarios WHERE account=?')
            .get(account);
          if (Number(count.count) >= 500)
            throw invalid('This account has reached its limit of 500 saved scenarios.');
          const title = String(input.title || 'Trade scenario')
            .trim()
            .slice(0, 80);
          await db.prepare('INSERT INTO trade_scenarios VALUES (?,?,?,?)').run(
            randomUUID(),
            account,
            JSON.stringify({
              title,
              input: {
                teamA: input.teamA,
                teamB: input.teamB,
                customTeams: input.customTeams === true,
                comparisonMode: input.customTeams === true ? result.settings.mode : undefined,
                sendA: input.sendA,
                sendB: input.sendB,
                includeWaivers: input.includeWaivers !== false,
              },
              result,
              league: (await connection(account))?.league || DEMO_LEAGUE,
            }),
            new Date().toISOString(),
          );
          return json(res, 200, await analysis(account));
        }
        if (req.method === 'POST' && path === '/api/sleeper/lookup') {
          await consumeLimit(db, 'lookup:' + account, 20, 60000);
          const { username, season } = await body(req);
          return json(res, 200, await sleeper.lookup(username, season));
        }
        if (req.method === 'POST' && path === '/api/sleeper/link') {
          const { username, leagueId } = await body(req);
          return json(res, 200, await importLeague(account, username, leagueId));
        }
        if (
          req.method === 'POST' &&
          ['/api/sleeper/sync', '/api/analysis/refresh'].includes(path)
        ) {
          const link = await connection(account);
          if (!link) throw invalid('Link a Sleeper league first.');
          const result = await importLeague(account, link.data.user.id, link.league);
          return json(
            res,
            200,
            path === '/api/analysis/refresh' ? await analysis(account) : result,
          );
        }
        if (req.method === 'POST' && path === '/api/sleeper/activate') {
          if (await isRefreshing(account))
            throw new AppError(
              409,
              'REFRESH_IN_PROGRESS',
              'Wait for the league refresh to finish.',
            );
          const { leagueId } = await body(req);
          validLeague(leagueId);
          if (
            !(await db
              .prepare('SELECT 1 FROM sleeper_links WHERE account=? AND league=?')
              .get(account, leagueId))
          )
            throw new AppError(404, 'NOT_FOUND', 'Linked league not found.');
          await db
            .prepare(
              'INSERT INTO active_links VALUES (?,?) ON CONFLICT(account) DO UPDATE SET league=excluded.league',
            )
            .run(account, leagueId);
          return json(res, 200, await state(account));
        }
        if (req.method === 'POST' && path === '/api/sleeper/disconnect') {
          if (await isRefreshing(account))
            throw new AppError(
              409,
              'REFRESH_IN_PROGRESS',
              'Wait for the league refresh to finish.',
            );
          await db.prepare('DELETE FROM active_links WHERE account=?').run(account);
          return json(res, 200, await state(account));
        }
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      if (req.method !== 'GET')
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      const files = {
        '/': 'index.html',
        '/app.js': 'app.js',
        '/trade-tools.js': 'trade-tools.js',
        '/player-profile.js': 'player-profile.js',
        '/nfl-teams.js': 'nfl-teams.js',
        '/styles.css': 'styles.css',
        '/favicon.svg': 'favicon.svg',
        '/favicon.ico': 'favicon.ico',
        '/apple-touch-icon.png': 'apple-touch-icon.png',
      };
      const file = files[url.pathname];
      if (!file) throw new AppError(404, 'NOT_FOUND', 'Not found.');
      res.writeHead(200, {
        'Content-Type': {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.png': 'image/png',
        }[extname(file)],
      });
      res.end(readFileSync(resolve(root, 'public', file)));
    } catch (error) {
      const out = publicError(error);
      errorCode = out.code;
      json(res, out.status, { error: out.message, code: out.code, requestId });
    }
  };
  return { handler, db, close: () => db.close() };
}
