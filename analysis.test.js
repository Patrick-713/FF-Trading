import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
test('analysis API supports both formats, persists scenarios, and never executes a roster trade',async()=>{
  const port=60000+Math.floor(Math.random()*3000),folder=mkdtempSync(join(tmpdir(),'ff-analysis-'));let child;
  try{
    child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),DB_PATH:join(folder,'test.sqlite')},stdio:['ignore','pipe','pipe']});
    await Promise.race([new Promise((resolve,reject)=>{child.stdout.on('data',c=>{if(c.toString().includes('running at'))resolve();});child.once('error',reject);child.once('exit',c=>reject(new Error(`Server exited ${c}`)));}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Startup timeout')),10000);t.unref();})]);
    async function request(path,cookie,method='GET',body){const r=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],data:await r.json()};}
    const guest=await request('state'),before=guest.data;
    const redraft=await request('analysis',guest.cookie);assert.equal(redraft.data.settings.mode,'redraft');assert.equal(redraft.data.picks.length,0);
    const input={teamA:'demo_a',teamB:'demo_b',sendA:['demo_3'],sendB:['demo_7']};
    const analyzed=await request('analysis/trade',guest.cookie,'POST',input);assert.equal(analyzed.status,200);assert.equal(analyzed.data.teamA.valueChange,-analyzed.data.teamB.valueChange);
    assert.deepEqual((await request('state',guest.cookie)).data.account,before.account);
    const dynasty=await request('analysis/settings',guest.cookie,'PUT',{mode:'dynasty',superflex:true});assert.equal(dynasty.status,200);assert.equal(dynasty.data.picks.length,18);
    const pick=dynasty.data.picks.find(p=>p.owner==='demo_a');
    const picks=await request('analysis/trade',guest.cookie,'POST',{...input,sendA:[pick.id]});assert.equal(picks.status,200);
    const adjusted={...input,includeWaivers:false,assumptions:{demo_7:{workload:.85,development:1.3}}};
    const saved=await request('analysis/save',guest.cookie,'POST',{...adjusted,title:'Test comparison'});assert.equal(saved.data.saved.length,1);
    assert.deepEqual(saved.data.saved[0].input.assumptions.demo_7,{workload:.85,development:1.3,tier:'mid'});
    assert.equal(saved.data.saved[0].input.includeWaivers,false);
    assert.ok(saved.data.saved[0].result.teamA.afterLineup);
    assert.equal(saved.data.saved[0].result.sensitivity.length,2);
    const ideas=await request('analysis/find',guest.cookie,'POST',{goal:'WR'});assert.equal(ideas.status,200);assert.ok(Array.isArray(ideas.data.offers));
    assert.equal((await request('analysis/find',guest.cookie,'POST',{goal:'invalid'})).status,400);
    assert.equal((await request('analysis/trade',guest.cookie,'POST',{...input,assumptions:{demo_0:{workload:1}}})).status,400);
    const script=await fetch(`http://127.0.0.1:${port}/trade-tools.js`);assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);
    const other=await request('state');assert.equal((await request('analysis',other.cookie)).data.saved.length,0);
    await request('analysis/settings',guest.cookie,'PUT',{mode:'redraft'});
    assert.equal((await request('analysis/trade',guest.cookie,'POST',{...input,sendA:[pick.id]})).status,400);
    assert.equal((await request('analysis/settings',guest.cookie,'PUT',{mode:'money'})).status,400);
    assert.equal((await request('analysis',guest.cookie)).data.settings.mode,'redraft');
    assert.equal((await request('analysis',guest.cookie)).data.saved[0].title,'Test comparison');
  }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}}
});
