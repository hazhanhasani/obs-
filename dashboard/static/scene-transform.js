"use strict";
/* Pure normalized scene geometry. Keep limits in sync with scene_geometry.py. */
(function(root){
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const MIN_POSITION=-200,MAX_POSITION=200,MIN_SIZE=0.1,MAX_SIZE=200;
  const tenth=(v)=>Math.round(v*10)/10;
  // Keep the opposite edges anchored when dragging each corner (OBS-style).
  // Do not clamp to viewport. Server and FFmpeg clip only the *output*.
  function transform(initial,corner,dx,dy){
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
  const engine={transform,MIN_POSITION,MAX_POSITION,MIN_SIZE,MAX_SIZE};
  if(typeof module!=="undefined")module.exports=engine;
  else root.StreamCoreTransform=engine;
})(typeof window!=="undefined"?window:globalThis);
