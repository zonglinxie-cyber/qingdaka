import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const part = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
let checks = 0;
function check(name, fn){ return Promise.resolve().then(fn).then(() => { checks++; console.log('✓ ' + name); }); }
function state(n=0){ return {v:5, updatedAt:n, settings:{}, logs:[], weights:[], lifts:{}}; }
function app({ls=state(), lsFail=false}={}){
  const items = new Map([['workbuddy-v5', typeof ls === 'string' ? ls : JSON.stringify(ls)]]);
  const context = vm.createContext({console, setTimeout, Date, Promise, Number, JSON,
    document:{getElementById:() => null},
    window:{localStorage:{getItem:k=>items.get(k)||null,setItem(k,v){if(lsFail){throw Error('quota');} items.set(k,v);}}},
    showToast(){}, bumpLogIndex(){}, resetWorkout(){}, renderAll(){},
    routines:{bodyweight:[]}, bodyweightMoves:[]
  });
  vm.runInContext(part('function $(id)', '/* ---- Toast ---- */') + part('var storageReadOnly = false;', '/* ---- 记录操作 ---- */'), context);
  context.storageInit = Promise.resolve();
  return context;
}
await check('localStorage 失败，不提交状态或报告保存成功', async () => {
  const ctx = app({lsFail:true});
  const previous = JSON.stringify(ctx.S);
  assert.equal(await ctx.mutateState(() => ctx.S.logs.push({id:'new'})), false);
  assert.equal(JSON.stringify(ctx.S), previous);
});
await check('localStorage 写入成功后才提交界面状态',async()=>{
  const ctx=app();
  assert.equal(await ctx.mutateState(()=>ctx.S.logs.push({id:'new'})),true);
  assert.equal(JSON.parse(ctx.window.localStorage.getItem('workbuddy-v5')).logs.length,1);
});
await check('空间不足不能隔离损坏数据时仍保留原文用于导出',()=>{
  const ctx=app({ls:'{unparseable original',lsFail:true});
  assert.equal(ctx.__boot.rawText,'{unparseable original');
  assert.equal(ctx.storageReadOnly,true);
});
await check('连点记录串行提交，每笔均保留', async () => {
  const ctx = app();
  await Promise.all(Array.from({length:12},(_,i) => ctx.mutateState(() => ctx.S.logs.push({id:String(i)}))));
  assert.equal(ctx.S.logs.length,12);
  assert.equal(new Set(ctx.S.logs.map(l=>l.id)).size,12);
});
await check('导入保存失败保留原数据和只读状态', async () => {
  const ctx = app({lsFail:true});
  ctx.storageReadOnly = true;
  const prevLogs = ctx.S.logs.length;
  assert.equal(await ctx.mutateState(() => {ctx.S=state(99);ctx.S.logs=[{id:'imported'}];},true),false);
  assert.equal(ctx.S.logs.length, prevLogs); assert.equal(ctx.storageReadOnly,true);
});
await check('超过 3000 条日志和 5000 条体重不再静默丢失', () => {
  const ctx=app(), logs=Array.from({length:4001},(_,i)=>({id:'log-'+i,type:'water',ts:Date.now(),ml:350}));
  assert.equal(ctx.normalizeLogs(logs).length,4001);
  assert.equal(ctx.normalizeWeights(Array.from({length:5001},()=>({ts:Date.now(),kg:80}))).length,5001);
});
await check('所有课程与档位的列表、预览、播放器时长一致且包含休息', () => {
  const ctx=app();
  ctx.session = { steps:[], totalDuration:0 };
  vm.runInContext(fs.readFileSync(new URL('../content.js',import.meta.url),'utf8'),ctx);
  ctx.C = ctx.window.QDK_CONTENT;
  vm.runInContext(part('var bodyweightMoves = C.bodyweightMoves', 'function imagePath(') + part('function createPlan(', 'function resetSessionStats(') + part('function totalDurationEstimate(', "$('tGo')") + part('function planSummary(', 'function sec2m('),ctx);
  for(const routine of Object.keys(ctx.routines)) for(const preset of Object.keys(ctx.presets)){
    ctx.S.settings={routine,preset}; ctx.moves=ctx.routines[routine]; ctx.buildSteps();
    const summary=ctx.planSummary();
    assert.equal(ctx.totalDurationEstimate(),ctx.session.totalDuration);
    assert.equal(summary.warm+summary.work+summary.stretch+summary.rest,ctx.session.totalDuration);
  }
  ctx.S.settings={routine:'dumbbell',preset:'starter'};ctx.moves=ctx.routines.dumbbell;ctx.buildSteps();
  assert.equal(ctx.session.totalDuration,723);
});
await check('徒手课只加展示层文案；坐站分步示意替换持铃示范且不波及其他动作',()=>{
  const ctx = vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync(new URL('../content.js',import.meta.url),'utf8'),ctx);
  const content = ctx.window.QDK_CONTENT, moves = content.routines.bodyweight;
  assert.deepEqual(Array.from(moves,m=>m.id),['3013','0276','chair-stand','0659','towel-row','3239']);
  assert.ok(moves.every(m=>m.shortCue && m.shortCue.length < 40));
  assert.equal(moves[2].frames[0],'chair-stand-steps.svg');
  assert.equal(content.routines.core.find(m=>m.id==='chair-stand').frames.join('|'),'chair-stand-steps.svg');
  assert.equal(content.ASSET_ALIAS['chair-stand'].media,undefined);
  assert.equal(content.routines.dumbbell.find(m=>m.id==='0291').frames,undefined);
  assert.equal(content.routines.dumbbell[0].shortCue,undefined);
  assert.equal(content.presets.starter.work,40);
});
await check('训练保存失败保留重试入口，重复结束不会重复写入',async()=>{
  const nodes=new Map(), ui=id=>{
    if(!nodes.has(id)){nodes.set(id,{classList:{add(){}},setAttribute(){},textContent:''});}return nodes.get(id);
  };
  let complete, writes=0;
  const PHASE = { idle:'idle', countdown:'countdown', running:'running', paused:'paused', finishing:'finishing', done:'done' };
  const TRANSITIONS = {
    idle:{ countdown:1 }, countdown:{ running:1, paused:1, finishing:1 },
    running:{ paused:1, finishing:1 }, paused:{ running:1, countdown:1, finishing:1, idle:1 },
    finishing:{ done:1 }, done:{ idle:1, finishing:1 }
  };
  const session = {
    phase:'running', logged:false, finishRetryEarly:null, steps:[], stepIndex:0, left:0,
    elapsed:90, workElapsed:40, stretchElapsed:0, completedMoveIds:{move:true}, completedStretchIds:{},
    skippedWork:0, totalDuration:723, lifts:{}, timer:null
  };
  function enterPhase(next){
    if(session.phase === next) return true;
    if(!(TRANSITIONS[session.phase] && TRANSITIONS[session.phase][next])) return false;
    session.phase = next; return true;
  }
  const ctx=vm.createContext({
    PHASE, TRANSITIONS, session, enterPhase, Object, Math, window:{clearInterval(){}},
    S:{settings:{routine:'dumbbell',preset:'starter'}},
    captureStepProgress(){}, stopSessionTimer(){}, stopTick(){}, releaseWakeLock(){},
    updateProgress(){}, cueFinish(){}, getReadiness:()=> 'green', speak(){},
    moveById(){ return null; }, liftKind(){ return null; }, escapeHtml(s){ return s; },
    addTraining:()=>{writes++;return new Promise(resolve=>{complete=resolve;});}
  });
  function $(id){return ui(id);}
  ctx.$ = $;
  vm.runInContext(part('async function finishWorkout(', "$('plPause').addEventListener"),ctx);
  const first=ctx.finishWorkout(true);await ctx.finishWorkout(true);assert.equal(writes,1);
  complete(false);await first;
  assert.equal(session.logged,false);assert.equal(session.finishRetryEarly,true);assert.equal(ui('plDoneBtn').textContent,'重试保存');
  const retry=ctx.finishWorkout(session.finishRetryEarly);complete(true);await retry;
  assert.equal(session.logged,true);assert.equal(session.finishRetryEarly,null);assert.equal(ui('plDoneBtn').textContent,'好的');
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
