"use strict";
/* Original axis-aligned scene geometry, hit testing, snapping and undo history.
   Values are normalized percentages; hit targets and snap tolerance are CSS px. */
(function(root){
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const MIN_POSITION=-200,MAX_POSITION=200,MIN_SIZE=0.1,MAX_SIZE=200;
  const tenth=(v)=>Math.round(v*10)/10;
  const HANDLES=["nw","ne","sw","se","n","e","s","w"];
  function transform(initial,handle,dx,dy,{aspect=false}={}){
    if(!handle)return {x:clamp(tenth(initial.x+dx),MIN_POSITION,MAX_POSITION),
      y:clamp(tenth(initial.y+dy),MIN_POSITION,MAX_POSITION),w:initial.w,h:initial.h};
    const west=handle.includes("w"),east=handle.includes("e");
    const north=handle.includes("n"),south=handle.includes("s");
    if(aspect){
      const fx=west?1:east?0:.5,fy=north?1:south?0:.5;
      const ax=initial.x+initial.w*fx,ay=initial.y+initial.h*fy;
      const kx=(west?-dx:east?dx:0)/initial.w;
      const ky=(north?-dy:south?dy:0)/initial.h;
      let k=1+(west||east?(north||south?(Math.abs(kx)>Math.abs(ky)?kx:ky):kx):ky);
      let min=Math.max(MIN_SIZE/initial.w,MIN_SIZE/initial.h);
      let max=Math.min(MAX_SIZE/initial.w,MAX_SIZE/initial.h);
      for(const [anchor,size,fraction] of [[ax,initial.w,fx],[ay,initial.h,fy]]){
        if(fraction){min=Math.max(min,(anchor-MAX_POSITION)/(size*fraction));
          max=Math.min(max,(anchor-MIN_POSITION)/(size*fraction));}
      }
      k=clamp(k,min,max);
      const w=tenth(initial.w*k),h=tenth(initial.h*k);
      return {x:tenth(ax-w*fx),y:tenth(ay-h*fy),w,h};
    }
    const right=initial.x+initial.w,bottom=initial.y+initial.h;
    const x=west?clamp(tenth(initial.x+dx),Math.max(MIN_POSITION,right-MAX_SIZE),Math.min(MAX_POSITION,right-MIN_SIZE)):initial.x;
    const y=north?clamp(tenth(initial.y+dy),Math.max(MIN_POSITION,bottom-MAX_SIZE),Math.min(MAX_POSITION,bottom-MIN_SIZE)):initial.y;
    const w=west?tenth(right-x):east?clamp(tenth(initial.w+dx),MIN_SIZE,MAX_SIZE):initial.w;
    const h=north?tenth(bottom-y):south?clamp(tenth(initial.h+dy),MIN_SIZE,MAX_SIZE):initial.h;
    return {x,y,w:clamp(w,MIN_SIZE,MAX_SIZE),h:clamp(h,MIN_SIZE,MAX_SIZE)};
  }
  function handleRects(layer,frame){
    const x=(frame.left||0)+layer.x*frame.width/100,y=(frame.top||0)+layer.y*frame.height/100;
    const w=layer.w*frame.width/100,h=layer.h*frame.height/100,t=44;
    const rect=(left,top)=>({left,top,width:t,height:t});
    const result={nw:rect(x-t,y-t),ne:rect(x+w,y-t),sw:rect(x-t,y+h),se:rect(x+w,y+h)};
    // Edge targets never overlap the four essential corner targets, even for
    // a 0.1% logo. Increase editor zoom to expose edges of a small source.
    if(w>=t*2){result.n=rect(x+w/2-t/2,y-t);result.s=rect(x+w/2-t/2,y+h);}
    if(h>=t*2){result.w=rect(x-t,y+h/2-t/2);result.e=rect(x+w,y+h/2-t/2);}
    return result;
  }
  function hitTest(layers,selected,point,frame){
    const active=layers.find(l=>l.layer_id===selected&&l.visible!==false&&!l.locked);
    if(active){
      for(const [handle,r] of Object.entries(handleRects(active,frame))){
        if(point.x>=r.left&&point.x<=r.left+r.width&&point.y>=r.top&&point.y<=r.top+r.height)
          return {id:active.layer_id,handle};
      }
    }
    const x=(point.x-(frame.left||0))*100/frame.width,y=(point.y-(frame.top||0))*100/frame.height;
    for(const l of [...layers].reverse()){
      if(l.visible!==false&&!l.locked&&x>=l.x&&x<=l.x+l.w&&y>=l.y&&y<=l.y+l.h)
        return {id:l.layer_id,handle:null};
    }
    return null;
  }
  function snap(geometry,handle,others,frame,tolerance=6){
    const guides=[],offsets={x:0,y:0};
    for(const [axis,sizeAxis,display] of [["x","w",frame.width],["y","h",frame.height]]){
      const start=geometry[axis],size=geometry[sizeAxis];
      const negative=axis==='x'?'w':'n',positive=axis==='x'?'e':'s';
      const moving=!handle?[start,start+size/2,start+size]:handle.includes(negative)?[start]:handle.includes(positive)?[start+size]:[];
      const targets=[0,50,100];
      for(const l of others){if(l.visible!==false)targets.push(l[axis],l[axis]+l[sizeAxis]/2,l[axis]+l[sizeAxis]);}
      let closest=tolerance+1,target=null;
      for(const edge of moving)for(const candidate of targets){
        const distance=Math.abs(candidate-edge)*display/100;
        if(distance<=tolerance&&distance<closest){closest=distance;offsets[axis]=candidate-edge;target=candidate;}
      }
      if(target!==null)guides.push({axis,value:target});
    }
    return {geometry:transform(geometry,handle,offsets.x,offsets.y),guides};
  }
  class History{
    constructor(limit=100){this.limit=limit;this.clear();}
    clear(){this.past=[];this.future=[];this.group=null;}
    get canUndo(){return this.past.length>0;}
    get canRedo(){return this.future.length>0;}
    record(before,after,group=null){
      const value=JSON.stringify(before);if(value===JSON.stringify(after))return;
      if(!group||this.group!==group){this.past.push(value);if(this.past.length>this.limit)this.past.shift();}
      this.group=group;this.future=[];
    }
    undo(current){if(!this.canUndo)return null;this.group=null;this.future.push(JSON.stringify(current));return JSON.parse(this.past.pop());}
    redo(current){if(!this.canRedo)return null;this.group=null;this.past.push(JSON.stringify(current));return JSON.parse(this.future.pop());}
  }
  const engine={transform,handleRects,hitTest,snap,History,HANDLES,MIN_POSITION,MAX_POSITION,MIN_SIZE,MAX_SIZE};
  if(typeof module!=="undefined")module.exports=engine;
  else root.StreamCoreTransform=engine;
})(typeof window!=="undefined"?window:globalThis);
