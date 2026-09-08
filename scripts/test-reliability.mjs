import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const part = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
let checks = 0;
function check(name, fn){ return Promise.resolve().then(fn).then(() => { checks++; console.log('✓ ' + name); }); }
function database(initial, {fail=false, manual=false}={}){
  let stored = initial;
  const pending = [];
  return {pending, read:() => stored, transaction(){
    const tx = {objectStore:() => ({
      get(){ const req = {}; queueMicrotask(() => { req.result = stored; req.onsuccess?.(); }); return req; },
      put(value){
        const next = structuredClone(value);
        const complete = () => { if(fail){ tx.onabort?.(); } else { stored = next; tx.oncomplete?.(); } };
        if(manual){ pending.push(complete); } else { queueMicrotask(complete); }
      }
    })};
    return tx;
  }};
}
function state(n=0){ return {v:5, updatedAt:n, settings:{}, logs:[], weights:[], lifts:{}}; }
function app({ls=state(), lsFail=false, db=null}={}){
  const items = new Map([['workbuddy-v5', typeof ls === 'string' ? ls : JSON.stringify(ls)]]);
  const context = vm.createContext({console, setTimeout, Date, Promise, Number, JSON,
    document:{getElementById:() => null},
    window:{localStorage:{getItem:k=>items.get(k)||null,setItem(k,v){if(lsFail){throw Error('quota');} items.set(k,v);}}},
    showToast(){}, bumpLogIndex(){}, resetWorkout(){}, renderAll(){},
    routines:{bodyweight:[]}, bodyweightMoves:[]
  });
  vm.runInContext(part('function $(id)', '/* ---- Toast ---- */') + part('var storageReadOnly = false;', '/* ---- 记录操作 ---- */'), context);
  context.idbHandle = db;
  context.storageInit = Promise.resolve();
  context.openIdb = async () => db;
  return context;
}
await check('两份存储均失败，不提交状态或报告保存成功', async () => {
  const ctx = app({lsFail:true, db:database(null,{fail:true})});
  const previous = JSON.stringify(ctx.S);
  assert.equal(await ctx.mutateState(() => ctx.S.logs.push({id:'new'})), false);
  assert.equal(JSON.stringify(ctx.S), previous);
});
await check('IndexedDB 失败时仍可确认 localStorage 成功写入',async()=>{
  const ctx=app({db:database(null,{fail:true})});
  assert.equal(await ctx.mutateState(()=>ctx.S.logs.push({id:'new'})),true);
  assert.equal(JSON.parse(ctx.window.localStorage.getItem('workbuddy-v5')).logs.length,1);
});
await check('空间不足不能隔离损坏数据时仍保留原文用于导出',()=>{
  const ctx=app({ls:'{unparseable original',lsFail:true});
  assert.equal(ctx.__boot.rawText,'{unparseable original');
  assert.equal(ctx.storageReadOnly,true);
});
await check('等待 IndexedDB 事务提交后才更新界面状态', async () => {
  const db = database(null,{manual:true}), ctx = app({lsFail:true,db});
  let done = false;
  const write = ctx.mutateState(() => ctx.S.logs.push({id:'new'})).then(ok => {done=true; return ok;});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done,false); assert.equal(ctx.S.logs.length,0);
  db.pending.shift()();
  assert.equal(await write,true); assert.equal(ctx.S.logs.length,1);
});
await check('连点记录串行提交，每笔均保留', async () => {
  const ctx = app({db:database(null)});
  await Promise.all(Array.from({length:12},(_,i) => ctx.mutateState(() => ctx.S.logs.push({id:String(i)}))));
  assert.equal(ctx.S.logs.length,12);
  assert.equal(new Set(ctx.S.logs.map(l=>l.id)).size,12);
});
await check('导入保存失败保留原数据和只读状态', async () => {
  const ctx = app({lsFail:true,db:database(null,{fail:true})});
  ctx.storageReadOnly = true;
  const previous = ctx.S;
  assert.equal(await ctx.mutateState(() => {ctx.S=state(99);ctx.S.logs=[{id:'imported'}];},true),false);
  assert.equal(ctx.S,previous); assert.equal(ctx.storageReadOnly,true);
});
await check('启动恢复采用更新的数据库副本', async () => {
  const newer=state(30); newer.logs=[{id:'id-new',type:'water',ts:Date.now(),ml:350}];
  const ctx=app({ls:state(10),db:database(newer)});
  await ctx.recoverFromIdb();
  assert.equal(ctx.S.updatedAt,30); assert.equal(ctx.S.logs[0].ml,350);
});
await check('损坏的主副本有正常数据库备份时可恢复', async () => {
  const newer=state(30), ctx=app({ls:'{broken',db:database(newer)});
  await ctx.recoverFromIdb(); assert.equal(ctx.storageReadOnly,false); assert.equal(ctx.S.updatedAt,30);
});
await check('超过 3000 条日志和 5000 条体重不再静默丢失', () => {
  const ctx=app(), logs=Array.from({length:4001},(_,i)=>({id:'log-'+i,type:'water',ts:Date.now(),ml:350}));
  assert.equal(ctx.normalizeLogs(logs).length,4001);
  assert.equal(ctx.normalizeWeights(Array.from({length:5001},()=>({ts:Date.now(),kg:80}))).length,5001);
});
await check('所有课程与档位的列表、预览、播放器时长一致且包含休息', () => {
  const ctx=app();
  vm.runInContext(fs.readFileSync(new URL('../content.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(part('var C = window.QDK_CONTENT;', 'function imagePath(') + part('function createPlan(', 'function resetSessionStats(') + part('function totalDurationEstimate(', "$('tGo')") + part('function planSummary(', 'function sec2m('),ctx);
  for(const routine of Object.keys(ctx.routines)) for(const preset of Object.keys(ctx.presets)){
    ctx.S.settings={routine,preset}; ctx.moves=ctx.routines[routine]; ctx.buildSteps();
    const summary=ctx.planSummary();
    assert.equal(ctx.totalDurationEstimate(),ctx.totalDuration);
    assert.equal(summary.warm+summary.work+summary.stretch+summary.rest,ctx.totalDuration);
  }
  ctx.S.settings={routine:'dumbbell',preset:'starter'};ctx.moves=ctx.routines.dumbbell;ctx.buildSteps();
  assert.equal(ctx.totalDuration,723);
});
await check('训练保存失败保留重试入口，重复结束不会重复写入',async()=>{
  const nodes=new Map(), ui=id=>{
    if(!nodes.has(id)){nodes.set(id,{classList:{add(){}},setAttribute(){}});}return nodes.get(id);
  };
  let complete, writes=0;
  const ctx=vm.createContext({$,Object,Math,window:{clearInterval(){}},
    S:{settings:{routine:'dumbbell',preset:'starter'}},sessionLogged:false,sessionFinishing:false,
    running:false,inCountdown:false,timer:null,left:0,steps:[],stepIndex:0,
    sessionElapsed:90,workElapsed:40,stretchElapsed:0,completedMoveIds:{move:true},completedStretchIds:{},
    skippedWork:0,totalDuration:723,sessionLifts:{},
    captureStepProgress(){},stopTick(){},releaseWakeLock(){},updateProgress(){},cueFinish(){},getReadiness:()=> 'green',speak(){},
    addTraining:()=>{writes++;return new Promise(resolve=>{complete=resolve;});}
  });
  function $(id){return ui(id);}
  vm.runInContext(part('async function finishWorkout(', "$('plPause').addEventListener"),ctx);
  const first=ctx.finishWorkout(true);await ctx.finishWorkout(true);assert.equal(writes,1);
  complete(false);await first;
  assert.equal(ctx.sessionLogged,false);assert.equal(ctx.finishRetryEarly,true);assert.equal(ui('plDoneBtn').textContent,'重试保存');
  const retry=ctx.finishWorkout(ctx.finishRetryEarly);complete(true);await retry;
  assert.equal(ctx.sessionLogged,true);assert.equal(ctx.finishRetryEarly,null);assert.equal(ui('plDoneBtn').textContent,'好的');
});
await check('撤下的示范在跟练和预载中都不会再显示或下载',()=>{
  let visible=true,removed=false;
  const ctx=vm.createContext({$:()=>({removeAttribute:()=>{removed=true;}}),setDemoVisible:v=>{visible=v;},
    preloadUrl(){throw Error('不应加载示范');},stopFrameAnimation(){},motionOn:()=>true});
  vm.runInContext(part('function preloadMove(', 'function stopFrameAnimation(') + part('function renderDemo(', 'function primaryType('),ctx);
  ctx.preloadMove({noMedia:true},true);ctx.renderDemo({noMedia:true},'示范',true);
  assert.equal(visible,false);assert.equal(removed,true);
});
function worker(failFile){
  const root='https://example.test/qingdaka/', handlers={}, stores=new Map();
  const cacheKey=k=>new URL(typeof k==='string'?k:k.url,root).href;
  const caches={async open(name){
    if(!stores.has(name)){stores.set(name,new Map());} const items=stores.get(name);
    return {match:async k=>items.get(cacheKey(k))?.clone(),put:async(k,v)=>items.set(cacheKey(k),v.clone()),keys:async()=>[...items.keys()],delete:async k=>items.delete(cacheKey(k))};
  },keys:async()=>[...stores.keys()],delete:async k=>stores.delete(k)};
  const ctx=vm.createContext({URL,Response,Headers,Promise,Number,console,caches,
    self:{registration:{scope:root},location:{origin:'https://example.test'},clients:{claim:async()=>{}},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{}},
    fetch:async url=>{
      if(failFile && String(url).includes(failFile)){throw Error('network failure');}
      return new Response(String(url).includes('voice-scripts.json')?JSON.stringify([{key:'countdown-3'}]):'fixture', {status:200});
    }
  });
  vm.runInContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),ctx);
  const old=ctx.CACHE_PREFIX+'shell-old';stores.set(old,new Map());
  return {ctx,handlers,stores,old,run(name){let promise;handlers[name]({waitUntil:p=>promise=p});return promise;}};
}
for(const fail of ['app.js','content.js','countdown-3.m4a']) await check('离线安装缺少 '+fail+' 时拒绝启用并保留旧版本',async()=>{
  const sw=worker(fail);await assert.rejects(sw.run('install'));assert.equal(sw.stores.has(sw.old),true);
});
await check('完整离线安装成功后才清理旧应用缓存',async()=>{
  const sw=worker();await sw.run('install');assert.equal(sw.stores.has(sw.old),true);
  await sw.run('activate');assert.equal(sw.stores.has(sw.old),false);
});
await check('更新迁移旧版示范缓存并保留已有新图',async()=>{
  const sw=worker(), oldName=sw.ctx.CACHE_PREFIX+'runtime-v41';
  const old=await sw.ctx.caches.open(oldName), current=await sw.ctx.caches.open(sw.ctx.RUNTIME);
  await old.put('./assets/exercise-guides/3013.gif',new Response('saved guide'));
  await old.put('./assets/exercise-guides/0659.gif',new Response('old guide'));
  await current.put('./assets/exercise-guides/0659.gif',new Response('new guide'));
  await sw.run('activate');
  assert.equal(await (await current.match('./assets/exercise-guides/3013.gif')).text(),'saved guide');
  assert.equal(await (await current.match('./assets/exercise-guides/0659.gif')).text(),'new guide');
  assert.equal(sw.stores.has(oldName),false);
});
await check('测试页面导航不会覆盖首页缓存',async()=>{
  const sw=worker();await sw.run('install');let handled=false;
  sw.handlers.fetch({request:{url:'https://example.test/qingdaka/test.html',method:'GET',mode:'navigate'},respondWith(){handled=true;}});
  assert.equal(handled,false);
  const cache=await sw.ctx.caches.open(sw.ctx.SHELL);assert.equal(await (await cache.match('./index.html')).text(),'fixture');
});
await check('预录音频 Range 请求返回正确分片',async()=>{
  const sw=worker();const response=await sw.ctx.rangeResponse(new Response('1234567890'),'bytes=2-5');
  assert.equal(response.status,206);assert.equal(await response.text(),'3456');assert.equal(response.headers.get('Content-Range'),'bytes 2-5/10');
});
console.log(`可靠性检查 ${checks}/${checks} 通过`);
