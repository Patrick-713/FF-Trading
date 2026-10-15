import {appendFileSync} from 'node:fs';
// Explicitly preloaded by integration tests only. Production never imports this fixture.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const text = String(url);if(process.env.TEST_FETCH_LOG)appendFileSync(process.env.TEST_FETCH_LOG,text+'\n');
  if(text.startsWith('https://github.com/nflverse/')){
    if(process.env.TEST_STATS_FAILURE==='true')return new Response('',{status:503});
    if(text.includes('/players/'))return new Response('gsis_id,birth_date,draft_round,draft_number,draft_year\nG101,2000-01-01,1,8,2022\n',{status:200});
    return new Response('player_id,player_display_name,position,week,season_type,targets,attempts,passing_yards,passing_tds\nG101,Real Starter,QB,1,REG,0,30,250,2\nG101,Real Starter,QB,2,REG,0,30,260,2\n',{status:200});
  }
  if (!text.startsWith('https://api.sleeper.app/v1/')) return nativeFetch(url, options);
  const path = text.slice('https://api.sleeper.app/v1/'.length);
  let data;
  if (path === 'state/nfl') data = { season:'2026', week:3, leg:3, season_type:'regular' };
  else if (path === 'user/testmanager' || path === 'user/123456789') data = { user_id:'123456789', username:'testmanager', display_name:'Test manager' };
  else if (path.startsWith('user/')) data = path.includes('/leagues/') ? [{ league_id:'1234567890123', sport:'nfl', name:'Integration League', season:'2026', status:'in_season', total_rosters:2 }] : null;
  else if ((path === 'league/1234567890123'||path === 'league/2234567890123')) data = { league_id:path.split('/')[1], sport:'nfl', name:'Integration League', season:'2026', status:'in_season', roster_positions:['QB','RB','BN'] };
  else if (path.endsWith('/users')) data = [{user_id:'123456789',display_name:'Test manager',metadata:{team_name:'Test Team'}},{user_id:'987654321',display_name:'Other manager'}];
  else if (path.endsWith('/rosters')) data = [
    {roster_id:1,owner_id:'123456789',starters:['101','102'],players:['101','102','103'],settings:{wins:1,losses:1}},
    {roster_id:2,owner_id:'987654321',starters:['201'],players:['201'],settings:{wins:1,losses:1}}
  ];
  else if (path === 'players/nfl') data = {101:{full_name:'Real Starter',position:'QB',team:'BUF',gsis_id:'G101'},102:{full_name:'Real Runner',position:'RB',team:'DET'},103:{full_name:'Bench Player',position:'WR',team:'SEA'}};
  else if (path.endsWith('/matchups/1')) data = [{roster_id:1,points:150},{roster_id:2,points:100}];
  else if (path.endsWith('/matchups/2')) data = [{roster_id:1,points:100},{roster_id:2,points:150}];
  else return new Response('{}',{status:404});
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
