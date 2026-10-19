"use strict";
// Real browser input against the production HTML/CSS/JS and isolated real API.
const {test:nodeTest,before,after}=require('node:test');
const test=(name,fn)=>nodeTest(name,{timeout:45000},fn);
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const net=require('node:net');
let browser,server,url,serverLog='';
before(async()=>{
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  url=`http://127.0.0.1:${port}`;
  server=spawn(process.env.PYTHON||'python',['tests/scene_browser_server.py',String(port)]);
  server.stderr.on('data',d=>serverLog+=d);
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw Error(serverLog);
    try{if((await fetch(url+'/health')).ok)break;}catch{}
    await new Promise(r=>setTimeout(r,100));
    if(i===99)throw Error('API startup failed: '+serverLog);
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();server?.kill();});
const layer=(extra={})=>({layer_id:'logo_test',media_file:'logo.png',x:20,y:25,w:40,h:40,fit:'stretch',opacity:100,effect:'none',...extra});
async function setup(width=1080,preset='landscape',layers=[layer()],touch=false,texts=[],deviceScaleFactor=1){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:touch,hasTouch:touch,deviceScaleFactor,...(process.env.SCENE_VIDEO?{recordVideo:{dir:'test-results/video',size:{width,height:1000}}}:{})});
  const page=await context.newPage(),errors=[],cancels=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('https://**/*',r=>r.fulfill({status:200,body:''}));
  await page.route('**/favicon.ico',r=>r.fulfill({status:204}));
  const login=await page.request.post(url+'/api/login',{data:{username:'browseradmin',password:'browser-test-password'}});
  const csrf=(await login.json()).csrf;
  const response=await page.request.put(url+'/api/channels/main/scene',{headers:{'X-CSRF-Token':csrf},data:{base_file:'black.mp4',canvas_preset:preset,layers,text_layers:texts}});
  assert.equal(response.status(),200,await response.text());
  await page.addInitScript(()=>{window.gestureCancels=[];document.addEventListener('pointercancel',e=>window.gestureCancels.push(e.pointerType),true);});
  async function openEditor(){
    await page.locator("#app").waitFor({state:"visible"});
    const menu=page.locator('#menu-toggle');
    if(await menu.isVisible()){
      await menu.tap();
      await page.waitForFunction(()=>document.getElementById('app').classList.contains('menu-open'));
      await page.locator('[data-page="scene"]').tap();
    }else await page.locator('[data-page="scene"]').click();
  }
  await page.goto(url);
  await openEditor();
  await page.locator('.scene-item.selected').waitFor();
  await page.locator('#scene-canvas').scrollIntoViewIfNeeded();
  const geometry=()=>page.evaluate(()=>Object.fromEntries(['x','y','w','h'].map(k=>[k,Number(document.getElementById('scene-'+k).value)])));
  async function assertVisual(){
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const g=await geometry(),frame=await page.locator('#scene-items').boundingBox();
    const box=await page.locator('.scene-item.selected').boundingBox();
    for(const [key,actual,expected] of [['x',box.x,frame.x+g.x*frame.width/100],['y',box.y,frame.y+g.y*frame.height/100],['w',box.width,g.w*frame.width/100],['h',box.height,g.h*frame.height/100]])assert.ok(Math.abs(actual-expected)<1,`${key}: DOM ${actual} != model ${expected}`);
    return g;
  }
  async function saveReload(){
    const g=await assertVisual();
    const responsePromise=page.waitForResponse(r=>r.url().endsWith('/scene')&&r.request().method()==='PUT');
    await page.locator('#scene-save').click();
    const response=await responsePromise;
    assert.equal(response.status(),200,await response.text());
    await page.waitForFunction(()=>!window.StreamCoreScene.hasUnsaved(),null,{timeout:10000}).catch(async error=>{
      throw new Error('Save did not settle: '+JSON.stringify({response:await response.json(),
        geometry:await geometry(),toast:await page.locator('#toast').textContent()})+'; '+error.message);
    });
    const stored=await (await page.request.get(url+'/api/channels/main/scene')).json();
    for(const k of ['x','y','w','h'])assert.equal((stored.layers[0]||stored.text_layers[0])[k],g[k],k+' SQLite persistence');
    await page.reload();await openEditor();
    await page.locator('.scene-item.selected').waitFor();
    assert.deepEqual(await assertVisual(),g,'reload must preserve geometry');
  }
  async function finish(){
    if(process.env.SCENE_SCREENSHOT)await page.locator('.scene-grid > .panel').first().screenshot({path:process.env.SCENE_SCREENSHOT});
    assert.deepEqual(errors,[],'browser errors');
    assert.deepEqual(await page.evaluate(()=>window.gestureCancels),[], 'unexpected pointercancel');
    await context.close();
  }
  return {page,context,geometry,assertVisual,saveReload,finish,csrf};
}
async function drag(page,selector,dx,dy,touch=false){
  await page.locator('#scene-canvas').scrollIntoViewIfNeeded();
  const b=await page.locator(selector).boundingBox();assert.ok(b,selector);
  const x=b.x+b.width/2,y=b.y+b.height/2;
  const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.dataset.resizeCorner,{x,y});
  if(selector.includes('data-resize-corner'))assert.equal(hit,selector.match(/data-resize-corner="(\w+)"/)[1],'actual handle hit target');
  if(touch){
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
  }else{
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();
  }
}
for(const [width,touch] of [[1080,false],[360,true],[390,true],[430,true]])for(const preset of ['landscape','landscape_fullhd','portrait','portrait_fullhd']){
  for(const corner of ['nw','ne','sw','se'])test(`${width} ${preset} ${touch?'touch':'mouse'} ${corner}: anchor, release, SQLite reload`,async()=>{
    const h=await setup(width,preset,[layer()],touch);
    try{
      const b=await h.page.locator('#scene-items').boundingBox();
      const before=await h.geometry();
      await drag(h.page,`[data-resize-corner="${corner}"]`,b.width*.08,b.height*.06,touch);
      const g=await h.geometry();
      assert.ok(Math.abs(g.w-(corner.includes('w')?32:48))<.3,JSON.stringify(g));
      assert.ok(Math.abs(g.h-(corner.includes('n')?34:46))<.3,JSON.stringify(g));
      assert.ok(Math.abs((corner.includes('w')?g.x+g.w:g.x)-(corner.includes('w')?before.x+before.w:before.x))<.15,'opposite x anchor');
      assert.ok(Math.abs((corner.includes('n')?g.y+g.h:g.y)-(corner.includes('n')?before.y+before.h:before.y))<.15,'opposite y anchor');
      await h.saveReload();await h.finish();
    }catch(e){await h.context.close();throw e;}
  });
}
test('partially outside layer: handles remain reachable and drag continues past canvas',async()=>{
  const h=await setup(1080,'landscape',[layer({x:-2,y:30})]);
  try{
    const b=await h.page.locator('#scene-items').boundingBox();
    await drag(h.page,'[data-resize-corner="nw"]',-20,-10);
    const g=await h.assertVisual();assert.ok(g.x < -2);assert.ok(g.w>40);
    await drag(h.page,'.scene-item.selected',-b.width*.4,0);
    assert.ok((await h.geometry()).x < -30);
    await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('selected lower layer handles win over overlapping higher layer',async()=>{
  const h=await setup(390,'landscape',[layer({opacity:50}),layer({layer_id:'overlap_test',x:10,y:10,w:80,h:80})],true);
  try{
    await h.page.locator('[data-select-layer="logo_test"] .scene-list-name').click();
    await h.page.locator('#scene-canvas').scrollIntoViewIfNeeded();
    await drag(h.page,'.scene-transform [data-resize-corner="se"]',20,15,true);
    assert.ok((await h.geometry()).w>40);await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('tiny layer: four non-overlapping targets resize independently',async()=>{
  const h=await setup(360,'landscape',[layer({w:.1,h:.1})],true);
  try{
    const frame=await h.page.locator('#scene-items').boundingBox();
    for(const corner of ['nw','ne','sw','se']){
      const before=await h.geometry();
      await drag(h.page,`[data-resize-corner="${corner}"]`,corner.includes('w')?-3:3,corner.includes('n')?-3:3,true);
      const g=await h.assertVisual();
      assert.ok(Math.abs(g.w-before.w-300/frame.width)<.2,'tiny width delta');
      assert.ok(Math.abs(g.h-before.h-300/frame.height)<.2,'tiny height delta');
      assert.ok(Math.abs((corner.includes('w')?g.x+g.w:g.x)-(corner.includes('w')?before.x+before.w:before.x))<.15,'tiny x anchor');
      assert.ok(Math.abs((corner.includes('n')?g.y+g.h:g.y)-(corner.includes('n')?before.y+before.h:before.y))<.15,'tiny y anchor');
    }
    await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
for(const preset of ['landscape','landscape_fullhd','portrait','portrait_fullhd'])test(`${preset}: real DOM box agrees with decoded FFmpeg pixels`,async()=>{
  const h=await setup(1080,preset,[layer({x:-2.5,y:31.2,w:40.1,h:22.3})]);
  try{
    await drag(h.page,'[data-resize-corner="se"]',12,17);
    const g=await h.assertVisual();
    // Use the actual UI render button and production render route/filter graph.
    const responsePromise=h.page.waitForResponse(r=>r.url().endsWith('/scene/preview'));
    await h.page.locator('#scene-render-actual').click();
    const response=await responsePromise;assert.equal(response.status(),200);
    await h.page.locator('#scene-render-image').waitFor({state:'visible'});
    const pixels=await h.page.evaluate(async()=>{
      const image=document.getElementById('scene-render-image');await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const i=(y*canvas.width+x)*4;
        if(data[i]>180&&data[i+1]<70&&data[i+2]<90){minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY);}
      }
      return {width:canvas.width,height:canvas.height,minX,maxX,minY,maxY};
    });
    const dims={landscape:[1280,720],landscape_fullhd:[1920,1080],portrait:[720,1280],portrait_fullhd:[1080,1920]}[preset];
    assert.deepEqual([pixels.width,pixels.height],dims);
    const [w,ht]=dims;
    const x=Math.round(w*g.x/100),y=Math.round(ht*g.y/100);
    const expected={minX:Math.max(0,x),minY:Math.max(0,y),maxX:Math.min(w-1,x+Math.max(2,Math.floor(w*g.w/200)*2)-1),maxY:Math.min(ht-1,y+Math.max(2,Math.floor(ht*g.h/200)*2)-1)};
    for(const k of Object.keys(expected))assert.ok(Math.abs(pixels[k]-expected[k])<=2,`${k}: FFmpeg ${pixels[k]} vs editor ${expected[k]}`);
    await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('browser cancellation preserve last geometry and allow next gesture',async()=>{
  const h=await setup(390,'landscape',[layer()],true);
  try{
    const cdp=await h.context.newCDPSession(h.page);
    const b=await h.page.locator('[data-resize-corner="se"]').boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+15,y:y+10,id:1}]});
    const before=await h.geometry();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    assert.deepEqual(await h.assertVisual(),before);
    await drag(h.page,'[data-resize-corner="se"]',10,10,true);
    assert.ok((await h.geometry()).w>before.w);
    assert.equal(await h.page.locator('#scene-items').getAttribute('data-transform-state'),'selected');
    // The cancellation above was deliberately injected, not unexpected.
    await h.page.evaluate(()=>{window.gestureCancels=[];});
    await cdp.detach();await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('pen input retains capture outside the frame and stable DOM during polling',async()=>{
  const h=await setup();
  try{
    const b=await h.page.locator('[data-resize-corner="se"]').boundingBox();const x=b.x+22,y=b.y+22;
    const cdp=await h.context.newCDPSession(h.page);
    await h.page.evaluate(()=>{window.originalLayer=document.querySelector('.scene-item');window.originalRoot=document.getElementById('scene-items');});
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+100,y:y+60,button:'left',buttons:1,pointerType:'pen'});
    await h.page.evaluate(()=>{
      const root=document.getElementById('scene-items');for(let id=1;id<10;id++)if(root.hasPointerCapture(id))root.releasePointerCapture(id);
      window.StreamCoreScene.sync({channels:[{id:'main',name:'Main'}],media:[{id:1,file:'logo.png',name:'Logo',kind:'image'},{id:2,file:'black.mp4',name:'Black',kind:'video'}]});
    });
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+160,y:y+90,button:'left',buttons:1,pointerType:'pen'});
    assert.equal(await h.page.evaluate(()=>window.originalLayer===document.querySelector('.scene-item')),true);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+160,y:y+90,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
    assert.ok((await h.assertVisual()).w>40);
    await cdp.detach();await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
for(const corner of ['nw','ne','sw','se'])test(`text layer ${corner}: touch resize and reload`,async()=>{
  const text={layer_id:'text_test',text:'Scene caption',x:20,y:25,w:40,h:40,font_size:32,color:'#ffffff',background:'transparent',align:'left',outline:0,opacity:60,effect:'none'};
  const h=await setup(390,'portrait',[],true,[text]);
  try{
    const g=await h.geometry();
    await drag(h.page,`[data-resize-corner="${corner}"]`,5,10,true);
    const next=await h.assertVisual();assert.notEqual(next.w,g.w);assert.notEqual(next.h,g.h);
    await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('orientation and numeric controls preserve geometry',async()=>{
  const h=await setup();
  try{
    for(const [k,v] of Object.entries({x:-12.3,y:110.5,w:55.2,h:9.7})){
      await h.page.locator('#scene-'+k).fill(String(v));await h.page.locator('#scene-'+k).press('Tab');
    }
    const g=await h.assertVisual();
    await h.page.locator('#scene-canvas-preset').selectOption('landscape_fullhd');
    assert.deepEqual(await h.assertVisual(),g);
    await h.page.locator('#scene-canvas-preset').selectOption('portrait');
    assert.deepEqual(await h.assertVisual(),g);
    await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('missed pointerup after capture loss recovers with reused mouse pointer ID',async()=>{
  const h=await setup();
  try{
    const b=await h.page.locator('[data-resize-corner="se"]').boundingBox();
    await h.page.mouse.move(b.x+22,b.y+22);await h.page.mouse.down();
    await h.page.mouse.move(b.x+32,b.y+32);
    await h.page.evaluate(()=>{
      const root=document.getElementById('scene-items');
      for(let id=1;id<10;id++)if(root.hasPointerCapture(id))root.releasePointerCapture(id);
      window.addEventListener('pointerup',e=>e.stopImmediatePropagation(),{once:true,capture:true});
    });
    await h.page.mouse.up();
    const before=await h.geometry();
    await drag(h.page,'[data-resize-corner="nw"]',20,20);
    const frame=await h.page.locator('#scene-items').boundingBox();
    assert.ok(Math.abs((await h.assertVisual()).w-(before.w-20*100/frame.width))<.2,'new corner must start from the last committed baseline');
    await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('edits and preset change during pending save remain a dirty local draft',async()=>{
  const h=await setup();
  try{
    await drag(h.page,'[data-resize-corner="se"]',15,10);
    const first=await h.geometry();let release,started;
    const pending=new Promise(r=>release=r),received=new Promise(r=>started=r);
    await h.page.route('**/api/channels/main/scene',async route=>{
      if(route.request().method()!=='PUT')return route.continue();
      started();await pending;await route.continue();
    });
    await h.page.locator('#scene-save').click();await received;
    await h.page.locator('#scene-canvas-preset').selectOption('portrait');
    await h.page.locator('#scene-x').fill('-12.3');await h.page.locator('#scene-x').press('Tab');
    const completion=h.page.waitForResponse(r=>r.url().endsWith('/api/channels/main/scene')&&r.request().method()==='PUT');
    release();assert.equal((await completion).status(),200);
    await h.page.waitForFunction(()=>!document.getElementById('scene-save').disabled);
    const stored=await (await h.page.request.get(url+'/api/channels/main/scene')).json();
    assert.equal(stored.canvas_preset,'landscape');assert.equal(stored.layers[0].x,first.x);
    assert.equal(await h.page.evaluate(()=>window.StreamCoreScene.hasUnsaved()),true);
    assert.equal(await h.page.locator('#scene-items').getAttribute('data-transform-state'),'selected');
    assert.equal(await h.page.locator('#scene-canvas').getAttribute('data-orientation'),'portrait');
    assert.equal((await h.assertVisual()).x,-12.3);
    await h.page.unroute('**/api/channels/main/scene');
    await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('viewport resize mid-gesture adds no transform displacement',async()=>{
  const h=await setup();
  try{
    const b=await h.page.locator('[data-resize-corner="se"]').boundingBox(),x=b.x+22,y=b.y+22;
    await h.page.mouse.move(x,y);await h.page.mouse.down();await h.page.mouse.move(x+20,y+20);
    const before=await h.geometry();
    await h.page.setViewportSize({width:1200,height:1000});
    await h.page.mouse.move(x+20,y+20);await h.page.mouse.up();
    assert.deepEqual(await h.assertVisual(),before);
    await h.finish();
  }catch(e){await h.context.close();throw e;}
});

if(process.env.SCENE_VIDEO)test('mobile four-corner demonstration',async()=>{
  const h=await setup(390,'landscape',[layer()],true);
  try{
    for(const corner of ['nw','ne','sw','se']){
      await drag(h.page,`[data-resize-corner="${corner}"]`,corner.includes('w')?-8:8,corner.includes('n')?-6:6,true);
      await h.assertVisual();
    }
    await h.saveReload();await h.page.locator('#scene-canvas').scrollIntoViewIfNeeded();
    await h.page.screenshot({path:'test-results/scene-demo.png'});await h.finish();
  }catch(e){await h.context.close();throw e;}
});

// Chromium touch adjustment uses the contact ellipse to prefer interactive
// controls. A point-sized synthetic touch cannot detect retargeting of a
// decorative grip to a nearby media element with role=button.
for(const [width,preset,dpr] of [[390,'landscape',1],[393,'portrait',2.75],[360,'landscape',3]])
for(const corner of ['nw','ne','sw','se'])test(`Android finger contact ${width} DPR ${dpr} visible ${corner}`,async()=>{
  const h=await setup(width,preset,[layer()],true,[],dpr);
  try{
    await h.page.evaluate(()=>{
      window.contactTargets=[];document.addEventListener('pointerdown',e=>window.contactTargets.push({tag:e.target.tagName,corner:e.target.closest('[data-resize-corner]')?.dataset.resizeCorner,layer:e.target.closest('[data-layer]')?.dataset.layer}),true);
    });
    const cdp=await h.context.newCDPSession(h.page);
    for(const radius of [1,8,14,22]){
      await h.page.evaluate(()=>{window.contactTargets=[];});
      const b=await h.page.locator(`[data-resize-corner="${corner}"]`).boundingBox();
      const x=corner.includes('w')?b.x+b.width-7.5:b.x+7.5;
      const y=corner.includes('n')?b.y+b.height-7.5:b.y+7.5;
      const before=await h.geometry(),frame=await h.page.locator('#scene-items').boundingBox();
      const point=(dx,dy)=>({x:x+dx,y:y+dy,id:1,radiusX:radius,radiusY:radius,force:.7});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(0,0)]});
      for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(i,i)]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      const targets=await h.page.evaluate(()=>window.contactTargets),g=await h.assertVisual();
      assert.equal(targets[0]?.corner,corner,JSON.stringify({radius,targets}));
      assert.equal(targets[0]?.tag,'BUTTON','grip must be a real interactive touch target');
      assert.ok(Math.abs(g.w-before.w-(corner.includes('w')?-800:800)/frame.width)<.25,'finger resize width delta');
      assert.ok(Math.abs(g.h-before.h-(corner.includes('n')?-800:800)/frame.height)<.25,'finger resize height delta');
      assert.ok(Math.abs((corner.includes('w')?g.x+g.w:g.x)-(corner.includes('w')?before.x+before.w:before.x))<.15,'finger fixed X edge');
      assert.ok(Math.abs((corner.includes('n')?g.y+g.h:g.y)-(corner.includes('n')?before.y+before.h:before.y))<.15,'finger fixed Y edge');
    }
    await cdp.detach();await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});

for(const [width,touch,preset] of [[1600,false,'landscape'],[360,true,'portrait'],[390,true,'portrait'],[430,true,'portrait']]){
  for(const edge of ['n','e','s','w'])test(`OBS ${width} ${edge}: edge-only transform and history`,async()=>{
    const h=await setup(width,preset,[layer({x:10,y:10,w:80,h:80})],touch);
    try{
      const before=await h.geometry(),b=await h.page.locator('#scene-items').boundingBox();
      await drag(h.page,`[data-resize-corner="${edge}"]`,b.width*.04,b.height*.04,touch);
      const g=await h.assertVisual();
      if(['n','s'].includes(edge)){assert.equal(g.w,80);assert.equal(g.x,10);assert.ok(g.h!==80);}
      else {assert.equal(g.h,80);assert.equal(g.y,10);assert.ok(g.w!==80);}
      await h.page.locator('#scene-undo').click();assert.deepEqual(await h.geometry(),before);
      await h.page.locator('#scene-redo').click();assert.deepEqual(await h.geometry(),g);
      await h.saveReload();await h.finish();
    }catch(e){await h.context.close();throw e;}
  });
}
test('OBS geometry-first handle detection survives a non-handle DOM target',async()=>{
  const h=await setup(1080);
  try{
    // Remove handle hit testing only. Native input must still pick the corner
    // geometrically when the browser targets the persistent canvas root.
    await h.page.evaluate(()=>document.querySelectorAll('.scene-handle').forEach(el=>el.style.pointerEvents='none'));
    const frame=await h.page.locator('#scene-items').boundingBox(),g=await h.geometry();
    const x=frame.x+frame.width*g.x/100-4,y=frame.y+frame.height*g.y/100-4;
    await h.page.mouse.move(x,y);await h.page.mouse.down();
    await h.page.mouse.move(x-15,y-10,{steps:5});await h.page.mouse.up();
    const after=await h.geometry();assert.ok(after.w>g.w);assert.ok(after.h>g.h);
    assert.ok(Math.abs(after.x+after.w-g.x-g.w)<.15);await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS aspect lock, Escape rollback, keyboard undo and pixel nudge',async()=>{
  const h=await setup(1080);
  try{
    await h.page.locator('#scene-aspect').click();
    await drag(h.page,'[data-resize-corner="se"]',25,5);
    const g=await h.geometry();assert.ok(Math.abs(g.w/g.h-1)<.01);
    const b=await h.page.locator('[data-resize-corner="se"]').boundingBox();
    await h.page.mouse.move(b.x+22,b.y+22);await h.page.mouse.down();
    await h.page.mouse.move(b.x+45,b.y+33);
    await h.page.keyboard.press('Escape');await h.page.mouse.up();
    assert.deepEqual(await h.geometry(),g);
    await h.page.locator('.scene-item.selected').focus();
    await h.page.keyboard.press('Control+z');assert.equal((await h.geometry()).w,40);
    await h.page.keyboard.press('Control+Shift+z');assert.deepEqual(await h.geometry(),g);
    await h.page.keyboard.press('Shift+ArrowRight');
    assert.ok(Math.abs((await h.geometry()).x-g.x-10/1280*100)<.11);
    await h.page.locator('#scene-x').fill('12');
    await h.page.keyboard.press('ArrowRight'); // native caret, never source movement
    await h.page.locator('#scene-x').press('Tab');assert.equal((await h.geometry()).x,12);
    await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS locks and visibility persist; locked overlay cannot intercept an unlocked source',async()=>{
  const h=await setup(1080,'landscape',[layer(),layer({layer_id:'top_locked',x:10,y:10,w:80,h:80,locked:true})]);
  try{
    const g=await h.geometry();
    await drag(h.page,'.scene-item[data-layer="logo_test"]',10,10);
    assert.ok((await h.geometry()).x>g.x);
    await h.page.locator('[data-layer-lock="logo_test"]').click();
    assert.equal(await h.page.locator('.scene-transform').count(),0);
    assert.equal(await h.page.locator('#scene-x').isDisabled(),true);
    await h.page.locator('[data-layer-visible="logo_test"]').click();
    assert.equal(await h.page.locator('.scene-item[data-layer="logo_test"]').count(),0);
    await h.page.locator('#scene-save').click();await h.page.waitForFunction(()=>!window.StreamCoreScene.hasUnsaved());
    const data=await (await h.page.request.get(url+'/api/channels/main/scene')).json();
    assert.equal(data.layers[0].locked,true);assert.equal(data.layers[0].visible,false);
    await h.page.reload();await h.page.locator('#app').waitFor({state:'visible'});
    await h.page.locator('[data-page="scene"]').click();
    await h.page.locator('[data-layer-visible="logo_test"]').waitFor();
    assert.equal(await h.page.locator('.scene-item[data-layer="logo_test"]').count(),0);
    await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS zoom changes displayed scale without changing saved geometry; fit/stretch are undoable',async()=>{
  const h=await setup(1080,'portrait');
  try{
    const before=await h.geometry(),old=await h.page.locator('#scene-items').boundingBox();
    await h.page.locator('#scene-zoom').selectOption('1.5');
    const zoomed=await h.page.locator('#scene-items').boundingBox();
    assert.ok(Math.abs(zoomed.width/old.width-1.5)<.02);assert.deepEqual(await h.geometry(),before);
    await drag(h.page,'[data-resize-corner="se"]',zoomed.width*.05,zoomed.height*.03);
    assert.ok(Math.abs((await h.geometry()).w-45)<.2);
    await h.page.locator('#scene-stretch-selected').click();
    assert.deepEqual(await h.geometry(),{x:0,y:0,w:100,h:100});
    await h.page.locator('#scene-undo').click();assert.ok(Math.abs((await h.geometry()).w-45)<.2);
    await h.page.locator('#scene-fit-selected').click();
    const fit=await h.geometry();assert.ok(fit.w<=100&&fit.h<=100);assert.ok(fit.w===100||fit.h===100);
    await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS optional snapping aligns to frame edge and Ctrl bypass remains free',async()=>{
  const h=await setup(1600,'landscape',[layer({x:20,y:25})]);
  try{
    await h.page.locator('#scene-snapping').click();
    const b=await h.page.locator('#scene-items').boundingBox();
    await drag(h.page,'.scene-item.selected',-b.width*.2+2,0);
    assert.equal((await h.geometry()).x,0);
    await h.page.keyboard.down('Control');
    await drag(h.page,'.scene-item.selected',-3,0);
    await h.page.keyboard.up('Control');assert.ok((await h.geometry()).x<0);
    await h.finish();
  }catch(e){await h.context.close();throw e;}
});

test('OBS fit uses intrinsic source aspect rather than a previously distorted box',async()=>{
  const h=await setup(1080,'portrait',[layer({w:70,h:15,fit:'stretch'})]);
  try{
    await h.page.locator('.scene-item img').evaluate(img=>img.decode());
    await h.page.locator('#scene-fit-selected').click();
    const g=await h.geometry();
    assert.equal(g.w,100);assert.ok(Math.abs(g.h-56.25)<.11,JSON.stringify(g));
    assert.equal(await h.page.locator('#scene-fit').inputValue(),'contain');
    await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS shared media/text order and visibility match decoded FFmpeg pixels',async()=>{
  const text={layer_id:'text_blue',text:'OBS',x:20,y:25,w:40,h:40,font_size:20,color:'#ffffff',
    background:'#0000ff',align:'center',outline:0,opacity:100,effect:'none',start_sec:0,duration_sec:0,repeat_sec:0};
  const h=await setup(1080,'landscape',[layer()],false,[text]);
  try{
    async function pixel(){
      await h.page.locator('#scene-render-actual').click();
      await h.page.locator('#scene-render-image').waitFor({state:'visible'});
      return h.page.locator('#scene-render-image').evaluate(async img=>{
        await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
        return [...ctx.getImageData(Math.round(canvas.width*.3),Math.round(canvas.height*.3),1,1).data];
      });
    }
    const blue=await pixel();assert.ok(blue[2]>blue[0]+100,JSON.stringify(blue));
    await h.page.locator('[data-layer-up="logo_test"]').click();
    assert.ok(Number(await h.page.locator('.scene-item[data-layer="logo_test"]').evaluate(el=>el.style.zIndex))>
      Number(await h.page.locator('.scene-item[data-layer="text_blue"]').evaluate(el=>el.style.zIndex)));
    const red=await pixel();assert.ok(red[0]>200&&red[2]<80,JSON.stringify(red));
    await h.page.locator('[data-layer-visible="logo_test"]').click();
    const hidden=await pixel();assert.ok(hidden[2]>hidden[0]+100,JSON.stringify(hidden));
    await h.page.locator('#scene-save').click();await h.page.waitForFunction(()=>!window.StreamCoreScene.hasUnsaved());
    const data=await (await h.page.request.get(url+'/api/channels/main/scene')).json();
    assert.equal(data.layers[0].visible,false);assert.ok(data.layers[0].z_index>data.text_layers[0].z_index);
    await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS numeric aspect lock limits both dimensions together',async()=>{
  const h=await setup(1080,'landscape',[layer({w:20,h:100})]);
  try{
    await h.page.locator('#scene-aspect').click();
    await h.page.locator('#scene-w').fill('100');await h.page.locator('#scene-w').press('Tab');
    const g=await h.geometry();assert.equal(g.w,40);assert.equal(g.h,200);
    await h.saveReload();await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS clicking a source transfers keyboard editing focus to the canvas',async()=>{
  const h=await setup(1080);
  try{
    const g=await h.geometry();
    await h.page.locator('.scene-item.selected').click();
    await h.page.keyboard.press('Shift+ArrowRight');
    assert.ok((await h.geometry()).x>g.x,'click then arrow must nudge without manually focusing the root');
    await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS hand tool pans an enlarged workspace without moving sources',async()=>{
  const h=await setup(1080,'portrait');
  try{
    await h.page.locator('#scene-zoom').selectOption('2');
    await h.page.locator('#scene-pan').click();
    const g=await h.geometry(),workspace=h.page.locator('.scene-workspace');
    await workspace.scrollIntoViewIfNeeded();const b=await workspace.boundingBox();
    const before=await workspace.evaluate(el=>[el.scrollLeft,el.scrollTop]);
    await h.page.mouse.move(b.x+b.width/2,b.y+100);await h.page.mouse.down();
    await h.page.mouse.move(b.x+b.width/2-50,b.y+40,{steps:6});await h.page.mouse.up();
    const after=await workspace.evaluate(el=>[el.scrollLeft,el.scrollTop]);
    assert.ok(after[0]>before[0]||after[1]>before[1],JSON.stringify({before,after}));
    assert.deepEqual(await h.geometry(),g);await h.finish();
  }catch(e){await h.context.close();throw e;}
});
test('OBS mobile hand tool scrolls with native touch without transforming a source',async()=>{
  const h=await setup(390,'portrait',[layer()],true);
  try{
    await h.page.locator('#scene-zoom').selectOption('2');await h.page.locator('#scene-pan').tap();
    const g=await h.geometry(),workspace=h.page.locator('.scene-workspace');
    await workspace.scrollIntoViewIfNeeded();const b=await workspace.boundingBox();
    const before=await workspace.evaluate(el=>el.scrollTop),cdp=await h.context.newCDPSession(h.page);
    const x=b.x+b.width/2,y=Math.min(900,b.y+b.height/2);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*10,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    await h.page.waitForFunction(value=>document.querySelector('.scene-workspace').scrollTop>value,before);
    assert.deepEqual(await h.geometry(),g);
    // Native scrolling deliberately cancels the browser pointer stream. This
    // is not a canceled source gesture: the hand tool disables source picking.
    const cancels=await h.page.evaluate(()=>window.gestureCancels);
    assert.ok(cancels.every(type=>type==='touch'));
    await h.page.evaluate(()=>window.gestureCancels=[]);await h.finish();
  }catch(e){await h.context.close();throw e;}
});
