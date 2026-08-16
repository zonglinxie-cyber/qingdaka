(function(){
'use strict';
/* ---- 全局错误兜底：避免未捕获异常导致白屏 ---- */
window.addEventListener('error', function(ev){
  console.error('[轻打卡]', ev.error || ev.message || ev);
  try{ showToast('应用遇到错误，请刷新页面', 'error'); }catch(_){}
});
window.addEventListener('unhandledrejection', function(ev){
  console.error('[轻打卡]', ev.reason || ev);
  try{ showToast('应用遇到错误，请刷新页面', 'error'); }catch(_){}
});

/* ============================================================
   轻打卡 v6 —— 聚焦蛋白 + 跟练
   数据层沿用 workbuddy-v5 模型（与旧版共享，数据无缝延续）

   数据模型
   ========
   S (AppState) = {
     v: 5,                     // 数据版本号
     settings: Settings,        // 用户设置
     logs: [LogEntry, ...],     // 日志列表（蛋白/饮水/训练）
     weights: [WeightEntry, ...] // 体重记录
     lifts: { [moveId]: LiftRec } // 动作上次重量 / 难度
   }

   LiftRec = { kg, reps, level, ts, history:[{ts,kg,reps,level}] }

   Settings = {
     proteinTarget: number,  // 每日蛋白目标 (g), 20-300
     waterTarget: number,    // 每日饮水目标 (ml), 500-6000
     bodyWeightKg: number,   // 当前体重，0 表示未设
     proteinPerKg: number,   // 每公斤蛋白系数，默认 1.4
     sound: boolean,         // 提示音
     voice: boolean,         // 语音指导
     motion: boolean,        // 动作动画
     routine: 'bodyweight' | 'dumbbell' | 'core' | 'stretch',
     preset: 'recovery' | 'starter' | 'standard' | 'steady',
     profileLevel: 'adapt' | 'build' | 'target',
     reminderTime: 'HH:MM',  // 遗留字段，兼容旧备份
     readiness: 'green' | 'yellow' | 'red',
     readinessDay: number
   }

   LogEntry = {
     id: string,            // 唯一 ID
     type: 'protein' | 'water' | 'training',
     ts: number             // Unix 毫秒时间戳
   }
     protein 额外字段:  { grams, food, source:'photo'|'quick'|'manual'|'legacy', meal:'breakfast'|'lunch'|'dinner'|'snack' }
     water 额外字段:    { ml }
     training 额外字段:  {
       status: 'completed' | 'partial' | 'stopped' | 'legacy' | 'makeup',
         // completed = 全部完成; partial = 部分完成; stopped = 提前结束
         // legacy = 旧版数据; makeup = 补打卡（不计入训练连击）
       routine, preset, readiness: 'green'|'yellow'|'red',
       actualSeconds, plannedSeconds, workSeconds,
       completedMoves, skippedMoves
     }

   WeightEntry = { ts, kg, waist?: number }
   ============================================================ */
function $(id){ return document.getElementById(id); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function pad2(n){ return String(n).padStart(2,'0'); }
function dayStart(ts){ var d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function uid(){ return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); }
function clampNumber(v, min, max, fb){ var n = Number(v); if(!Number.isFinite(n)){ return fb; } return Math.max(min, Math.min(max, n)); }
function cleanText(v, max, fallback){ if(typeof v !== 'string'){ return fallback; } var s = v.trim().slice(0, max); return s || fallback; }
function isPlainObject(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }

var V5KEY = 'workbuddy-v5';
var APIKEY_STORAGE = 'workbuddy-qwen-key';
// GitHub Pages 没有 Functions，只能走 FC。Netlify/Vercel/本地一律同源
// /api/protein-photo，避免前端直连 FC 触发 CORS 预检或 OPTIONS 故障。
var QWEN_RELAY = /\.github\.io$/i.test(location.hostname)
  ? 'https://proteinto-relay-abwamgsilr.cn-beijing.fcapp.run/protein-photo'
  : './api/protein-photo';
function isTokenPlanKey(k){ return /^sk-sp-/i.test(k || ''); }
/* 拍照识图固定视觉模型，不受文字对话模型设置影响 */
function getPhotoModel(){
  return isTokenPlanKey(getApiKey()) ? 'qwen3.6-flash' : 'qwen-vl-max';
}
var assetBase = 'assets/exercise-guides/';
var MAX_DIM = 896, JPEG_QUALITY = 0.82;  // 896 比 1280 上传更快、模型响应更快，识菜够用
var MAX_LOGS = 3000;
/* ---- 数据边界常量 ---- */
var TIMESTAMP_MIN = 946684800000;   // 2000-01-01
var TIMESTAMP_MAX = 4102444800000;  // 2100-01-01
var PROTEIN_MAX_SINGLE = 500;       // 单次蛋白摄入上限 (g)
var PROTEIN_TARGET_MIN = 20;        // 每日蛋白目标下限 (g)
var PROTEIN_TARGET_MAX = 300;       // 每日蛋白目标上限 (g)
var WATER_ML_MIN = 500;             // 每日饮水目标下限 (ml)
var WATER_ML_MAX = 6000;            // 每日饮水目标上限 (ml)
var WATER_ML_SINGLE = 3000;         // 单次饮水上限 (ml)
var WEIGHT_KG_MIN = 20;             // 体重下限 (kg)
var WEIGHT_KG_MAX = 400;            // 体重上限 (kg)
var WAIST_CM_MIN = 30;              // 腰围下限 (cm)
var WAIST_CM_MAX = 250;             // 腰围上限 (cm)
var IMPORT_MAX_BYTES = 5 * 1024 * 1024;
var MAX_WEIGHTS = 5000;             // 最大体重记录条数
var DEFAULT_PROTEIN = 100;          // 默认蛋白目标 (g)
var DEFAULT_WATER = 2000;           // 默认饮水目标 (ml)
var PROTEIN_PER_KG_DEFAULT = 1.4;
var PROTEIN_PER_KG_MIN = 0.8;
var PROTEIN_PER_KG_MAX = 2.5;
var WEEK_STRENGTH_GOAL = 3;
var MEAL_IDS = ['breakfast','lunch','dinner','snack'];
var MEAL_NAMES = { breakfast:'早餐', lunch:'午餐', dinner:'晚餐', snack:'加餐' };
var QUICK_FOODS = [
  { id:'egg', name:'鸡蛋', grams:6, food:'鸡蛋 1 个' },
  { id:'milk', name:'牛奶', grams:8, food:'牛奶 250ml' },
  { id:'yogurt', name:'酸奶', grams:10, food:'酸奶 1 杯' },
  { id:'tofu', name:'豆腐', grams:15, food:'豆腐 1 份' },
  { id:'chicken', name:'鸡胸', grams:25, food:'鸡胸 100g' },
  { id:'powder', name:'蛋白粉', grams:25, food:'蛋白粉 1 勺' }
];
// 课程 ID 的唯一事实来源。设置、日志与 UI 都必须引用它，避免新增课程时只改一处。
var ROUTINE_IDS = ['bodyweight','dumbbell','core','gym','stretch'];

function mealFromTs(ts){
  var h = new Date(ts).getHours();
  if(h < 11){ return 'breakfast'; }
  if(h < 16){ return 'lunch'; }
  if(h < 20){ return 'dinner'; }
  return 'snack';
}
function mealTargets(total){
  var t = Math.round(clampNumber(total, PROTEIN_TARGET_MIN, PROTEIN_TARGET_MAX, DEFAULT_PROTEIN));
  var base = Math.floor(t / 4);
  var rem = t - base * 4;
  var out = { breakfast:base, lunch:base, dinner:base, snack:base };
  for(var i = 0; i < rem; i++){ out[MEAL_IDS[i]] += 1; }
  return out;
}
function suggestedProteinTarget(kg, perKg){
  var w = Number(kg);
  var r = Number(perKg);
  if(!Number.isFinite(w) || w < WEIGHT_KG_MIN || w > WEIGHT_KG_MAX){ return null; }
  if(!Number.isFinite(r) || r <= 0){ r = PROTEIN_PER_KG_DEFAULT; }
  r = clampNumber(r, PROTEIN_PER_KG_MIN, PROTEIN_PER_KG_MAX, PROTEIN_PER_KG_DEFAULT);
  return Math.round(clampNumber(w * r, PROTEIN_TARGET_MIN, PROTEIN_TARGET_MAX, DEFAULT_PROTEIN));
}
function weekStart(ts){
  var d = new Date(dayStart(ts));
  var back = (d.getDay() + 6) % 7;
  return d.getTime() - back * 86400000;
}
function latestWeight(){
  if(S.weights && S.weights.length){ return S.weights[S.weights.length - 1]; }
  var kg = S.settings && Number(S.settings.bodyWeightKg);
  if(Number.isFinite(kg) && kg >= WEIGHT_KG_MIN){ return { ts:0, kg:kg }; }
  return null;
}
var LIFT_HISTORY_MAX = 40;
var WALL_LEVELS = [
  { id:'near', name:'近墙（易）' },
  { id:'mid', name:'中距' },
  { id:'far', name:'远墙（难）' }
];
var CHAIR_LEVELS = [
  { id:'body', name:'徒手' },
  { id:'bottle', name:'抱水瓶' },
  { id:'db', name:'哑铃' }
];
function liftKind(move){
  if(!move){ return null; }
  var id = move.id;
  if(id === '0659' || id === 'wall-plank'){ return 'wall'; }
  if(id === 'chair-stand'){ return 'chair'; }
  if(S.settings && (S.settings.routine === 'gym' || S.settings.routine === 'dumbbell')){ return 'load'; }
  if(move.equipment && /哑铃|机/.test(move.equipment)){ return 'load'; }
  return null;
}
function liftLevels(kind){
  if(kind === 'wall'){ return WALL_LEVELS; }
  if(kind === 'chair'){ return CHAIR_LEVELS; }
  return [];
}
function liftLevelName(kind, id){
  var list = liftLevels(kind);
  for(var i = 0; i < list.length; i++){ if(list[i].id === id){ return list[i].name; } }
  return '';
}
function nextLevelId(kind, id){
  var list = liftLevels(kind);
  for(var i = 0; i < list.length - 1; i++){
    if(list[i].id === id){ return list[i + 1].id; }
  }
  return id || (list[0] && list[0].id) || '';
}
function normalizeLiftSet(item){
  if(!isPlainObject(item)){ return null; }
  var set = {
    kg: Math.round(clampNumber(item.kg, 0, 400, 0) * 2) / 2,
    reps: Math.round(clampNumber(item.reps, 0, 80, 0)),
    level: cleanText(item.level, 20, '')
  };
  if(!set.kg && !set.reps && !set.level){ return null; }
  var ts = Number(item.ts);
  if(Number.isFinite(ts) && ts >= TIMESTAMP_MIN){ set.ts = ts; }
  return set;
}
function normalizeLifts(raw){
  if(!isPlainObject(raw)){ return {}; }
  var out = {};
  Object.keys(raw).forEach(function(id){
    if(!/^[a-z0-9-]{2,32}$/i.test(id)){ return; }
    var it = raw[id];
    if(!isPlainObject(it)){ return; }
    var rec = { kg:0, reps:0, level:'', ts:0, history:[] };
    rec.kg = Math.round(clampNumber(it.kg, 0, 400, 0) * 2) / 2;
    rec.reps = Math.round(clampNumber(it.reps, 0, 80, 0));
    rec.level = cleanText(it.level, 20, '');
    rec.ts = Number(it.ts) || 0;
    if(Array.isArray(it.history)){
      rec.history = it.history.map(normalizeLiftSet).filter(Boolean).slice(-LIFT_HISTORY_MAX);
    }
    if(rec.kg || rec.reps || rec.level || rec.history.length){ out[id] = rec; }
  });
  return out;
}
function getLift(id){
  return (S.lifts && S.lifts[id]) || null;
}
function suggestNextKg(kg, sets, targetReps){
  var w = Number(kg) || 0;
  var goal = Number(targetReps) || 10;
  if(w <= 0 || !sets || !sets.length){ return w; }
  var hit = sets.every(function(s){ return (Number(s.reps) || 0) >= goal; });
  return hit ? Math.round((w + 2.5) * 2) / 2 : w;
}
function formatLiftLine(move, rec){
  if(!move){ return ''; }
  rec = rec || getLift(move.id);
  if(!rec){ return '还没记过'; }
  var kind = liftKind(move);
  if(kind === 'wall' || kind === 'chair'){
    return rec.level ? ('上次：' + liftLevelName(kind, rec.level)) : '还没记过';
  }
  if(rec.kg > 0){ return '上次：' + rec.kg + ' kg × ' + (rec.reps || '—'); }
  return '还没记过';
}
function moveById(id){
  var all = bodyweightMoves.concat(dumbbellMoves, gymMoves, coreMoves);
  for(var i = 0; i < all.length; i++){ if(all[i].id === id){ return all[i]; } }
  return null;
}

/* ---- Toast ---- */
var toastTimer = null;
function showToast(msg, type){
  var el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  if(toastTimer){ window.clearTimeout(toastTimer); }
  toastTimer = window.setTimeout(function(){ el.classList.remove('show'); }, 2600);
}

/* ============================================================
   自定义对话框（替代原生 confirm/prompt，移动端体验更好）
   ============================================================ */
var dlgOnOk = null, dlgPrevFocus = null;
function openDialog(){
  dlgPrevFocus = document.activeElement;
  $('dialogModal').classList.add('open');
  $('dialogModal').setAttribute('aria-hidden','false');
}
function closeDialog(){
  $('dialogModal').classList.remove('open');
  $('dialogModal').setAttribute('aria-hidden','true');
  dlgOnOk = null;
  if(dlgPrevFocus && dlgPrevFocus.focus){ try{ dlgPrevFocus.focus(); }catch(e){} }
}
function showConfirm(msg, onOk, opts){
  opts = opts || {};
  $('dlgTitle').textContent = opts.title || '请确认';
  $('dlgMsg').textContent = msg;
  $('dlgInput').hidden = true;
  $('dlgInput').value = '';
  $('dlgOk').textContent = opts.okText || '确定';
  $('dlgCancel').textContent = opts.cancelText || '取消';
  $('dlgOk').className = 'dlg-btn ok' + (opts.danger ? ' danger' : '');
  dlgOnOk = function(){ var cb = onOk; closeDialog(); if(cb){ cb(); } };
  openDialog();
  window.setTimeout(function(){ $('dlgOk').focus(); }, 60);
}
function showPrompt(msg, defaultVal, onOk, opts){
  opts = opts || {};
  $('dlgTitle').textContent = opts.title || '请输入';
  $('dlgMsg').textContent = msg;
  var inp = $('dlgInput');
  inp.hidden = false;
  inp.type = opts.type || 'text';
  inp.value = defaultVal != null ? String(defaultVal) : '';
  inp.placeholder = opts.placeholder || '';
  $('dlgOk').textContent = opts.okText || '保存';
  $('dlgCancel').textContent = opts.cancelText || '取消';
  $('dlgOk').className = 'dlg-btn ok';
  dlgOnOk = function(){
    var val = inp.value;
    closeDialog();
    if(onOk){ onOk(val); }
  };
  openDialog();
  window.setTimeout(function(){ inp.focus(); inp.select(); }, 60);
}
$('dlgOk').addEventListener('click', function(){ if(dlgOnOk){ dlgOnOk(); } });
$('dlgCancel').addEventListener('click', closeDialog);
$('dialogBackdrop').addEventListener('click', closeDialog);
$('dlgInput').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); if(dlgOnOk){ dlgOnOk(); } } });
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && $('dialogModal').classList.contains('open')){ closeDialog(); }
});

/* ============================================================
   数据层（v5 模型，防御性读写 + 回滚）
   ============================================================ */
var storageReadOnly = false;
function defaultState(){
  var today = dayStart(Date.now());
  return { v:5, settings:{
    proteinTarget:DEFAULT_PROTEIN, waterTarget:DEFAULT_WATER, bodyWeightKg:0, proteinPerKg:PROTEIN_PER_KG_DEFAULT,
    sound:true, voice:true, motion:true,
    voiceName:'', routine:'bodyweight', preset:'starter', profileLevel:'adapt', reminderTime:'19:30',
    readiness:'green', readinessDay:today
  }, logs:[], weights:[], lifts:{} };
}
function normalizeSettings(s){
  var out = defaultState().settings;
  var st = isPlainObject(s) ? s : {};
  var today = dayStart(Date.now());
  out.proteinTarget = clampNumber(st.proteinTarget, PROTEIN_TARGET_MIN, PROTEIN_TARGET_MAX, DEFAULT_PROTEIN);
  out.waterTarget = clampNumber(st.waterTarget, WATER_ML_MIN, WATER_ML_MAX, DEFAULT_WATER);
  var bw = Number(st.bodyWeightKg);
  out.bodyWeightKg = (Number.isFinite(bw) && bw >= WEIGHT_KG_MIN && bw <= WEIGHT_KG_MAX) ? Math.round(bw * 10) / 10 : 0;
  out.proteinPerKg = Math.round(clampNumber(st.proteinPerKg, PROTEIN_PER_KG_MIN, PROTEIN_PER_KG_MAX, PROTEIN_PER_KG_DEFAULT) * 10) / 10;
  out.sound = st.sound !== false;
  out.voice = st.voice !== false;
  out.motion = st.motion !== false;
  out.voiceName = (typeof st.voiceName === 'string') ? st.voiceName.slice(0, 60) : '';
  out.routine = ROUTINE_IDS.indexOf(st.routine) >= 0 ? st.routine : 'bodyweight';
  out.preset = ['recovery','starter','standard','steady'].indexOf(st.preset) >= 0 ? st.preset : 'starter';
  out.profileLevel = ['adapt','build','target'].indexOf(st.profileLevel) >= 0 ? st.profileLevel : 'adapt';
  out.reminderTime = (typeof st.reminderTime === 'string' && /^\d{1,2}:\d{2}$/.test(st.reminderTime)) ? st.reminderTime : '19:30';
  var rd = Number(st.readinessDay);
  if(Number.isFinite(rd) && rd === today && ['green','yellow','red'].indexOf(st.readiness) >= 0){
    out.readiness = st.readiness;
  } else {
    out.readiness = 'green';
  }
  out.readinessDay = today;
  return out;
}
function getReadiness(){ return (S.settings && S.settings.readiness) || 'green'; }
function normalizeLogs(arr){
  if(!Array.isArray(arr)){ return []; }
  var out = [], seen = {};
  arr.forEach(function(item){
    if(!isPlainObject(item)){ return; }
    if(['protein','water','training','walk'].indexOf(item.type) < 0){ return; }
    var ts = Number(item.ts);
    if(!Number.isFinite(ts) || ts < TIMESTAMP_MIN || ts > TIMESTAMP_MAX){ return; }
    var id = (typeof item.id === 'string' && /^[a-z0-9_-]{4,64}$/i.test(item.id) && !seen[item.id]) ? item.id : uid();
    seen[id] = true;
    if(item.type === 'protein'){
      var g = Math.round(clampNumber(item.grams, 0, PROTEIN_MAX_SINGLE, 0)*10)/10;
      if(g <= 0){ return; }
      var pEntry = { id:id, type:'protein', ts:ts, grams:g, food:cleanText(item.food,80,'食物'), source:['photo','quick','manual','legacy'].indexOf(item.source)>=0?item.source:'manual' };
      pEntry.meal = MEAL_IDS.indexOf(item.meal) >= 0 ? item.meal : mealFromTs(ts);
      var pc = Number(item.carbs);   if(Number.isFinite(pc)  && pc > 0){ pEntry.carbs = Math.round(Math.min(500, pc)*10)/10; }
      var pf = Number(item.fat);     if(Number.isFinite(pf)  && pf > 0){ pEntry.fat = Math.round(Math.min(500, pf)*10)/10; }
      var pcal = Number(item.calories); if(Number.isFinite(pcal) && pcal > 0){ pEntry.calories = Math.round(Math.min(3000, pcal)); }
      out.push(pEntry);
    } else if(item.type === 'water'){
      var ml = Math.round(clampNumber(item.ml, 0, WATER_ML_SINGLE, 0));
      if(ml <= 0){ return; }
      out.push({ id:id, type:'water', ts:ts, ml:ml });
    } else if(item.type === 'training'){
      out.push({
        id:id, type:'training', ts:ts,
        status:['completed','partial','stopped','legacy','makeup'].indexOf(item.status)>=0?item.status:'partial',
        routine:ROUTINE_IDS.indexOf(item.routine)>=0?item.routine:'bodyweight',
        preset:cleanText(item.preset,20,'starter'),
        readiness:['green','yellow','red'].indexOf(item.readiness)>=0?item.readiness:'green',
        actualSeconds:Math.max(0,Math.round(Number(item.actualSeconds)||0)),
        plannedSeconds:Math.max(0,Math.round(Number(item.plannedSeconds)||0)),
        workSeconds:Math.max(0,Math.round(Number(item.workSeconds)||0)),
        completedMoves:Math.max(0,Math.round(Number(item.completedMoves)||0)),
        skippedMoves:Math.max(0,Math.round(Number(item.skippedMoves)||0)),
        lifts:normalizeSessionLifts(item.lifts)
      });
    }
  });
  if(out.length > MAX_LOGS){ out = out.slice(out.length - MAX_LOGS); }
  return out;
}
function normalizeSessionLifts(raw){
  if(!isPlainObject(raw)){ return undefined; }
  var out = {}, empty = true;
  Object.keys(raw).forEach(function(id){
    if(!/^[a-z0-9-]{2,32}$/i.test(id) || !Array.isArray(raw[id])){ return; }
    var sets = raw[id].map(normalizeLiftSet).filter(Boolean);
    if(sets.length){ out[id] = sets; empty = false; }
  });
  return empty ? undefined : out;
}
function normalizeWeights(arr){
  if(!Array.isArray(arr)){ return []; }
  var out = [];
  arr.forEach(function(item){
    if(!isPlainObject(item)){ return; }
    var ts = Number(item.ts), kg = Number(item.kg);
    if(!Number.isFinite(ts) || !Number.isFinite(kg)){ return; }
    out.push({ ts:ts, kg:Math.round(clampNumber(kg,WEIGHT_KG_MIN,WEIGHT_KG_MAX,kg)*10)/10, waist:item.waist?Math.round(clampNumber(item.waist,WAIST_CM_MIN,WAIST_CM_MAX,0)*10)/10:undefined });
  });
  return out.slice(-MAX_WEIGHTS);
}
function migrateState(raw){
  // 按版本号逐步升级数据结构。新增迁移时在末尾追加 if 分支。
  if(!isPlainObject(raw)){ return null; }
  if(raw.v === 4){
    // v4 → v5：补充 v5 新增的 settings 默认值（旧数据可能缺字段）
    raw.v = 5;
  }
  if(raw.v === 5){
    // 当前版本，无需迁移
    return raw;
  }
  // 未知版本（过高或过低）：拒绝加载，避免破坏数据
  return null;
}
var CORRUPT_KEY = V5KEY + '.corrupt';
/* 读不懂的原始数据：原文另存一份（只存第一次，即最原始的那份），绝不覆盖 */
function quarantineRawState(rawText){
  if(!rawText){ return; }
  try{
    if(window.localStorage.getItem(CORRUPT_KEY) == null){
      window.localStorage.setItem(CORRUPT_KEY, rawText);
    }
  }catch(e){}
  console.error('[轻打卡] 本机数据解析失败，原文已隔离保存，未覆盖。');
}
/* 返回 { state, hadData }：hadData 表示本机确实存过数据 */
function readState(){
  var rawText = null;
  try{ rawText = window.localStorage.getItem(V5KEY); }catch(e){ return { state:null, hadData:false }; }
  if(!rawText){ return { state:null, hadData:false }; }
  var raw = null;
  try{ raw = JSON.parse(rawText); }catch(e){ raw = null; }
  raw = migrateState(raw);
  if(!isPlainObject(raw) || raw.v !== 5){
    quarantineRawState(rawText);
    return { state:null, hadData:true };
  }
  return { state:hydrateState(raw), hadData:true };
}
function hydrateState(raw){
  return {
    v:5,
    settings:normalizeSettings(raw.settings),
    logs:normalizeLogs(raw.logs),
    weights:normalizeWeights(raw.weights),
    lifts:normalizeLifts(raw.lifts)
  };
}
var lastPersistedStateJson = null;
var storageReady = false;
var idbHandle = null;
var IDB_NAME = 'qingdaka-v6';
var IDB_STORE = 'kv';
var IDB_KEY = 'state';
function openIdb(done){
  if(!window.indexedDB){ done(null); return; }
  var req;
  try{ req = window.indexedDB.open(IDB_NAME, 1); }
  catch(e){ done(null); return; }
  req.onupgradeneeded = function(){
    if(!req.result.objectStoreNames.contains(IDB_STORE)){ req.result.createObjectStore(IDB_STORE); }
  };
  req.onsuccess = function(){ done(req.result); };
  req.onerror = function(){ done(null); };
}
function idbGet(db, done){
  if(!db){ done(null); return; }
  try{
    var tx = db.transaction(IDB_STORE, 'readonly');
    var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = function(){ done(req.result || null); };
    req.onerror = function(){ done(null); };
  }catch(e){ done(null); }
}
function idbSet(db, value){
  if(!db){ return; }
  try{
    db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, IDB_KEY);
  }catch(e){}
}
function idbClear(db){
  if(!db){ return; }
  try{
    db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(IDB_KEY);
  }catch(e){}
}
function writeState(s){
  if(storageReadOnly){ showToast('当前为只读模式，数据未保存', 'error'); return false; }
  var json;
  try{ json = JSON.stringify(s); }catch(e){ showToast('本地存储写入失败，数据可能未保存', 'error'); return false; }
  if(json === lastPersistedStateJson){ return true; }
  var lsOk = false;
  try{
    window.localStorage.setItem(V5KEY, json);
    lsOk = true;
  }catch(e){}
  idbSet(idbHandle, s);
  if(lsOk || idbHandle){
    lastPersistedStateJson = json;
    return true;
  }
  storageReadOnly = true;
  showToast('本地存储写入失败（空间不足或隐私模式），已转为只读，请先导出备份', 'error');
  return false;
}
var __boot = readState();
var S = __boot.state || defaultState();
storageReadOnly = !__boot.state && __boot.hadData;
storageReady = true;
lastPersistedStateJson = null;
if(!storageReadOnly){ writeState(S); }
else {
  window.setTimeout(function(){
    showToast('本机数据读取异常，已进入只读模式；原始数据未被覆盖，请到「我的 → 导出备份」取出', 'error');
  }, 400);
}
function recoverFromIdb(){
  openIdb(function(db){
    idbHandle = db;
    if(storageReadOnly){ return; }
    idbGet(db, function(idbRaw){
      var migrated = isPlainObject(idbRaw) ? migrateState(idbRaw) : null;
      var idbState = (migrated && migrated.v === 5) ? hydrateState(migrated) : null;
      if(idbState && !__boot.state && !__boot.hadData){
        S = idbState;
        lastPersistedStateJson = null;
        writeState(S);
        bumpLogIndex();
        moves = routines[S.settings.routine] || bodyweightMoves;
        if(typeof buildSteps === 'function'){ buildSteps(); }
        if(typeof renderAll === 'function'){ renderAll(); }
        else if(typeof renderToday === 'function'){ renderToday(); }
        return;
      }
      if(!idbState && S){ idbSet(db, S); }
    });
  });
}
function mutateState(apply){
  if(storageReadOnly){ showToast('当前为只读模式', 'error'); return false; }
  var snapshot;
  try{ snapshot = JSON.stringify(S); }catch(e){ return false; }
  try{ apply(); }catch(e){
    try{ S = JSON.parse(snapshot); }catch(_){}
    showToast('操作失败，原数据未改变', 'error'); return false;
  }
  if(writeState(S)){ bumpLogIndex(); return true; }
  try{ S = JSON.parse(snapshot); }catch(_){}
  return false;
}
function canAddLog(){
  if(S.logs.length >= MAX_LOGS){ showToast('记录已达上限，请先导出并清理', 'error'); return false; }
  return true;
}

/* ---- 记录操作 ---- */
function addProtein(grams, food, source, extras){
  grams = Math.round(grams * 10) / 10;
  if(!grams || grams <= 0){ showToast('蛋白质克数需大于 0', 'error'); return; }
  var entry = { id:uid(), type:'protein', ts:Date.now(), grams:grams, food:cleanText(food,80,'食物'), source:source||'manual' };
  var ex = extras || {};
  entry.meal = MEAL_IDS.indexOf(ex.meal) >= 0 ? ex.meal : mealFromTs(entry.ts);
  var c = Number(ex.carbs);   if(Number.isFinite(c)   && c > 0){ entry.carbs = Math.round(Math.min(500, c)*10)/10; }
  var f = Number(ex.fat);     if(Number.isFinite(f)   && f > 0){ entry.fat = Math.round(Math.min(500, f)*10)/10; }
  var cal = Number(ex.calories); if(Number.isFinite(cal) && cal > 0){ entry.calories = Math.round(Math.min(3000, cal)); }
  if(!canAddLog() || !mutateState(function(){ S.logs.push(entry); })){ return; }
  renderToday();
  showToast('已记入 +' + grams + 'g 蛋白' + (entry.calories ? ' · ' + entry.calories + ' kcal' : ''), 'success');
}
function addTraining(meta){
  meta = meta || {};
  if(!canAddLog() || !mutateState(function(){
    var entry = {
      id:uid(), type:'training', ts:Date.now(), status:meta.status||'partial',
      routine:meta.routine||S.settings.routine, preset:meta.preset||S.settings.preset,
      readiness:meta.readiness||'green', actualSeconds:Math.max(0,Math.round(meta.actualSeconds||0)),
      plannedSeconds:Math.max(0,Math.round(meta.plannedSeconds||0)), workSeconds:Math.max(0,Math.round(meta.workSeconds||0)),
      completedMoves:Math.max(0,Math.round(meta.completedMoves||0)), skippedMoves:Math.max(0,Math.round(meta.skippedMoves||0))
    };
    var lifts = normalizeSessionLifts(meta.lifts || sessionLifts);
    if(lifts){ entry.lifts = lifts; }
    S.logs.push(entry);
  })){ return false; }
  renderAll();
  return true;
}
function upsertLiftRec(moveId, set){
  if(!S.lifts){ S.lifts = {}; }
  var rec = S.lifts[moveId] || { kg:0, reps:0, level:'', ts:0, history:[] };
  if(set.kg){ rec.kg = set.kg; }
  if(set.reps){ rec.reps = set.reps; }
  if(set.level){ rec.level = set.level; }
  rec.ts = Date.now();
  rec.history = (rec.history || []).concat([{
    ts: rec.ts, kg: set.kg || 0, reps: set.reps || 0, level: set.level || ''
  }]).slice(-LIFT_HISTORY_MAX);
  S.lifts[moveId] = rec;
  return rec;
}
function addWater(ml){
  ml = Math.round(clampNumber(ml, 1, WATER_ML_SINGLE, 0));
  if(!ml){ showToast('饮水量需大于 0', 'error'); return; }
  if(!canAddLog() || !mutateState(function(){
    S.logs.push({ id:uid(), type:'water', ts:Date.now(), ml:ml });
  })){ return; }
  renderToday();
  if(document.getElementById('page-data').classList.contains('active')){ renderData(); }
  showToast('已记入 +' + ml + ' ml', 'success');
}
function addWeight(kg){
  kg = Math.round(clampNumber(kg, WEIGHT_KG_MIN, WEIGHT_KG_MAX, 0) * 10) / 10;
  if(!kg){ showToast('请输入有效体重', 'error'); return; }
  if(!mutateState(function(){
    S.weights.push({ ts:Date.now(), kg:kg });
    if(S.weights.length > MAX_WEIGHTS){ S.weights = S.weights.slice(-MAX_WEIGHTS); }
    S.settings.bodyWeightKg = kg;
  })){ return; }
  renderToday();
  if(document.getElementById('page-me').classList.contains('active')){ renderSettings(); }
  if(document.getElementById('page-data').classList.contains('active')){ renderData(); }
  showToast('已记下 ' + kg + ' kg', 'success');
}
function applyProteinFromWeight(){
  var kg = S.settings.bodyWeightKg || (latestWeight() && latestWeight().kg);
  var sug = suggestedProteinTarget(kg, S.settings.proteinPerKg);
  if(!sug){ showToast('先记下体重，才能按体重计算', 'error'); return false; }
  if(!mutateState(function(){ S.settings.proteinTarget = sug; })){ return false; }
  renderSettings(); renderToday();
  showToast('目标已设为 ' + sug + ' g（' + kg + ' kg × ' + S.settings.proteinPerKg + '）', 'success');
  return true;
}
function deleteLog(id){
  if(!mutateState(function(){ S.logs = S.logs.filter(function(l){ return l.id !== id; }); })){ return; }
  renderAll();
  showToast('已删除', '');
}
/*
 * isActualTraining — 判断一次训练记录是否算"有效训练"（至少完成 60 秒的工作时间）
 * status 说明：
 *   'completed' / 'partial' / 'stopped' — 正常完成/部分/提前结束
 *   'legacy' — 旧版数据，用 actualSeconds 判断（兼容无 workSeconds 的旧数据）
 *   'makeup' — 补打卡记录，不计入训练连击
 */
function isActualTraining(log){
  return !!(log && log.type === 'training' && log.status !== 'makeup' &&
    (log.status === 'legacy' ? (Number(log.actualSeconds)||0) >= 60 : (Number(log.workSeconds)||0) >= 60));
}
function isStrengthTraining(log){
  return isActualTraining(log) && log.routine !== 'stretch';
}
function countWeekStrengthDays(sessions, now){
  var start = weekStart(now || Date.now());
  var end = start + 7 * 86400000;
  var days = {};
  (sessions || []).forEach(function(l){
    if(!isStrengthTraining(l)){ return; }
    if(l.ts < start || l.ts >= end){ return; }
    days[dayStart(l.ts)] = true;
  });
  return Object.keys(days).length;
}

/* ---- 日志按日索引（蛋白汇总 / 训练日 / 列表，避免反复全表扫描）---- */
var logIndexEpoch = 0;
var logIndexCache = null;
function bumpLogIndex(){ logIndexEpoch++; logIndexCache = null; }
function buildLogIndex(){
  var proteinByDay = {};
  var proteinLogsByDay = {};
  var waterByDay = {};
  var trainingDays = {};
  var trainingSessions = [];
  S.logs.forEach(function(l){
    var ds = dayStart(l.ts);
    if(l.type === 'protein'){
      proteinByDay[ds] = (proteinByDay[ds] || 0) + (Number(l.grams) || 0);
      if(!proteinLogsByDay[ds]){ proteinLogsByDay[ds] = []; }
      proteinLogsByDay[ds].push(l);
    } else if(l.type === 'water'){
      waterByDay[ds] = (waterByDay[ds] || 0) + (Number(l.ml) || 0);
    } else if(isActualTraining(l)){
      trainingDays[ds] = true;
      trainingSessions.push(l);
    }
  });
  Object.keys(proteinLogsByDay).forEach(function(ds){
    proteinLogsByDay[ds].sort(function(a, b){ return b.ts - a.ts; });
  });
  trainingSessions.sort(function(a, b){ return b.ts - a.ts; });
  return {
    epoch: logIndexEpoch,
    proteinByDay: proteinByDay,
    proteinLogsByDay: proteinLogsByDay,
    waterByDay: waterByDay,
    trainingDays: trainingDays,
    trainingSessions: trainingSessions
  };
}
function getLogIndex(){
  if(!logIndexCache || logIndexCache.epoch !== logIndexEpoch){
    logIndexCache = buildLogIndex();
  }
  return logIndexCache;
}
function computeTrainingStreak(trainingDays){
  var streak = 0, d = dayStart(Date.now());
  if(!trainingDays[d]){ d -= 86400000; }
  while(trainingDays[d]){ streak++; d -= 86400000; }
  return streak;
}
function rebuildLogIndexFromLogs(logs){
  var saved = S.logs;
  S.logs = logs;
  var idx = buildLogIndex();
  S.logs = saved;
  return idx;
}

/* ---- 页面切换 ---- */
function goPage(name){
  document.querySelectorAll('.page').forEach(function(p){ p.classList.toggle('active', p.id === 'page-' + name); });
  document.querySelectorAll('.tab').forEach(function(t){
    var on = t.dataset.page === name;
    t.classList.toggle('active', on);
    if(on){ t.setAttribute('aria-current','page'); } else { t.removeAttribute('aria-current'); }
  });
  window.scrollTo(0,0);
  if(name === 'today'){ renderToday(); }
  if(name === 'data'){ renderData(); }
  if(name === 'training'){ renderTraining(); }
  if(name === 'me'){ renderSettings(); }
}
document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click', function(){ goPage(t.dataset.page); });
});

/* ============================================================
   动作库（沿用 v3 动作库，含大体重友好调整）
   ============================================================ */
var bodyweightMoves = [
  { id:'3013', name:'臀桥', area:'臀部与后侧链', sideMode:'none', equipment:'', steps:['仰卧屈膝，双脚与髋同宽','收紧腹部，脚跟推地抬髋','到肩—髋—膝接近直线后慢慢回位'], cue:'肋骨不要外翻；顶端夹臀，不要用腰向上拱。呼吸：抬髋时呼气，下放时吸气。', mistake:'常见错误：抬得越高越好，导致腰部过伸。' },
  { id:'0276', name:'死虫', area:'核心稳定', sideMode:'alternate', equipment:'', steps:['腰背自然贴稳垫面，髋膝约 90°','一侧手臂与对侧腿缓慢远离身体','腰背不离垫，回位后换侧'], cue:'范围由腰背能否保持稳定决定；宁可短一点。呼吸：手脚伸出时呼气，回位时吸气。', mistake:'常见错误：手脚下放过低，腰背拱起。' },
  { id:'0710', name:'侧卧髋外展', area:'臀中肌', sideMode:'half', equipment:'', steps:['侧卧，身体和下侧腿稳定','上侧腿伸直，脚尖朝正前方','小幅抬起，停一下，再控制放下'], cue:'先做右侧，过半换左侧；骨盆不要向后翻。呼吸：抬腿时呼气，放下时吸气。', mistake:'常见错误：腿抬太高、脚尖转向天花板。' },
  { id:'0659', name:'靠墙俯卧撑', area:'胸肩与上肢推力', sideMode:'none', equipment:'', steps:['面对墙站立，双手略宽于肩','身体保持一条直线，屈肘靠近墙','手掌推墙，回到起始位'], cue:'脚离墙越远越难；先选能稳定控制的位置。呼吸：推墙时呼气，靠近时吸气。', mistake:'常见错误：只移动头部，或塌腰、耸肩。' },
  { id:'1373', name:'扶墙提踵', area:'小腿与踝稳定', sideMode:'none', equipment:'', steps:['双脚平行，轻扶稳定物体','脚跟垂直上提，重心保持在大脚趾根部附近','停一下，再慢慢落地'], cue:'保持脚踝正直；急性足趾或踝关节红肿热痛时不要做。呼吸：上提时呼气，落地时吸气。', mistake:'常见错误：脚踝向外翻，靠弹跳完成。' },
  { id:'3239', name:'跪姿平板点肩', area:'核心与肩稳定', sideMode:'alternate', equipment:'', steps:['前臂支撑、膝盖着地，头到膝保持直线','收紧腹部，轻抬一只手触碰对侧肩','骨盆尽量不晃，放回后换侧'], cue:'若点肩破坏稳定，保持跪姿平板即可。呼吸：点肩时呼气，全程不憋气。', mistake:'常见错误：憋气、塌腰或骨盆大幅旋转。' }
];
var dumbbellMoves = [
  { id:'0292', name:'扶椅单臂哑铃划船', area:'背部与上肢拉力', sideMode:'half', equipment:'哑铃', steps:['将稳定椅靠墙，空手扶稳，双脚前后站立','背部保持中立，持铃手自然下垂','肘部贴近身体拉向髋侧，再缓慢放下'], cue:'先做右侧，过半换左侧；支撑物必须稳固且不会滑动。呼吸：上拉时呼气，下放时吸气。', mistake:'常见错误：耸肩、弓背，或用转动躯干把重量甩起来。' },
  { id:'0404', name:'坐姿中立握哑铃推举', area:'肩部与上肢推力', sideMode:'none', equipment:'哑铃', steps:['坐在靠墙的稳定椅上，双脚踩稳','掌心相对，将哑铃停在肩旁','向上推至手臂接近伸直，再控制回到肩旁'], cue:'肋骨收住、不要后仰；只有一只哑铃时，每次左右交替。肩部锐痛立即停止。呼吸：上推时呼气，回落时吸气。', mistake:'常见错误：腰部大幅后弓、耸肩，或在头顶撞击哑铃。' },
  { id:'1677', name:'坐姿哑铃弯举', area:'上臂前侧', sideMode:'none', equipment:'哑铃', steps:['坐稳，双脚着地，手臂自然垂在身体两侧','上臂保持安静，屈肘抬起哑铃','到可控位置后停一下，再缓慢下放'], cue:'两只可同时做；只有一只时左右交替。重量要允许肩膀和躯干保持安静。呼吸：抬起时呼气，下放时吸气。', mistake:'常见错误：身体前后摆动，或把肘部向前送来缩短动作。' },
  { id:'1459', name:'哑铃罗马尼亚硬拉', area:'臀部与大腿后侧', sideMode:'none', equipment:'哑铃', steps:['双脚与髋同宽，膝盖微屈，哑铃贴近腿前','髋部向后送，躯干随之向前倾','背部保持中立，到大腿后侧有拉伸感后夹臀站起'], cue:'动作是"髋向后"，不是深蹲；幅度由背部能否保持中立决定，不必让哑铃碰地。呼吸：站起时呼气，前倾时吸气。', mistake:'常见错误：弓背、哑铃远离身体，或为了下得更低而失去控制。' },
  { id:'0291', name:'扶凳箱式深蹲', area:'大腿前侧与臀部', sideMode:'none', equipment:'哑铃', steps:['身后放一把稳固的椅子，双脚与髋同宽，哑铃垂于体侧（先徒手亦可）','臀部向后坐，像要坐进椅子里，膝盖朝脚尖方向','轻触椅面后脚跟推地站起，顶端夹臀'], cue:'椅子越高越简单；下蹲幅度以膝盖无锐痛为准，全程背部中立。先徒手练熟再加哑铃。呼吸：下坐时吸气，站起时呼气。', mistake:'常见错误：膝盖内扣、脚跟离地，或下坐时塌腰、上身过度前倾。' }
];
/* ---- 健身房主流固定器械 · 全身均衡（3推3拉3腿）----
   顺序遵循 ACSM/NSCA：大肌群复合动作优先 → 推/拉交替 → 上/下肢交替，避免同肌群连做：
   腿举(腿·复合) → 推胸(推) → 下拉(拉) → 腿屈伸(腿) → 推肩(推) → 划船(拉) → 蝴蝶机(推) → 腿弯举(腿) → 辅助引体(拉)。
   动图同源 Kaggle 健身动图集。 */
var gymMoves = [
  { id:'2287', name:'腿举机', area:'大腿与臀部', sideMode:'none', equipment:'腿举机', steps:['坐稳靠背，双脚与髋同宽踩在踏板中部','膝盖朝脚尖方向，缓慢屈膝下放','脚跟推踏板蹬起，顶端不锁死膝盖'], cue:'全身最大复合动作，放最先练；下放幅度以腰背贴稳靠背为准，膝盖不内扣。呼吸：蹬起时呼气，下放时吸气。', mistake:'常见错误：下放过深导致骨盆后倾、膝盖内扣，或猛蹬锁死膝盖。' },
  { id:'0576', name:'坐姿推胸机', area:'胸部与上肢推力', sideMode:'none', equipment:'坐姿推胸机', steps:['调好座椅高度，握把与胸同高，背部贴紧靠背','双手握把，肘部略低于肩，核心收紧','向前推至手臂接近伸直，再缓慢回放至胸侧'], cue:'重量宁轻勿重；推起时肩胛贴稳靠背、不耸肩。呼吸：推起时呼气，回放时吸气。', mistake:'常见错误：重量过大导致耸肩、弓背，或回放过快撞击配重。' },
  { id:'0579', name:'高位下拉机', area:'背部与上肢拉力', sideMode:'none', equipment:'高位下拉机', steps:['坐下固定大腿，握把略宽于肩，躯干微后倾','肩胛先下沉，再把握把拉向上胸','控制回放至手臂伸直，感受背阔拉伸'], cue:'与推胸一推一拉、相互平衡；用背带动手臂，不靠体重猛拉、不耸肩。呼吸：下拉时呼气，回放时吸气。', mistake:'常见错误：身体大幅后仰借力、耸肩，或拉到颈后。' },
  { id:'0585', name:'腿屈伸机', area:'大腿前侧', sideMode:'none', equipment:'腿屈伸机', steps:['调好靠背与踝垫，踝垫位于小腿前下方','双手扶稳把手，大腿贴紧座垫','伸膝把踝垫向上抬起，再缓慢下放'], cue:'与腿举互补、专注大腿前侧；顶端不猛甩，下放有控制。呼吸：抬起时呼气，下放时吸气。', mistake:'常见错误：借惯性猛抬、骨盆弹起，或下放失控。' },
  { id:'0603', name:'坐姿推肩机', area:'肩部与上肢推力', sideMode:'none', equipment:'坐姿推肩机', steps:['调好座椅，握把与肩同高，背部贴紧靠背','双手握把，核心收紧、肋骨收住','向上推至手臂接近伸直，再控制回放到肩旁'], cue:'不要后仰顶腰；肩部锐痛立即停止。呼吸：上推时呼气，回落时吸气。', mistake:'常见错误：腰部大幅后弓、耸肩，或在顶端撞击配重。' },
  { id:'0588', name:'坐姿划船机', area:'上背与上肢拉力', sideMode:'none', equipment:'坐姿划船机', steps:['坐稳，胸口贴住靠垫，双脚踩实踏板','双手握把，背部保持中立不弓背','肘部贴近身体向后拉，肩胛向中间夹，再缓慢放回'], cue:'先挺胸再拉；拉到底时停顿一下。呼吸：后拉时呼气，放回时吸气。', mistake:'常见错误：弓背、耸肩，或用腰把重量甩回来。' },
  { id:'0596', name:'蝴蝶机夹胸', area:'胸部内侧', sideMode:'none', equipment:'蝴蝶机（坐姿夹胸机）', steps:['调好座椅，握把与胸同高，背部贴紧靠背','双臂微屈，从两侧向中间夹拢','夹到顶峰停顿一下，再缓慢展开'], cue:'用胸带动手臂、肩胛贴稳；展开幅度以肩无不适为准。呼吸：夹拢时呼气，展开时吸气。', mistake:'常见错误：耸肩、肘部过高，或展开过猛拉伤肩部。' },
  { id:'0599', name:'坐姿腿弯举机', area:'大腿后侧', sideMode:'none', equipment:'坐姿腿弯举机', steps:['调好靠背与踝垫，踝垫位于跟腱上方','双手扶稳把手，大腿贴紧座垫','屈膝把踝垫向下向后压，再缓慢放回'], cue:'与腿屈伸前后互补、练大腿后侧；动作慢而稳，骨盆不离开座垫。呼吸：下压时呼气，回放时吸气。', mistake:'常见错误：借惯性猛压、骨盆弹起，或回放过快。' },
  { id:'0017', name:'辅助引体向上机', area:'背部与上肢拉力', sideMode:'none', equipment:'辅助引体向上机', steps:['选择辅助重量，跪/踩在辅助垫上，握把略宽于肩','肩胛下沉，把身体向上拉起至下巴过杆','控制下放至手臂伸直，感受背阔拉伸'], cue:'辅助重量越大越简单；用背发力、不耸肩。呼吸：上拉时呼气，下放时吸气。', mistake:'常见错误：耸肩、身体大幅摆动，或下放失控。' }
];
var MOVE_META = {
  '3013':{ primary:'臀大肌', secondary:'腘绳肌、腹壁稳定肌', benefit:'提升髋伸力量，帮助起身与步行。', level:'起步' },
  '0276':{ primary:'腹横肌、腹直肌', secondary:'髋屈肌', benefit:'练习手脚活动时保持腰腹稳定。', level:'起步' },
  '0710':{ primary:'臀中肌', secondary:'臀小肌、腹斜肌', benefit:'帮助站立、走路时稳定骨盆。', level:'起步' },
  '0659':{ primary:'胸大肌、肱三头肌', secondary:'前三角肌、腹壁稳定肌', benefit:'补齐上肢推力，并练站姿躯干稳定。', level:'起步' },
  '1373':{ primary:'腓肠肌、比目鱼肌', secondary:'足踝稳定肌', benefit:'帮助走路推进与踝部稳定。', level:'起步' },
  '3239':{ primary:'腹横肌、腹直肌', secondary:'肩胛稳定肌、腹斜肌', benefit:'练习抵抗塌腰和躯干旋转。', level:'进阶可降级' },
  '0292':{ primary:'背阔肌、菱形肌', secondary:'肱二头肌、后三角肌', benefit:'补齐上肢拉力，帮助提物与改善圆肩姿势。', level:'建立' },
  '0404':{ primary:'三角肌', secondary:'肱三头肌、上背稳定肌', benefit:'提升头顶拿取物品的上肢能力。', level:'建立' },
  '1677':{ primary:'肱二头肌', secondary:'肱肌、前臂', benefit:'提升提袋、抱物时的屈肘力量。', level:'建立' },
  '1459':{ primary:'臀大肌、腘绳肌', secondary:'竖脊肌、腹壁稳定肌', benefit:'强化髋铰链，帮助从地面附近安全取物。', level:'建立' },
  '0291':{ primary:'股四头肌、臀大肌', secondary:'腘绳肌、躯干稳定肌', benefit:'强化坐下、起身与上下楼所需的大肌群。', level:'建立' },
  '0576':{ primary:'胸大肌', secondary:'肱三头肌、前三角肌', benefit:'强化上肢水平推力，帮助推门、提举等日常力量。', level:'建立' },
  '0579':{ primary:'背阔肌', secondary:'肱二头肌、菱形肌', benefit:'强化上肢垂直拉力，帮助提拉与改善圆肩。', level:'建立' },
  '0588':{ primary:'背阔肌、菱形肌', secondary:'肱二头肌、后三角肌', benefit:'强化上肢水平拉力，改善含胸与上背无力。', level:'建立' },
  '2287':{ primary:'股四头肌、臀大肌', secondary:'腘绳肌、小腿', benefit:'强化下肢整体力量，帮助起身、上楼与搬物。', level:'建立' },
  '0599':{ primary:'腘绳肌', secondary:'腓肠肌', benefit:'强化大腿后侧，平衡腿部力量、保护膝关节。', level:'建立' },
  '0603':{ primary:'三角肌', secondary:'肱三头肌、上背稳定肌', benefit:'提升头顶取物的上肢力量与肩部稳定。', level:'建立' },
  '0585':{ primary:'股四头肌', secondary:'髋屈肌', benefit:'强化大腿前侧，与腿弯举平衡腿部力量。', level:'建立' },
  '0596':{ primary:'胸大肌', secondary:'前三角肌', benefit:'强化胸部与夹胸控制，改善上肢推力。', level:'建立' },
  '0017':{ primary:'背阔肌', secondary:'肱二头肌、上背稳定肌', benefit:'以辅助重量练引体，强化垂直拉力。', level:'建立' }
};
bodyweightMoves.concat(dumbbellMoves).concat(gymMoves).forEach(function(m){
  var meta = MOVE_META[m.id] || {};
  Object.keys(meta).forEach(function(k){ m[k] = meta[k]; });
});
var chairStandMove = Object.assign({}, dumbbellMoves.filter(function(m){ return m.id === '0291'; })[0], {
  id:'chair-stand', mediaId:'0291', name:'扶椅坐站（先徒手）', area:'大腿、臀部与躯干稳定',
  sideMode:'none', equipment:'稳固椅子；图中哑铃仅为进阶',
  primary:'股四头肌、臀大肌', secondary:'腘绳肌、腹壁稳定肌',
  benefit:'强化起身、上下楼和日常活动所需的大肌群。',
  steps:['把稳固椅子靠墙，双脚踩稳，先不拿哑铃','臀部向后坐，轻触椅面；可用双手扶大腿或椅侧协助','脚跟推地站起，能稳定完成后再考虑轻负重'],
  cue:'先徒手；椅子越高越轻松。膝盖朝脚尖方向，膝或腰出现锐痛立即停止。',
  mistake:'常见错误：一开始就加重量、膝盖内扣，或借惯性猛坐猛起。', level:'起步·先徒手'
});
var birdDogMove = {
  id:'bird-dog', frames:['generated/bird-dog-anatomy.png'], staticOnly:true,
  name:'鸟狗式分步', area:'核心与腰盆协调', sideMode:'alternate', equipment:'',
  primary:'多裂肌、竖脊肌', secondary:'腹壁、臀大肌、后三角肌',
  benefit:'练习四肢移动时保持腰盆稳定。',
  steps:['仅在能安全上下地面时做，四点跪姿起步','先只伸一只手或一条腿，稳定后再做对侧手脚','身体不晃、腰不塌，短暂停留后换侧'],
  cue:'腹部较大时可把手撑在稳固沙发座面；先单肢，再考虑对侧手脚。',
  mistake:'常见错误：抬得过高、腰部旋转，或为了跟图而超出自己幅度。', level:'可选进阶'
};
var wallPlankMove = Object.assign({}, bodyweightMoves.filter(function(m){ return m.id === '0659'; })[0], {
  id:'wall-plank', frames:['generated/wall-plank-anatomy.png'], staticOnly:true, name:'墙面斜板支撑', area:'站姿核心稳定', sideMode:'none',
  primary:'腹横肌、腹直肌', secondary:'腹斜肌、肩胛稳定肌',
  benefit:'练习抵抗塌腰，帮助站立和搬拿时保持躯干稳定。',
  steps:['面对墙站立，双手撑墙略宽于肩','双脚向后小步移动，让身体成一直线','轻轻收紧腹部，保持呼吸，时间到后走近墙面'],
  cue:'墙越近越轻松；全程能说短句、不憋气。若肩痛，缩短距离。',
  mistake:'常见错误：塌腰、耸肩或屏住呼吸。', level:'起步'
});
var farmerCarryMove = {
  id:'farmer-carry', frames:['generated/farmer-carry-anatomy.png'], staticOnly:true,
  name:'轻负重行走 / 原地持重', area:'站姿核心与全身稳定', sideMode:'none',
  equipment:'两只同重量轻哑铃或水瓶',
  primary:'腹壁稳定肌、竖脊肌', secondary:'前臂、斜方肌、臀中肌',
  benefit:'练习行走、提物时维持直立躯干和稳定呼吸。',
  steps:['选两只同重量轻物，先确认握得住且地面没有障碍','站高，肋骨和骨盆保持自然叠放，双手垂在体侧','空间安全就慢走；空间不足则原地交替抬脚，始终能说短句'],
  cue:'重量宁轻勿重；肩膀放松，不侧弯、不憋气。脚下不稳或头晕时立即放下。',
  mistake:'常见错误：为了追求重量而耸肩、身体侧弯，或在狭窄空间勉强行走。',
  level:'起步·轻负重'
};
var coreMoves = [wallPlankMove, bodyweightMoves[3], chairStandMove, farmerCarryMove, birdDogMove];
var routines = { bodyweight: bodyweightMoves.map(function(m, i){ return i === 2 ? chairStandMove : m; }), dumbbell: dumbbellMoves, core: coreMoves, gym: gymMoves };
var routineNames = { bodyweight:'徒手基础', dumbbell:'居家哑铃', core:'腰腹稳定', gym:'健身器械' };
var presets = {
  recovery:{warmup:45,work:20,rest:25,roundBreak:40,cooldown:45,rounds:1},
  starter:{warmup:60,work:40,rest:25,roundBreak:45,cooldown:60,rounds:1},
  standard:{warmup:60,work:45,rest:20,roundBreak:45,cooldown:60,rounds:2},
  steady:{warmup:75,work:50,rest:15,roundBreak:45,cooldown:75,rounds:3}
};
var presetNames = { recovery:'恢复档', starter:'入门档', standard:'标准档', steady:'进阶档' };

/* ---- 热身动作库（低冲击、站姿、大体重友好；动图同源 Kaggle 健身动图集）---- */
var warmupMoves = [
  { id:'3221', name:'原地踏步激活', sec:30, target:'全身 / 髋', position:'站姿', cue:'站直，交替抬膝到舒适高度，手臂自然摆动；先慢后稍快，让身体先热起来。' },
  { id:'1368', name:'踝关节绕环', sec:20, target:'踝', position:'站姿', cue:'单脚站稳（可扶墙），另一脚脚尖画圈，顺逆各几次后换脚。' },
  { id:'0257', name:'膝关节绕环', sec:20, target:'膝', position:'站姿', cue:'双脚并拢微屈，双手扶膝轻画圈；幅度以舒适为准，不顺滑就缩小范围。' },
  { id:'1428', name:'腕关节绕环', sec:20, target:'腕 / 前臂', position:'站姿', cue:'双手十指交叉转动，或单腕画圈，活动手腕与前臂。' },
  { id:'1167', name:'动态扩胸', sec:25, target:'肩 / 胸', position:'站姿', cue:'双臂前后摆动、画圈，打开肩胸；动作连贯、不憋气。' }
];

/* ---- 拉伸字典（按编号；练后针对部位 + 独立拉伸组共用）---- */
var STRETCH = {
  '1377':{ name:'扶墙小腿拉伸', sec:28, target:'小腿', position:'站姿·扶墙', cue:'双手扶墙，一腿在前一腿在后，后脚跟贴地、膝伸直，身体前倾直到小腿后侧有拉伸感，换腿。' },
  '1576':{ name:'仰卧抬腿拉伸', sec:28, target:'大腿后侧', position:'仰卧', cue:'平躺，一腿伸直放地，另一腿抬起、双手抱大腿后侧往胸口靠，膝可微屈，换腿。' },
  'quad-stand':{ name:'扶墙股四头拉伸', sec:28, target:'大腿前侧', position:'站姿·扶墙', noMedia:true, cue:'单手扶墙或扶椅站稳，另一手抓同侧脚背拉向臀部，双膝并拢、骨盆别前倾；抓不到脚就用毛巾套住脚背，换边。' },
  '1271':{ name:'胸前侧拉伸', sec:28, target:'胸 / 肩前侧', position:'站姿', cue:'双手在身后交握（够不到就握毛巾），挺胸、肩向后向下沉，感受胸前打开。' },
  '0643':{ name:'过头三头拉伸', sec:28, target:'上臂后侧', position:'站姿', cue:'一臂上举屈肘、手摸背，另一手轻压肘尖；肋骨别外翻，换边。' },
  '0794':{ name:'站姿侧拉伸', sec:28, target:'侧腰 / 背阔', position:'站姿', cue:'一臂上举，身体向对侧轻弯，感受侧腰到背的拉伸，换边。' },
  '1365':{ name:'上背拉伸', sec:28, target:'上背', position:'站姿', cue:'双手在胸前交握向前推、含胸，把上背撑开；或一臂横抱胸前轻压。' },
  '0669':{ name:'肩后拉伸', sec:28, target:'肩后侧', position:'站姿', cue:'一臂横过胸前，另一手轻压肘部靠近身体，肩别耸起，换边。' },
  '1424':{ name:'坐姿臀部拉伸', sec:28, target:'臀部', position:'坐姿', cue:'坐稳，一脚踝放到另一膝上成“4”字，挺胸轻轻前倾，感受臀部拉伸，换边。' },
  '1403':{ name:'颈侧拉伸', sec:28, target:'颈侧', position:'站姿', cue:'头轻偏向一侧，对侧手可轻扶头，肩放松下沉，不要用力掰，换边。' }
};
function sm(id){ return Object.assign({ id:id }, STRETCH[id]); }
var stretchSets = {
  bodyweight:[ '1377','1576','quad-stand','1271','0643','0794' ].map(sm),
  dumbbell:[ '0794','1365','0643','0669','1576','quad-stand' ].map(sm),
  core:[ '0794','0669','1271','0643','1424','quad-stand' ].map(sm),
  gym:[ '1271','0794','1365','0643','1576','quad-stand' ].map(sm),
  stretch:[ '1377','1576','quad-stand','1424','1271','0669','0643','0794','1403' ].map(sm)
};
routines.stretch = stretchSets.stretch;
routineNames.stretch = '拉伸';

var moves = routines[S.settings.routine] || bodyweightMoves;

function imagePath(move, animated, frameIndex){
  if(move.frames && move.frames.length){ return assetBase + move.frames[Math.min(frameIndex||0, move.frames.length-1)]; }
  var mediaId = move.mediaId || move.id;
  return assetBase + mediaId + (animated ? '.gif' : '-poster.png');
}
function motionOn(){ return S.settings.motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

/* ---- 预载与换图 ---- */
var mediaCache = {}, currentDemoUrl = '', demoFrameTimer = null;
var MEDIA_CACHE_MAX = 120; // 预载状态缓存上限，超出后丢弃最旧条目，避免无限增长
function preloadUrl(url){
  if(!url || mediaCache[url]){ return; }
  var keys = Object.keys(mediaCache);
  if(keys.length >= MEDIA_CACHE_MAX){ delete mediaCache[keys[0]]; }
  mediaCache[url] = 'loading';
  var im = new Image();
  im.onload = function(){ mediaCache[url] = 'ready'; };
  im.onerror = function(){ mediaCache[url] = 'error'; };
  im.src = url;
}
function preloadMove(move, animated){
  if(!move){ return; }
  if(move.frames && move.frames.length){ move.frames.forEach(function(_,i){ preloadUrl(imagePath(move,false,i)); }); }
  else { preloadUrl(imagePath(move,false)); if(animated && motionOn()){ preloadUrl(imagePath(move,true)); } }
}
function swapImage(img, url, alt){
  if(!img || !url){ return; }
  try{ url = new URL(url, document.baseURI).href; }catch(e){}
  if(img.dataset.src === url){ if(alt){ img.alt = alt; } return; }
  var token = String(Date.now()) + Math.random();
  img.dataset.swapToken = token;
  preloadUrl(url);
  var loader = new Image();
  loader.onload = function(){
    if(img.dataset.swapToken !== token){ return; }
    img.classList.add('demo-swap');
    window.setTimeout(function(){
      if(img.dataset.swapToken !== token){ return; }
      img.src = url; img.dataset.src = url; img.alt = alt || '';
      window.requestAnimationFrame(function(){ img.classList.remove('demo-swap'); });
    }, 90);
  };
  loader.onerror = function(){ if(img.dataset.swapToken === token){ img.classList.remove('demo-swap'); } };
  loader.src = url;
}
function stopFrameAnimation(){ if(demoFrameTimer){ window.clearInterval(demoFrameTimer); demoFrameTimer = null; } }

/* ============================================================
   音频 + TTS
   ============================================================ */
var audioCtx = null;
function ensureAudio(){
  if(!audioCtx){ try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){} }
  if(audioCtx && audioCtx.state === 'suspended'){ audioCtx.resume(); }
}
function beep(freq, dur, when, gain){
  if(!S.settings.sound || !audioCtx){ return; }
  try{
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.12, audioCtx.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + when + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(audioCtx.currentTime + when);
    o.stop(audioCtx.currentTime + when + dur + 0.02);
  }catch(e){}
}
function cueStart(){ ensureAudio(); beep(660,0.12,0); beep(880,0.16,0.14); }
function cueRest(){ ensureAudio(); beep(520,0.14,0); }
function cueShort(){ ensureAudio(); beep(740,0.09,0); }
function cueFinish(){ ensureAudio(); beep(660,0.12,0); beep(830,0.12,0.14); beep(990,0.2,0.28); }
function voiceEnabled(){ return S.settings.voice !== false; }

/* ---- 预生成的女声音频（御姐音色，云端神经 TTS 合成） ----
   优先播这些 m4a（AAC），跨设备音质一致；找不到对应 key 时再回退到系统 Web Speech。
   用 m4a 而非 mp3：微信 iOS WebView 对 mp3 + SW 缓存/Range 易报 NotSupportedError。
   修改音色：改 voice-scripts.json 后重新跑 synthesize，再转 m4a。 */
var VOICE_BASE = 'assets/voice/';
var VOICE_MIME = 'audio/mp4';
var VOICE_FILES = {
  'encourage-1':'encourage-1.m4a','encourage-2':'encourage-2.m4a','encourage-3':'encourage-3.m4a','encourage-4':'encourage-4.m4a','encourage-5':'encourage-5.m4a',
  'switch-side':'switch-side.m4a',
  'countdown-3':'countdown-3.m4a','countdown-start':'countdown-start.m4a',
  'finish-done':'finish-done.m4a','finish-stretch':'finish-stretch.m4a','finish-early':'finish-early.m4a',
  'warmup-3221':'warmup-3221.m4a','warmup-1368':'warmup-1368.m4a','warmup-0257':'warmup-0257.m4a','warmup-1428':'warmup-1428.m4a','warmup-1167':'warmup-1167.m4a',
  'work-3013':'work-3013.m4a','work-0276':'work-0276.m4a','work-0710':'work-0710.m4a','work-0659':'work-0659.m4a','work-1373':'work-1373.m4a',
  'work-3239':'work-3239.m4a','work-0292':'work-0292.m4a','work-0404':'work-0404.m4a','work-1677':'work-1677.m4a','work-1459':'work-1459.m4a',
  'work-0291':'work-0291.m4a','work-2287':'work-2287.m4a','work-0576':'work-0576.m4a','work-0579':'work-0579.m4a','work-0585':'work-0585.m4a',
  'work-0603':'work-0603.m4a','work-0588':'work-0588.m4a','work-0596':'work-0596.m4a','work-0599':'work-0599.m4a','work-0017':'work-0017.m4a',
  'stretch-1271':'stretch-1271.m4a','stretch-1365':'stretch-1365.m4a','stretch-1377':'stretch-1377.m4a','stretch-1403':'stretch-1403.m4a',
  'stretch-1424':'stretch-1424.m4a','stretch-1576':'stretch-1576.m4a','stretch-quad-stand':'stretch-quad-stand.m4a',
  'stretch-0643':'stretch-0643.m4a','stretch-0794':'stretch-0794.m4a','stretch-0669':'stretch-0669.m4a'
};
var voiceAudio = null;
var voiceCtx = null;
// AudioBuffer 是解码后的 PCM，远大于压缩 m4a；严格限制数量以免微信 WebView
// 因一次课预载几十段语音而回收页面。
var VOICE_BUFFER_CACHE_MAX = 12;
var voiceBufCache = Object.create(null);
var voiceBufCacheOrder = [];
var voiceLoadPromises = {};
var voicePlayingNodes = [];
var voiceGen = 0;

function voiceAbsUrl(fn){
  try { return new URL(VOICE_BASE + fn, location.href).href; }
  catch(e){ return VOICE_BASE + fn; }
}
function ensureVoiceAudio(){
  if(voiceAudio){ return voiceAudio; }
  try {
    voiceAudio = document.getElementById('voicePlayer');
    if(!voiceAudio){
      voiceAudio = new Audio();
      voiceAudio.setAttribute('playsinline','');
      voiceAudio.setAttribute('webkit-playsinline','');
    }
    voiceAudio.preload = 'auto';
  } catch(e){ voiceAudio = null; }
  return voiceAudio;
}
function ensureVoiceCtx(){
  var AC = window.AudioContext || window.webkitAudioContext;
  if(!AC){ return null; }
  if(!voiceCtx){
    try { voiceCtx = new AC(); } catch(e){ return null; }
  }
  if(voiceCtx.state === 'suspended'){
    try { voiceCtx.resume(); } catch(e){}
  }
  return voiceCtx;
}
function unlockVoiceAudio(){
  var ctx = ensureVoiceCtx();
  if(!ctx){ return; }
  try {
    var buf = ctx.createBuffer(1, 1, 22050);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch(e){}
}
function stopCurrentVoice(){
  voiceGen++;
  voicePlayingNodes.forEach(function(n){
    try { n.stop(); } catch(e){}
    try { n.disconnect(); } catch(e){}
  });
  voicePlayingNodes = [];
  var a = voiceAudio || document.getElementById('voicePlayer');
  if(a){
    try { a.pause(); } catch(e){}
  }
  if('speechSynthesis' in window){ try{ window.speechSynthesis.cancel(); }catch(e){} }
}
function resolveVoiceKey(prefix, move){
  if(!move){ return null; }
  var ids = [move.voiceId, move.id, move.mediaId];
  for(var i=0;i<ids.length;i++){
    if(!ids[i]){ continue; }
    var k = prefix + ids[i];
    if(VOICE_FILES[k]){ return k; }
  }
  return null;
}
function touchVoiceBuffer(key){
  var i = voiceBufCacheOrder.indexOf(key);
  if(i >= 0){ voiceBufCacheOrder.splice(i, 1); }
  voiceBufCacheOrder.push(key);
}
function cacheVoiceBuffer(key, decoded){
  voiceBufCache[key] = decoded;
  touchVoiceBuffer(key);
  while(voiceBufCacheOrder.length > VOICE_BUFFER_CACHE_MAX){
    var evicted = voiceBufCacheOrder.shift();
    delete voiceBufCache[evicted];
  }
  return decoded;
}
function loadVoiceBuffer(key){
  if(voiceBufCache[key]){
    touchVoiceBuffer(key);
    return Promise.resolve(voiceBufCache[key]);
  }
  if(voiceLoadPromises[key]){ return voiceLoadPromises[key]; }
  var fn = VOICE_FILES[key];
  if(!fn){ return Promise.reject(new Error('no-file')); }
  var url = voiceAbsUrl(fn);
  voiceLoadPromises[key] = fetch(url).then(function(res){
    if(!res.ok){ throw new Error('HTTP ' + res.status); }
    return res.arrayBuffer();
  }).then(function(ab){
    var ctx = ensureVoiceCtx();
    if(!ctx){ throw new Error('no-audiocontext'); }
    var copy = ab.slice(0);
    return new Promise(function(resolve, reject){
      var settled = false;
      function ok(v){ if(settled) return; settled = true; resolve(v); }
      function bad(e){ if(settled) return; settled = true; reject(e || new Error('decode-failed')); }
      try {
        var ret = ctx.decodeAudioData(copy, ok, bad);
        if(ret && typeof ret.then === 'function'){ ret.then(ok, bad); }
      } catch(e){ bad(e); }
    });
  }).then(function(decoded){
    delete voiceLoadPromises[key];
    return cacheVoiceBuffer(key, decoded);
  }).catch(function(err){
    delete voiceLoadPromises[key];
    throw err;
  });
  return voiceLoadPromises[key];
}
function preloadVoiceKeys(keys){
  (keys || []).forEach(function(k){
    if(k && VOICE_FILES[k]){ loadVoiceBuffer(k).catch(function(){}); }
  });
}
function playVoiceViaWebAudio(key){
  var ctx = ensureVoiceCtx();
  if(!ctx){ return Promise.reject(new Error('no-audiocontext')); }
  var myGen = voiceGen;
  return loadVoiceBuffer(key).then(function(decoded){
    if(myGen !== voiceGen){ return; }
    if(ctx.state === 'suspended'){
      return ctx.resume().then(function(){ return decoded; });
    }
    return decoded;
  }).then(function(decoded){
    if(myGen !== voiceGen || !decoded){ return; }
    var src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(ctx.destination);
    voicePlayingNodes.push(src);
    src.onended = function(){
      var i = voicePlayingNodes.indexOf(src);
      if(i >= 0){ voicePlayingNodes.splice(i, 1); }
    };
    src.start(0);
  });
}
function playVoiceViaElement(key){
  var fn = VOICE_FILES[key];
  if(!fn){ return Promise.reject(new Error('no-file')); }
  var url = voiceAbsUrl(fn);
  var a = ensureVoiceAudio();
  if(!a){ return Promise.reject(new Error('no-audio-el')); }
  var myGen = voiceGen;
  return new Promise(function(resolve, reject){
    if(myGen !== voiceGen){ resolve(); return; }
    var settled = false;
    function ok(){ if(settled) return; settled = true; cleanup(); resolve(); }
    function bad(err){ if(settled) return; settled = true; cleanup(); reject(err || new Error('audio-el-failed')); }
    function cleanup(){
      a.removeEventListener('playing', ok);
      a.removeEventListener('error', onErr);
    }
    function onErr(){
      var err = (a.error && a.error.message) ? a.error.message : 'media-error';
      bad(new Error(err));
    }
    a.addEventListener('playing', ok);
    a.addEventListener('error', onErr);
    try {
      a.muted = false;
      a.volume = 1;
      a.src = url;
      a.load();
      var p = a.play();
      if(p && p.catch){ p.catch(bad); }
    } catch(e){ bad(e); }
  });
}
function playVoiceMp3(key, opts){
  opts = opts || {};
  if(!VOICE_FILES[key]){ return false; }
  unlockVoiceAudio();
  // 跟练里先停掉上一段，避免两段叠音造成「音画不同步」
  if(!opts.overlap){ stopCurrentVoice(); }
  else if('speechSynthesis' in window){ try{ window.speechSynthesis.cancel(); }catch(e){} }
  var myGen = voiceGen;
  var showErr = opts.showError === true || (!playerOpen && opts.showError !== false);
  playVoiceViaWebAudio(key).catch(function(err1){
    console.warn('[voice] webaudio failed', err1, key);
    return playVoiceViaElement(key);
  }).catch(function(err2){
    console.warn('[voice] element failed', err2, key);
    // m4a 加载或解码失败时，不能因 playVoiceMp3 的同步 true 而吞掉兜底。
    // 仅在本次语音仍有效时朗读，避免用户切动作后播出上一动作的提示。
    if(myGen === voiceGen && opts.fallbackText){
      speakViaWebSpeech(opts.fallbackText, opts);
      return;
    }
    if(!showErr){ return; }
    var name = (err2 && err2.name) ? err2.name : ((err2 && err2.message) ? err2.message : 'unknown');
    try{ showToast && showToast('音频播放失败：' + name, 'error'); }catch(e){}
  });
  return true;
}
function prefetchUpcomingVoices(){
  var keys = ['countdown-3','switch-side'];
  for(var i = stepIndex; i < Math.min(steps.length, stepIndex + 4); i++){
    var s = steps[i];
    if(!s){ continue; }
    if(s.type === 'warmup'){ keys.push(resolveVoiceKey('warmup-', s.move)); }
    else if(s.type === 'work'){ keys.push(resolveVoiceKey('work-', s.move)); }
    else if(s.type === 'stretch'){ keys.push(resolveVoiceKey('stretch-', s.move)); }
    else if(s.type === 'break'){ keys.push('encourage-1','encourage-2','encourage-3'); }
  }
  preloadVoiceKeys(keys);
}
// 微信/iOS：尽早解锁音频会话
(function bindVoiceUnlock(){
  var once = function(){ unlockVoiceAudio(); cleanup(); };
  var cleanup = function(){
    document.removeEventListener('touchstart', once, true);
    document.removeEventListener('click', once, true);
  };
  document.addEventListener('touchstart', once, true);
  document.addEventListener('click', once, true);
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden){ unlockVoiceAudio(); }
  });
  if(typeof WeixinJSBridge !== 'undefined' && WeixinJSBridge.invoke){
    try { WeixinJSBridge.invoke('getNetworkType', {}, function(){ unlockVoiceAudio(); }); } catch(e){}
  } else {
    document.addEventListener('WeixinJSBridgeReady', function(){
      try { WeixinJSBridge.invoke('getNetworkType', {}, function(){ unlockVoiceAudio(); }); } catch(e){}
    }, false);
  }
})();

/* ---- 语音选择：仅用「御姐」一个音色 ----
   已统一为云端 TTS 预生成的 mp3，候选名单只保留 1 个作为占位。 */
var VOICE_PREFERRED = ['Tingting','婷婷'];
// 明显的男声/老年声，自动选择时避开
var VOICE_AVOID = /grandpa|grandma|eddy|reed|rocko|yunbo|yunfeng|yunxi|yunyang|yunjian|kangkang|haoxiang|云希|云扬|云健|康康|昊翔/i;
var voicesReady = false;
var voiceSpeakQueue = [];
function flushVoiceSpeakQueue(){
  if(!('speechSynthesis' in window)){ voiceSpeakQueue = []; return; }
  if(!window.speechSynthesis.getVoices().length){ return; }
  voicesReady = true;
  var q = voiceSpeakQueue.slice();
  voiceSpeakQueue = [];
  q.forEach(function(fn){ try{ fn(); }catch(e){} });
}
function onSpeechVoicesChanged(){
  flushVoiceSpeakQueue();
  renderVoiceOptions();
}
function zhVoices(){
  if(!('speechSynthesis' in window)){ return []; }
  return window.speechSynthesis.getVoices().filter(function(v){ return /^zh/i.test(v.lang); });
}
function pickVoice(){
  var zh = zhVoices();
  if(!zh.length){ return null; }
  // 1) 用户在「我的」里手动指定的语音
  var savedName = S.settings.voiceName || '';
  if(savedName){
    for(var s=0;s<zh.length;s++){ if(zh[s].name === savedName){ return zh[s]; } }
  }
  // 2) 优先名单里的年轻女声
  for(var i=0;i<VOICE_PREFERRED.length;i++){
    for(var j=0;j<zh.length;j++){ if(zh[j].name.indexOf(VOICE_PREFERRED[i]) >= 0){ return zh[j]; } }
  }
  // 3) 启发式：普通话、且避开男声/老年声
  for(var k=0;k<zh.length;k++){
    if(/^zh[-_]CN/i.test(zh[k].lang) && !VOICE_AVOID.test(zh[k].name)){ return zh[k]; }
  }
  return zh[0];
}
function speak(text, opts){
  if(!voiceEnabled()){ return; }
  opts = opts || {};
  // 1) 优先用预生成的 m4a（御姐音色，跨设备一致）
  if(opts.mp3Key){
    var voiceOpts = {};
    Object.keys(opts).forEach(function(k){ voiceOpts[k] = opts[k]; });
    voiceOpts.fallbackText = text;
    if(playVoiceMp3(opts.mp3Key, voiceOpts)){ return; }
  }
  speakViaWebSpeech(text, opts);
}
function speakViaWebSpeech(text, opts){
  // 无文本则不走 Web Speech（跟练中避免微信 TTS 失败弹窗）
  if(text == null || text === ''){ return; }
  // 系统 Web Speech（预生成 m4a 的异步失败兜底）
  if(!('speechSynthesis' in window)){ return; }
  try{
    window.speechSynthesis.cancel();  // 不要先 pause()：部分引擎 pause 后队列不恢复，语音会哑掉
    var doSpeak = function(){
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      // 默认参数：pitch 略升（年轻感）+ rate 略降（更撩人、更稳）；调用方可用 opts 覆盖
      u.rate  = (opts && typeof opts.rate  === 'number') ? opts.rate  : 0.95;
      u.pitch = (opts && typeof opts.pitch === 'number') ? opts.pitch : 1.10;
      u.volume = (opts && typeof opts.volume === 'number') ? opts.volume : 1.0;
      var v = pickVoice();
      if(v){ u.voice = v; }
      window.speechSynthesis.speak(u);
    };
    if(voicesReady || window.speechSynthesis.getVoices().length > 0){
      voicesReady = true;
      doSpeak();
    } else {
      voiceSpeakQueue.push(doSpeak);
    }
  }catch(e){}
}
var ENCOURAGE = ['坚持住，就快完成了','保持呼吸，你做得很稳','慢一点没关系，稳住就是胜利','每一次坚持，都在帮你保住肌肉','很好，注意动作质量，不抢时间'];
function speakEncourage(){
  var n = Math.floor(Math.random() * ENCOURAGE.length);
  speak(ENCOURAGE[n], { mp3Key: 'encourage-' + (n + 1) });
}
function announceStep(step){
  if(!step){ return; }
  var key = null, text = '';
  if(step.type === 'warmup'){
    key = resolveVoiceKey('warmup-', step.move);
    text = '热身，' + step.move.name + '。' + (step.move.cue || '保持动作稳定。');
  }
  else if(step.type === 'work'){
    key = resolveVoiceKey('work-', step.move);
    text = '接下来，' + step.move.name + '。' + (step.move.cue || '保持动作稳定。');
  }
  else if(step.type === 'stretch'){
    key = resolveVoiceKey('stretch-', step.move);
    text = '拉伸，' + step.move.name + '，拉到' + step.move.target + '。' + (step.move.cue || '自然呼吸。');
  }
  else if(step.type === 'break'){ speakEncourage(); return; }
  else if(step.type === 'rest'){
    // 休息只保留提示音；微信里 Web Speech 不稳定，且无对应预生成音频
    return;
  }
  if(key){ speak(text, { mp3Key: key }); }
  else if(text){ speak(text); }
}

/* ---- 屏幕常亮 ---- */
var wakeLock = null;
function requestWakeLock(){
  if(!('wakeLock' in navigator)){ return; }
  navigator.wakeLock.request('screen').then(function(l){ wakeLock = l; }).catch(function(){});
}
function releaseWakeLock(){ if(wakeLock){ try{ wakeLock.release(); }catch(e){} wakeLock = null; } }

/* ============================================================
   跟练播放器（单一全屏视图）
   ============================================================ */
var steps = [], stepIndex = 0, left = 0, totalDuration = 0, running = false, inCountdown = false, timer = null, tickRAF = 0, tickBase = 0, sideChanged = false;
var sessionElapsed = 0, workElapsed = 0, stretchElapsed = 0, stepElapsedCounted = 0, skippedWork = 0;
var completedMoveIds = {}, completedStretchIds = {}, sessionStarted = false, sessionLogged = false;
var cdSpoken = false, lastLeft = -1;
var playerOpen = false;
var sessionLifts = {};
var plLogMove = null;
var plLogRound = 0;
var plLogLevel = '';

function buildSteps(){
  var cfg = presets[S.settings.preset] || presets.starter;
  steps = [];
  if(S.settings.routine === 'stretch'){
    stretchSets.stretch.forEach(function(s){ steps.push({ type:'stretch', round:0, sec:s.sec, move:s }); });
  } else {
    warmupMoves.forEach(function(m){ steps.push({ type:'warmup', round:0, sec:m.sec, move:m }); });
    for(var r=1; r<=cfg.rounds; r++){
      moves.forEach(function(m, i){
        steps.push({ type:'work', round:r, sec:cfg.work, move:m });
        if(i < moves.length-1){ steps.push({ type:'rest', round:r, sec:cfg.rest, next:moves[i+1] }); }
      });
      if(r < cfg.rounds){ steps.push({ type:'break', round:r, sec:cfg.roundBreak, next:moves[0] }); }
    }
    (stretchSets[S.settings.routine] || []).forEach(function(s){ steps.push({ type:'stretch', round:0, sec:s.sec, move:s }); });
  }
  totalDuration = steps.reduce(function(s,x){ return s + x.sec; }, 0);
}
function resetSessionStats(){
  sessionElapsed = 0; workElapsed = 0; stretchElapsed = 0; stepElapsedCounted = 0; skippedWork = 0;
  completedMoveIds = {}; completedStretchIds = {}; sessionStarted = false; sessionLogged = false;
  sessionLifts = {};
  plLogMove = null; plLogRound = 0; plLogLevel = '';
}
function captureStepProgress(reason){
  var step = steps[stepIndex];
  if(!step){ return; }
  var elapsed = Math.max(0, Math.min(step.sec, step.sec - left));
  var delta = Math.max(0, elapsed - stepElapsedCounted);
  sessionElapsed += delta;
  if(step.type === 'work'){ workElapsed += delta; }
  if(step.type === 'stretch'){ stretchElapsed += delta; }
  stepElapsedCounted = elapsed;
  if(step.type === 'work' && (reason === 'natural' || elapsed >= step.sec*0.5)){ completedMoveIds[step.move.id] = true; }
  if(step.type === 'stretch' && (reason === 'natural' || elapsed >= step.sec*0.5)){ completedStretchIds[step.move.id] = true; }
  if(step.type === 'work' && reason === 'skip'){ skippedWork++; }
  if(step.type === 'work' && (reason === 'natural' || reason === 'stop' || (reason === 'skip' && elapsed >= step.sec * 0.5))){
    commitCurrentLift(step.move, step.round);
  }
}
function readPlLogSet(){
  var kind = plLogMove ? liftKind(plLogMove) : null;
  if(!kind){ return null; }
  if(kind === 'load'){
    return normalizeLiftSet({
      kg: $('plKg') ? $('plKg').value : 0,
      reps: $('plReps') ? $('plReps').value : 0
    });
  }
  if(!plLogLevel){ return null; }
  return normalizeLiftSet({ level: plLogLevel });
}
function commitCurrentLift(move, round){
  if(!move){ return; }
  var key = move.id + ':' + (round || 0);
  if(sessionLifts[key]){ return; }
  var set = readPlLogSet();
  if(!set){ return; }
  sessionLifts[key] = set;
  if(!sessionLifts[move.id]){ sessionLifts[move.id] = []; }
  sessionLifts[move.id].push(set);
  mutateState(function(){ upsertLiftRec(move.id, set); });
}
function bindPlLog(move, round){
  var box = $('plLog');
  if(!box){ return; }
  var kind = liftKind(move);
  if(!kind || !move){
    box.hidden = true;
    plLogMove = null;
    return;
  }
  plLogMove = move;
  plLogRound = round || 0;
  box.hidden = false;
  var rec = getLift(move.id);
  $('plLogLast').textContent = formatLiftLine(move, rec);
  var load = $('plLogLoad');
  var levels = $('plLogLevels');
  if(kind === 'load'){
    load.hidden = false;
    levels.hidden = true;
    var prev = sessionLifts[move.id + ':' + plLogRound];
    $('plKg').value = prev ? (prev.kg || '') : (rec && rec.kg ? rec.kg : '');
    $('plReps').value = prev ? (prev.reps || '') : (rec && rec.reps ? rec.reps : '');
    var next = rec && rec.kg ? suggestNextKg(rec.kg, sessionLifts[move.id] || (rec.kg ? [{reps: rec.reps, kg: rec.kg}] : []), rec.reps || 10) : 0;
    $('plLogHint').textContent = next && rec && next > rec.kg
      ? ('这组能做到 ' + (rec.reps || 10) + ' 次的话，下次可试 ' + next + ' kg')
      : '做完这一组会自动记下';
  } else {
    load.hidden = true;
    levels.hidden = false;
    var prevLv = sessionLifts[move.id + ':' + plLogRound];
    plLogLevel = (prevLv && prevLv.level) || (rec && rec.level) || liftLevels(kind)[0].id;
    renderLevelChips(levels, kind, plLogLevel, function(id){ plLogLevel = id; });
    var nxt = nextLevelId(kind, plLogLevel);
    $('plLogHint').textContent = (nxt && nxt !== plLogLevel)
      ? ('稳住了下次可试：' + liftLevelName(kind, nxt))
      : '点一下难度，做完自动记下';
  }
}
function renderLevelChips(el, kind, selected, onPick){
  if(!el){ return; }
  el.innerHTML = '';
  liftLevels(kind).forEach(function(lv){
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = lv.name;
    b.className = lv.id === selected ? 'on' : '';
    b.addEventListener('click', function(){
      onPick(lv.id);
      Array.prototype.forEach.call(el.querySelectorAll('button'), function(x){ x.className = ''; });
      b.className = 'on';
    });
    el.appendChild(b);
  });
}
function elapsedBefore(i){ var s=0; for(var k=0;k<i;k++){ s+=steps[k].sec; } return s; }
function updateProgress(){
  var step = steps[stepIndex];
  var done = elapsedBefore(stepIndex) + (step ? (step.sec - left) : 0);
  var pct = totalDuration ? Math.min(100, done/totalDuration*100) : 0;
  $('plBar').style.width = pct + '%';
}
function setDemoVisible(visible){
  $('plDemoWrap').hidden = !visible;
  if(!visible){ stopFrameAnimation(); currentDemoUrl = ''; }
}
function renderDemo(move, badge, animate){
  setDemoVisible(true);
  stopFrameAnimation();
  preloadMove(move, !!animate);
  var useMotion = !!animate && motionOn();
  var frame = 0;
  var show = function(){
    var src = move.frames && move.frames.length ? imagePath(move,false,frame) : imagePath(move,useMotion);
    currentDemoUrl = src;
    swapImage($('plDemo'), src, move.name);
  };
  show();
  if(useMotion && move.frames && move.frames.length > 1){
    demoFrameTimer = window.setInterval(function(){ frame = (frame+1) % move.frames.length; show(); }, 1300);
  }
  $('plBadge').textContent = badge || '示范';
}
function primaryType(){ return S.settings.routine === 'stretch' ? 'stretch' : 'work'; }
function renderDots(){
  var box = $('plDots'); box.innerHTML = '';
  var pt = primaryType();
  var idx = [];
  steps.forEach(function(s,i){ if(s.type===pt){ idx.push(i); } });
  var cur = -1;
  idx.forEach(function(i,wi){ if(i <= stepIndex){ cur = wi; } });
  var onNow = steps[stepIndex] && steps[stepIndex].type === pt;
  idx.forEach(function(i,wi){
    var d = document.createElement('span');
    d.className = 'd' + (wi < cur ? ' done' : (wi === cur && onNow ? ' now' : ''));
    box.appendChild(d);
  });
}
function renderNext(){
  var el = $('plNext');
  var m = null;
  for(var i = stepIndex+1; i < steps.length; i++){
    var s = steps[i];
    if(s.type === 'rest' || s.type === 'break'){ m = s.next; break; }
    if(s.move){ m = s.move; break; }
  }
  if(m && !m.noMedia){
    preloadMove(m, false);
    el.innerHTML = '<img src="' + imagePath(m,false) + '" alt=""><span>下一个 · <b>' + escapeHtml(m.name) + '</b></span>';
  } else if(m){
    el.innerHTML = '<span>下一个 · <b>' + escapeHtml(m.name) + '</b></span>';
  } else {
    el.innerHTML = '<span>快完成了 · <b>坚持住 💪</b></span>';
  }
}
function renderStep(){
  var step = steps[stepIndex];
  if(!step){ finishWorkout(false); return; }
  $('plClock').textContent = String(left);
  sideChanged = false;
  var rounds = (presets[S.settings.preset]||presets.starter).rounds;
  var phase = $('plPhase');
  if(step.type === 'warmup'){
    phase.textContent = '热身'; phase.className = 'pl-phase warm';
    $('plRound').textContent = '先热起来';
    $('plClock').className = 'pl-clock num';
    $('plMv').textContent = step.move.name;
    renderDemo(step.move, '热身', true);
    $('plCue').innerHTML = '<b>' + escapeHtml(step.move.name) + ' · ' + escapeHtml(step.move.target) + '</b>' + escapeHtml(step.move.cue);
  } else if(step.type === 'work'){
    phase.textContent = '训练中'; phase.className = 'pl-phase';
    $('plRound').textContent = '第 ' + step.round + ' / ' + rounds + ' 轮';
    $('plClock').className = 'pl-clock num';
    $('plMv').textContent = step.move.name;
    renderDemo(step.move, step.move.staticOnly ? '静态姿势参考' : (motionOn() ? (step.move.frames ? '起止姿势参考' : '跟随节奏') : '静态参考'), true);
    var cue = '<b>' + escapeHtml(step.move.name) + ' · 主练 ' + escapeHtml(step.move.primary || step.move.area) + '</b>' + escapeHtml(step.move.cue);
    if(step.move.sideMode === 'half'){ cue += ' 过半会提示换侧。'; }
    else if(step.move.sideMode === 'alternate'){ cue += ' 左右交替。'; }
    $('plCue').innerHTML = cue;
  } else if(step.type === 'rest'){
    phase.textContent = '换动作'; phase.className = 'pl-phase rest';
    $('plRound').textContent = '第 ' + step.round + ' 轮';
    $('plClock').className = 'pl-clock num rest';
    $('plMv').textContent = '下一个：' + step.next.name;
    $('plCue').innerHTML = '<b>利用休息摆好起始位</b>先看图，再调整垫子或站位。';
    renderDemo(step.next, '下一动作', false);
    preloadMove(step.next, true);
  } else if(step.type === 'break'){
    phase.textContent = '轮间休息'; phase.className = 'pl-phase rest';
    $('plRound').textContent = '下一轮 ' + (step.round+1);
    $('plClock').className = 'pl-clock num rest';
    $('plMv').textContent = '恢复呼吸';
    $('plCue').innerHTML = '<b>恢复即可</b>小口补水；若不适，不必继续下一轮。';
    renderDemo(step.next, '下一轮', false);
    preloadMove(step.next, true);
  } else if(step.type === 'stretch'){
    phase.textContent = '拉伸'; phase.className = 'pl-phase stretch';
    $('plRound').textContent = S.settings.routine === 'stretch' ? '全身拉伸' : '练后放松';
    $('plClock').className = 'pl-clock num rest';
    $('plMv').textContent = step.move.name;
    if(step.move.noMedia){ setDemoVisible(false); }
    else { renderDemo(step.move, '拉伸 · ' + step.move.position, true); }
    $('plCue').innerHTML = '<b>' + escapeHtml(step.move.name) + ' · 拉到 ' + escapeHtml(step.move.target) + '（' + escapeHtml(step.move.position) + '）</b>' + escapeHtml(step.move.cue);
  }
  for(var ni=stepIndex+1; ni<steps.length; ni++){ var ns=steps[ni]; if(ns.move && !ns.move.noMedia){ preloadMove(ns.move, ns.type==='work'); break; } }
  updateProgress();
  renderDots();
  renderNext();
  if(step.type === 'work'){ bindPlLog(step.move, step.round); }
  else if(step.type === 'rest' || step.type === 'break'){
    var prev = null;
    for(var pi = stepIndex - 1; pi >= 0; pi--){
      if(steps[pi].type === 'work'){ prev = steps[pi]; break; }
    }
    if(prev){ bindPlLog(prev.move, prev.round); }
    else if($('plLog')){ $('plLog').hidden = true; plLogMove = null; }
  } else if($('plLog')){ $('plLog').hidden = true; plLogMove = null; }
}
function tick(){
  if(!running || inCountdown){ return; }
  var step = steps[stepIndex];
  if(!step){ return; }
  var realLeft = step.sec - Math.floor((Date.now() - tickBase)/1000);
  if(step.type === 'work' && step.move.sideMode === 'half' && !sideChanged && realLeft <= Math.ceil(step.sec/2)){
    sideChanged = true;
    $('plCue').innerHTML = '<b>现在换侧</b>先稳住身体，再开始另一侧。';
    $('plBadge').textContent = '换另一侧';
    cueShort(); speak('换另一侧', { mp3Key: 'switch-side' });
  }
  if(realLeft <= 0){ left = 0; captureStepProgress('natural'); advance(1,'natural',true); return; }
  left = realLeft;
  if(left !== lastLeft){          // 每帧写 DOM 无意义，秒数变化时再更新
    lastLeft = left;
    $('plClock').textContent = String(left);
    updateProgress();
    if(left <= 3 && left >= 1){
      cueShort();
      if(left === 3 && !cdSpoken){ cdSpoken = true; speak('3，2，1', { mp3Key: 'countdown-3' }); }
    }
  }
  tickRAF = window.requestAnimationFrame(tick);
}
function startTick(){ tickRAF = window.requestAnimationFrame(tick); }
function stopTick(){ if(tickRAF){ window.cancelAnimationFrame(tickRAF); tickRAF = 0; } }
function enterStep(){
  var step = steps[stepIndex];
  if(!step){ finishWorkout(false); return; }
  left = step.sec; tickBase = Date.now(); sideChanged = false; cdSpoken = false; lastLeft = -1; stepElapsedCounted = 0;
  renderStep();
  prefetchUpcomingVoices();
  if(step.type === 'work'){ cueStart(); } else { cueRest(); }
  announceStep(step);
}
function advance(dir, reason, alreadyCaptured){
  if(!alreadyCaptured){ captureStepProgress(reason || (dir > 0 ? 'skip' : 'back')); }
  var next = stepIndex + dir;
  if(next >= steps.length){ finishWorkout(false); return; }
  if(next < 0){ next = 0; }
  stepIndex = next; enterStep();
}
function runCountdown(){
  inCountdown = true;
  var n = 3;
  setDemoVisible(false);
  $('plPhase').textContent = '准备开始'; $('plPhase').className = 'pl-phase warm';
  $('plClock').className = 'pl-clock num cd';
  $('plClock').textContent = String(n);
  $('plMv').textContent = '马上开始';
  $('plRound').textContent = '先站稳';
  $('plCue').innerHTML = '<b>准备</b>确认脚下没有障碍，保持自然呼吸；倒数后先从轻松热身开始。';
  $('plDots').innerHTML = ''; $('plNext').innerHTML = '';
  if($('plLog')){ $('plLog').hidden = true; plLogMove = null; }
  unlockVoiceAudio();
  // 只预取临近步骤。一次性解码整节课会让移动端短时间常驻大量 PCM。
  preloadVoiceKeys(['countdown-start','countdown-3','switch-side']);
  cueShort(); speak('3，2，1，开始', { mp3Key: 'countdown-start' });
  timer = window.setInterval(function(){
    n--;
    if(n <= 0){
      window.clearInterval(timer); timer = null;
      inCountdown = false;
      enterStep();
      startTick();
      return;
    }
    $('plClock').textContent = String(n);
    cueShort();
  }, 1000);
}
var playerReturnFocus = null;
function openPlayer(){
  playerOpen = true;
  playerReturnFocus = document.activeElement;
  var pl = $('player');
  pl.classList.add('open');
  pl.setAttribute('aria-hidden','false');
  pl.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
}
function closePlayer(){
  playerOpen = false;
  var pl = $('player');
  pl.classList.remove('open');
  pl.setAttribute('aria-hidden','true');
  pl.setAttribute('inert','');
  document.body.style.overflow = '';
  if(playerReturnFocus && playerReturnFocus.focus){
    try{ playerReturnFocus.focus(); }catch(e){}
  }
  playerReturnFocus = null;
}
function startWorkout(){
  if(running){ return; }
  if(getReadiness() === 'red' && S.settings.routine !== 'stretch'){
    showToast('今天先不训练：优先补液并处理症状；严重或持续请联系医疗人员', 'error');
    return;
  }
  if(!steps.length || stepIndex >= steps.length){ resetWorkout(); }
  ensureAudio();
  unlockVoiceAudio();
  sessionStarted = true;
  running = true;
  $('plPause').textContent = '⏸';
  $('plPrev').disabled = false; $('plSkip').disabled = false;
  requestWakeLock();
  openPlayer();
  if(left < (steps[stepIndex] && steps[stepIndex].sec) && stepElapsedCounted > 0){
    tickBase = Date.now() - ((steps[stepIndex].sec - left) * 1000);
    renderStep();
    startTick();
  } else { runCountdown(); }
}
function pauseWorkout(){
  if(!running){ startWorkout(); return; }
  captureStepProgress('pause');
  running = false;
  stopCurrentVoice();
  if(timer){ window.clearInterval(timer); timer = null; } stopTick();
  inCountdown = false;
  $('plPause').textContent = '▶';
  $('plPhase').textContent = '已暂停';
  releaseWakeLock();
}
function resetWorkout(){
  running = false; inCountdown = false;
  if(timer){ window.clearInterval(timer); timer = null; } stopTick();
  buildSteps();
  resetSessionStats();
  stepIndex = 0; left = steps.length ? steps[0].sec : 0; tickBase = 0;
  $('plPause').textContent = '⏸';
  updateProgress();
}
function finishWorkout(early){
  if(sessionLogged){ return; }
  captureStepProgress(early ? 'stop' : 'natural');
  running = false; inCountdown = false;
  if(timer){ window.clearInterval(timer); timer = null; } stopTick();
  releaseWakeLock();
  left = 0; stepIndex = steps.length; updateProgress();
  cueFinish();
  var isStretch = S.settings.routine === 'stretch';
  var effectiveWork = isStretch ? stretchElapsed : workElapsed;
  var mvCount = isStretch ? Object.keys(completedStretchIds).length : Object.keys(completedMoveIds).length;
  var shouldLog = effectiveWork >= 60;
  var didLog = false;
  if(shouldLog){
    didLog = addTraining({
      status: early ? 'stopped' : (skippedWork > 0 ? 'partial' : 'completed'),
      routine:S.settings.routine, preset:S.settings.preset, readiness:getReadiness(),
      actualSeconds:sessionElapsed, plannedSeconds:totalDuration, workSeconds:effectiveWork,
      completedMoves:mvCount, skippedMoves:skippedWork
    });
    if(didLog){ sessionLogged = true; }
  }
  var mins = (Math.round(sessionElapsed/6)/10);
  var unit = isStretch ? ' 个拉伸' : ' 个动作';
  $('plDoneTitle').textContent = early ? '本次已提前结束' : (isStretch ? '拉伸完成 🎉' : '训练完成 🎉');
  $('plDoneSub').textContent = '实际 ' + mins + ' 分钟 · 完成 ' + mvCount + unit +
    (didLog ? ' · 已记录' : (shouldLog ? ' · 保存失败' : ' · 不足1分钟未计入'));
  var liftBox = $('plDoneLifts');
  if(liftBox){
    var lines = [];
    Object.keys(sessionLifts).forEach(function(k){
      if(k.indexOf(':') >= 0){ return; }
      var mv = moveById(k);
      var sets = sessionLifts[k] || [];
      if(!mv || !sets.length){ return; }
      var kind = liftKind(mv);
      if(kind === 'load'){
        lines.push(mv.name + ' · ' + sets.map(function(s){ return (s.kg || 0) + 'kg×' + (s.reps || 0); }).join('、'));
        var rec = getLift(k);
        var nxt = rec ? suggestNextKg(rec.kg, sets, rec.reps || 10) : 0;
        if(nxt && rec && nxt > rec.kg){ lines[lines.length - 1] += ' → 下次 ' + nxt + ' kg'; }
      } else if(sets[0].level){
        lines.push(mv.name + ' · ' + liftLevelName(kind, sets[sets.length - 1].level));
      }
    });
    liftBox.innerHTML = lines.length ? lines.map(function(t){ return '<div>' + escapeHtml(t) + '</div>'; }).join('') : '';
  }
  $('plDone').classList.add('show');
  $('plDone').setAttribute('aria-hidden','false');
  // 用预生成 m4a；加载失败时带同一句 Web Speech 兜底。
  var doneKey = didLog ? (early ? 'finish-early' : (isStretch ? 'finish-stretch' : 'finish-done')) : null;
  var doneText = early ? '本次已结束，已经按实际完成量记录。' : (isStretch ? '拉伸完成，放松一下。' : '训练完成，干得漂亮！记得补充蛋白质。');
  if(doneKey){ speak(doneText, { mp3Key: doneKey }); }
  else { speak(shouldLog ? '本次达到记录门槛，但保存失败。' : '实际不足一分钟，本次没有计入。'); }
}
$('plPause').addEventListener('click', function(){ pauseWorkout(); });
$('plSkip').addEventListener('click', function(){ if(running && !inCountdown){ advance(1,'skip'); } });
$('plPrev').addEventListener('click', function(){ if(running && !inCountdown && stepIndex > 0){ advance(-1,'back'); } });
$('plEnd').addEventListener('click', function(){
  showConfirm('结束本次并按实际完成量记录？不足 1 分钟不会计为训练。', function(){ finishWorkout(true); }, { title:'结束训练', okText:'结束并记录', danger:true });
});
$('plExit').addEventListener('click', function(){
  if(running){ pauseWorkout(); }
  closePlayer();
  if(sessionStarted && !sessionLogged){ showToast('已暂停，不会在后台计时；可继续或结束并记录', ''); }
});
$('plDoneBtn').addEventListener('click', function(){
  $('plDone').classList.remove('show');
  $('plDone').setAttribute('aria-hidden','true');
  closePlayer();
  resetWorkout();
  goPage('today');
});
document.addEventListener('visibilitychange', function(){
  if(document.hidden && running && !inCountdown){ pauseWorkout(); }
});
/* ---- 防止训练中误关页面导致进度丢失 ---- */
window.addEventListener('beforeunload', function(e){
  if(running && sessionStarted && !sessionLogged){
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

/* ============================================================
   拍照识别（BYOK · 同源 relay）
   ============================================================ */
var photoModal = $('photoModal');
var currentImageData = null, currentImageMime = 'image/jpeg';
var activePhotoController = null, photoRequestId = 0;
var currentAiParsed = null; // 当前 AI 识别结果（含三大营养素+热量），供展示/记录复用
function normalizeApiKey(k){
  return String(k || '').trim().replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
}
function getApiKey(){ try{ return normalizeApiKey(window.localStorage.getItem(APIKEY_STORAGE) || ''); }catch(e){ return ''; } }
function validApiKey(k){
  k = normalizeApiKey(k);
  return !k || (k.length >= 16 && k.length <= 256 && /^sk-[^\s]+$/i.test(k));
}
function setApiKey(k){
  k = normalizeApiKey(k);
  if(!validApiKey(k)){ return false; }
  try{
    if(k){ window.localStorage.setItem(APIKEY_STORAGE, k); } else { window.localStorage.removeItem(APIKEY_STORAGE); }
    return true;
  }catch(e){ return false; }
}
function canUsePhotoAi(){ var k = getApiKey(); return Boolean(k) && validApiKey(k); }
function refreshPhotoKeyGate(){
  var ready = canUsePhotoAi();
  $('photoKeyGate').classList.toggle('show', !ready);
  if(ready){ $('photoKeyInput').value = ''; }
}
$('photoKeySave').addEventListener('click', function(){
  var key = $('photoKeyInput').value.trim();
  if(!key){ showToast('请输入以 sk- 开头的 Key', 'error'); return; }
  if(!setApiKey(key)){ showToast('Key 格式不正确，应以 sk- 开头且不含空格', 'error'); return; }
  refreshPhotoKeyGate(); renderSettings();
  $('aiError').classList.remove('show');
  showToast('识别已就绪，可以拍照', 'success');
});
$('photoKeyInput').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); $('photoKeySave').click(); } });

function openPhotoModal(){
  resetPhotoState();
  photoModal.classList.add('open');
  photoModal.setAttribute('aria-hidden','false');
  refreshPhotoKeyGate();
}
function closePhotoModal(){
  cancelPhotoRequest();
  photoModal.classList.remove('open');
  photoModal.setAttribute('aria-hidden','true');
}
function cancelPhotoRequest(){
  photoRequestId++;
  if(activePhotoController){ try{ activePhotoController.abort(); }catch(e){} activePhotoController = null; }
}
function resetPhotoState(){
  cancelPhotoRequest();
  currentImageData = null;
  currentAiParsed = null;
  $('snapPreview').classList.remove('show');
  $('snapDrop').style.display = '';
  $('aiLoading').classList.remove('show');
  $('aiError').classList.remove('show');
  $('aiResult').classList.remove('show');
  $('snapFallback').style.display = 'none';
  $('snapFile').value = '';
}
function openManualProtein(){
  showPrompt('输入这餐的蛋白质克数（g）：', '', function(g){
    if(g === '' || g == null){ return; }
    var n = Number(g);
    if(!Number.isFinite(n) || n <= 0 || n > 500){ showToast('请输入 0–500 之间的数字', 'error'); return; }
    showPrompt('这餐吃了什么？', '手动记录', function(food){
      addProtein(n, food || '手动记录', 'manual');
    }, { title:'食物名称', okText:'记入' });
  }, { title:'手动记录蛋白', okText:'下一步', type:'number', placeholder:'例如 25' });
}
$('btnPhoto').addEventListener('click', openPhotoModal);
$('btnManualProtein').addEventListener('click', openManualProtein);
$('btnWater200').addEventListener('click', function(){ addWater(200); });
$('btnWater350').addEventListener('click', function(){ addWater(350); });
$('btnLogWeight').addEventListener('click', function(){
  var last = latestWeight();
  showPrompt('记下现在的体重（kg）：', last ? String(last.kg) : '', function(v){
    if(v === '' || v == null){ return; }
    var n = Number(v);
    if(!Number.isFinite(n) || n < WEIGHT_KG_MIN || n > WEIGHT_KG_MAX){
      showToast('请输入 ' + WEIGHT_KG_MIN + '–' + WEIGHT_KG_MAX + ' 之间的数字', 'error'); return;
    }
    addWeight(n);
  }, { title:'记体重', okText:'记下', type:'number', placeholder:'例如 80' });
});
$('photoClose').addEventListener('click', closePhotoModal);
$('photoBackdrop').addEventListener('click', closePhotoModal);
$('snapDrop').addEventListener('click', function(){ $('snapFile').click(); });
$('snapDrop').addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('snapFile').click(); } });
$('snapFile').addEventListener('change', function(e){
  var f = e.target.files && e.target.files[0];
  if(f){ onImageChosen(f); }
});
$('aiRetry').addEventListener('click', function(){ resetPhotoState(); $('snapFile').click(); });
$('snapManual').addEventListener('click', function(){
  closePhotoModal();
  openManualProtein();
});
$('aiConfirm').addEventListener('click', function(){
  var g = Number($('aiAdjust').value);
  if(!Number.isFinite(g) || g <= 0 || g > 500){ showToast('蛋白质应为 0–500 g 之间的有效数值', 'error'); return; }
  var p = currentAiParsed || {};
  var base = Number(p.protein) || 0;
  var scale = base > 0 ? (g / base) : 1;
  var extras = {
    carbs: Math.round((Number(p.carbs)||0)*scale*10)/10,
    fat: Math.round((Number(p.fat)||0)*scale*10)/10,
    calories: Math.round((Number(p.calories)||0)*scale)
  };
  addProtein(g, $('aiFood').textContent || '拍照记录', 'photo', extras);
  closePhotoModal();
});
$('aiAdjust').addEventListener('input', renderAiMacros);

function compressImage(file, callback, requestId){
  var img = new Image();
  var url = URL.createObjectURL(file);
  img.onload = function(){
    URL.revokeObjectURL(url);
    if(requestId !== photoRequestId || !photoModal.classList.contains('open')){ return; }
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, MAX_DIM / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w*scale); canvas.height = Math.round(h*scale);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    callback(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'image/jpeg');
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    if(requestId !== photoRequestId || !photoModal.classList.contains('open')){ return; }
    $('aiError').textContent = '无法安全读取并重编码这张图片；原文件没有上传。请换一张照片或改用手动记录。';
    $('aiError').classList.add('show');
    $('snapFallback').style.display = '';
  };
  img.src = url;
}
function onImageChosen(file){
  cancelPhotoRequest();
  currentImageData = null;
  $('aiResult').classList.remove('show');
  if(!file){ return; }
  if(!/^image\//.test(file.type)){ showToast('请选择图片文件', 'error'); return; }
  if(file.size > 10*1024*1024){ showToast('图片过大（>10MB）', 'error'); return; }
  if(!canUsePhotoAi()){
    $('aiError').textContent = '请先保存通义千问 Key；这张照片没有上传。也可以改用手动记录。';
    $('aiError').classList.add('show');
    $('snapFallback').style.display = '';
    refreshPhotoKeyGate();
    return;
  }
  $('aiError').classList.remove('show');
  $('snapFallback').style.display = 'none';
  var requestId = photoRequestId;
  compressImage(file, function(dataUrl, mime){
    if(requestId !== photoRequestId || !photoModal.classList.contains('open')){ return; }
    currentImageMime = mime;
    $('snapImg').src = dataUrl;
    $('snapPreview').classList.add('show');
    $('snapDrop').style.display = 'none';
    var comma = dataUrl.indexOf(',');
    currentImageData = comma >= 0 ? dataUrl.slice(comma+1) : dataUrl;
    callQwen(requestId);
  }, requestId);
}
function qwenFetch(payload, signal){
  return window.fetch(QWEN_RELAY, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'X-DashScope-Key':getApiKey() },
    body:JSON.stringify(payload),
    signal:signal
  });
}
function callQwen(requestId){
  if(!currentImageData || requestId !== photoRequestId || !photoModal.classList.contains('open')){ return; }
  $('aiLoading').classList.add('show');
  $('aiError').classList.remove('show');
  $('aiResult').classList.remove('show');
  var body = {
    model: getPhotoModel(),
    messages: [{ role:'user', content:[
      { type:'image_url', image_url:{ url:'data:' + currentImageMime + ';base64,' + currentImageData } },
      { type:'text', text:
        '你是专业营养助手。识别图片中所有食物，逐项估算营养（蛋白质/碳水/脂肪/热量）。\n' +
        '只返回一个 JSON 对象，不要任何解释或代码块标记。格式：\n' +
        '{"food":"食物总称（中文）","items":[{"name":"食物名","amount":"份量","protein":数字,"carbs":数字,"fat":数字,"calories":数字}],"protein":总蛋白数字,"carbs":总碳水数字,"fat":总脂肪数字,"calories":总热量数字,"note":"估算依据，一句话"}\n' +
        '规则：1. protein/carbs/fat 单位克(g)，calories 单位千卡(kcal)，均为数字；2. 各总量 = items 对应项之和；3. 无食物返回 {"food":"","items":[],"protein":0,"carbs":0,"fat":0,"calories":0,"note":"未识别到食物"}；' +
        '4. 参考：鸡蛋~6g蛋白/个，熟鸡胸~31g蛋白/100g，米饭~28g碳水/100g，牛奶~3.3g蛋白/100mL，豆腐~8g蛋白/100g，酸奶~3-5g蛋白/100g，蛋白粉~20-25g蛋白/勺；' +
        '5. 考虑烹饪方式（油炸/裹粉/红烧会明显增加脂肪与热量），在 note 说明；纯汤汁酱汁忽略。'
      }
    ]}]
  };
  var controller = new AbortController();
  activePhotoController = controller;
  var timeoutId = window.setTimeout(function(){ controller.abort(); }, 15000);
  qwenFetch(body, controller.signal).then(function(res){
    window.clearTimeout(timeoutId);
    if(requestId !== photoRequestId || !photoModal.classList.contains('open')){ throw { stale:true }; }
    return res.text().then(function(txt){
      var data; try{ data = JSON.parse(txt); }catch(e){ throw { status: res.status, raw: txt }; }
      if(!res.ok){ throw { status: res.status, data: data }; }
      return data;
    });
  }).then(function(data){
    if(requestId !== photoRequestId || !photoModal.classList.contains('open')){ return; }
    if(activePhotoController === controller){ activePhotoController = null; }
    $('aiLoading').classList.remove('show');
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    var parsed = normalizeAiResult(parseQwenContent(content));
    if(!parsed || !parsed.food || !(Number(parsed.protein) > 0)){
      $('aiError').textContent = (parsed && parsed.note) ? 'AI：' + parsed.note : '未能识别食物，请换张清晰照片或手动输入。';
      $('aiError').classList.add('show');
      $('snapFallback').style.display = '';
      return;
    }
    showAiResult(parsed);
  }).catch(function(err){
    window.clearTimeout(timeoutId);
    if(activePhotoController === controller){ activePhotoController = null; }
    if((err && err.stale) || requestId !== photoRequestId || !photoModal.classList.contains('open')){ return; }
    $('aiLoading').classList.remove('show');
    $('snapFallback').style.display = '';
    var msg;
    if(err && err.name === 'AbortError'){ msg = '识别超时（>15s）：换张光线好、食物少的照片再试，或改用手动记录'; }
    else if(err && err.status === 401){
      var em = err.data && err.data.error;
      if(em && em.code === 'relay_key_format'){
        msg = 'Key 格式未通过校验：请在「我的」重新完整粘贴（sk- 开头、无空格换行）';
      } else if(em && (em.code === 'invalid_api_key' || /api key/i.test(String(em.message || '')))){
        if(isTokenPlanKey(getApiKey())){
          msg = 'Token Plan（sk-sp-）Key 被拒：请确认是 Token 控制台生成的 Key，且套餐含视觉能力；普通 sk- Key 请改用百炼按量 Key';
        } else {
          msg = '通义返回 Key 无效或过期：请确认 Key 未禁用；国际控制台 Key 会自动走国际接口';
        }
      } else { msg = 'API Key 无效或已过期，请在「我的」重新设置'; }
    }
    else if(err && err.status === 403){ msg = '当前 Key 没有 qwen-vl-max 视觉模型权限'; }
    else if(err && err.status === 429){ msg = '调用过频或额度不足'; }
    else if(err && err.status === 413){ msg = '图片请求过大，请换一张更小或更简单的照片'; }
    else if(err && (err.status === 404 || err.status === 405)){ msg = '本站拍照接口尚未正确发布，请刷新后重试'; }
    else if(err && err.status === 501){ msg = '当前服务不支持拍照识别（静态文件服务不支持 POST），请启动完整后端服务'; }
    else if(err && (err.status === 502 || err.status === 503)){ msg = '本站拍照接口暂时无法连接识别服务，请稍后重试'; }
    else if(err && err.status === 504){ msg = '识别服务超时，请稍后重试或改用手动记录'; }
    else if(err && err.data && err.data.error && err.data.error.message){ msg = String(err.data.error.message).replace(/\s+/g,' ').slice(0,120); }
    else if(err && err.raw){ msg = '识别接口返回异常（HTTP ' + (err.status || '?') + '），请稍后重试'; }
    else { msg = '暂时连不上识别服务，请检查网络后重试或改用手动记录。'; }
    $('aiError').textContent = msg;
    $('aiError').classList.add('show');
  });
}
function parseQwenContent(content){
  if(!content || typeof content !== 'string'){ return null; }
  var cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  try{ return JSON.parse(cleaned); }catch(e){}
  var start = cleaned.indexOf('{');
  while(start !== -1){
    var depth = 0, inStr = false, esc = false;
    for(var i = start; i < cleaned.length; i++){
      var ch = cleaned[i];
      if(esc){ esc = false; continue; }
      if(ch === '\\'){ esc = true; continue; }
      if(ch === '"'){ inStr = !inStr; continue; }
      if(inStr){ continue; }
      if(ch === '{'){ depth++; }
      else if(ch === '}'){ depth--; if(depth === 0){
        var candidate = cleaned.slice(start, i+1);
        try{ return JSON.parse(candidate); }catch(e){ break; }
      }}
    }
    start = cleaned.indexOf('{', start + 1);
  }
  return null;
}
function clampMacro(v, max){
  var n = Number(v);
  if(!Number.isFinite(n)){ n = 0; }
  return Math.round(Math.max(0, Math.min(max, n))*10)/10;
}
function normalizeAiResult(value){
  if(!isPlainObject(value)){ return null; }
  var protein = clampMacro(value.protein, 500);
  var carbs = clampMacro(value.carbs, 500);
  var fat = clampMacro(value.fat, 500);
  var calories = Math.round(clampMacro(value.calories, 3000));
  var items = Array.isArray(value.items) ? value.items.slice(0,20).map(function(item){
    if(!isPlainObject(item)){ return null; }
    return {
      name:cleanText(item.name,60,'食物'), amount:cleanText(item.amount,40,''),
      protein:clampMacro(item.protein,500), carbs:clampMacro(item.carbs,500),
      fat:clampMacro(item.fat,500), calories:Math.round(clampMacro(item.calories,3000))
    };
  }).filter(Boolean) : [];
  return { food:cleanText(value.food,80,''), items:items, protein:protein, carbs:carbs, fat:fat, calories:calories, note:cleanText(value.note,200,'') };
}
function showAiResult(parsed){
  currentAiParsed = parsed;
  var total = Number(parsed.protein) || 0;
  $('aiFood').textContent = parsed.food;
  $('aiAdjust').value = Math.round(total*10)/10;
  $('aiNote').textContent = parsed.note ? '🤖 ' + parsed.note : '';
  var box = $('aiItems'); box.innerHTML = '';
  (parsed.items || []).forEach(function(it){
    var p = Number(it.protein) || 0;
    var pct = total > 0 ? Math.min(100, Math.round(p/total*100)) : 0;
    var meta = '碳水 ' + (Number(it.carbs)||0) + 'g · 脂肪 ' + (Number(it.fat)||0) + 'g · ' + (Number(it.calories)||0) + ' kcal';
    var div = document.createElement('div');
    div.className = 'ai-item';
    div.innerHTML = '<div class="top"><b>' + escapeHtml(it.name) + (it.amount ? ' · ' + escapeHtml(it.amount) : '') + '</b><span class="g">' + p + 'g</span></div>' +
      '<div class="meta">' + meta + '</div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>';
    box.appendChild(div);
  });
  renderAiMacros();
  $('aiResult').classList.add('show');
}
/* 按「实际摄入」蛋白等比缩放，实时刷新蛋白/碳水/脂肪/热量展示 */
function renderAiMacros(){
  var p = currentAiParsed;
  if(!p){ return; }
  var base = Number(p.protein) || 0;
  var adj = Number($('aiAdjust').value);
  var valid = Number.isFinite(adj) && adj >= 0;
  var scale = (base > 0 && valid) ? (adj / base) : 1;
  $('aiGrams').textContent = valid ? (Math.round(adj*10)/10) : (Math.round(base*10)/10);
  $('aiMacroCarbs').textContent = Math.round((Number(p.carbs)||0)*scale*10)/10;
  $('aiMacroFat').textContent = Math.round((Number(p.fat)||0)*scale*10)/10;
  $('aiMacroCal').textContent = Math.round((Number(p.calories)||0)*scale);
}

/* ============================================================
   渲染
   ============================================================ */
function todayProteinLogs(){
  var start = dayStart(Date.now());
  return getLogIndex().proteinLogsByDay[start] || [];
}
function todayProteinTotal(){
  var start = dayStart(Date.now());
  return getLogIndex().proteinByDay[start] || 0;
}
function trainingStreak(){
  return computeTrainingStreak(getLogIndex().trainingDays);
}
function trainedToday(){
  return !!getLogIndex().trainingDays[dayStart(Date.now())];
}
function fmtTime(ts){ var d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
var WEEK_CN = ['日','一','二','三','四','五','六'];

function renderToday(){
  var now = new Date();
  $('todayDate').textContent = (now.getMonth()+1) + '月' + now.getDate() + '日 · 星期' + WEEK_CN[now.getDay()];
  var jan1 = new Date(now.getFullYear(),0,1);
  $('weekNo').textContent = Math.ceil((((now - jan1) / 86400000) + jan1.getDay() + 1) / 7);

  var logs = todayProteinLogs(); // 只计算一次，下面复用
  var total = Math.round(logs.reduce(function(s,l){ return s + (Number(l.grams)||0); }, 0)*10)/10;
  var target = S.settings.proteinTarget;
  var pct = Math.min(100, Math.round(total/target*100));
  $('pToday').textContent = total;
  $('pTarget').textContent = target;
  $('pCapTarget').textContent = target + 'g';
  $('pBar').style.width = pct + '%';
  $('pBarWrap').classList.toggle('done', total >= target);
  $('pPct').textContent = pct + '%';
  var remain = Math.max(0, Math.round((target - total)*10)/10);  // 勿用 left：与计时器模块变量同名
  $('pLeft').innerHTML = total >= target ? '已达标，<em>干得漂亮 ✓</em>' : '还差 <em>' + remain + 'g</em>，加油';
  var hour = now.getHours();
  $('todaySub').textContent = hour < 11 ? '早上好，先把蛋白安排上' : (hour < 14 ? '中午好，记得补蛋白' : (hour < 18 ? '下午好，别忘了加餐' : '晚上好，收尾今天的蛋白'));
  $('pAside').textContent = '今日 ' + logs.length + ' 条';

  var streak = trainingStreak();
  $('streakChip').hidden = streak < 1;
  $('streakNum').textContent = streak;
  var weekN = countWeekStrengthDays(getLogIndex().trainingSessions, now.getTime());
  $('weekStrengthNum').textContent = weekN;
  $('weekChip').classList.toggle('hit', weekN >= WEEK_STRENGTH_GOAL);

  renderMealGrid(logs, target);
  renderQuickFoods();
  renderBodyCard(now.getTime());

  var box = $('todayLogs'); box.innerHTML = '';
  if(!logs.length){
    box.innerHTML = '<div class="empty-hint">今天还没有记录 —— 拍张照，或手动记一笔</div>';
  } else {
    logs.forEach(function(l){
      var div = document.createElement('div');
      div.className = 'log-item';
      var srcLabel = l.source === 'photo' ? '拍照' : (l.source === 'quick' ? '快捷' : '手动');
      var mealLabel = MEAL_NAMES[l.meal] || MEAL_NAMES[mealFromTs(l.ts)] || '';
      var kcalHtml = l.calories ? '<span class="kcal num">' + l.calories + 'kcal</span>' : '';
      div.innerHTML = '<span class="t num">' + fmtTime(l.ts) + '</span>' +
        '<span class="f">' + escapeHtml(l.food) + '</span>' +
        '<span class="src">' + escapeHtml(mealLabel) + '</span>' +
        '<span class="src">' + srcLabel + '</span>' +
        kcalHtml +
        '<span class="g num">' + l.grams + '<small>g</small></span>' +
        '<button class="del" aria-label="删除">✕</button>';
      div.querySelector('.del').addEventListener('click', function(){ deleteLog(l.id); });
      box.appendChild(div);
    });
  }

  var rn = routineNames[S.settings.routine] || '徒手基础';
  var isStretch = S.settings.routine === 'stretch';
  var mvCount = isStretch ? stretchSets.stretch.length : moves.length;
  var estMin = Math.round(totalDurationEstimate()/6)/10;
  $('tIco').textContent = isStretch ? '🧘' : ((S.settings.routine === 'dumbbell' || S.settings.routine === 'gym') ? '🏋️' : (S.settings.routine === 'core' ? '🧘' : '💪'));
  $('tName').textContent = rn + ' · ' + mvCount + (isStretch ? ' 个拉伸' : ' 个动作');
  $('tDesc').textContent = (isStretch ? '全身放松拉伸' : (presetNames[S.settings.preset] + ' · 含热身+拉伸')) + ' · 约 ' + estMin + ' 分钟';
  var done = trainedToday();
  $('tGo').hidden = false;
  $('tGo').textContent = done ? '再练一次' : '开始';
  $('tDone').hidden = !done;
  $('tAside').textContent = done ? '已练 · 还可再练' : '待完成';
}
function renderMealGrid(logs, target){
  var grid = $('mealGrid');
  if(!grid){ return; }
  var tg = mealTargets(target);
  var got = { breakfast:0, lunch:0, dinner:0, snack:0 };
  (logs || []).forEach(function(l){
    var m = MEAL_IDS.indexOf(l.meal) >= 0 ? l.meal : mealFromTs(l.ts);
    got[m] += Number(l.grams) || 0;
  });
  grid.innerHTML = '';
  MEAL_IDS.forEach(function(id){
    var have = Math.round(got[id] * 10) / 10;
    var need = tg[id];
    var hit = have >= need && need > 0;
    var pct = need > 0 ? Math.min(100, Math.round(have / need * 100)) : 0;
    var cell = document.createElement('div');
    cell.className = 'meal-cell' + (hit ? ' hit' : '');
    cell.innerHTML = '<span class="ml">' + MEAL_NAMES[id] + '</span>' +
      '<span class="mv num">' + have + '</span>' +
      '<span class="mt">/ ' + need + 'g</span>' +
      '<div class="mb2"><i style="width:' + pct + '%"></i></div>';
    grid.appendChild(cell);
  });
}
function renderQuickFoods(){
  var box = $('quickFoods');
  if(!box || box.dataset.ready === '1'){ return; }
  box.innerHTML = '';
  QUICK_FOODS.forEach(function(f){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.innerHTML = escapeHtml(f.name) + '<small>+' + f.grams + '</small>';
    b.addEventListener('click', function(){ addProtein(f.grams, f.food, 'quick'); });
    box.appendChild(b);
  });
  box.dataset.ready = '1';
}
function renderBodyCard(nowTs){
  var idx = getLogIndex();
  var ds = dayStart(nowTs || Date.now());
  var wml = Math.round(idx.waterByDay[ds] || 0);
  var wTarget = S.settings.waterTarget || DEFAULT_WATER;
  $('wToday').textContent = wml;
  $('wTargetLabel').textContent = '/ ' + wTarget + ' ml';
  var wpct = Math.min(100, Math.round(wml / wTarget * 100));
  $('wBar').style.width = wpct + '%';
  $('wBarWrap').classList.toggle('done', wml >= wTarget);
  $('bodyAside').textContent = wml >= wTarget ? '水已达标' : ('还差 ' + Math.max(0, wTarget - wml) + ' ml');
  var last = latestWeight();
  if(last){
    var when = last.ts ? ((new Date(last.ts).getMonth()+1) + '/' + new Date(last.ts).getDate() + ' · ') : '';
    $('weightVal').innerHTML = when + '<span class="num">' + last.kg + '</span><small>kg</small>';
  } else {
    $('weightVal').textContent = '未记录';
  }
}
function totalDurationEstimate(){
  if(S.settings.routine === 'stretch'){
    return stretchSets.stretch.reduce(function(s,m){ return s + m.sec; }, 0);
  }
  var cfg = presets[S.settings.preset] || presets.starter;
  var warm = warmupMoves.reduce(function(s,m){ return s + m.sec; }, 0);
  var perRound = moves.length * cfg.work + (moves.length-1) * cfg.rest;
  var str = (stretchSets[S.settings.routine] || []).reduce(function(s,m){ return s + m.sec; }, 0);
  return warm + cfg.rounds * perRound + (cfg.rounds-1) * cfg.roundBreak + str;
}
$('tGo').addEventListener('click', function(){ goPage('training'); });

/* ---- 训练页 ---- */
function renderTraining(){
  var isStretch = S.settings.routine === 'stretch';
  document.querySelectorAll('#routineSeg button').forEach(function(b){ b.classList.toggle('on', b.dataset.routine === S.settings.routine); });
  document.querySelectorAll('#presetSeg button').forEach(function(b){ b.classList.toggle('on', b.dataset.preset === S.settings.preset); });
  document.querySelectorAll('#readyRow .ready-btn').forEach(function(b){ b.classList.toggle('on', b.dataset.ready === getReadiness()); });
  $('presetSection').style.display = isStretch ? 'none' : '';
  $('readySection').style.display = isStretch ? 'none' : '';
  var estMin = Math.round(totalDurationEstimate()/6)/10;
  $('durHint').textContent = estMin + ' 分钟';
  if(isStretch){
    $('roundHint').textContent = '全身拉伸 · ' + stretchSets.stretch.length + ' 个动作';
    $('wrapNote').textContent = '每个拉伸保持约 28 秒，配合呼吸、不弹震；做不到的姿势可跳过。';
  } else {
    var cfg = presets[S.settings.preset]||presets.starter;
    $('roundHint').textContent = cfg.rounds + ' 轮 · ' + moves.length + ' 个动作';
    $('wrapNote').textContent = '含热身 ' + warmupMoves.length + ' 项 + 练后针对拉伸 ' + (stretchSets[S.settings.routine]||[]).length + ' 项';
  }
  $('readyHint').textContent = getReadiness() === 'green' ? '状态不错，按当前档位来。' :
    (getReadiness() === 'yellow' ? '今天自动切到恢复档，轻松一点就好；症状加重就停。' :
    '今天不建议力量训练：优先补液、处理症状；严重或持续请联系医疗人员。（仍可做“拉伸”组）');
  makeMoveCards();
  $('btnStart').disabled = (getReadiness() === 'red' && !isStretch);
  $('btnStart').innerHTML = isStretch ? '▶ &nbsp;开始拉伸' : '▶ &nbsp;开始跟练';
}
function makeMoveCards(){
  var box = $('moveList'); box.innerHTML = '';
  var isStretch = S.settings.routine === 'stretch';
  var list = isStretch ? stretchSets.stretch : moves;
  list.forEach(function(m, i){
    var card = document.createElement('div');
    card.className = 'card press move-card';
    card.style.marginTop = i === 0 ? '0' : '10px';
    var thumb = m.noMedia
      ? '<div class="thumb nomedia">🧍</div>'
      : '<div class="thumb"><img src="' + imagePath(m, motionOn()) + '" alt="" loading="lazy"></div>';
    var last = (!isStretch && liftKind(m)) ? formatLiftLine(m) : '';
    var sub = isStretch ? (escapeHtml(m.target) + ' · ' + escapeHtml(m.position)) : escapeHtml(m.primary || m.area);
    if(last && last !== '还没记过'){ sub += ' · ' + escapeHtml(last); }
    var badge = isStretch ? escapeHtml(m.position) : escapeHtml(m.level || '起步');
    card.innerHTML = thumb +
      '<div class="mb"><div class="n">' + escapeHtml(m.name) + '</div><div class="a">' + sub + '</div></div>' +
      '<span class="lvl">' + badge + '</span><span class="chev">›</span>';
    card.addEventListener('click', function(){ if(isStretch){ openStretchDetail(m); } else { openMoveDetail(m); } });
    box.appendChild(card);
  });
}
$('routineSeg').addEventListener('click', function(e){
  var btn = e.target.closest('[data-routine]');
  if(!btn){ return; }
  if(!mutateState(function(){ S.settings.routine = btn.dataset.routine; })){ return; }
  moves = routines[btn.dataset.routine];
  resetWorkout(); renderTraining(); renderToday();
});
$('presetSeg').addEventListener('click', function(e){
  var btn = e.target.closest('[data-preset]');
  if(!btn){ return; }
  if(getReadiness() === 'yellow' && btn.dataset.preset !== 'recovery'){
    var preset = btn.dataset.preset;
    showConfirm('你今天状态一般，恢复档更安全。确定要切换到 ' + preset + ' 档吗？', function(){
      if(!mutateState(function(){ S.settings.preset = preset; })){ return; }
      resetWorkout(); renderTraining(); renderToday();
    }, { title:'切换档位', okText:'仍要切换' });
    return;
  }
  if(!mutateState(function(){ S.settings.preset = btn.dataset.preset; })){ return; }
  resetWorkout(); renderTraining(); renderToday();
});
$('readyRow').addEventListener('click', function(e){
  var btn = e.target.closest('[data-ready]');
  if(!btn){ return; }
  if(!mutateState(function(){
    S.settings.readiness = btn.dataset.ready;
    S.settings.readinessDay = dayStart(Date.now());
    if(S.settings.readiness === 'yellow' && S.settings.preset !== 'recovery'){
      S.settings.preset = 'recovery';
    }
  })){ return; }
  if(S.settings.readiness === 'yellow' && S.settings.preset === 'recovery'){
    showToast('已自动切到恢复档', '');
  }
  resetWorkout(); renderTraining();
});
$('btnStart').addEventListener('click', function(){
  resetWorkout();
  openPlanPreview();
});

/* ---- 练前计划预览 ---- */
var planModal = $('planModal');
function planSummary(){
  var warm = 0, work = 0, stretch = 0, rounds = 0;
  var warmNames = [], workNames = [], stretchNames = [], seenWork = {};
  steps.forEach(function(s){
    if(s.type === 'warmup'){ warm += s.sec; warmNames.push(s.move.name); }
    else if(s.type === 'work'){ work += s.sec; rounds = Math.max(rounds, s.round); if(!seenWork[s.move.id]){ seenWork[s.move.id] = true; workNames.push(s.move.name); } }
    else if(s.type === 'stretch'){ stretch += s.sec; stretchNames.push(s.move.name); }
  });
  return { warm:warm, work:work, stretch:stretch, rounds:rounds, warmNames:warmNames, workNames:workNames, stretchNames:stretchNames };
}
function sec2m(s){ return (Math.round(s/6)/10) + ' 分钟'; }
function openPlanPreview(){
  var sm = planSummary();
  var isStretch = S.settings.routine === 'stretch';
  $('planTotal').textContent = (Math.round((sm.warm + sm.work + sm.stretch)/6)/10);
  $('planTitle').textContent = isStretch ? '本次拉伸安排' : '本次训练安排';
  var body = $('planBody'); body.innerHTML = '';
  if(!isStretch && sm.warmNames.length){
    body.insertAdjacentHTML('beforeend', '<div class="plan-sec"><span class="tag warm">热身</span><div class="body"><div class="h">' + sm.warmNames.length + ' 项 · 约 ' + sec2m(sm.warm) + '</div><div class="list">' + sm.warmNames.map(escapeHtml).join(' → ') + '</div></div></div>');
  }
  if(!isStretch){
    var workList = (moves || []).map(function(m){
      var last = liftKind(m) ? formatLiftLine(m) : '';
      return escapeHtml(m.name) + (last && last !== '还没记过' ? '（' + escapeHtml(last.replace('上次：','')) + '）' : '');
    }).join(' → ');
    body.insertAdjacentHTML('beforeend', '<div class="plan-sec"><span class="tag work">正式</span><div class="body"><div class="h"><span class="num">' + sm.workNames.length + '</span> 个动作 × ' + sm.rounds + ' 轮 · 约 ' + sec2m(sm.work) + '</div><div class="list">' + workList + '</div></div></div>');
  }
  if(sm.stretchNames.length){
    body.insertAdjacentHTML('beforeend', '<div class="plan-sec"><span class="tag stretch">拉伸</span><div class="body"><div class="h">' + sm.stretchNames.length + ' 项 · 约 ' + sec2m(sm.stretch) + (isStretch ? '' : ' · 针对今天练的部位') + '</div><div class="list">' + sm.stretchNames.map(escapeHtml).join(' → ') + '</div></div></div>');
  }
  planModal.classList.add('open');
  planModal.setAttribute('aria-hidden','false');
  window.setTimeout(function(){ $('planGo').focus(); }, 0);
}
function closePlanPreview(){
  planModal.classList.remove('open');
  planModal.setAttribute('aria-hidden','true');
}
$('planGo').addEventListener('click', function(){ closePlanPreview(); startWorkout(); });
$('planCancel').addEventListener('click', closePlanPreview);
$('planClose').addEventListener('click', closePlanPreview);
$('planBackdrop').addEventListener('click', closePlanPreview);

/* ---- 动作详情 ---- */
var moveModal = $('moveModal');
var mdLiftMove = null;
function setDetailMedia(m){
  var wrap = $('mdMediaWrap'), img = $('mdMedia');
  if(!wrap || !img){ return; }
  if(!m || m.noMedia){ wrap.hidden = true; img.removeAttribute('src'); return; }
  wrap.hidden = false;
  var src = imagePath(m, motionOn());
  preloadMove(m, true);
  img.src = src;
  img.alt = m.name + ' 示范';
}
function openMoveDetail(m){
  $('mdName').textContent = m.name;
  $('mdArea').textContent = m.area + (m.equipment ? ' · 器械：' + m.equipment : ' · 无需器械');
  setDetailMedia(m);
  var mt = $('mdMuscles'); mt.innerHTML = '';
  if(m.primary){ var s1 = document.createElement('span'); s1.className = 'main'; s1.textContent = '主练 ' + m.primary; mt.appendChild(s1); }
  if(m.secondary){ var s2 = document.createElement('span'); s2.textContent = '辅助 ' + m.secondary; mt.appendChild(s2); }
  var st = $('mdSteps'); st.innerHTML = '';
  (m.steps || []).forEach(function(s, i){
    var div = document.createElement('div');
    div.className = 'step';
    div.innerHTML = '<span class="no num">' + (i+1) + '</span><span>' + escapeHtml(s) + '</span>';
    st.appendChild(div);
  });
  $('mdCueTx').textContent = m.cue || '';
  $('mdMistakeTx').textContent = m.mistake || '';
  $('mdMistake').style.display = m.mistake ? '' : 'none';
  mdLiftMove = m;
  bindMdLift(m);
  moveModal.classList.add('open');
  moveModal.setAttribute('aria-hidden','false');
}
function bindMdLift(m){
  var box = $('mdLift');
  if(!box){ return; }
  var kind = liftKind(m);
  if(!kind){ box.hidden = true; return; }
  box.hidden = false;
  var rec = getLift(m.id);
  if(kind === 'load'){
    $('mdLiftLoad').hidden = false;
    $('mdLiftLevels').hidden = true;
    $('mdKg').value = rec && rec.kg ? rec.kg : '';
    $('mdReps').value = rec && rec.reps ? rec.reps : '';
  } else {
    $('mdLiftLoad').hidden = true;
    $('mdLiftLevels').hidden = false;
    var lv = (rec && rec.level) || liftLevels(kind)[0].id;
    mdLiftMove._lv = lv;
    renderLevelChips($('mdLiftLevels'), kind, lv, function(id){ mdLiftMove._lv = id; });
  }
}
function closeMoveDetail(){
  moveModal.classList.remove('open');
  moveModal.setAttribute('aria-hidden','true');
}
function openStretchDetail(m){
  $('mdName').textContent = m.name;
  $('mdArea').textContent = '拉到 ' + m.target + ' · ' + m.position + ' · 保持约 ' + m.sec + ' 秒';
  setDetailMedia(m);
  $('mdMuscles').innerHTML = '<span class="main">目标 ' + escapeHtml(m.target) + '</span><span>' + escapeHtml(m.position) + '</span>';
  $('mdSteps').innerHTML = '';
  $('mdCueTx').textContent = m.cue || '';
  $('mdMistake').style.display = 'none';
  if($('mdLift')){ $('mdLift').hidden = true; }
  mdLiftMove = null;
  moveModal.classList.add('open');
  moveModal.setAttribute('aria-hidden','false');
}
$('moveClose').addEventListener('click', closeMoveDetail);
$('moveBackdrop').addEventListener('click', closeMoveDetail);
if($('mdLiftSave')){
  $('mdLiftSave').addEventListener('click', function(){
    if(!mdLiftMove){ return; }
    var kind = liftKind(mdLiftMove);
    var set = kind === 'load'
      ? normalizeLiftSet({ kg: $('mdKg').value, reps: $('mdReps').value })
      : normalizeLiftSet({ level: mdLiftMove._lv });
    if(!set){ showToast('先填重量或次数', 'error'); return; }
    if(!mutateState(function(){ upsertLiftRec(mdLiftMove.id, set); })){ return; }
    renderTraining();
    showToast('已记下 ' + formatLiftLine(mdLiftMove).replace('上次：',''), 'success');
  });
}

/* ---- 数据页 ---- */
function renderData(){
  var idx = getLogIndex();
  $('stStreak').textContent = computeTrainingStreak(idx.trainingDays);
  $('stWeek').textContent = countWeekStrengthDays(idx.trainingSessions, Date.now());
  var sessions = idx.trainingSessions;
  $('stSessions').textContent = sessions.length;
  var lastW = latestWeight();
  $('stWeight').textContent = lastW ? lastW.kg : '—';
  $('stWater').textContent = Math.round(idx.waterByDay[dayStart(Date.now())] || 0);
  var today0 = dayStart(Date.now());
  var sum7 = 0;
  for(var i = 0; i < 7; i++){
    sum7 += idx.proteinByDay[today0 - i * 86400000] || 0;
  }
  $('stAvg').textContent = Math.round(sum7 / 7);

  var chart = $('proteinChart'); chart.innerHTML = '';
  var target = S.settings.proteinTarget;
  var maxV = target;
  var days = [];
  for(var j = 6; j >= 0; j--){
    var ds = today0 - j * 86400000;
    var tot = Math.round((idx.proteinByDay[ds] || 0) * 10) / 10;
    days.push({ ds: ds, tot: tot });
    if(tot > maxV){ maxV = tot; }
  }
  days.forEach(function(d, idx){
    var dt = new Date(d.ds);
    var hPct = maxV > 0 ? Math.max(d.tot > 0 ? 6 : 0, Math.round(d.tot/maxV*100)) : 0;
    var col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = '<span class="gv num">' + (d.tot > 0 ? d.tot : '') + '</span>' +
      '<div class="bar-wrap"><div class="bar' + (d.tot >= target ? ' hit' : '') + '" style="height:' + hPct + '%"></div></div>' +
      '<span class="d' + (idx === 6 ? ' today' : '') + '">' + (dt.getMonth()+1) + '/' + dt.getDate() + '</span>';
    chart.appendChild(col);
  });
  $('chartTarget').textContent = '— 目标 ' + target + 'g · 绿色为达标日';
  $('chartAside').textContent = '日均 ' + $('stAvg').textContent + 'g';

  renderWeightChart();
  renderLiftHist();

  var hist = $('trainHist');
  var recent = sessions.slice(0, 10);
  if(!recent.length){
    hist.innerHTML = '<div class="empty-hint">还没有训练记录</div>';
  } else {
    hist.innerHTML = '';
    recent.forEach(function(l){
      var dt = new Date(l.ts);
      var div = document.createElement('div');
      div.className = 'hist-item';
      div.style.padding = '11px 0';
      div.style.borderBottom = '1px solid var(--line)';
      var statusLabel = l.status === 'completed' ? '完成' : (l.status === 'partial' ? '部分' : '提前结束');
      div.innerHTML = '<div class="d"><div class="dd num">' + (dt.getMonth()+1) + '/' + dt.getDate() + '</div><div class="wk">周' + WEEK_CN[dt.getDay()] + '</div></div>' +
        '<div class="b"><div class="n">' + escapeHtml(routineNames[l.routine]||'训练') + ' · ' + statusLabel + '</div>' +
        '<div class="m">' + (l.completedMoves||0) + (l.routine === 'stretch' ? ' 个拉伸' : ' 个动作') + ' · ' + (l.routine === 'stretch' ? '全身拉伸' : (presetNames[l.preset]||'')) + '</div></div>' +
        '<div class="min num">' + (Math.round((l.actualSeconds||0)/6)/10) + '<small> 分钟</small></div>';
      hist.appendChild(div);
    });
    hist.lastElementChild.style.borderBottom = 'none';
  }
}
function renderWeightChart(){
  var chart = $('weightChart');
  var aside = $('weightChartAside');
  if(!chart){ return; }
  var now = Date.now();
  var start = dayStart(now) - 27 * 86400000;
  var byDay = {};
  (S.weights || []).forEach(function(w){
    if(w.ts < start){ return; }
    byDay[dayStart(w.ts)] = w.kg;
  });
  var days = [];
  var minV = Infinity, maxV = 0;
  for(var i = 0; i < 28; i++){
    var ds = start + i * 86400000;
    var kg = byDay[ds];
    days.push({ ds:ds, kg:kg });
    if(kg){ if(kg < minV) minV = kg; if(kg > maxV) maxV = kg; }
  }
  if(!isFinite(minV)){
    chart.innerHTML = '<div class="empty-hint">还没有体重记录</div>';
    if(aside){ aside.textContent = ''; }
    return;
  }
  if(maxV === minV){ maxV = minV + 1; }
  chart.innerHTML = '';
  days.forEach(function(d, idx){
    var hPct = d.kg ? Math.max(8, Math.round((d.kg - minV) / (maxV - minV) * 100)) : 0;
    var dt = new Date(d.ds);
    var col = document.createElement('div');
    col.className = 'col';
    col.innerHTML = '<div class="bar-wrap"><div class="bar' + (d.kg ? ' hit' : '') + '" style="height:' + hPct + '%"></div></div>' +
      (idx % 7 === 0 || idx === 27 ? '<span class="d' + (idx === 27 ? ' today' : '') + '">' + (dt.getMonth()+1) + '/' + dt.getDate() + '</span>' : '<span class="d"></span>');
    chart.appendChild(col);
  });
  var last = latestWeight();
  if(aside){ aside.textContent = last ? (last.kg + ' kg') : ''; }
}
function renderLiftHist(){
  var box = $('liftHist');
  if(!box){ return; }
  var ids = S.lifts ? Object.keys(S.lifts) : [];
  ids.sort(function(a, b){ return (S.lifts[b].ts || 0) - (S.lifts[a].ts || 0); });
  if(!ids.length){
    box.innerHTML = '<div class="empty-hint">跟练哑铃/器械时记下重量，会出在这里</div>';
    return;
  }
  box.innerHTML = '';
  ids.forEach(function(id){
    var rec = S.lifts[id];
    var mv = moveById(id);
    var name = mv ? mv.name : id;
    var kind = liftKind(mv || { id:id, equipment: rec.kg ? '机' : '' });
    var main = (kind === 'wall' || kind === 'chair')
      ? liftLevelName(kind, rec.level)
      : ((rec.kg || 0) + ' kg × ' + (rec.reps || '—'));
    var hist = (rec.history || []).slice(-4).map(function(h){
      if(h.level){ return liftLevelName(kind, h.level) || h.level; }
      return (h.kg || 0) + '×' + (h.reps || 0);
    }).join(' → ');
    var div = document.createElement('div');
    div.className = 'lift-item';
    div.innerHTML = '<div class="b"><div class="n">' + escapeHtml(name) + '</div><div class="m">' + escapeHtml(hist || '刚记下') + '</div></div>' +
      '<div class="kg">' + escapeHtml(main) + '</div>';
    box.appendChild(div);
  });
}

/* ---- 我的页 ---- */
function renderSettings(){
  var ready = canUsePhotoAi();
  var k = getApiKey();
  $('keyStatus').textContent = ready ? (isTokenPlanKey(k) ? '已设置 · 百炼 Token Plan（sk-sp-）' : '已设置 · 经本站同域接口识别') : '未设置 · 拍照识别不可用';
  $('keyWarn').hidden = !ready;
  $('modelStatus').textContent = ready
    ? ('拍照模型 · ' + getPhotoModel() + (isTokenPlanKey(k) ? '（Token Plan 专用接口）' : ''))
    : '需先设置 Key';
  $('targetVal').textContent = S.settings.proteinTarget;
  var bw = S.settings.bodyWeightKg || (latestWeight() && latestWeight().kg) || 0;
  $('weightSetVal').textContent = bw ? bw : '—';
  $('weightHint').textContent = bw ? ('当前 ' + bw + ' kg') : '用来按体重估算蛋白目标';
  $('perKgVal').textContent = S.settings.proteinPerKg;
  var sug = suggestedProteinTarget(bw, S.settings.proteinPerKg);
  $('targetHint').textContent = sug ? ('按体重约 ' + sug + ' g，也可手改') : '先记下体重，或直接手改目标';
  $('waterTargetVal').textContent = S.settings.waterTarget;
  $('setSound').checked = S.settings.sound !== false;
  $('setVoice').checked = S.settings.voice !== false;
  $('setMotion').checked = S.settings.motion !== false;
  renderVoiceOptions();
}

/* ---- 语音音色选择 ---- */
function renderVoiceOptions(){
  var sel = $('setVoiceName');
  sel.innerHTML = '';
  var zh = zhVoices();
  var cur = S.settings.voiceName || '';
  var auto = document.createElement('option');
  auto.value = ''; auto.textContent = '自动（推荐女声）';
  sel.appendChild(auto);
  zh.forEach(function(v){
    var op = document.createElement('option');
    op.value = v.name; op.textContent = v.name + '（' + v.lang + '）';
    if(v.name === cur){ op.selected = true; }
    sel.appendChild(op);
  });
  sel.disabled = !zh.length;
  $('voiceHint').textContent = zh.length
    ? (cur ? '当前：' + cur : '默认优先晓梦/晓晓/晓涵等年轻女声')
    : '未检测到中文语音（推荐 Windows 11 或 Edge 以获得神经女声）';
}
$('setVoiceName').addEventListener('change', function(){
  mutateState(function(){ S.settings.voiceName = $('setVoiceName').value; });
  renderVoiceOptions();
  showToast($('setVoiceName').value ? '已切换为 ' + $('setVoiceName').value : '已恢复自动选择', 'success');
});
$('btnVoicePreview').addEventListener('click', function(){
  // 试听优先预生成 m4a；不可用时由 speak 自动回退系统语音。
  if(!voiceEnabled()){ showToast('语音指导未开启', 'error'); return; }
  speak('坚持住，就快完成了', { mp3Key:'encourage-1', showError:true });
});
if('speechSynthesis' in window){
  window.speechSynthesis.addEventListener('voiceschanged', onSpeechVoicesChanged);
  flushVoiceSpeakQueue();
}
$('btnSetKey').addEventListener('click', function(){
  showPrompt('输入通义千问 API Key。普通 Key 以 sk- 开头；百炼 Token Plan 以 sk-sp- 开头（两者都支持，会自动选接口与模型）。留空保存则清除。', getApiKey(), function(k){
    if(k === null || k === undefined){ return; }
    if(!setApiKey(k)){ showToast('Key 格式不正确，应以 sk- 开头且不含空格', 'error'); return; }
    renderSettings();
    showToast(k ? 'Key 已保存' : 'Key 已清除', 'success');
  }, { title:'设置 API Key', okText:'保存', type:'password', placeholder:'sk-…' });
});
$('btnSetTarget').addEventListener('click', function(){
  showPrompt('设置每日蛋白目标（20–300 g）：', String(S.settings.proteinTarget), function(t){
    if(t === '' || t == null){ return; }
    var n = Number(t);
    if(!Number.isFinite(n) || n < 20 || n > 300){ showToast('请输入 20–300 之间的数字', 'error'); return; }
    mutateState(function(){ S.settings.proteinTarget = Math.round(n); });
    renderSettings(); renderToday();
    showToast('目标已更新为 ' + Math.round(n) + 'g', 'success');
  }, { title:'蛋白目标', okText:'保存', type:'number', placeholder:'100' });
});
$('btnSetWeight').addEventListener('click', function(){
  var cur = S.settings.bodyWeightKg || (latestWeight() && latestWeight().kg) || '';
  showPrompt('当前体重（kg）：', cur ? String(cur) : '', function(v){
    if(v === '' || v == null){ return; }
    var n = Number(v);
    if(!Number.isFinite(n) || n < WEIGHT_KG_MIN || n > WEIGHT_KG_MAX){
      showToast('请输入 ' + WEIGHT_KG_MIN + '–' + WEIGHT_KG_MAX + ' 之间的数字', 'error'); return;
    }
    addWeight(n);
    var sug = suggestedProteinTarget(n, S.settings.proteinPerKg);
    if(sug && sug !== S.settings.proteinTarget){
      showConfirm('按 ' + n + ' kg × ' + S.settings.proteinPerKg + '，把蛋白目标改成 ' + sug + ' g？', function(){
        applyProteinFromWeight();
      }, { title:'按体重更新目标', okText:'改成 ' + sug + ' g' });
    }
  }, { title:'当前体重', okText:'保存', type:'number', placeholder:'例如 80' });
});
$('btnSetPerKg').addEventListener('click', function(){
  showPrompt('每公斤体重记多少克蛋白（0.8–2.5）：', String(S.settings.proteinPerKg), function(v){
    if(v === '' || v == null){ return; }
    var n = Number(v);
    if(!Number.isFinite(n) || n < PROTEIN_PER_KG_MIN || n > PROTEIN_PER_KG_MAX){
      showToast('请输入 ' + PROTEIN_PER_KG_MIN + '–' + PROTEIN_PER_KG_MAX, 'error'); return;
    }
    n = Math.round(n * 10) / 10;
    mutateState(function(){ S.settings.proteinPerKg = n; });
    renderSettings();
    showToast('已设为 ' + n + ' g/kg', 'success');
  }, { title:'每公斤蛋白', okText:'保存', type:'number', placeholder:'1.4' });
});
$('btnUseWeightTarget').addEventListener('click', function(){ applyProteinFromWeight(); });
$('btnSetWater').addEventListener('click', function(){
  showPrompt('每日饮水目标（500–6000 ml）：', String(S.settings.waterTarget), function(v){
    if(v === '' || v == null){ return; }
    var n = Number(v);
    if(!Number.isFinite(n) || n < WATER_ML_MIN || n > WATER_ML_MAX){
      showToast('请输入 ' + WATER_ML_MIN + '–' + WATER_ML_MAX, 'error'); return;
    }
    mutateState(function(){ S.settings.waterTarget = Math.round(n); });
    renderSettings(); renderToday();
    showToast('饮水目标 ' + Math.round(n) + ' ml', 'success');
  }, { title:'饮水目标', okText:'保存', type:'number', placeholder:'2000' });
});
['setSound','setVoice','setMotion'].forEach(function(id){
  $(id).addEventListener('change', function(){
    var key = id === 'setSound' ? 'sound' : (id === 'setVoice' ? 'voice' : 'motion');
    var val = $(id).checked;
    mutateState(function(){ S.settings[key] = val; });
  });
});

$('btnExport').addEventListener('click', function(){
  var payload = JSON.stringify(S, null, 2), prefix = '轻打卡备份_';
  if(storageReadOnly){
    var quarantined = null;
    try{ quarantined = window.localStorage.getItem(CORRUPT_KEY); }catch(e){}
    if(quarantined){ payload = quarantined; prefix = '轻打卡原始数据_'; }
  }
  var blob = new Blob([payload], { type:'application/json' });
  var a = document.createElement('a');
  var d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = prefix + d.getFullYear() + pad2(d.getMonth()+1) + pad2(d.getDate()) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  showToast('备份已导出', 'success');
});
$('btnImport').addEventListener('click', function(){ $('importFile').click(); });
$('importFile').addEventListener('change', function(e){
  var f = e.target.files && e.target.files[0];
  if(!f){ return; }
  if(f.size > IMPORT_MAX_BYTES){ showToast('备份文件过大（>5MB）', 'error'); e.target.value = ''; return; }
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var raw = JSON.parse(reader.result);
      raw = migrateState(raw);
      if(!isPlainObject(raw) || raw.v !== 5){ throw new Error('bad'); }
      var next = { v:5, settings:normalizeSettings(raw.settings), logs:normalizeLogs(raw.logs), weights:normalizeWeights(raw.weights), lifts:normalizeLifts(raw.lifts) };
      showConfirm('将用备份覆盖当前数据（' + next.logs.length + ' 条记录）。继续？', function(){
        storageReadOnly = false;  // 导入是只读模式的恢复出口
        S = next; writeState(S); bumpLogIndex();
        moves = routines[S.settings.routine] || bodyweightMoves;
        renderAll();
        showToast('导入成功', 'success');
      }, { title:'导入备份', okText:'覆盖导入', danger:true });
    }catch(err){ showToast('备份文件格式不正确', 'error'); }
  };
  reader.readAsText(f);
  e.target.value = '';
});
$('btnClear').addEventListener('click', function(){
  showConfirm('确定清空本机全部数据？此操作不可恢复，建议先导出备份。', function(){
    showConfirm('真的清空吗？包括所有蛋白、训练记录。', function(){
      try{
        window.localStorage.removeItem(V5KEY);
        window.localStorage.removeItem(APIKEY_STORAGE);
        window.localStorage.removeItem(CORRUPT_KEY);
      }catch(e){}
      idbClear(idbHandle);
      storageReadOnly = false;
      S = defaultState(); writeState(S); bumpLogIndex();
      moves = routines[S.settings.routine] || bodyweightMoves;
      renderAll();
      showToast('已清空本机数据', '');
    }, { title:'再次确认', okText:'确认清空', danger:true });
  }, { title:'清空数据', okText:'继续', danger:true });
});

/* ---- 总渲染 ---- */
function renderAll(){
  renderToday();
  if(document.getElementById('page-training').classList.contains('active')){ renderTraining(); }
  if(document.getElementById('page-data').classList.contains('active')){ renderData(); }
  if(document.getElementById('page-me').classList.contains('active')){ renderSettings(); }
}

/* ---- Service Worker ---- */
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').then(function(reg){
      try { reg.update(); } catch(e){}
    }).catch(function(){});
  });
}

/* ---- 初始化 ---- */
buildSteps();
renderToday();
renderSettings();
recoverFromIdb();

/* ---- 跨标签页同步 ---- */
window.addEventListener('storage', function(e){
  if(e.key === V5KEY){
    var fresh = readState().state;
    if(fresh){
      S = fresh;
      try{ lastPersistedStateJson = JSON.stringify(S); }catch(_){ lastPersistedStateJson = null; }
      moves = routines[S.settings.routine] || bodyweightMoves;
      bumpLogIndex();
      renderAll();
    }
  }
});

/* ---- 测试钩子：仅在 test.html 设置 window.__EXPOSE_FOR_TEST__ 时暴露纯函数 ---- */
if(window.__EXPOSE_FOR_TEST__){
  window.__T = {
    normalizeLogs:normalizeLogs, normalizeSettings:normalizeSettings, normalizeWeights:normalizeWeights,
    isActualTraining:isActualTraining, parseQwenContent:parseQwenContent, normalizeAiResult:normalizeAiResult,
    clampNumber:clampNumber, cleanText:cleanText, isPlainObject:isPlainObject, escapeHtml:escapeHtml,
    dayStart:dayStart, uid:uid, migrateState:migrateState, defaultState:defaultState, pad2:pad2,
    computeTrainingStreak:computeTrainingStreak, rebuildLogIndexFromLogs:rebuildLogIndexFromLogs,
    getRoutineIds:function(){ return ROUTINE_IDS.slice(); },
    getRelayUrl:function(){ return QWEN_RELAY; },
    mealFromTs:mealFromTs, mealTargets:mealTargets,
    suggestedProteinTarget:suggestedProteinTarget, weekStart:weekStart,
    isStrengthTraining:isStrengthTraining, countWeekStrengthDays:countWeekStrengthDays,
    liftKind:liftKind, normalizeLifts:normalizeLifts, normalizeLiftSet:normalizeLiftSet,
    suggestNextKg:suggestNextKg, formatLiftLine:formatLiftLine, nextLevelId:nextLevelId,
    /* ---- P1-4: 跟练计时内部状态（仅供测试） ---- */
    captureStepProgress:captureStepProgress,
    resetSessionStats:resetSessionStats,
    buildSteps:buildSteps,
    getSteps:function(){ return steps; },
    setSteps:function(v){ steps = v; },
    getStepIndex:function(){ return stepIndex; },
    setStepIndex:function(v){ stepIndex = v; },
    getLeft:function(){ return left; },
    setLeft:function(v){ left = v; },
    getSessionElapsed:function(){ return sessionElapsed; },
    getWorkElapsed:function(){ return workElapsed; },
    getStretchElapsed:function(){ return stretchElapsed; },
    getStepElapsedCounted:function(){ return stepElapsedCounted; },
    setStepElapsedCounted:function(v){ stepElapsedCounted = v; },
    getSkippedWork:function(){ return skippedWork; },
    getCompletedMoveIds:function(){ return completedMoveIds; },
    getCompletedStretchIds:function(){ return completedStretchIds; },
    getTotalDuration:function(){ return totalDuration; },
    getPresets:function(){ return presets; },
    getSettings:function(){ return S.settings; },
    setPreset:function(p){ S.settings.preset = p; },
    setRoutine:function(r){ S.settings.routine = r; moves = routines[r] || bodyweightMoves; }
  };
}
})();
