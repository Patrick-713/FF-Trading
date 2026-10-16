/** Local HTTP bootstrap. Vercel calls the shared application handler directly. */
import http from 'node:http';
import { createApplication } from './application.js';
const app = await createApplication();
const server = http.createServer(app.handler);
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () =>
  console.log(
    'FF Trading running at http://' +
      (process.env.HOST || '127.0.0.1') +
      ':' +
      (process.env.PORT || 3000),
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () =>
    server.close(async () => {
      await app.close();
      process.exit(0);
    }),
  );
