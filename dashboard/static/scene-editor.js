"use strict";
/* Scene editor: normalized transforms use scene-transform.js; live encoder
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
  let aspectLocked=false,snapping=false,editorZoom=1,panMode=false,pan=null;
  const history=new window.StreamCoreTransform.History(100);
  const fieldNames=["x","y","w","h","opacity"];
  const {transform:transformFromGesture,hitTest,handleRects,snap,HANDLES,MIN_POSITION,MAX_POSITION,MIN_SIZE,MAX_SIZE}=window.StreamCoreTransform;
  const tenth=(v)=>Math.round(v*10)/10;
  // Native buttons matter: Chromium's finite-contact touch adjustment can
  // retarget decorative span grips to the nearby media role=button instead.
  // Numeric properties provide keyboard access; these grips stay pointer-only.
  const cornerHandles=()=>HANDLES.map(corner=>
    '<button type="button" class="scene-handle scene-handle-'+corner+'" data-resize-corner="'+corner+
    '" title="Resize '+corner+'" tabindex="-1" aria-hidden="true"></button>').join("");
  const orderedLayers=()=>[...layers,...textLayers].map((item,index)=>({item,index}))
    .sort((a,b)=>(a.item.z_index??a.index)-(b.item.z_index??b.index)).map(entry=>entry.item);
  const snapshot=()=>JSON.parse(JSON.stringify({baseFile,canvasPreset,layers,textLayers,selected}));
  function updateHistory(){
    $("scene-undo").disabled=!!drag||!history.canUndo;
    $("scene-redo").disabled=!!drag||!history.canRedo;
  }
  function checkpoint(before,group=null){history.record(before,snapshot(),group);updateHistory();}
  function restoreSnapshot(value){
    ({baseFile,canvasPreset,layers,textLayers,selected}=value);
    if(selected&&!getLayer(selected))selected=null;
    applyCanvas();fillChoices();preview();recordGeometry();
  }
  function travelHistory(redo=false){
    if(drag)return;
    const value=redo?history.redo(snapshot()):history.undo(snapshot());
    if(!value)return;
    restoreSnapshot(value);markDirty();updateHistory();
  }
  function updateHandles(){
    const current=getLayer(selected),overlay=$("scene-items").querySelector(".scene-transform");
    if(!current||!overlay)return;
    const handles=handleRects(current,$("scene-items").getBoundingClientRect());
    overlay.querySelectorAll?.("[data-resize-corner]").forEach(node=>{
      node.hidden=!handles[node.dataset.resizeCorner];
    });
  }
  function applyTransform(item,geometry){
    for(const key of ["x","y","w","h"])item[key]=tenth(geometry[key]);
  }
  let visualFrame=null;
  function state(next){$("scene-items").dataset.transformState=next;}
  function paintGeometry(){
    visualFrame=null;
    const item=getLayer(drag?.id||selected);if(!item)return;
    const root=$("scene-items");
    for(const node of root.querySelectorAll('[data-layer="'+item.layer_id+'"]')){
      Object.assign(node.style,{left:item.x+"%",top:item.y+"%",width:item.w+"%",height:item.h+"%"});
    }
    updateHandles();
  }
  function scheduleGeometry(){
    if(!window.requestAnimationFrame){paintGeometry();return;}
    if(visualFrame===null)visualFrame=window.requestAnimationFrame(paintGeometry);
  }
  function flushGeometry(){
    if(visualFrame!==null)window.cancelAnimationFrame?.(visualFrame);
    paintGeometry();
  }
  const outputDimensions={landscape:[1280,720],landscape_fullhd:[1920,1080],portrait:[720,1280],portrait_fullhd:[1080,1920]};
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
    applyZoom();
  }
  function applyZoom(){
    const canvas=$("scene-canvas"),workspace=canvas.parentElement;
    if(!workspace)return;
    // Enlarge layout width, not CSS zoom: grips stay 44 CSS pixels at every
    // magnification and pointer coordinates remain in the viewport space.
    canvas.style.width="";
    if(editorZoom!==1)canvas.style.width=canvas.getBoundingClientRect().width*editorZoom+"px";
    workspace.classList.toggle("scene-zoomed",editorZoom!==1);
    updateHandles();
  }
  const byFile=(name)=>media.find(m=>m.file===name);
  const getLayer=(id)=>layers.find(l=>l.layer_id===id)||textLayers.find(l=>l.layer_id===id);
  const isText=(l)=>!!l&&typeof l.text==="string";
  const normalize=(l)=>({...l,locked:!!l.locked,visible:l.visible!==false&&l.visible!==0,effect:l.effect||"none",start_sec:Number(l.start_sec)||0,
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
    $("scene-save").disabled=saving;
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
    const mediaHtml=layers.filter(l=>l.visible!==false).map((l,i)=>{
      const m=byFile(l.media_file);
      const css='left:'+l.x+'%;top:'+l.y+'%;width:'+l.w+'%;height:'+l.h+'%;opacity:'+(l.opacity/100)+';z-index:'+orderedLayers().indexOf(l)+';';
      return '<div class="scene-item '+(selected===l.layer_id?"selected":"")+'" data-layer="'+safe(l.layer_id)+'" style="'+css+'" data-locked="'+!!l.locked+'" tabindex="0" role="button" aria-label="انتخاب لایه '+(i+1)+'">'
        +'<img draggable="false" src="'+poster(l.media_file)+'" style="object-fit:'+(l.fit==="stretch"?"fill":safe(l.fit))+'" alt="">'
        +(m?.kind==="video"?'<span class="scene-video-chip"><i class="bi bi-play-fill"></i> ویدئو</span>':'')
        +'<span class="scene-item-name">'+(i+1)+'</span></div>';
    });
    const textHtml=textLayers.filter(l=>l.visible!==false).map((l,i)=>{
      const css='left:'+l.x+'%;top:'+l.y+'%;width:'+l.w+'%;height:'+l.h+'%;opacity:'+(l.opacity/100)+';z-index:'+orderedLayers().indexOf(l)+';';
      const bg=l.background==="transparent"?"transparent":safe(l.background);
      const size=(l.font_size/outputSize()[0]*100).toFixed(3)+"cqw";
      return '<div class="scene-item scene-text-item '+(selected===l.layer_id?"selected":"")+'" data-layer="'+safe(l.layer_id)+'" style="'+css+'" data-locked="'+!!l.locked+'" tabindex="0" role="button" aria-label="متن '+(i+1)+'">'
        +'<span class="scene-text-content" dir="auto" style="font-size:'+size+';color:'+safe(l.color)+';text-align:'+safe(l.align)+';background:'+bg+';">'+safe(l.text)+'</span>'
        +'<span class="scene-item-name">T'+(i+1)+'</span></div>';
    });
    const current=getLayer(selected);
    const selection=current&&current.visible!==false&&!current.locked?'<div class="scene-transform" data-layer="'+safe(selected)+'" style="left:'+current.x+'%;top:'+current.y+'%;width:'+current.w+'%;height:'+current.h+'%;">'+cornerHandles()+'</div>':"";
    $("scene-items").innerHTML=[...mediaHtml,...textHtml,selection].join("");
    state(selected?"selected":"idle");
    function listItem(l,i,textLayer){
      const icon=textLayer?"bi-fonts":byFile(l.media_file)?.kind==="image"?"bi-image":"bi-film";
      const label=textLayer?l.text:fileName(l.media_file);
      return '<div class="scene-list-row '+(l.layer_id===selected?"active":"")+'" data-select-layer="'+safe(l.layer_id)+'">'
        +'<span class="scene-list-icon"><i class="bi '+icon+'"></i></span>'
        +'<span class="scene-list-name">'+safe(label)+'<small>'+(textLayer?"متن ":"رسانه ")+(i+1)+'</small></span>'
        +'<button type="button" data-layer-visible="'+safe(l.layer_id)+'" class="mini-action" aria-label="نمایش لایه" aria-pressed="'+(l.visible!==false)+'">'+(l.visible!==false?'◉':'○')+'</button>'
        +'<button type="button" data-layer-lock="'+safe(l.layer_id)+'" class="mini-action" aria-label="قفل لایه" aria-pressed="'+!!l.locked+'"><i class="bi '+(l.locked?'bi-lock-fill':'bi-unlock')+'"></i></button>'
        +'<button data-layer-up="'+safe(l.layer_id)+'" class="mini-action" aria-label="بالا">↑</button>'
        +'<button data-layer-down="'+safe(l.layer_id)+'" class="mini-action" aria-label="پایین">↓</button>'
        +'<button data-layer-remove="'+safe(l.layer_id)+'" class="mini-action danger" aria-label="حذف">×</button></div>';
    }
    $("scene-layer-list").innerHTML=[
      ...orderedLayers().slice().reverse().map((l,i)=>listItem(l,i,isText(l)))
    ].join("") || '<p class="empty-state">هنوز لایه‌ای اضافه نشده است.</p>';
    renderProperties();updateHandles();updateHistory();
    $("scene-counter").textContent=layers.length+" رسانه · "+textLayers.length+" متن";
  }
  function renderProperties(){
    const item=getLayer(selected),textItem=isText(item);
    $("scene-properties-empty").hidden=!!item;
    $("scene-properties").hidden=!item;
    for(const node of $("scene-properties").querySelectorAll("input,select,textarea,button"))node.disabled=!!item?.locked;
    for(const id of ["scene-center-selected","scene-fit-selected","scene-stretch-selected","scene-reset-selected",... [25,50,75].map(n=>"scene-preset-"+n)])$(id).disabled=!item||!!item.locked;
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
      history.clear();fillChoices();preview();resetDirty();showOutputBindings();
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
  function inputChanged(event){
    if(drag)return;
    const item=getLayer(selected);if(!item||item.locked)return;
    const before=snapshot();
    for(const n of fieldNames){
      const input=$("scene-"+n),value=Number(input.value);
      if(!Number.isFinite(value))continue;
      item[n]=n==="opacity"?clamp(Math.round(value),10,100):
        n==="w"||n==="h"?clamp(tenth(value),MIN_SIZE,MAX_SIZE):
        clamp(tenth(value),MIN_POSITION,MAX_POSITION);
    }
    if(aspectLocked&&["scene-w","scene-h"].includes(event?.target?.id)){
      const previous=[...before.layers,...before.textLayers].find(l=>l.layer_id===selected);
      const widthChanged=event.target.id==="scene-w";
      applyTransform(item,transformFromGesture({...item,w:previous.w,h:previous.h},"se",
        widthChanged?item.w-previous.w:0,widthChanged?0:item.h-previous.h,{aspect:true}));
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
    checkpoint(before,event?.type==="input"?"text:"+selected:null);markDirty();preview();
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
  function select(id){if(drag)return;selected=id;preview();}
  function changeOrder(id,delta){
    if(drag)return;
    const collection=orderedLayers(),i=collection.findIndex(l=>l.layer_id===id),j=i+delta;
    if(i<0||j<0||j>=collection.length||getLayer(id)?.locked)return;
    const before=snapshot();
    [collection[i],collection[j]]=[collection[j],collection[i]];
    collection.forEach((l,index)=>l.z_index=index);
    select(id);checkpoint(before);markDirty();
  }
  function removeLayer(id){
    if(drag||getLayer(id)?.locked)return;
    const before=snapshot();
    layers=layers.filter(l=>l.layer_id!==id);textLayers=textLayers.filter(l=>l.layer_id!==id);
    if(selected===id)selected=orderedLayers().at(-1)?.layer_id||null;
    preview();checkpoint(before);markDirty();
  }
  function toggleSource(id,key){
    const l=getLayer(id);if(drag||!l)return;
    const before=snapshot();l[key]=key==="visible"?l.visible===false:!l.locked;
    preview();checkpoint(before);markDirty();
  }

  function addLayer(){
    if(drag)return;
    const file=$("scene-media").value,m=byFile(file);
    if(!m){toast("ابتدا از بخش رسانه‌ها فایل آپلود کنید.");return;}
    if(layers.length>=8){toast("حداکثر ۸ لایه برای هر صحنه مجاز است.");return;}
    const count=layers.filter(l=>byFile(l.media_file)?.kind===m.kind).length;
    if((m.kind==="video"&&count>=3)||(m.kind==="image"&&count>=5)){toast("حداکثر ۳ لایه ویدئو و ۵ تصویر پشتیبانی می‌شود.");return;}
    const before=snapshot(),n=layers.length;
    orderedLayers().forEach((l,index)=>l.z_index=index);
    const id="layer_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,7);
    layers.push({layer_id:id,media_file:file,locked:false,visible:true,z_index:orderedLayers().length,x:clamp(10+(n%4)*8,0,60),
      y:clamp(10+(n%3)*10,0,65),w:30,h:27,fit:"contain",opacity:100,
      effect:"none",start_sec:0,duration_sec:0,repeat_sec:0});
    select(id);checkpoint(before);markDirty();
  }
  function addText(){
    if(drag)return;
    if(textLayers.length>=5){toast("حداکثر پنج لایه متن مجاز است.");return;}
    const before=snapshot();
    orderedLayers().forEach((l,index)=>l.z_index=index);
    const id="text_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,7);
    textLayers.push({layer_id:id,locked:false,visible:true,z_index:orderedLayers().length,text:"متن جدید",x:20,y:40,w:56,h:20,
      font_size:46,color:"#ffffff",background:"transparent",align:"right",
      outline:2,opacity:100,effect:"fade",start_sec:0,duration_sec:0,repeat_sec:0});
    select(id);checkpoint(before);markDirty();
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
    const version=draftVersion;
    const payload=JSON.parse(JSON.stringify({base_file:baseFile||null,canvas_preset:canvasPreset,layers,text_layers:textLayers}));
    const button=$("scene-save");
    button.disabled=true;button.textContent="در حال ذخیره و اعمال...";
    try{
      const response=await api("/channels/"+encodeURIComponent(channel)+"/scene",{
        method:"PUT",body:JSON.stringify(payload)
      });
      // Only report success after the API returns persisted layer geometry.
      const remote=response.scene;
      const matches=(local,stored)=>Array.isArray(stored) && local.length===stored.length
        && local.every((l,index)=>Object.keys(l).filter(k=>k!=="layer_order")
          .every(k=>String(l[k])===String(stored[index][k])));
      if(!remote || remote.canvas_preset!==payload.canvas_preset || !matches(payload.layers,remote.layers) || !matches(payload.text_layers,remote.text_layers)){
        throw new Error("سرور اندازه لایه را مطابق درخواست ذخیره نکرد؛ وضعیت را دوباره بررسی کنید.");
      }
      if(version===draftVersion)resetDirty();
      else button.disabled=false;
      recordGeometry();
      try{overview=await api("/overview");showOutputBindings();}catch(_){/* periodic poll will refresh */}
      toast("چیدمان ذخیره شد. اگر کانال روشن باشد پخش برای اعمال صحنه دوباره راه‌اندازی می‌شود.");
    }catch(e){toast(e.message);button.disabled=false;}
    finally{saving=false;button.textContent="ذخیره و اعمال صحنه";}
  }
  // Pointer capture belongs to the persistent scene-items container, not to
  // .scene-item nodes regenerated during preview updates.
  function getCanvasSize(){
    const rect=$("scene-items").getBoundingClientRect();
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
    if(drag && (e.pointerId===drag.pointerId || (drag.captureLost && e.isPrimary!==false))){
      pointerDone({pointerId:drag.pointerId,type:"pointercancel"});
    }
    if(drag || (e.pointerType==="mouse" && e.button!==0))return;
    const frame=$("scene-items").getBoundingClientRect();
    const canvas={width:frame.width,height:frame.height};
    if(canvas.width<=0||canvas.height<=0)return;
    const el=e.target?.closest?.("[data-layer]")||e.target?.closest?.(".scene-item");
    const handle=e.target?.closest?.("[data-resize-corner]");
    const hit=hitTest(orderedLayers(),selected,{x:e.clientX,y:e.clientY},frame);
    // An explicit native grip is authoritative; geometric picking handles
    // browser retargeting to the canvas or another source under the finger.
    const id=handle?selected:hit?.id||el?.dataset?.layer;
    const item=getLayer(id);
    if(!item||item.locked||item.visible===false)return;
    const corner=handle?.dataset?.resizeCorner||hit?.handle||
      (e.target?.closest?.(".scene-handle")?"se":null);
    const resize=!!corner;
    drag={
      pointerId:e.pointerId,id:item.layer_id,
      lastX:e.clientX,lastY:e.clientY,dx:0,dy:0,
      x:item.x,y:item.y,w:item.w,h:item.h,
      width:canvas.width,height:canvas.height,
      type:resize?"resize":"move",corner,changed:false,
      source:e.gestureSource||"pointer",wasDirty:dirty
    };
    // If selection changes, render the overlay BEFORE capture, never mid-gesture.
    if(selected!==item.layer_id){
      const active=drag;drag=null;selected=item.layer_id;preview();drag=active;
    }else activateLayer(item.layer_id);
    drag.before=snapshot();history.group=null;updateHistory();
    $("scene-items").focus({preventScroll:true});
    state(resize?"resizing":"dragging");
    $("scene-items").querySelectorAll(".scene-item").forEach(node=>{
      for(const cls of ["fx-fade","fx-slide-left","fx-slide-right","fx-blink"])node.classList.remove(cls);
    });
    $("scene-canvas").classList.add("scene-gesturing");
    recordGeometry();
    // Mobile Chromium can report a lost capture after rotation/scroll,
    // and WebViews may reject capture. Window listeners provide a fallback.
    if(drag.source==="pointer"){
      try{$("scene-items").setPointerCapture?.(e.pointerId);}catch(_){}
    }
    e.stopPropagation?.();
    e.preventDefault?.();
  }
  function onPointerMove(e){
    if(pan&&e.pointerId===pan.pointerId){
      pan.workspace.scrollLeft-=e.clientX-pan.x;pan.workspace.scrollTop-=e.clientY-pan.y;
      pan.x=e.clientX;pan.y=e.clientY;e.preventDefault?.();return;
    }
    if(!drag || e.pointerId!==drag.pointerId)return;
    // A missed release must not turn subsequent mouse/pen hover into edits.
    if(drag.source==="pointer" && ["mouse","pen"].includes(e.pointerType) && e.buttons===0 && e.type!=="pointerup"){
      pointerDone({pointerId:drag.pointerId,type:"pointercancel"});return;
    }
    const l=getLayer(drag.id);if(!l)return;
    // Use the current canvas dimensions if viewport changes during a gesture.
    const current=getCanvasSize();
    const width=current.width>0?current.width:drag.width;
    const height=current.height>0?current.height:drag.height;
    drag.dx+=(e.clientX-drag.lastX)*100/width;
    drag.dy+=(e.clientY-drag.lastY)*100/height;
    drag.lastX=e.clientX;drag.lastY=e.clientY;
    const old=[l.x,l.y,l.w,l.h];
    const aspect=aspectLocked||!!e.shiftKey;
    let geometry=transformFromGesture(drag,drag.corner,drag.dx,drag.dy,{aspect});
    let guides=[];
    if(snapping&&!e.ctrlKey&&!e.metaKey&&!(aspect&&drag.corner)){
      const result=snap(geometry,drag.corner,orderedLayers().filter(item=>item.layer_id!==drag.id),{width,height});
      geometry=result.geometry;guides=result.guides;
    }
    paintSnapGuides(guides);
    applyTransform(l,geometry);
    scheduleGeometry();
    for(const name of ["x","y","w","h"])$("scene-"+name).value=l[name];
    recordGeometry();
    if(!drag.changed && old.some((value,i)=>value!==[l.x,l.y,l.w,l.h][i])){
      drag.changed=true;
      // Expensive preview invalidation belongs to the first changed frame.
      markDirty();
    }
    e.preventDefault?.();
  }
  function pointerDone(e){
    if(pan&&e.pointerId===pan.pointerId){finishPan();return;}
    if(!drag || e.pointerId!==drag.pointerId)return;
    if(e.type==="pointerup")onPointerMove(e);
    flushGeometry();
    const completed=drag;
    drag=null;
    paintSnapGuides([]);
    state("committed");
    $("scene-canvas").classList.remove("scene-gesturing");
    const root=$("scene-items");
    if(completed.source==="pointer"){
      try{
        if(root.hasPointerCapture?.(e.pointerId))root.releasePointerCapture(e.pointerId);
      }catch(_){}
    }
    // Keep stable layer and selection nodes on release. Deferred library updates
    // may now rebuild, using the committed model (never stale styles).
    if(e.type==="escape"){
      restoreSnapshot(completed.before);
      if(completed.wasDirty)markDirty();else resetDirty();
    }else{
      checkpoint(completed.before);
      if(pendingRender)preview();
    }
    updateHistory();
    state(selected?"selected":"idle");
  }
  function onCaptureLost(e){
    // Unexpected capture loss must NOT abort the drag on Android. Keep the
    // gesture alive: window pointermove/up listeners continue tracking it.
    if(!drag || e.pointerId!==drag.pointerId)return;
    drag.captureLost=true;
    // If a WebView never sends pointerup, the following real pointerdown
    // can safely finalize the old draft before starting another gesture.
  }
  // Android WebViews may deliver Touch Events without usable Pointer Events.
  // Track a single Touch.identifier to prevent the second finger moving a layer.
  function onTouchStart(e){
    if(drag)return;
    const t=e.changedTouches?.[0];
    if(!t)return;
    onPointerDown({target:e.target,pointerId:"touch:"+t.identifier,
      pointerType:"touch",button:0,clientX:t.clientX,clientY:t.clientY,
      gestureSource:"touch",preventDefault:()=>e.preventDefault?.()});
  }
  function onTouchContinue(e,end){
    if(!drag || drag.source!=="touch")return;
    const t=Array.from(e.changedTouches||[]).find(t=>"touch:"+t.identifier===drag.pointerId);
    if(!t)return;
    const event={pointerId:drag.pointerId,clientX:t.clientX,clientY:t.clientY,
      type:end?(e.type==="touchcancel"?"pointercancel":"pointerup"):"pointermove",
      preventDefault:()=>e.preventDefault?.()};
    if(end)pointerDone(event);
    else onPointerMove(event);
  }
  // Older embedded desktop dashboards may only emit Mouse Events.
  function onMouseStart(e){
    if(drag || e.button!==0)return;
    onPointerDown({target:e.target,pointerId:"legacy-mouse",pointerType:"mouse",
      button:0,clientX:e.clientX,clientY:e.clientY,
      gestureSource:"mouse",preventDefault:()=>e.preventDefault?.()});
  }
  function onMouseContinue(e,end){
    if(!drag || drag.source!=="mouse")return;
    const event={pointerId:drag.pointerId,clientX:e.clientX,clientY:e.clientY,
      type:end?"pointerup":"pointermove",preventDefault:()=>e.preventDefault?.()};
    if(end)pointerDone(event);
    else onPointerMove(event);
  }
  function finishPan(){
    if(!pan)return;
    const completed=pan;pan=null;
    completed.workspace.classList.remove("scene-panning");
    try{completed.workspace.releasePointerCapture(completed.pointerId);}catch(_){}
  }
  function beginPan(e){
    if(!panMode||drag||e.button!==0||e.pointerType==="touch")return;
    const workspace=$("scene-canvas").parentElement;
    pan={workspace,pointerId:e.pointerId,x:e.clientX,y:e.clientY};
    workspace.classList.add("scene-panning");
    try{workspace.setPointerCapture(e.pointerId);}catch(_){}
    e.preventDefault();
  }
  function paintSnapGuides(guides){
    const node=$("scene-snap-guides");
    node.innerHTML=guides.map(g=>'<i class="scene-snap-guide '+g.axis+'" style="'+(g.axis==="x"?'left':'top')+':'+g.value+'%"></i>').join("");
  }
  async function transformCommand(command){
    if(drag)return;
    const l=getLayer(selected);if(!l||l.locked)return;
    const before=snapshot(),version=draftVersion,activeChannel=channel;
    let ratio=l.w/l.h;
    if(command==="fit"&&!isText(l)){
      const image=$("scene-items").querySelector('.scene-item[data-layer="'+l.layer_id+'"] img')||new window.Image();
      try{
        if(!image.src)image.src=poster(l.media_file);
        await image.decode();
        if(drag||draftVersion!==version||channel!==activeChannel||selected!==l.layer_id)return;
        if(!image.naturalWidth||!image.naturalHeight)throw new Error("Invalid source dimensions");
        const [w,h]=outputSize();ratio=image.naturalWidth/image.naturalHeight*h/w;
      }catch(_){toast("ابعاد رسانه هنوز آماده نیست؛ پس از بارگذاری تصویر دوباره تلاش کنید.");return;}
    }
    if(command==="stretch"){applyTransform(l,{x:0,y:0,w:100,h:100});if(!isText(l))l.fit="stretch";}
    else if(command==="fit"){
      const w=ratio>=1?100:Math.max(MIN_SIZE,tenth(100*ratio));
      const h=ratio>=1?Math.max(MIN_SIZE,tenth(100/ratio)):100;
      applyTransform(l,{x:tenth((100-w)/2),y:tenth((100-h)/2),w,h});
      if(!isText(l))l.fit="contain";
    }else applyTransform(l,{x:0,y:0,w:isText(l)?56:30,h:isText(l)?20:27});
    checkpoint(before);markDirty();preview();recordGeometry();
  }
  function onKeyDown(e){
    const canvas=$("scene-canvas");
    if(canvas.closest?.("[hidden]"))return;
    const target=e.target;
    if(target?.isContentEditable||target?.closest?.("input,textarea,select,[contenteditable]"))return;
    if(e.key==="Escape"&&drag){pointerDone({pointerId:drag.pointerId,type:"escape"});e.preventDefault();return;}
    if(drag)return;
    const command=e.ctrlKey||e.metaKey,key=e.key?.toLowerCase();
    if(command&&(key==="z"||key==="y")){
      const inCanvas=target?.closest?.("#scene-items");
      travelHistory(key==="y"||e.shiftKey);
      if(inCanvas)$("scene-items").focus();
      e.preventDefault();return;
    }
    // Source shortcuts apply only while focus is inside the editor workspace.
    if(!target?.closest?.("#scene-items"))return;
    const focused=target?.closest?.(".scene-item")?.dataset?.layer;
    if(focused&&focused!==selected){select(focused);$("scene-items").focus();}
    if(key==="enter"||key===" "){if(focused)select(focused);$("scene-items").focus();e.preventDefault();return;}
    if(key==="delete"||key==="backspace"){removeLayer(selected);e.preventDefault();return;}
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
    if(!delta)return;
    const l=getLayer(selected);if(!l||l.locked||l.visible===false)return;
    const before=snapshot(),[w,h]=outputSize(),step=e.shiftKey?10:1;
    applyTransform(l,transformFromGesture(l,null,delta[0]*step*100/w,delta[1]*step*100/h));
    checkpoint(before);markDirty();flushGeometry();renderProperties();recordGeometry();e.preventDefault();
  }
  function centerSelected(){
    if(drag)return;
    const l=getLayer(selected);if(!l||l.locked)return;
    const before=snapshot();
    l.x=tenth((100-l.w)/2);l.y=tenth((100-l.h)/2);
    checkpoint(before);markDirty();preview();recordGeometry();
  }
  function resizeSelected(width,height){
    if(drag)return;
    const layer=getLayer(selected);if(!layer||layer.locked)return;
    const before=snapshot();
    // Size presets alter dimensions only. Never reposition an intentionally
    // off-canvas overlay; use "Center layer" for explicit recovery.
    layer.w=clamp(width,MIN_SIZE,MAX_SIZE);
    layer.h=clamp(height,MIN_SIZE,MAX_SIZE);
    checkpoint(before);markDirty();preview();recordGeometry();
  }
  function init(deps){
    api=deps.api;toast=deps.toast;page=deps.page;appState=deps.state;
    $("scene-channel").addEventListener("change",e=>open(e.target.value));
    $("scene-go-telegram").addEventListener("click",async()=>{
      const target=$("scene-go-telegram").dataset.channel;
      if(target && target!==channel)await open(target);
    });
    $("scene-base").addEventListener("change",e=>{if(drag)return;const before=snapshot();baseFile=e.target.value||null;checkpoint(before);markDirty();preview();});
    $("scene-canvas-preset").addEventListener("change",e=>{
      if(drag){e.target.value=canvasPreset;return;}
      if(!Object.prototype.hasOwnProperty.call(outputDimensions,e.target.value))return;
      const before=snapshot();canvasPreset=e.target.value;applyCanvas();checkpoint(before);markDirty();preview();
    });
    $("scene-undo").addEventListener("click",()=>travelHistory());
    $("scene-redo").addEventListener("click",()=>travelHistory(true));
    $("scene-aspect").addEventListener("click",()=>{
      aspectLocked=!aspectLocked;$("scene-aspect").setAttribute("aria-pressed",String(aspectLocked));
    });
    $("scene-snapping").addEventListener("click",()=>{
      snapping=!snapping;$("scene-snapping").setAttribute("aria-pressed",String(snapping));
    });
    $("scene-pan").addEventListener("click",()=>{
      if(drag)return;
      finishPan();panMode=!panMode;
      $("scene-canvas").parentElement.classList.toggle("scene-pan-mode",panMode);
      $("scene-pan").setAttribute("aria-pressed",String(panMode));
    });
    $("scene-canvas").parentElement?.addEventListener("pointerdown",beginPan);
    $("scene-zoom").addEventListener("change",e=>{
      if(drag){e.target.value=String(editorZoom);return;}
      const value=Number(e.target.value);if([.5,.75,1,1.5,2].includes(value)){editorZoom=value;applyZoom();}
    });
    for(const cmd of ["fit","stretch","reset"])$("scene-"+cmd+"-selected").addEventListener("click",()=>transformCommand(cmd));
    window.addEventListener("keydown",onKeyDown);
    window.addEventListener("resize",()=>{applyZoom();updateHandles();});
    if(window.ResizeObserver)new window.ResizeObserver(updateHandles).observe($("scene-items"));
    $("scene-text-input").addEventListener("blur",()=>{history.group=null;});
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
      if(drag)return;
      const rem=e.target.closest("[data-layer-remove]");
      if(rem){removeLayer(rem.dataset.layerRemove);return;}
      const lock=e.target.closest("[data-layer-lock]");
      if(lock){toggleSource(lock.dataset.layerLock,"locked");return;}
      const visible=e.target.closest("[data-layer-visible]");
      if(visible){toggleSource(visible.dataset.layerVisible,"visible");return;}
      const up=e.target.closest("[data-layer-up]");
      if(up){changeOrder(up.dataset.layerUp,1);return;}
      const down=e.target.closest("[data-layer-down]");
      if(down){changeOrder(down.dataset.layerDown,-1);return;}
      const row=e.target.closest("[data-select-layer]");if(row)select(row.dataset.selectLayer);
    });
    if(window.PointerEvent){
      $("scene-items").addEventListener("pointerdown",onPointerDown);
      $("scene-items").addEventListener("lostpointercapture",onCaptureLost);
      window.addEventListener("pointermove",onPointerMove,{passive:false});
      window.addEventListener("pointerup",pointerDone);
      window.addEventListener("pointercancel",pointerDone);
    }else{
      $("scene-items").addEventListener("touchstart",onTouchStart,{passive:false});
      window.addEventListener("touchmove",e=>onTouchContinue(e,false),{passive:false});
      window.addEventListener("touchend",e=>onTouchContinue(e,true));
      window.addEventListener("touchcancel",e=>onTouchContinue(e,true));
      $("scene-items").addEventListener("mousedown",onMouseStart);
      window.addEventListener("mousemove",e=>onMouseContinue(e,false));
      window.addEventListener("mouseup",e=>onMouseContinue(e,true));
    }
    const finishActive=()=>{finishPan();if(drag)pointerDone({pointerId:drag.pointerId,type:"pointercancel"});};
    window.addEventListener("blur",finishActive);
    document.addEventListener?.("visibilitychange",()=>{if(document.hidden)finishActive();});
    for(const size of [25,50,75]){
      $("scene-preset-"+size).addEventListener("click",()=>resizeSelected(size,Math.round(size*9/16)));
    }
  }
  window.StreamCoreScene={init,sync,open,hasUnsaved:()=>dirty};
})();
