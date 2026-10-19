'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
function setup(){
  const source=fs.readFileSync('dashboard/static/app.js','utf8');
  const fragment=source.slice(source.indexOf('function updatePlayer('),source.indexOf('function uploadMediaFile('));
  const events={};
  const video={closest:()=>null,play:()=>Promise.resolve(),canPlayType:()=>false};
  const empty={hidden:true,querySelector:()=>({textContent:''})};
  let loads=0,recoveries=0,destroys=0;
  class Hls{
    static isSupported(){return true;}
    static Events={MANIFEST_PARSED:'manifest',ERROR:'error'};
    static ErrorTypes={NETWORK_ERROR:'network',MEDIA_ERROR:'media'};
    loadSource(){} attachMedia(){} on(e,fn){events[e]=fn;}
    startLoad(){loads++;} recoverMediaError(){recoveries++;} destroy(){destroys++;}
  }
  const state={channel:'main',hls:null};
  new Function('state','$','stopPlayer','window','Hls',fragment+';updatePlayer("/live/main/index.m3u8",true);')(
    state,id=>id==='player'?video:empty,()=>{}, {Hls},Hls);
  return {events,state,video,empty,counts:()=>({loads,recoveries,destroys})};
}
test('fatal media error uses media decoder recovery',()=>{
  const s=setup();s.events.error(null,{fatal:true,type:'media'});
  assert.equal(s.counts().recoveries,1);assert.equal(s.counts().loads,0);
});
test('unrecoverable player error allows next overview to recreate player',()=>{
  const s=setup();s.events.error(null,{fatal:true,type:'other'});
  assert.equal(s.state.playerKey,null);assert.equal(s.counts().destroys,1);
});
test('network error retries loading and resumed playback clears warning',()=>{
  const s=setup();s.events.error(null,{fatal:true,type:'network'});
  assert.equal(s.counts().loads,1);assert.equal(s.empty.hidden,false);
  s.video.onplaying();assert.equal(s.empty.hidden,true);
});
