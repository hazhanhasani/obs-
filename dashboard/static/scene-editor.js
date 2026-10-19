"use strict";
/* Scene editor: layout preview uses authenticated media posters; live encoder
   output is viewed in the dashboard after saving. Works on touch and mouse. */
(function(){
  const $=(id)=>document.getElementById(id);
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const safe=(x)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let api,overview,page,toast,appState;
  let channel=null,baseFile=null,layers=[],textLayers=[],selected=null,dirty=false,drag=null;
  let canvasPreset="landscape";
  let pendingRender=false, saving=false, lastResize=null;
  let draftVersion=0, actualPreviewUrl=null, previewRendering=false;
  let media=[],loadSequence=0;
  const fieldNames=["x","y","w","h","opacity"];
  const MIN_POSITION=-200,MAX_POSITION=200,MIN_SIZE=5,MAX_SIZE=200;
  const tenth=(v)=>Math.round(v*10)/10;
  const cornerHandles=()=>["nw","ne","sw","se"].map(corner=>
    '<span class="scene-handle scene-handle-'+corner+'" data-resize-corner="'+corner+
    '" title="Resize '+corner+'" aria-hidden="true"></span>').join("");
  function applyTransform(item,geometry){
    for(const key of ["x","y","w","h"])item[key]=tenth(geometry[key]);
  }
  // Keep the opposite edges anchored when dragging each corner (OBS-style).
  // Do not clamp to viewport. Server and FFmpeg clip only the *output*.
  function transformFromGesture(initial,corner,dx,dy){
    if(!corner)return {x:clamp(tenth(initial.x+dx),MIN_POSITION,MAX_POSITION),
      y:clamp(tenth(initial.y+dy),MIN_POSITION,MAX_POSITION),
      w:initial.w,h:initial.h};
    const movingLeft=corner.includes("w"),movingTop=corner.includes("n");
    const left=initial.x,right=initial.x+initial.w;
    const top=initial.y,bottom=initial.y+initial.h;
    // Both size and position limits apply to the MOVING edge. If we clamp
    // width only after computing x, a hard NW/SW drag shifts the opposite edge.
    const x=movingLeft?clamp(tenth(left+dx),
      Math.max(MIN_POSITION,right-MAX_SIZE),Math.min(MAX_POSITION,right-MIN_SIZE)):left;
    const y=movingTop?clamp(tenth(top+dy),
      Math.max(MIN_POSITION,bottom-MAX_SIZE),Math.min(MAX_POSITION,bottom-MIN_SIZE)):top;
    const w=movingLeft?tenth(right-x):clamp(tenth(initial.w+dx),MIN_SIZE,MAX_SIZE);
    const h=movingTop?tenth(bottom-y):clamp(tenth(initial.h+dy),MIN_SIZE,MAX_SIZE);
    return {x,y,w:clamp(w,MIN_SIZE,MAX_SIZE),h:clamp(h,MIN_SIZE,MAX_SIZE)};
  }
  const outputDimensions={landscape:[1280,720],portrait:[720,1280],portrait_fullhd:[1080,1920]};
  const outputSize=()=>outputDimensions[canvasPreset]||outputDimensions.landscape;
  function applyCanvas(){
    const [w,h]=outputSize(),portrait=h>w;
    const canvas=$("scene-canvas");
    canvas.style.aspectRatio=w+"/"+h;
    canvas.dataset.orientation=portrait?"portrait":"landscape";
    $("scene-render-image").style.aspectRatio=w+"/"+h;
    $("scene-render-image").dataset.orientation=portrait?"portrait":"landscape";
    $("scene-resolution").textContent=w+" × "+h;
    $("scene-ratio-heading").textContent="پیش‌نمایش چیدمان "+(portrait?"۹:۱۶":"۱۶:۹");
    $("scene-canvas-preset").value=canvasPreset;
  }
  const byFile=(name)=>media.find(m=>m.file===name);
  const getLayer=(id)=>layers.find(l=>l.layer_id===id)||textLayers.find(l=>l.layer_id===id);
  const isText=(l)=>!!l&&typeof l.text==="string";
  const normalize=(l)=>({...l,effect:l.effect||"none",start_sec:Number(l.start_sec)||0,
    duration_sec:Number(l.duration_sec)||0,repeat_sec:Number(l.repeat_sec)||0});
  const poster=(name)=>{const m=byFile(name);return m?"/api/media/poster/"+m.id:"";};
  const fileName=(name)=>byFile(name)?.name||"Unknown file";
  function invalidateActualPreview(){
    draftVersion++;
    const frame=$("scene-render-image");
    frame.hidden=true;
    frame.removeAttribute("src");
    if(actualPreviewUrl){URL.revokeObjectURL(actualPreviewUrl);actualPreviewUrl=null;}
    $("scene-render-status").textContent="چیدمان تغییر کرده است؛ برای تطبیق با خروجی تلگرام، دوباره «رندر خروجی» را بزنید.";
  }
  function markDirty(){
    dirty=true;
    $("scene-draft-indicator").hidden=false;
    invalidateActualPreview();
    $("scene-save").disabled=false;
    $("scene-note").textContent="تغییرات ذخیره‌نشده‌اند. ابتدا رندر واقعی را بررسی کنید، سپس ذخیره کنید.";
  }
  function resetDirty(){
    dirty=false;
    $("scene-draft-indicator").hidden=true;
    $("scene-save").disabled=true;
    $("scene-note").textContent="صحنه ذخیره شد. این پیش‌نمایش قابل ویرایش و تقریبی است؛ برای تطبیق دقیق از رندر FFmpeg استفاده کنید.";
  }
  function fillChoices(){
    const choices=media.filter(m=>m.kind==="video").map(m=>'<option value="'+safe(m.file)+'">'+safe(m.name)+'</option>').join("");
    const selectedBase=baseFile;
    $("scene-base").innerHTML='<option value="">پس‌زمینه آزمایشی متناسب با خروجی</option>'+choices;
    $("scene-base").value=selectedBase||"";
    const old=$("scene-media").value;
    $("scene-media").innerHTML=media.map(m=>'<option value="'+safe(m.file)+'">'+safe(m.name)+' ('+(m.kind==="image"?"تصویر":"ویدئو")+')</option>').join("")
      || '<option value="">ابتدا عکس یا ویدئو آپلود کنید</option>';
    if(media.some(m=>m.file===old))$("scene-media").value=old;
    $("scene-add").disabled=!media.length;
  }
  function preview(){
    // Never destroy the element under an active finger. Live overview polling,
    // media library refreshes and responsive layout changes may call preview().
    if(drag){pendingRender=true;return;}
    pendingRender=false;
    const bg=$("scene-base-image");
    // Use an actual FFmpeg testsrc2 frame, not muted CSS bars that disagree
    // with the published stream. Keep CSS bars only as an offline fallback.
    const src=baseFile?poster(baseFile):"/api/scene/test-pattern?preset="+encodeURIComponent(canvasPreset);
    bg.onerror=()=>{bg.hidden=true;$("scene-colorbars").hidden=false;};
    if(src){
      if(bg.getAttribute?.("src")!==src)bg.src=src;
      bg.hidden=false;
      $("scene-colorbars").hidden=true;
    }else{
      bg.hidden=true;bg.removeAttribute("src");
      $("scene-colorbars").hidden=false;
    }
    const mediaHtml=layers.map((l,i)=>{
      const m=byFile(l.media_file);
      const css='left:'+l.x+'%;top:'+l.y+'%;width:'+l.w+'%;height:'+l.h+'%;opacity:'+(l.opacity/100)+';';
      return '<div class="scene-item '+(selected===l.layer_id?"selected":"")+'" data-layer="'+safe(l.layer_id)+'" style="'+css+'" tabindex="0" role="button" aria-label="انتخاب لایه '+(i+1)+'">'
        +'<img draggable="false" src="'+poster(l.media_file)+'" style="object-fit:'+(l.fit==="stretch"?"fill":safe(l.fit))+'" alt="">'
        +(m?.kind==="video"?'<span class="scene-video-chip"><i class="bi bi-play-fill"></i> ویدئو</span>':'')
        +'<span class="scene-item-name">'+(i+1)+'</span>'+cornerHandles()+'</div>';
    });
    const textHtml=textLayers.map((l,i)=>{
      const css='left:'+l.x+'%;top:'+l.y+'%;width:'+l.w+'%;height:'+l.h+'%;opacity:'+(l.opacity/100)+';';
      const bg=l.background==="transparent"?"transparent":safe(l.background);
      const size=(l.font_size/outputSize()[0]*100).toFixed(3)+"cqw";
      return '<div class="scene-item scene-text-item '+(selected===l.layer_id?"selected":"")+'" data-layer="'+safe(l.layer_id)+'" style="'+css+'" tabindex="0" role="button" aria-label="متن '+(i+1)+'">'
        +'<span class="scene-text-content" dir="auto" style="font-size:'+size+';color:'+safe(l.color)+';text-align:'+safe(l.align)+';background:'+bg+';">'+safe(l.text)+'</span>'
        +'<span class="scene-item-name">T'+(i+1)+'</span>'+cornerHandles()+'</div>';
    });
    $("scene-items").innerHTML=[...mediaHtml,...textHtml].join("");
    function listItem(l,i,textLayer){
      const icon=textLayer?"bi-fonts":byFile(l.media_file)?.kind==="image"?"bi-image":"bi-film";
      const label=textLayer?l.text:fileName(l.media_file);
      return '<div class="scene-list-row '+(l.layer_id===selected?"active":"")+'" data-select-layer="'+safe(l.layer_id)+'">'
        +'<span class="scene-list-icon"><i class="bi '+icon+'"></i></span>'
        +'<span class="scene-list-name">'+safe(label)+'<small>'+(textLayer?"متن ":"رسانه ")+(i+1)+'</small></span>'
        +'<button data-layer-up="'+safe(l.layer_id)+'" class="mini-action" aria-label="بالا">↑</button>'
        +'<button data-layer-down="'+safe(l.layer_id)+'" class="mini-action" aria-label="پایین">↓</button>'
        +'<button data-layer-remove="'+safe(l.layer_id)+'" class="mini-action danger" aria-label="حذف">×</button></div>';
    }
    $("scene-layer-list").innerHTML=[
      ...layers.map((l,i)=>listItem(l,i,false)),
      ...textLayers.map((l,i)=>listItem(l,i,true))
    ].join("") || '<p class="empty-state">هنوز لایه‌ای اضافه نشده است.</p>';
    renderProperties();
    $("scene-counter").textContent=layers.length+" رسانه · "+textLayers.length+" متن";
  }
  function renderProperties(){
    const item=getLayer(selected),textItem=isText(item);
    $("scene-properties-empty").hidden=!!item;
    $("scene-properties").hidden=!item;
    if(!item)return;
    $("scene-current-label").textContent=textItem?"متن: "+item.text.slice(0,28):fileName(item.media_file);
    for(const n of fieldNames)$("scene-"+n).value=item[n];
    $("scene-effect").value=item.effect||"none";
    for(const n of ["start","duration","repeat"])$("scene-"+n).value=Number(item[n+"_sec"])||0;
    $("scene-fit-container").hidden=textItem;
    $("scene-text-properties").hidden=!textItem;
    if(textItem){
      const textarea=$("scene-text-input");
      // Do not reset the caret while typing Persian/English in the middle.
      if(document.activeElement!==textarea)textarea.value=item.text;
      $("scene-font-size").value=item.font_size;
      $("scene-text-color").value=item.color;
      $("scene-text-background").value=item.background;
      $("scene-text-align").value=item.align;
      $("scene-text-outline").value=item.outline;
    }else $("scene-fit").value=item.fit;
  }
  async function open(nextChannel){
    if(dirty && nextChannel!==channel && !confirm("تغییرات ذخیره نشده‌اند؛ کانال عوض شود؟"))return;
    const request=++loadSequence;
    try{
      const scene=await api("/channels/"+encodeURIComponent(nextChannel)+"/scene");
      if(request!==loadSequence)return;
      // Do not replace local gesture/draft data with a stale request response.
      if(drag || (dirty && channel===nextChannel)){
        toast("تغییرات ذخیره‌نشده حفظ شدند؛ ابتدا صحنه را ذخیره کنید.");
        return;
      }
      channel=nextChannel;
      invalidateActualPreview();
      $("scene-render-status").textContent=scene.mode==="scene"
        ?"این صحنه روی کانال انتخاب‌شده ذخیره شده است. برای مشاهده تصویر واقعی FFmpeg روی «رندر خروجی» بزنید."
        :"این کانال هنوز روی حالت پخش صحنه نیست. بعد از ذخیره و اعمال صحنه، منبع آن به Scene تغییر می‌کند.";
      baseFile=scene.base_file;
      canvasPreset=Object.prototype.hasOwnProperty.call(outputDimensions,scene.canvas_preset)
        ?scene.canvas_preset:"landscape";
      applyCanvas();
      layers=(scene.layers||[]).map(normalize);
      textLayers=(scene.text_layers||[]).map(normalize);
      selected=layers[0]?.layer_id||textLayers[0]?.layer_id||null;
      $("scene-channel").value=channel;
      fillChoices();preview();resetDirty();showOutputBindings();
    }catch(e){toast(e.message);}
  }
  function showOutputBindings(){
    const node=$("scene-output-bindings");
    if(!node || !overview || !channel)return;
    const chosen=(overview.channels||[]).find(item=>item.id===channel);
    if(!chosen){node.textContent="کانال انتخاب‌شده در سرور وجود ندارد.";return;}
    const bound=(overview.destinations||[]).filter(item=>item.channel_id===channel&&item.enabled);
    const otherTelegram=(overview.destinations||[]).filter(item=>
      item.platform==="telegram"&&item.enabled&&item.channel_id!==channel);
    const button=$("scene-go-telegram");
    const ids=[...new Set(otherTelegram.map(x=>x.channel_id))];
    if(button){button.hidden=ids.length!==1;button.dataset.channel=ids.length===1?ids[0]:"";}
    const output=[];
    if(chosen.encoder && ["stalled","no-data"].includes(chosen.encoder.state)){
      output.push("⚠️ پردازش FFmpeg صحنه گزارش سالم ندارد ("+chosen.encoder.state+"). خروجی زنده ممکن است به‌روز نباشد.");
    }
    if(chosen.mode!=="scene"){
      output.push("⚠️ کانال «"+channel+"» در حالت "+chosen.mode+
        " است؛ چیدمان استودیو تا هنگام ذخیره صحنه، منبع پخش نیست.");
    }else if(chosen.running){
      output.push("کانال "+channel+" در حالت Scene است و پردازش FFmpeg اجرا می‌شود؛ دریافت تلگرام جداگانه بررسی می‌شود.");
    }else{
      output.push("کانال "+channel+" در حالت Scene ذخیره شده، اما اکنون پخش آن فعال نیست.");
    }
    if(bound.length)output.push("مقصدهای فعال این کانال: "+bound.map(x=>x.label||x.platform).join("، "));
    else output.push("مقصد خارجی فعالی برای این کانال تنظیم نشده است.");
    if(otherTelegram.length)output.push("⚠️ تلگرام فعال روی کانال دیگر: "+
      [...new Set(otherTelegram.map(x=>x.channel_id))].join("، "));
    node.textContent=output.join("\n");
    node.dataset.warning=(chosen.mode!=="scene"||otherTelegram.length||
      ["stalled","no-data"].includes(chosen.encoder?.state))?"true":"false";
  }
  function sync(data){
    overview=data;
    showOutputBindings();
    const old=media.map(x=>x.file+":"+x.kind).join(",");
    media=data.media||[];
    const channelOptions=(data.channels||[]).map(c=>'<option value="'+safe(c.id)+'">'+safe(c.name)+'</option>').join("");
    if($("scene-channel").dataset.ids!==(data.channels||[]).map(c=>c.id).join(",")){
      $("scene-channel").dataset.ids=(data.channels||[]).map(c=>c.id).join(",");
      $("scene-channel").innerHTML=channelOptions;
    }
    if(channel)$("scene-channel").value=channel;
    if(old!==media.map(x=>x.file+":"+x.kind).join(",") || !channel){fillChoices();if(channel)preview();}
  }
  function inputChanged(){
    const item=getLayer(selected);if(!item)return;
    for(const n of fieldNames){
      const input=$("scene-"+n),value=Number(input.value);
      if(!Number.isFinite(value))continue;
      item[n]=n==="opacity"?clamp(Math.round(value),10,100):
        n==="w"||n==="h"?clamp(tenth(value),MIN_SIZE,MAX_SIZE):
        clamp(tenth(value),MIN_POSITION,MAX_POSITION);
    }
    // Off-canvas staging is deliberate: x/y may be negative or >100.

    item.effect=$("scene-effect").value;
    for(const n of ["start","duration","repeat"]){
      const num=Number($("scene-"+n).value);
      item[n+"_sec"]=clamp(Number.isFinite(num)?num:0,0,3600);
    }
    if(isText(item)){
      item.text=$("scene-text-input").value.slice(0,240);
      item.font_size=clamp(Number($("scene-font-size").value)||46,12,110);
      item.color=$("scene-text-color").value;
      item.background=$("scene-text-background").value;
      item.align=$("scene-text-align").value;
      item.outline=clamp(Number($("scene-text-outline").value)||0,0,5);
    }else item.fit=$("scene-fit").value;
    markDirty();preview();
  }
  // Do not reconstruct the layer DOM while a pointer is active: replacing the
  // touched element loses Pointer Capture on mobile and snaps the size back.
  function activateLayer(id){
    selected=id;
    $("scene-items").querySelectorAll(".scene-item").forEach(el=>{
      el.classList.toggle("selected",el.dataset.layer===id);
    });
    $("scene-layer-list").querySelectorAll(".scene-list-row").forEach(el=>{
      el.classList.toggle("active",el.dataset.selectLayer===id);
    });
    renderProperties();
  }
  function select(id){if(drag){activateLayer(id);return;}selected=id;preview();}
  function changeOrder(id,delta){
    const collection=textLayers.some(l=>l.layer_id===id)?textLayers:layers;
    const i=collection.findIndex(l=>l.layer_id===id);
    const j=i+delta;
    if(i<0||j<0||j>=collection.length)return;
    [collection[i],collection[j]]=[collection[j],collection[i]];
    select(id);markDirty();
  }
  function addLayer(){
    const file=$("scene-media").value,m=byFile(file);
    if(!m){toast("ابتدا از بخش رسانه‌ها فایل آپلود کنید.");return;}
    if(layers.length>=8){toast("حداکثر ۸ لایه برای هر صحنه مجاز است.");return;}
    const count=layers.filter(l=>byFile(l.media_file)?.kind===m.kind).length;
    if((m.kind==="video"&&count>=3)||(m.kind==="image"&&count>=5)){toast("حداکثر ۳ لایه ویدئو و ۵ تصویر پشتیبانی می‌شود.");return;}
    const n=layers.length;
    const id="layer_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,7);
    layers.push({layer_id:id,media_file:file,x:clamp(10+(n%4)*8,0,60),
      y:clamp(10+(n%3)*10,0,65),w:30,h:27,fit:"contain",opacity:100,
      effect:"none",start_sec:0,duration_sec:0,repeat_sec:0});
    select(id);markDirty();
  }
  function addText(){
    if(textLayers.length>=5){toast("حداکثر پنج لایه متن مجاز است.");return;}
    const id="text_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,7);
    textLayers.push({layer_id:id,text:"متن جدید",x:20,y:40,w:56,h:20,
      font_size:46,color:"#ffffff",background:"transparent",align:"right",
      outline:2,opacity:100,effect:"fade",start_sec:0,duration_sec:0,repeat_sec:0});
    select(id);markDirty();
  }
  function previewEffect(){
    const item=getLayer(selected);if(!item)return;
    const element=$("scene-items").querySelector('[data-layer="'+item.layer_id+'"]');
    if(!element)return;
    for(const cls of ["fx-fade","fx-slide-left","fx-slide-right","fx-blink"])element.classList.remove(cls);
    void element.offsetWidth;
    const effect="fx-"+item.effect;
    if(["fx-fade","fx-slide-left","fx-slide-right","fx-blink"].includes(effect))element.classList.add(effect);
    else toast("این لایه افکت حرکتی ندارد.");
  }
  async function renderActualPreview(){
    if(!channel || previewRendering || drag || saving)return;
    previewRendering=true;
    const currentDraft=draftVersion, activeChannel=channel;
    const button=$("scene-render-actual");
    button.disabled=true;
    $("scene-render-status").textContent="در حال ساخت فریم واقعی FFmpeg روی VPS؛ لطفاً صبر کنید...";
    try{
      const response=await fetch("/api/channels/"+encodeURIComponent(activeChannel)+"/scene/preview",{
        method:"POST",
        headers:{"Accept":"image/jpeg","Content-Type":"application/json",
          "X-CSRF-Token":appState?.csrf||""},
        credentials:"same-origin",
        body:JSON.stringify({base_file:baseFile||null,canvas_preset:canvasPreset,layers,text_layers:textLayers})
      });
      if(!response.ok){
        let message="رندر واقعی ناموفق بود (HTTP "+response.status+").";
        try{const data=await response.json();if(typeof data.detail==="string")message=data.detail;}catch(_){}
        throw new Error(message);
      }
      const data=await response.blob();
      if(currentDraft!==draftVersion || channel!==activeChannel){
        $("scene-render-status").textContent="چیدمان در زمان رندر تغییر کرد؛ دوباره رندر بگیرید.";
        return;
      }
      if(data.type && !data.type.includes("image/jpeg"))throw new Error("سرور تصویر JPEG معتبر برنگرداند.");
      const url=URL.createObjectURL(data);
      const frame=$("scene-render-image");
      if(actualPreviewUrl)URL.revokeObjectURL(actualPreviewUrl);
      actualPreviewUrl=url;
      frame.src=url;frame.hidden=false;
      $("scene-render-status").textContent="این تصویر از همان فیلترهای FFmpeg خروجی کانال ساخته شده، پیش از ذخیره و بدون قطع پخش.";
    }catch(error){
      $("scene-render-status").textContent=error.message;
      toast(error.message);
    }finally{
      previewRendering=false;
      button.disabled=false;
    }
  }
  async function save(){
    if(!channel)return;
    if(drag || saving){toast("ابتدا حرکت انگشت را تمام کنید.");return;}
    saving=true;
    const button=$("scene-save");
    button.disabled=true;button.textContent="در حال ذخیره و اعمال...";
    try{
      const response=await api("/channels/"+encodeURIComponent(channel)+"/scene",{
        method:"PUT",body:JSON.stringify({base_file:baseFile||null,canvas_preset:canvasPreset,layers,text_layers:textLayers})
      });
      // Only report success after the API returns persisted layer geometry.
      const remote=response.scene;
      const matches=(local,stored)=>Array.isArray(stored) && local.length===stored.length
        && local.every((l,index)=>["layer_id","x","y","w","h"].every(k=>String(l[k])===String(stored[index][k])));
      if(!remote || remote.canvas_preset!==canvasPreset || !matches(layers,remote.layers) || !matches(textLayers,remote.text_layers)){
        throw new Error("سرور اندازه لایه را مطابق درخواست ذخیره نکرد؛ وضعیت را دوباره بررسی کنید.");
      }
      resetDirty();
      recordGeometry();
      try{overview=await api("/overview");showOutputBindings();}catch(_){/* periodic poll will refresh */}
      toast("چیدمان ذخیره شد. اگر کانال روشن باشد پخش برای اعمال صحنه دوباره راه‌اندازی می‌شود.");
    }catch(e){toast(e.message);button.disabled=false;}
    finally{saving=false;button.textContent="ذخیره و اعمال صحنه";}
  }
  // Pointer capture belongs to the persistent scene-items container, not to
  // .scene-item nodes regenerated during preview updates.
  function getCanvasSize(){
    const rect=$("scene-canvas").getBoundingClientRect();
    return {width:rect.width,height:rect.height};
  }
  function recordGeometry(){
    const item=getLayer(selected);
    if(!item)return;
    lastResize={id:item.layer_id,x:item.x,y:item.y,w:item.w,h:item.h};
    $("scene-gesture-status").textContent=
      "X: "+item.x+"٪  Y: "+item.y+"٪  عرض: "+item.w+"٪  ارتفاع: "+item.h+"٪";
  }
  function onPointerDown(e){
    if(drag && drag.captureLost && e.pointerId!==drag.pointerId){
      pointerDone({pointerId:drag.pointerId,type:"pointercancel"});
    }
    if(drag || (e.pointerType==="mouse" && e.button!==0))return;
    const el=e.target?.closest?.(".scene-item");
    if(!el)return;
    const item=getLayer(el.dataset.layer);
    if(!item)return;
    const canvas=getCanvasSize();
    if(canvas.width<=0 || canvas.height<=0)return;
    const handle=e.target?.closest?.("[data-resize-corner]");
    const corner=handle?.dataset?.resizeCorner||
      (e.target?.closest?.(".scene-handle")?"se":null);
    const resize=!!corner;
    drag={
      pointerId:e.pointerId,id:item.layer_id,
      startX:e.clientX,startY:e.clientY,
      x:item.x,y:item.y,w:item.w,h:item.h,
      width:canvas.width,height:canvas.height,
      type:resize?"resize":"move",corner,changed:false
    };
    activateLayer(item.layer_id);
    $("scene-canvas").classList.add("scene-gesturing");
    recordGeometry();
    // Mobile Chromium can report a lost capture after rotation/scroll,
    // and WebViews may reject capture. Window listeners provide a fallback.
    try{$("scene-items").setPointerCapture?.(e.pointerId);}catch(_){}
    e.preventDefault?.();
  }
  function onPointerMove(e){
    if(!drag || e.pointerId!==drag.pointerId)return;
    const l=getLayer(drag.id);if(!l)return;
    // Use the current canvas dimensions if viewport changes during a gesture.
    const current=getCanvasSize();
    const width=current.width>0?current.width:drag.width;
    const height=current.height>0?current.height:drag.height;
    const dx=(e.clientX-drag.startX)*100/width;
    const dy=(e.clientY-drag.startY)*100/height;
    const old=[l.x,l.y,l.w,l.h];
    applyTransform(l,transformFromGesture(drag,drag.corner,dx,dy));
    const node=$("scene-items").querySelector('[data-layer="'+l.layer_id+'"]');
    if(node)Object.assign(node.style,{
      left:l.x+"%",top:l.y+"%",width:l.w+"%",height:l.h+"%"
    });
    for(const name of ["x","y","w","h"])$("scene-"+name).value=l[name];
    recordGeometry();
    if(old.some((value,i)=>value!==[l.x,l.y,l.w,l.h][i])){
      drag.changed=true;
      markDirty();
    }
    e.preventDefault?.();
  }
  function pointerDone(e){
    if(!drag || e.pointerId!==drag.pointerId)return;
    if(e.type==="pointerup")onPointerMove(e);
    const completed=drag;
    drag=null;
    $("scene-canvas").classList.remove("scene-gesturing");
    const root=$("scene-items");
    try{
      if(root.hasPointerCapture?.(e.pointerId))root.releasePointerCapture(e.pointerId);
    }catch(_){}
    if(completed.changed || pendingRender)preview();
  }
  function onCaptureLost(e){
    // Unexpected capture loss must NOT abort the drag on Android. Keep the
    // gesture alive: window pointermove/up listeners continue tracking it.
    if(!drag || e.pointerId!==drag.pointerId)return;
    drag.captureLost=true;
    // If a WebView never sends pointerup, the following real pointerdown
    // can safely finalize the old draft before starting another gesture.
  }
  function centerSelected(){
    if(drag)return;
    const l=getLayer(selected);if(!l)return;
    l.x=tenth((100-l.w)/2);l.y=tenth((100-l.h)/2);
    markDirty();preview();recordGeometry();
  }
  function resizeSelected(width,height){
    if(drag)return;
    const layer=getLayer(selected);if(!layer)return;
    // Size presets alter dimensions only. Never reposition an intentionally
    // off-canvas overlay; use "Center layer" for explicit recovery.
    layer.w=clamp(width,MIN_SIZE,MAX_SIZE);
    layer.h=clamp(height,MIN_SIZE,MAX_SIZE);
    markDirty();preview();recordGeometry();
  }
  function init(deps){
    api=deps.api;toast=deps.toast;page=deps.page;appState=deps.state;
    $("scene-channel").addEventListener("change",e=>open(e.target.value));
    $("scene-go-telegram").addEventListener("click",async()=>{
      const target=$("scene-go-telegram").dataset.channel;
      if(target && target!==channel)await open(target);
    });
    $("scene-base").addEventListener("change",e=>{baseFile=e.target.value||null;markDirty();preview();});
    $("scene-canvas-preset").addEventListener("change",e=>{
      if(drag || saving)return;
      if(!Object.prototype.hasOwnProperty.call(outputDimensions,e.target.value))return;
      canvasPreset=e.target.value;applyCanvas();markDirty();preview();
    });
    $("scene-center-selected").addEventListener("click",centerSelected);
    $("scene-toggle-safe").addEventListener("click",()=>{
      const guides=$("scene-safe-area");
      guides.hidden=!guides.hidden;
      $("scene-toggle-safe").setAttribute("aria-pressed",String(!guides.hidden));
    });
    $("scene-add").addEventListener("click",addLayer);
    $("scene-add-text").addEventListener("click",addText);
    $("scene-effect-preview").addEventListener("click",previewEffect);
    for(const id of ["scene-text-input","scene-font-size","scene-text-color",
      "scene-text-background","scene-text-align","scene-text-outline"]){
      $(id).addEventListener(id==="scene-text-input"?"input":"change",inputChanged);
    }
    for(const name of ["effect","start","duration","repeat"])$("scene-"+name).addEventListener("change",inputChanged);
    $("scene-save").addEventListener("click",save);
    $("scene-render-actual").addEventListener("click",renderActualPreview);
    $("scene-open-media").addEventListener("click",()=>page("media"));
    for(const n of fieldNames)$("scene-"+n).addEventListener("change",inputChanged);
    $("scene-fit").addEventListener("change",inputChanged);
    $("scene-layer-list").addEventListener("click",e=>{
      const rem=e.target.closest("[data-layer-remove]");
      if(rem){layers=layers.filter(l=>l.layer_id!==rem.dataset.layerRemove);
        textLayers=textLayers.filter(l=>l.layer_id!==rem.dataset.layerRemove);
        if(selected===rem.dataset.layerRemove)selected=layers[0]?.layer_id||textLayers[0]?.layer_id||null;
        preview();markDirty();return;}
      const up=e.target.closest("[data-layer-up]");
      if(up){changeOrder(up.dataset.layerUp,1);return;}
      const down=e.target.closest("[data-layer-down]");
      if(down){changeOrder(down.dataset.layerDown,-1);return;}
      const row=e.target.closest("[data-select-layer]");if(row)select(row.dataset.selectLayer);
    });
    $("scene-items").addEventListener("pointerdown",onPointerDown);
    $("scene-items").addEventListener("pointermove",onPointerMove);
    $("scene-items").addEventListener("pointerup",pointerDone);
    $("scene-items").addEventListener("pointercancel",pointerDone);
    $("scene-items").addEventListener("lostpointercapture",onCaptureLost);
    // Capture fallback: a finger can move beyond the layer or the whole canvas.
    window.addEventListener("pointermove",onPointerMove);
    window.addEventListener("pointerup",pointerDone);
    window.addEventListener("pointercancel",pointerDone);
    for(const size of [25,50,75]){
      $("scene-preset-"+size).addEventListener("click",()=>resizeSelected(size,Math.round(size*9/16)));
    }
  }
  window.StreamCoreScene={init,sync,open,hasUnsaved:()=>dirty};
})();
