// FF Trading model v1: transparent heuristic values, not market prices or calibrated forecasts.
export function parseCSV(text) {
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) {const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}
  const headers=rows.shift()||[];return rows.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((h,i)=>[h.replace(/^\uFEFF/,''),r[i]])));
}
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const round=(v,p=1)=>Math.round(v*10**p)/10**p;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function settingsFor(input={},defaults={}) {
  const out={mode:input.mode||defaults.mode||'redraft',scoring:input.scoring||defaults.scoring||'ppr',superflex:input.superflex??defaults.superflex??false,tePremium:num(input.tePremium??defaults.tePremium??0),passTD:num(input.passTD??defaults.passTD??4)};
  if(!['dynasty','redraft'].includes(out.mode)||!['ppr','half','standard'].includes(out.scoring)||typeof out.superflex!=='boolean'||![4,6].includes(out.passTD)||![0,0.5,1].includes(out.tePremium))throw new Error('Choose valid league format and scoring settings.');
  return out;
}
export function pointsFor(row,s) {
  const rec=s.scoring==='ppr'?1:s.scoring==='half'?0.5:0;
  return num(row.passing_yards)*.04+num(row.passing_tds)*s.passTD-num(row.passing_interceptions)*2+num(row.rushing_yards)*.1+num(row.rushing_tds)*6+num(row.receiving_yards)*.1+num(row.receiving_tds)*6+num(row.receptions)*(rec+(row.position==='TE'?s.tePremium:0))-(num(row.rushing_fumbles_lost)+num(row.receiving_fumbles_lost)+num(row.sack_fumbles_lost))*2+(num(row.passing_2pt_conversions)+num(row.rushing_2pt_conversions)+num(row.receiving_2pt_conversions))*2+num(row.special_teams_tds)*6+num(row.fg_made)*3+num(row.pat_made)+num(row.def_tackles_solo)+num(row.def_tackle_assists)*.5+num(row.def_sacks)*3+num(row.def_interceptions)*3+num(row.def_pass_defended)+num(row.def_tds)*6+num(row.def_fumbles_forced)*2;
}
export function valuePlayer(player,rows,s) {
  const games=rows.length,score=rows.map(r=>pointsFor(r,s)),ppg=games?score.reduce((a,b)=>a+b,0)/games:0;
  const recent=score.slice(-4),recentPPG=recent.length?recent.reduce((a,b)=>a+b,0)/recent.length:0;
  const sum=k=>rows.reduce((a,r)=>a+num(r[k]),0),avg=k=>{const available=rows.filter(r=>r[k]!==''&&r[k]!=null);return available.length?available.reduce((a,r)=>a+num(r[k]),0)/available.length:null;};
  const targets=sum('targets'),carries=sum('carries'),attempts=sum('attempts');
  const cv=games>1&&ppg>0?Math.sqrt(score.reduce((a,n)=>a+(n-ppg)**2,0)/games)/ppg:null;
  const opportunity=games?(player.position==='QB'?attempts/games/35:(carries+1.5*targets)/games/18):0;
  const plays=player.position==='QB'?attempts:carries+targets;
  const epa=plays?(sum('passing_epa')+sum('rushing_epa')+sum('receiving_epa'))/plays:null;
  const replacement=({QB:s.superflex?12:16,RB:7,WR:s.scoring==='standard'?6:8,TE:5+s.tePremium*2,K:5})[player.position]??3;
  const injury=String(player.injury||'').toLowerCase(),availability=/ir|injured reserve/.test(injury)?.65:/out/.test(injury)?.8:/doubtful/.test(injury)?.85:/questionable/.test(injury)?.95:1;
  const pace=(ppg*.4+recentPPG*.6)*availability;
  const production=Math.max(0,pace-replacement)*110;
  const usage=clamp(opportunity,0,2)*120+(avg('target_share')||0)*220+(avg('wopr')||0)*90;
  const efficiency=epa===null?0:clamp(epa,-.5,.5)*120;
  const consistency=cv===null?0:clamp(1-cv,0,1)*80;
  const sampleWeight=clamp(games/4,0,1);
  const prior=({1:550,2:350,3:220,4:130,5:90,6:65,7:50})[player.draftRound]??35;
  let redraft=Math.round(Math.max(10,(100+production+usage+efficiency+consistency)*sampleWeight+35*(1-sampleWeight)));
  const age=player.age,peak=({QB:29,RB:24,WR:26,TE:27})[player.position]??26;
  const decay=({QB:.04,RB:.10,WR:.065,TE:.055})[player.position]??.07;
  const ageFactor=age==null?1:clamp(1+Math.max(0,peak-age)*.035-Math.max(0,age-peak)*decay,.35,1.22);
  const qbPremium=player.position==='QB'?(s.superflex?1.6:.85):1;
  const dynasty=Math.round(Math.max(10,((redraft*.85+prior*.35)*sampleWeight+prior*(1-sampleWeight))*ageFactor*qbPremium));
  const confidence=games>=8?'Higher sample':games>=4?'Moderate sample':games?'Small sample':'Prospect / metadata estimate';
  return {...player,redraft,dynasty,value:s.mode==='dynasty'?dynasty:redraft,pace:round(pace),confidence,games,
    stats:{ppg:round(ppg),recentPPG:round(recentPPG),targetsPerGame:games?round(targets/games):null,carriesPerGame:games?round(carries/games):null,targetShare:avg('target_share')===null?null:round(avg('target_share')*100),wopr:avg('wopr')===null?null:round(avg('wopr'),2),adot:targets?round(sum('receiving_air_yards')/targets):null,epaPerOpportunity:epa===null?null:round(epa,2),consistency:cv===null?null:round(clamp(1-cv,0,1)*100),yardsPerTouch:(carries+sum('receptions'))?round((sum('rushing_yards')+sum('receiving_yards'))/(carries+sum('receptions'))):null},
    breakdown:{production:Math.round(production),opportunity:Math.round(usage),efficiency:Math.round(efficiency),consistency:Math.round(consistency),ageFactor:round(ageFactor,2),draftPrior:prior},
    notes:[...(!games?['No matched weekly stats: value is a low-confidence metadata estimate.']:[]),...(age==null?['Age unavailable; neutral dynasty age adjustment.']:[]),...(player.draftRound==null?['NFL draft round unavailable; neutral draft prior.']:[]),...(injury?[`Availability adjustment for listed status: ${player.injury}.`]:[])]};
}
export function pickValue(pick,settings,season,tier='mid') {
  if(settings.mode!=='dynasty')return 0;
  const base=({1:1050,2:500,3:250,4:125,5:65})[pick.round]||35;
  return Math.round(base*({early:1.3,mid:1,late:.75})[tier]*.85**Math.max(0,pick.year-season-1)*(settings.superflex?1.15:1));
}
export function pickInventory(snapshot) {
  const rounds=Number(snapshot.league.draftRounds),season=Number(snapshot.league.season);
  if(!Number.isInteger(rounds)||rounds<1||rounds>10||snapshot.league.type!==2)return [];
  const traded=snapshot.tradedPicks||[],years=[...new Set([season+1,season+2,season+3,...traded.map(p=>Number(p.season)).filter(y=>y>season&&y<=season+5)])];
  const picks=[];
  for(const year of years)for(const team of snapshot.teams)for(let r=1;r<=rounds;r++){
    const move=traded.find(p=>Number(p.season)===year&&Number(p.round)===r&&Number(p.roster_id)===team.rosterId);
    const owner=move?`sl_${move.owner_id}`:team.id;
    picks.push({id:`pick_${year}_${r}_${team.rosterId}`,kind:'pick',name:`${year} Round ${r}`,year,round:r,owner,originalTeam:team.name,tier:'mid',estimated:true});
  }
  return picks;
}
function eligible(position,slot) {
  if(['FLEX','WRRB_FLEX','RB_WR_TE'].includes(slot))return ['RB','WR','TE'].includes(position);
  if(['SUPER_FLEX','OP'].includes(slot))return ['QB','RB','WR','TE'].includes(position);
  if(['REC_FLEX','WR_TE'].includes(slot))return ['WR','TE'].includes(position);
  if(slot==='IDP_FLEX')return ['DL','LB','DB','DE','DT','CB','S'].includes(position);
  return position===slot||(slot==='DEF'&&position==='DST');
}
// Hungarian assignment with dummy empty spots: optimizes weekly pace without using a player twice.
export function lineup(players,slots) {
  const n=slots.length,m=players.length+n;if(!n)return {pace:0,starters:[],bench:players};
  const u=Array(n+1).fill(0),v=Array(m+1).fill(0),p=Array(m+1).fill(0),way=Array(m+1).fill(0);
  const cost=(i,j)=>j>players.length?0:eligible(players[j-1].position,slots[i-1])?-players[j-1].pace:1e6;
  for(let i=1;i<=n;i++){p[0]=i;let j0=0;const min=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);
    do {used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;for(let j=1;j<=m;j++)if(!used[j]){const cur=cost(i0,j)-u[i0]-v[j];if(cur<min[j]){min[j]=cur;way[j]=j0;}if(min[j]<delta){delta=min[j];j1=j;}}
      for(let j=0;j<=m;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;j0=j1;
    }while(p[j0]!==0);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0!==0);
  }
  const starters=slots.map((slot,i)=>({slot,player:players.find((player,j)=>p[j+1]===i+1&&eligible(player.position,slot))||null}));
  const usedIds=new Set(starters.filter(s=>s.player).map(s=>s.player.id));
  return {pace:round(starters.reduce((sum,s)=>sum+(s.player?.pace||0),0)),starters,bench:players.filter(p=>!usedIds.has(p.id))};
}
export function lineupPace(players,slots){return lineup(players,slots).pace;}
export { analyzeTrade, findTrades } from './trade-engine.js';
