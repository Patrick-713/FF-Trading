/** Public NFL headlines. One small shared cache serves every account and cloud instance. */
import { randomUUID } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
const FEED = 'https://www.espn.com/espn/rss/nfl/news';
const TTL = 600000,
  MAX_AGE = 7 * 86400000,
  KEY = 'news:espn:nfl:v2';

export function parseNews(xml, now = Date.now()) {
  if (
    Buffer.byteLength(xml) > 262144 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new Error('Invalid news feed');
  const parsed = new XMLParser({
    ignoreAttributes: true,
    processEntities: true,
    parseTagValue: false,
  }).parse(xml);
  const items = parsed.rss?.channel?.item;
  if (!items) throw new Error('Missing news items');
  const seen = new Set();
  return (Array.isArray(items) ? items : [items])
    .flatMap((item) => {
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      // Keep the publisher's preview intact. Missing or oversized previews stay unavailable.
      const summary =
        typeof item.description === 'string' && item.description.length <= 4000
          ? item.description.trim()
          : '';
      const published = Date.parse(item.pubDate);
      let url;
      try {
        url = new URL(item.link);
      } catch {
        return [];
      }
      if (
        !title ||
        title.length > 500 ||
        !Number.isFinite(published) ||
        published > now + 300000 ||
        now - published > MAX_AGE ||
        url.protocol !== 'https:' ||
        !['www.espn.com', 'espn.com'].includes(url.hostname) ||
        url.username ||
        url.password ||
        seen.has(url.href)
      )
        return [];
      seen.add(url.href);
      return [{ title, summary, url: url.href, publishedAt: new Date(published).toISOString() }];
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 20);
}

export function createNews(db, { fetcher = globalThis.fetch, now = Date.now } = {}) {
  let pending,
    memory,
    memoryUntil = 0;
  const present = (data) => ({
    source: 'ESPN',
    checkedAt: data?.checkedAt || null,
    stale: !data?.checkedAt || now() - Date.parse(data.checkedAt) >= TTL,
    articles: (data?.articles || []).filter((a) => now() - Date.parse(a.publishedAt) <= MAX_AGE),
  });
  async function read() {
    const row = await db.prepare('SELECT data,fetched FROM fantasy_cache WHERE key=?').get(KEY);
    let data = row ? JSON.parse(row.data) : null;
    if (row && now() - row.fetched < TTL) return present(data);
    // A database lease bounds upstream requests even when Vercel starts several instances.
    const token = randomUUID();
    const lease = await db
      .prepare(
        'INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched WHERE fantasy_cache.fetched<=? RETURNING data',
      )
      .get(KEY + ':lease', token, now() + 30000, now());
    if (!lease) return present(data);
    try {
      // Another instance may have finished between our first read and the lease acquisition.
      const latest = await db
        .prepare('SELECT data,fetched FROM fantasy_cache WHERE key=?')
        .get(KEY);
      if (latest && now() - latest.fetched < TTL) return present(JSON.parse(latest.data));
      try {
        const response = await fetcher(FEED, {
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
          headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
        });
        if (!response.ok || !response.body) throw new Error('Feed unavailable');
        let size = 0;
        const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 262144) throw new Error('Feed too large');
          chunks.push(chunk);
        }
        const articles = parseNews(Buffer.concat(chunks).toString('utf8'), now());
        if (!articles.length) throw new Error('No recent news');
        data = { checkedAt: new Date(now()).toISOString(), articles };
      } catch {
        // Retry after ten minutes, keeping the last successful check time visible.
        data ||= { checkedAt: null, articles: [] };
      }
      await db
        .prepare(
          'INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched',
        )
        .run(KEY, JSON.stringify(data), now());
      return present(data);
    } finally {
      await db
        .prepare('DELETE FROM fantasy_cache WHERE key=? AND data=?')
        .run(KEY + ':lease', token);
    }
  }
  return async () => {
    if (memory && now() < memoryUntil) return present(memory);
    if (!pending)
      pending = read()
        .then((data) => {
          memory = data;
          memoryUntil = now() + 60000;
          return data;
        })
        .finally(() => {
          pending = null;
        });
    return pending;
  };
}
