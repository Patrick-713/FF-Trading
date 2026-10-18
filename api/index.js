/** One warm application serves all API routes; initialization failures stay private. */
import { createApplication } from '../src/http/application.js';
let application;
export default async function handler(req, res) {
  try {
    application ??= createApplication().catch((error) => {
      application = undefined;
      throw error;
    });
    const app = await application;
    const url = new URL(req.url, 'https://ff-trading.invalid');
    const route = url.searchParams.get('__ff_route');
    if (route !== null) {
      url.searchParams.delete('__ff_route');
      req.url = '/api/' + route + (url.searchParams.size ? '?' + url.searchParams : '');
    }
    return await app.handler(req, res);
  } catch {
    console.error(JSON.stringify({ event: 'application_unavailable' }));
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        error: 'The service is temporarily unavailable. Please try again shortly.',
        code: 'SERVICE_UNAVAILABLE',
      }),
    );
  }
}
