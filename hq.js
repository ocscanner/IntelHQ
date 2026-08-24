/* ── THEME (dark/light toggle, persisted) ── */
(function(){
  const saved = localStorage.getItem('ocs-theme');
  if (saved === 'light') document.documentElement.setAttribute('data-theme','light');
})();
function toggleTheme(){
  const html = document.documentElement;
  const isLight = html.getAttribute('data-theme') === 'light';
  if (isLight) { html.removeAttribute('data-theme'); localStorage.setItem('ocs-theme','dark'); }
  else { html.setAttribute('data-theme','light'); localStorage.setItem('ocs-theme','light'); }
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = isLight ? '🌙' : '☀';
}
// Set correct icon on load
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('theme-toggle');
  if (btn && document.documentElement.getAttribute('data-theme') === 'light') btn.textContent = '☀';
});

/* ═══════════════════════════════════════
   CHANNEL DATA — all YouTube embeds
═══════════════════════════════════════ */
window.CHANNEL_GROUPS = {
  local: { label:"Local News", channels:[
    {name:"FOX 11 LA",        type:"youtube", url:"https://www.youtube.com/embed/8u8pQ_uLGjo?autoplay=1&mute=1&playsinline=1"},
    {name:"ABC7 Los Angeles", type:"youtube", url:"https://www.youtube.com/embed/s3iVFJoxrYc?autoplay=1&mute=1&playsinline=1"},
  ]},
  national: { label:"National News", channels:[
    {name:"NBC News NOW",      type:"youtube", url:"https://www.youtube.com/embed/live_stream?channel=UCeY0bbntWzzVIaj2z3QigXg&autoplay=1&mute=1"},
    {name:"ABC News Live",     type:"youtube", url:"https://www.youtube.com/embed/iipR5yUp36o?autoplay=1&mute=1&playsinline=1"},
    {name:"FOX Weather",       type:"youtube", url:"https://www.youtube.com/embed/wt6SIE7BXS8?autoplay=1&mute=1&playsinline=1"},
    {name:"Newsmax2 Live",     type:"youtube", url:"https://www.youtube.com/embed/live_stream?channel=UCx6h-dWzJ5NpAlja1YsApdg&autoplay=1&mute=1&playsinline=1"},
  ]},
  aviation: { label:"Aviation / Space", channels:[
    {name:"LAX Runways 24L/24R", type:"youtube", url:"https://www.youtube.com/embed/n4I0d44oBEs?autoplay=1&mute=1&playsinline=1"},
    {name:"LAX Runways 25L/25R", type:"youtube", url:"https://www.youtube.com/embed/KzsNnyN8D_Q?autoplay=1&mute=1&playsinline=1"},
    {name:"LAS Airport Live",   type:"youtube", url:"https://www.youtube.com/embed/iIUCaiiMmNs?autoplay=1&mute=1&playsinline=1"},
    {name:"Space / Launch Cam", type:"youtube", url:"https://www.youtube.com/embed/mhJRzQsLZGg?autoplay=1&mute=1&playsinline=1"},
    {name:"Space Live Feed",    type:"youtube", url:"https://www.youtube.com/embed/Jm8wRjD3xVA?autoplay=1&mute=1&playsinline=1"},
  ]}
};

/* Aviation/Space streams — rendered in Flights tab separately */
const AVIATION_CHANNELS = [
  {name:"LAX Runways 24L/24R", type:"youtube", url:"https://www.youtube.com/embed/n4I0d44oBEs?autoplay=1&mute=1&playsinline=1"},
  {name:"LAX Runways 25L/25R", type:"youtube", url:"https://www.youtube.com/embed/KzsNnyN8D_Q?autoplay=1&mute=1&playsinline=1"},
  {name:"LAS Airport Live",   type:"youtube", url:"https://www.youtube.com/embed/V7_orOtu-oo?autoplay=1&mute=1&playsinline=1"},
  {name:"Space / Launch Cam", type:"youtube", url:"https://www.youtube.com/embed/mhJRzQsLZGg?autoplay=1&mute=1&playsinline=1"},
  {name:"Space Live Feed",    type:"youtube", url:"https://www.youtube.com/embed/Jm8wRjD3xVA?autoplay=1&mute=1&playsinline=1"},
];

/* News streams rendered in News tab */
const NEWS_LIVE_STREAMS = [
  {name:"LiveNOW from FOX",   url:"https://www.youtube.com/embed/live_stream?channel=UCJg9wBPyKMNA5sRDnvzmkdg&autoplay=1&mute=1&playsinline=1"},
  {name:"Newsmax2 Live",      url:"https://www.youtube.com/embed/live_stream?channel=UCx6h-dWzJ5NpAlja1YsApdg&autoplay=1&mute=1&playsinline=1"},
  {name:"NewsNation Live",    url:"https://www.youtube.com/embed/live_stream?channel=UCkm99LrT7pKJMOwYpdJ9l7A&autoplay=1&mute=1&playsinline=1"},
  {name:"C-SPAN Live",        url:"https://www.youtube.com/embed/live_stream?channel=UCb--64Gl51jIEVE-GLDAVTg&autoplay=1&mute=1&playsinline=1"},
];

let customStreams = JSON.parse(sessionStorage.getItem('ocs-custom')||'[]');
let activeGroup = 'all';

/* ── HELPERS ── */
function ytId(url){
  for(const p of[/youtube\.com\/embed\/([A-Za-z0-9_-]+)/,/youtube\.com\/watch\?v=([A-Za-z0-9_-]+)/,/youtu\.be\/([A-Za-z0-9_-]+)/]){
    const m=url.match(p);if(m&&m[1]&&m[1]!=='live_stream')return m[1];
  }return null;
}
function timeAgo(d){
  const m=Math.floor((Date.now()-d)/60000);
  if(m<1)return'just now';if(m<60)return m+'m ago';
  const h=Math.floor(m/60);if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago';
}
function fmt(date,tz,secs){
  return date.toLocaleTimeString('en-US',{timeZone:tz,hour12:false,hour:'2-digit',minute:'2-digit',...(secs?{second:'2-digit'}:{})});
}

/* ── STREAM CELL BUILDER ── */
function buildStreamCell(ch, key, showStop=true) {
  const id=ytId(ch.url);
  // For channel live streams, popout should open the channel's /live page
  const chM=ch.url.match(/channel=([A-Za-z0-9_-]+)/);
  const popUrl = chM ? `https://www.youtube.com/channel/${chM[1]}/live` : ch.url;
  const cell=document.createElement('div');cell.className='scell';
  cell.innerHTML=`
    <div class="shdr"><span class="slabel">${ch.name}</span><span class="stbadge">${ch._gl||'YouTube'}</span></div>
    <div class="sbody" id="sb-${key}">
      <div class="sph">
        ${id?`<img class="sthumb" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="${ch.name}" loading="lazy"/>`:''}
        <button class="pbtn" onclick="playStream('${key}','${encodeURIComponent(ch.url)}')">▶ PLAY</button>
      </div>
    </div>
    <div class="sacts">
      <button class="sbtn" onclick="playStream('${key}','${encodeURIComponent(ch.url)}')">▶ Play</button>
      <button class="sbtn foc" onclick="openFocus('${encodeURIComponent(ch.url)}')">⛶ Focus</button>
      <button class="sbtn" onclick="window.open('${popUrl}','_blank','noopener,noreferrer,width=960,height=600')">↗ Popout</button>
      ${showStop?`<button class="sbtn" onclick="stopStream('${key}')">■ Stop</button>`:''}
    </div>`;
  return cell;
}

/* ── STREAMS TAB ── */
function allChannels(){
  const a=[];
  Object.entries(window.CHANNEL_GROUPS).forEach(([k,g])=>(g.channels||[]).forEach(ch=>a.push({...ch,_g:k,_gl:g.label})));
  customStreams.forEach(ch=>a.push({...ch,_g:'custom',_gl:'Custom'}));
  return a;
}
function filtered(){
  if(activeGroup==='all')return allChannels();
  if(activeGroup==='custom')return customStreams.map(ch=>({...ch,_g:'custom',_gl:'Custom'}));
  const g=window.CHANNEL_GROUPS[activeGroup];
  return g?(g.channels||[]).map(ch=>({...ch,_g:activeGroup,_gl:g.label})):[];
}
function buildGroupBar(){
  const bar=document.getElementById('gbar');bar.innerHTML='';
  const pills=[{k:'all',l:'All'}];
  Object.entries(window.CHANNEL_GROUPS).forEach(([k,g])=>pills.push({k,l:g.label}));
  if(customStreams.length)pills.push({k:'custom',l:'Custom'});
  pills.forEach(p=>{
    const b=document.createElement('button');
    b.className='gpill'+(p.k===activeGroup?' active':'');
    b.textContent=p.l;b.onclick=()=>{activeGroup=p.k;buildGroupBar();renderStreams()};
    bar.appendChild(b);
  });
}
function renderStreams(){
  const grid=document.getElementById('sg');grid.innerHTML='';
  filtered().forEach((ch,i)=>{
    grid.appendChild(buildStreamCell(ch, ch._g+'_'+i));
  });
  const ab=document.createElement('div');ab.className='add-btn';ab.onclick=openAddModal;
  ab.innerHTML='<span class="plus">＋</span><span>Add Custom Stream</span>';
  grid.appendChild(ab);
}

/* ── AVIATION STREAMS (Flights tab) ── */
function renderAviationStreams(){
  const grid=document.getElementById('av-sg');grid.innerHTML='';
  AVIATION_CHANNELS.forEach((ch,i)=>{
    grid.appendChild(buildStreamCell({...ch,_gl:'Aviation'}, 'av_'+i));
  });
}

/* ── NEWS LIVE STREAMS (News tab) ── */
function renderNewsStreams(){
  const grid=document.getElementById('news-streams-grid');grid.innerHTML='';
  NEWS_LIVE_STREAMS.forEach((ch,i)=>{
    grid.appendChild(buildStreamCell({...ch,_gl:'News'},  'ns_'+i));
  });
}

function playStream(key,enc){
  let url=decodeURIComponent(enc);
  // Normalize channel-based live streams. The standard youtube.com embed
  // handles live_stream?channel= more reliably than the nocookie domain.
  const chMatch=url.match(/channel=([A-Za-z0-9_-]+)/);
  if(url.includes('live_stream')&&chMatch){
    url=`https://www.youtube.com/embed/live_stream?channel=${chMatch[1]}&autoplay=1&mute=1&playsinline=1`;
  }
  const b=document.getElementById('sb-'+key);if(!b)return;
  // Where to send the user if the embed won't play (stream ended, ID changed,
  // or YouTube blocks the embed) — channel URLs go to the channel's /live page.
  const watchUrl = chMatch
    ? `https://www.youtube.com/channel/${chMatch[1]}/live`
    : (ytId(url) ? `https://www.youtube.com/watch?v=${ytId(url)}` : url);
  b.innerHTML=`<iframe src="${url}" title="Stream" loading="eager" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; autoplay" allowfullscreen style="width:100%;height:100%;border:0"></iframe>
    <a href="${watchUrl}" target="_blank" rel="noopener" style="position:absolute;right:6px;bottom:6px;z-index:3;background:rgba(0,0,0,.72);color:#cfe6f5;font-family:var(--fm);font-size:.6rem;letter-spacing:.04em;padding:3px 7px;border-radius:4px;text-decoration:none;border:1px solid rgba(255,255,255,.18)">Not loading? Open ↗</a>`;
}
function stopStream(key){
  const b=document.getElementById('sb-'+key);if(!b)return;
  b.innerHTML='<div class="sph"><span style="color:var(--muted);font-family:var(--fm);font-size:.8rem">Stopped</span></div>';
}
function openFocus(enc){
  document.getElementById('fi').src=decodeURIComponent(enc);
  const o=document.getElementById('fo');o.classList.add('open');
  if(o.requestFullscreen)o.requestFullscreen().catch(()=>{});
}
function closeFocus(){
  document.getElementById('fi').src='';document.getElementById('fo').classList.remove('open');
  if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
}

/* ── ADD MODAL ── */
function openAddModal(){document.getElementById('am').classList.add('open')}
function closeAddModal(){document.getElementById('am').classList.remove('open')}
function confirmAdd(){
  let url=document.getElementById('m-url').value.trim();
  const label=document.getElementById('m-label').value.trim()||'Custom Stream';
  const type=document.getElementById('m-type').value;
  if(!url)return;
  if(type==='youtube'){const id=ytId(url);if(id)url=`https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;}
  customStreams.push({name:label,type,url});
  sessionStorage.setItem('ocs-custom',JSON.stringify(customStreams));
  closeAddModal();buildGroupBar();renderStreams();
  document.getElementById('m-url').value='';document.getElementById('m-label').value='';
}

/* ── CLOCKS ── */
/* ── SUNRISE / SUNSET (NOAA solar calculation — no API needed) ── */
function sunTimes(lat, lng, date = new Date()){
  const rad=Math.PI/180, J1970=2440588, J2000=2451545, dayMs=864e5;
  const lw=-lng*rad, phi=lat*rad;
  const toJulian=d=>d.valueOf()/dayMs-0.5+J1970;
  const fromJulian=j=>new Date((j+0.5-J1970)*dayMs);
  const d=toJulian(date)-J2000;
  const n=Math.round(d-0.0009-lw/(2*Math.PI));
  const ds=0.0009+lw/(2*Math.PI)+n;
  const M=rad*(357.5291+0.98560028*ds);
  const C=rad*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M));
  const P=rad*102.9372;
  const Lsun=M+C+P+Math.PI;
  const Jtransit=J2000+ds+0.0053*Math.sin(M)-0.0069*Math.sin(2*Lsun);
  const dec=Math.asin(Math.sin(Lsun)*Math.sin(rad*23.4397));
  const cosH=(Math.sin(-0.833*rad)-Math.sin(phi)*Math.sin(dec))/(Math.cos(phi)*Math.cos(dec));
  if(cosH>1||cosH<-1) return null; // polar day/night
  const H=Math.acos(cosH);
  return { sunrise: fromJulian(Jtransit-H/(2*Math.PI)), sunset: fromJulian(Jtransit+H/(2*Math.PI)) };
}

function updateOCSun(){
  const el=document.getElementById('sb-sun');
  if(!el)return;
  const st=sunTimes(33.7175,-117.8311);
  if(!st){el.textContent='--';return;}
  const f=d=>d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles'}).replace(' AM','a').replace(' PM','p');
  el.textContent=`🌅 ${f(st.sunrise)} · 🌇 ${f(st.sunset)}`;
}

function updateClocks(){
  const n=new Date();
  document.getElementById('sb-local').textContent=fmt(n,Intl.DateTimeFormat().resolvedOptions().timeZone,true);
  document.getElementById('sb-pdt').textContent=fmt(n,'America/Los_Angeles',true);
  document.getElementById('sb-edt').textContent=fmt(n,'America/New_York',true);
  document.getElementById('sb-utc').textContent=fmt(n,'UTC',true);
  document.getElementById('ck-pst').textContent=fmt(n,'America/Los_Angeles');
  document.getElementById('ck-mst').textContent=fmt(n,'America/Denver');
  document.getElementById('ck-cst').textContent=fmt(n,'America/Chicago');
  document.getElementById('ck-est').textContent=fmt(n,'America/New_York');
  document.getElementById('ck-lon').textContent=fmt(n,'Europe/London');
  document.getElementById('ck-utc').textContent=fmt(n,'UTC');
}

/* ── WEATHER ── */
const WX={0:'Clear ☀',1:'Mainly Clear 🌤',2:'Partly Cloudy ⛅',3:'Overcast ☁',45:'Foggy 🌫',48:'Foggy 🌫',51:'Drizzle 🌦',53:'Drizzle 🌧',55:'Drizzle 🌧',61:'Light Rain 🌦',63:'Rain 🌧',65:'Heavy Rain 🌧',71:'Light Snow 🌨',73:'Snow ❄',75:'Heavy Snow ❄',80:'Showers 🌦',81:'Showers 🌧',82:'Heavy Showers ⛈',95:'Thunderstorm ⛈',96:'Thunderstorm ⛈',99:'Thunderstorm ⛈'};
function fcIcon(c){if(c===0)return'☀️';if(c<=2)return'⛅';if(c===3)return'☁️';if(c<=48)return'🌫️';if(c<=55)return'🌦️';if(c<=65)return'🌧️';if(c<=75)return'❄️';if(c<=82)return'🌧️';return'⛈️';}
/* ── GOES Satellite & SPC Outlook switchers ── */
let goesSector = 'CONUS';
let goesProduct = 'GEOCOLOR';

function goesURL(){
  // URL structure differs: CONUS, Full Disk (FD), and named SECTORs
  const sizes = {
    'CONUS': '1250x750',
    'FD':    '1808x1808',
    'psw':   '1200x1200',
    'wus':   '1200x1200'
  };
  const size = sizes[goesSector] || '1200x1200';
  if (goesSector === 'CONUS')
    return `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/${goesProduct}/${size}.jpg`;
  if (goesSector === 'FD')
    return `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/FD/${goesProduct}/${size}.jpg`;
  return `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/${goesSector}/${goesProduct}/${size}.jpg`;
}

function refreshGoes(){
  const img=document.getElementById('goes-img');
  if(!img)return;
  img.style.display='block';
  if(img.nextElementSibling)img.nextElementSibling.style.display='none';
  img.src=goesURL();
}

function setGoesSector(sector, btn){
  goesSector = sector;
  document.querySelectorAll('#goes-sector-bar .gpill').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  refreshGoes();
}

function setGoesProduct(prod, btn){
  goesProduct = prod;
  document.querySelectorAll('#goes-product-bar .gpill').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  refreshGoes();
}

function setSpcDay(day, btn){
  document.querySelectorAll('#spc-day-bar .gpill').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const img=document.getElementById('spc-img');
  if(!img)return;
  img.style.display='block';
  if(img.nextElementSibling)img.nextElementSibling.style.display='none';
  img.src=`https://www.spc.noaa.gov/products/outlook/${day}otlk.gif`;
}

function setSpcFire(btn){
  document.querySelectorAll('#spc-day-bar .gpill').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const img=document.getElementById('spc-img');
  if(!img)return;
  img.style.display='block';
  if(img.nextElementSibling)img.nextElementSibling.style.display='none';
  img.src=`https://www.spc.noaa.gov/products/fire_wx/day1fw.gif`;
}

// Auto-refresh satellite & outlook every 10 min when weather tab active
setInterval(()=>{
  const wp=document.getElementById('panel-weather');
  if(wp && wp.classList.contains('active')){
    ['goes-img','spc-img'].forEach(id=>{
      const im=document.getElementById(id);
      if(im && im.style.display!=='none'){
        const base=im.src.split('?')[0];
        im.src=base+'?_='+Date.now();
      }
    });
  }
}, 10*60*1000);

/* ── WEATHER LOCATION (adjustable for travel) ── */
let WX_LAT = 33.7175, WX_LON = -117.8311, WX_NAME = 'Orange County, CA';

function wxSetLocation(lat, lon, name){
  WX_LAT = lat; WX_LON = lon; WX_NAME = name;
  const nameEl = document.getElementById('wx-loc-name');
  if (nameEl) nameEl.textContent = name;
  // Re-point the Windy radar embed
  const frame = document.getElementById('wx-radar-frame');
  if (frame) frame.src = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=in&metricTemp=°F&metricWind=mph&zoom=7&overlay=radar&product=radar&level=surface&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&detailLat=${lat.toFixed(2)}&detailLon=${lon.toFixed(2)}&marker=true&message=true`;
  loadWeather();
}

async function wxSearchLocation(){
  const input = document.getElementById('wx-loc-input');
  const q = (input?.value || '').trim();
  if (!q) return;
  try{
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
    const d = await r.json();
    const hit = d.results?.[0];
    if (!hit){ input.value = ''; input.placeholder = 'Not found — try again'; return; }
    const label = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ');
    wxSetLocation(hit.latitude, hit.longitude, label);
    input.value = '';
    input.placeholder = 'Search city… (e.g. Las Vegas)';
  }catch(e){ console.log('[WX] geocode error:', e.message); }
}

function wxUseMyLocation(){
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => wxSetLocation(pos.coords.latitude, pos.coords.longitude, 'Current Location'),
    err => console.log('[WX] geolocation denied/failed:', err.message),
    { enableHighAccuracy:false, timeout:12000, maximumAge:300000 }
  );
}

async function loadWeather(){
  try{
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${WX_LAT}&longitude=${WX_LON}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,visibility,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,precipitation_sum&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7`);
    const d=await r.json();const c=d.current;
    const t=Math.round(c.temperature_2m),f=Math.round(c.apparent_temperature),h=c.relative_humidity_2m,w=Math.round(c.wind_speed_10m),vis=c.visibility?(c.visibility/1000).toFixed(1)+' mi':'--',desc=WX[c.weather_code]||'Unknown';
    document.getElementById('sb-wx').textContent=t+'°F · '+desc.split(' ')[0];
    document.getElementById('wx-temp').textContent=t+'°F';document.getElementById('wx-feels').textContent=f+'°F';
    document.getElementById('wx-humid').textContent=h+'%';document.getElementById('wx-wind').textContent=w+' mph';
    document.getElementById('wx-vis').textContent=vis;document.getElementById('wx-desc').textContent=desc;
    if(d.daily){
      const row=document.getElementById('frow');row.innerHTML='';
      const dn=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      d.daily.time.forEach((ds,i)=>{
        const day=new Date(ds+'T12:00:00');
        const el=document.createElement('div');el.className='fcd';
        const pop  = d.daily.precipitation_probability_max?.[i];
        const wind = d.daily.wind_speed_10m_max?.[i];
        const gust = d.daily.wind_gusts_10m_max?.[i];
        const uv   = d.daily.uv_index_max?.[i];
        const precip = d.daily.precipitation_sum?.[i];
        const uvLabel = uv==null?'':uv<3?'Low':uv<6?'Mod':uv<8?'High':uv<11?'V.High':'Extreme';
        const uvColor = uv==null?'var(--muted)':uv<3?'#00e060':uv<6?'#ffb700':uv<8?'#ff8c00':'#ff3b30';
        el.innerHTML=`
          <div class="fn">${i===0?'Today':dn[day.getDay()]}</div>
          <div class="fi">${fcIcon(d.daily.weather_code[i])}</div>
          <div class="ftemp"><span class="fhi">${Math.round(d.daily.temperature_2m_max[i])}°</span><span class="flo">${Math.round(d.daily.temperature_2m_min[i])}°</span></div>
          <div class="fdet">
            <div class="fdrow"><span>💧 Rain</span><span>${pop!=null?pop+'%':'--'}</span></div>
            <div class="fdrow"><span>🌬 Wind</span><span>${wind!=null?Math.round(wind)+' mph':'--'}</span></div>
            ${gust!=null&&gust>=25?`<div class="fdrow"><span>💨 Gust</span><span>${Math.round(gust)} mph</span></div>`:''}
            <div class="fdrow"><span>☀ UV</span><span style="color:${uvColor}">${uv!=null?Math.round(uv)+' '+uvLabel:'--'}</span></div>
            ${precip!=null&&precip>0?`<div class="fdrow"><span>🌧 Total</span><span>${precip.toFixed(2)}"</span></div>`:''}
          </div>`;
        row.appendChild(el);
      });
    }
    // Sunrise/sunset for the selected location (Open-Meteo returns these in the
    // location's own timezone thanks to timezone=auto — no conversion needed)
    if(d.daily?.sunrise?.[0] && d.daily?.sunset?.[0]){
      const t12=s=>{const[h,m]=s.split('T')[1].split(':');const hr=+h;return `${((hr+11)%12)+1}:${m} ${hr>=12?'PM':'AM'}`;};
      const sr=document.getElementById('wx-sunrise'), ss=document.getElementById('wx-sunset');
      if(sr)sr.textContent=t12(d.daily.sunrise[0]);
      if(ss)ss.textContent=t12(d.daily.sunset[0]);
    }
    markHealth('Weather (Open-Meteo)', true);
  }catch(e){markHealth('Weather (Open-Meteo)', false, e.message);document.getElementById('sb-wx').textContent='Unavailable';}
}

/* ── NWS ALERTS ── */
async function loadNWS(){
  ['nws-alerts','wx-alerts'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<div class="loader">Loading…</div>';});
  try{
    const r=await fetch('https://api.weather.gov/alerts/active?area=CA');
    const d=await r.json();
    const feats=(d.features||[]).filter(f=>{
      const z=f.properties.affectedZones||[];
      return z.some(z=>z.includes('CAZ')&&['040','041','042','043','044','045'].some(n=>z.includes(n)));
    });
    const badge=document.getElementById('alert-badge'),sbw=document.getElementById('sb-alrt');
    if(feats.length){badge.style.display='inline';badge.textContent=feats.length;sbw.style.display='flex';document.getElementById('sb-alrt-txt').textContent=feats[0].properties.event;}
    else{badge.style.display='none';sbw.style.display='none';}
    ['nws-alerts','wx-alerts'].forEach(id=>{
      const el=document.getElementById(id);if(!el)return;
      if(!feats.length){el.innerHTML='<div class="empty">✅ No active NWS alerts for Orange County</div>';return;}
      el.innerHTML='';
      feats.slice(0,6).forEach(f=>{
        const p=f.properties;const div=document.createElement('div');
        div.className='ait'+(p.severity==='Extreme'||p.severity==='Severe'?' sev':'');
        div.innerHTML=`<div class="atit">${p.event}</div><div class="amet">${p.areaDesc||''} · ${p.expires?new Date(p.expires).toLocaleString():'--'}</div>`;
        el.appendChild(div);
      });
    });
    markHealth('NWS Alerts', true);
  }catch(e){markHealth('NWS Alerts', false, e.message);['nws-alerts','wx-alerts'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<div class="empty">⚠ Unable to load. <a href="https://alerts.weather.gov/" target="_blank" style="color:var(--accent)">Check manually →</a></div>';});}
}

/* ── LOCAL NEWS ── */
const LOCAL_FEEDS=[
  {n:'OC Register',  u:'https://www.ocregister.com/feed/'},
  {n:'Voice of OC',  u:'https://voiceofoc.org/feed/'},
  {n:'ABC7 LA',      u:'https://abc7.com/feed/'},
  {n:'LA Times CA',  u:'https://www.latimes.com/local/rss2.0.xml'},
  {n:'KTLA',         u:'https://ktla.com/feed/'},
  {n:'LAist',        u:'https://laist.com/index.rss'},
];
async function loadLocalNews(){
  const el=document.getElementById('local-feed');el.innerHTML='<div class="loader">Fetching…</div>';
  const items=[];
  for(const f of LOCAL_FEEDS){
    try{
      const xml=new DOMParser().parseFromString(await proxyFetchText(f.u),'text/xml');
      Array.from(xml.querySelectorAll('item')).slice(0,4).forEach(it=>{
        items.push({src:f.n,title:it.querySelector('title')?.textContent||'',link:it.querySelector('link')?.textContent||'#',pub:it.querySelector('pubDate')?.textContent||''});
      });
    }catch(e){}
  }
  items.sort((a,b)=>new Date(b.pub)-new Date(a.pub));
  if(!items.length){el.innerHTML='<div class="loader">Unable to load feeds.</div>';return;}
  el.innerHTML='';
  items.forEach(it=>{
    const a=document.createElement('a');a.className='ni';a.href=it.link;a.target='_blank';a.rel='noopener noreferrer';
    a.innerHTML=`<div class="src">${it.src}</div><div class="ttl">${it.title}</div><div class="ts">${it.pub?timeAgo(new Date(it.pub)):''}</div>`;
    el.appendChild(a);
  });
}

/* ── AI NEWS DIGEST ── */
async function fetchAIDigest() {
  const digestEl = document.getElementById('ai-digest-text');
  const tsEl = document.getElementById('digest-timestamp');
  if (!digestEl) return;

  digestEl.innerHTML = '<span style="color:var(--muted);font-style:italic">Generating intelligence digest…</span>';

  // Pull headlines straight from the columns already rendered/loaded
  const headlines = [];
  document.querySelectorAll('#col-politics .ttl2, #col-world .ttl2, #col-imm .ttl2').forEach(el => {
    const t = el.textContent.trim();
    if (t.length > 8) headlines.push(t);
  });

  if (headlines.length < 3) {
    digestEl.innerHTML = '<span style="color:var(--muted)">Waiting for news feeds to finish loading — try refreshing in a moment.</span>';
    return;
  }

  try {
    const res = await fetch('https://oc-radar-proxy.ocscannernews.workers.dev/ai-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headlines })
    });
    const data = await res.json();

    if (data.digest) {
      markHealth('AI Digest (Worker)', true);
      digestEl.textContent = data.digest;
      digestEl.style.fontStyle = 'normal';
      digestEl.style.color = 'var(--text2)';
      if (tsEl) tsEl.textContent = 'Updated ' + new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    } else {
      digestEl.innerHTML = `<span style="color:var(--danger)">Digest unavailable${data.error ? ': ' + data.error : ''}.</span>`;
    }
  } catch (e) {
    digestEl.innerHTML = '<span style="color:var(--danger)">Error reaching AI service.</span>';
    console.log('[AI Digest] Error:', e.message);
  }
}

/* ── NEWS COLUMNS ── */
const NEWS_SOURCES={
  politics:[
    {n:'Fox Politics',     c:'src-fox',   u:'https://moxie.foxnews.com/google-publisher/politics.xml'},
    {n:'Washington Times', c:'src-fox',   u:'https://www.washingtontimes.com/rss/headlines/news/'},
    {n:'Breitbart',        c:'src-breit', u:'https://www.breitbart.com/feed/'},
    {n:'Daily Wire',       c:'src-breit', u:'https://www.dailywire.com/feeds/rss.xml'},
    {n:'National Review',  c:'src-wash',  u:'https://www.nationalreview.com/feed/'},
    {n:'Washington Examiner',c:'src-wash',u:'https://www.washingtonexaminer.com/feed'},
    {n:'The Federalist',   c:'src-breit', u:'https://thefederalist.com/feed/'},
    {n:'Free Beacon',      c:'src-wash',  u:'https://freebeacon.com/feed/'},
    {n:'NY Post',          c:'src-fox',   u:'https://nypost.com/politics/feed/'},
    {n:'RealClearPolitics',c:'src-hill',  u:'https://www.realclearpolitics.com/index.xml'},
    {n:'The Hill',         c:'src-hill',  u:'https://thehill.com/feed'},
    {n:'Just the News',    c:'src-just',  u:'https://justthenews.com/feeds/all-stories'},
    {n:'Politico',         c:'src-hill',  u:'https://rss.politico.com/politics-news.xml'},
    {n:'AP Politics',      c:'src-ap',    u:'https://feeds.npr.org/1014/rss.xml'},
  ],
  world:[
    {n:'Breaking Defense', c:'src-def',   u:'https://breakingdefense.com/feed/'},
    {n:'Military Times',   c:'src-mil',   u:'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml'},
    {n:'Defense News',     c:'src-def',   u:'https://www.defensenews.com/arc/outboundfeeds/rss/'},
    {n:'The War Zone',     c:'src-mil',   u:'https://www.twz.com/feed'},
    {n:'War on the Rocks', c:'src-def',   u:'https://warontherocks.com/feed/'},
    {n:'Stars & Stripes',  c:'src-mil',   u:'https://www.stripes.com/arcio/rss/'},
    {n:'Foreign Policy',   c:'src-def',   u:'https://foreignpolicy.com/feed/'},
    {n:'Al Jazeera',       c:'src-ap',    u:'https://www.aljazeera.com/xml/rss/all.xml'},
    {n:'UPI World',        c:'src-ap',    u:'https://rss.upi.com/news/tn_int.rss'},
    {n:'NPR World',        c:'src-ap',    u:'https://feeds.npr.org/1004/rss.xml'},
    {n:'DoD News',         c:'src-def',   u:'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=20'},
  ],
  immigration:[
    {n:'Breitbart Border', c:'src-breit', u:'https://www.breitbart.com/immigration/feed/'},
    {n:'Washington Times', c:'src-fox',   u:'https://www.washingtontimes.com/rss/headlines/news/immigration/'},
    {n:'NY Post',          c:'src-fox',   u:'https://nypost.com/tag/immigration/feed/'},
    {n:'Washington Examiner',c:'src-wash',u:'https://www.washingtonexaminer.com/feed'},
    {n:'Just the News',    c:'src-just',  u:'https://justthenews.com/feeds/all-stories'},
    {n:'DHS News',         c:'src-ap',    u:'https://www.dhs.gov/dhs-articles/rss.xml'},
    {n:'ICE Releases',     c:'src-ap',    u:'https://www.ice.gov/news/rss'},
    {n:'CBP Newsroom',     c:'src-ap',    u:'https://www.cbp.gov/newsroom/rss/national-news.xml'},
    {n:'NPR National',     c:'src-ap',    u:'https://feeds.npr.org/1003/rss.xml'},
  ]
};
const POL_KW=['trump','biden','congress','senate','house','republican','democrat','gop','white house','legislation','vote','election','president','political','bill','scotus','supreme court','tariff','maga'];
const WRL_KW=['ukraine','russia','israel','hamas','china','iran','military','nato','war','troops','missile','conflict','attack','strike','defense','pentagon','diplomat','taiwan','north korea','syria'];
const IMM_KW=['border','immigration','migrant','asylum','dhs','cbp','ice','deporta','visa','illegal','undocumented','border patrol','cartel','smuggling','refugee','sanctuary','fentanyl'];

function matchKW(text,kws){const t=text.toLowerCase();return kws.some(k=>t.includes(k));}
/* ── RESILIENT FEED PROXY ──
   Tries multiple proxies in order so one being down doesn't kill all feeds.
   Returns the raw feed text (XML), or '' on total failure. */
const FEED_PROXIES = [
  u => `https://oc-radar-proxy.ocscannernews.workers.dev/rss?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

async function proxyFetchText(url){
  for(const make of FEED_PROXIES){
    const proxied = make(url);
    try{
      const r = await fetch(proxied, { signal:(()=>{const c=new AbortController();setTimeout(()=>c.abort(),9000);return c.signal;})() });
      if(!r.ok) continue;
      // worker + allorigins return JSON {contents}; corsproxy returns raw text
      if(proxied.includes('/rss?') || proxied.includes('allorigins')){
        const j = await r.json();
        const text = j.contents || '';
        if(text && text.length > 40) return text;
      } else {
        const text = await r.text();
        if(text && text.length > 40) return text;
      }
    }catch(e){ /* try next proxy */ }
  }
  return '';
}

async function fetchFeed(url){
  try{
    const text = await proxyFetchText(url);
    if(!text) return [];
    return Array.from(new DOMParser().parseFromString(text,'text/xml').querySelectorAll('item, entry')).slice(0,8);
  }catch(e){return[];}
}
async function loadNewsColumns(){
  const all=[];const seen=new Set();
  const allSrcs=[...NEWS_SOURCES.politics,...NEWS_SOURCES.world,...NEWS_SOURCES.immigration];
  await Promise.allSettled(allSrcs.map(async src=>{
    const items=await fetchFeed(src.u);
    items.forEach(it=>{
      const title=it.querySelector('title')?.textContent||'';
      const link=it.querySelector('link')?.textContent||'#';
      const pub=it.querySelector('pubDate')?.textContent||'';
      const key=title.slice(0,50);if(seen.has(key))return;seen.add(key);
      all.push({src:src.n,cls:src.c,title,link,pub:pub?new Date(pub):new Date(0)});
    });
  }));
  all.sort((a,b)=>b.pub-a.pub);
  const cols={politics:[],world:[],immigration:[]};
  all.forEach(it=>{
    if(cols.politics.length<14&&matchKW(it.title,POL_KW))cols.politics.push(it);
    if(cols.world.length<14&&matchKW(it.title,WRL_KW))cols.world.push(it);
    if(cols.immigration.length<14&&matchKW(it.title,IMM_KW))cols.immigration.push(it);
  });
  // Fallback fill from dedicated sources if sparse
  for(const [cat,kws] of Object.entries({politics:POL_KW,world:WRL_KW,immigration:IMM_KW})){
    if(cols[cat].length>=5)continue;
    for(const src of NEWS_SOURCES[cat]){
      if(cols[cat].length>=8)break;
      const items=await fetchFeed(src.u);
      items.forEach(it=>{
        const title=it.querySelector('title')?.textContent||'';
        const link=it.querySelector('link')?.textContent||'#';
        const pub=it.querySelector('pubDate')?.textContent||'';
        const key=title.slice(0,50);if(seen.has(key))return;seen.add(key);
        cols[cat].push({src:src.n,cls:src.c,title,link,pub:pub?new Date(pub):new Date(0)});
      });
    }
  }
  const colMap={politics:'col-politics',world:'col-world',immigration:'col-imm'};
  const cntMap={politics:'pol-cnt',world:'wrld-cnt',immigration:'imm-cnt'};
  Object.entries(colMap).forEach(([cat,colId])=>{
    const el=document.getElementById(colId);
    const cnt=document.getElementById(cntMap[cat]);
    if(cnt)cnt.textContent=cols[cat].length+' stories';
    if(!cols[cat].length){el.innerHTML='<div class="loader">No stories loaded.</div>';return;}
    el.innerHTML='';
    cols[cat].forEach(it=>{
      const a=document.createElement('a');a.className='ni-sm';a.href=it.link;a.target='_blank';a.rel='noopener noreferrer';
      a.innerHTML=`<div class="src2 ${it.cls}">${it.src}</div><div class="ttl2">${it.title}</div><div class="ts2">${timeAgo(it.pub)}</div>`;
      el.appendChild(a);
    });
  });
  if(cols.politics.length)document.getElementById('ticker-text').textContent=cols.politics[0].title;
  document.getElementById('news-badge').style.display='inline';
  markHealth('News Feeds (RSS)', document.querySelectorAll('#panel-news .ni-sm').length > 0);
}

/* ── QUAKES ── */
async function loadQuakes(){
  const el=document.getElementById('quake-feed');
  try{
    const r=await fetch('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&orderby=time&limit=8&maxradiuskm=200&latitude=33.7&longitude=-117.8');
    const d=await r.json();el.innerHTML='';
    const f=d.features||[];
    if(!f.length){el.innerHTML='<div class="empty">No M2.5+ quakes near OC (24h)</div>';return;}
    f.forEach(feat=>{
      const p=feat.properties;const div=document.createElement('div');
      div.className='iit'+(p.mag>=4?' fire':'');
      div.innerHTML=`<div class="itype">M${p.mag.toFixed(1)}</div><div class="itit">${p.place||'Unknown'}</div><div class="imet">${timeAgo(new Date(p.time))}</div>`;
      el.appendChild(div);
    });
  }catch(e){el.innerHTML='<div class="loader">Unable to load USGS data.</div>';}
}

/* ── FIRES ── */
async function loadFires(){
  const el=document.getElementById('fire-feed');
  const FIRE_FEEDS=[
    'https://www.fire.ca.gov/api/rss/incidents',          // CAL FIRE active incidents (CA-specific)
    'https://inciweb.nwcg.gov/feeds/rss/incidents/',      // InciWeb nationwide
  ];
  const items=[];const seen=new Set();
  for(const url of FIRE_FEEDS){
    try{
      const xml=new DOMParser().parseFromString(await proxyFetchText(url),'text/xml');
      Array.from(xml.querySelectorAll('item')).slice(0,8).forEach(it=>{
        const title=it.querySelector('title')?.textContent||'Incident';
        const link=it.querySelector('link')?.textContent||'#';
        const pub=it.querySelector('pubDate')?.textContent||'';
        const key=title.slice(0,40);if(seen.has(key))return;seen.add(key);
        // Prioritize CA-relevant incidents
        const isCA=/calif|ca |, ca|socal|orange|los angeles|riverside|san bernardino|san diego|ventura/i.test(title);
        items.push({title,link,pub:pub?new Date(pub):new Date(0),isCA});
      });
    }catch(e){}
  }
  // CA fires first, then by recency
  items.sort((a,b)=>(b.isCA-a.isCA)||(b.pub-a.pub));
  el.innerHTML='';
  if(!items.length){el.innerHTML='<div class="empty">No active fire incidents.</div>';return;}
  items.slice(0,8).forEach(it=>{
    const div=document.createElement('div');div.className='iit fire';
    div.innerHTML=`<div class="itype">🔥 FIRE${it.isCA?' · CA':''}</div><div class="itit" style="cursor:pointer" onclick="window.open('${it.link}','_blank')">${it.title}</div><div class="imet">${it.pub&&it.pub.getTime()>0?timeAgo(it.pub):''}</div>`;
    el.appendChild(div);
  });
}

/* ── FEMA ── */
async function loadFEMA(){
  const el=document.getElementById('fema-feed');
  try{
    const femaUrl='https://www.fema.gov/api/open/v2/disasterDeclarationsSummaries?$filter=state%20eq%20%27CA%27&$orderby=declarationDate%20desc&$top=5&$format=json';
    const r=await fetch(femaUrl,{signal:(() => { const _c = new AbortController(); setTimeout(() => _c.abort(), 8000); return _c.signal; })()});
    const d=await r.json();
    const items=d.DisasterDeclarationsSummaries||[];el.innerHTML='';
    if(!items.length){el.innerHTML='<div class="empty">No recent CA declarations.</div>';return;}
    items.forEach(it=>{
      const div=document.createElement('div');div.className='iit';
      div.innerHTML=`<div class="itype">FEMA DR-${it.disasterNumber}</div><div class="itit">${it.declarationTitle}</div><div class="imet">${it.designatedArea||'CA'} · ${it.declarationDate?new Date(it.declarationDate).toLocaleDateString():''}</div>`;
      el.appendChild(div);
    });
  }catch(e){el.innerHTML='<div class="loader">Unable to load FEMA data. <a href="https://www.fema.gov/disasters" target="_blank" style="color:var(--accent)">Check FEMA →</a></div>';}
}

/* ── AIRPORTS ── */
async function loadAirports(){
  // FAA blocks browser CORS — one worker call covers all airports, no console noise
  const codes = ['LAX','SNA','LGB','ONT','SAN'];
  try{
    const r = await fetch(`https://oc-radar-proxy.ocscannernews.workers.dev/airports?codes=${codes.join(',')}`);
    if(!r.ok) throw new Error('HTTP '+r.status);
    const d = await r.json();
    markHealth('Airports (FAA)', true);
    codes.forEach(code=>{
      const el=document.getElementById('ap-'+code.toLowerCase());if(!el)return;
      const info=d[code];
      if(info && info.ok){
        el.textContent=info.delays?'⚠ Delays':'✅ No Delays';
        el.className='astat '+(info.delays?'adly':'aok');
      }else{
        el.textContent='— Check FAA';
        el.className='astat';
      }
    });
  }catch(e){
    markHealth('Airports (FAA)', false, e.message);
    codes.forEach(code=>{
      const el=document.getElementById('ap-'+code.toLowerCase());
      if(el){el.textContent='— Check FAA';el.className='astat';}
    });
  }
}

/* ── ELECTION NEWS ── */
const ELECTION_FEEDS=[
  {n:'Fox Politics',   c:'src-fox',   u:'https://moxie.foxnews.com/google-publisher/politics.xml'},
  {n:'Breitbart',      c:'src-breit', u:'https://www.breitbart.com/feed/'},
  {n:'Politico',       c:'src-hill',  u:'https://rss.politico.com/politics-news.xml'},
  {n:'The Hill',       c:'src-hill',  u:'https://thehill.com/feed'},
  {n:'Wash. Examiner', c:'src-wash',  u:'https://www.washingtonexaminer.com/feed'},
  {n:'National Review',c:'src-wash',  u:'https://www.nationalreview.com/feed/'},
  {n:'The Federalist', c:'src-breit', u:'https://thefederalist.com/feed/'},
  {n:'RealClearPolitics',c:'src-hill',u:'https://www.realclearpolitics.com/index.xml'},
  {n:'Daily Wire',     c:'src-breit', u:'https://www.dailywire.com/feeds/rss.xml'},
  {n:'NY Post',        c:'src-fox',   u:'https://nypost.com/politics/feed/'},
  {n:'Just the News',  c:'src-just',  u:'https://justthenews.com/feeds/all-stories'},
  {n:'Free Beacon',    c:'src-wash',  u:'https://freebeacon.com/feed/'},
  {n:'AP Politics',    c:'src-ap',    u:'https://feeds.npr.org/1014/rss.xml'},
  {n:'NPR Politics',   c:'src-ap',    u:'https://feeds.npr.org/1012/rss.xml'},
];
const ELECTION_KW=['election','vote','ballot','primary','candidate','campaign','poll','senate','house','congress','gop','democrat','republican','trump','2026','2028','race','district','runoff','caucus','delegate','electoral','fec','donor','fundrais'];

const MILITARY_FEEDS=[
  {n:'Breaking Defense', c:'src-def',  u:'https://breakingdefense.com/feed/'},
  {n:'Defense News',     c:'src-def',  u:'https://www.defensenews.com/arc/outboundfeeds/rss/'},
  {n:'The War Zone',     c:'src-mil',  u:'https://www.twz.com/feed'},
  {n:'Military Times',   c:'src-mil',  u:'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml'},
  {n:'USNI News',        c:'src-def',  u:'https://news.usni.org/feed'},
  {n:'War on the Rocks', c:'src-def',  u:'https://warontherocks.com/feed/'},
  {n:'Naval News',       c:'src-mil',  u:'https://www.navalnews.com/feed/'},
  {n:'Stars & Stripes',  c:'src-mil',  u:'https://www.stripes.com/arcio/rss/'},
  {n:'DoW News',         c:'src-ap',   u:'https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=20'},
  {n:'Defense One',      c:'src-def',  u:'https://www.defenseone.com/rss/all/'},
];

/* ── LIVE MILITARY AIRCRAFT MAP ── */
let milAirMap = null, milAirLayer = null, milAirRegion = 'socal';
let milAirInited = false;

const MILAIR_REGIONS = {
  socal: { lat:33.8, lon:-118.0, zoom:7, bounds:{latMin:31.5, latMax:36.5, lonMin:-121.5, lonMax:-113.5} },
  west:  { lat:39.0, lon:-115.0, zoom:5, bounds:{latMin:30.0, latMax:49.5, lonMin:-125.5, lonMax:-100.0} },
  conus: { lat:39.5, lon:-98.0,  zoom:4, bounds:{latMin:24.0, latMax:50.0, lonMin:-125.5, lonMax:-66.0} },
};

function initMilAirMap(){
  if (milAirInited || typeof L === 'undefined') return;
  const r = MILAIR_REGIONS[milAirRegion];
  milAirMap = L.map('milair-map', { zoomControl:true, attributionControl:false }).setView([r.lat, r.lon], r.zoom);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 12, subdomains:'abcd'
  }).addTo(milAirMap);
  milAirLayer = L.layerGroup().addTo(milAirMap);
  milAirInited = true;
  loadMilAir();
}

function setMilAirRegion(region, btn){
  milAirRegion = region;
  if (btn){ btn.parentElement.querySelectorAll('.gpill').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }
  const r = MILAIR_REGIONS[region];
  if (milAirMap) milAirMap.setView([r.lat, r.lon], r.zoom);
  loadMilAir();
}

async function loadMilAir(){
  if (!milAirMap || !milAirLayer) return;
  const r = MILAIR_REGIONS[milAirRegion];
  const statusEl = document.getElementById('milair-status');
  const countEl  = document.getElementById('milair-count');
  try{
    // Dedicated military endpoint: ALL military aircraft globally in one call.
    // The API does the military identification (dbFlags) — far more complete
    // than callsign/hex heuristics. We filter to the selected region here.
    const resp = await fetch('https://oc-radar-proxy.ocscannernews.workers.dev/mil');
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const data = await resp.json();
    const all = data.ac || [];
    const b = r.bounds;
    const inRegion = all.filter(ac => {
      const lat = ac.lat ?? ac.latitude, lon = ac.lon ?? ac.longitude;
      return lat != null && lon != null &&
             lat >= b.latMin && lat <= b.latMax &&
             lon >= b.lonMin && lon <= b.lonMax;
    });

    milAirLayer.clearLayers();
    inRegion.forEach(ac => {
      const lat = ac.lat ?? ac.latitude, lon = ac.lon ?? ac.longitude;
      const cs  = (ac.flight ?? ac.callsign ?? '').trim() || (ac.hex||'').toUpperCase();
      const alt = ac.alt_baro === 'ground' ? 'GROUND' : (ac.alt_baro ?? ac.alt ?? '--');
      const spd = ac.gs != null ? Math.round(ac.gs) : '--';
      const typ = ac.t ?? ac.type ?? '';
      const track = ac.track ?? ac.heading ?? 0;
      const onGround = ac.alt_baro === 'ground';
      const icon = L.divIcon({
        className: 'milair-icon',
        html: `<div style="transform:rotate(${track}deg);color:${onGround?'#8a2f2a':'#ff3b30'};font-size:16px;line-height:1;text-shadow:0 0 4px rgba(255,59,48,.7)">▲</div>`,
        iconSize: [16,16], iconAnchor:[8,8]
      });
      const m = L.marker([lat, lon], { icon }).addTo(milAirLayer);
      m.bindPopup(
        `<b style="color:#ff3b30">${cs}</b>${typ?` · <span style="color:#888">${typ}</span>`:''}<br>`+
        `Alt: ${typeof alt==='number'?alt.toLocaleString()+' ft':alt}<br>`+
        `Spd: ${spd} kt · Hdg: ${Math.round(track)}°<br>`+
        `Hex: ${ac.hex||'--'}${ac.r?` · Reg: ${ac.r}`:''}`
      );
    });

    if (countEl) countEl.textContent = `(${inRegion.length} in region · ${all.length} global)`;
    if (statusEl) statusEl.textContent = inRegion.length
      ? `${inRegion.length} military aircraft in view — click any marker for details`
      : `None over this region right now (${all.length} tracked globally — try CONUS)`;
    markHealth('Military Aircraft Map', true);
  }catch(e){
    if (statusEl) statusEl.textContent = 'Feed error — retrying next cycle';
    markHealth('Military Aircraft Map', false, e.message);
  }
}

/* ── NAVAL FLEET POSITION MAP ──
   Approximate carrier/ARG positions from public USNI Fleet Tracker reporting.
   Update these coordinates periodically from the latest USNI report. */
let fleetMap = null, fleetLayer = null, fleetInited = false;

// Positions from USNI Fleet & Marine Tracker, July 7, 2026 report.
// Update from https://news.usni.org/category/fleet-tracker (published weekly).
const FLEET_AS_OF = 'July 27, 2026 (+ Jul 30 update)';
const FLEET_POSITIONS = [
  // ── Deployed / underway ──
  { name:'USS George Washington (CVN-73)',   type:'CSG', status:'deployed', lat:16.05, lon:108.22, note:'Da Nang, Vietnam — port visit (first since 2023); CVW-5, CG-62, DDG-65, DDG-86' },
  { name:'USS Abraham Lincoln (CVN-72)',     type:'CSG', status:'deployed', lat:15.0,  lon:63.0,   note:'Arabian Sea — Operation Epic Fury (CSG-3, CVW-9)' },
  { name:'USS George H.W. Bush (CVN-77)',    type:'CSG', status:'deployed', lat:18.0,  lon:59.5,   note:'Arabian Sea — CSG-10, CVW-7 (dual-carrier ops)' },
  { name:'USS Theodore Roosevelt (CVN-71)',  type:'CSG', status:'deployed', lat:21.3,  lon:-158.0, note:'Off Pearl Harbor — RIMPAC 2026' },
  { name:'USS Dwight D. Eisenhower (CVN-69)',type:'CSG', status:'deployed', lat:34.5,  lon:-72.0,  note:'Western Atlantic — departed Norfolk' },
  { name:'Boxer ARG (LHD-4)',                type:'ARG', status:'deployed', lat:19.0,  lon:61.5,   note:'Arabian Sea — with LSD-45, LPD-27, 11th MEU' },
  { name:'USS Essex (LHD-2)',                type:'ARG', status:'deployed', lat:21.0,  lon:-157.6, note:'Hawaiian op areas — RIMPAC 2026' },
  { name:'USS San Antonio (LPD-17)',         type:'ARG', status:'deployed', lat:14.0,  lon:-70.0,  note:'Caribbean — with DDG-100; 24th MEU spread across region' },
  // ── Independent surface groups ──
  { name:'DDGs — Mediterranean',             type:'DDG', status:'deployed', lat:36.0,  lon:15.0,   note:'USS Roosevelt (DDG-80), USS Paul Ignatius (DDG-117) — Rota-based' },
  { name:'USS Gonzalez (DDG-66)',            type:'DDG', status:'deployed', lat:19.5,  lon:38.5,   note:'Red Sea — independently deployed' },
  { name:'DDGs — Indian Ocean',              type:'DDG', status:'deployed', lat:5.0,   lon:75.0,   note:'DDG-89, DDG-87, DDG-53' },
  { name:'LCS — South China Sea',            type:'DDG', status:'deployed', lat:12.0,  lon:114.0,  note:'USS Santa Barbara (LCS-32)' },
  // ── In port ──
  { name:'Tripoli ARG (LHA-7)',              type:'ARG', status:'inport',   lat:33.16, lon:129.72, note:'Returned Sasebo, Japan Jul 27 — 6-month 5th/7th Fleet patrol complete' },
  { name:'LCS — Singapore',                  type:'DDG', status:'inport',   lat:1.29,  lon:103.85, note:'USS Canberra (LCS-30), USS Tulsa (LCS-16)' },
];

function initFleetMap(){
  if (fleetInited || typeof L === 'undefined') return;
  fleetMap = L.map('fleet-map', { zoomControl:true, attributionControl:false, worldCopyJump:true }).setView([25, 20], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 8, subdomains:'abcd'
  }).addTo(fleetMap);
  fleetLayer = L.layerGroup().addTo(fleetMap);
  fleetInited = true;
  renderFleetMap();
}

function renderFleetMap(){
  if (!fleetMap || !fleetLayer) return;
  fleetLayer.clearLayers();
  FLEET_POSITIONS.forEach(v => {
    const deployed = v.status === 'deployed';
    const color = v.type === 'CSG' ? '#00b4ff' : v.type === 'ARG' ? '#ffb700' : '#00ff9d';
    const symbol = v.type === 'CSG' ? '▲' : v.type === 'ARG' ? '■' : '◆';
    const icon = L.divIcon({
      className:'fleet-icon',
      html:`<div style="color:${color};opacity:${deployed?1:.45};font-size:${deployed?15:12}px;line-height:1;${deployed?`text-shadow:0 0 5px ${color}`:''}">${symbol}</div>`,
      iconSize:[15,15], iconAnchor:[7,7]
    });
    L.marker([v.lat, v.lon], { icon }).addTo(fleetLayer)
      .bindPopup(`<b style="color:${color}">${v.name}</b><br>${v.type} · ${deployed?'<span style="color:#00ff9d">DEPLOYED</span>':'<span style="color:#888">IN PORT</span>'}<br>${v.note}`);
  });
  const cnt = FLEET_POSITIONS.filter(v=>v.status==='deployed').length;
  const el = document.getElementById('fleet-asof');
  if (el) el.textContent = `${cnt} groups deployed · USNI data as of ${FLEET_AS_OF}`;
  markHealth('Fleet Map (USNI)', true);
}

async function loadMilitaryNews(){
  const el=document.getElementById('military-news-feed');
  if(!el)return;
  el.innerHTML='<div class="loader">Loading defense news…</div>';
  const items=[];const seen=new Set();
  await Promise.allSettled(MILITARY_FEEDS.map(async f=>{
    try{
      const xml=new DOMParser().parseFromString(await proxyFetchText(f.u),'text/xml');
      Array.from(xml.querySelectorAll('item, entry')).slice(0,8).forEach(it=>{
        const title=it.querySelector('title')?.textContent||'';
        const link=it.querySelector('link')?.textContent||it.querySelector('link')?.getAttribute('href')||'#';
        const pub=it.querySelector('pubDate, published, updated')?.textContent||'';
        const key=title.slice(0,50);if(!title||seen.has(key))return;seen.add(key);
        items.push({src:f.n,cls:f.c,title,link,pub:pub?new Date(pub):new Date(0)});
      });
    }catch(e){}
  }));
  items.sort((a,b)=>b.pub-a.pub);
  markHealth('Defense News (RSS)', items.length>0);
  if(!items.length){el.innerHTML='<div class="loader">Defense news unavailable — try refreshing.</div>';return;}
  el.innerHTML='';
  items.slice(0,40).forEach(it=>{
    const a=document.createElement('a');a.className='ni-sm';a.href=it.link;a.target='_blank';a.rel='noopener noreferrer';
    a.innerHTML=`<div class="src2 ${it.cls}">${it.src}</div><div class="ttl2">${it.title}</div><div class="ts2">${it.pub.getTime()>0?timeAgo(it.pub):''}</div>`;
    el.appendChild(a);
  });
}

/* ── POTUS DAILY PUBLIC SCHEDULE (Roll Call / Factba.se JSON feed) ── */
const POTUS_FEED = 'https://media-cdn.factba.se/rss/json/trump/calendar-full.json';

function potusTypeStyle(type, details){
  const d = (details||'').toLowerCase();
  if (/press briefing|briefs reporters|press secretary/.test(d) || /briefing/i.test(type))
    return { color:'#00b4ff', label:'BRIEFING' };
  if (/full lid|lunch lid|dinner lid/.test(d))
    return { color:'#7a8a98', label:'LID' };
  if (/pool call time/.test(d))
    return { color:'#7a8a98', label:'POOL' };
  if (/departs|arrives|en route/.test(d))
    return { color:'#ffb700', label:'TRAVEL' };
  if (/remarks|speech|announcement|signs|signing|address/.test(d))
    return { color:'#00ff9d', label:'REMARKS' };
  if (/meets|bilateral|meeting|cabinet|roundtable/.test(d))
    return { color:'#af9bff', label:'MEETING' };
  if (/intelligence briefing/.test(d))
    return { color:'#ff6b4d', label:'INTEL' };
  return { color:'var(--muted)', label:'SCHEDULE' };
}

async function loadPotusSchedule(){
  const el = document.getElementById('potus-schedule');
  if (!el) return;
  try{
    // Route through the worker proxy (avoids CORS issues on the CDN)
    const raw = await proxyFetchText(POTUS_FEED);
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || !items.length) throw new Error('empty feed');

    // Group by date, newest first
    const byDate = {};
    items.forEach(it => { (byDate[it.date] = byDate[it.date] || []).push(it); });
    const dates = Object.keys(byDate).sort().reverse().slice(0, 5); // last 5 days

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone:'America/New_York' });
    el.innerHTML = '';

    dates.forEach(dateKey => {
      const evts = byDate[dateKey];
      const first = evts[0];
      const isToday = dateKey === todayStr;

      const hdr = document.createElement('div');
      hdr.style.cssText = 'position:sticky;top:0;background:var(--bg2);padding:7px 12px;border-bottom:1px solid var(--border2);z-index:2;display:flex;align-items:center;gap:8px';
      hdr.innerHTML = `<span style="font-family:var(--fh);font-weight:700;letter-spacing:.05em;color:${isToday?'var(--accent3)':'var(--text)'};font-size:.88rem">${first.day_of_week}, ${first.month} ${first.day}</span>`
        + (isToday ? '<span style="font-family:var(--fm);font-size:.6rem;background:rgba(0,255,157,.15);color:var(--accent3);padding:1px 7px;border-radius:3px">TODAY</span>' : '')
        + `<span style="margin-left:auto;font-family:var(--fm);font-size:.64rem;color:var(--muted)">${evts.length} items</span>`;
      el.appendChild(hdr);

      // Sort within day: timed events by time, TBD entries first
      evts.sort((a,b) => (a.time||'').localeCompare(b.time||''));

      evts.forEach(ev => {
        const st = potusTypeStyle(ev.type, ev.details);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);align-items:flex-start';
        const timeTxt = ev.time_formatted || 'TBD';
        const link = ev.url
          ? `<a href="${ev.url}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none"> · Transcript ↗</a>` : '';
        const vid = ev.video_url
          ? `<a href="${ev.video_url}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none"> · Video ↗</a>` : '';
        row.innerHTML = `
          <span style="font-family:var(--fm);font-size:.72rem;color:var(--text2);min-width:66px;flex-shrink:0;padding-top:1px">${timeTxt}</span>
          <span style="font-family:var(--fm);font-size:.56rem;letter-spacing:.06em;color:${st.color};border:1px solid ${st.color};padding:1px 5px;border-radius:3px;flex-shrink:0;margin-top:1px">${st.label}</span>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--fu);font-size:.9rem;color:var(--text);line-height:1.35">${ev.details||''}</div>
            <div style="font-family:var(--fm);font-size:.66rem;color:var(--muted);margin-top:2px">${ev.location||''}${ev.coverage?' · '+ev.coverage:''}${link}${vid}</div>
          </div>`;
        el.appendChild(row);
      });
    });

    const ts = document.getElementById('potus-updated');
    if (ts) ts.textContent = 'Updated ' + new Date().toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    markHealth('POTUS Schedule', true);
  }catch(e){
    el.innerHTML = '<div class="loader">Schedule unavailable — <a href="https://rollcall.com/factbase/trump/topic/calendar/" target="_blank" style="color:var(--accent)">view on Roll Call ↗</a></div>';
    markHealth('POTUS Schedule', false, e.message);
  }
}

async function loadElectionNews(){
  const el=document.getElementById('election-news-feed');
  el.innerHTML='<div class="loader">Loading election news…</div>';
  const items=[];const seen=new Set();
  await Promise.allSettled(ELECTION_FEEDS.map(async f=>{
    try{
      const xml=new DOMParser().parseFromString(await proxyFetchText(f.u),'text/xml');
      Array.from(xml.querySelectorAll('item')).slice(0,10).forEach(it=>{
        const title=it.querySelector('title')?.textContent||'';
        const link=it.querySelector('link')?.textContent||'#';
        const pub=it.querySelector('pubDate')?.textContent||'';
        const key=title.slice(0,50);if(seen.has(key))return;seen.add(key);
        if(ELECTION_KW.some(k=>title.toLowerCase().includes(k)))
          items.push({src:f.n,cls:f.c,title,link,pub:pub?new Date(pub):new Date(0)});
      });
    }catch(e){}
  }));
  items.sort((a,b)=>b.pub-a.pub);
  if(!items.length){el.innerHTML='<div class="loader">No election stories found — try refreshing.</div>';return;}
  el.innerHTML='';
  items.forEach(it=>{
    const a=document.createElement('a');a.className='ni-sm';a.href=it.link;a.target='_blank';a.rel='noopener noreferrer';
    a.innerHTML=`<div class="src2 ${it.cls}">${it.src}</div><div class="ttl2">${it.title}</div><div class="ts2">${timeAgo(it.pub)}</div>`;
    el.appendChild(a);
  });
}

/* Compute next major election */
function setNextElection(){
  const el=document.getElementById('next-election-date');if(!el)return;
  const now=new Date();
  const elections=[
    {label:'CA Primary — June 2026',   d:new Date('2026-06-02')},
    {label:'Midterms — Nov 4 2026',     d:new Date('2026-11-04')},
    {label:'Presidential Primary 2028', d:new Date('2028-03-07')},
    {label:'Presidential Election 2028',d:new Date('2028-11-07')},
  ];
  const next=elections.find(e=>e.d>now);
  if(!next){el.textContent='Check calendar';return;}
  const days=Math.ceil((next.d-now)/86400000);
  el.textContent=next.label+' ('+days+' days)';
}

/* ── MARKET TICKER ── */
const CRYPTO_IDS = 'bitcoin,dogecoin,ethereum,solana';
const STOCK_SYMBOLS = ['SPCX','TSLA','AAPL','NVDA','MSFT','META','JPM','XOM','SPY','GLD','SLV'];

// Labels for display
const SYMBOL_LABELS = {
  bitcoin:'BTC', dogecoin:'DOGE', ethereum:'ETH', solana:'SOL',
  SPCX:'SPACEX', TSLA:'TSLA', AAPL:'AAPL', NVDA:'NVDA', MSFT:'MSFT',
  META:'META', JPM:'JPM', XOM:'XOM', SPY:'S&P500', GLD:'GOLD', SLV:'SILVER'
};

function fmtPrice(p) {
  if (p >= 1000) return '$' + p.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  if (p >= 1) return '$' + p.toFixed(2);
  return '$' + p.toFixed(4);
}
function fmtChg(c) {
  const sign = c >= 0 ? '▲' : '▼';
  return sign + Math.abs(c).toFixed(2) + '%';
}
function chgClass(c) { return c > 0 ? 'up' : c < 0 ? 'dn' : 'flat'; }

function buildMarketItem(sym, price, chg) {
  const cls = chgClass(chg);
  return `<div class="mkt-item">
    <span class="mkt-sym">${sym}</span>
    <span class="mkt-price">${fmtPrice(price)}</span>
    <span class="mkt-chg ${cls}">${fmtChg(chg)}</span>
  </div>`;
}

async function loadMarketTicker() {
  const el = document.getElementById('market-inner');
  const items = [];

  // Crypto — CoinGecko free, no key needed
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO_IDS}&vs_currencies=usd&include_24hr_change=true`);
    const d = await r.json();
    for (const [id, data] of Object.entries(d)) {
      const sym = SYMBOL_LABELS[id] || id.toUpperCase();
      items.push({ sym, price: data.usd, chg: data.usd_24h_change || 0, order: 0 });
    }
  } catch(e) {}

  // Stocks — fetch each symbol via Yahoo Finance v8 through corsproxy
  const stockResults = await Promise.allSettled(
    STOCK_SYMBOLS.map(async sym => {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
      const raw = await proxyFetchText(url);
      const parsed = raw ? JSON.parse(raw) : null;
      const meta = parsed?.chart?.result?.[0]?.meta;
      if (!meta) return null;
      const price = meta.regularMarketPrice;
      const prev  = meta.previousClose || meta.chartPreviousClose;
      const chg   = prev ? ((price - prev) / prev) * 100 : 0;
      return { sym: SYMBOL_LABELS[sym] || sym, price, chg, order: 1 };
    })
  );
  stockResults.forEach(r => {
    if (r.status === 'fulfilled' && r.value) items.push(r.value);
  });

  if (!items.length) {
    el.innerHTML = '<span style="color:var(--muted);font-family:var(--fm);font-size:.78rem;padding:0 20px">Market data unavailable</span>';
    return;
  }

  // Sort: crypto first, then stocks
  items.sort((a,b) => a.order - b.order);
  const html = items.map(it => buildMarketItem(it.sym, it.price, it.chg)).join('');
  // Duplicate for seamless scroll
  el.innerHTML = html + html;
  markHealth('Markets (Yahoo/CoinGecko)', true);
}

/* ── STREAMS TICKER ── */
const TICKER_FEEDS = [
  {n:'Fox Politics',   u:'https://moxie.foxnews.com/google-publisher/politics.xml'},
  {n:'Breitbart',      u:'https://www.breitbart.com/feed/'},
  {n:'AP Politics',    u:'https://feeds.npr.org/1014/rss.xml'},
  {n:'The Hill',       u:'https://thehill.com/feed'},
  {n:'Al Jazeera',     u:'https://www.aljazeera.com/xml/rss/all.xml'},
  {n:'UPI World',      u:'https://rss.upi.com/news/tn_int.rss'},
  {n:'Wash. Examiner', u:'https://www.washingtonexaminer.com/feed'},
  {n:'Military Times', u:'https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml'},
  {n:'OC Register',    u:'https://www.ocregister.com/feed/'},
  {n:'Breitbart Border', u:'https://www.breitbart.com/immigration/feed/'},
  {n:'Just the News',  u:'https://justthenews.com/feeds/all-stories'},
];

async function loadTicker() {
  const items = [];
  const seen = new Set();
  await Promise.allSettled(TICKER_FEEDS.map(async f => {
    try {
      const xml = new DOMParser().parseFromString(await proxyFetchText(f.u),'text/xml');
      Array.from(xml.querySelectorAll('item')).slice(0, 6).forEach(it => {
        const title = it.querySelector('title')?.textContent?.trim() || '';
        const link  = it.querySelector('link')?.textContent?.trim() || '#';
        const pub   = it.querySelector('pubDate')?.textContent || '';
        const key   = title.slice(0, 50);
        if (!title || seen.has(key)) return;
        seen.add(key);
        items.push({ src: f.n, title, link, pub: pub ? new Date(pub) : new Date(0) });
      });
    } catch(e) {}
  }));

  items.sort((a, b) => b.pub - a.pub);
  if (!items.length) return;

  // Build ticker — duplicate items for seamless loop
  const inner = document.getElementById('ticker-inner');
  if (!inner) return;

  const buildItems = () => items.map(it =>
    `<a class="ticker-item" href="${it.link}" target="_blank" rel="noopener">
      <span class="tsrc">${it.src}</span>
      <span class="tsep">▸</span>
      <span>${it.title}</span>
    </a><span class="ticker-sep">◆</span>`
  ).join('');

  // Duplicate for seamless infinite scroll
  inner.innerHTML = buildItems() + buildItems();

  // Adjust animation speed based on content width
  const totalWidth = inner.scrollWidth / 2;
  const speed = Math.max(120, totalWidth / 30); // ~30px per second — readable pace
  inner.style.animationDuration = speed + 's';
  markHealth('Headline Ticker', true);
}

/* ══════════════════════════════════════
   RADAR ENGINE
══════════════════════════════════════ */
const RADAR_RADIUS = 25; // miles

// Static default coordinates — OC Scanner home base
let RADAR_LAT = 33.832721;
let RADAR_LON = -118.022520;
let RADAR_LOCATION_NAME = 'OC, CA';

function getRadarAPIs() {
  // Call ADS-B feeds DIRECTLY from the browser (residential IP isn't blocked
  // the way our Cloudflare Worker's datacenter IP is). Order matters: try the
  // networks with the best Southern California feeder coverage first.
  // airplanes.live has strong SoCal coverage and only blocked our *worker's*
  // datacenter IP — from a browser it works. adsb.lol/one are backups, and the
  // worker proxy is the final fallback for any CORS failures.
  return [
    `https://api.airplanes.live/v2/point/${RADAR_LAT}/${RADAR_LON}/${RADAR_RADIUS}`,
    `https://api.adsb.lol/v2/lat/${RADAR_LAT}/lon/${RADAR_LON}/dist/${RADAR_RADIUS}`,
    `https://api.adsb.one/v2/point/${RADAR_LAT}/${RADAR_LON}/${RADAR_RADIUS}`,
    `https://oc-radar-proxy.ocscannernews.workers.dev/flights?lat=${RADAR_LAT}&lon=${RADAR_LON}&dist=${RADAR_RADIUS}`
  ];
}

function updateRadarSubtitles() {
  const latStr = Math.abs(RADAR_LAT).toFixed(4) + (RADAR_LAT >= 0 ? '°N' : '°S');
  const lonStr = Math.abs(RADAR_LON).toFixed(4) + (RADAR_LON >= 0 ? '°E' : '°W');
  const sub    = `${latStr} ${lonStr} · Radius: 25mi · Updates every 15s`;
  const satSub = `${latStr} ${lonStr} · Min elevation: 15° · Updates every 10s`;
  const airSubEl = document.querySelector('#radar-air-section .radar-sub');
  const satSubEl = document.querySelector('#radar-sat-section .radar-sub');
  if (airSubEl) airSubEl.textContent = sub;
  if (satSubEl) satSubEl.textContent = satSub;
  const badge = `📍 ${latStr}, ${lonStr}`;
  const airBadge = document.getElementById('radar-loc-badge');
  const satBadge = document.getElementById('sat-loc-badge');
  if (airBadge) airBadge.textContent = badge;
  if (satBadge) satBadge.textContent = badge;
}

function updateMyLocation() {
  const btn    = document.getElementById('loc-update-btn');
  const satBtn = document.getElementById('sat-loc-update-btn');
  const setText = t => { if(btn) btn.textContent = t; if(satBtn) satBtn.textContent = t; };

  if (!navigator.geolocation) {
    setText('📍 Not supported');
    return;
  }

  if (location.protocol !== 'https:') {
    setText('📍 HTTPS required');
    return;
  }

  setText('📍 Locating…');

  navigator.geolocation.getCurrentPosition(
    pos => {
      RADAR_LAT = pos.coords.latitude;
      RADAR_LON = pos.coords.longitude;
      RADAR_LOCATION_NAME = 'Current Location';
      updateRadarSubtitles();
      fetchRadarData();
      if (satInitialized) refreshSatellites();
      setText('📍 ' + pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4));
      setTimeout(() => setText('📍 Update Location'), 5000);
    },
    err => {
      console.warn('Geolocation error:', err.code, err.message);
      if (err.code === 1) {
        // Permission denied — tell user how to fix it
        setText('📍 Allow in browser settings');
        // Show a small tooltip/note in the radar subtitle
        const sub = document.querySelector('#radar-air-section .radar-sub');
        if (sub) {
          const orig = sub.textContent;
          sub.textContent = '⚠ Location blocked — click the 🔒 lock icon in your browser address bar to allow location access';
          sub.style.color = 'var(--warn)';
          setTimeout(() => { sub.textContent = orig; sub.style.color = ''; }, 6000);
        }
      } else if (err.code === 2) {
        setText('📍 Position unavailable');
      } else {
        setText('📍 Timeout — retry');
      }
      setTimeout(() => setText('📍 Update Location'), 5000);
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
  );
}

let radarAircraft   = [];
let radarSelected   = null;
let radarStaleCount = 0;  // consecutive empty fetches (prevents flicker)
let radarSweepAngle = 0;
let radarAnimFrame  = null;
let radarCanvas, radarCtx;
const CANVAS_SIZE   = 500;
const CENTER        = CANVAS_SIZE / 2;
const R             = CENTER - 10;

// Aircraft trail history: { hex: [{lat, lon, t}, ...] } — newest last
const radarTrails   = {};
const TRAIL_MAX     = 12;            // points kept per aircraft
const TRAIL_MAX_AGE = 5 * 60 * 1000; // drop points older than 5 min

// Follow mode: when an aircraft is selected, recenter the scope on it
let radarFollow     = false;
// Dynamic center offset (in miles E/N from home) used when following
let radarCenterLat  = null;
let radarCenterLon  = null;

// Military callsign prefixes — US & allied forces
const MIL_PREFIXES = [
  // US Navy & Marines
  'CNV','NVY','NAVY','VMGR','VMA','VMF','VRC','VQ','VAQ','VP','VPU','HSC','HSM','VFA','VR',
  // US Air Force
  'RCH','SAM','PAT','VENUS','REACH','IRON','FORD','DOOM','HOMER','FORTE','USAF','ANG',
  'JAKE','ROCKY','BALLS','GHOST','HAWK','EAGLE','VIPER','TIGER','BISON','BUCK',
  // US Army
  'ARMY','AARMY','MEDEVAC',
  // US Coast Guard
  'CG','CGR','CGAS',
  // NATO / Allied
  'NATO','NATO','RRR','BRIT','CRAF','FORTE',
  // Common mil training
  'TOPGUN','MAVERICK',
];

const MIL_HEX_PREFIXES = ['AE','A9','A','43','44','45','46','47','48'];

function isMilitary(ac) {
  if (ac.military) return true;
  const cs  = (ac.flight || ac.callsign || '').trim().toUpperCase();
  const hex = (ac.hex || '').toUpperCase();
  if (MIL_PREFIXES.some(p => cs.startsWith(p))) return true;
  if (hex.startsWith('AE')) return true; // USAF block
  if (hex.startsWith('A9F')) return true; // US military
  return false;
}

// Known helicopter ICAO type designators (common civil + law enforcement/EMS rotorcraft)
const HELI_TYPES = new Set([
  'EC35','EC30','EC20','EC45','EC55','EC25','H135','H145','H125','H120','H130','H155','H160','H175',
  'AS50','AS55','AS65','AS32','AS3B','A139','A109','A119','A169','A189','B06','B407','B412','B429',
  'B430','B505','B427','B222','B230','B47','R22','R44','R66','S76','S92','S70','H60','UH60','H64',
  'H47','CH47','MD50','MD52','MD60','MD90','MD90','MD53','GAZL','LYNX','PUMA','EXPL','EXEC','A600',
  'S61','S64','K126','MI8','MI17','MI24','H500','H269','B06T','B47T','R66T'
]);

function isHelicopter(ac) {
  // Emitter category A7 = Rotorcraft (most reliable when present)
  const cat = (ac.category || '').toString().toUpperCase();
  if (cat === 'A7') return true;
  // Fall back to ICAO type code lookup
  const t = (ac.type || '').toString().toUpperCase().trim();
  if (t && HELI_TYPES.has(t)) return true;
  return false;
}

// Miles per degree latitude
const MI_PER_DEG = 69.0;

// Active scope center — home by default, or the followed aircraft's position
function activeCenter() {
  if (radarFollow && radarCenterLat != null && radarCenterLon != null) {
    return { lat: radarCenterLat, lon: radarCenterLon };
  }
  return { lat: RADAR_LAT, lon: RADAR_LON };
}

function latLonToRadar(lat, lon, clip = true) {
  const c = activeCenter();
  const dx = (lon - c.lon) * MI_PER_DEG * Math.cos(c.lat * Math.PI / 180);
  const dy = (lat - c.lat) * MI_PER_DEG;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (clip && dist > RADAR_RADIUS) return null;
  const scale = R / RADAR_RADIUS;
  return {
    x: CENTER + dx * scale,
    y: CENTER - dy * scale,
    dist
  };
}

// Great-circle distance (miles) and bearing (deg from true north) home → target
function distanceBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const R_MI = 3958.8;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const dist = R_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) - Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(dLon);
  let brng = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return { dist, bearing: brng };
}

function bearingToCompass(b) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(b / 22.5) % 16];
}

function drawRadar() {
  if (!radarCtx) return;
  const ctx = radarCtx;
  const size = CANVAS_SIZE;

  // Background
  ctx.fillStyle = '#020a04';
  ctx.fillRect(0, 0, size, size);

  // Clip to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, R, 0, Math.PI * 2);
  ctx.clip();

  // Range rings
  const rings = [0.25, 0.5, 0.75, 1.0];
  rings.forEach(f => {
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, R * f, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,255,80,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Ring labels
  ctx.font = '9px Share Tech Mono, monospace';
  ctx.fillStyle = 'rgba(0,255,80,0.3)';
  ctx.textAlign = 'left';
  [6, 12, 18, 25].forEach((mi, i) => {
    const y = CENTER - R * rings[i];
    ctx.fillText(mi + 'mi', CENTER + 4, y - 2);
  });

  // Cardinal lines
  ctx.strokeStyle = 'rgba(0,255,80,0.08)';
  ctx.lineWidth = 1;
  [[CENTER,CENTER-R,CENTER,CENTER+R],[CENTER-R,CENTER,CENTER+R,CENTER]].forEach(([x1,y1,x2,y2]) => {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  });

  // Cardinal labels
  ctx.fillStyle = 'rgba(0,255,80,0.5)';
  ctx.font = '10px Share Tech Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N', CENTER, CENTER - R + 14);
  ctx.fillText('S', CENTER, CENTER + R - 4);
  ctx.textAlign = 'left';
  ctx.fillText('E', CENTER + R - 14, CENTER + 4);
  ctx.textAlign = 'right';
  ctx.fillText('W', CENTER - R + 14, CENTER + 4);

  // Sweep gradient
  const sweepRad = radarSweepAngle * Math.PI / 180;
  const grad = ctx.createConicalGradient
    ? null
    : null;

  // Draw sweep as a filled arc
  ctx.beginPath();
  ctx.moveTo(CENTER, CENTER);
  ctx.arc(CENTER, CENTER, R, sweepRad - Math.PI * 0.5, sweepRad);
  ctx.closePath();
  const sweepGrad = ctx.createRadialGradient(CENTER, CENTER, 0, CENTER, CENTER, R);
  sweepGrad.addColorStop(0, 'rgba(0,255,80,0.0)');
  sweepGrad.addColorStop(0.7, 'rgba(0,255,80,0.06)');
  sweepGrad.addColorStop(1, 'rgba(0,255,80,0.18)');
  ctx.fillStyle = sweepGrad;
  ctx.fill();

  // Sweep line
  ctx.beginPath();
  ctx.moveTo(CENTER, CENTER);
  ctx.lineTo(CENTER + Math.cos(sweepRad) * R, CENTER + Math.sin(sweepRad) * R);
  ctx.strokeStyle = 'rgba(0,255,80,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Aircraft trails — fading polyline of recent positions
  radarAircraft.forEach(ac => {
    const tr = radarTrails[ac.hex];
    if (!tr || tr.length < 2) return;
    const isSelected = radarSelected && ac.hex === radarSelected;
    const isMil = isMilitary(ac);
    const isHeli = ac.helicopter;
    const baseColor = isSelected ? '0,255,157' : isMil ? '255,59,48' : isHeli ? '0,180,255' : '0,224,96';
    // Project each trail point through the current scope center
    for (let i = 1; i < tr.length; i++) {
      const p0 = latLonToRadar(tr[i-1].lat, tr[i-1].lon, false);
      const p1 = latLonToRadar(tr[i].lat,   tr[i].lon,   false);
      if (!p0 || !p1) continue;
      const alpha = (i / tr.length) * (isSelected ? 0.85 : 0.45); // older = fainter
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = `rgba(${baseColor},${alpha.toFixed(3)})`;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();
    }
  });

  // Aircraft dots
  radarAircraft.forEach(ac => {
    if (!ac._pos) return;
    const {x, y} = ac._pos;
    const isSelected = radarSelected && ac.hex === radarSelected;
    const isMil = isMilitary(ac);
    const isHeli = ac.helicopter;

    // Dot color: selected=neon green, military=red, helicopter=blue, fixed-wing=green
    let dotColor = isSelected ? '#00ff9d' : isMil ? '#ff3b30' : isHeli ? '#00b4ff' : '#00e060';
    let dotSize  = isSelected ? 5 : 3.5;

    // Glow
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,255,157,0.15)';
      ctx.fill();
    }

    // Marker: helicopters get a small square, everything else a dot
    if (isHeli && !isSelected) {
      const s = dotSize * 1.6;
      ctx.beginPath();
      ctx.rect(x - s/2, y - s/2, s, s);
      ctx.fillStyle = dotColor;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }

    // Heading line
    if (ac.track != null) {
      const hdgRad = (ac.track - 90) * Math.PI / 180;
      const len = isSelected ? 18 : 12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(hdgRad) * len, y + Math.sin(hdgRad) * len);
      ctx.strokeStyle = isSelected ? 'rgba(0,255,157,0.8)' : 'rgba(0,224,96,0.5)';
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.stroke();
    }

    // Callsign label for selected
    if (isSelected && ac.flight) {
      ctx.font = 'bold 10px Share Tech Mono, monospace';
      ctx.fillStyle = '#00ff9d';
      ctx.textAlign = 'left';
      ctx.fillText(ac.flight.trim(), x + 8, y - 6);
    }
  });

  ctx.restore();

  // Outer ring
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,255,80,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center dot — represents the scope center (home, or followed aircraft)
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, 3, 0, Math.PI * 2);
  ctx.fillStyle = radarFollow ? '#00b4ff' : '#00ff9d';
  ctx.fill();

  // When following, show where HOME is relative to the followed aircraft
  if (radarFollow) {
    const home = latLonToRadar(RADAR_LAT, RADAR_LON, false);
    if (home) {
      ctx.beginPath();
      ctx.arc(home.x, home.y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,255,157,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = '8px Share Tech Mono, monospace';
      ctx.fillStyle = 'rgba(0,255,157,0.7)';
      ctx.textAlign = 'left';
      ctx.fillText('HOME', home.x + 6, home.y + 3);
    }
    // "TRACKING" banner
    ctx.font = 'bold 9px Share Tech Mono, monospace';
    ctx.fillStyle = 'rgba(0,180,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText('◉ FOLLOWING TARGET', CENTER, 14);
  }
}

function animateRadar() {
  radarSweepAngle = (radarSweepAngle + 0.8) % 360;
  drawRadar();
  radarAnimFrame = requestAnimationFrame(animateRadar);
}

function parseAircraft(raw) {
  // Handle multiple API formats
  let list = [];
  if (Array.isArray(raw?.ac)) list = raw.ac;                  // airplanes.live / adsb.lol
  else if (Array.isArray(raw?.states)) {                       // OpenSky
    list = raw.states.map(s => ({
      hex:     s[0],
      flight:  s[1]?.trim() || '',
      lon:     s[5],
      lat:     s[6],
      baro_alt: s[7],
      gs:      s[9] ? s[9] * 1.944 : null, // m/s to knots
      track:   s[10],
      on_ground: s[8],
    }));
  }
  else if (Array.isArray(raw)) list = raw;

  const now = Date.now();
  const parsed = list.map(ac => {
    const lat = ac.lat ?? ac.latitude;
    const lon = ac.lon ?? ac.longitude ?? ac.lng;
    const alt = ac.alt_baro ?? ac.baro_altitude ?? ac.altitude ?? ac.baro_alt;
    const spd = ac.gs ?? ac.ground_speed ?? ac.velocity;
    const hdg = ac.track ?? ac.true_track ?? ac.heading;
    const cs  = (ac.flight ?? ac.callsign ?? ac.hex ?? '').trim();
    const hex = ac.hex || ac.icao24 || '';

    return {
      hex,
      flight:   cs,
      lat, lon,
      alt_ft:   alt != null ? Math.round(typeof alt === 'string' ? parseFloat(alt) : alt * (alt < 1000 ? 3.281 : 1)) : null,
      spd_kt:   spd != null ? Math.round(spd) : null,
      track:    hdg,
      type:     ac.t ?? ac.type ?? '',
      category: ac.category ?? ac.emitter_category ?? '',
      reg:      ac.r ?? ac.registration ?? '',
      military: isMilitary({military: ac.military, flight: ac.flight ?? ac.callsign, hex: ac.hex ?? ac.icao24}),
      helicopter: isHelicopter({category: ac.category ?? ac.emitter_category, type: ac.t ?? ac.type}),
      ground:   ac.alt_baro === 'ground' || ac.on_ground === true,
      lat_raw:  lat, lon_raw: lon,
    };
  }).filter(ac => ac.lat_raw != null && ac.lon_raw != null && !ac.ground);

  // Record trail points for each aircraft (in real lat/lon, projection-independent)
  parsed.forEach(ac => {
    if (!ac.hex) return;
    const tr = radarTrails[ac.hex] || (radarTrails[ac.hex] = []);
    const last = tr[tr.length - 1];
    if (!last || last.lat !== ac.lat_raw || last.lon !== ac.lon_raw) {
      tr.push({ lat: ac.lat_raw, lon: ac.lon_raw, t: now });
      if (tr.length > TRAIL_MAX) tr.shift();
    }
  });

  // If following a selected aircraft, recenter the scope on it
  if (radarFollow && radarSelected) {
    const followed = parsed.find(a => a.hex === radarSelected);
    if (followed) { radarCenterLat = followed.lat_raw; radarCenterLon = followed.lon_raw; }
  }

  // Now compute screen positions (after center may have shifted).
  // When following, don't clip — we want to see the followed plane + nearby.
  parsed.forEach(ac => { ac._pos = latLonToRadar(ac.lat_raw, ac.lon_raw, !radarFollow); });

  // Prune stale trails (aircraft gone, or old points)
  for (const hex in radarTrails) {
    radarTrails[hex] = radarTrails[hex].filter(p => now - p.t < TRAIL_MAX_AGE);
    if (!radarTrails[hex].length) delete radarTrails[hex];
  }

  return parsed.filter(ac => ac._pos !== null);
}

function selectAircraft(hex) {
  if (radarSelected === hex) {
    // Deselect — stop following, recenter home
    radarSelected = null;
    radarFollow = false;
    radarCenterLat = radarCenterLon = null;
  } else {
    radarSelected = hex;
    radarFollow = true;
    const ac = radarAircraft.find(a => a.hex === hex);
    if (ac) { radarCenterLat = ac.lat_raw; radarCenterLon = ac.lon_raw; }
  }
  // Recompute positions immediately so the view snaps without waiting for next fetch
  radarAircraft.forEach(ac => { ac._pos = latLonToRadar(ac.lat_raw, ac.lon_raw, !radarFollow); });
  renderDataPanel();
}

function renderDataPanel() {
  const panel = document.getElementById('radar-data-panel');
  const totalEl   = document.getElementById('r-total');
  const highEl    = document.getElementById('r-highest');
  const fastEl    = document.getElementById('r-fastest');
  const milEl     = document.getElementById('r-mil');
  const heliEl    = document.getElementById('r-heli');

  if (!radarAircraft.length) {
    panel.innerHTML = '<div class="radar-empty">No aircraft detected in range</div>';
    if(totalEl) totalEl.textContent = '0';
    return;
  }

  // Stats
  const maxAlt  = Math.max(...radarAircraft.filter(a=>a.alt_ft).map(a=>a.alt_ft));
  const maxSpd  = Math.max(...radarAircraft.filter(a=>a.spd_kt).map(a=>a.spd_kt));
  const milCnt  = radarAircraft.filter(a=>a.military).length;
  const heliCnt = radarAircraft.filter(a=>a.helicopter).length;

  if(totalEl) totalEl.textContent  = radarAircraft.length;
  if(highEl)  highEl.textContent   = maxAlt > 0 ? maxAlt.toLocaleString() : '--';
  if(fastEl)  fastEl.textContent   = maxSpd > 0 ? maxSpd : '--';
  if(milEl)   milEl.textContent    = milCnt;
  if(heliEl)  heliEl.textContent   = heliCnt;

  panel.innerHTML = '';

  // ── Selected aircraft readout: distance + bearing from home ──
  if (radarSelected) {
    const sel = radarAircraft.find(a => a.hex === radarSelected);
    if (sel && sel.lat_raw != null) {
      const db = distanceBearing(RADAR_LAT, RADAR_LON, sel.lat_raw, sel.lon_raw);
      const compass = bearingToCompass(db.bearing);
      const readout = document.createElement('div');
      readout.style.cssText = 'background:rgba(0,255,157,.07);border:1px solid rgba(0,255,157,.25);border-radius:6px;padding:9px 11px;margin-bottom:9px';
      readout.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <span style="font-family:var(--fh);font-weight:700;color:var(--accent3);letter-spacing:.05em">🎯 ${sel.flight || sel.hex}</span>
          <span style="font-family:var(--fm);font-size:.62rem;color:var(--accent3)">${radarFollow ? '◉ TRACKING' : ''}</span>
        </div>
        <div class="ac-stats">
          <div class="ac-stat"><span>RANGE </span>${db.dist.toFixed(1)} mi</div>
          <div class="ac-stat"><span>BRG </span>${Math.round(db.bearing)}° ${compass}</div>
          <div class="ac-stat"><span>ALT </span>${sel.alt_ft ? sel.alt_ft.toLocaleString()+' ft' : '--'}</div>
          <div class="ac-stat"><span>SPD </span>${sel.spd_kt ? sel.spd_kt+' kt' : '--'}</div>
        </div>
        <div style="margin-top:6px;text-align:right">
          <button class="rbtn" onclick="selectAircraft('${sel.hex}')" style="margin:0;font-size:.68rem">✕ Stop tracking</button>
        </div>
      `;
      panel.appendChild(readout);
    }
  }

  // Sort: selected first, then by distance
  const sorted = [...radarAircraft].sort((a,b) => {
    if (a.hex === radarSelected) return -1;
    if (b.hex === radarSelected) return 1;
    return (a._pos?.dist || 99) - (b._pos?.dist || 99);
  });

  sorted.forEach(ac => {
    const isSel = ac.hex === radarSelected;
    const isMil = ac.military;
    const isHeli = ac.helicopter;
    const card  = document.createElement('div');
    card.className = `ac-card${isSel?' selected':''}${isMil?' military':''}`;
    // Color the left edge by class (military red takes priority, then heli blue, then fixed-wing green)
    if (!isSel) card.style.borderLeft = `3px solid ${isMil ? '#ff3b30' : isHeli ? '#00b4ff' : '#00e060'}`;
    card.onclick   = () => selectAircraft(ac.hex);

    const alt = ac.alt_ft ? ac.alt_ft.toLocaleString() + ' ft' : '--';
    const spd = ac.spd_kt ? ac.spd_kt + ' kt' : '--';
    const hdg = ac.track  ? Math.round(ac.track) + '°' : '--';
    const dst = ac._pos   ? Math.round(ac._pos.dist) + ' mi' : '--';
    const cs  = ac.flight || ac.hex || 'Unknown';
    const typ = ac.type || '';

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <span class="ac-callsign">${cs}</span>
          ${typ ? `<span class="ac-type">${typ}</span>` : ''}
          ${isMil ? '<span style="color:var(--danger);font-size:.65rem;font-family:var(--fm);margin-left:6px">MIL</span>' : ''}
          ${isHeli && !isMil ? '<span style="color:#00b4ff;font-size:.65rem;font-family:var(--fm);margin-left:6px">🚁 HELI</span>' : ''}
        </div>
        <span style="font-family:var(--fm);font-size:.65rem;color:var(--muted)">${dst}</span>
      </div>
      <div class="ac-stats">
        <div class="ac-stat"><span>ALT </span>${alt}</div>
        <div class="ac-stat"><span>SPD </span>${spd}</div>
        <div class="ac-stat"><span>HDG </span>${hdg}</div>
        ${ac.reg ? `<div class="ac-stat"><span>REG </span>${ac.reg}</div>` : ''}
      </div>
    `;
    panel.appendChild(card);
  });
}

async function fetchRadarData() {
  let gotValidResponse = false;
  for (const url of getRadarAPIs()) {
    try {
      console.log('[Radar] Trying:', url);
      const r = await fetch(url, {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      console.log('[Radar] Status:', r.status);
      if (!r.ok) continue;
      const data = await r.json();
      console.log('[Radar] Keys:', Object.keys(data), 'ac:', data.ac?.length ?? 'none');
      const parsed = parseAircraft(data);

      if (parsed.length > 0) {
        // Found aircraft — use this source and stop.
        radarAircraft = parsed;
        renderDataPanel();
        const el = document.getElementById('radar-last-update');
        if (el) el.textContent = new Date().toLocaleTimeString();
        radarStaleCount = 0;
        console.log('[Radar] Parsed:', parsed.length, 'aircraft — using this source');
        markHealth('Flights (ADS-B)', true);
        return;
      }
      // Valid response but zero aircraft — remember that we reached a source,
      // then try the NEXT source in case it has coverage (e.g. adsb.lol blocked
      // our IP and returned empty, but adsb.one or the worker has planes).
      gotValidResponse = true;
      console.log('[Radar] Empty from this source — trying next');
    } catch(e) {
      console.log('[Radar] Error:', e.message);
      continue;
    }
  }

  // Every source has been tried. If at least one responded validly but all were
  // empty, treat it as a genuine (or persistent) empty sky after a few cycles —
  // otherwise keep the last known planes on screen rather than blanking.
  if (gotValidResponse) {
    radarStaleCount++;
    if (radarStaleCount >= 4) {
      radarAircraft = [];
      renderDataPanel();
      const el = document.getElementById('radar-last-update');
      if (el) el.textContent = new Date().toLocaleTimeString();
    }
    markHealth('Flights (ADS-B)', true);
    console.log('[Radar] All sources empty (stale count', radarStaleCount + ')');
    return;
  }

  // No source responded at all.
  console.log('[Radar] All URLs failed');
  markHealth('Flights (ADS-B)', false, 'all sources failed');
  const el = document.getElementById('radar-last-update');
  if (el) el.textContent = 'Retrying…';
  const panel = document.getElementById('radar-data-panel');
  if (panel && !radarAircraft.length) {
    panel.innerHTML = `<div class="radar-empty">⚠ Flight data unavailable — retrying in 15s</div>`;
  }
}

function initRadar() {
  radarCanvas = document.getElementById('radar-canvas');
  if (!radarCanvas) return;

  const container = radarCanvas.parentElement;
  // Air radar is intentionally larger; cap at 460 to match drawing constants
  const size = Math.min(container.offsetWidth || CANVAS_SIZE, CANVAS_SIZE);
  radarCanvas.width  = CANVAS_SIZE;
  radarCanvas.height = CANVAS_SIZE;

  radarCtx = radarCanvas.getContext('2d');
  updateRadarSubtitles();
  animateRadar();
  fetchRadarData();
  sched('Flight Radar', fetchRadarData, 15000, false);

  // Click on canvas to select aircraft
  radarCanvas.addEventListener('click', e => {
    const rect  = radarCanvas.getBoundingClientRect();
    const scale = radarCanvas.width / rect.width;
    const mx    = (e.clientX - rect.left) * scale;
    const my    = (e.clientY - rect.top)  * scale;
    let closest = null, minDist = 14;
    radarAircraft.forEach(ac => {
      if (!ac._pos) return;
      const d = Math.sqrt((ac._pos.x - mx)**2 + (ac._pos.y - my)**2);
      if (d < minDist) { minDist = d; closest = ac.hex; }
    });
    if (closest) selectAircraft(closest);
  });
}

/* ══════════════════════════════════════
   SPACE TAB
══════════════════════════════════════ */
let spaceInitialized = false;
let nextLaunchTimer = null;

// Detect launch site and assign color
function launchSite(l) {
  const loc = (l.pad?.location?.name || l.location || l.pad?.name || '').toLowerCase();
  const name = (l.name || '').toLowerCase();
  const hay = loc + ' ' + name;
  if (hay.includes('vandenberg') || hay.includes('vsfb'))
    return { label: 'Vandenberg SFB', icon: '🌲', color: '#00ff9d' };
  if (hay.includes('kennedy') || hay.includes('cape canaveral') || hay.includes('ksc') || hay.includes('lc-39') || hay.includes('slc-40') || hay.includes('ccsfs') || hay.includes('florida'))
    return { label: 'Kennedy / Cape Canaveral', icon: '🚀', color: '#00b4ff' };
  if (hay.includes('starbase') || hay.includes('boca chica') || hay.includes('brownsville'))
    return { label: 'Starbase', icon: '⭐', color: '#ff4d2e' };
  return { label: l.pad?.location?.name || l.location || 'Other Site', icon: '📍', color: '#af52de' };
}

async function loadLaunches() {
  const listEl = document.getElementById('launch-list');
  const nextEl = document.getElementById('next-launch');
  try {
    const r = await fetch('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=20&mode=list');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    let launches = data.results || [];
    if (!launches.length) throw new Error('No launches');

    // Filter out launches that have already lifted off (give 30 min grace for in-progress)
    const cutoff = Date.now() - 30 * 60 * 1000;
    launches = launches
      .filter(l => new Date(l.net).getTime() > cutoff)
      .sort((a, b) => new Date(a.net) - new Date(b.net));

    if (!launches.length) throw new Error('No upcoming launches');

    // Hero - next launch
    const next = launches[0];
    const netDate = new Date(next.net);
    nextEl.innerHTML = `
      <div style="font-family:var(--fh);font-size:1.4rem;font-weight:700;color:var(--text);letter-spacing:.04em">${next.name}</div>
      <div style="font-family:var(--fm);font-size:.8rem;color:var(--accent);margin:6px 0">${next.provider || ''} · ${next.pad?.location?.name || next.location || ''}</div>
      <div id="countdown-timer" style="font-family:var(--fm);font-size:2rem;font-weight:700;color:var(--accent3);margin:12px 0;letter-spacing:.05em">--:--:--:--</div>
      <div style="font-family:var(--fm);font-size:.75rem;color:var(--muted)">Liftoff: ${netDate.toLocaleString()}</div>
    `;

    // Start countdown
    if (nextLaunchTimer) clearInterval(nextLaunchTimer);
    function updateCountdown() {
      const now = new Date();
      const diff = netDate - now;
      const tEl = document.getElementById('countdown-timer');
      if (!tEl) { clearInterval(nextLaunchTimer); return; }
      if (diff <= 0) {
        tEl.textContent = '🚀 LIFTOFF';
        tEl.style.color = 'var(--accent2)';
        clearInterval(nextLaunchTimer);
        // After liftoff, wait 90s then refresh to advance to the next launch
        setTimeout(() => loadLaunches(), 90 * 1000);
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      tEl.textContent = `T- ${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    }
    updateCountdown();
    nextLaunchTimer = setInterval(updateCountdown, 1000);

    // List
    listEl.innerHTML = '';
    launches.forEach(l => {
      const dt = new Date(l.net);
      const site = launchSite(l);
      const card = document.createElement('div');
      card.style.cssText = `background:var(--bg3);border:1px solid var(--border);border-left:3px solid ${site.color};border-radius:5px;padding:9px 12px`;
      card.innerHTML = `
        <div style="font-family:var(--fu);font-weight:600;color:var(--text);font-size:.85rem">${l.name}</div>
        <div style="font-family:var(--fm);font-size:.68rem;color:var(--muted);margin-top:3px">
          <span style="color:${site.color}">${site.icon} ${site.label}</span> · ${dt.toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${dt.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch(e) {
    console.log('[Space] Launch error:', e.message);
    if (nextEl) nextEl.innerHTML = '<div class="radar-empty">⚠ Launch data unavailable. <a href="https://nextspaceflight.com/" target="_blank" style="color:var(--accent)">View schedule →</a></div>';
    if (listEl) listEl.innerHTML = '';
  }
}

async function loadISS() {
  try {
    const r = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    document.getElementById('iss-lat').textContent = d.latitude.toFixed(2) + '°';
    document.getElementById('iss-lon').textContent = d.longitude.toFixed(2) + '°';
    document.getElementById('iss-altitude').textContent = Math.round(d.altitude) + ' km';
    document.getElementById('iss-velocity').textContent = Math.round(d.velocity).toLocaleString() + ' km/h';
    const lat = d.latitude.toFixed(1), lon = d.longitude.toFixed(1);
    document.getElementById('iss-location').textContent = `Currently over ${lat}°, ${lon}° · Updated ${new Date().toLocaleTimeString()}`;
  } catch(e) {
    console.log('[Space] ISS error:', e.message);
    document.getElementById('iss-location').textContent = 'ISS telemetry unavailable';
  }
}

async function loadSpaceWeather() {
  // NOAA SWPC - planetary K index
  try {
    const kpR = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
    if (kpR.ok) {
      const kp = await kpR.json();
      const latest = kp[kp.length - 1];
      const kpVal = parseFloat(latest[1]);
      const kpEl = document.getElementById('sw-kp');
      kpEl.textContent = kpVal.toFixed(1);
      kpEl.style.color = kpVal >= 5 ? 'var(--danger)' : kpVal >= 4 ? 'var(--warn)' : 'var(--accent3)';
      const statusEl = document.getElementById('sw-status');
      if (kpVal >= 5) statusEl.textContent = '⚠ Geomagnetic storm active — aurora possible';
      else if (kpVal >= 4) statusEl.textContent = 'Unsettled geomagnetic conditions';
      else statusEl.textContent = 'Quiet geomagnetic conditions';
    }
  } catch(e) { console.log('[Space] Kp error:', e.message); }

  // Solar wind - plasma
  try {
    const swR = await fetch('https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json');
    if (swR.ok) {
      const sw = await swR.json();
      const latest = sw[sw.length - 1];
      // [time, density, speed, temperature]
      document.getElementById('sw-wind').textContent = Math.round(parseFloat(latest[2])) + ' km/s';
      document.getElementById('sw-density').textContent = parseFloat(latest[1]).toFixed(1);
    }
  } catch(e) { console.log('[Space] Solar wind error:', e.message); }

  // Magnetic field - Bz
  try {
    const magR = await fetch('https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json');
    if (magR.ok) {
      const mag = await magR.json();
      const latest = mag[mag.length - 1];
      // [time, bx, by, bz, lon, lat, bt]
      const bz = parseFloat(latest[3]);
      const bzEl = document.getElementById('sw-bz');
      bzEl.textContent = bz.toFixed(1);
      bzEl.style.color = bz < -10 ? 'var(--danger)' : bz < -5 ? 'var(--warn)' : 'var(--text2)';
    }
  } catch(e) { console.log('[Space] Bz error:', e.message); }
}

async function loadSpaceNews() {
  const el = document.getElementById('space-news');
  const feeds = [
    { n:'Spaceflight Now', u:'https://spaceflightnow.com/feed/' },
    { n:'NASA',            u:'https://www.nasa.gov/feed/' },
    { n:'Space.com',       u:'https://www.space.com/feeds/all' },
  ];
  const items = [];
  await Promise.allSettled(feeds.map(async f => {
    try {
      const xml = new DOMParser().parseFromString(await proxyFetchText(f.u), 'text/xml');
      Array.from(xml.querySelectorAll('item')).slice(0,5).forEach(it => {
        items.push({
          src: f.n,
          title: it.querySelector('title')?.textContent || '',
          link: it.querySelector('link')?.textContent || '#',
          pub: it.querySelector('pubDate')?.textContent || ''
        });
      });
    } catch(e) {}
  }));
  if (!items.length) { el.innerHTML = '<div class="empty">Space news unavailable</div>'; return; }
  el.innerHTML = '';
  items.slice(0,12).forEach(it => {
    const a = document.createElement('a');
    a.href = it.link; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'ncard';
    a.innerHTML = `<div class="nsrc">${it.src}</div><div class="ntitle">${it.title}</div>`;
    el.appendChild(a);
  });
}

function initSpace() {
  if (spaceInitialized) return;
  spaceInitialized = true;
  loadLaunches();
  loadISS();
  loadSpaceWeather();
  loadSpaceNews();
  sched('ISS Telemetry', loadISS, 5000, false);
  sched('Space Weather', loadSpaceWeather, 5 * 60 * 1000, false);
  sched('Launches', loadLaunches, 10 * 60 * 1000, false);
}

/* ══════════════════════════════════════
   RADAR MODE SWITCHER
══════════════════════════════════════ */
let currentRadarMode = 'air';

function setRadarMode(mode) {
  currentRadarMode = mode;
  document.getElementById('radar-air-section').style.display = mode === 'air' ? '' : 'none';
  document.getElementById('radar-sat-section').style.display = mode === 'sat' ? '' : 'none';
  document.getElementById('mode-air').classList.toggle('active', mode === 'air');
  document.getElementById('mode-sat').classList.toggle('active', mode === 'sat');
  if (mode === 'sat') {
    if (!satInitialized) initSatelliteRadar();
    else refreshSatellites();
  }
}

/* ══════════════════════════════════════
   SATELLITE RADAR ENGINE
══════════════════════════════════════ */
let satInitialized  = false;
let satCanvas, satCtx;
let satObjects      = [];   // parsed + computed positions
let satSelected     = null;
let satFilter       = 'all';
let satSweepAngle   = 0;
let satAnimFrame    = null;
let satLib          = null; // satellite.js

const SAT_ALT  = 0.05; // km observer altitude
const SAT_SIZE = 380;
const SAT_C    = SAT_SIZE / 2;
const SAT_R    = SAT_C - 10;

// TLE groups to load from CelesTrak
const TLE_GROUPS = [
  { key:'stations', label:'Space Stations', color:'#00ff9d',
    url:'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE' },
  { key:'starlink',  label:'Starlink',       color:'#00b4ff',
    url:'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=TLE' },
  { key:'weather',   label:'Weather',        color:'#ffb700',
    url:'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=TLE' },
  { key:'gps',       label:'GPS/Nav',        color:'#af52de',
    url:'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=TLE' },
  { key:'visual',    label:'Visual',         color:'#ff4d2e',
    url:'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=TLE' },
];

function setSatFilter(f, btn) {
  satFilter = f;
  document.querySelectorAll('#sat-filter-bar .gpill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderSatPanel();
  drawSatRadar();
}

function parseTLE(text, group) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const sats  = [];
  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i].replace(/^0 /,'').trim();
    const l1   = lines[i+1];
    const l2   = lines[i+2];
    if (l1.startsWith('1') && l2.startsWith('2')) {
      sats.push({ name, l1, l2, group: group.key, color: group.color });
    }
  }
  return sats;
}

function computeSatPositions(tles) {
  if (!satLib) return [];
  const now    = new Date();
  const gmst   = satLib.gstime(now);
  const obsGd  = { latitude: satLib.degreesToRadians(RADAR_LAT), longitude: satLib.degreesToRadians(RADAR_LON), height: SAT_ALT };
  const results = [];

  for (const tle of tles) {
    try {
      const satrec    = satLib.twoline2satrec(tle.l1, tle.l2);
      const pv        = satLib.propagate(satrec, now);
      if (!pv.position) continue;
      const ecf       = satLib.eciToEcf(pv.position, gmst);
      const lookAngles = satLib.ecfToLookAngles(obsGd, ecf);
      const el        = satLib.radiansToDegrees(lookAngles.elevation);
      const az        = satLib.radiansToDegrees(lookAngles.azimuth);
      if (el < 15) continue; // below 15° elevation threshold
      // Altitude in km
      const geo       = satLib.eciToGeodetic(pv.position, gmst);
      const altKm     = geo.height;
      const altMi     = Math.round(altKm * 0.621371);
      // Velocity magnitude in km/s
      const vel       = pv.velocity
        ? Math.sqrt(pv.velocity.x**2 + pv.velocity.y**2 + pv.velocity.z**2)
        : null;
      const spdKmps   = vel ? vel.toFixed(2) : '--';
      results.push({ ...tle, el, az, altMi, spdKmps, _el: el, _az: az });
    } catch(e) {}
  }
  return results;
}

/* ── ISS PASS PREDICTIONS ──
   Steps the ISS orbit forward and finds upcoming passes above a min elevation.
   Pure satellite.js math — no API. */
function predictISSPasses(opts = {}) {
  if (!satLib || !allTLEs.length) return [];
  const issTle = allTLEs.find(t => t.name.includes('ISS') || t.name.includes('ZARYA'));
  if (!issTle) return [];

  const minEl    = opts.minEl ?? 10;        // degrees — visible-pass threshold
  const hoursAhead = opts.hours ?? 48;      // search window
  const stepSec  = opts.step ?? 30;         // coarse step in seconds
  const wantPasses = opts.count ?? 4;

  let satrec;
  try { satrec = satLib.twoline2satrec(issTle.l1, issTle.l2); } catch(e) { return []; }
  const obsGd = { latitude: satLib.degreesToRadians(RADAR_LAT), longitude: satLib.degreesToRadians(RADAR_LON), height: SAT_ALT };

  const elAt = (date) => {
    const pv = satLib.propagate(satrec, date);
    if (!pv.position) return null;
    const gmst = satLib.gstime(date);
    const ecf  = satLib.eciToEcf(pv.position, gmst);
    const la   = satLib.ecfToLookAngles(obsGd, ecf);
    return { el: satLib.radiansToDegrees(la.elevation), az: satLib.radiansToDegrees(la.azimuth) };
  };

  const passes = [];
  const start = Date.now();
  const end   = start + hoursAhead * 3600 * 1000;
  let t = start;
  let inPass = false, passStart = null, passPeak = 0, peakAz = 0, startAz = 0;

  while (t < end && passes.length < wantPasses) {
    const date = new Date(t);
    const look = elAt(date);
    if (!look) { t += stepSec * 1000; continue; }

    if (look.el >= minEl && !inPass) {
      inPass = true; passStart = t; passPeak = look.el; peakAz = look.az; startAz = look.az;
    } else if (inPass) {
      if (look.el > passPeak) { passPeak = look.el; peakAz = look.az; }
      if (look.el < minEl) {
        // pass ended
        passes.push({
          start: new Date(passStart),
          end:   new Date(t),
          durationMin: Math.round((t - passStart) / 60000),
          maxEl: Math.round(passPeak),
          startCompass: bearingToCompass(startAz),
          peakCompass:  bearingToCompass(peakAz),
          endCompass:   bearingToCompass(look.az),
        });
        inPass = false;
      }
    }
    t += stepSec * 1000;
  }
  return passes;
}

function renderISSPasses() {
  const el = document.getElementById('iss-next-pass');
  if (!el) return;
  const passes = predictISSPasses({ minEl: 10, count: 4, hours: 48 });
  if (!passes.length) {
    el.textContent = 'No visible passes in next 48h';
    return;
  }
  const fmt = d => d.toLocaleString(undefined, { weekday:'short', hour:'2-digit', minute:'2-digit' });
  // First pass inline (compact), full list below the card
  const next = passes[0];
  el.textContent = `${fmt(next.start)} · ${next.durationMin}min · max ${next.maxEl}° (${next.startCompass}→${next.endCompass})`;

  // Render the full list into the dedicated container if present
  const listEl = document.getElementById('iss-pass-list');
  if (listEl) {
    listEl.innerHTML = passes.map((p, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;${i<passes.length-1?'border-bottom:1px solid var(--border)':''}">
        <span style="font-family:var(--fm);font-size:.72rem;color:var(--text)">${fmt(p.start)}</span>
        <span style="font-family:var(--fm);font-size:.68rem;color:var(--muted)">${p.durationMin}min · ↑${p.maxEl}° · ${p.startCompass}→${p.endCompass}</span>
      </div>
    `).join('');
  }
}

function satToCanvas(az, el) {
  // el 90=center, 0=edge
  const r     = SAT_R * (1 - el / 90);
  const azRad = (az - 90) * Math.PI / 180; // rotate so N is up
  return {
    x: SAT_C + r * Math.cos(azRad),
    y: SAT_C + r * Math.sin(azRad)
  };
}

function drawSatRadar() {
  if (!satCtx) return;
  const ctx = satCtx;

  ctx.fillStyle = '#020408';
  ctx.fillRect(0, 0, SAT_SIZE, SAT_SIZE);

  ctx.save();
  ctx.beginPath();
  ctx.arc(SAT_C, SAT_C, SAT_R, 0, Math.PI * 2);
  ctx.clip();

  // Elevation rings: 0°, 30°, 60°, 90° horizon/zenith
  [0,30,60,90].forEach(el => {
    const r = SAT_R * (1 - el/90);
    ctx.beginPath();
    ctx.arc(SAT_C, SAT_C, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,120,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Ring labels
  ctx.font = '9px Share Tech Mono, monospace';
  ctx.fillStyle = 'rgba(0,120,255,0.4)';
  ctx.textAlign = 'left';
  [{el:0,l:'0°'},{el:30,l:'30°'},{el:60,l:'60°'},{el:90,l:'90°'}].forEach(({el,l}) => {
    const r = SAT_R * (1 - el/90);
    if (r > 5) ctx.fillText(l, SAT_C + 4, SAT_C - r + 10);
  });

  // Cardinal lines
  ctx.strokeStyle = 'rgba(0,120,255,0.1)';
  ctx.lineWidth = 1;
  [[SAT_C,SAT_C-SAT_R,SAT_C,SAT_C+SAT_R],[SAT_C-SAT_R,SAT_C,SAT_C+SAT_R,SAT_C]].forEach(([x1,y1,x2,y2]) => {
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  });

  // Cardinals labels
  ctx.fillStyle = 'rgba(0,180,255,0.6)';
  ctx.font = '10px Share Tech Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N', SAT_C, SAT_C - SAT_R + 14);
  ctx.fillText('S', SAT_C, SAT_C + SAT_R - 4);
  ctx.textAlign = 'left';
  ctx.fillText('E', SAT_C + SAT_R - 14, SAT_C + 4);
  ctx.textAlign = 'right';
  ctx.fillText('W', SAT_C - SAT_R + 14, SAT_C + 4);

  // Sweep
  const sweepRad = (satSweepAngle - 90) * Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(SAT_C, SAT_C);
  ctx.arc(SAT_C, SAT_C, SAT_R, sweepRad - Math.PI * 0.4, sweepRad);
  ctx.closePath();
  const sg = ctx.createRadialGradient(SAT_C, SAT_C, 0, SAT_C, SAT_C, SAT_R);
  sg.addColorStop(0,   'rgba(0,120,255,0.0)');
  sg.addColorStop(0.7, 'rgba(0,120,255,0.05)');
  sg.addColorStop(1,   'rgba(0,120,255,0.15)');
  ctx.fillStyle = sg;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(SAT_C, SAT_C);
  ctx.lineTo(SAT_C + Math.cos(sweepRad) * SAT_R, SAT_C + Math.sin(sweepRad) * SAT_R);
  ctx.strokeStyle = 'rgba(0,150,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw satellites
  const visible = satFilter === 'all' ? satObjects : satObjects.filter(s => s.group === satFilter);
  visible.forEach(sat => {
    const pos = satToCanvas(sat.az, sat.el);
    const isSel = radarSelected === sat.name || satSelected === sat.name;
    const isISS = sat.name.includes('ISS') || sat.name.includes('ZARYA');
    const dotSize = isISS ? 6 : isSel ? 5 : 3;

    if (isSel) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = `${sat.color}22`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, dotSize, 0, Math.PI * 2);
    ctx.fillStyle = isISS ? '#00ff9d' : sat.color;
    if (isSel || isISS) {
      ctx.shadowColor = isISS ? '#00ff9d' : sat.color;
      ctx.shadowBlur  = 8;
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    if (isSel || isISS) {
      ctx.font = isISS ? 'bold 10px Share Tech Mono, monospace' : '9px Share Tech Mono, monospace';
      ctx.fillStyle = isISS ? '#00ff9d' : sat.color;
      ctx.textAlign = 'left';
      ctx.fillText(sat.name.slice(0,16), pos.x + 8, pos.y - 4);
    }
  });

  ctx.restore();

  // Outer ring
  ctx.beginPath();
  ctx.arc(SAT_C, SAT_C, SAT_R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,120,255,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center dot (observer)
  ctx.beginPath();
  ctx.arc(SAT_C, SAT_C, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#00b4ff';
  ctx.fill();
}

function animateSatRadar() {
  satSweepAngle = (satSweepAngle + 0.5) % 360;
  drawSatRadar();
  satAnimFrame = requestAnimationFrame(animateSatRadar);
}

function renderSatPanel() {
  const panel  = document.getElementById('sat-data-panel');
  const total  = document.getElementById('s-total');
  const stEl   = document.getElementById('s-starlink');
  const issEl  = document.getElementById('s-iss');
  const highEl = document.getElementById('s-highest');

  const visible = satFilter === 'all' ? satObjects : satObjects.filter(s => s.group === satFilter);
  const iss     = satObjects.find(s => s.name.includes('ISS') || s.name.includes('ZARYA'));
  const slinks  = satObjects.filter(s => s.group === 'starlink').length;
  const maxAlt  = satObjects.length ? Math.max(...satObjects.map(s => s.altMi || 0)) : 0;

  if (total)  total.textContent  = satObjects.length;
  if (stEl)   stEl.textContent   = slinks;
  if (issEl)  issEl.textContent  = iss ? '✅' : '❌';
  if (highEl) highEl.textContent = maxAlt ? maxAlt.toLocaleString() : '--';

  // ISS card — show whenever we have TLE data (passes work even if not overhead now)
  const issCard = document.getElementById('iss-card');
  const issTleLoaded = allTLEs.some(t => t.name.includes('ISS') || t.name.includes('ZARYA'));
  if (issCard && (iss || issTleLoaded)) {
    issCard.style.display = '';
    if (iss) {
      document.getElementById('iss-alt').textContent = iss.altMi + ' mi';
      document.getElementById('iss-spd').textContent = iss.spdKmps + ' km/s';
      document.getElementById('iss-az').textContent  = Math.round(iss.az) + '°';
      document.getElementById('iss-el').textContent  = Math.round(iss.el) + '°';
    } else {
      // Not currently overhead — show dashes for live position
      ['iss-alt','iss-spd','iss-az','iss-el'].forEach(id => {
        const e = document.getElementById(id); if (e) e.textContent = '— not overhead';
      });
    }
    try { renderISSPasses(); } catch(e) { console.log('[ISS passes] error (non-fatal):', e.message); }
  } else if (issCard) {
    issCard.style.display = 'none';
  }

  if (!visible.length) {
    panel.innerHTML = '<div class="radar-empty">No satellites overhead matching filter</div>';
    return;
  }

  // Sort by elevation (highest first)
  const sorted = [...visible].sort((a,b) => b.el - a.el);
  panel.innerHTML = '';

  sorted.forEach(sat => {
    const isSel = satSelected === sat.name;
    const card  = document.createElement('div');
    card.className = `ac-card${isSel ? ' selected' : ''}`;
    card.style.borderLeftColor = sat.color;
    card.onclick = () => {
      satSelected = isSel ? null : sat.name;
      renderSatPanel();
      drawSatRadar();
    };
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span class="ac-callsign" style="font-size:.85rem">${sat.name}</span>
        <span style="font-family:var(--fm);font-size:.65rem;padding:1px 5px;border-radius:3px;background:${sat.color}22;color:${sat.color}">${sat.group}</span>
      </div>
      <div class="ac-stats">
        <div class="ac-stat"><span>EL </span>${Math.round(sat.el)}°</div>
        <div class="ac-stat"><span>AZ </span>${Math.round(sat.az)}°</div>
        <div class="ac-stat"><span>ALT </span>${sat.altMi} mi</div>
        <div class="ac-stat"><span>SPD </span>${sat.spdKmps} km/s</div>
      </div>
    `;
    panel.appendChild(card);
  });
}

let allTLEs = [];

async function fetchTLEGroup(group) {
  // Use worker proxy exclusively — avoids all browser timeout/CORS issues
  const workerUrl = `https://oc-radar-proxy.ocscannernews.workers.dev/tle?group=${group.key}`;
  console.log('[TLE] Fetching via worker:', group.key);
  try {
    const r = await fetch(workerUrl);
    console.log('[TLE]', group.key, 'worker status:', r.status);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    console.log('[TLE]', group.key, 'text length:', text.length);
    if (!text || (!text.includes('1 ') && !text.includes('2 '))) throw new Error('No TLE data in response');
    const result = parseTLE(text, group);
    console.log('[TLE]', group.key, 'parsed:', result.length, 'satellites');
    markHealth('Satellites (TLE)', true);
    return result;
  } catch(e) {
    console.log('[TLE]', group.key, 'failed:', e.message);
    return [];
  }
}

async function loadSatelliteJS() {
  return new Promise((resolve, reject) => {
    if (window.satellite) { resolve(window.satellite); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/satellite.js/4.0.0/satellite.min.js';
    script.onload  = () => resolve(window.satellite);
    script.onerror = () => {
      // Try unpkg fallback
      const s2 = document.createElement('script');
      s2.src = 'https://unpkg.com/satellite.js@4.0.0/dist/satellite.min.js';
      s2.onload  = () => resolve(window.satellite);
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    document.head.appendChild(script);
  });
}

async function refreshSatellites() {
  document.getElementById('sat-data-panel').innerHTML = '<div class="radar-empty">Computing positions…</div>';
  try {
    if (!satLib) satLib = await loadSatelliteJS();
    console.log('[Sat] refreshSatellites — allTLEs:', allTLEs.length, 'satLib:', !!satLib);
    if (allTLEs.length) {
      satObjects = computeSatPositions(allTLEs);
      console.log('[Sat] computed positions (above 15° elev):', satObjects.length);
      renderSatPanel();
      drawSatRadar();
      const el = document.getElementById('sat-last-update');
      if (el) el.textContent = new Date().toLocaleTimeString();
    } else {
      // TLEs not loaded yet — try loading them now
      await loadAllTLEs();
    }
  } catch(e) {
    console.log('[Sat] refreshSatellites ERROR:', e.message, e.stack);
    document.getElementById('sat-data-panel').innerHTML = '<div class="radar-empty">Error computing positions</div>';
  }
}

async function loadAllTLEs() {
  const panel = document.getElementById('sat-data-panel');
  if (panel) panel.innerHTML = '<div class="radar-empty">Loading satellite data…</div>';

  const PRIORITY   = ['stations', 'visual'];
  const BACKGROUND = ['weather', 'gps', 'starlink'];

  const priorityGroups = TLE_GROUPS.filter(g => PRIORITY.includes(g.key));
  const bgGroups       = TLE_GROUPS.filter(g => BACKGROUND.includes(g.key));

  // Load priority groups with small stagger to avoid rate limiting
  const priorityTLEs = [];
  for (const g of priorityGroups) {
    const result = await fetchTLEGroup(g);
    priorityTLEs.push(...result);
    await new Promise(r => setTimeout(r, 500)); // 500ms between requests
  }

  if (priorityTLEs.length) {
    allTLEs = priorityTLEs;
    satObjects = computeSatPositions(allTLEs);
    renderSatPanel();
    drawSatRadar();
    const el = document.getElementById('sat-last-update');
    if (el) el.textContent = new Date().toLocaleTimeString() + ' (partial)';
  }

  // Load background groups staggered
  (async () => {
    const bgTLEs = [];
    for (const g of bgGroups) {
      await new Promise(r => setTimeout(r, 1000)); // 1s between background requests
      const result = await fetchTLEGroup(g);
      bgTLEs.push(...result);
    }
    if (bgTLEs.length) {
      allTLEs = [...priorityTLEs, ...bgTLEs];
      satObjects = computeSatPositions(allTLEs);
      renderSatPanel();
      drawSatRadar();
      const el = document.getElementById('sat-last-update');
      if (el) el.textContent = new Date().toLocaleTimeString();
    }
  })();

  if (!priorityTLEs.length) {
    if (panel) panel.innerHTML = `
      <div class="radar-empty" style="text-align:left;padding:12px">
        ⚠ CelesTrak rate limit reached. Try again in a minute.<br><br>
        <a href="https://celestrak.org/" target="_blank" style="color:var(--accent)">CelesTrak →</a> &nbsp;
        <a href="https://www.heavens-above.com" target="_blank" style="color:var(--accent)">Heavens-Above →</a>
      </div>`;
  }
}

async function initSatelliteRadar() {
  satInitialized = true;
  satCanvas = document.getElementById('sat-canvas');
  if (!satCanvas) return;
  satCtx = satCanvas.getContext('2d');
  animateSatRadar();

  // Click canvas to select
  satCanvas.addEventListener('click', e => {
    const rect  = satCanvas.getBoundingClientRect();
    const scale = satCanvas.width / rect.width;
    const mx    = (e.clientX - rect.left) * scale;
    const my    = (e.clientY - rect.top)  * scale;
    const vis   = satFilter === 'all' ? satObjects : satObjects.filter(s => s.group === satFilter);
    let closest = null, minD = 14;
    vis.forEach(sat => {
      const pos = satToCanvas(sat.az, sat.el);
      const d   = Math.sqrt((pos.x-mx)**2 + (pos.y-my)**2);
      if (d < minD) { minD = d; closest = sat.name; }
    });
    satSelected = closest;
    renderSatPanel();
    drawSatRadar();
  });

  // Load satellite.js and TLE data directly
  try {
    console.log('[Sat] Loading satellite.js...');
    satLib = await loadSatelliteJS();
    console.log('[Sat] satellite.js loaded:', !!satLib);
    console.log('[Sat] Loading TLEs...');
    await loadAllTLEs();
    console.log('[Sat] TLEs loaded:', allTLEs.length, 'objects');
    sched('Satellite Tracker', refreshSatellites, 10000, false);
    sched('TLE Refresh', loadAllTLEs, 5 * 60 * 1000, false);
  } catch(e) {
    console.log('[Sat] Error:', e.message);
    document.getElementById('sat-data-panel').innerHTML =
      '<div class="radar-empty">⚠ Could not load satellite.js or TLE data.</div>';
  }
}

/* ── NAV ── */
let radarInitialized = false;
function activateTab(pid){
  const tab = document.querySelector('.ntab[data-p="'+pid+'"]');
  const panel = document.getElementById('panel-'+pid);
  if (!tab || !panel) return;
  document.querySelectorAll('.ntab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  tab.classList.add('active');
  panel.classList.add('active');
  if (typeof syncGroupNav === 'function') syncGroupNav(pid);
  // Init radar on first activation of radar tab
  if (pid === 'radar' && !radarInitialized) {
    radarInitialized = true;
    setTimeout(() => { initRadar(); }, 100);
  }
  if (pid === 'space') {
    initSpace();
  }
  if (pid === 'firecams') {
    initFireCams();
  }
  if (pid === 'military' && !militaryInitialized) {
    militaryInitialized = true;
    loadMilitaryNews();
    // Maps need the container visible & sized before init
    setTimeout(() => { initMilAirMap(); initFleetMap(); }, 200);
  } else if (pid === 'military') {
    // Re-fix map sizing on return to tab
    setTimeout(() => { if (milAirMap) milAirMap.invalidateSize(); if (fleetMap) fleetMap.invalidateSize(); }, 150);
  }
}
let militaryInitialized = false;

let fireCamsChecked = false;
function initFireCams(){
  if (fireCamsChecked) return;
  fireCamsChecked = true;
  const frame = document.getElementById('firecam-frame');
  const fallback = document.getElementById('firecam-fallback');
  if (!frame || !fallback) return;
  // If the iframe fails to load (X-Frame-Options / CSP block), show fallback.
  // We can't read cross-origin frame contents, so we use a load-timeout heuristic:
  // if 'load' hasn't fired within 4s, assume it's blocked.
  let loaded = false;
  frame.addEventListener('load', () => { loaded = true; });
  frame.addEventListener('error', () => showFireFallback());
  setTimeout(() => { if (!loaded) showFireFallback(); }, 4500);
  function showFireFallback(){
    frame.style.display = 'none';
    fallback.style.display = 'flex';
  }
}

document.querySelectorAll('.ntab').forEach(t=>{
  t.addEventListener('click',()=>{
    activateTab(t.dataset.p);
    history.replaceState(null, '', '#'+t.dataset.p);
  });
});

/* ── GROUP NAV (dropdowns) ── */
const TAB_GROUP = {
  streams:'ops', traffic:'ops', radar:'ops', firecams:'ops',
  space:'intel', military:'intel', osint:'intel', intel:'intel',
  news:'news', elections:'news', weather:'news',
  status:'system',
};
function toggleGroup(g){
  const grp = document.querySelector(`.ngroup[data-g="${g}"]`);
  const wasOpen = grp.classList.contains('open');
  document.querySelectorAll('.ngroup').forEach(x=>x.classList.remove('open'));
  if (!wasOpen) grp.classList.add('open');
}
// Group menu items activate the tab, then close the menu
document.querySelectorAll('.ngitem').forEach(it=>{
  it.addEventListener('click',()=>{
    const pid = it.dataset.p;
    activateTab(pid);
    history.replaceState(null, '', '#'+pid);
    document.querySelectorAll('.ngroup').forEach(x=>x.classList.remove('open'));
  });
});
// Close dropdowns when clicking outside
document.addEventListener('click',(e)=>{
  if (!e.target.closest('#navgroups')) document.querySelectorAll('.ngroup').forEach(x=>x.classList.remove('open'));
});
// Highlight the active tab within its group + mark the group button
function syncGroupNav(pid){
  const g = TAB_GROUP[pid];
  document.querySelectorAll('.ngroup').forEach(x=>x.classList.remove('hasactive'));
  document.querySelectorAll('.ngitem').forEach(x=>x.classList.toggle('active', x.dataset.p===pid));
  if (g) document.querySelector(`.ngroup[data-g="${g}"]`)?.classList.add('hasactive');
}

// Open the tab specified in the URL hash (from portal quick-launch links)
function openHashTab(){
  const hash = (location.hash || '').replace('#','');
  const valid = ['streams','news','traffic','radar','space','military','elections','weather','firecams','osint','intel','status'];
  if (valid.includes(hash)) activateTab(hash);
}
window.addEventListener('hashchange', openHashTab);
openHashTab();

/* ══════════════════════════════════════
   SOURCE HEALTH TRACKER  (feeds the Status tab)
══════════════════════════════════════ */
const SRC_HEALTH = {}; // { name: { ok, lastSuccess, lastAttempt, lastError } }

function markHealth(name, ok, errMsg){
  const h = SRC_HEALTH[name] || (SRC_HEALTH[name] = { ok:null, lastSuccess:0, lastAttempt:0, lastError:'' });
  h.lastAttempt = Date.now();
  h.ok = ok;
  if (ok) { h.lastSuccess = Date.now(); h.lastError = ''; }
  else if (errMsg) h.lastError = String(errMsg).slice(0, 120);
}

function healthAge(ts){
  if(!ts) return 'never';
  const m = Math.floor((Date.now()-ts)/60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m/60);
  if (h < 24) return h + 'h ' + (m%60) + 'm ago';
  return Math.floor(h/24) + 'd ago';
}

function renderStatusPanel(){
  const el = document.getElementById('status-source-list');
  if (!el) return;
  const names = Object.keys(SRC_HEALTH).sort();
  if (!names.length){ el.innerHTML = '<div class="empty">No source activity recorded yet.</div>'; return; }
  el.innerHTML = '';
  names.forEach(name=>{
    const h = SRC_HEALTH[name];
    const staleMs = Date.now() - h.lastSuccess;
    // green: ok & fresh · yellow: ok but aging (>2× no success in 30m) · red: last attempt failed
    let color = 'var(--accent3)', label = 'OK';
    if (h.ok === false) { color = 'var(--danger)'; label = 'FAILING'; }
    else if (!h.lastSuccess || staleMs > 30*60*1000) { color = 'var(--warn)'; label = 'STALE'; }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--border)';
    row.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;box-shadow:0 0 8px ${color}"></span>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fu);font-weight:600;color:var(--text);font-size:.92rem">${name}</div>
        <div style="font-family:var(--fm);font-size:.7rem;color:var(--muted)">Last success: ${healthAge(h.lastSuccess)}${h.lastError?' · '+h.lastError:''}</div>
      </div>
      <span style="font-family:var(--fm);font-size:.66rem;letter-spacing:.08em;color:${color};border:1px solid ${color};padding:2px 8px;border-radius:3px">${label}</span>`;
    el.appendChild(row);
  });
  const ts = document.getElementById('status-updated');
  if (ts) ts.textContent = 'Updated ' + new Date().toLocaleTimeString();
  // Scheduler task list
  const tl = document.getElementById('status-task-list');
  if (tl){
    tl.innerHTML = SCHED_TASKS.map(t=>{
      const next = Math.max(0, Math.round((t.nextRun - Date.now())/1000));
      return `<div style="display:flex;justify-content:space-between;padding:5px 12px;border-bottom:1px solid var(--border);font-family:var(--fm);font-size:.72rem">
        <span style="color:var(--text2)">${t.name}</span>
        <span style="color:var(--muted)">every ${Math.round(t.ms/60000)>=1?Math.round(t.ms/60000)+'m':Math.round(t.ms/1000)+'s'} · next in ${next>=60?Math.round(next/60)+'m':next+'s'}</span>
      </div>`;
    }).join('');
  }
}

/* ══════════════════════════════════════
   VISIBILITY-AWARE SCHEDULER
   One master tick replaces scattered setIntervals. Tasks pause while the
   tab is hidden and resume STAGGERED on return — no thundering herd of
   simultaneous fetches (which is what got us rate-limited by CelesTrak).
══════════════════════════════════════ */
const SCHED_TASKS = [];

function sched(name, fn, ms, runNow = true){
  const task = { name, fn, ms, nextRun: Date.now() + (runNow ? 0 : ms) };
  SCHED_TASKS.push(task);
  return task;
}

setInterval(() => {
  if (document.hidden) return;           // pause everything while backgrounded
  const now = Date.now();
  for (const t of SCHED_TASKS) {
    if (now >= t.nextRun) {
      t.nextRun = now + t.ms;
      try { t.fn(); } catch(e) { console.log('[Sched]', t.name, 'error:', e.message); }
    }
  }
}, 2000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  // Tab just became visible — stagger any overdue tasks 1.5s apart
  const now = Date.now();
  let offset = 0;
  for (const t of SCHED_TASKS) {
    if (now >= t.nextRun) { t.nextRun = now + offset; offset += 1500; }
  }
});

/* ── INIT ── */
updateClocks();setInterval(updateClocks,1000);   // clock stays a plain interval (cheap, must never pause)
updateOCSun();          sched('OC Sun Times',    updateOCSun,        60*60*1000, false);
buildGroupBar();renderStreams();
renderAviationStreams();
renderNewsStreams();
loadWeather();          sched('Weather',        loadWeather,        10*60*1000, false);
loadNWS();              sched('NWS Alerts',     loadNWS,             5*60*1000, false);
loadLocalNews();        sched('Local News',     loadLocalNews,      10*60*1000, false);
loadNewsColumns();      sched('News Columns',   loadNewsColumns,    15*60*1000, false);
setTimeout(fetchAIDigest, 6000); // wait for news columns to populate first
                        sched('AI Digest',      fetchAIDigest,     8*60*60*1000, false);
loadQuakes();loadFires();loadFEMA();
                        sched('Quakes',         loadQuakes,         10*60*1000, false);
                        sched('Fires',          loadFires,          15*60*1000, false);
loadTicker();           sched('News Ticker',    loadTicker,         10*60*1000, false);
loadMarketTicker();     sched('Markets',        loadMarketTicker,       60*1000, false);
loadAirports();         sched('Airports',       loadAirports,        5*60*1000, false);
loadElectionNews();     sched('Election News',  loadElectionNews,   15*60*1000, false);
loadPotusSchedule();    sched('POTUS Schedule', loadPotusSchedule,  30*60*1000, false);
                        sched('Defense News',   loadMilitaryNews,   15*60*1000, false);
                        sched('Mil Aircraft Map', () => { if (milAirInited) loadMilAir(); }, 20*1000, false);
                        sched('Mil Aircraft Map', () => { if (milAirInited) loadMilAir(); }, 20*1000, false);
sched('Status Panel',   renderStatusPanel,      15*1000);
setNextElection();
