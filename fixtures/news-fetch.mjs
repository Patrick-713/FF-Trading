// Local and integration-test feed only; production never imports this file.
const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://www.espn.com/espn/rss/nfl/news')
    return new Response(
      `<rss><channel><item><title>Test headline: Vikings prepare for Sunday</title><link>https://www.espn.com/nfl/story/_/id/123456/test-headline</link><pubDate>${new Date().toUTCString()}</pubDate><description>The team shared its latest update. Preparations continue this week.</description></item></channel></rss>`,
    );
  return original(url, options);
};
