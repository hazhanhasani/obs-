"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

function getRenderer() {
  const source = fs.readFileSync(
    path.join(__dirname, "../dashboard/static/app.js"), "utf8"
  );
  const begin = source.indexOf("const encoderLabels=");
  const end = source.indexOf("function renderChannels(", begin);
  assert.ok(begin >= 0 && end > begin, "encoder renderer must exist");
  const dom = Object.fromEntries([
    "encoder-headline", "encoder-summary", "encoder-detail"
  ].map(id => [id, { innerHTML: "", textContent: "" }]));
  const state = { channel: "main" };
  const htmlEscape = s => String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const renderer = new Function("state", "$", "esc", "fa",
    source.slice(begin, end) + "\nreturn renderEncoders;")(
    state, id => dom[id], htmlEscape, n => String(n)
  );
  return { renderer, dom, state };
}

test("monitoring UI shows real encoder metrics and warns on slowdown", () => {
  const {renderer,dom} = getRenderer();
  renderer([
    {id:"main",name:"کانال اصلی",running:true,
     encoder:{state:"slow",fps:19.5,speed:0.7,age_seconds:3,cpu_percent:195,memory_mb:375}},
    {id:"music",name:"Music",running:false,
     encoder:{state:"stopped",fps:null,speed:null,age_seconds:null,cpu_percent:null,memory_mb:null}},
  ]);
  assert.match(dom["encoder-headline"].textContent, /1/);
  assert.match(dom["encoder-summary"].innerHTML, /encoder-state slow/);
  assert.match(dom["encoder-detail"].innerHTML, /کنـد|کندتر از پخش زنده/);
  assert.match(dom["encoder-detail"].innerHTML, /Music/);
  assert.match(dom["encoder-detail"].innerHTML, /stopped/);
});

test("monitoring UI escapes channel names and handles missing metrics", () => {
  const {renderer,dom} = getRenderer();
  renderer([
    {id:"main",name:'<img src=x onerror="alert(1)">',running:true,
     encoder:{state:"starting",fps:null,speed:null,cpu_percent:null,memory_mb:null}},
  ]);
  assert.doesNotMatch(dom["encoder-summary"].innerHTML, /<img /);
  assert.match(dom["encoder-summary"].innerHTML, /&lt;img/);
  assert.match(dom["encoder-summary"].innerHTML, /—/);
  assert.match(dom["encoder-detail"].innerHTML, /در حال آغاز/);
});

test("monitoring view provides authenticated dashboard placeholders", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "../dashboard/static/index.html"), "utf8"
  );
  for (const id of ["encoder-summary", "encoder-headline", "encoder-detail"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /این شاخص‌ها از خود FFmpeg/);
});
