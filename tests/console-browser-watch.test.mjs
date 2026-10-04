import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { contract, id, loadBrowserSource, workspace } from './helpers/console-browser-fixtures.mjs';
const client=loadBrowserSource('src/browser/console-watch-client.ts');
const component=loadBrowserSource('src/components/console/console-browser-centre.tsx',{'@/browser/console-view':contract,'./console-browser-centre.css':{}});
const now=Date.parse('2026-10-04T04:00:00.000Z');
const frame=(overrides={})=>({type:'frame',epoch:1,sequence:1,capturedAt:new Date(now).toISOString(),mime:'image/jpeg',data:'/9j/2Q==',...overrides});
const parse=(packet,cursor=client.consoleWatchCursor())=>client.parseConsoleWatchPacket(JSON.stringify(packet),cursor,now);
const response=(chunks)=>new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close();}}),{headers:{'content-type':'application/x-ndjson'}});
const read=(r,overrides={})=>client.consumeConsoleWatchStream(r,{signal:new AbortController().signal,onFrame:async()=>{},onStatus:()=>{},now:()=>now,...overrides});
const viewer=()=>({sessionId:id(1),businessId:id(2),workflowRunId:id(3),questId:id(7),status:'available',expiresAt:'2099-01-01T00:00:00.000Z',policyVersion:'r10-public-v1'});
const render=data=>renderToStaticMarkup(React.createElement(component.ConsoleBrowserCentre,{mode:'browser',data},null));

test('only a matching dedicated descriptor shows an explicit inert Watch button',()=>{
 const data=workspace();data.selectedSession={...data.selectedSession,label:'Controlled public qualification'};data.sessions=[data.selectedSession];data.viewer=viewer();
 const html=render(data);assert.match(html,/Controlled public qualification/);assert.match(html,/>Watch<\/button>/);assert.match(html,/No input, clipboard or upload controls/);assert.match(html,/canvas[^>]+width="0"[^>]+height="0"[^>]+hidden/);
 assert.doesNotMatch(html,/<iframe|<img|<video|src=|data:image|https:/);
 for(const mismatch of [{sessionId:id(4)},{businessId:id(9)},{workflowRunId:id(10)}]){const invalid=render({...data,viewer:{...viewer(),...mismatch}});assert.doesNotMatch(invalid,/>Watch<\/button>/);assert.match(invalid,/Live viewing unavailable for this session/);}
 const legacy=render(workspace({viewer:viewer()}));assert.doesNotMatch(legacy,/<canvas|>Watch<\/button>/);
 for(const status of ['starting','watching','revocation_pending','revoked','ended','expired','unavailable'])assert.doesNotMatch(render({...data,viewer:{...viewer(),status}}),/>Watch<\/button>/);
});

test('frame parser accepts monotonic bounded fresh JPEG packets and ignores untrusted reason text',()=>{
 const cursor=client.consoleWatchCursor();assert.equal(parse(frame(),cursor).sequence,1);assert.equal(parse(frame({sequence:2}),cursor).sequence,2);assert.equal(parse(frame({epoch:2,sequence:1}),cursor).epoch,2);
 const status=parse({type:'status',status:'revocation_pending',reason:'provider_timeout'});assert.equal(status.status,'revocation_pending');assert.equal('reason' in status,false);
});

test('frame parser rejects replay, epoch rollback, stale/future capture and altered packet authority',()=>{
 const cursor=client.consoleWatchCursor();parse(frame({epoch:3,sequence:4}),cursor);
 for(const packet of [frame({epoch:2,sequence:5}),frame({epoch:3,sequence:4}),frame({epoch:0}),frame({sequence:0}),frame({sequence:1.5}),frame({epoch:Number.MAX_SAFE_INTEGER+1}),frame({capturedAt:new Date(now-5_001).toISOString()}),frame({capturedAt:new Date(now+1_001).toISOString()}),frame({mime:'image/svg+xml'}),frame({data:'data:image/jpeg;base64,/9j/2Q=='}),frame({data:'/9j/'+ 'A'.repeat(client.CONSOLE_WATCH_MAX_BASE64)}),frame({data:'/9j/<script>'}),frame({viewerUrl:'https://example.invalid'}),frame({capturedAt:'2026-02-30T04:00:00.000Z'}),{type:'status',status:'watching',reason:'PRIVATE account text'}, {type:'control',action:'navigate'},{type:'status',status:'viewable'},null,[]])assert.throws(()=>parse(packet,cursor));
});

test('actual client stream decoder handles split UTF8/NDJSON and stops at trusted terminal status',async()=>{
 const packets=[JSON.stringify({type:'status',status:'starting'}),JSON.stringify(frame()),JSON.stringify(frame({sequence:2})),JSON.stringify({type:'status',status:'revoked'}),JSON.stringify(frame({sequence:3}))].join('\n')+'\n';
 const frames=[],statuses=[];const outcome=await read(response([packets.slice(0,11),packets.slice(11,57),packets.slice(57)]),{onFrame:async frame=>frames.push(frame.sequence),onStatus:status=>statuses.push(status)});
 assert.equal(outcome,'terminal');assert.deepEqual(frames,[1,2]);assert.deepEqual(statuses,['starting','revoked']);
});

test('EOF, invalid packets and abort never deliver buffered or later frames',async()=>{
 assert.equal(await read(response([JSON.stringify(frame())+'\n'])),'disconnected');
 for(const chunks of [[JSON.stringify(frame())],['x'.repeat(client.CONSOLE_WATCH_MAX_LINE+1)],[JSON.stringify(frame({mime:'image/svg+xml'}))+'\n'],['\n']])await assert.rejects(read(response(chunks)));
 const controller=new AbortController(),frames=[];await read(response([JSON.stringify(frame())+'\n'+JSON.stringify(frame({sequence:2}))+'\n']),{signal:controller.signal,onFrame:async frame=>{frames.push(frame.sequence);controller.abort();}});assert.deepEqual(frames,[1]);
 await assert.rejects(read(new Response('private diagnostic',{status:403,headers:{'content-type':'text/html'}})));
 await assert.rejects(read(new Response('{}',{headers:{'content-type':'application/json'}})));
});

test('client watcher has no native endpoint, active input, persistent bytes or automatic reconnect',()=>{
 const source=readFileSync('src/components/console/console-browser-watch.tsx','utf8');
 assert.doesNotMatch(source,/iframe|connectCDP|localStorage|sessionStorage|setInterval|debugUrl|viewerUrl|window\.open/);
 assert.match(source,/credentials: "same-origin", cache: "no-store", redirect: "error"/);
 assert.match(source,/target\.width = bitmap\.width/);assert.match(source,/canvas\.current\.width = 0/);assert.match(source,/bitmap\.close\(\)/);
 assert.match(source,/visibilitychange/);assert.match(source,/pagehide/);assert.match(source,/started\.current \|\| status !== "ready"/);
 const css=readFileSync('src/components/console/console-browser-watch.css','utf8');assert.match(css,/pointer-events:none/);assert.match(css,/min-height:44px/);
});
