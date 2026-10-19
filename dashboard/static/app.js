"use strict";
const $ = (id) => document.getElementById(id);
const state = {csrf:null, overview:null, channel:"main", page:"dashboard", playerKey:null, hls:null, chartCPU:[], chartRAM:[], timer:null};
const providers = {telegram:"تلگرام",instagram:"اینستاگرام",aparat:"آپارات",youtube:"یوتیوب",twitch:"توییچ",custom:"RTMP اختصاصی"};
const providersIcons = {telegram:"bi-telegram",instagram:"bi-instagram",aparat:"bi-collection-play",youtube:"bi-youtube",twitch:"bi-twitch",custom:"bi-broadcast"};
const fa = (value) => Number(value || 0).toLocaleString("fa-IR");
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const duration = (seconds) => {const s=Math.floor(seconds||0);return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(v=>String(v).padStart(2,"0")).join(":");};
const size = (b) => b > 1024**3 ? (b/1024**3).toFixed(2)+" GB" : (b/1024**2).toFixed(1)+" MB";
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");window.clearTimeout(toast.t);toast.t=window.setTimeout(()=>el.classList.remove("show"),4500);}
async function api(path, opts={}){
  const headers = {"Accept":"application/json",...(opts.body && !(opts.body instanceof FormData)?{"Content-Type":"application/json"}:{}),...(state.csrf?{"X-CSRF-Token":state.csrf}:{})};
  const res = await fetch("/api"+path,{...opts,headers:{...headers,...opts.headers},credentials:"same-origin"});
  let data={}; try{data=await res.json();}catch(_){}
  if(res.status===401 && path!=="/login"){showLogin();throw new Error("نشست منقضی شد؛ دوباره وارد شوید.");}
  if(!res.ok)throw new Error(typeof data.detail==="string"?data.detail:"خطا در اجرای درخواست ("+res.status+")");
  return data;
}
function showLogin(){clearInterval(state.timer);state.timer=null;state.csrf=null;$("app").hidden=true;$("login-page").hidden=false;stopPlayer();}
async function bootstrap(){
  try{const s=await api("/session");if(!s.authenticated){showLogin();return;}state.csrf=s.csrf;$("app").hidden=false;$("login-page").hidden=true;await refresh();if(state.timer)clearInterval(state.timer);state.timer=setInterval(()=>refresh().catch(e=>console.error(e)),5000);}catch(e){showLogin();}
}
async function login(event){event.preventDefault();$("login-error").textContent="";$("login-submit").disabled=true;
  try{const result=await api("/login",{method:"POST",body:JSON.stringify({username:$("username").value.trim(),password:$("password").value})});state.csrf=result.csrf;$("password").value="";await bootstrap();}
  catch(e){$("login-error").textContent=e.message;}finally{$("login-submit").disabled=false;}
}
function currentChannel(){return state.overview?.channels.find(c=>c.id===state.channel) || state.overview?.channels[0];}
function render(){
  const data=state.overview, channels=data.channels, media=data.media;
  if(!channels.some(c=>c.id===state.channel))state.channel=channels[0]?.id||"main";
  const selected=currentChannel();
  $("channel-select").innerHTML=channels.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");
  $("channel-select").value=state.channel;
  $("source-select").value=selected?.mode||"test";
  $("media-select").innerHTML='<option value="">انتخاب فایل...</option>'+media.map(m=>'<option value="'+esc(m.file)+'">'+esc(m.name)+'</option>').join("");
  $("media-select").value=selected?.file||"";
  $("media-select").disabled=$("source-select").value!=="file";
  $("preview-channel").textContent=selected?.name||"کانال اصلی";
  $("preview-title").textContent=selected?.name||"StreamCore";
  const active=!!selected?.running, desired=!!selected?.desired;
  $("channel-status").innerHTML='<span class="dot '+(active?"green":"gray")+'"></span> '+(active?"در حال اجرا":desired?"در حال راه‌اندازی":"متوقف");
  $("live-chip").textContent=active?"LIVE":"OFFLINE";$("live-chip").classList.toggle("live",active);
  $("start-channel").disabled=desired;$("stop-channel").disabled=!desired;
  $("stream-error").textContent=selected?.error||"";
  $("stat-live").textContent=fa(channels.filter(c=>c.running).length);
  $("stat-cpu").textContent=fa(data.system.cpu)+"٪";
  $("stat-ram").textContent=fa(data.system.ram)+"٪";
  $("stat-ramtotal").textContent="از "+fa(data.system.total_ram)+" گیگابایت RAM";
  $("stat-media").textContent=fa(media.length);
  const url=location.origin+"/live/"+state.channel+"/index.m3u8";
  $("hls-url").textContent=url;
  renderMedia(media);renderChannels(channels);renderDestinations(data.destinations || [], channels);renderChart(data.system.cpu,data.system.ram);
  const playerKey=state.channel+":"+(active?"live":"off");
  if(playerKey!==state.playerKey){state.playerKey=playerKey;updatePlayer(url,active);}
}
function stopPlayer(){if(state.hls){state.hls.destroy();state.hls=null;}const vid=$("player");vid.pause();vid.removeAttribute("src");vid.load();state.playerKey=null;}
function updatePlayer(url,active){
  stopPlayer();state.playerKey=state.channel+":"+(active?"live":"off");
  $("preview-empty").hidden=active;
  if(!active)return;
  const video=$("player");
  if(window.Hls && Hls.isSupported()){
    state.hls=new Hls({liveSyncDurationCount:3,maxBufferLength:12});
    state.hls.loadSource(url);state.hls.attachMedia(video);
    state.hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));
    state.hls.on(Hls.Events.ERROR,(_ev,info)=>{if(info.fatal){$("preview-empty").hidden=false;$("preview-empty").querySelector("span").textContent="در حال دریافت سیگنال HLS؛ چند ثانیه دیگر دوباره بررسی می‌شود.";state.hls?.startLoad();}});
  }else if(video.canPlayType("application/vnd.apple.mpegurl")){video.src=url;video.play().catch(()=>{});}
  else {$("preview-empty").hidden=false;$("preview-empty").querySelector("span").textContent="مرورگر شما از HLS پشتیبانی نمی‌کند یا کتابخانه پخش بارگذاری نشده است.";}
}
function renderMedia(media){
  const html=media.slice(0,6).map(m=>'<tr><td><span class="media-name"><span class="media-thumb"><i class="bi bi-film"></i></span>'+esc(m.name)+'</span></td><td dir="ltr">'+duration(m.duration)+'</td><td dir="ltr">'+size(m.bytes)+'</td><td><button class="mini-action" data-use="'+esc(m.file)+'">انتخاب برای کانال</button></td></tr>').join("");
  $("media-queue").innerHTML=html;$("media-empty").hidden=media.length>0;
  $("media-library").innerHTML=media.map(m=>'<tr><td>'+esc(m.name)+'</td><td dir="ltr">'+duration(m.duration)+'</td><td dir="ltr">'+size(m.bytes)+'</td><td><button class="mini-action" data-use="'+esc(m.file)+'">انتخاب</button> <button class="mini-action danger" data-remove-media="'+m.id+'">حذف</button></td></tr>').join("") || '<tr><td colspan="4" class="empty-state">هیچ رسانه‌ای موجود نیست.</td></tr>';
  $("media-count").textContent=fa(media.length)+" فایل";
}
function renderDestinations(destinations, channels){
  const select=$("dest-channel");
  const old=select.value;
  const current=channels.map(c=>c.id).join(",");
  if(select.dataset.channelIds!==current){
    select.innerHTML=channels.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");
    select.dataset.channelIds=current;
    select.value=channels.some(c=>c.id===old)?old:(state.channel || "main");
  }
  $("dest-total").textContent=fa(destinations.length)+" مقصد";
  $("destination-list").innerHTML=destinations.map(d=>{
    const status=d.sending?"در حال ارسال":d.enabled?"در انتظار اتصال":"غیرفعال";
    const klass=d.sending?"green":"gray";
    return '<article class="destination-row"><div class="destination-icon"><i class="bi '+(providersIcons[d.platform]||"bi-broadcast")+'"></i></div>'
      +'<div class="destination-info"><strong>'+esc(d.label)+'</strong>'
      +'<span>'+esc(providers[d.platform]||d.platform)+' · '+esc(d.server_host)+' · '+esc(d.channel_id)+'</span>'
      +'<small><span class="dot '+klass+'"></span>'+status+(d.error?' · '+esc(d.error):'')+'</small></div>'
      +'<div class="destination-actions"><button class="mini-action" data-toggle-dest="'+esc(d.id)+'" data-next="'+(d.enabled?'false':'true')+'">'+(d.enabled?"غیرفعال کردن":"فعال کردن")+'</button>'
      +'<button class="mini-action" data-rotate-dest="'+esc(d.id)+'">تغییر کلید</button>'
      +'<button class="mini-action danger" data-delete-dest="'+esc(d.id)+'">حذف</button></div></article>';
  }).join("") || '<p class="empty-state">خروجی‌ای ثبت نشده است؛ یک مقصد RTMP اضافه کنید.</p>';
}

function renderChannels(channels){
  $("channel-cards").innerHTML=channels.map(c=>'<article class="channel-card"><div class="status-row"><span class="dot '+(c.running?"green":"gray")+'"></span> '+(c.running?"پخش فعال":c.desired?"در حال اتصال":"متوقف")+'</div><h3>'+esc(c.name)+'</h3><div class="channel-id">/live/'+esc(c.id)+'/index.m3u8</div><div class="card-actions"><button class="primary" data-manage="'+esc(c.id)+'"><i class="bi bi-sliders"></i> مدیریت</button>'+ (c.id==="main"?"":'<button class="mini-action danger" data-remove-channel="'+esc(c.id)+'">حذف</button>') +'</div></article>').join("");
}
function renderChart(cpu,ram){
  state.chartCPU.push(cpu);state.chartRAM.push(ram);
  if(state.chartCPU.length>48){state.chartCPU.shift();state.chartRAM.shift();}
  const canvas=$("metric-chart"), box=canvas.getBoundingClientRect();if(!box.width)return;
  const ratio=window.devicePixelRatio||1;canvas.width=Math.round(box.width*ratio);canvas.height=Math.round(145*ratio);
  const ctx=canvas.getContext("2d");ctx.scale(ratio,ratio);const w=box.width,h=145;
  ctx.clearRect(0,0,w,h);ctx.strokeStyle="#273443";ctx.lineWidth=1;
  for(let i=1;i<5;i++){const y=(h-12)*i/5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  function line(values,color){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2;values.forEach((v,i)=>{const x=(i/Math.max(values.length-1,1))*w;const y=h-10-Math.min(100,Math.max(0,v))*(h-20)/100;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}
  line(state.chartCPU,"#0bdaad");line(state.chartRAM,"#ff682b");
}
async function refresh(){state.overview=await api("/overview");render();}
function page(pageName){
  state.page=pageName;
  document.querySelectorAll("[data-view]").forEach(el=>el.hidden=el.dataset.view!==pageName);
  document.querySelectorAll("[data-page]").forEach(el=>el.classList.toggle("active",el.dataset.page===pageName));
  $("page-heading").textContent=({dashboard:"داشبورد استریم",channels:"کانال‌ها",media:"کتابخانه رسانه",system:"وضعیت سیستم",destinations:"پخش چندمقصدی"})[pageName];
  $("app").classList.remove("menu-open");
}
async function action(path,opts){try{await api(path,opts);await refresh();return true;}catch(e){toast(e.message);return false;}}
function json(data){return JSON.stringify(data);}
async function selectMedia(name){if(!name)return;const ok=await action("/channels/"+state.channel+"/configure",{method:"POST",body:json({mode:"file",file:name})});if(ok){toast("منبع ذخیره شد؛ برای اجرا شروع پخش را بزنید.");page("dashboard");}}
function setup(){
  $("login-form").addEventListener("submit",login);
  $("logout").addEventListener("click",async()=>{try{await api("/logout",{method:"POST"});}finally{showLogin();}});
  document.querySelectorAll("[data-page]").forEach(el=>el.addEventListener("click",()=>page(el.dataset.page)));
  document.querySelectorAll("[data-goto]").forEach(el=>el.addEventListener("click",()=>page(el.dataset.goto)));
  $("menu-toggle").addEventListener("click",()=>$("app").classList.toggle("menu-open"));
  $("channel-select").addEventListener("change",(e)=>{state.channel=e.target.value;render();});
  $("source-select").addEventListener("change",()=>$("media-select").disabled=$("source-select").value!=="file");
  $("start-channel").addEventListener("click",()=>action("/channels/"+state.channel+"/start",{method:"POST"}));
  $("stop-channel").addEventListener("click",()=>action("/channels/"+state.channel+"/stop",{method:"POST"}));
  $("save-source").addEventListener("click",async()=>{
    const mode=$("source-select").value,file=$("media-select").value;
    if(mode==="file"&&!file){toast("ابتدا یک فایل ویدئویی انتخاب کنید.");return;}
    const ok=await action("/channels/"+state.channel+"/configure",{method:"POST",body:json({mode,file:mode==="file"?file:null})});
    if(ok)toast("منبع کانال ثبت شد؛ در صورت نیاز پخش را دوباره شروع کنید.");
  });
  $("copy-hls").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("hls-url").textContent);toast("لینک HLS کپی شد.");}catch(_){toast("کپی در این مرورگر مجاز نیست؛ لینک را دستی انتخاب کنید.");}});
  $("create-channel").addEventListener("click",openModal);document.querySelectorAll("[data-create]").forEach(el=>el.addEventListener("click",openModal));
  $("modal-close").addEventListener("click",closeModal);$("modal").addEventListener("click",e=>{if(e.target===$("modal"))closeModal();});
  $("channel-form").addEventListener("submit",async(e)=>{e.preventDefault();const id=$("new-channel-id").value.trim(),name=$("new-channel-name").value.trim();const ok=await action("/channels",{method:"POST",body:json({id,name})});if(ok){state.channel=id;closeModal();page("dashboard");await refresh();toast("کانال ساخته شد.");}});
  $("destination-form").addEventListener("submit",async(e)=>{
    e.preventDefault();
    const body={channel_id:$("dest-channel").value,platform:$("dest-platform").value,label:$("dest-label").value.trim(),
      server_url:$("dest-server").value.trim(),stream_key:$("dest-key").value,enabled:false};
    $("dest-submit").disabled=true;
    try{await api("/destinations",{method:"POST",body:json(body)});$("destination-form").reset();await refresh();toast("مقصد با موفقیت ذخیره شد؛ اکنون می‌توانید آن را فعال کنید.");}
    catch(err){toast(err.message);}finally{$("dest-submit").disabled=false;}
  });
  $("upload-form").addEventListener("submit",async(e)=>{
    e.preventDefault();const file=$("media-file").files[0];if(!file)return;
    const form=new FormData();form.append("file",file);$("upload-btn").disabled=true;$("upload-result").textContent="در حال آپلود و بررسی کدک ویدئو...";
    try{const result=await api("/media",{method:"POST",body:form});$("upload-result").textContent="آپلود موفق: "+result.name;$("media-file").value="";await refresh();toast("رسانه اضافه شد.");}
    catch(err){$("upload-result").textContent=err.message;toast(err.message);}finally{$("upload-btn").disabled=false;}
  });
  document.addEventListener("click",async(e)=>{
    const destToggle=e.target.closest("[data-toggle-dest]");
    if(destToggle){await action("/destinations/"+destToggle.dataset.toggleDest,{method:"PATCH",body:json({enabled:destToggle.dataset.next==="true"})});return;}
    const destDelete=e.target.closest("[data-delete-dest]");
    if(destDelete){if(confirm("این خروجی و کلید ذخیره‌شده آن حذف شوند؟"))await action("/destinations/"+destDelete.dataset.deleteDest,{method:"DELETE"});return;}
    const destRotate=e.target.closest("[data-rotate-dest]");
    if(destRotate){const key=prompt("کلید جدید استریم را وارد کنید (کلید ذخیره‌شده هرگز نمایش داده نمی‌شود):");
      if(key)await action("/destinations/"+destRotate.dataset.rotateDest,{method:"PATCH",body:json({stream_key:key})});return;}
    const use=e.target.closest("[data-use]");if(use){await selectMedia(use.dataset.use);return;}
    const manage=e.target.closest("[data-manage]");if(manage){state.channel=manage.dataset.manage;page("dashboard");render();return;}
    const rm=e.target.closest("[data-remove-media]");if(rm){if(confirm("فایل ویدئویی از سرور حذف شود؟"))await action("/media/"+rm.dataset.removeMedia,{method:"DELETE"});return;}
    const rmch=e.target.closest("[data-remove-channel]");if(rmch){if(confirm("کانال حذف شود؟"))await action("/channels/"+rmch.dataset.removeChannel,{method:"DELETE"});return;}
  });
  window.addEventListener("resize",()=>{if(state.overview)renderChart(state.overview.system.cpu,state.overview.system.ram);});
}
function openModal(){$("modal").hidden=false;$("new-channel-name").focus();}
function closeModal(){$("modal").hidden=true;$("channel-form").reset();}
setup();bootstrap();
