import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
test('public simulator uses real players, enforces redraft, persists scenarios and never executes a roster trade', async () => {
  const port = 60000 + Math.floor(Math.random() * 3000),
    folder = mkdtempSync(join(tmpdir(), 'ff-analysis-'));
  let child;
  try {
    child = spawn(process.execPath, ['server.js'], {
      env: { ...process.env, PORT: String(port), DB_PATH: join(folder, 'test.sqlite') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.on('data', (c) => {
          if (c.toString().includes('running at')) resolve();
        });
        child.once('error', reject);
        child.once('exit', (c) => reject(new Error(`Server exited ${c}`)));
      }),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error('Startup timeout')), 10000);
        t.unref();
      }),
    ]);
    async function request(path, cookie, method = 'GET', body) {
      const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
        method,
        headers: { Cookie: cookie || '', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: r.status,
        cookie: r.headers.get('set-cookie')?.split(';')[0],
        data: await r.json(),
      };
    }
    const guest = await request('state'),
      before = guest.data;
    const redraft = await request('analysis', guest.cookie);
    assert.equal(redraft.data.settings.mode, 'redraft');
    assert.equal(redraft.data.picks.length, 0);
    assert.equal(redraft.data.players.length, 300);
    assert.equal(redraft.data.teams.length, 20);
    assert.equal(new Set(redraft.data.players.map((p) => p.gsis)).size, 300);
    assert.ok(redraft.data.players.every((p) => redraft.data.teams.some((t) => t.id === p.owner)));
    assert.ok(redraft.data.teams.every((t) => t.playerCount === 15 && t.rosterLimit === 15));
    const expanded = redraft.data.players.find(
      (p) => p.id.startsWith('pool_') && p.owner !== 'demo_a',
    );
    const expandedTrade = await request('analysis/trade', guest.cookie, 'POST', {
      teamA: 'demo_a',
      teamB: expanded.owner,
      sendA: ['demo_3'],
      sendB: [expanded.id],
    });
    assert.equal(expandedTrade.status, 200);
    const custom = {
      teamA: 'demo_a',
      teamB: 'demo_b',
      sendA: ['demo_7'],
      sendB: ['demo_3'],
      customTeams: true,
    };
    const customGuest = await request('state');
    const customSaved = await request('analysis/save', customGuest.cookie, 'POST', {
      ...custom,
      title: 'Custom sides',
    });
    assert.equal(customSaved.status, 200);
    assert.equal(customSaved.data.saved[0].input.customTeams, true);
    assert.equal(customSaved.data.saved[0].result.customTeams, true);
    const unchanged = await request('analysis', guest.cookie);
    assert.equal(unchanged.data.players.find((p) => p.id === 'demo_7').owner, 'demo_b');

    const input = { teamA: 'demo_a', teamB: 'demo_b', sendA: ['demo_3'], sendB: ['demo_7'] };
    const analyzed = await request('analysis/trade', guest.cookie, 'POST', input);
    assert.equal(analyzed.status, 200);
    assert.equal(analyzed.data.teamA.valueChange, -analyzed.data.teamB.valueChange);
    assert.deepEqual((await request('state', guest.cookie)).data.account, before.account);
    const dynasty = await request('analysis/settings', guest.cookie, 'PUT', {
      mode: 'dynasty',
      superflex: true,
    });
    assert.equal(dynasty.status, 200);
    assert.equal(dynasty.data.settings.mode, 'redraft');
    assert.equal(dynasty.data.picks.length, 0);
    assert.equal(redraft.data.players[0].name, 'Josh Allen');
    assert.match(redraft.data.data.source, /nflverse/);
    const pick = { id: 'unavailable-pick' };
    const picks = await request('analysis/trade', guest.cookie, 'POST', {
      ...input,
      sendA: [pick.id],
    });
    assert.equal(picks.status, 400);
    const adjusted = {
      ...input,
      includeWaivers: false,
    };
    const saved = await request('analysis/save', guest.cookie, 'POST', {
      ...adjusted,
      title: 'Test comparison',
    });
    assert.equal(saved.data.saved.length, 1);
    assert.equal(saved.data.saved[0].input.assumptions, undefined);
    assert.equal(saved.data.saved[0].input.includeWaivers, false);
    assert.ok(saved.data.saved[0].result.teamA.afterLineup);
    assert.equal(saved.data.saved[0].result.sensitivity, undefined);
    const ideas = await request('analysis/find', guest.cookie, 'POST', { goal: 'WR' });
    assert.equal(ideas.status, 200);
    assert.ok(Array.isArray(ideas.data.offers));
    const otherIdeas = await request('analysis/find', guest.cookie, 'POST', {
      goal: 'WR',
      teamA: 'demo_b',
    });
    assert.equal(otherIdeas.status, 200);
    assert.ok(otherIdeas.data.offers.every((o) => o.input.teamA === 'demo_b'));
    assert.equal(
      (await request('analysis/find', guest.cookie, 'POST', { goal: 'WR', teamA: 'foreign-team' }))
        .status,
      400,
    );
    assert.equal(
      (await request('analysis/find', guest.cookie, 'POST', { goal: 'invalid' })).status,
      400,
    );
    assert.equal(
      (
        await request('analysis/trade', guest.cookie, 'POST', {
          ...input,
          assumptions: { demo_0: { workload: 1 } },
        })
      ).status,
      400,
    );
    const script = await fetch(`http://127.0.0.1:${port}/trade-tools.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    const other = await request('state');
    assert.equal((await request('analysis', other.cookie)).data.saved.length, 0);
    await request('analysis/settings', guest.cookie, 'PUT', { mode: 'redraft' });
    assert.equal(
      (await request('analysis/trade', guest.cookie, 'POST', { ...input, sendA: [pick.id] }))
        .status,
      400,
    );
    assert.equal(
      (await request('analysis/settings', guest.cookie, 'PUT', { mode: 'money' })).status,
      400,
    );
    assert.equal((await request('analysis', guest.cookie)).data.settings.mode, 'redraft');
    assert.equal((await request('analysis', guest.cookie)).data.saved[0].title, 'Test comparison');
  } finally {
    if (child?.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
});
