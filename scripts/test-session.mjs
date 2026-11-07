import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../session.js', import.meta.url), 'utf8');
let checks = 0;
function check(name, fn){
  fn(); checks++; console.log('✓ ' + name);
}
function close(actual, expected, message){
  assert.ok(Math.abs(actual - expected) < 1e-8, message || `${actual} != ${expected}`);
}
function step(id, kind, seconds){
  return {id, kind, seconds, name:id, cue:'提示', steps:['步骤'], image:'demo.svg'};
}
const fullPlan = () => [
  step('prepare', 'prepare', 1), step('first', 'move', 2),
  step('rest', 'rest', 1), step('second', 'move', 1.5), step('settle', 'settle', 0.5)
];

function fakeClock(initial = 1000000){
  let time = initial, serial = 0, peak = 0, scheduled = 0, cancelled = 0;
  const pending = new Map();
  const clock = {
    now:() => time,
    schedule(fn){
      const id = serial++;
      pending.set(id, fn); scheduled++;
      peak = Math.max(peak, pending.size);
      assert.ok(pending.size <= 1, '同一实例最多只能有一个定时器');
      return id;
    },
    cancel(id){ pending.delete(id); cancelled++; },
    elapse(ms){ time += ms; },
    set(ms){ time = ms; },
    fire(){
      assert.equal(pending.size, 1, '应存在一个等待中的定时器');
      const [id, fn] = pending.entries().next().value;
      pending.delete(id); fn();
    },
    tick(ms = 200){ clock.elapse(ms); clock.fire(); },
    run(ms, quantum = 200){
      while(ms > 0){
        const delta = Math.min(ms, quantum);
        clock.elapse(delta);
        if(pending.size){ clock.fire(); }
        ms -= delta;
      }
    },
    stale:() => pending.values().next().value,
    get pending(){ return pending.size; },
    get peak(){ return peak; },
    get scheduled(){ return scheduled; },
    get cancelled(){ return cancelled; }
  };
  return clock;
}
function setup({plan = fullPlan(), snapshot = null, clock = fakeClock(), onChange, onFinish, defaults = false} = {}){
  const changes = [], finishes = [];
  const context = vm.createContext({
    window:{},
    Date:class extends Date { static now(){ return clock.now(); } },
    setTimeout(fn, delay){ assert.equal(delay, 200); return clock.schedule(fn); },
    clearTimeout:clock.cancel
  });
  // 整个 IIFE 在没有 DOM、requestAnimationFrame、存储的环境中加载。
  vm.runInContext(source, context, {filename:'session.js'});
  assert.deepEqual(Object.keys(context.window), ['QDK_SESSION']);
  const options = {
    plan, snapshot,
    onChange(state){ changes.push({...state}); if(onChange){ onChange(state); } },
    onFinish(state, reason){ finishes.push({state:{...state}, reason}); if(onFinish){ onFinish(state, reason); } }
  };
  if(!defaults){ Object.assign(options, {now:clock.now, schedule:clock.schedule, cancel:clock.cancel}); }
  const session = context.window.QDK_SESSION.create(options);
  return {session, clock, changes, finishes};
}
function saved(session){ return JSON.parse(JSON.stringify(session.get())); }

check('纯 IIFE 和默认依赖：不自动开跑，所有 state 时间使用秒', () => {
  const {session:s, clock:c, changes} = setup({defaults:true});
  assert.deepEqual(Object.keys(s).sort(), ['destroy','finish','get','next','pause','start']);
  assert.deepEqual(Object.keys(s.get()).sort(), ['activeSeconds','elapsedSeconds','left','phase','planKey','stepIndex','updatedAt']);
  assert.equal(s.get().phase, 'ready'); assert.equal(s.get().updatedAt, 1000);
  c.elapse(600000);
  assert.equal(s.get().left, 1); assert.equal(c.pending, 0); assert.equal(changes.length, 0);
  s.start(); c.tick(125);
  close(s.get().left, 0.875); close(s.get().elapsedSeconds, 0.125);
  close(s.get().updatedAt, 1600.125);
  s.destroy();
});

check('自然完整：四种步骤精确累计，只 move 算 active，末步索引和 left=0', () => {
  const {session:s, clock:c, changes, finishes} = setup();
  s.start(); c.run(6000);
  const state = s.get();
  assert.equal(state.phase, 'done'); assert.equal(state.stepIndex, 4); assert.equal(state.left, 0);
  close(state.elapsedSeconds, 6); close(state.activeSeconds, 3.5);
  assert.equal(c.pending, 0); assert.equal(c.peak, 1);
  assert.deepEqual([...new Set(changes.map(x => x.stepIndex))], [0,1,2,3,4]);
  assert.equal(finishes.length, 1); assert.equal(finishes[0].reason, 'natural');
  assert.deepEqual(finishes[0].state, {...state});
});

check('正常单步 clock 跨短步骤：正确分配小数秒并逐步通知，超出完成点不计时', () => {
  const plan = [step('p','prepare',0.15), step('m','move',0.25), step('r','rest',0.1), step('s','settle',0.1)];
  const {session:s, clock:c, changes, finishes} = setup({plan});
  s.start(); c.tick(450);
  assert.equal(s.get().stepIndex, 2); close(s.get().left, 0.05);
  close(s.get().elapsedSeconds, 0.45); close(s.get().activeSeconds, 0.25);
  assert.ok(changes.some(x => x.stepIndex === 1 && x.left === 0.25));
  c.tick(200);
  close(s.get().elapsedSeconds, 0.6); close(s.get().activeSeconds, 0.25);
  assert.equal(finishes[0].reason, 'natural');
});

check('暂停结算到调用时，暂停/关闭经过的时间不计入，恢复需 start', () => {
  const {session:s, clock:c, changes} = setup({plan:[step('m','move',10)]});
  s.start(); c.tick(200); c.elapse(137); s.pause();
  assert.equal(s.get().phase, 'paused'); close(s.get().elapsedSeconds, 0.337);
  close(s.get().activeSeconds, 0.337); close(s.get().left, 9.663);
  assert.equal(changes.at(-1).phase, 'paused'); assert.equal(c.pending, 0);
  const paused = saved(s), count = changes.length;
  c.elapse(600000); s.pause();
  assert.deepEqual(saved(s), paused); assert.equal(changes.length, count);
  s.start(); c.tick(123);
  close(s.get().elapsedSeconds, 0.46); close(s.get().activeSeconds, 0.46);
  s.destroy();
});

check('next 只结算真实时间，跳过不能赚活动时间；随后自然结束为 partial', () => {
  const {session:s, clock:c, changes, finishes} = setup({plan:[step('a','move',5),step('r','rest',1),step('b','move',1)]});
  s.start(); c.elapse(350); s.next();
  assert.equal(s.get().stepIndex, 1); assert.equal(s.get().left, 1);
  close(s.get().elapsedSeconds, 0.35); close(s.get().activeSeconds, 0.35);
  assert.equal(changes.at(-1).stepIndex, 1); assert.equal(c.pending, 1);
  c.run(2000);
  close(s.get().elapsedSeconds, 2.35); close(s.get().activeSeconds, 1.35);
  assert.equal(finishes[0].reason, 'partial');
});

check('ready/paused 的 next 不启动定时器；末步 next 为 skipped，不假报 completed', () => {
  const {session:s, clock:c, finishes} = setup();
  for(let i = 0; i < 4; i++){
    s.next(); assert.equal(s.get().phase, 'ready'); assert.equal(c.pending, 0);
  }
  s.next();
  assert.equal(s.get().phase, 'done'); assert.equal(s.get().stepIndex, 4);
  assert.equal(s.get().left, 0); assert.equal(s.get().elapsedSeconds, 0); assert.equal(s.get().activeSeconds, 0);
  assert.equal(finishes.length, 1); assert.equal(finishes[0].reason, 'skipped');
  const paused = setup();
  paused.session.start(); paused.session.pause(); paused.session.next();
  assert.equal(paused.session.get().phase, 'paused'); assert.equal(paused.clock.pending, 0);
});

check('运行中跳过末步：结算到点击时，清理 timer，reason=skipped', () => {
  const {session:s, clock:c, finishes} = setup({plan:[step('a','move',5)]});
  s.start(); c.elapse(275); s.next();
  close(s.get().elapsedSeconds, 0.275); close(s.get().activeSeconds, 0.275);
  assert.equal(s.get().left, 0); assert.equal(c.pending, 0);
  assert.equal(finishes[0].reason, 'skipped');
});

check('next 在自然边界调用不连跳两个步骤，末步已到时按 natural 处理', () => {
  const {session:s, clock:c, finishes} = setup({plan:[step('a','move',1),step('b','move',1)]});
  s.start(); c.elapse(1000); s.next();
  assert.equal(s.get().stepIndex, 1); assert.equal(s.get().left, 1);
  close(s.get().elapsedSeconds, 1); assert.equal(finishes.length, 0);
  c.elapse(1000); s.next();
  assert.equal(finishes.length, 1); assert.equal(finishes[0].reason, 'natural');
});

check('finish 主动提前结束、仅结算运行片段；重复操作不重复通知或保存', () => {
  for(const phase of ['ready','running','paused']){
    const {session:s, clock:c, changes, finishes} = setup({plan:[step('a','move',5)]});
    if(phase !== 'ready'){ s.start(); c.elapse(333); }
    if(phase === 'paused'){ s.pause(); c.elapse(600000); }
    s.finish();
    close(s.get().elapsedSeconds, phase === 'ready' ? 0 : 0.333);
    assert.equal(s.get().phase, 'done'); assert.equal(s.get().left, 0);
    assert.equal(finishes.length, 1); assert.equal(finishes[0].reason, 'early');
    const count = changes.length, done = saved(s);
    s.finish(); s.next(); s.start(); s.pause(); c.run(600000);
    assert.deepEqual(saved(s), done); assert.equal(changes.length, count);
    assert.equal(finishes.length, 1); assert.equal(c.pending, 0);
  }
});

check('运行/暂停/ready 快照 JSON 重载一律 paused，done 不重放 onFinish', () => {
  for(const phase of ['ready','running','paused','done']){
    const plan = fullPlan(), original = setup({plan});
    if(phase !== 'ready'){ original.session.start(); original.clock.run(1400); }
    if(phase === 'paused'){ original.session.pause(); }
    if(phase === 'done'){ original.session.finish(); }
    const snapshot = saved(original.session);
    original.session.destroy();
    const {session:s, clock:c, changes, finishes} = setup({plan, snapshot, clock:fakeClock(900000000)});
    assert.equal(s.get().phase, phase === 'done' ? 'done' : 'paused');
    assert.equal(s.get().left, snapshot.left); assert.equal(s.get().elapsedSeconds, snapshot.elapsedSeconds);
    assert.equal(s.get().activeSeconds, snapshot.activeSeconds); assert.equal(c.pending, 0);
    assert.equal(changes.length, 0); assert.equal(finishes.length, 0);
    c.elapse(600000);
    if(phase === 'done'){
      s.finish(); s.next(); s.start(); assert.equal(finishes.length, 0);
    } else {
      s.start(); c.tick(125); close(s.get().elapsedSeconds, snapshot.elapsedSeconds + 0.125); s.destroy();
    }
  }
});

check('跳过后重载仍为 partial，无需 skippedSteps；完整进度重载仍为 natural', () => {
  for(const skip of [true,false]){
    const plan = [step('a','move',1),step('b','move',1)], original = setup({plan});
    original.session.start(); original.clock.tick(200);
    if(skip){ original.session.next(); } else { original.clock.run(800); }
    const snapshot = saved(original.session);
    assert.equal('skippedSteps' in snapshot, false);
    original.session.destroy();
    const {session:s, clock:c, finishes} = setup({plan, snapshot});
    s.start(); c.run(1000);
    assert.equal(finishes[0].reason, skip ? 'partial' : 'natural');
  }
});

check('不同计划（含相同长度/时长）、缺失签名、索引/left/计数异常快照全部拒绝', () => {
  const plan = [step('a','move',5),step('b','rest',2)], original = setup({plan});
  original.session.start(); original.clock.tick(200);
  const good = saved(original.session);
  original.session.destroy();
  const invalid = [
    null, [], 'bad', {}, {...good, planKey:undefined}, {...good, phase:'invalid'},
    {...good, stepIndex:-1}, {...good, stepIndex:2}, {...good, stepIndex:0.5},
    {...good, left:-1}, {...good, left:5.01}, {...good, left:NaN}, {...good, left:'4.8'},
    {...good, elapsedSeconds:Infinity}, {...good, elapsedSeconds:-1}, {...good, elapsedSeconds:6},
    {...good, activeSeconds:1}, {...good, activeSeconds:-1}, {...good, activeSeconds:0},
    {...good, updatedAt:NaN}, {...good, updatedAt:-1}, {...good, phase:'done'},
    {...good, left:4, elapsedSeconds:0.1, activeSeconds:0.1},
    {...good, stepIndex:1, left:1, elapsedSeconds:1, activeSeconds:1}
  ];
  for(const snapshot of invalid){
    const {session:s, clock:c, changes, finishes} = setup({plan, snapshot});
    assert.equal(s.get().phase, 'ready'); assert.equal(s.get().stepIndex, 0); assert.equal(s.get().left, 5);
    assert.equal(s.get().elapsedSeconds, 0); assert.equal(c.pending, 0);
    assert.equal(changes.length, 0); assert.equal(finishes.length, 0);
  }
  for(const otherPlan of [
    [step('different','move',5),step('b','rest',2)],
    [step('a','rest',5),step('b','rest',2)],
    [step('a','move',6),step('b','rest',2)], [...plan].reverse(), plan.slice(0,1)
  ]){
    const {session:s} = setup({plan:otherPlan, snapshot:good});
    assert.equal(s.get().phase, 'ready'); assert.equal(s.get().elapsedSeconds, 0);
  }
});

check('长间隔 >2s 自动暂停且整段不计时，10分钟中断不算运动，不补发 tick', () => {
  for(const gap of [2001,600000]){
    const {session:s, clock:c, changes, finishes} = setup({plan:[step('a','move',10)]});
    s.start(); c.tick(200);
    const count = changes.length, scheduled = c.scheduled;
    c.tick(gap);
    assert.equal(s.get().phase, 'paused'); close(s.get().left, 9.8);
    close(s.get().elapsedSeconds, 0.2); close(s.get().activeSeconds, 0.2);
    assert.equal(c.pending, 0); assert.equal(c.scheduled, scheduled);
    assert.equal(changes.length, count + 1); assert.equal(changes.at(-1).phase, 'paused');
    assert.equal(finishes.length, 0);
    s.start(); c.tick(200); close(s.get().elapsedSeconds, 0.4); s.destroy();
  }
});

check('2s 阈值以内精确累计；pause/next/finish 调用也不能偷计长间隔', () => {
  const normal = setup({plan:[step('a','move',10)]});
  normal.session.start(); normal.clock.tick(2000);
  close(normal.session.get().elapsedSeconds, 2); assert.equal(normal.session.get().phase, 'running');
  normal.session.destroy();
  for(const action of ['pause','next','finish']){
    const {session:s, clock:c, finishes} = setup({plan:[step('a','move',10),step('b','rest',1)]});
    s.start(); c.tick(200); c.elapse(600000); s[action]();
    close(s.get().elapsedSeconds, 0.2); close(s.get().activeSeconds, 0.2);
    assert.equal(c.pending, 0);
    assert.equal(s.get().phase, action === 'finish' ? 'done' : 'paused');
    if(action === 'next'){ assert.equal(s.get().stepIndex, 1); }
    if(action === 'finish'){ assert.equal(finishes[0].reason, 'early'); }
  }
});

check('重复 start/pause/get 不多排 timer 或重复保存，零增量 tick 不发重复快照', () => {
  const {session:s, clock:c, changes} = setup({plan:[step('a','move',10)]});
  s.start(); const stale = c.stale();
  for(let i = 0; i < 20; i++){ s.start(); s.get(); }
  assert.equal(c.scheduled, 1); assert.equal(c.pending, 1); assert.equal(changes.length, 1);
  c.tick(0); assert.equal(changes.length, 1);
  c.tick(200); assert.equal(changes.length, 2);
  s.pause(); const pausedCount = changes.length;
  s.pause(); s.get(); assert.equal(changes.length, pausedCount); assert.equal(c.pending, 0);
  s.start(); const scheduled = c.scheduled, state = saved(s);
  stale(); // 第一个已取消/过期的回调不能碰新 timer 或计时。
  assert.equal(c.scheduled, scheduled); assert.equal(c.pending, 1); assert.deepEqual(saved(s), state);
  s.destroy(); assert.equal(c.pending, 0);
});

check('timer id=0 可取消，取消后的迟到回调不改变状态', () => {
  const {session:s, clock:c, changes, finishes} = setup();
  s.start(); const stale = c.stale(); s.pause();
  assert.equal(c.pending, 0); assert.equal(c.cancelled, 1);
  const count = changes.length;
  c.elapse(600000); stale();
  assert.equal(changes.length, count); assert.equal(finishes.length, 0); assert.equal(c.pending, 0);
});

check('时钟回拨/无效时暂停，不倒退、不双算；重新 start 重新建立时间基准', () => {
  for(const bad of [999900,NaN,Infinity,-1]){
    const {session:s, clock:c} = setup({plan:[step('a','move',10)]});
    s.start(); c.tick(500); const before = saved(s);
    c.set(bad); c.fire();
    assert.equal(s.get().phase, 'paused'); assert.equal(s.get().elapsedSeconds, before.elapsedSeconds);
    assert.equal(s.get().activeSeconds, before.activeSeconds); assert.equal(s.get().left, before.left);
    assert.equal(s.get().updatedAt, before.updatedAt); assert.equal(c.pending, 0);
    c.set(999900); s.start(); c.tick(200);
    close(s.get().elapsedSeconds, 0.7); close(s.get().activeSeconds, 0.7);
    assert.ok(s.get().updatedAt >= before.updatedAt); s.destroy();
  }
});

check('持续小间隔不产生倒退，整步末尾无浮点残留 tick', () => {
  const {session:s, clock:c, finishes} = setup({plan:[step('a','move',10)]});
  s.start(); let previous = s.get();
  for(let i = 0; i < 1000; i++){
    c.tick(10); const state = s.get();
    assert.ok(state.elapsedSeconds >= previous.elapsedSeconds);
    assert.ok(state.activeSeconds >= previous.activeSeconds);
    assert.ok(state.left <= previous.left); assert.ok(state.updatedAt >= previous.updatedAt);
    previous = state;
  }
  assert.equal(s.get().phase, 'done'); close(s.get().elapsedSeconds, 10);
  assert.equal(s.get().left, 0); assert.equal(c.pending, 0); assert.equal(finishes[0].reason, 'natural');
});

check('get/回调/输入快照与原 plan 均隔离，不可从外部改坏状态', () => {
  const plan = [step('a','move',1)];
  const {session:s, clock:c, finishes} = setup({plan, onChange(state){ state.left = 999; state.phase = 'done'; }});
  const view = s.get(); view.phase = 'done'; view.left = 0;
  plan[0].seconds = 999; plan[0].kind = 'rest'; plan.push(step('extra','move',99));
  s.start(); c.run(1000);
  assert.equal(s.get().phase, 'done'); close(s.get().activeSeconds, 1);
  assert.equal(s.get().stepIndex, 0); assert.equal(finishes[0].state.left, 0);
  const original = setup(), snapshot = saved(original.session), restored = setup({snapshot});
  snapshot.left = 999; snapshot.activeSeconds = 999;
  assert.equal(restored.session.get().left, 1); assert.equal(restored.session.get().activeSeconds, 0);
});

check('回调重入 finish/start 不双写完成、不泄露 timer，onChange 修改参数不影响 onFinish', () => {
  let s;
  const harness = setup({plan:[step('a','move',1)],
    onChange(state){ if(state.phase === 'done'){ state.left = 99; s.finish(); s.next(); s.start(); } },
    onFinish(){ s.finish(); s.start(); }
  });
  s = harness.session; s.start(); harness.clock.run(1000);
  assert.equal(harness.finishes.length, 1); assert.equal(harness.finishes[0].state.left, 0);
  assert.equal(harness.clock.pending, 0);
});

check('步骤切换回调内 pause/start/next/destroy 安全，不继续应用旧 tick', () => {
  for(const action of ['pause','restart','next','destroy']){
    let s, acted = false;
    const harness = setup({plan:[step('a','move',0.1),step('b','rest',1),step('c','move',1)],
      onChange(state){
        if(state.stepIndex !== 1 || acted){ return; }
        acted = true;
        if(action === 'restart'){ s.pause(); s.start(); } else { s[action](); }
      }
    });
    s = harness.session; s.start(); harness.clock.tick(200);
    assert.equal(acted, true); close(s.get().elapsedSeconds, 0.1);
    if(action === 'next'){ assert.equal(s.get().stepIndex, 2); }
    assert.equal(s.get().phase, action === 'pause' || action === 'destroy' ? 'paused' : 'running');
    assert.equal(harness.clock.pending, s.get().phase === 'running' ? 1 : 0);
    s.destroy();
  }
});

check('destroy 幂等且静默，所有后续控制及迟到回调无效', () => {
  const {session:s, clock:c, changes, finishes} = setup();
  s.start(); c.tick(200); const stale = c.stale(), count = changes.length;
  c.elapse(100); s.destroy(); const state = saved(s);
  s.destroy(); s.start(); s.pause(); s.next(); s.finish(); c.elapse(600000); stale();
  assert.deepEqual(saved(s), state); close(s.get().elapsedSeconds, 0.2);
  assert.equal(s.get().phase, 'paused'); assert.equal(c.pending, 0);
  assert.equal(changes.length, count); assert.equal(finishes.length, 0);
});

check('无效/空 plan 惰性 done，不崩溃、不调度、不产生完成记录', () => {
  for(const plan of [null, {}, [], [null], [step('a','wrong',1)], [step('a','move',-1)],
    [step('a','move',NaN)], [step('a','move',Infinity)], [step('a','move','1')],
    [step('','move',1)], [step('a','move',Number.MAX_VALUE)], new Array(2)]){
    const {session:s, clock:c, changes, finishes} = setup({plan});
    s.start(); s.pause(); s.next(); s.finish();
    assert.equal(s.get().phase, 'done'); assert.equal(s.get().stepIndex, 0); assert.equal(s.get().left, 0);
    assert.equal(c.pending, 0); assert.equal(changes.length, 0); assert.equal(finishes.length, 0);
  }
});

check('零秒步骤只在 start 后自动通过，有限遍历且不制造活动时间', () => {
  const plan = [step('p','prepare',0),step('m','move',0),step('s','settle',0)];
  const {session:s, clock:c, changes, finishes} = setup({plan});
  assert.equal(s.get().phase, 'ready'); assert.equal(finishes.length, 0);
  s.start();
  assert.equal(s.get().phase, 'done'); assert.equal(s.get().stepIndex, 2);
  assert.equal(s.get().elapsedSeconds, 0); assert.equal(s.get().activeSeconds, 0); assert.equal(c.pending, 0);
  assert.deepEqual([...new Set(changes.map(x => x.stepIndex))], [0,1,2]);
  assert.equal(finishes.length, 1); assert.equal(finishes[0].reason, 'natural');
  const mixed = setup({plan:[step('a','move',0.2),step('r','rest',0),step('b','move',0.2)]});
  mixed.session.start(); mixed.clock.tick(400);
  close(mixed.session.get().elapsedSeconds, 0.4); close(mixed.session.get().activeSeconds, 0.4);
  assert.equal(mixed.session.get().phase, 'done');
});

check('新跟练阶段：countdown/warmup/work/rest/roundBreak/stretch 正常流转，work 与 stretch 计入 activeSeconds', () => {
  const plan = [
    {id:'cd', kind:'countdown', seconds:3},
    {id:'wm', kind:'warmup', seconds:10},
    {id:'w1', kind:'work', seconds:20},
    {id:'rst', kind:'rest', seconds:15},
    {id:'w2', kind:'work', seconds:20},
    {id:'rb', kind:'roundBreak', seconds:30},
    {id:'st', kind:'stretch', seconds:20}
  ];
  const {session:s, clock:c, finishes} = setup({plan});
  assert.equal(s.get().phase, 'ready');
  s.start();
  // 运行满 118 秒
  c.run(118000);
  const state = s.get();
  assert.equal(state.phase, 'done');
  close(state.elapsedSeconds, 118);
  // work (20 + 20) + stretch (20) = 60s activeSeconds
  close(state.activeSeconds, 60);
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].reason, 'natural');
});

check('步骤钩子 onStep、单侧过半 onHalfway 与休息倒数 onCountdown3（countdown 首步不误触）', () => {
  const plan = [
    {id:'cd-3', kind:'countdown', seconds:3, sideMode:'none'},
    {id:'w-half', kind:'work', seconds:10, sideMode:'half'},
    {id:'rest-10', kind:'rest', seconds:10, sideMode:'none'}
  ];
  const stepEvents = [], halfwayEvents = [], countdown3Events = [];
  const clock = fakeClock();
  const context = vm.createContext({
    window:{},
    Date:class extends Date { static now(){ return clock.now(); } },
    setTimeout(fn, delay){ return clock.schedule(fn); },
    clearTimeout:clock.cancel
  });
  vm.runInContext(source, context, {filename:'session.js'});
  const session = context.window.QDK_SESSION.create({
    plan,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    onStep(step, idx){ stepEvents.push({id:step.id, idx}); },
    onHalfway(step, idx){ halfwayEvents.push({id:step.id, idx}); },
    onCountdown3(step, idx){ countdown3Events.push({id:step.id, idx}); }
  });

  session.start();
  assert.equal(stepEvents.length, 1);
  assert.equal(stepEvents[0].id, 'cd-3');
  assert.equal(countdown3Events.length, 0, 'countdown 首步不应重复触发 onCountdown3');

  // 走完 3 秒首步倒数，进入 w-half
  clock.run(3000);
  assert.equal(countdown3Events.length, 0);
  assert.equal(stepEvents.length, 2);
  assert.equal(stepEvents[1].id, 'w-half');

  // 推进 4 秒：left 变为 6，尚未过半（半程为 5）
  clock.run(4000);
  assert.equal(halfwayEvents.length, 0);

  // 再推进 2 秒：left 变为 4，已过半
  clock.run(2000);
  assert.equal(halfwayEvents.length, 1);
  assert.equal(halfwayEvents[0].id, 'w-half');

  // 推进 4 秒完成 w-half，进入 rest-10
  clock.run(4000);
  assert.equal(stepEvents.length, 3);
  assert.equal(stepEvents[2].id, 'rest-10');
  assert.equal(countdown3Events.length, 0);

  // rest-10 推进 4 秒：left 变为 6，未到 3 秒
  clock.run(4000);
  assert.equal(countdown3Events.length, 0);

  // 再推进 3.5 秒：left 变为 2.5，触发 onCountdown3
  clock.run(3500);
  assert.equal(countdown3Events.length, 1);
  assert.equal(countdown3Events[0].id, 'rest-10');

  // 走完最后 2.5 秒自然结束
  clock.run(2500);
  assert.equal(session.get().phase, 'done');
  assert.equal(countdown3Events.length, 1); // 不会重复触发
});

console.log(`\n${checks} session checks passed.`);
