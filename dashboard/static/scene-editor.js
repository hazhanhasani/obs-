"use strict";
/* Scene editor: layout preview uses authenticated media posters; live encoder
   output is viewed in the dashboard after saving. Works on touch and mouse. */
(function(){
  const $=(id)=>document.getElementById(id);
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const safe=(x)=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let api,overview,page,toast;
  let channel=null,baseFile=null,layers=[],selected=null,dirty=false,drag=null;
  let media=[],loadSequence=0;
  const fieldNames=["x","y","w","h","opacity"];
  const byFile=(name)=>media.find(m=>m.file===name);
  const poster=(name)=>{const m=byFile(name);return m?"/api/media/poster/"+m.id:"";};
  const fileName=(name)=>byFile(name)?.name||"Unknown file";
  function markDirty(){dirty=true;$("scene-save").disabled=false;$("scene-note").textContent="تغییرات هنوز ذخیره نشده‌اند.";}
  function resetDirty(){dirty=false;$("scene-save").disabled=true;$("scene-note").textContent="صحنه آماده است. پیش‌نمایش این صفحه از تصاویر ثابت استفاده می‌کند؛ برای دیدن خروجی واقعی به داشبورد بروید.";}
  function fillChoices(){
    const choices=media.filter(m=>m.kind==="video").map(m=>'<option value="'+safe(m.file)+'">'+safe(m.name)+'</option>').join("");
    const selectedBase=baseFile;
    $("scene-base").innerHTML='<option value="">پس‌زمینه آزمایشی 720p</option>'+choices;
    $("scene-base").value=selectedBase||"";
    const old=$("scene-media").value;
    $("scene-media").innerHTML=media.map(m=>'<option value="'+safe(m.file)+'">'+safe(m.name)+' ('+(m.kind==="image"?"تصویر":"ویدئو")+')</option>').join("")
      || '<option value="">ابتدا عکس یا ویدئو آپلود کنید</option>';
    if(media.some(m=>m.file===old))$("scene-media").value=old;
    $("scene-add").disabled=!media.length;
  }
  function preview(){
    const bg=$("scene-base-image");
    const source=baseFile?poster(baseFile):"";
    if(source){bg.src=source;bg.hidden=false;$("scene-colorbars").hidden=true;}
    else{bg.hidden=true;bg.removeAttribute("src");$("scene-colorbars").hidden=false;}
    $("scene-items").innerHTML=layers.map((l,i)=>{
      const m=byFile(l.media_file);
      const css='left:'+l.x+'%;top:'+l.y+'%;width:'+l.w+'%;height:'+l.h+'%;opacity:'+(l.opacity/100)+';';
      return '<div class="scene-item '+(selected===l.layer_id?"selected":"")+'" data-layer="'+safe(l.layer_id)+'" style="'+css+'" tabindex="0" role="button" aria-label="انتخاب لایه '+(i+1)+'">'
        +'<img draggable="false" src="'+poster(l.media_file)+'" style="object-fit:'+safe(l.fit)+'" alt="">'
        +(m?.kind==="video"?'<span class="scene-video-chip"><i class="bi bi-play-fill"></i> ویدئو</span>':'')
        +'<span class="scene-item-name">'+(i+1)+'</span><span class="scene-handle" title="تغییر اندازه"></span></div>';
    }).join("");
    $("scene-layer-list").innerHTML=layers.map((l,i)=>'<div class="scene-list-row '+(l.layer_id===selected?"active":"")+'" data-select-layer="'+safe(l.layer_id)+'">'
      +'<span class="scene-list-icon"><i class="bi '+(byFile(l.media_file)?.kind==="image"?"bi-image":"bi-film")+'"></i></span>'
      +'<span class="scene-list-name">'+safe(fileName(l.media_file))+'<small>لایه '+(i+1)+'</small></span>'
      +'<button data-layer-up="'+safe(l.layer_id)+'" class="mini-action" aria-label="انتقال لایه به بالا" title="انتقال به بالا">↑</button>'
      +'<button data-layer-down="'+safe(l.layer_id)+'" class="mini-action" aria-label="انتقال لایه به پایین" title="انتقال به پایین">↓</button>'
      +'<button data-layer-remove="'+safe(l.layer_id)+'" class="mini-action danger" title="حذف لایه">×</button></div>').join("")
      || '<p class="empty-state">هنوز لایه‌ای اضافه نشده است.</p>';
    renderProperties();
    $("scene-counter").textContent=layers.length+" / 8 لایه";
  }
  function renderProperties(){
    const layer=layers.find(l=>l.layer_id===selected);
    $("scene-properties-empty").hidden=!!layer;
    $("scene-properties").hidden=!layer;
    if(!layer)return;
    $("scene-current-label").textContent=fileName(layer.media_file);
    for(const n of fieldNames) $("scene-"+n).value=layer[n];
    $("scene-fit").value=layer.fit;
  }
  async function open(nextChannel){
    if(dirty && nextChannel!==channel && !confirm("تغییرات ذخیره نشده‌اند؛ کانال عوض شود؟"))return;
    const request=++loadSequence;
    try{
      const scene=await api("/channels/"+encodeURIComponent(nextChannel)+"/scene");
      if(request!==loadSequence)return;
      channel=nextChannel;
      baseFile=scene.base_file;
      layers=scene.layers.map(l=>({
        layer_id:l.layer_id,media_file:l.media_file,x:l.x,y:l.y,w:l.w,
        h:l.h,fit:l.fit,opacity:l.opacity
      }));
      selected=layers[0]?.layer_id||null;
      $("scene-channel").value=channel;
      fillChoices();preview();resetDirty();
    }catch(e){toast(e.message);}
  }
  function sync(data){
    overview=data;
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
    const item=layers.find(l=>l.layer_id===selected);if(!item)return;
    for(const n of fieldNames){
      const input=$("scene-"+n),num=Number(input.value);
      if(!Number.isFinite(num))continue;
      item[n]=clamp(Math.round(num),n==="opacity"?10:n==="w"||n==="h"?5:0,n==="x"||n==="y"?95:100);
    }
    item.x=clamp(item.x,0,100-item.w);
    item.y=clamp(item.y,0,100-item.h);
    item.fit=$("scene-fit").value;
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
    const i=layers.findIndex(l=>l.layer_id===id);
    const j=i+delta;
    if(i<0||j<0||j>=layers.length)return;
    [layers[i],layers[j]]=[layers[j],layers[i]];
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
      y:clamp(10+(n%3)*10,0,65),w:30,h:27,fit:"contain",opacity:100});
    select(id);markDirty();
  }
  async function save(){
    if(!channel)return;
    const button=$("scene-save");
    button.disabled=true;button.textContent="در حال ذخیره و اعمال...";
    try{
      await api("/channels/"+encodeURIComponent(channel)+"/scene",{
        method:"PUT",body:JSON.stringify({base_file:baseFile||null,layers})
      });
      resetDirty();
      toast("چیدمان ذخیره شد. اگر کانال روشن باشد پخش برای اعمال صحنه دوباره راه‌اندازی می‌شود.");
    }catch(e){toast(e.message);button.disabled=false;}
    finally{button.textContent="ذخیره و اعمال صحنه";}
  }
  // Pointer capture belongs to the persistent scene-items container, not to
  // .scene-item nodes regenerated during preview updates.
  function onPointerDown(e){
    if(drag || (e.pointerType==="mouse" && e.button!==0))return;
    const el=e.target.closest(".scene-item");
    if(!el)return;
    const item=layers.find(l=>l.layer_id===el.dataset.layer);
    if(!item)return;
    const canvas=$("scene-canvas").getBoundingClientRect();
    if(canvas.width<=0 || canvas.height<=0)return;
    const resize=!!e.target.closest(".scene-handle");
    drag={
      pointerId:e.pointerId,id:item.layer_id,
      startX:e.clientX,startY:e.clientY,
      x:item.x,y:item.y,w:item.w,h:item.h,
      width:canvas.width,height:canvas.height,
      type:resize?"resize":"move",changed:false
    };
    activateLayer(item.layer_id);
    // Capturing on the stable parent ensures pointerup is delivered even when
    // the finger moves outside the overlay or changes its bounds.
    try{$("scene-items").setPointerCapture(e.pointerId);}catch(_){}
    e.preventDefault();
  }
  function onPointerMove(e){
    if(!drag || e.pointerId!==drag.pointerId)return;
    const l=layers.find(x=>x.layer_id===drag.id);
    if(!l)return;
    const dx=Math.round((e.clientX-drag.startX)*100/drag.width);
    const dy=Math.round((e.clientY-drag.startY)*100/drag.height);
    const old=[l.x,l.y,l.w,l.h];
    if(drag.type==="resize"){
      l.w=clamp(drag.w+dx,5,100-drag.x);
      l.h=clamp(drag.h+dy,5,100-drag.y);
    }else{
      l.x=clamp(drag.x+dx,0,100-drag.w);
      l.y=clamp(drag.y+dy,0,100-drag.h);
    }
    const element=$("scene-items").querySelector('[data-layer="'+l.layer_id+'"]');
    if(element)Object.assign(element.style,{
      left:l.x+"%",top:l.y+"%",width:l.w+"%",height:l.h+"%"
    });
    for(const n of ["x","y","w","h"])$("scene-"+n).value=l[n];
    if(old.some((value,i)=>value!==[l.x,l.y,l.w,l.h][i])){
      drag.changed=true;
      markDirty();
    }
    e.preventDefault();
  }
  function pointerDone(e){
    if(!drag || e.pointerId!==drag.pointerId)return;
    // Some mobile browsers deliver the final coordinates only on pointerup.
    if(e.type==="pointerup")onPointerMove(e);
    const completed=drag;
    drag=null;
    const root=$("scene-items");
    try{
      if(root.hasPointerCapture(e.pointerId))root.releasePointerCapture(e.pointerId);
    }catch(_){}
    // A full re-render is now safe, because the gesture has ended and the
    // actual layer model already contains the final positions.
    if(completed.changed)preview();
  }
  function init(deps){
    api=deps.api;toast=deps.toast;page=deps.page;
    $("scene-channel").addEventListener("change",e=>open(e.target.value));
    $("scene-base").addEventListener("change",e=>{baseFile=e.target.value||null;markDirty();preview();});
    $("scene-add").addEventListener("click",addLayer);
    $("scene-save").addEventListener("click",save);
    $("scene-open-media").addEventListener("click",()=>page("media"));
    for(const n of fieldNames)$("scene-"+n).addEventListener("change",inputChanged);
    $("scene-fit").addEventListener("change",inputChanged);
    $("scene-layer-list").addEventListener("click",e=>{
      const rem=e.target.closest("[data-layer-remove]");
      if(rem){layers=layers.filter(l=>l.layer_id!==rem.dataset.layerRemove);
        if(selected===rem.dataset.layerRemove)selected=layers[0]?.layer_id||null;
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
    $("scene-items").addEventListener("lostpointercapture",pointerDone);
    // Secondary safety net for WebViews with incomplete pointer-capture.
    window.addEventListener("pointerup",pointerDone);
    window.addEventListener("pointercancel",pointerDone);
  }
  window.StreamCoreScene={init,sync,open,hasUnsaved:()=>dirty};
})();
