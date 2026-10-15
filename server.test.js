import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

test('API removes stocks, isolates settings, freezes analysis inputs, versions saves and redacts unexpected errors',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'ff-backend-')),dbPath=join(folder,'test.sqlite'),calls=join(folder,'provider.log'),port=39000+Math.floor(Math.random()*5000);let child,output='';
  try{
    child=spawn(process.execPath,['--import','./fixtures/sleeper-fetch.mjs','server.js'],{env:{...process.env,PORT:String(port),DB_PATH:dbPath,TEST_FETCH_LOG:calls},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{child.stdout.on('data',c=>{output+=c;if(output.includes('running at'))resolve();});child.once('error',reject);child.once('exit',c=>reject(new Error('Server exited '+c)));});
    async function request(path,cookie,method='GET',body){const r=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,requestId:r.headers.get('x-request-id'),cookie:r.headers.get('set-cookie')?.split(';')[0],data:await r.json()};}
    const guest=await request('state'),cookie=guest.cookie;
    assert.equal('cash' in guest.data.account,false);assert.equal('holdings' in guest.data,false);
    for(const path of ['trades','simulate','reset','roster'])assert.equal((await request(path,cookie,'POST',{})).status,404);
    const linked=await request('sleeper/link',cookie,'POST',{username:'testmanager',leagueId:'1234567890123'});assert.equal(linked.status,200);
    const baselineCalls=readFileSync(calls,'utf8');
    const model=await request('analysis',cookie);assert.ok(model.data.data.refreshedAt);assert.equal(model.data.modelVersion,'2.1.0');
    await request('analysis/settings',cookie,'PUT',{mode:'dynasty',scoring:'half'});
    const offer={teamA:'sl_1',teamB:'sl_2',sendA:['101'],sendB:['201']};
    const analyzed=await request('analysis/trade',cookie,'POST',offer);assert.equal(analyzed.status,200);assert.equal(analyzed.data.modelVersion,'2.1.0');assert.equal(analyzed.data.dataSnapshot.refreshedAt,model.data.data.refreshedAt);
    const saved=await request('analysis/save',cookie,'POST',offer);assert.equal(saved.data.saved[0].result.modelVersion,'2.1.0');
    assert.equal(readFileSync(calls,'utf8'),baselineCalls,'GET/settings/trade/save must not call external providers');
    await request('sleeper/link',cookie,'POST',{username:'testmanager',leagueId:'2234567890123'});
    assert.equal((await request('analysis',cookie)).data.settings.scoring,'ppr');
    await request('analysis/settings',cookie,'PUT',{scoring:'standard'});
    assert.equal((await request('sleeper/activate',cookie,'POST',{leagueId:'1234567890123'})).status,200);
    assert.equal((await request('analysis',cookie)).data.settings.scoring,'half');
    const other=await request('state');assert.equal((await request('sleeper/activate',other.cookie,'POST',{leagueId:'1234567890123'})).status,404);
    assert.equal((await request('analysis/settings',cookie,'PUT',{mode:'invalid'})).status,400);
    const db=new DatabaseSync(dbPath);db.exec('DROP TABLE trade_scenarios');db.close();
    const error=await request('analysis',cookie);assert.equal(error.status,500);assert.equal(error.data.code,'INTERNAL_ERROR');assert.equal(error.data.requestId,error.requestId);assert.ok(!JSON.stringify(error.data).includes('trade_scenarios'));
    assert.ok(!output.includes('testmanager'));assert.ok(!output.includes('sendA'));
  }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}}
});

test('provider failure returns 503 without committing a partial league import',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'ff-provider-')),port=45000+Math.floor(Math.random()*2000);let child;
  try{
    child=spawn(process.execPath,['--import','./fixtures/sleeper-fetch.mjs','server.js'],{env:{...process.env,PORT:String(port),DB_PATH:join(folder,'test.sqlite'),TEST_STATS_FAILURE:'true'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{child.stdout.on('data',c=>{if(c.toString().includes('running at'))resolve();});child.once('error',reject);child.once('exit',c=>reject(new Error('Exited '+c)));});
    const url=`http://127.0.0.1:${port}/api/`,guest=await fetch(url+'state'),cookie=guest.headers.get('set-cookie').split(';')[0];
    const r=await fetch(url+'sleeper/link',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({username:'testmanager',leagueId:'1234567890123'})});
    assert.equal(r.status,503);assert.equal((await r.json()).code,'PROVIDER_UNAVAILABLE');
    assert.equal((await(await fetch(url+'state',{headers:{Cookie:cookie}})).json()).connection,null);
  }finally{if(child?.exitCode===null){child.kill();await once(child,'exit');}}
});
