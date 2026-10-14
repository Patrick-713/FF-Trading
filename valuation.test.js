import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,settingsFor,pointsFor,valuePlayer,pickValue,pickInventory,lineupPace,analyzeTrade} from './valuation.js';
const s=settingsFor({mode:'redraft'});
const weekly=Array.from({length:6},(_,i)=>({position:'WR',week:i+1,receptions:6,receiving_yards:90,receiving_tds:i%2,targets:9,receiving_air_yards:110,target_share:.25,wopr:.6,receiving_epa:4}));
test('CSV parses quoted commas, escaped quotes, CRLF, and blank values',()=>{assert.deepEqual(parseCSV('id,name,value\r\n1,"A, B",\r\n2,"A ""B""",3\r\n'),[{id:'1',name:'A, B',value:''},{id:'2',name:'A "B"',value:'3'}]);});
test('scoring presets and TE premium affect fantasy production, not raw data',()=>{
  assert.equal(pointsFor(weekly[0],s),15);assert.equal(pointsFor(weekly[0],{...s,scoring:'standard'}),9);
  assert.equal(pointsFor({...weekly[0],position:'TE'},{...s,tePremium:.5}),18);
  assert.throws(()=>settingsFor({mode:'stock'}));assert.throws(()=>settingsFor({superflex:'false'}));
});
test('dynasty age curves distinguish equal producers; redraft is age-neutral',()=>{
  const young=valuePlayer({id:'y',position:'WR',age:23},weekly,s),old=valuePlayer({id:'o',position:'WR',age:33},weekly,s);
  assert.equal(young.redraft,old.redraft);assert.ok(young.dynasty>old.dynasty);
  assert.equal(young.stats.targetShare,25);assert.equal(young.stats.wopr,.6);assert.equal(young.games,6);
});
test('missing data produces explicit prospect estimate and injury lowers scoring pace',()=>{
  const p={id:'1',position:'WR',age:22,draftRound:1};const unknown=valuePlayer(p,[],s);
  assert.equal(unknown.games,0);assert.match(unknown.confidence,/estimate/);assert.equal(unknown.stats.targetShare,null);
  assert.ok(valuePlayer({...p,injury:'Out'},weekly,s).pace<valuePlayer(p,weekly,s).pace);
});
test('superflex boosts QBs and picks; redraft excludes pick value',()=>{
  const qb={id:'q',position:'QB',age:24},rows=weekly.map(r=>({...r,position:'QB',attempts:35,passing_yards:280,passing_tds:2}));
  assert.ok(valuePlayer(qb,rows,{...s,mode:'dynasty',superflex:true}).value>valuePlayer(qb,rows,{...s,mode:'dynasty'}).value);
  assert.equal(pickValue({round:1,year:2027},s,2026),0);
  assert.ok(pickValue({round:1,year:2027},{...s,mode:'dynasty'},2026)>pickValue({round:1,year:2029},{...s,mode:'dynasty'},2026));
});
test('pick ownership applies traded picks without duplicate original picks',()=>{
  const picks=pickInventory({league:{type:2,season:'2026',draftRounds:3},teams:[{id:'sl_1',rosterId:1,name:'A'},{id:'sl_2',rosterId:2,name:'B'}],tradedPicks:[{season:'2027',round:1,roster_id:1,owner_id:2}]});
  assert.equal(picks.length,18);assert.equal(new Set(picks.map(p=>p.id)).size,18);assert.equal(picks.find(p=>p.id==='pick_2027_1_1').owner,'sl_2');
});
test('lineup optimization respects slot eligibility and never starts a player twice',()=>{
  assert.equal(lineupPace([{position:'QB',pace:30},{position:'QB',pace:25},{position:'WR',pace:20}],['QB','FLEX']),50);
  assert.equal(lineupPace([{position:'QB',pace:30},{position:'QB',pace:25},{position:'WR',pace:20}],['QB','SUPER_FLEX']),55);
  assert.equal(lineupPace([{position:'RB',pace:10}],['RB','FLEX']),10);
});
test('trade simulator validates ownership, rejects duplicate assets, and preserves rosters',()=>{
  const model={settings:s,teams:[{id:'a'},{id:'b'}],players:[{id:'1',owner:'a',position:'WR',pace:15,value:100},{id:'2',owner:'b',position:'WR',pace:20,value:150}],picks:[],slots:['WR']};
  const before=JSON.stringify(model);const result=analyzeTrade(model,{teamA:'a',teamB:'b',sendA:['1'],sendB:['2']});
  assert.equal(result.teamA.valueChange,50);assert.equal(result.teamB.valueChange,-50);assert.equal(result.teamA.paceChange,5);assert.equal(JSON.stringify(model),before);
  assert.throws(()=>analyzeTrade(model,{teamA:'a',teamB:'b',sendA:['2'],sendB:['1']}));
  assert.throws(()=>analyzeTrade(model,{teamA:'a',teamB:'b',sendA:['1','1'],sendB:['2']}));
});
