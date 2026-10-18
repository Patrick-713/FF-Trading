/** Run once with a direct database URL before deploying code that requires a new schema. */
import { openDatabase } from '../src/storage/storage.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for cloud migrations.');
const db = await openDatabase({ migrateSchema: true });
await db.close();
console.log('PostgreSQL schema is ready.');
