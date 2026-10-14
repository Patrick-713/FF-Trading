import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
export const digest = value => createHash('sha256').update(value).digest('hex');
function emailFor(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
  return value.trim().toLowerCase();
}
function passwordFor(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new Error('Use a password with 12–128 characters.');
  return value;
}
async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = await derive(passwordFor(password), salt, 64, options);
  return { salt, hash: hash.toString('hex') };
}
export function createAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, account TEXT UNIQUE NOT NULL REFERENCES accounts(id), salt TEXT NOT NULL, hash TEXT NOT NULL, recovery TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  let hashing = 0;
  async function limitedHash(password,salt) {
    if (hashing >= 2) throw Object.assign(new Error('Sign-in is busy. Please try again shortly.'),{status:429});
    hashing++; try { return await hashPassword(password,salt); } finally { hashing--; }
  }
  const cookieOptions = `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`;
  function setCookies(res, token) {
    res.setHeader('Set-Cookie', [`ff_auth=${token}; ${cookieOptions}`, 'ff_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0']);
  }
  function identify(req) {
    const token = /(?:^|;\s*)ff_auth=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const row = db.prepare('SELECT u.id,u.email,u.name,u.account FROM login_sessions s JOIN users u ON u.id=s.user WHERE s.token=? AND s.expires>?').get(digest(token),Date.now());
    return row ? { ...row, tokenHash: digest(token) } : null;
  }
  function issue(res,userId) {
    db.prepare('DELETE FROM login_sessions WHERE expires<=?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO login_sessions VALUES (?,?,?)').run(digest(token),userId,Date.now()+30*86400000);
    setCookies(res,token);
  }
  function throttle(req,email,route) {
    const now=Date.now();
    db.prepare('DELETE FROM auth_limits WHERE expires<=?').run(now);
    for(const key of [`ip:${req.socket.remoteAddress}:${route}`,`email:${digest(email)}:${route}`]) {
      const row=db.prepare('SELECT attempts FROM auth_limits WHERE key=?').get(key);
      if(row?.attempts>=10) throw Object.assign(new Error('Too many attempts. Try again in 15 minutes.'),{status:429});
      db.prepare('INSERT INTO auth_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key,now+15*60000);
    }
  }
  function profile(account) { const user=db.prepare('SELECT email,name FROM users WHERE account=?').get(account); return user || null; }
  async function register(req,res,input,account) {
    const email=emailFor(input.email), password=passwordFor(input.password);
    const name=String(input.name || '').trim();
    if(name.length<2 || name.length>60) throw new Error('Use a display name with 2–60 characters.');
    throttle(req,email,'register');
    if(profile(account)) throw new Error('Log out before creating another account.');
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new Error('This email is already registered. Try logging in.');
    const credentials=await limitedHash(password), recoveryCode=randomBytes(24).toString('hex'), userId=randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      // Recheck after hashing: concurrent registration cannot claim the same guest account.
      if(profile(account) || db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new Error('Account already registered. Try logging in.');
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(userId,email,name,account,credentials.salt,credentials.hash,digest(recoveryCode),new Date().toISOString());
      issue(res,userId); db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
    return { account, recoveryCode };
  }
  async function login(req,res,input) {
    const email=emailFor(input.email), password=passwordFor(input.password);
    throttle(req,email,'login');
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const candidate=await limitedHash(password,user?.salt || '00000000000000000000000000000000');
    const current=user && db.prepare('SELECT hash FROM users WHERE id=?').get(user.id);
    if(!current || !timingSafeEqual(Buffer.from(candidate.hash,'hex'),Buffer.from(current.hash,'hex'))) throw Object.assign(new Error('Email or password is incorrect.'),{status:401});
    issue(res,user.id); return user.account;
  }
  async function recover(req,res,input) {
    const email=emailFor(input.email), password=passwordFor(input.password);
    throttle(req,email,'recover');
    const code=typeof input.recoveryCode==='string'?input.recoveryCode.trim():'';
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if(!user || !/^[a-f0-9]{48}$/.test(code) || !timingSafeEqual(Buffer.from(digest(code),'hex'),Buffer.from(user.recovery,'hex'))) throw Object.assign(new Error('Email or recovery code is incorrect.'),{status:401});
    const credentials=await limitedHash(password), recoveryCode=randomBytes(24).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const updated=db.prepare('UPDATE users SET salt=?,hash=?,recovery=? WHERE id=? AND recovery=?').run(credentials.salt,credentials.hash,digest(recoveryCode),user.id,user.recovery);
      if(updated.changes!==1) throw new Error('Recovery code was already used.');
      db.prepare('DELETE FROM login_sessions WHERE user=?').run(user.id);
      issue(res,user.id); db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');throw error;}
    return {account:user.account,recoveryCode};
  }
  function logout(req,res) {
    const user=identify(req); if(user) db.prepare('DELETE FROM login_sessions WHERE token=?').run(user.tokenHash);
    res.setHeader('Set-Cookie',['ff_auth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0','ff_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0']);
  }
  return {identify,profile,register,login,recover,logout};
}
