import { isIP } from 'node:net';
import { AppError } from './errors.js';

/** Forwarded client addresses are trusted only inside the Vercel runtime. */
export function clientAddress(req) {
  const forwarded = process.env.VERCEL
    ? String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim()
    : null;
  return forwarded && isIP(forwarded) ? forwarded : req.socket?.remoteAddress || 'unknown';
}

/** Atomic counters apply across all cloud instances, rather than one process's memory. */
export async function consumeLimit(db, key, maximum, windowMs) {
  const now = Date.now(),
    expires = now + windowMs;
  const row = await db
    .prepare(
      'INSERT INTO resource_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN resource_limits.expires<=? THEN 1 ELSE resource_limits.attempts+1 END,expires=CASE WHEN resource_limits.expires<=? THEN ? ELSE resource_limits.expires END RETURNING attempts',
    )
    .get(key, expires, now, now, expires);
  if (row.attempts > maximum)
    throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
}
