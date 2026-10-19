/* Regression: mobile resize/move MUST persist after pointerup redraw.
   No third-party test dependency: run with node --test tests/test_scene_editor.cjs. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");

function harness({canvasWidth=1000,canvasHeight=562.5}={}) {
  const elements = new Map();
  class Element {
    constructor(id) {
      this.id = id;
      this.listeners = new Map();
      this.dataset = {};
      this.innerHTML = "";
      this.value = "";
      this.textContent = "";
      this.hidden = false;
      this.disabled = false;
      this.style = {};
      this.captured = null;
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    addEventListener(event, callback) {this.listeners.set(event, callback);}
    dispatch(type, payload) {
      const event = {type, pointerId:1, pointerType:"touch", button:0,
        clientX:200, clientY:120, preventDefault() {}, ...payload};
      this.listeners.get(type)?.(event);
    }
    setPointerCapture(id) {this.captured=id;}
    hasPointerCapture(id) {return this.captured===id;}
    releasePointerCapture(id) {if(this.captured===id)this.captured=null;}
    querySelector(selector) {
      if(selector.includes("[data-layer="))return this.sceneLayer;
      return null;
    }
    querySelectorAll(selector) {
      if(selector===".scene-item" || selector===".scene-list-row") {
        return this.sceneLayer?[this.sceneLayer]:[];
      }
      return [];
    }
    getBoundingClientRect(){return {width:canvasWidth,height:canvasHeight,left:0,top:0};}
    removeAttribute() {}
    focus() {}
    setAttribute(name,value) {this.attributes ??= {};this.attributes[name]=String(value);}
    getAttribute(name) {return this.attributes?.[name]??null;}
  }
  const document={
    getElementById(id) {
      if(!elements.has(id))elements.set(id,new Element(id));
      return elements.get(id);
    }
  };
  const root=document.getElementById("scene-items");
  root.sceneLayer = {dataset:{layer:"layer_logo",selectLayer:"layer_logo"},
    classList:{toggle(){}},style:{}};
  const window={listeners:new Map(),StreamCoreScene:null,
    addEventListener(event,handler){this.listeners.set(event,handler);},
    dispatch(type,payload){
      const event={type,pointerId:1,pointerType:"touch",button:0,
        clientX:200,clientY:120,preventDefault(){},...payload};
      this.listeners.get(type)?.(event);
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname,"../dashboard/static/scene-editor.js"),"utf8"),
    {document,window,console,Math,Date,Number,String,JSON,Promise}
  );
  const layer={layer_id:"layer_logo",media_file:"logo.png",x:10,y:15,w:25,h:25,
    fit:"contain",opacity:100};
  let saved=null;
  const api=async (url,options)=>{
    if(!options)return {base_file:null,layers:[layer]};
    saved=JSON.parse(options.body);
    return {ok:true,scene:{layers:saved.layers,text_layers:saved.text_layers}};
  };
  window.StreamCoreScene.init({api,toast(){},page(){}});
  const media=[{id:7,file:"logo.png",name:"Brand logo",kind:"image"}];
  window.StreamCoreScene.sync({media,channels:[{id:"main",name:"Main"}]});
  const handle={
    closest(selector){
      if(selector===".scene-item")return {dataset:{layer:"layer_logo"}};
      if(selector===".scene-handle")return {};
      return null;
    }
  };
  const surface={
    closest(selector){
      if(selector===".scene-item")return {dataset:{layer:"layer_logo"}};
      if(selector===".scene-handle")return null;
      return null;
    }
  };
  return {window,document,root,handle,surface,
    open:()=>window.StreamCoreScene.open("main"),
    save:()=>document.getElementById("scene-save").dispatch("click",{}),
    saved:()=>saved};
}

test("touch resize is retained after finger is lifted",async()=>{
  const h=harness();await h.open();
  const before=h.root.innerHTML;
  h.root.dispatch("pointerdown",{target:h.handle,clientX:200,clientY:120});
  assert.equal(h.root.innerHTML,before,"pointerdown must not reconstruct the captured element");
  assert.equal(h.root.captured,1,"stable root should capture active pointer");
  h.root.dispatch("pointermove",{pointerId:2,clientX:600,clientY:350});
  assert.equal(h.document.getElementById("scene-w").value,25,"other fingers must be ignored");
  h.root.dispatch("pointermove",{clientX:350,clientY:176.25});
  assert.equal(h.document.getElementById("scene-w").value,40);
  assert.equal(h.document.getElementById("scene-h").value,35);
  h.root.dispatch("pointerup",{clientX:350,clientY:176.25});
  assert.match(h.root.innerHTML,/width:40%;height:35%/,"final redraw must use updated geometry");
  assert.equal(h.root.captured,null);
  assert.equal(h.document.getElementById("scene-save").disabled,false);
  await h.save();
  assert.equal(h.saved().layers[0].w,40);
  assert.equal(h.saved().layers[0].h,35);
});

test("touch move retains position and never resets dimensions",async()=>{
  const h=harness();await h.open();
  h.root.dispatch("pointerdown",{target:h.surface,clientX:200,clientY:120});
  h.root.dispatch("pointermove",{clientX:300,clientY:176.25});
  h.root.dispatch("pointerup",{clientX:300,clientY:176.25});
  assert.match(h.root.innerHTML,/left:20%;top:25%;width:25%;height:25%/);
  await h.save();
  assert.equal(h.saved().layers[0].x,20);
  assert.equal(h.saved().layers[0].y,25);
  assert.equal(h.saved().layers[0].w,25);
});

test("pointer cancellation retains last confirmed size",async()=>{
  const h=harness();await h.open();
  h.root.dispatch("pointerdown",{target:h.handle,clientX:200,clientY:120});
  h.root.dispatch("pointermove",{clientX:250,clientY:148.125});
  h.root.dispatch("pointercancel",{clientX:250,clientY:148.125});
  assert.match(h.root.innerHTML,/width:30%;height:30%/);
  h.root.dispatch("lostpointercapture",{pointerId:1});
  assert.match(h.root.innerHTML,/width:30%;height:30%/);
});

test("text layer can be written, styled and saved without clearing media layers", async()=>{
  const h=harness(); await h.open();
  h.document.getElementById("scene-add-text").dispatch("click",{});
  const field=h.document.getElementById("scene-text-input");
  field.value="سلام به StreamCore";
  field.dispatch("input",{});
  h.document.getElementById("scene-effect").value="slide-right";
  h.document.getElementById("scene-effect").dispatch("change",{});
  h.document.getElementById("scene-start").value="2";
  h.document.getElementById("scene-duration").value="6";
  h.document.getElementById("scene-repeat").value="20";
  h.document.getElementById("scene-start").dispatch("change",{});
  assert.match(h.root.innerHTML,/سلام به StreamCore/);
  await h.save();
  assert.equal(h.saved().layers.length,1,"media layers must be preserved");
  assert.equal(h.saved().text_layers.length,1);
  assert.equal(h.saved().text_layers[0].text,"سلام به StreamCore");
  assert.equal(h.saved().text_layers[0].effect,"slide-right");
  assert.equal(h.saved().text_layers[0].start_sec,2);
  assert.equal(h.saved().text_layers[0].duration_sec,6);
  assert.equal(h.saved().text_layers[0].repeat_sec,20);
});

test("overview polling during active resize never recreates the touched layer",async()=>{
  const h=harness();await h.open();
  h.root.dispatch("pointerdown",{target:h.handle,clientX:200,clientY:120});
  const initial=h.root.innerHTML;
  h.root.dispatch("pointermove",{clientX:350,clientY:176.25});
  h.window.StreamCoreScene.sync({
    channels:[{id:"main",name:"Main"}],
    media:[{id:7,file:"logo.png",name:"Brand logo",kind:"image"},
           {id:8,file:"extra.png",name:"New image",kind:"image"}]
  });
  assert.equal(h.root.innerHTML,initial,"periodic refresh must never rebuild active gesture DOM");
  assert.equal(h.root.captured,1);
  h.root.dispatch("pointerup",{clientX:350,clientY:176.25});
  assert.match(h.root.innerHTML,/width:40%;height:35%/);
  await h.save();
  assert.equal(h.saved().layers[0].w,40);
  assert.equal(h.saved().layers[0].h,35);
});

test("window gesture fallback resizes when pointer leaves canvas",async()=>{
  const h=harness();await h.open();
  h.root.dispatch("pointerdown",{target:h.handle,clientX:200,clientY:120});
  h.window.dispatch("pointermove",{clientX:300,clientY:176.25});
  h.window.dispatch("pointerup",{clientX:300,clientY:176.25});
  assert.match(h.root.innerHTML,/width:35%;height:35%/);
  await h.save();
  assert.equal(h.saved().layers[0].w,35);
  assert.equal(h.saved().layers[0].h,35);
});

test("touch cancellation retains geometry and versioned assets",async()=>{
  const h=harness();await h.open();
  h.root.dispatch("pointerdown",{target:h.handle,clientX:200,clientY:120});
  h.root.dispatch("pointermove",{clientX:350,clientY:176.25});
  h.root.dispatch("pointercancel",{clientX:350,clientY:176.25});
  await h.save();
  const saved=h.saved().layers[0];
  assert.equal(saved.w,40);
  assert.equal(saved.h,35);
  assert.equal(h.window.StreamCoreScene.hasUnsaved(),false);
  const html=fs.readFileSync(path.join(__dirname,"../dashboard/static/index.html"),"utf8");
  assert.match(html,/scene-editor\.js\?v=[0-9]+\.[0-9]+\.[0-9]+/);
  assert.match(html,/id="scene-gesture-status"/);
  assert.match(html,/id="scene-preset-50"/);
});

test("size preset is retained through API save",async()=>{
  const h=harness();await h.open();
  h.document.getElementById("scene-preset-50").dispatch("click",{});
  assert.match(h.root.innerHTML,/width:50%;height:28%/);
  await h.save();
  assert.equal(h.saved().layers[0].w,50);
  assert.equal(h.saved().layers[0].h,28);
});

test("narrow 390px Android viewport retains correct percentages",async()=>{
  const h=harness({canvasWidth:390,canvasHeight:219.375});
  await h.open();
  h.root.dispatch("pointerdown",{target:h.handle,clientX:170,clientY:80});
  h.root.dispatch("pointermove",{clientX:209,clientY:102});
  h.window.dispatch("pointerup",{clientX:209,clientY:102});
  // 39/390 = 10% horizontal; 22/219.375 ~ 10% vertical.
  assert.match(h.root.innerHTML,/width:35%;height:35%/);
  await h.save();
  assert.equal(h.saved().layers[0].w,35);
  assert.equal(h.saved().layers[0].h,35);
});

test("unexpected capture loss must retain the active Android drag",async()=>{
  const h=harness({canvasWidth:390,canvasHeight:219.375});
  await h.open();
  h.root.dispatch("pointerdown",{target:h.handle,clientX:170,clientY:80});
  h.root.dispatch("lostpointercapture",{pointerId:1});
  h.window.dispatch("pointermove",{pointerId:1,clientX:209,clientY:102});
  h.window.dispatch("pointerup",{pointerId:1,clientX:209,clientY:102});
  assert.match(h.root.innerHTML,/width:35%;height:35%/);
});

test("size preset near right edge repositions overlay rather than shrinking it",async()=>{
  const h=harness();await h.open();
  h.document.getElementById("scene-x").value=70;
  h.document.getElementById("scene-x").dispatch("change",{});
  h.document.getElementById("scene-preset-75").dispatch("click",{});
  assert.match(h.root.innerHTML,/left:25%/);
  assert.match(h.root.innerHTML,/width:75%/);
  await h.save();
  assert.equal(h.saved().layers[0].x,25);
  assert.equal(h.saved().layers[0].w,75);
});

test("small mobile logo is not hidden by the resize handle or canvas highlight",()=>{
  const css=fs.readFileSync(path.join(__dirname,"../dashboard/static/scene-editor.css"),"utf8");
  const html=fs.readFileSync(path.join(__dirname,"../dashboard/static/index.html"),"utf8");
  // Regression from user video: entire 16:9 canvas glowed orange on every drag.
  assert.match(css,/\.scene-canvas\.scene-gesturing\{border-color:#435368;box-shadow:none\}/);
  // The image must not clip the handle hanging outside its own bottom corner.
  assert.match(css,/\.scene-item\{[^}]*overflow:visible;/);
  // 14px visible dot, while the transparent 42px mobile hit area is large enough.
  assert.match(css,/\.scene-handle::after\{[^}]*width:14px;height:14px;/);
  assert.match(css,/\.scene-item \.scene-handle\{width:42px;height:42px;/);
  assert.match(html,/scene-editor\.css\?v=[0-9]+\.[0-9]+\.[0-9]+/);
  assert.match(html,/scene-editor\.js\?v=[0-9]+\.[0-9]+\.[0-9]+/);
});

test("studio warns when Telegram destination broadcasts a different channel",async()=>{
  const h=harness();await h.open();
  const data={
    media:[{id:7,file:"logo.png",name:"Brand logo",kind:"image"}],
    channels:[
      {id:"main",name:"Main",mode:"scene",running:true},
      {id:"secondary",name:"Secondary",mode:"file",running:true}
    ],
    destinations:[{
      channel_id:"secondary",platform:"telegram",label:"Telegram BlueCoin",enabled:true
    }]
  };
  h.window.StreamCoreScene.sync(data);
  const status=h.document.getElementById("scene-output-bindings");
  assert.match(status.textContent,/تلگرام فعال روی کانال دیگر/);
  assert.match(status.textContent,/secondary/);
  assert.equal(status.dataset.warning,"true");
  data.destinations[0].channel_id="main";
  h.window.StreamCoreScene.sync(data);
  assert.match(status.textContent,/مقصدهای فعال این کانال/);
  assert.equal(status.dataset.warning,"false");
});

test("studio warns when saved channel is not in Scene mode",async()=>{
  const h=harness();await h.open();
  h.window.StreamCoreScene.sync({
    media:[{id:7,file:"logo.png",name:"Brand logo",kind:"image"}],
    channels:[{id:"main",name:"Main",mode:"file",running:true}],
    destinations:[]
  });
  const status=h.document.getElementById("scene-output-bindings");
  assert.equal(status.dataset.warning,"true");
  assert.match(status.textContent,/حالت file/);
});

test("wrong-channel notice offers an explicit Telegram channel switch",async()=>{
  const h=harness();await h.open();
  h.window.StreamCoreScene.sync({
    media:[{id:7,file:"logo.png",name:"Brand logo",kind:"image"}],
    channels:[
      {id:"main",name:"Main",mode:"scene",running:true},
      {id:"other",name:"Other",mode:"scene",running:true}
    ],
    destinations:[{channel_id:"other",platform:"telegram",label:"Telegram",enabled:true}]
  });
  const button=h.document.getElementById("scene-go-telegram");
  assert.equal(button.hidden,false);
  assert.equal(button.dataset.channel,"other");
  await button.listeners.get("click")();
  assert.equal(h.document.getElementById("scene-channel").value,"other");
});

test("encoder stall is explicitly highlighted rather than represented as healthy live",async()=>{
  const h=harness();await h.open();
  h.window.StreamCoreScene.sync({
    media:[{id:7,file:"logo.png",name:"Brand logo",kind:"image"}],
    channels:[{id:"main",name:"Main",mode:"scene",running:true,encoder:{state:"stalled"}}],
    destinations:[{channel_id:"main",platform:"telegram",label:"Telegram",enabled:true}]
  });
  const node=h.document.getElementById("scene-output-bindings");
  assert.equal(node.dataset.warning,"true");
  assert.match(node.textContent,/پردازش FFmpeg/);
});

test("unsaved canvas is clearly marked as draft and live frames are not implied",async()=>{
  const h=harness();await h.open();
  const draft=h.document.getElementById("scene-draft-indicator");
  assert.equal(draft.hidden,true);
  h.root.dispatch("pointerdown",{target:h.handle,clientX:200,clientY:120});
  h.root.dispatch("pointermove",{clientX:350,clientY:176.25});
  h.root.dispatch("pointerup",{clientX:350,clientY:176.25});
  assert.equal(draft.hidden,false,"unsaved changes must be visibly distinguished from output");
  await h.save();
  assert.equal(draft.hidden,true,"a server-confirmed save may clear the draft warning");
});

test("scene editor asks FFmpeg for the authentic test background",async()=>{
  const h=harness();await h.open();
  const source=h.document.getElementById("scene-base-image");
  assert.equal(source.src,"/api/scene/test-pattern");
  assert.equal(source.hidden,false);
  assert.equal(h.document.getElementById("scene-colorbars").hidden,true);
  source.onerror();
  assert.equal(source.hidden,true);
  assert.equal(h.document.getElementById("scene-colorbars").hidden,false);
});

test("safe area guides toggle without interfering with layer geometry",async()=>{
  const h=harness();await h.open();
  const guide=h.document.getElementById("scene-safe-area");
  guide.hidden=true;
  const button=h.document.getElementById("scene-toggle-safe");
  button.dispatch("click",{});
  assert.equal(guide.hidden,false);
  assert.equal(button.getAttribute("aria-pressed"),"true");
  button.dispatch("click",{});
  assert.equal(guide.hidden,true);
  assert.equal(button.getAttribute("aria-pressed"),"false");
});
