import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('API isolates accounts, persists trades, and advances valuations', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ff-trading-test-'));
  const port = 31000 + Math.floor(Math.random() * 10000);
  const env = { ...process.env, PORT: String(port), DB_PATH: join(folder, 'test.sqlite') };
  let child;
  async function start() {
    child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    await Promise.race([
      new Promise((resolve, reject) => { child.stdout.on('data', c => { if (c.toString().includes('running at')) resolve(); }); child.once('error', reject); child.once('exit', code => reject(new Error(`Server exited ${code}`))); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000); timer.unref(); })
    ]);
  }
  async function request(path, cookie, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, { method, headers: { Cookie: cookie || '', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  }
  try {
    await start();
    const a = await request('state'), b = await request('state');
    assert.notEqual(a.cookie, b.cookie);
    const price = a.data.teams.find(t => t.id === 'grid').price;
    const buy = await request('trades', a.cookie, 'POST', { team: 'grid', side: 'buy', quantity: 2 });
    assert.equal(buy.status, 200);
    assert.equal(buy.data.account.cash, a.data.account.cash - price * 2);
    assert.equal(buy.data.holdings.find(h => h.team === 'grid').shares, 22);
    assert.equal((await request('state', b.cookie)).data.holdings.find(h => h.team === 'grid').shares, 20);
    const rejected = await request('trades', a.cookie, 'POST', { team: 'grid', side: 'sell', quantity: 999 });
    assert.equal(rejected.status, 400);
    assert.equal((await request('state', a.cookie)).data.account.cash, buy.data.account.cash);
    const simulation = await request('simulate', a.cookie, 'POST');
    assert.equal(simulation.data.account.week, 9);
    assert.equal(simulation.data.teams.find(t => t.id === 'grid').previous, price);
    assert.equal(simulation.data.teams.find(t => t.id === 'grid').history.length, 9);
    child.kill(); await once(child, 'exit'); await start();
    const persisted = await request('state', a.cookie);
    assert.equal(persisted.data.account.cash, buy.data.account.cash);
    assert.equal(persisted.data.trades.length, 1);
    assert.equal(persisted.data.account.week, 9);
    assert.equal((await request('roster', a.cookie, 'PUT', { roster: Array(7).fill('qb1') })).status, 400);
    assert.equal((await request('reset', a.cookie, 'POST')).status, 200);
    assert.equal((await request('state', a.cookie)).data.account.week, 8);
  } finally { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } }
});

test('Sleeper import persists, syncs without double pricing, and preserves separate portfolios', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ff-sleeper-test-'));
  const port = 42000 + Math.floor(Math.random() * 10000);
  const env = { ...process.env, PORT: String(port), DB_PATH: join(folder, 'test.sqlite') };
  let child;
  async function start() {
    child = spawn(process.execPath, ['--import','./fixtures/sleeper-fetch.mjs','server.js'], { env, stdio:['ignore','pipe','pipe'] });
    await Promise.race([
      new Promise((resolve,reject)=>{child.stdout.on('data',c=>{if(c.toString().includes('running at'))resolve();});child.once('error',reject);child.once('exit',code=>reject(new Error(`Server exited ${code}`)));}),
      new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timed out')),10000);timer.unref();})
    ]);
  }
  async function request(path,cookie,method='GET',body) {
    const r=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],data:await r.json()};
  }
  try {
    await start();
    const demo=await request('state'), other=await request('state');
    const lookup=await request('sleeper/lookup',demo.cookie,'POST',{username:'testmanager'});
    assert.equal(lookup.data.leagues.length,1);
    const linked=await request('sleeper/link',demo.cookie,'POST',{username:'testmanager',leagueId:'1234567890123'});
    assert.equal(linked.status,200); assert.equal(linked.data.connection.league.name,'Integration League');
    assert.equal(linked.data.account.cash,2500000); assert.equal(linked.data.teams[0].price,9975);
    assert.equal(linked.data.account.week,2); assert.equal(linked.data.players[0].name,'Real Starter');
    assert.equal((await request('state',other.cookie)).data.connection,null);
    assert.equal((await request('sleeper/sync',other.cookie,'POST')).status,400);
    const buy=await request('trades',demo.cookie,'POST',{team:'sl_1',side:'buy',quantity:2});
    assert.equal(buy.data.account.cash,2480050); assert.equal(buy.data.holdings[0].shares,2);
    const synced=await request('sleeper/sync',demo.cookie,'POST');
    assert.equal(synced.status,200); assert.equal(synced.data.teams[0].price,9975);
    assert.equal(synced.data.teams[0].history.length,3); assert.equal(synced.data.account.cash,buy.data.account.cash);
    assert.equal(synced.data.trades.length,1);
    assert.equal((await request('roster',demo.cookie,'PUT',{roster:['101','102']})).status,400);
    assert.equal((await request('simulate',demo.cookie,'POST')).status,400);
    assert.equal((await request('reset',demo.cookie,'POST')).status,400);
    const invalid=await request('sleeper/link',demo.cookie,'POST',{username:'testmanager',leagueId:'http://localhost'});
    assert.equal(invalid.status,400); assert.equal((await request('state',demo.cookie)).data.teams[0].price,9975);
    child.kill(); await once(child,'exit'); await start();
    assert.equal((await request('state',demo.cookie)).data.connection.user.username,'testmanager');
    const disconnected=await request('sleeper/disconnect',demo.cookie,'POST');
    assert.equal(disconnected.data.connection,null); assert.equal(disconnected.data.account.equity,demo.data.account.equity);
    const reconnected=await request('sleeper/link',demo.cookie,'POST',{username:'testmanager',leagueId:'1234567890123'});
    assert.equal(reconnected.data.account.cash,buy.data.account.cash); assert.equal(reconnected.data.trades.length,1);
    await request('sleeper/disconnect',demo.cookie,'POST');
    assert.equal((await request('reset',demo.cookie,'POST')).status,200);
    assert.equal((await request('state',demo.cookie)).data.account.cash,2500000);
  } finally { if(child && child.exitCode===null){child.kill();await once(child,'exit');} }
});
