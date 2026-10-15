import {provider} from './errors.js';
import {MODEL_VERSION} from './model-version.js';
import { parseCSV, settingsFor, valuePlayer, pickInventory, pickValue, lineupPace } from './valuation.js';
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const normal=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/(jr|sr|iii|ii|iv)$/,'');
export function createFantasy(db,{fetcher=globalThis.fetch}={}) {
  db.exec('CREATE TABLE IF NOT EXISTS analysis_snapshots(account TEXT NOT NULL REFERENCES accounts(id),league TEXT NOT NULL,data TEXT NOT NULL,refreshed TEXT NOT NULL,PRIMARY KEY(account,league)); CREATE TABLE IF NOT EXISTS fantasy_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS league_settings (account TEXT NOT NULL REFERENCES accounts(id),league TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account,league)); CREATE TABLE IF NOT EXISTS trade_scenarios (id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), data TEXT NOT NULL, created TEXT NOT NULL);');
  let inFlight=new Map();
  async function metadata(){
    const cached=db.prepare('SELECT * FROM fantasy_cache WHERE key=?').get('player-metadata-v2');
    const legacy=db.prepare('SELECT * FROM fantasy_cache WHERE key=?').get('player-metadata');
    if(cached&&Date.now()-cached.fetched<86400000)return JSON.parse(cached.data);
    try{const r=await fetcher('https://github.com/nflverse/nflverse-data/releases/download/players/players.csv',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error();const text=await r.text();if(text.length>20000000)throw new Error();const result=Object.fromEntries(parseCSV(text).filter(p=>p.gsis_id).map(p=>[p.gsis_id,{draftRound:number(p.draft_round),birth:p.birth_date,draftPick:number(p.draft_number)||number(p.draft_pick),draftYear:number(p.draft_year)}]));db.prepare('INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched').run('player-metadata-v2',JSON.stringify(result),Date.now());return result;}catch(error){if(error?.code==='ERR_SQLITE_ERROR')throw error;return cached?JSON.parse(cached.data):legacy?JSON.parse(legacy.data):{};}
  }
  async function stats(season,allowFallback=true) {
    if(inFlight.has(season))return inFlight.get(season);
    const job=(async()=>{
      const cached=db.prepare('SELECT * FROM fantasy_cache WHERE key=?').get(`stats:${season}`);
      if(cached&&Date.now()-cached.fetched<6*3600000)return {...JSON.parse(cached.data),fetched:cached.fetched};
      try {
        const url=`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
        const response=await fetcher(url,{signal:AbortSignal.timeout(20000)});
        if(!response.ok){if(response.status===404&&season>2017&&allowFallback){const previous=await stats(season-1,false);return {...previous,warning:`${season} statistics are unavailable; showing ${previous.season} history.`};}throw new Error('Stats provider unavailable');}
        const text=await response.text();if(text.length>20000000)throw new Error('Stats file too large');
        const rows=parseCSV(text).filter(r=>r.season_type==='REG');
        if(!rows.length||!rows[0].player_id||!('targets' in rows[0]))throw new Error('Invalid stats file');
        const data={season,rows,source:'nflverse weekly player statistics',url};const fetched=Date.now();
        db.prepare('INSERT INTO fantasy_cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched=excluded.fetched').run(`stats:${season}`,JSON.stringify(data),fetched);
        return {...data,fetched};
      }catch(error){if(error?.code==='ERR_SQLITE_ERROR')throw error;if(cached)return {...JSON.parse(cached.data),fetched:cached.fetched,warning:'Using cached statistics because the stats provider is unavailable.'};return {season,rows:[],source:'Stats unavailable',warning:'Advanced statistics could not load. Values shown are metadata estimates; refresh stats before analyzing trades.'};}
    })();inFlight.set(season,job);try{return await job;}finally{inFlight.delete(season);}
  }
  async function model(account,snapshot,catalog,input) {
    const league=snapshot?.league.id||'demo';
    const savedSnapshot=snapshot?db.prepare('SELECT data,refreshed FROM analysis_snapshots WHERE account=? AND league=?').get(account,league):null;
    const inputs=savedSnapshot?JSON.parse(savedSnapshot.data):null;
    const metadataTime=inputs?.asOf?new Date(inputs.asOf).getTime():Date.now(),metadataYear=new Date(metadataTime).getUTCFullYear();
    if(inputs){catalog=inputs.catalog;snapshot={...snapshot,analysisRefreshedAt:savedSnapshot.refreshed};}
    const stored=db.prepare('SELECT data FROM league_settings WHERE account=? AND league=?').get(account,league);
    const defaults={mode:snapshot?.league.type===2?'dynasty':'redraft',scoring:Number(snapshot?.league.scoring?.rec)===.5?'half':Number(snapshot?.league.scoring?.rec)===0?'standard':'ppr',superflex:snapshot?.slots.includes('SUPER_FLEX')||snapshot?.slots.filter(s=>s==='QB').length>1||false,passTD:Number(snapshot?.league.scoring?.pass_td)===6?6:4};
    const settings=settingsFor(input,stored?JSON.parse(stored.data):defaults);
    const season=Number(snapshot?.league.season||new Date().getUTCFullYear());
    let data,teams,allPlayers,slots,picks;
    if(snapshot){
      const statistics=inputs?.statistics||readStats(season),meta=inputs?.metadata||readMetadata();data=statistics;const through=data.season===season?snapshot.settledWeek:18;
      data={...data,rows:data.rows.filter(r=>Number(r.week)<=through)};
      teams=snapshot.teams.map(t=>({...t,playerIds:t.playerIds||[]}));slots=snapshot.slots;
      allPlayers=teams.flatMap(t=>t.playerIds.map(id=>{
        const p=catalog[id]||snapshot.players.find(p=>p.id===id)||{};
        const birth=p.birth_date||meta[p.gsis_id]?.birth;const age=birth?Math.floor((metadataTime-new Date(birth).getTime())/(365.2425*86400000)):number(p.age);
        return {id,kind:'player',owner:t.id,name:String(p.full_name||p.name||[p.first_name,p.last_name].filter(Boolean).join(' ')||`Player ${id}`),position:p.position||'?',club:p.team||p.club||'FA',injury:p.injury_status||p.injury||null,age:age!==null&&Number.isFinite(age)?age:null,draftRound:number(p.draft_round)||meta[p.gsis_id]?.draftRound||null,experience:number(p.years_exp)===null?null:number(p.years_exp)+season-metadataYear,draftYear:number(p.draft_year)||meta[p.gsis_id]?.draftYear||null,draftPick:number(p.draft_pick)||meta[p.gsis_id]?.draftPick||null,rookieDraft:snapshot.rookieDrafts?.players?.[id]||null,gsis:p.gsis_id||null};
      }));
      const rostered=new Set(allPlayers.map(p=>p.id)),withStats=new Set(data.rows.map(r=>r.player_id));
      for(const [id,p] of Object.entries(catalog))if(!rostered.has(id)&&p.active&&['QB','RB','WR','TE','K'].includes(p.position)&&(withStats.has(p.gsis_id)||Number(p.years_exp)<=1)){
        const birth=p.birth_date||meta[p.gsis_id]?.birth,age=birth?Math.floor((metadataTime-new Date(birth).getTime())/(365.2425*86400000)):number(p.age);
        allPlayers.push({id,kind:'player',owner:'free_agent',name:p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||`Player ${id}`,position:p.position,club:p.team||'FA',injury:p.injury_status||null,age:Number.isFinite(age)?age:null,draftRound:meta[p.gsis_id]?.draftRound||null,gsis:p.gsis_id||null});
      }
      picks=pickInventory(snapshot);
    }else{
      teams=[{id:'demo_a',name:'Your Demo Team',manager:'You',playerIds:[]},{id:'demo_b',name:'Demo Trade Partner',manager:'Sample manager',playerIds:[]}];
      slots=['QB','RB','RB','WR','WR','TE','FLEX'];
      const names=['Miles Carter','Jayden Brooks','Eli Rivers','Noah Chase','Amari Stone','Cole Bennett','Darius Lane','Leo Walker','Jordan West','Tyler Reed','Finn Hayes','Marcus Gray','Isaac Bell','Theo Grant','Owen Fields','Caleb Price','Ashton Ford','Ryan Lake','Alex Cole','Luke Moss','Ben North'];
      allPlayers=names.map((name,i)=>({id:`demo_${i}`,kind:'player',owner:i<7?'demo_a':i<14?'demo_b':'free_agent',name,position:slots[i%7]==='FLEX'?'WR':slots[i%7],club:['SEA','BUF','PHI','CIN'][i%4],age:22+i%11,draftRound:1+i%5,gsis:`demo_${i}`}));
      const rows=allPlayers.flatMap((p,i)=>Array.from({length:6},(_,w)=>({player_id:p.id,position:p.position,week:w+1,season_type:'REG',passing_yards:p.position==='QB'?200+(i+w)*12:0,passing_tds:p.position==='QB'?2:0,attempts:p.position==='QB'?32:0,carries:p.position==='RB'?15+w%3:2,rushing_yards:p.position==='RB'?60+i*3+w*2:8,rushing_tds:p.position==='RB'&&w%2===0?1:0,receptions:['WR','TE'].includes(p.position)?4+w%3:2,targets:5+i%6,receiving_yards:p.position==='WR'?65+i*2+w*3:30,receiving_tds:w%3===0?1:0,target_share:.12+i%5*.03,wopr:.3+i%5*.05,receiving_air_yards:60+i*5,receiving_epa:2+i%4,rushing_epa:1,passing_epa:3})));
      data={season,rows,source:'Fictional demo statistics',fetched:Date.now()};
      const demoSnapshot={league:{season,type:2,draftRounds:3},teams:teams.map((t,i)=>({...t,rosterId:i+1})),tradedPicks:[]};picks=pickInventory(demoSnapshot).map(p=>({...p,owner:p.owner==='sl_1'?'demo_a':p.owner==='sl_2'?'demo_b':p.owner}));
    }
    if(settings.superflex&&!slots.includes('SUPER_FLEX')&&slots.filter(s=>s==='QB').length<2){slots=[...slots];const flex=slots.indexOf('FLEX');if(flex>=0)slots[flex]='SUPER_FLEX';else slots.push('SUPER_FLEX');}
    if(!settings.superflex){let qb=0;slots=slots.map(s=>s==='SUPER_FLEX'?'FLEX':s==='QB'&&++qb>1?'FLEX':s);}
    const byGSIS=new Map(),byName=new Map();for(const r of data.rows){if(!byGSIS.has(r.player_id))byGSIS.set(r.player_id,[]);byGSIS.get(r.player_id).push(r);const k=normal(r.player_display_name)+':'+r.position;if(!byName.has(k))byName.set(k,new Set());byName.get(k).add(r.player_id);}
    const players=allPlayers.map(p=>{let rows=p.gsis?byGSIS.get(p.gsis):null;if(!rows){const ids=byName.get(normal(p.name)+':'+p.position);if(ids?.size===1)rows=byGSIS.get([...ids][0]);}return valuePlayer(p,(rows||[]).sort((a,b)=>Number(a.week)-Number(b.week)),settings,season);});
    picks=picks.map(p=>({...p,value:pickValue(p,settings,season),low:pickValue(p,settings,season,'late'),high:pickValue(p,settings,season,'early')}));
    teams=teams.map(t=>{const roster=players.filter(p=>p.owner===t.id),ownedPicks=picks.filter(p=>p.owner===t.id);return {id:t.id,name:t.name,manager:t.manager,rosterLimit:snapshot?.rosterLimit||(!snapshot?7:null),protectedIds:t.protectedIds||[],playerValue:roster.reduce((s,p)=>s+p.value,0),pickValue:settings.mode==='dynasty'?ownedPicks.reduce((s,p)=>s+p.value,0):0,pace:lineupPace(roster.filter(p=>!(t.protectedIds||[]).includes(p.id)),slots),playerCount:roster.length};});
    const saved=db.prepare('SELECT id,data,created FROM trade_scenarios WHERE account=? ORDER BY created DESC').all(account).map(r=>({id:r.id,...JSON.parse(r.data),created:r.created})).filter(s=>s.league===(snapshot?.league.id||'demo')).slice(0,20);
    return {modelVersion:MODEL_VERSION,settings,season,ownTeam:snapshot?.ownTeam||'demo_a',teams,players,picks:settings.mode==='dynasty'?picks:[],slots,data:{source:data.source,season:data.season,throughWeek:Math.max(0,...data.rows.map(r=>Number(r.week))),fetched:data.fetched||null,url:data.url||null,warning:[data.warning,snapshot?.rookieDrafts?.warning,...(!snapshot?.analysisRefreshedAt&&snapshot?['Refresh league data to prepare an analysis snapshot.']:[])].filter(Boolean).join(' ')||null,ready:data.rows.length>0&&(!snapshot||Boolean(inputs)),refreshedAt:snapshot?.analysisRefreshedAt||null,stale:Boolean(snapshot&&(!snapshot.analysisRefreshedAt||Date.now()-new Date(snapshot.analysisRefreshedAt).getTime()>6*3600000||!data.fetched||Date.now()-data.fetched>6*3600000)),matched:players.filter(p=>p.games>0).length,total:players.length},saved,linked:Boolean(snapshot),picksAvailable:picks.length>0,methodology:`FF Trading model ${MODEL_VERSION} heuristic. Production above a position baseline, opportunity, target share, WOPR, EPA per opportunity, and consistency drive player values. Dynasty adds age curves, NFL draft capital, verified league rookie-draft context when available, a fading prospect prior over the first three seasons, and a superflex QB premium. Rookie draft context is not consensus rank. Past scoring pace is not a forecast; no proprietary rankings or live market prices are used.`};
  }
  function readMetadata(){const cached=db.prepare('SELECT data FROM fantasy_cache WHERE key IN (?,?) ORDER BY CASE key WHEN ? THEN 0 ELSE 1 END LIMIT 1').get('player-metadata-v2','player-metadata','player-metadata-v2');return cached?JSON.parse(cached.data):{};}
  function readStats(season){
    const current=db.prepare('SELECT * FROM fantasy_cache WHERE key=?').get('stats:'+season);
    const previous=current?null:db.prepare('SELECT * FROM fantasy_cache WHERE key=?').get('stats:'+(season-1));
    const cached=current||previous;
    if(!cached)return {season,rows:[],source:'Stats unavailable',warning:'No saved statistics. Use Refresh league data before analyzing trades.'};
    return {...JSON.parse(cached.data),fetched:cached.fetched,...(!current?{warning:'Using saved prior-season history; current-season statistics are unavailable.'}:Date.now()-cached.fetched>6*3600000?{warning:'Saved statistics are stale. Refresh league data to update them.'}:{})};
  }
  function saveSettings(account,snapshot,input){const league=snapshot?.league.id||'demo',stored=db.prepare('SELECT data FROM league_settings WHERE account=? AND league=?').get(account,league);const settings=settingsFor(input,stored?JSON.parse(stored.data):{});db.prepare('INSERT INTO league_settings VALUES (?,?,?) ON CONFLICT(account,league) DO UPDATE SET data=excluded.data').run(account,league,JSON.stringify(settings));return settings;}
  async function prepareSnapshot(snapshot,catalog){
    await Promise.all([stats(Number(snapshot.league.season)),metadata()]);
    const slim=Object.fromEntries(Object.entries(catalog).map(([id,p])=>[id,Object.fromEntries(['full_name','name','first_name','last_name','position','team','club','injury_status','injury','birth_date','age','draft_round','draft_year','draft_pick','gsis_id','years_exp','active'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))]));
    const statistics=readStats(Number(snapshot.league.season));
    if(!statistics.rows.length)throw provider('Statistics are unavailable. Your previous analysis snapshot is unchanged.');
    return {statistics,metadata:readMetadata(),catalog:slim,asOf:new Date().toISOString()};
  }
  function storeSnapshot(account,snapshot,inputs){db.prepare('INSERT INTO analysis_snapshots VALUES (?,?,?,?) ON CONFLICT(account,league) DO UPDATE SET data=excluded.data,refreshed=excluded.refreshed').run(account,snapshot.league.id,JSON.stringify(inputs),snapshot.analysisRefreshedAt);}
  return {model,saveSettings,prepareSnapshot,storeSnapshot};
}
