import {render} from './ui/pages.js';
import {pwaResponse} from './pwa.js';
const SOURCE = 'https://pzsc.chanchao.com.tw/';
const HEADERS = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const local = ms => new Date(ms + 8 * 3600000);
const date = ms => local(ms).toISOString().slice(0,10);
const time = s => new Date(s).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const clock = m => String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const period = b => clock(b*30)+'–'+clock(b*30+30);
const week = ['日','一','二','三','四','五','六'];

function parseCount(html) {
  const tag = html.match(/<span\b[^>]*\bid=["']total_num_534["'][^>]*>([\s\S]*?)<\/span>/i);
  const match = tag?.[1].replace(/<[^>]*>/g,'').trim().match(/^(\d+)\s*人$/);
  if (!match) throw new Error('找不到健身房人數');
  const n = Number(match[1]);
  const attr = tag[0].match(/\bdata-to=["'](\d+)["']/i);
  if (n > 5000 || (attr && Number(attr[1]) !== n)) throw new Error('人數格式異常');
  return n;
}
// Observation samples never enter opening-hour statistics. Raw counts are never corrected.
const OBSERVATION_MINUTES = [350,355,1320,1325,1335];
async function readSource() {
  const r=await fetch(SOURCE+'?_tracker='+Date.now(),{headers:{'Cache-Control':'no-cache','Pragma':'no-cache'},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('官網 HTTP '+r.status);
  const sourceDate=r.headers.get('Date'),age=r.headers.get('Age');
  if((age!==null&&Number(age)>120)||(sourceDate&&Date.now()-Date.parse(sourceDate)>300000))throw new Error('來源回應過舊');
  return {count:parseCount(await r.text()),at:new Date().toISOString(),sourceDate,age};
}
async function collect(env, ms) {
  const d=local(ms),minute=d.getUTCHours()*60+d.getUTCMinutes();
  const observation=OBSERVATION_MINUTES.includes(minute);
  if(!observation&&(minute<360||minute>=1320))return;
  const slot=new Date(Math.floor(ms/300000)*300000).toISOString();
  let n=null,status='error',detail=null,sourceDate=null,age=null,fetchedAt=new Date().toISOString();
  if((env.CLOSED_DATES||'').split(',').map(s=>s.trim()).includes(date(ms)))status='closed';
  else if(Math.abs(Date.now()-ms)>4*60000){status='late';detail='排程延遲，未採樣';}
  else try {
    const first=await readSource();n=first.count;sourceDate=first.sourceDate;age=first.age;fetchedAt=first.at;
    status=observation?'observation':n===0?'zero_unverified':'ok';
  }catch(e){detail=String(e.message).slice(0,160);}
  const insert=()=>env.DB.prepare(`INSERT INTO samples
    (slot,fetched_at,local_date,weekday,hour,minute,count,status,detail,source_date,source_age,body_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(slot) DO NOTHING`).bind(
      slot,fetchedAt,date(ms),d.getUTCDay(),d.getUTCHours(),Math.floor(d.getUTCMinutes()/5)*5,n,status,detail,sourceDate,age).run();
  const result=await insert();
  // Save the first result before waiting. A retry only appends metadata; it cannot overwrite raw count.
  if(n===0&&result.meta?.changes>0){
    await new Promise(resolve=>setTimeout(resolve,20000));
    let retry;try{retry={status:'ok',...await readSource()};}catch(e){retry={status:'error',at:new Date().toISOString(),error:String(e.message).slice(0,160)};}
    detail=JSON.stringify({kind:'zero_recheck',first:{count:0,at:fetchedAt},retry});
    await env.DB.prepare('UPDATE samples SET detail=? WHERE slot=? AND fetched_at=? AND count=0').bind(detail,slot,fetchedAt).run();
  }
}
export default {
  async scheduled(event,env,ctx) {ctx.waitUntil(collect(env,event.scheduledTime));},
  async fetch(req,env) {
    if(req.method!=='GET')return new Response('Method not allowed',{status:405,headers:HEADERS});
    const path=new URL(req.url).pathname;
    const asset=pwaResponse(path);if(asset)return asset;
    if(path!=='/'&&path!=='/overview'&&path!=='/export.csv')return new Response('Not found',{status:404,headers:HEADERS});
    try {
      const since=date(Date.now()-55*86400000);
      if(path==='/export.csv') {
        const {results}=await env.DB.prepare('SELECT * FROM samples WHERE local_date>=? ORDER BY slot DESC').bind(since).all();
        const cols=['slot','fetched_at','local_date','weekday','hour','minute','count','status','detail'];
        const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
        return new Response('\ufeff'+[cols.join(','),...results.map(r=>cols.map(c=>cell(r[c])).join(','))].join('\r\n'),{headers:{...HEADERS,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="pingzhen.csv"'}});
      }
      const [recent,stats,daily,today,observations]=await env.DB.batch([
        env.DB.prepare('SELECT * FROM samples ORDER BY slot DESC LIMIT 24'),
        env.DB.prepare('SELECT status,COUNT(*) AS n FROM samples WHERE local_date>=? GROUP BY status').bind(since),
        env.DB.prepare("SELECT weekday,(hour*2+CAST(minute/30 AS INTEGER)) AS bucket,local_date,AVG(count) AS mean FROM samples WHERE local_date>=? AND status='ok' AND hour>=6 AND hour<22 GROUP BY local_date,weekday,bucket HAVING COUNT(*)>=5").bind(since),
        env.DB.prepare('SELECT * FROM samples WHERE local_date=? ORDER BY slot').bind(date(Date.now())),
        env.DB.prepare('SELECT * FROM samples WHERE local_date>=? AND (hour<6 OR hour>=22 OR (hour=6 AND minute<=5)) ORDER BY slot DESC LIMIT 32').bind(date(Date.now()-86400000))
      ]);
      return new Response(render(recent.results,stats.results,daily.results,today.results,(env.CLOSED_DATES||'').split(',').map(s=>s.trim()),observations.results,path==='/overview'?'overview':'today'),{headers:{...HEADERS,'Content-Type':'text/html; charset=utf-8'}});
    } catch {return new Response('資料讀取失敗，請確認 D1 綁定名稱為 DB，且 samples 資料表已建立。',{status:503,headers:HEADERS});}
  }
};

