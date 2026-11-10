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
function render(latest,stats,daily,today,closedDates,observations) {
  const payload=JSON.stringify({latest,stats,daily,today,closedDates,observations,now:Date.now()}).replace(/</g,'\\u003c');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#183e32"><title>平鎮健身 · 人潮指南</title>
<style>
:root{--ink:#183e32;--muted:#65766d;--line:#e0e8e1;--bg:#f3f6f1;--green:#276e50}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,sans-serif}main{max-width:980px;margin:auto;padding:24px 18px 100px}header{display:flex;justify-content:space-between;align-items:center;gap:12px}small,.muted{color:var(--muted);font-size:13px}h1{font-size:28px;letter-spacing:-1px;margin:18px 0 6px}h2{font-size:19px;margin:0 0 8px}h3{font-size:15px;margin:0}p{margin:8px 0}a{color:var(--green)}button,select,input{font:inherit}button,select,.action{border:1px solid var(--line);background:white;color:var(--ink);border-radius:12px;padding:10px 13px;min-height:44px}button{cursor:pointer}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #d88e32;outline-offset:2px}.action{text-decoration:none;white-space:nowrap}.hero{background:var(--ink);color:white;border-radius:24px;padding:24px;margin:22px 0 16px}.hero .muted{color:#c6d8ce}.hero strong{font-size:64px;line-height:1.2;letter-spacing:-3px}.hero .unit{font-size:18px;margin-left:10px}.badge{display:inline-block;border-radius:20px;padding:4px 10px;font-size:12px;background:#e9f1eb;color:var(--ink)}.hero .badge{background:#35574a;color:white}.hero-top{display:flex;justify-content:space-between;gap:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:white;border:1px solid var(--line);border-radius:22px;padding:20px;margin-bottom:16px;min-width:0}.full{grid-column:1/-1}.row{display:flex;justify-content:space-between;gap:12px;align-items:center}.choices{display:flex;gap:6px;margin:16px 0}.choices button{flex:1;padding:8px 0;min-width:0}.choices button[aria-pressed=true]{background:var(--ink);color:white}.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}.pick{background:#f1f6ef;border-radius:14px;padding:14px;margin:10px 0}.pick strong{font-size:22px}.empty{padding:18px 0;color:var(--muted)}.chart{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.tile{border:0;border-radius:12px;min-height:70px;padding:8px 3px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#eff2ee;font-size:12px}.tile strong{font-size:18px}.tile[aria-pressed=true]{outline:3px solid #183e32;outline-offset:1px}.c1{background:#e4efdc}.c2{background:#bad5a9}.c3{background:#7da87a;color:#102d20}.c4{background:#35674e;color:white}.legend{display:flex;align-items:center;gap:6px;font-size:12px;margin:12px 0}.swatch{width:18px;height:10px;border-radius:3px}.detail{border-left:3px solid #507c50;padding:10px 12px;background:#f7f9f5;margin-top:16px;min-height:88px}.metric{display:flex;gap:20px;margin:14px 0}.metric strong{font-size:24px;display:block}details{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}summary{cursor:pointer;min-height:40px}.log{padding:10px 0;border-bottom:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}.bottom{position:fixed;bottom:0;left:0;right:0;background:#fffffff5;border-top:1px solid var(--line);display:flex;justify-content:space-around;padding:10px 8px calc(10px + env(safe-area-inset-bottom));z-index:5}.bottom a{text-decoration:none;font-size:13px;padding:5px 10px}.notice{color:#8a4f13}section{scroll-margin-top:15px}footer{font-size:12px;color:var(--muted)}@media(max-width:650px){.grid{display:block}main{padding:20px 16px 100px}.hero{padding:22px}.card{padding:18px}h1{font-size:27px}.hero strong{font-size:60px}}@media(min-width:651px){.bottom{display:none}.chart{grid-template-columns:repeat(8,minmax(0,1fr))}}
</style></head><body><main><header><small>平鎮國民運動中心 · 體適能中心</small><a class="action" href="/">重新整理</a></header><h1>挑個舒服的時間練。</h1><p class="muted">每 5 分鐘記錄，幫你看懂半小時人潮。</p>
<section class="hero" id="now"><div class="hero-top"><span>最近官網人數</span><span class="badge" id="state"></span></div><p><strong id="count">—</strong><span class="unit">人</span></p><p id="comparison"></p><p class="muted" id="updated"></p></section>
<div class="grid"><section class="card" id="visit"><h2>今天，什麼時候去？</h2><p class="muted">找出接下來連續 1 小時較少人的時段。</p><div class="controls"><label for="after">最早出發</label><select id="after"></select></div><div id="recommend"></div><small>依同星期的歷史人數估計，並非即時預測；每段至少 3 個有效日期。</small></section>
<section class="card" id="health"><div class="row"><h2>資料有正常更新嗎？</h2><span class="badge" id="health-state"></span></div><p id="health-text"></p><div class="metric"><div><strong id="coverage">—</strong><small>今日排程有紀錄</small></div><div><strong id="valid">—</strong><small>今日正常採樣</small></div></div><small>排程保留 10 分鐘寫入緩衝。休館日不計應採樣數。</small><details><summary>查看最近採樣</summary><div id="logs"></div></details></section>
<section class="card full" id="trend"><h2>今天的人數走勢</h2><p class="muted">只畫正常原始採樣；缺漏與待確認處不連線。</p><div id="today-chart"></div><p id="trend-summary" class="muted"></p><details><summary>開閉館觀察（不參與推薦）</summary><div id="observations"></div><p class="muted">人數下降只代表數值變化，不能單憑下降認定已重設。不扣除、不校正。</p></details></section><section class="card full" id="popular"><div class="row"><h2>一週熱門時段</h2><span class="badge">半小時</span></div><p class="muted">選星期、點時段，查看典型人數和波動。</p><div class="choices" id="days" aria-label="選擇星期"></div><div class="legend">較少 <i class="swatch c1"></i><i class="swatch c2"></i><i class="swatch c3"></i><i class="swatch c4"></i> 較多 · — 資料不足</div><div class="chart" id="chart"></div><div class="detail" id="detail" aria-live="polite">點選時段查看詳細資料。</div><details><summary>這些數字怎麼算？</summary><p class="muted">使用最近 56 天資料。每半小時至少 5 筆正常採樣才算一個有效日期，再取各日期平均人數的中位數；至少 3 個日期才顯示熱門時段。波動區間為歷史四分位範圍，不是預測保證。1 小時建議只比較同日兩個相鄰、資料完整的半小時，避開尚未完整採樣的今天。顏色相對於整週有足夠資料的時段。零人、失敗、延遲和設定休館的資料不納入統計；國定假日目前未自動分開。</p></details></section></div>
<footer><p>台灣時間 06:00–22:00；營業採樣至 21:55；05:50、05:55、22:00、22:05、22:15 額外觀察。館方內部更新時間未知，人數不代表器材等候時間。</p><p><a href="/export.csv">下載最近 56 天 CSV</a> · <a href="https://pzsc.chanchao.com.tw/">查看館方官網</a></p><p>報表免登入，知道網址的人皆可查看。重新整理只讀取紀錄，不會額外抓取官網。</p></footer></main><nav class="bottom" aria-label="報表導覽"><a href="#now">現在人數</a><a href="#visit">何時去練</a><a href="#popular">熱門時段</a><a href="#health">資料狀態</a></nav>
<script id="data" type="application/json">${payload}</script><script>
const D=JSON.parse(document.getElementById('data').textContent);
const $=id=>document.getElementById(id);
const now=new Date(D.now+28800000),todayKey=now.toISOString().slice(0,10),weekday=now.getUTCDay(),minute=now.getUTCHours()*60+now.getUTCMinutes();
const clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const period=b=>clock(b*30)+'–'+clock(b*30+30);
const weeks=['日','一','二','三','四','五','六'];
const labels={ok:'正常',error:'抓取失敗',late:'排程延遲',closed:'設定休館',zero_unverified:'零人待確認',observation:'開閉館觀察'};
const fmt=s=>new Date(s).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const quant=(values,p)=>{const a=[...values].sort((a,b)=>a-b),i=(a.length-1)*p,lo=Math.floor(i);return a[lo]+(a[Math.ceil(i)]-a[lo])*(i-lo);};
const summary=values=>({n:values.length,median:quant(values,.5),low:quant(values,.25),high:quant(values,.75)});
const map=new Map();
// Exclude today's incomplete data and explicitly configured closed dates.
const history=D.daily.filter(r=>r.local_date<todayKey&&!D.closedDates.includes(r.local_date));
for(const r of history){const key=r.weekday+'-'+r.bucket;if(!map.has(key))map.set(key,[]);map.get(key).push(r.mean);}
const baseline=(w,b)=>{const v=map.get(w+'-'+b);return v?summary(v):null;};
const closed=D.closedDates.includes(todayKey),open=!closed&&minute>=360&&minute<1320;
const last=D.latest.find(r=>r.hour>=6&&r.hour<22),fresh=last&&D.now-Date.parse(last.fetched_at)<=15*60000&&last.local_date===todayKey;
$('state').textContent=closed?'設定休館':!open?'非採樣時間':!last?'等待第一筆':!fresh?'資料待更新':last.status==='ok'?'近期採樣':'採樣待確認';
$('count').textContent=!open?'已閉館':last&&last.count!==null?last.count:'—';
document.querySelector('.unit').hidden=!open;
if(!open)$('count').style.fontSize='40px';
$('updated').textContent=last?fmt(last.fetched_at)+' · '+(last.count??'—')+' 人 · '+(labels[last.status]||last.status):'尚無紀錄，請確認排程已啟用。';
const base=baseline(weekday,Math.floor(minute/30));
if(open&&fresh&&last.status==='ok'&&base&&base.n>=3){const diff=last.count-base.median;$('comparison').textContent='比同星期、同時段平常'+(Math.abs(diff)<1?'差不多':diff>0?'多約 '+Math.round(diff)+' 人':'少約 '+Math.round(-diff)+' 人')+'（參考 '+base.n+' 個日期）';}
else $('comparison').textContent=!open?'顯示最近一次紀錄，並非目前人數。':!fresh?'資料尚未更新，暫不判斷目前人潮。':'累積更多同時段資料後，會顯示與平常的差異。';
const due=[];if(!closed)for(let m=360;m<1320&&m<=minute-10;m+=5)due.push(m);
const recorded=new Set(D.today.map(r=>r.hour*60+r.minute));
const valid=new Set(D.today.filter(r=>r.status==='ok').map(r=>r.hour*60+r.minute));
const seen=due.filter(m=>recorded.has(m)).length,good=due.filter(m=>valid.has(m)).length,missing=due.length-seen;
$('coverage').textContent=due.length?seen+' / '+due.length:'—';$('valid').textContent=due.length?Math.round(good/due.length*100)+'%':'—';
$('health-state').textContent=closed?'休館':!open?'休息中':missing||!fresh||last?.status!=='ok'?'需要留意':'最近一次正常';
$('health-text').textContent=closed?'今天已設定休館，不預期正常採樣。':missing?'今天有 '+missing+' 個已到期時點沒有紀錄；可能是排程尚未啟用或漏採。':!open?'目前不在採樣時間，營業時段會繼續記錄。':!last?'等待排程送回第一筆資料。':!fresh?'最新紀錄超過 15 分鐘，請檢查排程或執行紀錄。':last.status!=='ok'?'最近採樣為「'+(labels[last.status]||last.status)+'」，暫不拿來估計人潮。':'最近採樣正常，已到期時點皆有紀錄。';
const suspect=D.today.filter(r=>r.hour>=6&&r.hour<22&&r.status!=='ok').length;
$('health-text').textContent+=' 今日另有 '+suspect+' 筆非正常紀錄（含零人待確認、失敗或延遲）。';
function detailText(raw){try{const x=JSON.parse(raw);if(x.kind==='zero_recheck')return '首次 0 人；'+fmt(x.retry.at)+' 複查：'+(x.retry.status==='ok'?x.retry.count+' 人':x.retry.error)+'（原始值保留，複查不納入統計）';}catch{}return raw||'';}
for(const r of D.latest){const e=document.createElement('div');e.className='log';e.textContent=fmt(r.fetched_at)+' · '+(r.count??'—')+' 人 · '+(labels[r.status]||r.status)+(r.detail?'：'+detailText(r.detail):'');$('logs').append(e);}
if(!D.latest.length)$('logs').textContent='尚無資料';
const pairMap=new Map(history.map(r=>[r.local_date+'-'+r.bucket,r]));
function hourStats(b){const values=[];for(const r of history){if(r.weekday!==weekday||r.bucket!==b)continue;const next=pairMap.get(r.local_date+'-'+(b+1));if(next)values.push((r.mean+next.mean)/2);}return values.length>=3?summary(values):null;}
const earliest=Math.max(12,Math.ceil(minute/30));
for(let b=earliest;b<=42;b++){const o=document.createElement('option');o.value=b;o.textContent=clock(b*30);$('after').append(o);}
function recommendations(){const out=$('recommend');out.replaceChildren();if(closed||earliest>42){out.textContent=closed?'今天已設定休館。':'今天已沒有完整 1 小時可推薦，明天再看看。';return;}
const options=[];for(let b=Number($('after').value);b<=42;b++){const s=hourStats(b);if(s)options.push({b,...s});}options.sort((a,b)=>a.median-b.median||a.b-b.b);
const picks=[];for(const p of options){if(picks.every(x=>Math.abs(x.b-p.b)>=2))picks.push(p);if(picks.length===3)break;}
if(!picks.length){out.className='empty';out.textContent='還在累積資料。相同星期的完整 1 小時至少要有 3 個有效日期，才會提供建議。';return;}out.className='';
for(const p of picks){const e=document.createElement('div');e.className='pick';const title=document.createElement('strong');title.textContent=clock(p.b*30)+'–'+clock(p.b*30+60);const sub=document.createElement('p');sub.textContent='歷史典型約 '+Math.round(p.median)+' 人 · '+p.n+' 個日期';const foot=document.createElement('small');foot.textContent='中間一半紀錄約 '+Math.round(p.low)+'–'+Math.round(p.high)+' 人'+(p.n<6?' · 初步參考':'');e.append(title,sub,foot);out.append(e);}}
$('after').disabled=closed||earliest>42;$('after').addEventListener('change',recommendations);recommendations();
let selected=weekday;
const all=[...map.values()].filter(v=>v.length>=3).map(v=>summary(v).median);
const cut=all.length?[quant(all,.25),quant(all,.5),quant(all,.75)]:[];
function showDay(w){selected=w;for(const b of $('days').children)b.setAttribute('aria-pressed',Number(b.dataset.day)===w);$('chart').replaceChildren();$('detail').textContent='星期'+weeks[w]+' · 點選時段查看詳細資料。';for(let b=12;b<44;b++){const s=baseline(w,b),usable=s&&s.n>=3;const button=document.createElement('button');button.className='tile'+(usable?' c'+(1+cut.filter(c=>s.median>c).length):'');button.setAttribute('aria-pressed','false');const t=document.createElement('span');t.textContent=clock(b*30);const n=document.createElement('strong');n.textContent=usable?Math.round(s.median):'—';button.setAttribute('aria-label','星期'+weeks[w]+' '+period(b)+(usable?'，典型 '+Math.round(s.median)+' 人':'，資料不足'));button.append(t,n);button.onclick=()=>{for(const x of $('chart').children)x.setAttribute('aria-pressed','false');button.setAttribute('aria-pressed','true');$('detail').textContent='星期'+weeks[w]+' '+period(b)+'：'+(usable?'典型 '+Math.round(s.median)+' 人；中間一半紀錄 '+Math.round(s.low)+'–'+Math.round(s.high)+' 人。共 '+s.n+' 個有效日期。'+(s.n<6?'目前僅供初步參考。':''):'只有 '+(s?s.n:0)+' 個有效日期，至少 3 個才比較人潮。');};$('chart').append(button);}}
for(let w=0;w<7;w++){const b=document.createElement('button');b.textContent='週'+weeks[w];b.dataset.day=w;b.onclick=()=>showDay(w);$('days').append(b);}showDay(selected);
// Fixed 06:00–22:00 axis; invalid or missing five-minute slots break the line.
const points=D.today.filter(r=>r.hour>=6&&r.hour<22).sort((a,b)=>a.slot.localeCompare(b.slot));
const normal=points.filter(r=>r.status==='ok'&&Number.isFinite(r.count));
if(!normal.length)$('today-chart').textContent='今天還沒有可繪製的正常採樣。';
else {
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 640 200');svg.setAttribute('role','img');svg.setAttribute('aria-label','今日正常人數走勢，缺漏處不連線');svg.style.width='100%';
 const max=Math.max(10,...normal.map(r=>r.count))*1.15;
 const x=r=>40+(r.hour*60+r.minute-360)/960*580,y=r=>160-r.count/max*130;
 function add(tag,attrs,text){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;svg.append(e);}
 for(let h=6;h<=22;h+=4)add('text',{x:40+(h*60-360)/960*580,y:190,'text-anchor':'middle','font-size':14,fill:'#65766d'},clock(h*60));
 for(const n of [0,Math.round(max/2),Math.ceil(max)]){const yy=160-n/max*130;add('line',{x1:40,x2:620,y1:yy,y2:yy,stroke:'#e0e8e1'});add('text',{x:32,y:yy+5,'text-anchor':'end','font-size':13,fill:'#65766d'},String(n));}
 let prev=null;
 for(const r of points){if(r.status!=='ok'||!Number.isFinite(r.count)){prev=null;continue;}if(prev&&Date.parse(r.slot)-Date.parse(prev.slot)===300000)add('line',{x1:x(prev),y1:y(prev),x2:x(r),y2:y(r),stroke:'#276e50','stroke-width':2});add('circle',{cx:x(r),cy:y(r),r:3,fill:'#276e50'});prev=r;}
 $('today-chart').append(svg);
}
$('trend-summary').textContent=normal.length?'今日正常紀錄 '+normal.length+' 筆；原始人數範圍 '+Math.min(...normal.map(r=>r.count))+'–'+Math.max(...normal.map(r=>r.count))+' 人。':'資料從啟用後開始累積。';
for(const r of D.observations||[]){const e=document.createElement('div');e.className='log';e.textContent=fmt(r.fetched_at)+' · '+(r.count??'—')+' 人 · '+(labels[r.status]||r.status)+(r.detail?'：'+detailText(r.detail):'');$('observations').append(e);}
if(!D.observations?.length)$('observations').textContent='尚無開閉館觀察紀錄。';
// Refresh stored data only, never trigger source collection through a browser request.
let loadedAt=Date.now();
function refreshIfDue(){if(!document.hidden&&Date.now()-loadedAt>=300000){loadedAt=Date.now();location.reload();}}
setInterval(refreshIfDue,30000);
document.addEventListener('visibilitychange',refreshIfDue);
window.addEventListener('pageshow',refreshIfDue);

</script></body></html>`;
}
export default {
  async scheduled(event,env,ctx) {ctx.waitUntil(collect(env,event.scheduledTime));},
  async fetch(req,env) {
    if(req.method!=='GET')return new Response('Method not allowed',{status:405,headers:HEADERS});
    const path=new URL(req.url).pathname;
    if(path!=='/'&&path!=='/export.csv')return new Response('Not found',{status:404,headers:HEADERS});
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
      return new Response(render(recent.results,stats.results,daily.results,today.results,(env.CLOSED_DATES||'').split(',').map(s=>s.trim()),observations.results),{headers:{...HEADERS,'Content-Type':'text/html; charset=utf-8'}});
    } catch {return new Response('資料讀取失敗，請確認 D1 綁定名稱為 DB，且 samples 資料表已建立。',{status:503,headers:HEADERS});}
  }
};
