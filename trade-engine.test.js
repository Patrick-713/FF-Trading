import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTrade,findTrades} from './trade-engine.js';
import {tradeSearch,tradeTools,tradeResult,finderView} from './public/trade-tools.js';
const player=(id,owner,position,pace,value,age=25)=>({id,owner,position,pace,value,redraft:value,dynasty:value,age,name:id,kind:'player',club:'NFL',games:6});
function fixture(){return {ownTeam:'a',season:2026,settings:{mode:'dynasty',superflex:false},slots:['QB','WR'],teams:[{id:'a',name:'A',rosterLimit:3},{id:'b',name:'B',rosterLimit:3}],players:[player('aq','a','QB',40,1500),player('aq2','a','QB',30,1100),player('aw','a','WR',10,500),player('bq','b','QB',10,500),player('bw','b','WR',40,1500),player('bw2','b','WR',30,1100),player('fa','free_agent','WR',8,200)],picks:[]};}
const input={teamA:'a',teamB:'b',sendA:['aq'],sendB:['bw']};
test('complementary trades show both horizons and complete nonduplicated lineups without mutating imports',()=>{
  const m=fixture(),original=JSON.stringify(m),r=analyzeTrade(m,input);
  assert.equal(r.teamA.paceChange,20);assert.equal(r.teamB.paceChange,20);
  assert.equal(r.teamA.current.change,0);assert.equal(r.teamA.future.change,0);
  const ids=r.teamA.afterLineup.starters.map(s=>s.player?.id);assert.equal(new Set(ids).size,2);
  assert.equal(r.teamA.roster.requiredCuts,0);assert.equal(JSON.stringify(m),original);
});
test('two-for-one includes required cuts, trade-created openings and conditional replacements',()=>{
  const m=fixture(),r=analyzeTrade(m,{...input,sendA:['aq','aw']});
  assert.equal(r.teamB.roster.requiredCuts,1);assert.equal(r.teamB.roster.cuts.length,1);
  assert.equal(r.teamB.roster.afterCount,3);assert.equal(r.teamA.roster.replacements[0].id,'fa');
  assert.equal(r.teamA.roster.afterCount,3);assert.equal(r.teamA.valueChange,r.teamA.exchangeValueChange+200);
  assert.equal(r.teamB.valueChange,r.teamB.exchangeValueChange-r.teamB.roster.cuts[0].value);
  const noWaivers=analyzeTrade(m,{...input,sendA:['aq','aw'],includeWaivers:false});
  assert.equal(noWaivers.teamA.roster.replacements.length,0);assert.equal(noWaivers.teamA.roster.unfilled,1);
});
test('IR/taxi is excluded from active capacity, auto cuts and starters',()=>{
  const m=fixture();m.players.push(player('ir','b','WR',100,100));m.teams[1].protectedIds=['ir'];
  const r=analyzeTrade(m,{...input,sendA:['aq','aw']});
  assert.equal(r.teamB.beforePace,50);assert.equal(r.teamB.roster.requiredCuts,1);
  assert.ok(!r.teamB.roster.cuts.some(p=>p.id==='ir'));assert.equal(r.teamB.roster.afterCount,3);
});
test('unknown capacity is explicit and an empty waiver pool does not fabricate replacements',()=>{
  const m=fixture();m.teams[1].rosterLimit=null;m.players=m.players.filter(p=>p.owner!=='free_agent');
  const r=analyzeTrade(m,{...input,sendA:['aq','aw']});assert.equal(r.teamA.roster.unfilled,1);
  assert.equal(r.teamB.roster.capacity,null);assert.match(r.notes.join(' '),/capacity is unavailable/);
});
test('workload and development assumptions change the correct horizon and can flip verdicts',()=>{
  const m=fixture(),r=analyzeTrade(m,{...input,assumptions:{bw:{workload:.7,development:1.5}}});
  assert.equal(r.received[0].redraft,1050);assert.equal(r.received[0].dynasty,1575);assert.equal(r.received[0].pace,28);
  assert.equal(r.baseline.difference,0);assert.equal(r.sensitivity.length,2);assert.ok(r.verdictFlips);
  assert.equal(r.teamA.current.change,-450);assert.equal(r.teamA.future.change,75);
  for(const assumptions of [{bw:{workload:Infinity}},{bw:{development:2}},{bw:{tier:'first'}},{fa:{workload:1}}])assert.throws(()=>analyzeTrade(m,{...input,assumptions}));
});
test('pick position scenarios save dynasty changes without inventing immediate points',()=>{
  const m=fixture();m.picks=[{id:'pick',kind:'pick',owner:'b',name:'2027 first',round:1,year:2027,value:1050}];
  const r=analyzeTrade(m,{...input,sendB:['pick'],includeWaivers:false,assumptions:{pick:{tier:'early'}}});
  assert.equal(r.received[0].value,1365);assert.equal(r.received[0].redraft,0);assert.equal(r.received[0].pace,undefined);
  assert.equal(r.teamA.current.change,-1500);m.settings.mode='redraft';assert.throws(()=>analyzeTrade(m,{...input,sendB:['pick']}));
});
test('finder produces league-owned actionable offers with a benefit for each side',()=>{
  const m=fixture(),before=JSON.stringify(m),r=findTrades(m,{goal:'WR'});
  assert.ok(r.offers.length>0);assert.ok(r.evaluated<=100);
  for(const offer of r.offers){const result=analyzeTrade(m,offer.input);assert.equal(offer.input.teamA,'a');assert.ok(result.teamA.paceChange>0||result.teamA.future.change>=0);assert.ok(result.teamB.paceChange>0||result.teamB.future.change>0||result.teamB.current.change>0);assert.ok(offer.reason);assert.ok(offer.partnerReason);}
  assert.equal(JSON.stringify(m),before);assert.throws(()=>findTrades(m,{goal:'unknown'}));m.settings.mode='redraft';assert.throws(()=>findTrades(m,{goal:'picks'}));
});
test('player search shows ownership, handles free agents and escapes imported names',()=>{
  const m=fixture();m.players[0].name='<script>alert(1)</script>';
  const html=tradeSearch(m,'script');assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('data-trade-player="aq"'));assert.ok(!html.includes('<script>'));
  const fa=tradeSearch(m,'fa');assert.ok(fa.includes('Free agent'));assert.ok(!fa.includes('data-trade-player="fa"'));
  assert.ok(tradeTools(m,new Set(['aq']),new Set(['bw']),{},true,'').includes('Dynasty development'));
  assert.ok(tradeResult(analyzeTrade(m,input),m).includes('Optimized lineup before / after'));
  assert.ok(finderView(m,findTrades(m,{goal:'WR'}),'WR').includes('data-offer'));
});
