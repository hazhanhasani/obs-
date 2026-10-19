"use strict";
/* Browser-level visual regression: DOM mocks alone cannot detect CSS specificity.
 * Uses Chrome shipped with ubuntu-latest GitHub Actions, no npm dependencies. */
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const child = require("node:child_process");
const css = fs.readFileSync(
  path.join(__dirname, "../dashboard/static/scene-editor.css"), "utf8");

function findChrome() {
  const choices = [
    process.env.CHROME_BIN, "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  return choices.find(p => fs.existsSync(p));
}

function snapshot(viewportWidth) {
  const chrome = findChrome();
  if (!chrome) throw Error("Chrome is required for computed layout testing");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"streamcore-corners-"));
  try {
    const html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"+
      "<style>"+css+"</style><style>body{margin:0}.scene-canvas{"+
      "position:relative;width:360px;height:250px;aspect-ratio:auto;overflow:visible;margin:30px}"+
      ".scene-items{position:absolute;inset:0}"+
      ".scene-item{left:70px;top:60px;width:120px;height:100px;}</style></head><body>"+
      "<div class='scene-canvas'><div class='scene-items'>"+
      "<div class='scene-item selected' data-layer='fixture'>"+
      ["nw","ne","sw","se"].map(c=>"<span class='scene-handle scene-handle-"+c+
        "' data-resize-corner='"+c+"'></span>").join("")+
      "</div></div></div><output id='scene-result'></output>"+
      "<script>"+
      "const el=document.querySelector('.scene-item'),b=el.getBoundingClientRect();"+
      "const output={viewport:innerWidth,item:{left:b.left,top:b.top,right:b.right,bottom:b.bottom},handles:{}};"+
      "for(const corner of ['nw','ne','sw','se']){"+
      "const handle=document.querySelector('[data-resize-corner=\"'+corner+'\"]');"+
      "const rect=handle.getBoundingClientRect();const style=getComputedStyle(handle);"+
      "const cx=(rect.left+rect.right)/2,cy=(rect.top+rect.bottom)/2;"+
      "output.handles[corner]={x:cx,y:cy,width:rect.width,height:rect.height,"+
      "hit:document.elementFromPoint(cx,cy)?.dataset?.resizeCorner||null,"+
      "events:style.pointerEvents,display:style.display};"+
      "}"+
      "document.querySelector('#scene-result').textContent=JSON.stringify(output);"+
      "</script></body></html>";
    const file=path.join(dir,"fixture.html");
    fs.writeFileSync(file,html,"utf8");
    const process=child.spawnSync(chrome,[
      "--headless=new","--no-sandbox","--disable-dev-shm-usage","--disable-gpu",
      "--no-first-run","--no-default-browser-check","--disable-background-networking",
      "--disable-extensions","--disable-features=MediaRouter",
      "--window-size="+viewportWidth+",760","--virtual-time-budget=1200",
      "--dump-dom","file://"+file
    ],{encoding:"utf8",timeout:20000,maxBuffer:5*1024*1024});
    if(process.error)throw process.error;
    if(process.status!==0)throw Error("Chrome exited "+process.status+": "+(process.stderr||"").slice(-600));
    const match=process.stdout.match(/<output id="scene-result">([^<]+)<\/output>/);
    if(!match)throw Error("Missing Chrome-computed scene result: "+process.stdout.slice(-500));
    return JSON.parse(match[1].replaceAll("&quot;",'"').replaceAll("&amp;","&"));
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
for(const viewport of [500,1080]) {
  test("four distinct draggable corners in real Chromium CSS viewport "+viewport,()=>{
    const result=snapshot(viewport);
    const b=result.item;
    for(const corner of ["nw","ne","sw","se"]){
      const h=result.handles[corner];
      assert.equal(h.hit,corner,"pointer hit-test must resolve "+corner);
      assert.equal(h.events,"auto",corner+" must receive pointer input");
      assert.equal(h.display,"grid",corner+" must remain visible");
      assert.ok(Math.abs(h.x-(corner.includes("w")?b.left:b.right))<3,
        corner+" x is incorrectly positioned by an older CSS selector");
      assert.ok(Math.abs(h.y-(corner.includes("n")?b.top:b.bottom))<3,
        corner+" y is incorrectly positioned by an older CSS selector");
      assert.ok(h.width>=34&&h.height>=34,"touch area must remain usable");
    }
    assert.notEqual(result.handles.nw.x,result.handles.se.x);
    assert.notEqual(result.handles.nw.y,result.handles.se.y);
  });
}
