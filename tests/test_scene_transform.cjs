'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transform,hitTest,handleRects,snap,History}=require('../dashboard/static/scene-transform.js');
const box={x:20,y:30,w:40,h:20};
for(const [handle,expected] of Object.entries({
  n:{x:20,y:35,w:40,h:15},s:{x:20,y:30,w:40,h:25},
  w:{x:25,y:30,w:35,h:20},e:{x:20,y:30,w:45,h:20}
}))test('edge '+handle+' changes only the corresponding dimension',()=>{
  assert.deepEqual(transform(box,handle,5,5),expected);
});
for(const handle of ['nw','ne','sw','se','n','e','s','w'])test('aspect '+handle+' preserves ratio and opposite anchor',()=>{
  const g=transform(box,handle,10,8,{aspect:true});
  assert.ok(Math.abs(g.w/g.h-2)<.02,JSON.stringify(g));
  if(handle.includes('w'))assert.equal(g.x+g.w,60);
  else if(handle.includes('e'))assert.equal(g.x,20);
  else assert.ok(Math.abs(g.x+g.w/2-40)<.06);
  if(handle.includes('n'))assert.equal(g.y+g.h,50);
  else if(handle.includes('s'))assert.equal(g.y,30);
  else assert.ok(Math.abs(g.y+g.h/2-40)<.06);
});
test('hit testing selects geometry handles before overlapped sources and ignores locked/hidden sources',()=>{
  const frame={left:100,top:50,width:500,height:300};
  const layers=[{...box,layer_id:'a'},{x:0,y:0,w:100,h:100,layer_id:'b'}];
  assert.deepEqual(hitTest(layers,'a',{x:197,y:137},frame),{id:'a',handle:'nw'});
  assert.deepEqual(hitTest(layers,'a',{x:350,y:200},frame),{id:'b',handle:null});
  layers[1].locked=true;
  assert.deepEqual(hitTest(layers,'a',{x:350,y:180},frame),{id:'a',handle:null});
  layers[0].visible=false;
  assert.equal(hitTest(layers,'a',{x:350,y:180},frame),null);
});
test('tiny sources retain four separate 44px controls and suppress conflicting edge controls',()=>{
  const controls=handleRects({x:50,y:50,w:.1,h:.1},{left:0,top:0,width:200,height:100});
  assert.deepEqual(Object.keys(controls),['nw','ne','sw','se']);
  for(const r of Object.values(controls))assert.equal(r.width*r.height,44*44);
});
test('snapping uses CSS pixels, optional sources, moving edges only and never clamps off-frame',()=>{
  const frame={width:1000,height:500};
  const g={x:-.3,y:20,w:20,h:20};
  assert.equal(snap(g,null,[],frame,6).geometry.x,0);
  assert.equal(snap({...g,x:-40},null,[],frame,6).geometry.x,-40);
  const r=snap({x:20,y:30,w:39.7,h:20},'e',[{x:60,y:0,w:10,h:10}],frame,6);
  assert.equal(r.geometry.x,20);assert.equal(r.geometry.w,40);
  assert.ok(r.guides.some(g=>g.axis==='x'&&g.value===60));
});
test('bounded history ignores no-ops, restores independent copies, truncates redo and merges text edits',()=>{
  const h=new History(2),a={x:1},b={x:2},c={x:3},d={x:4};
  h.record(a,a);assert.equal(h.canUndo,false);
  h.record(a,b);h.record(b,c);h.record(c,d);
  const restored=h.undo(d);assert.deepEqual(restored,c);restored.x=99;
  assert.deepEqual(h.undo(c),b);assert.equal(h.canUndo,false);
  assert.deepEqual(h.redo(b),c);
  h.record(c,{x:8});assert.equal(h.canRedo,false);
  h.clear();h.record(a,b,'text');h.record(b,c,'text');
  assert.deepEqual(h.undo(c),a);
});
