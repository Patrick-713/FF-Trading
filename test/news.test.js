import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createNews, parseNews } from '../src/integrations/news.js';
const clock = Date.parse('2026-10-17T16:00:00Z');
const item = (
  title,
  link = 'https://www.espn.com/nfl/story/1',
  date = new Date(clock).toUTCString(),
) => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;
const feed = (items) => `<rss><channel>${items}</channel></rss>`;
test('news validates dates and publisher URLs, deduplicates and rejects unsafe XML', () => {
  const articles = parseNews(
    feed(
      item('A &amp; B') +
        item('Duplicate') +
        item('Unsafe', 'javascript:alert(1)') +
        item('Wrong publisher', 'https://example.com/') +
        item('Old', 'https://espn.com/old', 'Mon, 01 Jan 2024 00:00:00 GMT'),
    ),
    clock,
  );
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, 'A & B');
  assert.throws(() => parseNews('<!DOCTYPE rss><rss/>', clock));
  assert.throws(() => parseNews('<rss>', clock));
});
test('news shares fetches across instances, backs off outages and expires old stories', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE fantasy_cache(key TEXT PRIMARY KEY,data TEXT,fetched INTEGER);');
  let time = clock,
    calls = 0,
    fail = false;
  const options = {
    now: () => time,
    fetcher: async () => {
      calls++;
      if (fail) throw new Error('offline');
      await new Promise((r) => setTimeout(r, 5));
      return new Response(feed(item('Current story')));
    },
  };
  const a = createNews(db, options),
    b = createNews(db, options);
  const [first] = await Promise.all([a(), a(), b()]);
  assert.equal(calls, 1);
  assert.equal(first.stale, false);
  await b();
  assert.equal(calls, 1);
  time += 600001;
  fail = true;
  const stale = await a();
  assert.equal(calls, 2);
  assert.equal(stale.stale, true);
  assert.equal(stale.articles.length, 1);
  await createNews(db, options)();
  assert.equal(calls, 2);
  time += 8 * 86400000;
  assert.equal((await a()).articles.length, 0);
  db.close();
});

test('publisher previews preserve their text and handle absent or malformed descriptions', () => {
  const withDescription = (description) =>
    feed(item('Preview story').replace('</item>', description + '</item>'));
  const summary = 'A & B are expected to play. The team confirmed the update.';
  assert.equal(
    parseNews(
      withDescription(
        '<description>A &amp; B are expected to play. The team confirmed the update.</description>',
      ),
      clock,
    )[0].summary,
    summary,
  );
  assert.equal(parseNews(feed(item('No preview')), clock)[0].summary, '');
  assert.equal(
    parseNews(withDescription('<description><nested>Unexpected</nested></description>'), clock)[0]
      .summary,
    '',
  );
  assert.equal(
    parseNews(withDescription('<description>' + 'a'.repeat(4001) + '</description>'), clock)[0]
      .summary,
    '',
  );
  assert.equal(
    parseNews(
      withDescription('<description><![CDATA[<img src=x onerror=alert(1)>]]></description>'),
      clock,
    )[0].summary,
    '<img src=x onerror=alert(1)>',
  );
});
