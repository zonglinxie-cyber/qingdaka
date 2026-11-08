(function(){
'use strict';

// 轻打卡 · 纯内存跟练计时状态机
// 严谨时间推进：不补算 >2000ms 后台间隔
// 允许阶段 kind：'countdown' | 'warmup' | 'work' | 'rest' | 'roundBreak' | 'stretch'
// 累计 activeSeconds：'work' 与 'stretch'（及兼容 'move'）
// 钩子回调：onChange, onFinish, onStep, onHalfway, onCountdown3

var MAX_GAP_MS = 2000;
var EPSILON = 1e-9;

function finite(value){ return typeof value === 'number' && Number.isFinite(value); }
function nonnegative(value){ return finite(value) && value >= 0; }

var VALID_KINDS = ['countdown', 'warmup', 'work', 'rest', 'roundBreak', 'stretch', 'prepare', 'move', 'settle'];

function isActiveKind(kind){
  return kind === 'work' || kind === 'stretch' || kind === 'move';
}

function create(options){
  options = options || {};
  var now = options.now || function(){ return Date.now(); };
  var schedule = options.schedule || function(fn){ return setTimeout(fn, 200); };
  var cancel = options.cancel || clearTimeout;
  var onChange = typeof options.onChange === 'function' ? options.onChange : function(){};
  var onFinish = typeof options.onFinish === 'function' ? options.onFinish : function(){};
  var onStep = typeof options.onStep === 'function' ? options.onStep : function(){};
  var onHalfway = typeof options.onHalfway === 'function' ? options.onHalfway : function(){};
  var onCountdown3 = typeof options.onCountdown3 === 'function' ? options.onCountdown3 : function(){};

  var rawPlan = Array.isArray(options.plan) ? options.plan : [];
  var plan = [], totals = [0], actives = [0], valid = Array.isArray(options.plan);

  if(valid){
    for(var i = 0; i < rawPlan.length; i++){
      var step = rawPlan[i];
      if(!step || typeof step.id !== 'string' || !step.id ||
        VALID_KINDS.indexOf(step.kind) < 0 || !nonnegative(step.seconds)){
        valid = false; break;
      }
      var total = totals[i] + step.seconds;
      if(!finite(total) || total > Number.MAX_SAFE_INTEGER){ valid = false; break; }
      // 保留步信息供回调
      plan.push(Object.assign({}, step, {
        id: step.id,
        kind: step.kind,
        seconds: step.seconds,
        sideMode: step.sideMode || 'none'
      }));
      totals.push(total);
      actives.push(actives[i] + (isActiveKind(step.kind) ? step.seconds : 0));
    }
  }
  if(!valid){ plan = []; totals = [0]; actives = [0]; }

  var planKey = JSON.stringify(plan.map(function(s){ return [s.id, s.kind, s.seconds]; }));
  var stamp = now();
  var state = {
    activeSeconds: 0,
    elapsedSeconds: 0,
    left: plan.length ? plan[0].seconds : 0,
    phase: plan.length ? 'ready' : 'done',
    planKey: planKey,
    stepIndex: 0,
    updatedAt: nonnegative(stamp) ? stamp / 1000 : 0
  };

  var skipped = false, destroyed = false, finished = false, timer = null, anchor = null;
  var version = 0, lastChange = null;
  var halfwayTriggered = {};
  var countdown3Triggered = {};
  var lastFiredStepIndex = -1;

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
    var activeLimit = actives[index] + (isActiveKind(plan[index].kind) ? spent : 0);
    var idleSpent = s.elapsedSeconds - s.activeSeconds;
    if(s.elapsedSeconds > progress + EPSILON || s.activeSeconds > activeLimit + EPSILON ||
      idleSpent > progress - activeLimit + EPSILON){ return false; }
    if(s.phase !== 'done' && (s.elapsedSeconds + EPSILON < spent ||
      (isActiveKind(plan[index].kind) ? s.activeSeconds : idleSpent) + EPSILON < spent)){
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

  function get(){
    return {
      activeSeconds: state.activeSeconds,
      elapsedSeconds: state.elapsedSeconds,
      left: state.left,
      phase: state.phase,
      planKey: state.planKey,
      stepIndex: state.stepIndex,
      updatedAt: state.updatedAt
    };
  }

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
    try {
      if(changed){ onChange(current); }
    } finally {
      if(finishNow){ onFinish(get(), reason); }
    }
  }

  function triggerStepHook(idx){
    if(idx >= 0 && idx < plan.length && idx !== lastFiredStepIndex){
      lastFiredStepIndex = idx;
      try {
        onStep(plan[idx], idx);
      } catch(e){}
    }
  }

  function checkIntraStepHooks(){
    if(!plan.length || state.stepIndex >= plan.length){ return; }
    var currentStep = plan[state.stepIndex];
    var idx = state.stepIndex;

    // 单侧动作过半
    if(currentStep.sideMode === 'half' && !halfwayTriggered[idx] && currentStep.seconds > 0){
      if(state.left <= (currentStep.seconds / 2) + EPSILON && state.left > 0){
        halfwayTriggered[idx] = true;
        try {
          onHalfway(currentStep, idx);
        } catch(e){}
      }
    }

    // 休息段结束前最后3秒（countdown 首步自身已播 countdown-start，不重复截断）
    if((currentStep.kind === 'rest' || currentStep.kind === 'roundBreak') &&
       !countdown3Triggered[idx]){
      if(state.left <= 3 + EPSILON && state.left > 0){
        countdown3Triggered[idx] = true;
        try {
          onCountdown3(currentStep, idx);
        } catch(e){}
      }
    }
  }

  function complete(reason, time){
    state.phase = 'done'; state.left = 0; anchor = null;
    stopTimer(); touch(time); notify(reason);
  }

  function queue(){
    if(destroyed || state.phase !== 'running' || timer !== null){ return; }
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
    if(!nonnegative(time) || !finite(delta) || delta < 0 || delta > MAX_GAP_MS){
      state.phase = 'paused'; anchor = null;
      stopTimer(); touch(time); notify(); return;
    }
    anchor = time;
    var remaining = delta / 1000, operation = version;

    while(state.phase === 'running' && (remaining > 0 || state.left === 0)){
      var used = Math.min(state.left, remaining);
      if(used > 0 && state.left - used <= Math.min(EPSILON, plan[state.stepIndex].seconds * 1e-9)){
        used = state.left;
      }
      state.left -= used;
      state.elapsedSeconds += used;
      if(isActiveKind(plan[state.stepIndex].kind)){ state.activeSeconds += used; }
      remaining = Math.max(0, remaining - used);
      touch(time);

      checkIntraStepHooks();

      if(state.left > 0){ break; }
      if(state.stepIndex === plan.length - 1){
        complete(skipped ? 'partial' : 'natural', time); return;
      }
      state.stepIndex++;
      state.left = plan[state.stepIndex].seconds;
      triggerStepHook(state.stepIndex);
      checkIntraStepHooks();
      notify();
      if(destroyed || operation !== version){ return; }
    }
  }

  function start(){
    if(destroyed || state.phase === 'running' || state.phase === 'done'){ return get(); }
    var time = now();
    if(!nonnegative(time)){ return get(); }
    var operation = ++version;
    anchor = time; state.phase = 'running'; touch(time);
    triggerStepHook(state.stepIndex);
    checkIntraStepHooks();
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
      if(state.stepIndex === index){
        if(state.left > 0){ skipped = true; }
        if(index === plan.length - 1){ complete('skipped', time); return get(); }
        state.stepIndex++; state.left = plan[state.stepIndex].seconds; touch(time);
        triggerStepHook(state.stepIndex);
        checkIntraStepHooks();
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
