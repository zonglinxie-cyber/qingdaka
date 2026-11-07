(function(){
'use strict';

// now() / schedule 使用毫秒；state 的 left、累计时间和 updatedAt 均为秒，UI 自行 ceil。
// get()/回调给出独立快照；get() 不推进时间。创建/恢复不启动、不发回调。
// planKey 是有序 [id, kind, seconds] 的签名，保存 snapshot 时必须保留；不匹配或损坏则回到 ready。
// 自然完成/跳过末步保留最后一个索引；提前 finish 保留当前索引；done 总是 left=0。
// 空/无效 plan 返回无回调的惰性 done（stepIndex=0）。零秒步骤允许，只在 start 后自动通过。
// destroy 不结算、不发回调；需要保存最后一段时先 pause。页面隐藏也由父层调用 pause。
var MAX_GAP_MS = 2000;
var EPSILON = 1e-9;

function finite(value){ return typeof value === 'number' && Number.isFinite(value); }
function nonnegative(value){ return finite(value) && value >= 0; }

function create(options){
  options = options || {};
  var now = options.now || function(){ return Date.now(); };
  var schedule = options.schedule || function(fn){ return setTimeout(fn, 200); };
  var cancel = options.cancel || clearTimeout;
  var onChange = typeof options.onChange === 'function' ? options.onChange : function(){};
  var onFinish = typeof options.onFinish === 'function' ? options.onFinish : function(){};
  var plan = [], totals = [0], moves = [0], valid = Array.isArray(options.plan);
  if(valid){
    for(var i = 0; i < options.plan.length; i++){
      var step = options.plan[i];
      if(!step || typeof step.id !== 'string' || !step.id ||
        ['prepare','move','rest','settle'].indexOf(step.kind) < 0 || !nonnegative(step.seconds)){
        valid = false; break;
      }
      var total = totals[i] + step.seconds;
      if(!finite(total) || total > Number.MAX_SAFE_INTEGER){ valid = false; break; }
      // 只复制计时字段，父层改展示信息或原 plan 不会改变运行中的计时规则。
      plan.push({id:step.id, kind:step.kind, seconds:step.seconds});
      totals.push(total);
      moves.push(moves[i] + (step.kind === 'move' ? step.seconds : 0));
    }
  }
  if(!valid){ plan = []; totals = [0]; moves = [0]; }
  var planKey = JSON.stringify(plan.map(function(step){ return [step.id, step.kind, step.seconds]; }));
  var stamp = now();
  var state = {
    phase:plan.length ? 'ready' : 'done', stepIndex:0, left:plan.length ? plan[0].seconds : 0,
    elapsedSeconds:0, activeSeconds:0, updatedAt:nonnegative(stamp) ? stamp / 1000 : 0,
    planKey:planKey
  };
  var skipped = false, destroyed = false, finished = false, timer = null, anchor = null;
  var version = 0, lastChange = null;

  function validSnapshot(s){
    if(!s || typeof s !== 'object' || Array.isArray(s) || !plan.length || s.planKey !== planKey ||
      ['ready','running','paused','done'].indexOf(s.phase) < 0 ||
      !Number.isInteger(s.stepIndex) || s.stepIndex < 0 || s.stepIndex >= plan.length ||
      !nonnegative(s.left) || s.left > plan[s.stepIndex].seconds ||
      !nonnegative(s.elapsedSeconds) || !nonnegative(s.activeSeconds) || !nonnegative(s.updatedAt) ||
      s.activeSeconds > s.elapsedSeconds + EPSILON || (s.phase === 'done' && s.left !== 0)){
      return false;
    }
    var index = s.stepIndex, spent = plan[index].seconds - s.left;
    var progress = totals[index] + spent;
    var activeLimit = moves[index] + (plan[index].kind === 'move' ? spent : 0);
    var idleSpent = s.elapsedSeconds - s.activeSeconds;
    if(s.elapsedSeconds > progress + EPSILON || s.activeSeconds > activeLimit + EPSILON ||
      idleSpent > progress - activeLimit + EPSILON){ return false; }
    // done 也可能来自提前 finish；其 left=0 不代表实际做满当前步骤。
    if(s.phase !== 'done' && (s.elapsedSeconds + EPSILON < spent ||
      (plan[index].kind === 'move' ? s.activeSeconds : idleSpent) + EPSILON < spent)){
      return false;
    }
    return true;
  }

  var snapshot = options.snapshot;
  if(validSnapshot(snapshot)){
    state.phase = snapshot.phase === 'done' ? 'done' : 'paused';
    state.stepIndex = snapshot.stepIndex;
    state.left = snapshot.left;
    state.elapsedSeconds = snapshot.elapsedSeconds;
    state.activeSeconds = snapshot.activeSeconds;
    state.updatedAt = Math.max(state.updatedAt, snapshot.updatedAt);
    skipped = snapshot.elapsedSeconds + EPSILON <
      totals[snapshot.stepIndex] + plan[snapshot.stepIndex].seconds - snapshot.left;
  }
  finished = state.phase === 'done';

  function get(){ return Object.assign({}, state); }
  function touch(time){
    if(nonnegative(time)){ state.updatedAt = Math.max(state.updatedAt, time / 1000); }
  }
  function stopTimer(){
    var pending = timer;
    timer = null;
    if(pending !== null){ cancel(pending.id); }
  }
  function notify(reason){
    var current = get();
    var changed = !lastChange || Object.keys(current).some(function(key){ return current[key] !== lastChange[key]; });
    var finishNow = !!reason && !finished;
    if(finishNow){ finished = true; }
    if(changed){ lastChange = get(); }
    // 先锁定完成通知，回调重入 finish/next 也不能产生第二次记录。
    try {
      if(changed){ onChange(current); }
    } finally {
      if(finishNow){ onFinish(get(), reason); }
    }
  }
  function complete(reason, time){
    state.phase = 'done'; state.left = 0; anchor = null;
    stopTimer(); touch(time); notify(reason);
  }
  function queue(){
    if(destroyed || state.phase !== 'running' || timer !== null){ return; }
    // 用票据而不是 timeout id 判定归属，兼容 id=0，也忽略已取消但迟到的回调。
    var pending = {id:null};
    timer = pending;
    try {
      pending.id = schedule(function(){
        if(destroyed || timer !== pending){ return; }
        timer = null;
        try {
          advance(now());
          if(!destroyed){ notify(); }
        } finally { queue(); }
      });
    } catch(error){
      if(timer === pending){ timer = null; }
      throw error;
    }
  }
  function advance(time){
    if(destroyed || state.phase !== 'running'){ return; }
    var delta = time - anchor;
    // 不补后台、不截取其中两秒来计功；时钟回拨/无效也暂停，用户重新 start 才建立新基准。
    if(!nonnegative(time) || !finite(delta) || delta < 0 || delta > MAX_GAP_MS){
      state.phase = 'paused'; anchor = null;
      stopTimer(); touch(time); notify(); return;
    }
    anchor = time;
    var remaining = delta / 1000, operation = version;
    // 这里只分配一次可信的小间隔，跨步骤循环严格受 plan 长度限制，不回放漏掉的 tick。
    while(state.phase === 'running' && (remaining > 0 || state.left === 0)){
      var used = Math.min(state.left, remaining);
      // 消除连续小数减法留下的浮点尾巴，但不吞掉整个极短步骤。
      if(used > 0 && state.left - used <= Math.min(EPSILON, plan[state.stepIndex].seconds * 1e-9)){
        used = state.left;
      }
      state.left -= used;
      state.elapsedSeconds += used;
      if(plan[state.stepIndex].kind === 'move'){ state.activeSeconds += used; }
      remaining = Math.max(0, remaining - used);
      touch(time);
      if(state.left > 0){ break; }
      if(state.stepIndex === plan.length - 1){
        complete(skipped ? 'partial' : 'natural', time); return;
      }
      state.stepIndex++;
      state.left = plan[state.stepIndex].seconds;
      notify();
      // 父层可能在步骤通知中暂停、跳过或销毁；不要用旧 tick 继续推进新的状态。
      if(destroyed || operation !== version){ return; }
    }
  }

  function start(){
    if(destroyed || state.phase === 'running' || state.phase === 'done'){ return get(); }
    var time = now();
    if(!nonnegative(time)){ return get(); }
    var operation = ++version;
    anchor = time; state.phase = 'running'; touch(time);
    try {
      notify();
      if(!destroyed && operation === version){ advance(time); }
    } finally { queue(); }
    return get();
  }
  function pause(){
    if(destroyed || state.phase !== 'running'){ return get(); }
    var operation = ++version, time = now();
    stopTimer();
    try {
      advance(time);
      if(!destroyed && operation === version && state.phase === 'running'){
        state.phase = 'paused'; anchor = null; touch(time); notify();
      }
    } finally { queue(); }
    return get();
  }
  function next(){
    if(destroyed || state.phase === 'done'){ return get(); }
    var operation = ++version, index = state.stepIndex, time = now();
    stopTimer();
    try {
      advance(time);
      if(destroyed || operation !== version || state.phase === 'done'){ return get(); }
      // 点击时原步骤已到时，就只完成这次切换，不再误跳刚进入的新步骤。
      if(state.stepIndex === index){
        if(state.left > 0){ skipped = true; }
        if(index === plan.length - 1){ complete('skipped', time); return get(); }
        state.stepIndex++; state.left = plan[state.stepIndex].seconds; touch(time);
      }
      notify();
    } finally { queue(); }
    return get();
  }
  function finish(){
    if(destroyed || state.phase === 'done'){ return get(); }
    var operation = ++version, time = now();
    stopTimer();
    try {
      advance(time);
      if(!destroyed && operation === version && state.phase !== 'done'){ complete('early', time); }
    } finally { queue(); }
    return get();
  }
  function destroy(){
    if(destroyed){ return; }
    destroyed = true; version++; stopTimer(); anchor = null;
    if(state.phase === 'running'){ state.phase = 'paused'; }
  }
  return {start:start, pause:pause, next:next, finish:finish, get:get, destroy:destroy};
}

window.QDK_SESSION = {create:create};
})();
