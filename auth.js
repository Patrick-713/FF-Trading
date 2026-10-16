/** Authentication uses the same durable database on every application instance. */
import { invalid, AppError } from './errors.js';
import { transaction } from './database.js';
import { clientAddress } from './security.js';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
export const digest = (value) => createHash('sha256').update(value).digest('hex');
function emailFor(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw invalid('Enter a valid email address.');
  return value.trim().toLowerCase();
}
function passwordFor(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw invalid('Use a password with 12 to 128 characters.');
  return value;
}
async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = await derive(passwordFor(password), salt, 64, options);
  return { salt, hash: hash.toString('hex') };
}
export function createAuth(db) {
  if (!db.remote)
    db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,account TEXT UNIQUE NOT NULL REFERENCES accounts(id),salt TEXT NOT NULL,hash TEXT NOT NULL,recovery TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_sessions(token TEXT PRIMARY KEY,"user" TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  let hashing = 0;
  async function limitedHash(password, salt) {
    if (hashing >= 2)
      throw new AppError(429, 'RATE_LIMITED', 'Sign-in is busy. Please try again shortly.');
    hashing++;
    try {
      return await hashPassword(password, salt);
    } finally {
      hashing--;
    }
  }
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    Boolean(process.env.VERCEL) ||
    process.env.NODE_ENV === 'production';
  const cookieOptions = `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`;
  function setCookies(res, token) {
    res.setHeader('Set-Cookie', [
      `ff_auth=${token}; ${cookieOptions}`,
      'ff_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    ]);
  }
  async function identify(req) {
    const token = /(?:^|;\s*)ff_auth=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const row = await db
      .prepare(
        'SELECT u.id,u.email,u.name,u.account FROM login_sessions s JOIN users u ON u.id=s."user" WHERE s.token=? AND s.expires>?',
      )
      .get(digest(token), Date.now());
    return row ? { ...row, tokenHash: digest(token) } : null;
  }
  async function issue(res, userId) {
    await db.prepare('DELETE FROM login_sessions WHERE expires<=?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    await db
      .prepare('INSERT INTO login_sessions VALUES (?,?,?)')
      .run(digest(token), userId, Date.now() + 30 * 86400000);
    setCookies(res, token);
  }
  async function throttle(req, email, route) {
    const now = Date.now();
    for (const key of [`ip:${clientAddress(req)}:${route}`, `email:${digest(email)}:${route}`]) {
      const row = await db
        .prepare(
          'INSERT INTO auth_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.expires<=? THEN 1 ELSE auth_limits.attempts+1 END,expires=CASE WHEN auth_limits.expires<=? THEN ? ELSE auth_limits.expires END RETURNING attempts',
        )
        .get(key, now + 15 * 60000, now, now, now + 15 * 60000);
      if (row.attempts > 10)
        throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.');
    }
  }
  async function profile(account) {
    return (await db.prepare('SELECT email,name FROM users WHERE account=?').get(account)) || null;
  }
  async function register(req, res, input, account) {
    const email = emailFor(input.email),
      password = passwordFor(input.password),
      name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 60)
      throw invalid('Use a display name with 2 to 60 characters.');
    await throttle(req, email, 'register');
    if (await profile(account)) throw invalid('Log out before creating another account.');
    if (await db.prepare('SELECT id FROM users WHERE email=?').get(email))
      throw invalid('This email is already registered. Try logging in.');
    const credentials = await limitedHash(password),
      recoveryCode = randomBytes(24).toString('hex'),
      userId = randomUUID();
    try {
      await transaction(db, async () => {
        if (
          (await profile(account)) ||
          (await db.prepare('SELECT id FROM users WHERE email=?').get(email))
        )
          throw invalid('Account already registered. Try logging in.');
        await db
          .prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)')
          .run(
            userId,
            email,
            name,
            account,
            credentials.salt,
            credentials.hash,
            digest(recoveryCode),
            new Date().toISOString(),
          );
        await issue(res, userId);
      });
    } catch (error) {
      if (error.code === '23505')
        throw new AppError(409, 'ACCOUNT_EXISTS', 'Account already registered. Try logging in.');
      throw error;
    }
    return { account, recoveryCode };
  }
  async function login(req, res, input) {
    const email = emailFor(input.email),
      password = passwordFor(input.password);
    await throttle(req, email, 'login');
    const user = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const candidate = await limitedHash(password, user?.salt || '00000000000000000000000000000000');
    const current = user && (await db.prepare('SELECT hash FROM users WHERE id=?').get(user.id));
    if (
      !current ||
      !timingSafeEqual(Buffer.from(candidate.hash, 'hex'), Buffer.from(current.hash, 'hex'))
    )
      throw new AppError(401, 'UNAUTHORIZED', 'Email or password is incorrect.');
    await issue(res, user.id);
    return user.account;
  }
  async function recover(req, res, input) {
    const email = emailFor(input.email),
      password = passwordFor(input.password);
    await throttle(req, email, 'recover');
    const code = typeof input.recoveryCode === 'string' ? input.recoveryCode.trim() : '';
    const user = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (
      !user ||
      !/^[a-f0-9]{48}$/.test(code) ||
      !timingSafeEqual(Buffer.from(digest(code), 'hex'), Buffer.from(user.recovery, 'hex'))
    )
      throw new AppError(401, 'UNAUTHORIZED', 'Email or recovery code is incorrect.');
    const credentials = await limitedHash(password),
      recoveryCode = randomBytes(24).toString('hex');
    await transaction(db, async () => {
      const updated = await db
        .prepare('UPDATE users SET salt=?,hash=?,recovery=? WHERE id=? AND recovery=?')
        .run(credentials.salt, credentials.hash, digest(recoveryCode), user.id, user.recovery);
      if (updated.changes !== 1) throw invalid('Recovery code was already used.');
      await db.prepare('DELETE FROM login_sessions WHERE "user"=?').run(user.id);
      await issue(res, user.id);
    });
    return { account: user.account, recoveryCode };
  }
  async function logout(req, res) {
    const user = await identify(req);
    if (user) await db.prepare('DELETE FROM login_sessions WHERE token=?').run(user.tokenHash);
    res.setHeader('Set-Cookie', [
      'ff_auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      'ff_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    ]);
  }
  return { identify, profile, register, login, recover, logout };
}
