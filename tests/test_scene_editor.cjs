/* Regression: mobile resize/move MUST persist after pointerup redraw.
   No third-party test dependency: run with node --test tests/test_scene_editor.cjs. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");

function harness() {
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
    getBoundingClientRect(){return {width:1000,height:562.5,left:0,top:0};}
    removeAttribute() {}
    focus() {}
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
  const window={addEventListener(){},StreamCoreScene:null};
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
    return {ok:true};
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
