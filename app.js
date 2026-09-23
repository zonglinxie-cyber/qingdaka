(function(){
'use strict';
/* ---- 全局错误兜底：避免未捕获异常导致白屏 ---- */
function reportAppError(err){
  console.error('[轻打卡]', err);
  var msg = (err && err.message) ? String(err.message) : (typeof err === 'string' ? err : '');
  if(!msg){ msg = '请强制刷新'; }
  if(msg.length > 48){ msg = msg.slice(0, 48); }
  try{ showToast('出错：' + msg, 'error'); }catch(_){}
}
window.addEventListener('error', function(ev){
  if(ev.target && ev.target !== window){ return; }
  var file = ev.filename || '';
  if(file && !/\/(app|content)\.js(\?|$)/.test(file)){ return; }
  reportAppError(ev.error || ev.message || ev);
});
window.addEventListener('unhandledrejection', function(ev){
  var r = ev.reason, name = r && r.name;
  if(name === 'AbortError' || name === 'NotAllowedError' || name === 'NotSupportedError'){ return; }
  var stack = (r && r.stack) || '';
  if(stack && !/\/(app|content)\.js/.test(stack)){ return; }
  reportAppError(r || ev);
});

/* ============================================================
   轻打卡 v6 —— 本机记蛋白 / 喝水 / 跟练
   一份 localStorage JSON（键名 workbuddy-v5，兼容旧备份）。
   跟练状态在 session，不写入 S。语音只播预录 m4a，没有文件就静音。

   S = { v:5, settings, logs, weights, lifts }
   Settings = { proteinTarget, waterTarget, bodyWeightKg, heightCm, proteinPerKg,
     fiberDay, fiberVeg, fiberSoy, fiberGrain, sound, voice, motion,
     routine, preset, readiness, readinessDay }
   protein 条目: { grams, food, source:'photo'|'quick'|'manual'|'legacy', meal }
     source:'photo' 只为旧备份显示，没有拍照入口。
   ============================================================ */
function $(id){ return document.getElementById(id); }
function setText(id, v){ var el = $(id); if(el){ el.textContent = v; } }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function pad2(n){ return String(n).padStart(2,'0'); }
function dayStart(ts){ var d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function uid(){ return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); }
function clampNumber(v, min, max, fb){ var n = Number(v); if(!Number.isFinite(n)){ return fb; } return Math.max(min, Math.min(max, n)); }
function cleanText(v, max, fallback){ if(typeof v !== 'string'){ return fallback; } var s = v.trim().slice(0, max); return s || fallback; }
function isPlainObject(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }

var V5KEY = 'workbuddy-v5';
var assetBase = 'assets/exercise-guides/';
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
var IMPORT_MAX_BYTES = 20 * 1024 * 1024;
var DEFAULT_PROTEIN = 100;          // 默认蛋白目标 (g)
var DEFAULT_WATER = 2000;           // 默认饮水目标 (ml)
var PROTEIN_PER_KG_DEFAULT = 1.4;
var PROTEIN_PER_KG_MIN = 0.8;
var PROTEIN_PER_KG_MAX = 2.5;
var WEEK_STRENGTH_GOAL = 3;
var MEAL_IDS = ['breakfast','lunch','dinner','snack'];
var MEAL_NAMES = { breakfast:'早餐', lunch:'午餐', dinner:'晚餐', snack:'加餐' };
var QUICK_FOODS = [
  { id:'egg2', name:'鸡蛋2个', grams:13, food:'鸡蛋 2 个', liquid:false },
  { id:'milk', name:'纯牛奶', grams:8, food:'纯牛奶 250ml', liquid:true },
  { id:'soy', name:'豆浆', grams:8, food:'无糖豆浆 300ml', liquid:true },
  { id:'yogurt', name:'酸奶', grams:6, food:'原味酸奶 150g', liquid:true },
  { id:'greek', name:'希腊酸奶', grams:15, food:'希腊酸奶 150g', liquid:true },
  { id:'tofu', name:'北豆腐', grams:18, food:'北豆腐 150g', liquid:false },
  { id:'doukan', name:'豆腐干', grams:8, food:'豆腐干 50g', liquid:false },
  { id:'pork', name:'瘦猪肉', grams:15, food:'瘦猪肉 75g', liquid:false },
  { id:'fish', name:'鱼肉', grams:18, food:'鱼净肉 100g', liquid:false },
  { id:'shrimp', name:'虾仁', grams:15, food:'虾仁 80g', liquid:false },
  { id:'chicken', name:'即食鸡胸', grams:25, food:'即食鸡胸 100g 熟', liquid:false },
  { id:'powder', name:'蛋白粉', grams:24, food:'蛋白粉 1 平勺', liquid:true }
];
var HEIGHT_CM_MIN = 120;
var HEIGHT_CM_MAX = 220;
// 课程 ID 的唯一事实来源。设置、日志与 UI 都必须引用它，避免新增课程时只改一处。
var ROUTINE_IDS = ['bodyweight','dumbbell','core','gym','stretch'];

function mealFromTs(ts){
  var h = new Date(ts).getHours();
  if(h < 11){ return 'breakfast'; }
  if(h < 16){ return 'lunch'; }
  if(h < 20){ return 'dinner'; }
  return 'snack';
}
function idealWeightKg(heightCm){
  var h = Number(heightCm);
  if(!Number.isFinite(h) || h < HEIGHT_CM_MIN || h > HEIGHT_CM_MAX){ return null; }
  var m = h / 100;
  return Math.round(22 * m * m * 10) / 10;
}
function adjustedWeightKg(kg, heightCm){
  var w = Number(kg);
  if(!Number.isFinite(w) || w < WEIGHT_KG_MIN){ return null; }
  var ibw = idealWeightKg(heightCm);
  if(!ibw){ return Math.round(w * 10) / 10; }
  var m = Number(heightCm) / 100;
  var bmi = w / (m * m);
  if(bmi < 27.5){ return Math.round(w * 10) / 10; }
  return Math.round((ibw + 0.25 * (w - ibw)) * 10) / 10;
}
function suggestedProteinTarget(kg, perKg, heightCm, mode){
  var r = Number(perKg);
  if(!Number.isFinite(r) || r <= 0){ r = PROTEIN_PER_KG_DEFAULT; }
  r = clampNumber(r, PROTEIN_PER_KG_MIN, PROTEIN_PER_KG_MAX, PROTEIN_PER_KG_DEFAULT);
  var w = (mode === 'actual') ? Number(kg) : (adjustedWeightKg(kg, heightCm) || Number(kg));
  if(!Number.isFinite(w) || w < WEIGHT_KG_MIN || w > WEIGHT_KG_MAX){ return null; }
  var raw = Math.round(w * r);
  return Math.round(clampNumber(raw, PROTEIN_TARGET_MIN, 160, DEFAULT_PROTEIN));
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
  var lists = [];
  Object.keys(routines).forEach(function(k){ lists.push(routines[k]); });
  for(var L = 0; L < lists.length; L++){
    var arr = lists[L] || [];
    for(var i = 0; i < arr.length; i++){
      if(arr[i] && arr[i].id === id){ return arr[i]; }
    }
  }
  return null;
}

/* ---- Toast ---- */
var toastTimer = null;
function showToast(msg, type, undo){
  var el = $('toast'), button = $('toastUndo');
  $('toastText').textContent = msg;
  button.hidden = !undo;
  button.disabled = false;
  button.onclick = undo ? async function(){
    button.disabled = true;
    if(await undo()){ renderAll(); showToast('已撤销', 'success'); }
    else { button.disabled = false; }
  } : null;
  el.className = 'toast show' + (type ? ' ' + type : '');
  if(toastTimer){ window.clearTimeout(toastTimer); }
  toastTimer = window.setTimeout(function(){ el.classList.remove('show'); }, undo ? 10000 : 4000);
}
function undoLog(entry, restore){
  return function(){ return mutateState(function(){
    S.logs = S.logs.filter(function(l){ return l.id !== entry.id; });
    if(restore){ restore(); }
  }); };
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
  $('dlgOk').disabled = false;
  if(dlgPrevFocus && dlgPrevFocus.focus){ try{ dlgPrevFocus.focus(); }catch(e){} }
}
function showConfirm(msg, onOk, opts){
  opts = opts || {};
  $('dlgTitle').textContent = opts.title || '请确认';
  $('dlgMsg').textContent = msg;
  $('dlgFields').hidden = true;
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
  $('dlgFields').hidden = true;
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
    heightCm:0,
    fiberDay:0, fiberVeg:false, fiberSoy:false, fiberGrain:false,
    sound:true, voice:true, motion:true,
    routine:'bodyweight', preset:'starter',
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
  var hc = Number(st.heightCm);
  out.heightCm = (Number.isFinite(hc) && hc >= HEIGHT_CM_MIN && hc <= HEIGHT_CM_MAX) ? Math.round(hc) : 0;
  var fd = Number(st.fiberDay);
  var today0 = dayStart(Date.now());
  if(Number.isFinite(fd) && fd === today0){
    out.fiberDay = today0;
    out.fiberVeg = st.fiberVeg === true;
    out.fiberSoy = st.fiberSoy === true;
    out.fiberGrain = st.fiberGrain === true;
  } else {
    out.fiberDay = today0;
    out.fiberVeg = false; out.fiberSoy = false; out.fiberGrain = false;
  }
  out.sound = st.sound !== false;
  out.voice = st.voice !== false;
  out.motion = st.motion !== false;
  out.routine = ROUTINE_IDS.indexOf(st.routine) >= 0 ? st.routine : 'bodyweight';
  out.preset = ['recovery','starter','standard','steady'].indexOf(st.preset) >= 0 ? st.preset : 'starter';
  var rd = Number(st.readinessDay);
  if(Number.isFinite(rd) && rd === today && ['green','yellow','red'].indexOf(st.readiness) >= 0){
    out.readiness = st.readiness;
  } else {
    out.readiness = 'green';
  }
  out.readinessDay = today;
  return out;
}
function getReadiness(){ return S.settings.readinessDay === dayStart(Date.now()) ? S.settings.readiness : 'green'; }
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
      out.push(pEntry);
    } else if(item.type === 'water'){
      var ml = Math.round(clampNumber(item.ml, 0, WATER_ML_SINGLE, 0));
      if(ml <= 0){ return; }
      out.push({ id:id, type:'water', ts:ts, ml:ml });
    } else if(item.type === 'walk'){
      var mins = Math.round(clampNumber(item.minutes, 0, 180, 0));
      if(mins <= 0){ return; }
      out.push({ id:id, type:'walk', ts:ts, minutes:mins });
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
  return out;
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
  console.error('[轻打卡] 本机数据解析失败，原文未覆盖，可导出检查。');
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
    return { state:null, hadData:true, rawText:rawText };
  }
  return { state:hydrateState(raw), hadData:true };
}
function hydrateState(raw){
  return {
    v:5,
    updatedAt:clampNumber(raw.updatedAt, 0, TIMESTAMP_MAX, 0),
    lastBackupAt:clampNumber(raw.lastBackupAt, 0, TIMESTAMP_MAX, 0),
    settings:normalizeSettings(raw.settings),
    logs:normalizeLogs(raw.logs),
    weights:normalizeWeights(raw.weights),
    lifts:normalizeLifts(raw.lifts)
  };
}
var storageReady = false, storageInit = null, mutationQueue = Promise.resolve();
function writeState(s){
  var json;
  try{ json = JSON.stringify(s); JSON.parse(json); }catch(e){ return false; }
  try{ window.localStorage.setItem(V5KEY, json); return true; }
  catch(e){
    showToast('保存失败，原数据已保留。请释放空间或先导出备份。', 'error');
    return false;
  }
}
var __boot = readState();
var S = __boot.state || defaultState();
storageReadOnly = !__boot.state && __boot.hadData;
function mutateState(apply, allowRecovery){
  var task = mutationQueue.then(function(){
    return Promise.resolve(storageInit).then(function(){
      if(storageReadOnly && !allowRecovery){ showToast('当前为只读模式，请先导出或导入备份', 'error'); return false; }
      var snap;
      try{ snap = JSON.stringify(S); }catch(e){ showToast('操作失败，原数据未改变', 'error'); return false; }
      try{
        apply();
        S.updatedAt = Math.max(Date.now(), (JSON.parse(snap).updatedAt || 0) + 1);
      }catch(e){
        try{ S = hydrateState(JSON.parse(snap)); }catch(_){}
        showToast('操作失败，原数据未改变', 'error');
        return false;
      }
      if(!writeState(S)){
        try{ S = hydrateState(JSON.parse(snap)); }catch(_){}
        return false;
      }
      storageReadOnly = false;
      bumpLogIndex();
      return true;
    });
  });
  mutationQueue = task.catch(function(){ return false; });
  return mutationQueue;
}

/* ---- 记录操作 ---- */
async function addProtein(grams, food, source, extras){
  grams = Math.round(grams * 10) / 10;
  if(!grams || grams <= 0){ showToast('蛋白质克数需大于 0', 'error'); return; }
  var entry = { id:uid(), type:'protein', ts:Date.now(), grams:grams, food:cleanText(food,80,'食物'), source:source||'manual' };
  var ex = extras || {};
  entry.meal = MEAL_IDS.indexOf(ex.meal) >= 0 ? ex.meal : mealFromTs(entry.ts);
  if(!await mutateState(function(){
    S.logs.push(entry);
  })){ return; }
  renderToday();
  showToast('已记下 +' + grams + 'g', 'success', undoLog(entry));
  return true;
}
async function addWalk(minutes){
  minutes = Math.round(clampNumber(minutes, 0, 180, 0));
  if(!minutes){ return; }
  var entry = { id:uid(), type:'walk', ts:Date.now(), minutes:minutes };
  if(!await mutateState(function(){
    S.logs.push(entry);
  })){ return; }
  renderToday();
  if(document.getElementById('page-data').classList.contains('active')){ renderData(); }
  showToast('已记下走路 ' + minutes + ' 分钟', 'success', undoLog(entry));
}
function ensureFiberDay(){
  var today0 = dayStart(Date.now());
  if(S.settings.fiberDay !== today0){
    S.settings.fiberDay = today0;
    S.settings.fiberVeg = false;
    S.settings.fiberSoy = false;
    S.settings.fiberGrain = false;
  }
}
function weekAvgWeight(){
  var start = dayStart(Date.now()) - 6 * 86400000;
  var vals = (S.weights || []).filter(function(w){ return w.ts >= start; }).map(function(w){ return w.kg; });
  if(!vals.length){ return null; }
  var s = 0; vals.forEach(function(v){ s += v; });
  return Math.round(s / vals.length * 10) / 10;
}
async function addTraining(meta){
  meta = meta || {};
  if(!await mutateState(function(){
    var entry = {
      id:uid(), type:'training', ts:Date.now(), status:meta.status||'partial',
      routine:meta.routine||S.settings.routine, preset:meta.preset||S.settings.preset,
      readiness:meta.readiness||'green', actualSeconds:Math.max(0,Math.round(meta.actualSeconds||0)),
      plannedSeconds:Math.max(0,Math.round(meta.plannedSeconds||0)), workSeconds:Math.max(0,Math.round(meta.workSeconds||0)),
      completedMoves:Math.max(0,Math.round(meta.completedMoves||0)), skippedMoves:Math.max(0,Math.round(meta.skippedMoves||0))
    };
    var lifts = normalizeSessionLifts(meta.lifts || session.lifts);
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
async function addWater(ml){
  ml = Math.round(clampNumber(ml, 1, WATER_ML_SINGLE, 0));
  if(!ml){ showToast('饮水量需大于 0', 'error'); return; }
  var entry = { id:uid(), type:'water', ts:Date.now(), ml:ml };
  if(!await mutateState(function(){
    S.logs.push(entry);
  })){ return; }
  renderToday();
  if(document.getElementById('page-data').classList.contains('active')){ renderData(); }
  showToast('已记入 +' + ml + ' ml', 'success', undoLog(entry));
}
async function addWeight(kg, waist){
  kg = Math.round(clampNumber(kg, WEIGHT_KG_MIN, WEIGHT_KG_MAX, 0) * 10) / 10;
  if(!kg){ showToast('请输入有效体重', 'error'); return; }
  var wcm = (waist === '' || waist == null) ? undefined : Math.round(clampNumber(waist, WAIST_CM_MIN, WAIST_CM_MAX, 0) * 10) / 10;
  if(wcm === 0){ wcm = undefined; }
  if(!await mutateState(function(){
    var rec = { ts:Date.now(), kg:kg };
    if(wcm){ rec.waist = wcm; }
    S.weights.push(rec);
    S.settings.bodyWeightKg = kg;
  })){ return; }
  renderToday();
  if(document.getElementById('page-me').classList.contains('active')){ renderSettings(); }
  if(document.getElementById('page-data').classList.contains('active')){ renderData(); }
  showToast('已记下 ' + kg + ' kg。单日会波动，趋势看 7 日均。', 'success');
  return true;
}
async function applyProteinFromWeight(){
  var kg = S.settings.bodyWeightKg || (latestWeight() && latestWeight().kg);
  var adj = adjustedWeightKg(kg, S.settings.heightCm);
  var sug = suggestedProteinTarget(kg, S.settings.proteinPerKg, S.settings.heightCm, 'adjusted');
  if(!sug){ showToast('先记下体重，才能按体重计算', 'error'); return false; }
  if(!await mutateState(function(){ S.settings.proteinTarget = sug; })){ return false; }
  renderSettings(); renderToday();
  var used = adj || kg;
  var extra = (adj && S.settings.heightCm && adj < kg) ? '，已按调整体重，避免目标过高' : '';
  showToast('目标 ' + sug + ' g（' + used + ' kg × ' + S.settings.proteinPerKg + extra + '）。可手改小一点先执行。', 'success');
  return true;
}
async function deleteLog(id){
  var entry = S.logs.find(function(l){ return l.id === id; });
  if(!entry || !await mutateState(function(){ S.logs = S.logs.filter(function(l){ return l.id !== id; }); })){ return; }
  renderAll();
  showToast('记录已删除', '', function(){ return mutateState(function(){
    if(!S.logs.some(function(l){ return l.id === id; })){ S.logs.push(entry); }
  }); });
}
/*
 * isActualTraining — 正式动作至少 20 秒或完成一个动作；单纯热身/休息不计数。
 * status 说明：
 *   'completed' / 'partial' / 'stopped' — 正常完成/部分/提前结束
 *   'legacy' — 旧版数据，用 actualSeconds 判断（兼容无 workSeconds 的旧数据）
 *   'makeup' — 补打卡记录，不计入训练连击
 */
function isActualTraining(log){
  if(!log || log.type !== 'training' || log.status === 'makeup'){ return false; }
  if(log.status === 'legacy'){ return (Number(log.actualSeconds) || 0) >= 20; }
  return (Number(log.workSeconds) || 0) >= 20
    || (Number(log.completedMoves) || 0) > 0;
}
function isStrengthTraining(log){
  return isActualTraining(log) && log.routine !== 'stretch' && log.routine !== 'core';
}
function countRecentTrainingDays(trainingDays){
  var start = dayStart(Date.now()) - 6 * 86400000;
  var n = 0;
  Object.keys(trainingDays || {}).forEach(function(k){
    if(Number(k) >= start){ n++; }
  });
  return n;
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
  var walkByDay = {};
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
    } else if(l.type === 'walk'){
      walkByDay[ds] = (walkByDay[ds] || 0) + (Number(l.minutes) || 0);
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
    walkByDay: walkByDay,
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
var C = window.QDK_CONTENT;
if(!C || !C.routines){
  reportAppError(new Error('content.js 未加载，请 Command+Shift+R'));
  return;
}
var routines = C.routines, routineNames = C.routineNames, routineGear = C.routineGear, presets = C.presets, presetNames = C.presetNames, warmupMoves = C.warmupMoves, STRETCH = C.STRETCH, stretchSets = C.stretchSets;

var moves = routines[S.settings.routine] || routines.bodyweight;

function imagePath(move, animated, frameIndex){
  if(move.frames && move.frames.length){ return assetBase + move.frames[Math.min(frameIndex||0, move.frames.length-1)]; }
  var mediaId = C.mediaStem ? C.mediaStem(move) : ((move && move.id) || '');
  return assetBase + mediaId + (animated && !move.hold ? '.gif' : '-poster.png');
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
  if(!move || move.noMedia){ return; }
  if(move.frames && move.frames.length){ move.frames.forEach(function(_,i){ preloadUrl(imagePath(move,false,i)); }); }
  else { preloadUrl(imagePath(move,false)); if(animated && motionOn()){ preloadUrl(imagePath(move,true)); } }
}
function swapImage(img, url, alt, onError){
  if(!img || !url){ return; }
  try{ url = new URL(url, document.baseURI).href; }catch(e){}
  var token = String(Date.now()) + Math.random();
  img.dataset.swapToken = token;
  if(img.dataset.src === url){ img.classList.remove('demo-swap'); if(alt){ img.alt = alt; } return; }
  if(onError){ img.classList.add('demo-swap'); }
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
  loader.onerror = function(){
    if(img.dataset.swapToken !== token){ return; }
    img.classList.remove('demo-swap');
    if(onError){ img.removeAttribute('src'); delete img.dataset.src; onError(); }
  };
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

var VOICE_BASE = 'assets/voice/';
var voiceAudio = null;
var voiceGen = 0;
function ensureVoiceAudio(){
  if(voiceAudio){ return voiceAudio; }
  try{
    voiceAudio = document.getElementById('voicePlayer');
    if(!voiceAudio){
      voiceAudio = new Audio();
      voiceAudio.setAttribute('playsinline','');
      voiceAudio.setAttribute('webkit-playsinline','');
    }
    voiceAudio.preload = 'auto';
  }catch(e){ voiceAudio = null; }
  return voiceAudio;
}
function unlockVoice(){
  var a = ensureVoiceAudio();
  if(!a){ return; }
  try{
    a.muted = true;
    var p = a.play();
    if(p && p.then){ p.then(function(){ a.pause(); a.muted = false; }).catch(function(){ a.muted = false; }); }
    else { a.muted = false; }
  }catch(e){ try{ a.muted = false; }catch(_){} }
}
function stopVoice(){
  voiceGen++;
  var a = voiceAudio || document.getElementById('voicePlayer');
  if(a){ try{ a.pause(); }catch(e){} }
}
function playVoice(key, opts){
  opts = opts || {};
  if(!key){ return false; }
  var a = ensureVoiceAudio();
  if(!a){ return false; }
  if(!opts.overlap){ stopVoice(); }
  var myGen = voiceGen;
  var url;
  try{ url = new URL(VOICE_BASE + key + '.m4a', location.href).href; }
  catch(e){ url = VOICE_BASE + key + '.m4a'; }
  try{
    a.muted = false;
    a.volume = 1;
    a.src = url;
    var p = a.play();
    if(p && p.catch){
      p.catch(function(err){
        if(myGen !== voiceGen){ return; }
        if(opts.showError){
          var name = (err && err.name) ? err.name : 'unknown';
          try{ showToast('音频播放失败：' + name, 'error'); }catch(_){}
        }
      });
    }
  }catch(e){
    if(opts.showError){ try{ showToast('音频播放失败', 'error'); }catch(_){} }
    return false;
  }
  return true;
}
function speak(text, opts){
  if(!voiceEnabled()){ return; }
  var key = opts && opts.voiceKey;
  if(key){ playVoice(key, opts); }
}
var ENCOURAGE = ['坚持住，就快完成了','保持呼吸，你做得很稳','慢一点没关系，稳住就是胜利','每一次坚持，都在帮你保住肌肉','很好，注意动作质量，不抢时间'];
function speakEncourage(){
  var n = Math.floor(Math.random() * ENCOURAGE.length);
  speak(ENCOURAGE[n], { voiceKey: 'encourage-' + (n + 1) });
}
function announceStep(step){
  if(!step){ return; }
  var key = C.voiceKey
    ? C.voiceKey(step.type === 'stretch' ? 'stretch-' : (step.type === 'warmup' ? 'warmup-' : 'work-'), step.move)
    : null;
  if(step.type === 'break'){ speakEncourage(); }
  else if(key){ speak('', { voiceKey: key }); }
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
var PHASE = { idle:'idle', countdown:'countdown', running:'running', paused:'paused', finishing:'finishing', done:'done' };
var TRANSITIONS = {
  idle:{ countdown:1 },
  countdown:{ running:1, paused:1, finishing:1 },
  running:{ paused:1, finishing:1 },
  paused:{ running:1, countdown:1, finishing:1, idle:1 },
  finishing:{ done:1 },
  done:{ idle:1, finishing:1 }
};
function emptySession(){
  return {
    phase:PHASE.idle, steps:[], stepIndex:0, left:0, totalDuration:0,
    tickRAF:0, tickBase:0, timer:null,
    elapsed:0, workElapsed:0, stretchElapsed:0, stepCounted:0, skippedWork:0,
    completedMoveIds:{}, completedStretchIds:{},
    lifts:{}, logged:false, finishRetryEarly:null,
    sideChanged:false, cdSpoken:false, lastLeft:-1,
    playerOpen:false, plLogMove:null, plLogRound:0, plLogLevel:'', plLogTouched:false
  };
}
var session = emptySession();
function enterPhase(next){
  if(session.phase === next){ return true; }
  if(!(TRANSITIONS[session.phase] && TRANSITIONS[session.phase][next])){ return false; }
  session.phase = next;
  return true;
}
function sessionInProgress(){
  return session.phase !== PHASE.idle && !(session.phase === PHASE.done && session.logged);
}
function sessionPlaying(){
  return session.phase === PHASE.running || session.phase === PHASE.countdown;
}

function createPlan(){
  var cfg = presets[S.settings.preset] || presets.starter;
  var restSec = (S.settings.routine === 'gym' || S.settings.routine === 'dumbbell') ? Math.max(60, cfg.rest) : cfg.rest;
  var plan = [];
  if(S.settings.routine === 'stretch'){
    stretchSets.stretch.forEach(function(s){ plan.push({ type:'stretch', round:0, sec:s.sec, move:s }); });
  } else {
    warmupMoves.forEach(function(m){ plan.push({ type:'warmup', round:0, sec:m.sec, move:m }); });
    for(var r=1; r<=cfg.rounds; r++){
      moves.forEach(function(m, i){
        plan.push({ type:'work', round:r, sec:cfg.work, move:m });
        if(i < moves.length-1){ plan.push({ type:'rest', round:r, sec:restSec, next:moves[i+1] }); }
      });
      if(r < cfg.rounds){ plan.push({ type:'break', round:r, sec:cfg.roundBreak, next:moves[0] }); }
    }
    (stretchSets[S.settings.routine] || []).forEach(function(s){ plan.push({ type:'stretch', round:0, sec:s.sec, move:s }); });
  }
  return plan;
}
function buildSteps(){
  session.steps = createPlan();
  session.totalDuration = session.steps.reduce(function(sum, step){ return sum + step.sec; }, 0);
}
function resetSessionStats(){
  session.elapsed = 0; session.workElapsed = 0; session.stretchElapsed = 0; session.stepCounted = 0; session.skippedWork = 0;
  session.completedMoveIds = {}; session.completedStretchIds = {};
  session.logged = false;
  session.lifts = {};
  session.finishRetryEarly = null;
  session.plLogMove = null; session.plLogRound = 0; session.plLogLevel = ''; session.plLogTouched = false;
}
function captureStepProgress(reason){
  var step = session.steps[session.stepIndex];
  if(!step){ return; }
  var elapsed = Math.max(0, Math.min(step.sec, step.sec - session.left));
  var delta = Math.max(0, elapsed - session.stepCounted);
  session.elapsed += delta;
  if(step.type === 'work'){ session.workElapsed += delta; }
  if(step.type === 'stretch'){ session.stretchElapsed += delta; }
  session.stepCounted = elapsed;
  if(step.type === 'work' && (reason === 'natural' || elapsed >= step.sec*0.5)){ session.completedMoveIds[step.move.id] = true; }
  if(step.type === 'stretch' && (reason === 'natural' || elapsed >= step.sec*0.5)){ session.completedStretchIds[step.move.id] = true; }
  if(step.type === 'work' && reason === 'skip'){ session.skippedWork++; }
  if(step.type === 'work' && (reason === 'natural' || reason === 'stop' || (reason === 'skip' && elapsed >= step.sec * 0.5))){
    commitCurrentLift(step.move, step.round);
  }
  /* 休息与轮间页的面板记的是刚才那组：在这儿补点的档位、补填的重量也要在离开时落账，
     否则屏幕写着「做完自动记下」，那一组却被丢掉。只认你动过的面板，默认值不算。 */
  if((step.type === 'rest' || step.type === 'break') && session.plLogTouched){
    commitCurrentLift(session.plLogMove, session.plLogRound);
  }
}
function readPlLogSet(){
  var kind = session.plLogMove ? liftKind(session.plLogMove) : null;
  if(!kind){ return null; }
  if(kind === 'load'){
    return normalizeLiftSet({
      kg: $('plKg') ? $('plKg').value : 0,
      reps: $('plReps') ? $('plReps').value : 0
    });
  }
  if(!session.plLogLevel){ return null; }
  return normalizeLiftSet({ level: session.plLogLevel });
}
function commitCurrentLift(move, round){
  if(!move){ return; }
  var key = move.id + ':' + (round || 0);
  if(session.lifts[key]){ return; }
  var set = readPlLogSet();
  if(!set){ return; }
  session.lifts[key] = set;
  if(!session.lifts[move.id]){ session.lifts[move.id] = []; }
  session.lifts[move.id].push(set);
  mutateState(function(){ upsertLiftRec(move.id, set); });
}
function hidePlLog(){
  var box = $('plLog');
  if(box){ box.hidden = true; }
  session.plLogMove = null;
}
function bindPlLog(move, round, label){
  var box = $('plLog');
  if(!box){ return; }
  var kind = liftKind(move);
  if(!kind || !move){
    hidePlLog();
    return;
  }
  session.plLogMove = move;
  session.plLogRound = round || 0;
  session.plLogTouched = false;
  box.hidden = false;
  var forEl = $('plLogFor');
  if(forEl){ forEl.textContent = (label || '这组') + ' · ' + move.name + ' 第 ' + (round || 1) + ' 轮'; }
  var rec = getLift(move.id);
  /* 刚做完的那一组先记在会话里，落库要等一轮微任务；休息屏若只读存档，
     会在你刚记完之后整段都说「还没记过」，和旁边亮着的档位自相矛盾。 */
  var justDone = session.lifts[move.id];
  $('plLogLast').textContent = formatLiftLine(move, (justDone && justDone.length ? justDone[justDone.length - 1] : null) || rec);
  var load = $('plLogLoad');
  var levels = $('plLogLevels');
  if(!load || !levels){ return; }
  var hintEl = $('plLogHint');
  if(hintEl){ hintEl.hidden = false; }
  if(session.lifts[move.id + ':' + session.plLogRound]){
    /* 这一组已经落账：再摆一排点了也不会变的输入框，只会让人以为还能改 */
    load.hidden = true; levels.hidden = true;
    if(hintEl){ hintEl.hidden = true; }
    return;
  }
  if(kind === 'load'){
    load.hidden = false;
    levels.hidden = true;
    var prev = session.lifts[move.id + ':' + session.plLogRound];
    $('plKg').value = prev ? (prev.kg || '') : (rec && rec.kg ? rec.kg : '');
    $('plReps').value = prev ? (prev.reps || '') : (rec && rec.reps ? rec.reps : '');
    var next = rec && rec.kg ? suggestNextKg(rec.kg, session.lifts[move.id] || (rec.kg ? [{reps: rec.reps, kg: rec.kg}] : []), rec.reps || 10) : 0;
    $('plLogHint').textContent = next && rec && next > rec.kg
      ? ('这组能做到 ' + (rec.reps || 10) + ' 次的话，下次可试 ' + next + ' kg')
      : '做完这一组会自动记下';
  } else {
    load.hidden = true;
    levels.hidden = false;
    var prevLv = session.lifts[move.id + ':' + session.plLogRound];
    session.plLogLevel = (prevLv && prevLv.level) || (rec && rec.level) || '';
    /* 提示跟着档位走：点了之后还说「没点就不记」，等于告诉人刚才那一下没生效 */
    var showLevelHint = function(){
      var nxt = nextLevelId(kind, session.plLogLevel);
      $('plLogHint').textContent = !session.plLogLevel
        ? '点一下这组的难度；没点就不记。'
        : (nxt && nxt !== session.plLogLevel
          ? ('稳住了下次可试：' + liftLevelName(kind, nxt))
          : '这一档已是最高难度，做完自动记下');
    };
    renderLevelChips(levels, kind, session.plLogLevel, function(id){ session.plLogLevel = id; session.plLogTouched = true; showLevelHint(); });
    showLevelHint();
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
/* 重量与次数是输入框：程序回填不算你填的，真敲过才算动过这一组 */
['plKg','plReps'].forEach(function(id){
  var el = $(id);
  if(el){ el.addEventListener('input', function(){ session.plLogTouched = true; }); }
});
function elapsedBefore(i){ var s=0; for(var k=0;k<i;k++){ s+=session.steps[k].sec; } return s; }
function updateProgress(){
  var step = session.steps[session.stepIndex];
  var done = elapsedBefore(session.stepIndex) + (step ? (step.sec - session.left) : 0);
  var pct = session.totalDuration ? Math.min(100, done/session.totalDuration*100) : 0;
  $('plBar').style.width = pct + '%';
}
function setDemoVisible(visible){
  $('plDemoWrap').hidden = !visible;
  if(!visible){ stopFrameAnimation(); currentDemoUrl = ''; $('plDemo').dataset.swapToken = ''; }
}
function showTextSteps(move, label){
  if(!move){ return; }
  var steps = move.steps || [move.cue];
  $('plInstructions').innerHTML = '<p class="instruction-label">' + escapeHtml(label) + '</p><ol>' + steps.map(function(text){ return '<li>' + escapeHtml(text) + '</li>'; }).join('') + '</ol>';
  $('plInstructions').hidden = false;
}
function renderDemo(move, badge, animate){
  if(!move || move.noMedia){
    setDemoVisible(false);
    $('plDemo').removeAttribute('src'); $('plDemo').removeAttribute('data-src');
    return;
  }
  setDemoVisible(true);
  stopFrameAnimation();
  preloadMove(move, !!animate);
  var useMotion = !!animate && motionOn();
  var frame = 0;
  var show = function(){
    var src = move.frames && move.frames.length ? imagePath(move,false,frame) : imagePath(move,useMotion);
    currentDemoUrl = src;
    swapImage($('plDemo'), src, move.name, function(){
      setDemoVisible(false);
      showTextSteps(move, '示范暂不可用 · 文字步骤');
    });
  };
  show();
  if(useMotion && move.frames && move.frames.length > 1){
    demoFrameTimer = window.setInterval(function(){ frame = (frame+1) % move.frames.length; show(); }, 1300);
  }
  $('plBadge').textContent = badge || '示范';
}
function renderNext(){
  var m = null;
  for(var i = session.stepIndex+1; i < session.steps.length; i++){
    var s = session.steps[i];
    if(s.type === 'rest' || s.type === 'break'){ m = s.next; break; }
    if(s.move){ m = s.move; break; }
  }
  $('plNext').textContent = m ? '接下来 · ' + m.name : '这是最后一个动作';
}
function phaseProgress(type){
  var n = 0, total = 0;
  for(var i = 0; i < session.steps.length; i++){
    if(session.steps[i].type !== type){ continue; }
    total++;
    if(i <= session.stepIndex){ n++; }
  }
  return n + ' / ' + total;
}
/* 一句口令 = 要领 + 换侧说明；换侧的时机由 tick 过半时提示，所以内容里不再重复写「换边」 */
function oneLineCue(m){
  var cue = m.shortCue || m.cue;
  var side = m.sideMode === 'half' ? '过半会提示换侧。' : (m.sideMode === 'alternate' ? '左右交替。' : '');
  return (side && cue.indexOf(side) < 0) ? cue + side : cue;
}
function renderStep(){
  var step = session.steps[session.stepIndex];
  if(!step){ finishWorkout(false); return; }
  $('plInstructions').hidden = true;
  $('plClock').textContent = String(session.left);
  session.sideChanged = false;
  var rounds = (presets[S.settings.preset]||presets.starter).rounds;
  var phase = $('plPhase');
  if(step.type === 'warmup'){
    phase.textContent = '热身'; phase.className = 'pl-phase warm';
    $('plRound').textContent = phaseProgress('warmup');
    $('plClock').className = 'pl-clock num';
    $('plMv').textContent = step.move.name;
    renderDemo(step.move, '热身', true);
    $('plCue').textContent = oneLineCue(step.move);
  } else if(step.type === 'work'){
    phase.textContent = '训练中'; phase.className = 'pl-phase';
    $('plRound').textContent = '动作 ' + (moves.indexOf(step.move)+1) + ' / ' + moves.length + (rounds > 1 ? ' · 第 ' + step.round + ' 轮' : '');
    $('plClock').className = 'pl-clock num';
    $('plMv').textContent = step.move.name;
    renderDemo(step.move, step.move.mediaLabel || (step.move.hold || step.move.staticOnly ? '静态姿势参考' : (motionOn() ? '动作示范 · 按自己的节奏' : '静态参考')), true);
    $('plCue').textContent = oneLineCue(step.move);
  } else if(step.type === 'rest'){
    phase.textContent = '换动作'; phase.className = 'pl-phase rest';
    $('plRound').textContent = '第 ' + step.round + ' 轮';
    $('plClock').className = 'pl-clock num rest';
    $('plMv').textContent = '休息一下';
    // 下一个动作没有示范图时，屏幕上摆出来的是文字步骤，口令就不能说「照着示范」
    $('plCue').textContent = step.next && step.next.noMedia ? '恢复呼吸，照着下面的步骤摆好起始位。' : '恢复呼吸，照着示范摆好起始位。';
    renderDemo(step.next, '下一动作', false);
    preloadMove(step.next, true);
  } else if(step.type === 'break'){
    phase.textContent = '轮间休息'; phase.className = 'pl-phase rest';
    $('plRound').textContent = '下一轮 ' + (step.round+1);
    $('plClock').className = 'pl-clock num rest';
    $('plMv').textContent = '轮间休息';
    $('plCue').textContent = '小口补水；若不适，不必继续下一轮。';
    renderDemo(step.next, '下一轮', false);
    preloadMove(step.next, true);
  } else if(step.type === 'stretch'){
    phase.textContent = '拉伸'; phase.className = 'pl-phase stretch';
    $('plRound').textContent = (S.settings.routine === 'stretch' ? '全身拉伸 ' : '练后放松 ') + phaseProgress('stretch');
    $('plClock').className = 'pl-clock num rest';
    $('plMv').textContent = step.move.name;
    if(step.move.noMedia){ setDemoVisible(false); }
    else { renderDemo(step.move, '拉伸 · ' + step.move.position, true); }
    $('plCue').textContent = oneLineCue(step.move);
  }
  for(var ni=session.stepIndex+1; ni<session.steps.length; ni++){ var ns=session.steps[ni]; if(ns.move && !ns.move.noMedia){ preloadMove(ns.move, ns.type==='work'); break; } }
  updateProgress();
  renderNext();
  var shown = step.move || step.next;
  if(shown && shown.noMedia){ showTextSteps(shown, '文字步骤 · 暂无示范图'); }
  if(step.type === 'work'){
    bindPlLog(step.move, step.round, '记这组');
  } else if(step.type === 'rest' || step.type === 'break'){
    var prev = null;
    for(var pi = session.stepIndex - 1; pi >= 0; pi--){
      if(session.steps[pi].type === 'work'){ prev = session.steps[pi]; break; }
    }
    if(prev){ bindPlLog(prev.move, prev.round, '记刚才那组'); }
    else { hidePlLog(); }
  } else { hidePlLog(); }
}
function tick(){
  if(session.phase !== PHASE.running){ return; }
  var step = session.steps[session.stepIndex];
  if(!step){ return; }
  var realLeft = step.sec - Math.floor((Date.now() - session.tickBase)/1000);
  if(step.move && step.move.sideMode === 'half' && !session.sideChanged && realLeft <= Math.ceil(step.sec/2)){
    session.sideChanged = true;
    $('plCue').innerHTML = '<b>现在换侧</b>' + (step.type === 'stretch' ? '另一侧同样轻拉到发紧就好。' : '先稳住身体，再开始另一侧。');
    $('plBadge').textContent = '换另一侧';
    cueShort(); speak('换另一侧', { voiceKey: 'switch-side' });
  }
  if(realLeft <= 0){
    session.left = 0; captureStepProgress('natural'); advance(1,'natural',true);
    if(session.phase === PHASE.running){ startTick(); }
    return;
  }
  session.left = realLeft;
  if(session.left !== session.lastLeft){
    session.lastLeft = session.left;
    $('plClock').textContent = String(session.left);
    updateProgress();
    if(session.left <= 3 && session.left >= 1){
      cueShort();
      if(session.left === 3 && !session.cdSpoken){ session.cdSpoken = true; speak('3，2，1', { voiceKey: 'countdown-3' }); }
    }
  }
  session.tickRAF = window.requestAnimationFrame(tick);
}
function startTick(){ session.tickRAF = window.requestAnimationFrame(tick); }
function stopTick(){ if(session.tickRAF){ window.cancelAnimationFrame(session.tickRAF); session.tickRAF = 0; } }
function stopSessionTimer(){
  if(session.timer){ window.clearInterval(session.timer); session.timer = null; }
  stopTick();
}
function enterStep(){
  var step = session.steps[session.stepIndex];
  if(!step){ finishWorkout(false); return; }
  if(session.phase === PHASE.countdown && !enterPhase(PHASE.running)){ return; }
  session.left = step.sec; session.tickBase = Date.now(); session.sideChanged = false; session.cdSpoken = false; session.lastLeft = -1; session.stepCounted = 0;
  renderStep();
  if(step.type === 'work'){ cueStart(); } else { cueRest(); }
  announceStep(step);
}
function advance(dir, reason, alreadyCaptured){
  if(!alreadyCaptured){ captureStepProgress(reason || (dir > 0 ? 'skip' : 'back')); }
  var next = session.stepIndex + dir;
  if(next >= session.steps.length){ finishWorkout(false); return; }
  if(next < 0){ next = 0; }
  session.stepIndex = next; enterStep();
}
function runCountdown(){
  if(session.phase !== PHASE.countdown && !enterPhase(PHASE.countdown)){ return; }
  var n = 3;
  var first = session.steps[session.stepIndex] || session.steps[0];
  $('plInstructions').hidden = true;
  $('plPhase').textContent = '准备开始'; $('plPhase').className = 'pl-phase warm';
  $('plClock').className = 'pl-clock num cd';
  $('plClock').textContent = String(n);
  $('plMv').textContent = first && first.move ? first.move.name : '马上开始';
  $('plRound').textContent = '先站稳';
  if(first && first.move){ renderDemo(first.move, '准备 · 先摆好位', false); } else { setDemoVisible(false); }
  $('plCue').textContent = '倒数结束就开始；先照着示范把起始位摆好。';
  $('plNext').textContent = ''; hidePlLog();
  unlockVoice();
  cueShort(); speak('3，2，1，开始', { voiceKey: 'countdown-start' });
  session.timer = window.setInterval(function(){
    n--;
    if(n <= 0){
      stopSessionTimer();
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
  session.playerOpen = true;
  playerReturnFocus = document.activeElement;
  var pl = $('player');
  pl.classList.add('open');
  pl.setAttribute('aria-hidden','false');
  pl.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
}
function closePlayer(){
  session.playerOpen = false;
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
  if(session.phase === PHASE.running || session.phase === PHASE.countdown || session.phase === PHASE.finishing){ return; }
  if(session.phase === PHASE.done && session.finishRetryEarly !== null){ openPlayer(); return; }
  if(getReadiness() === 'red' && S.settings.routine !== 'stretch'){
    showToast('今天先不训练：优先补液并处理症状；严重或持续请联系医疗人员', 'error');
    return;
  }
  if(!session.steps.length || session.stepIndex >= session.steps.length){ resetWorkout(); }
  ensureAudio();
  unlockVoice();
  $('plPause').textContent = '暂停';
  $('plPause').setAttribute('aria-label', '暂停');
  $('plPrev').disabled = false; $('plSkip').disabled = false;
  requestWakeLock();
  openPlayer();
  if(session.phase === PHASE.paused && session.stepCounted > 0 && session.left < (session.steps[session.stepIndex] && session.steps[session.stepIndex].sec)){
    if(!enterPhase(PHASE.running)){ return; }
    session.tickBase = Date.now() - ((session.steps[session.stepIndex].sec - session.left) * 1000);
    renderStep();
    startTick();
    return;
  }
  if(session.phase === PHASE.idle || session.phase === PHASE.paused){
    if(!enterPhase(PHASE.countdown)){ return; }
  }
  runCountdown();
}
function pauseWorkout(){
  if(session.phase !== PHASE.running && session.phase !== PHASE.countdown){ startWorkout(); return; }
  captureStepProgress('pause');
  if(!enterPhase(PHASE.paused)){ return; }
  stopVoice();
  stopSessionTimer();
  $('plPause').textContent = '继续';
  $('plPause').setAttribute('aria-label', '继续');
  $('plPhase').textContent = '已暂停';
  releaseWakeLock();
}
function resetWorkout(){
  stopSessionTimer();
  stopVoice();
  session = emptySession();
  buildSteps();
  session.left = session.steps.length ? session.steps[0].sec : 0;
  $('plPause').textContent = '暂停';
  updateProgress();
}
async function finishWorkout(early){
  if(session.logged || session.phase === PHASE.finishing){ return; }
  if(session.phase !== PHASE.finishing && !enterPhase(PHASE.finishing)){ return; }
  captureStepProgress(early ? 'stop' : 'natural');
  stopSessionTimer();
  releaseWakeLock();
  session.left = 0; session.stepIndex = session.steps.length; updateProgress();
  cueFinish();
  var isStretch = S.settings.routine === 'stretch';
  var effectiveWork = isStretch ? session.stretchElapsed : session.workElapsed;
  var mvCount = isStretch ? Object.keys(session.completedStretchIds).length : Object.keys(session.completedMoveIds).length;
  var shouldLog = effectiveWork >= 20 || session.elapsed >= 30 || mvCount > 0;
  var didLog = false;
  if(shouldLog){
    didLog = await addTraining({
      status: early ? 'stopped' : (session.skippedWork > 0 ? 'partial' : 'completed'),
      routine:S.settings.routine, preset:S.settings.preset, readiness:getReadiness(),
      actualSeconds:session.elapsed, plannedSeconds:session.totalDuration, workSeconds:effectiveWork,
      completedMoves:mvCount, skippedMoves:session.skippedWork
    });
    if(didLog){ session.logged = true; }
  }
  enterPhase(PHASE.done);
  session.finishRetryEarly = shouldLog && !didLog ? !!early : null;
  $('plDoneBtn').textContent = session.finishRetryEarly !== null ? '重试保存' : '回到训练';
  var mins = (Math.round(session.elapsed/6)/10);
  var unit = isStretch ? ' 个拉伸' : ' 个动作';
  $('plDoneTitle').textContent = session.finishRetryEarly !== null ? '本次尚未保存' : (early && didLog ? '已按实际记录' : (isStretch ? '拉伸结束' : '训练结束'));
  $('plDoneSub').textContent = '实际 ' + mins + ' 分钟 · 完成 ' + mvCount + unit +
    (didLog ? ' · 已写入' : (shouldLog ? ' · 保存失败' : ' · 太短未写入，下次做 1 个动作即可'));
  var liftBox = $('plDoneLifts');
  if(liftBox){
    var lines = [];
    Object.keys(session.lifts).forEach(function(k){
      if(k.indexOf(':') >= 0){ return; }
      var mv = moveById(k);
      var sets = session.lifts[k] || [];
      if(!mv || !sets.length){ return; }
      var kind = liftKind(mv);
      if(kind === 'load'){
        lines.push(mv.name + ' · ' + sets.map(function(s){ return (s.kg || 0) + 'kg×' + (s.reps || 0); }).join('、'));
        var rec = getLift(k);
        var nxt = rec ? suggestNextKg(rec.kg, sets, rec.reps || 10) : 0;
        if(nxt && rec && nxt > rec.kg){ lines[lines.length - 1] += ' → 下次 ' + nxt + ' kg'; }
      } else if(sets[0].level){
        lines.push(mv.name + ' · ' + sets.map(function(s){ return liftLevelName(kind, s.level); }).join('、'));
      }
    });
    liftBox.innerHTML = lines.length ? lines.map(function(t){ return '<div>' + escapeHtml(t) + '</div>'; }).join('') : '';
  }
  $('plDone').classList.add('show');
  $('plDone').setAttribute('aria-hidden','false');
  var doneKey = didLog ? (early ? 'finish-early' : (isStretch ? 'finish-stretch' : 'finish-done')) : null;
  if(doneKey){ speak('', { voiceKey: doneKey }); }
}
$('plPause').addEventListener('click', function(){ pauseWorkout(); });
$('plSkip').addEventListener('click', function(){ if(session.phase === PHASE.running){ advance(1,'skip'); } });
$('plPrev').addEventListener('click', function(){ if(session.phase === PHASE.running && session.stepIndex > 0){ advance(-1,'back'); } });
$('plEnd').addEventListener('click', function(){
  showConfirm('按已经做完的记录下来？未做完的明天不必补罚。', function(){ finishWorkout(true); }, { title:'结束并记录', okText:'记下' });
});
$('plExit').addEventListener('click', function(){
  if(sessionPlaying()){ pauseWorkout(); }
  closePlayer();
  renderAll();
  if(sessionInProgress()){ showToast('已暂停，不会在后台计时；可继续或结束并记录', ''); }
});
$('plDoneBtn').addEventListener('click', function(){
  if(session.phase === PHASE.finishing){ return; }
  if(session.finishRetryEarly !== null){ finishWorkout(session.finishRetryEarly); return; }
  $('plDone').classList.remove('show');
  $('plDone').setAttribute('aria-hidden','true');
  closePlayer();
  resetWorkout();
  goPage('training');
});
document.addEventListener('visibilitychange', function(){
  if(document.hidden && session.phase === PHASE.running){ pauseWorkout(); }
});
window.addEventListener('beforeunload', function(e){
  if(sessionInProgress() || session.finishRetryEarly !== null){
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

function openManualProtein(){
  $('dlgTitle').textContent = '记一笔蛋白';
  $('dlgMsg').textContent = '填克数即可，也可以选常用食物。';
  $('proteinExtras').open = false; $('foodPicker').open = false;
  $('dlgInput').hidden = true;
  $('dlgFields').hidden = false;
  $('recordGrams').value = '';
  $('recordFood').value = '';
  $('recordMeal').value = mealFromTs(Date.now());
  $('dlgOk').textContent = '记入';
  $('dlgOk').className = 'dlg-btn ok';
  $('dlgCancel').textContent = '取消';
  dlgOnOk = async function(){
    var grams = Number($('recordGrams').value), food = $('recordFood').value, meal = $('recordMeal').value;
    if(!Number.isFinite(grams) || grams < 0.1 || grams > PROTEIN_MAX_SINGLE){
      showToast('请输入 0.1–500 g 之间的数字', 'error'); $('recordGrams').focus(); return;
    }
    $('dlgOk').disabled = true;
    if(await addProtein(grams, food || '手动记录', 'manual', {meal:meal})){ closeDialog(); }
    $('dlgOk').disabled = false;
  };
  openDialog();
  window.setTimeout(function(){ $('recordGrams').focus(); }, 60);
}
$('dlgFields').addEventListener('keydown', function(e){
  if(e.key === 'Enter' && e.target.tagName === 'INPUT' && !$('dlgOk').disabled){ e.preventDefault(); if(dlgOnOk){ dlgOnOk(); } }
});
$('quickProtein').addEventListener('click', openManualProtein);
$('quickWater').addEventListener('click', function(){ addWater(350); });
if($('btnWater500')){ $('btnWater500').addEventListener('click', function(){ addWater(500); }); }
$('btnLogWeight').addEventListener('click', function(){
  var last = latestWeight();
  showPrompt('记下现在的体重（kg）。不想称就取消。', last ? String(last.kg) : '', function(v){
    if(v === '' || v == null){ return; }
    var n = Number(v);
    if(!Number.isFinite(n) || n < WEIGHT_KG_MIN || n > WEIGHT_KG_MAX){
      showToast('请输入 ' + WEIGHT_KG_MIN + '–' + WEIGHT_KG_MAX + ' 之间的数字', 'error'); return;
    }
    showPrompt('腰围厘米（可空，呼气末、皮尺不勒肉）：', last && last.waist ? String(last.waist) : '', function(w){
      addWeight(n, w);
    }, { title:'腰围（可选）', okText:'记下', type:'number', placeholder:'可留空' });
  }, { title:'记体重', okText:'下一步', type:'number', placeholder:'例如 80' });
});
document.querySelectorAll('[data-walk]').forEach(function(b){
  b.addEventListener('click', function(){ addWalk(Number(b.getAttribute('data-walk'))); });
});
if($('fiberRow')){
  $('fiberRow').addEventListener('click', async function(e){
    var btn = e.target.closest('[data-fiber]');
    if(!btn){ return; }
    var which = btn.getAttribute('data-fiber');
    if(!await mutateState(function(){
      ensureFiberDay();
      if(which === 'veg'){ S.settings.fiberVeg = !S.settings.fiberVeg; }
      if(which === 'soy'){ S.settings.fiberSoy = !S.settings.fiberSoy; }
      if(which === 'grain'){ S.settings.fiberGrain = !S.settings.fiberGrain; }
    })){ return; }
    renderFiberRow();
  });
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
  var now = new Date(), logs = todayProteinLogs(), idx = getLogIndex();
  $('todayDate').textContent = (now.getMonth()+1) + '月' + now.getDate() + '日 · 星期' + WEEK_CN[now.getDay()];
  var total = Math.round(logs.reduce(function(sum,l){ return sum + (Number(l.grams)||0); },0)*10)/10;
  var target = S.settings.proteinTarget, remain = Math.max(0, Math.round((target-total)*10)/10);
  $('pToday').textContent = total; $('pTarget').textContent = target;
  $('pBar').style.width = Math.min(100, Math.round(total/target*100)) + '%';
  $('pBarWrap').classList.toggle('done',total >= target);
  $('pLeft').textContent = !logs.length ? '按实际吃的记录，慢慢接近目标。' : (remain ? '距目标还差 ' + remain + ' g' : '今天的蛋白目标已完成');
  $('pAside').textContent = logs.length ? '已记 ' + logs.length + ' 笔' : '今天还没记';
  $('todayLogCount').textContent = logs.length + ' 笔';
  $('todayLogDetails').hidden = !logs.length;
  $('weekStrengthNum').textContent = countWeekStrengthDays(idx.trainingSessions,now.getTime());
  $('streakNum').textContent = countRecentTrainingDays(idx.trainingDays);
  renderQuickFoods(); renderBodyCard(now.getTime()); renderFiberRow();
  var box = $('todayLogs'); box.innerHTML = '';
  logs.forEach(function(l){
    var div = document.createElement('div'); div.className = 'log-item';
    var meal = MEAL_NAMES[l.meal] || MEAL_NAMES[mealFromTs(l.ts)];
    div.innerHTML = '<div class="log-info"><span class="f">' + escapeHtml(l.food) + '</span><span class="t">' + escapeHtml(meal) + ' · ' + fmtTime(l.ts) + '</span></div>' +
      '<span class="g num">' + l.grams + '<small> g</small></span><button class="del" aria-label="删除' + escapeHtml(l.food) + '">删除</button>';
    div.querySelector('.del').addEventListener('click',function(){ deleteLog(l.id); }); box.appendChild(div);
  });
  var stretch = S.settings.routine === 'stretch', active = sessionInProgress();
  $('tName').textContent = routineNames[S.settings.routine] || '徒手基础';
  $('tDesc').textContent = active ? '本次已暂停，可以接着练' : ((stretch ? '放松拉伸' : presetNames[S.settings.preset]) + ' · ' + (Math.round(totalDurationEstimate()/6)/10) + ' 分钟');
  $('tGo').textContent = active ? '继续' : '去跟练';
  $('tDone').hidden = !trainedToday();
  $('walkToday').textContent = '今日 ' + ((idx.walkByDay && idx.walkByDay[dayStart(now.getTime())]) || 0) + ' 分钟';
}
function renderQuickFoods(){
  var box = $('quickFoods');
  var liq = $('liquidFoods');
  if(!box){ return; }
  if(box.dataset.ready !== '1'){
    box.innerHTML = '';
    if(liq){ liq.innerHTML = ''; }
    QUICK_FOODS.forEach(function(f){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.innerHTML = escapeHtml(f.food) + '<small>≈' + f.grams + 'g</small>';
      b.addEventListener('click', async function(){
        if($('dlgOk').disabled){ return; }
        $('dlgOk').disabled = true;
        if(await addProtein(f.grams, f.food, 'quick', {meal:$('recordMeal').value})){ closeDialog(); }
        $('dlgOk').disabled = false;
      });
      (f.liquid && liq ? liq : box).appendChild(b);
    });
    box.dataset.ready = '1';
  }
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
  var last = latestWeight();
  if(last){
    var when = last.ts ? ((new Date(last.ts).getMonth()+1) + '/' + new Date(last.ts).getDate() + ' · ') : '';
    var waist = last.waist ? (' · 腰围 ' + last.waist + 'cm') : '';
    $('weightVal').innerHTML = when + '<span class="num">' + last.kg + '</span><small>kg</small>' + waist;
  } else {
    $('weightVal').textContent = '未记录';
  }
  var avg = weekAvgWeight();
  if($('weightHintLine')){
    $('weightHintLine').textContent = avg ? ('近7天平均 ' + avg + ' kg') : '记下几次后，就能在回顾里看趋势。';
  }
}
function renderFiberRow(){
  ensureFiberDay();
  document.querySelectorAll('#fiberRow .fiber-btn').forEach(function(b){
    var key = 'fiber' + b.getAttribute('data-fiber').charAt(0).toUpperCase() + b.getAttribute('data-fiber').slice(1);
    if(b.getAttribute('data-fiber') === 'veg') key = 'fiberVeg';
    if(b.getAttribute('data-fiber') === 'soy') key = 'fiberSoy';
    if(b.getAttribute('data-fiber') === 'grain') key = 'fiberGrain';
    b.classList.toggle('on', S.settings[key] === true);
    b.setAttribute('aria-pressed', String(S.settings[key] === true));
  });
}
function totalDurationEstimate(){
  return createPlan().reduce(function(sum, step){ return sum + step.sec; }, 0);
}
$('tGo').addEventListener('click', function(){ goPage('training'); });

/* ---- 训练页 ---- */
function renderTraining(){
  var isStretch = S.settings.routine === 'stretch', active = sessionInProgress();
  var cfg = presets[S.settings.preset] || presets.starter;
  $('routineGear').textContent = routineGear[S.settings.routine] || '';
  $('routineDose').textContent = isStretch ? stretchDoseLabel() : '每个 ' + cfg.work + ' 秒 · ' + cfg.rounds + ' 轮';
  document.querySelectorAll('#routineSeg button').forEach(function(b){ var on=b.dataset.routine === S.settings.routine; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
  document.querySelectorAll('#presetSeg button').forEach(function(b){ var on=b.dataset.preset === S.settings.preset; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
  document.querySelectorAll('#readyRow button').forEach(function(b){ var on=b.dataset.ready === getReadiness(); b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
  $('presetSection').hidden = isStretch; $('readySection').hidden = isStretch;
  $('trainingName').textContent = routineNames[S.settings.routine];
  $('trainingLevel').textContent = isStretch ? '放松' : presetNames[S.settings.preset];
  $('durHint').textContent = Math.round(totalDurationEstimate()/6)/10 + ' 分钟';
  var count = moves.length;
  $('roundHint').textContent = isStretch ? count + ' 个拉伸动作' : count + ' 个动作 · 含热身与放松';
  $('routinePlanNote').textContent = isStretch ? '点动作看做法；拉到发紧就停，不弹震、不憋气。' : '点动作看做法；开始后会先热身，最后带你放松。';
  $('readyHint').hidden = getReadiness() === 'green';
  $('readyHint').textContent = getReadiness() === 'yellow' ? '已切到恢复档。轻松一点，不适就停。' : '今天先休息。严重或持续不适，请联系医疗人员。';
  $('readyHint').classList.toggle('danger-text',getReadiness() === 'red');
  $('btnStart').disabled = getReadiness() === 'red' && !isStretch;
  $('btnStart').textContent = active ? '继续跟练' : (isStretch ? '开始拉伸' : '开始跟练');
  renderMoveList();
}
function stretchDoseLabel(){
  var sec = 0;
  moves.forEach(function(m){ sec = Math.max(sec, m.sec || 0); });
  return '每个动作约 ' + sec + ' 秒';
}
function renderMoveList(){
  var box = $('routineMoves');
  box.innerHTML = '';
  var isStretch = S.settings.routine === 'stretch';
  moves.forEach(function(m, i){
    var row = document.createElement('button');
    row.type = 'button'; row.className = 'sequence-move';
    var sub = isStretch ? (m.target + ' · ' + m.position) : (m.primary || m.area);
    var last = (!isStretch && liftKind(m)) ? formatLiftLine(m) : '';
    if(last && last !== '还没记过'){ sub += ' · ' + last.replace('上次：',''); }
    row.innerHTML = '<span class="sequence-number num">' + pad2(i+1) + '</span>'
      + '<span class="sequence-body"><span class="sequence-name">' + escapeHtml(m.name) + '</span>'
      + '<span class="sequence-sub">' + escapeHtml(sub) + '</span></span>'
      + '<span class="chev" aria-hidden="true">›</span>';
    row.addEventListener('click', function(){ if(isStretch){ openStretchDetail(m); } else { openMoveDetail(m); } });
    box.appendChild(row);
  });
}
function canChangePlan(){
  if(session.phase === PHASE.finishing || sessionInProgress()){ showToast('先继续或结束本次跟练，再调整课程。'); return false; }
  return true;
}
$('routineSeg').addEventListener('click', async function(e){
  var btn = e.target.closest('[data-routine]');
  if(!btn || !canChangePlan()){ return; }
  if(!await mutateState(function(){ S.settings.routine = btn.dataset.routine; })){ return; }
  moves = routines[btn.dataset.routine];
  resetWorkout(); renderTraining(); renderToday();
});
$('presetSeg').addEventListener('click', async function(e){
  var btn = e.target.closest('[data-preset]');
  if(!btn || !canChangePlan()){ return; }
  if(getReadiness() === 'yellow' && btn.dataset.preset !== 'recovery'){
    var preset = btn.dataset.preset;
    showConfirm('你今天状态一般，恢复档更安全。确定要切换到 ' + preset + ' 档吗？', async function(){
      if(!await mutateState(function(){ S.settings.preset = preset; })){ return; }
      resetWorkout(); renderTraining(); renderToday();
    }, { title:'切换档位', okText:'仍要切换' });
    return;
  }
  if(!await mutateState(function(){ S.settings.preset = btn.dataset.preset; })){ return; }
  resetWorkout(); renderTraining(); renderToday();
});
$('readyRow').addEventListener('click', async function(e){
  var btn = e.target.closest('[data-ready]');
  if(!btn || !canChangePlan()){ return; }
  if(!await mutateState(function(){
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
async function openWorkoutPlan(preview){
  await storageInit; await mutationQueue;
  if(session.phase === PHASE.finishing){ return; }
  if(sessionInProgress()){ if(preview === true){ openPlanPreview(); } else { startWorkout(); } return; }
  if(getReadiness() === 'red' && S.settings.routine !== 'stretch'){ showToast('今天身体不适，请先休息', 'error'); return; }
  resetWorkout();
  if(preview === true){ openPlanPreview(); } else { startWorkout(); }
}
$('btnStart').addEventListener('click', function(){ openWorkoutPlan(false); });
$('btnPlan').addEventListener('click', function(){ openWorkoutPlan(true); });

/* ---- 练前计划预览 ---- */
var planModal = $('planModal');
function planSummary(){
  var warm = 0, work = 0, stretch = 0, rest = 0, rounds = 0;
  var warmNames = [], workNames = [], stretchNames = [], seenWork = {};
  session.steps.forEach(function(s){
    if(s.type === 'warmup'){ warm += s.sec; warmNames.push(s.move.name); }
    else if(s.type === 'work'){ work += s.sec; rounds = Math.max(rounds, s.round); if(!seenWork[s.move.id]){ seenWork[s.move.id] = true; workNames.push(s.move.name); } }
    else if(s.type === 'stretch'){ stretch += s.sec; stretchNames.push(s.move.name); }
    else { rest += s.sec; }
  });
  return { warm:warm, work:work, stretch:stretch, rest:rest, rounds:rounds, warmNames:warmNames, workNames:workNames, stretchNames:stretchNames };
}
function sec2m(s){ return (Math.round(s/6)/10) + ' 分钟'; }
function openPlanPreview(){
  var sm = planSummary();
  var isStretch = S.settings.routine === 'stretch';
  $('planTotal').textContent = (Math.round((sm.warm + sm.work + sm.stretch + sm.rest)/6)/10);
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
  if(sm.rest){ body.insertAdjacentHTML('beforeend', '<div class="plan-sec"><span class="tag">休息</span><div class="body"><div class="h">动作间与轮间 · 约 ' + sec2m(sm.rest) + '</div></div></div>'); }
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
  if(!m || m.noMedia){ wrap.hidden = true; img.hidden = false; img.removeAttribute('src'); return; }
  wrap.hidden = false;
  var src = imagePath(m, motionOn());
  preloadMove(m, true);
  img.hidden = false;
  img.src = src;
  img.alt = m.name + ' 示范';
  // 示范拍的是另一个变体时，跟练角标已经说过；详情里图是主角，说明必须跟着图。
  // 分步示意图自己不带说明：播放器角标就压在图的下沿，图里再烤一行会叠成两个标签。
  var note = $('mdMediaNote');
  var noteTx = m ? (m.mediaNote || (m.frames ? '' : m.mediaLabel)) : '';
  if(note){ note.textContent = noteTx; note.hidden = !noteTx; }
}
/* 示范取不到（离线首装、iOS 回收了缓存）时不能留一个方框大的空图：
   收掉图，把图注位改成说明，下面的文字步骤本来就在。 */
$('mdMedia').addEventListener('error', function(){
  this.hidden = true;
  var note = $('mdMediaNote');
  if(note){ note.textContent = '示范暂不可用 · 照着下面的文字步骤'; note.hidden = false; }
});
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
  $('mdArea').textContent = '拉到 ' + m.target + ' · ' + m.position + ' · ' +
    (m.sideMode === 'half' ? '全程约 ' + m.sec + ' 秒，左右各一半' : '保持约 ' + m.sec + ' 秒');
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
  $('mdLiftSave').addEventListener('click', async function(){
    if(!mdLiftMove){ return; }
    var kind = liftKind(mdLiftMove);
    var set = kind === 'load'
      ? normalizeLiftSet({ kg: $('mdKg').value, reps: $('mdReps').value })
      : normalizeLiftSet({ level: mdLiftMove._lv });
    if(!set){ showToast('先填重量或次数', 'error'); return; }
    if(!await mutateState(function(){ upsertLiftRec(mdLiftMove.id, set); })){ return; }
    renderTraining();
    showToast('已记下 ' + formatLiftLine(mdLiftMove).replace('上次：',''), 'success');
  });
}

/* ---- 数据页 ---- */
function countProteinDays(n, idx){
  idx = idx || getLogIndex();
  var today0 = dayStart(Date.now());
  var c = 0;
  for(var i = 0; i < n; i++){
    if((idx.proteinByDay[today0 - i * 86400000] || 0) > 0){ c++; }
  }
  return c;
}
function weekWalkMinutes(now, idx){
  idx = idx || getLogIndex();
  var start = weekStart(now || Date.now());
  var end = start + 7 * 86400000;
  var sum = 0;
  Object.keys(idx.walkByDay || {}).forEach(function(k){
    var t = Number(k);
    if(t >= start && t < end){ sum += idx.walkByDay[k] || 0; }
  });
  return sum;
}
function renderData(){
  var idx = getLogIndex();
  var sessions = idx.trainingSessions;
  if($('stWeek')){ $('stWeek').textContent = countWeekStrengthDays(sessions, Date.now()); }
  if($('stSessions')){ $('stSessions').textContent = sessions.length; }
  var today0 = dayStart(Date.now());
  var sum7 = 0;
  for(var i = 0; i < 7; i++){
    sum7 += idx.proteinByDay[today0 - i * 86400000] || 0;
  }
  if($('stAvg')){ $('stAvg').textContent = Math.round(sum7 / 7); }
  var recordedDays = countProteinDays(7, idx);
  $('proteinCoverage').textContent = '记录了 ' + recordedDays + ' / 7 天。未记录不代表没有摄入。';
  if($('stProteinDays')){ $('stProteinDays').textContent = countProteinDays(7, idx); }
  var avgW = weekAvgWeight();
  if($('stWeight')){ $('stWeight').textContent = avgW != null ? avgW : '—'; }
  if($('stWalk')){ $('stWalk').textContent = weekWalkMinutes(Date.now(), idx); }

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
  if($('chartTarget')){ $('chartTarget').textContent = '目标 ' + target + ' g · 绿色表示达到目标'; }
  if($('chartAside')){ $('chartAside').textContent = '日均 ' + ( $('stAvg') ? $('stAvg').textContent : Math.round(sum7 / 7) ) + 'g'; }

  renderArchive();
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
  var avg = weekAvgWeight();
  if(aside){
    aside.textContent = last
      ? (last.kg + ' kg' + (avg != null ? (' · 7日均 ' + avg) : '') + (last.waist ? (' · 腰 ' + last.waist) : ''))
      : '';
  }
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
  setText('backupStatus', S.lastBackupAt ? '上次导出：' + new Date(S.lastBackupAt).toLocaleDateString() + '。请确认文件已保存。' : '还未导出备份，建议定期保存一份。');
  setText('targetVal', S.settings.proteinTarget);
  var bw = S.settings.bodyWeightKg || (latestWeight() && latestWeight().kg) || 0;
  setText('weightSetVal', bw ? bw : '—');
  setText('heightSetVal', S.settings.heightCm ? S.settings.heightCm : '—');
  var adj = adjustedWeightKg(bw, S.settings.heightCm);
  var sug = suggestedProteinTarget(bw, S.settings.proteinPerKg, S.settings.heightCm, 'adjusted');
  if(bw && adj && S.settings.heightCm && adj < bw){
    setText('weightHint', bw + ' kg · 调整体重 ' + adj + ' kg（BMI 较高时不全按实际体重算蛋白）');
    setText('targetHint', sug ? ('按调整体重约 ' + sug + ' g，也可手改小一点先执行') : '可手改目标');
  } else {
    setText('weightHint', bw ? ('当前 ' + bw + ' kg') : '用来按体重估算蛋白目标');
    setText('targetHint', sug ? ('按体重约 ' + sug + ' g，也可手改') : '先记下体重和身高，或直接手改目标');
  }
  setText('perKgVal', S.settings.proteinPerKg);
  setText('waterTargetVal', S.settings.waterTarget);
  if($('setSound')){ $('setSound').checked = S.settings.sound !== false; }
  if($('setVoice')){ $('setVoice').checked = S.settings.voice !== false; }
  if($('setMotion')){ $('setMotion').checked = S.settings.motion !== false; }
  renderVoiceHint();
}

function renderVoiceHint(){
  var el = $('voiceHint');
  if(!el){ return; }
  var silent = (C.SILENT_VOICE && Object.keys(C.SILENT_VOICE).length) || 0;
  el.textContent = silent
    ? '跟练播预录御姐女声；' + silent + ' 个动作无预录，保持静音。'
    : '跟练播预录御姐女声；没有对应文件时静音。';
}
$('btnVoicePreview').addEventListener('click', function(){
  if(!voiceEnabled()){ showToast('语音指导未开启', 'error'); return; }
  unlockVoice();
  speak('坚持住，就快完成了', { voiceKey:'encourage-1', showError:true });
});
$('btnSetTarget').addEventListener('click', function(){
  showPrompt('设置每日蛋白目标（20–300 g）：', String(S.settings.proteinTarget), async function(t){
    if(t === '' || t == null){ return; }
    var n = Number(t);
    if(!Number.isFinite(n) || n < 20 || n > 300){ showToast('请输入 20–300 之间的数字', 'error'); return; }
    if(!await mutateState(function(){ S.settings.proteinTarget = Math.round(n); })){ renderSettings(); return; }
    renderSettings(); renderToday();
    showToast('目标已更新为 ' + Math.round(n) + 'g', 'success');
  }, { title:'蛋白目标', okText:'保存', type:'number', placeholder:'100' });
});
if($('btnSetHeight')){
  $('btnSetHeight').addEventListener('click', function(){
    var cur = S.settings.heightCm || '';
    showPrompt('身高厘米（用来按调整体重估算蛋白，可不填）：', cur ? String(cur) : '', async function(v){
      if(v === '' || v == null){ return; }
      var n = Number(v);
      if(!Number.isFinite(n) || n < HEIGHT_CM_MIN || n > HEIGHT_CM_MAX){
        showToast('请输入 ' + HEIGHT_CM_MIN + '–' + HEIGHT_CM_MAX + ' 之间的数字', 'error'); return;
      }
      if(!await mutateState(function(){ S.settings.heightCm = Math.round(n); })){ renderSettings(); return; }
      renderSettings();
      var kg = S.settings.bodyWeightKg || (latestWeight() && latestWeight().kg);
      var sug = suggestedProteinTarget(kg, S.settings.proteinPerKg, S.settings.heightCm, 'adjusted');
      if(sug && sug !== S.settings.proteinTarget){
        showConfirm('按调整体重，把蛋白目标改成 ' + sug + ' g？也可继续用手改。', function(){
          applyProteinFromWeight();
        }, { title:'按身高更新目标', okText:'改成 ' + sug + ' g' });
      } else {
        showToast('身高已记下', 'success');
      }
    }, { title:'身高', okText:'保存', type:'number', placeholder:'例如 175' });
  });
}
$('btnSetWeight').addEventListener('click', function(){
  var cur = S.settings.bodyWeightKg || (latestWeight() && latestWeight().kg) || '';
  showPrompt('当前体重（kg）：', cur ? String(cur) : '', async function(v){
    if(v === '' || v == null){ return; }
    var n = Number(v);
    if(!Number.isFinite(n) || n < WEIGHT_KG_MIN || n > WEIGHT_KG_MAX){
      showToast('请输入 ' + WEIGHT_KG_MIN + '–' + WEIGHT_KG_MAX + ' 之间的数字', 'error'); return;
    }
    if(!await addWeight(n)){ return; }
    var sug = suggestedProteinTarget(n, S.settings.proteinPerKg, S.settings.heightCm, 'adjusted');
    if(sug && sug !== S.settings.proteinTarget){
      var adj = adjustedWeightKg(n, S.settings.heightCm);
      var used = (adj && S.settings.heightCm) ? adj : n;
      showConfirm('按 ' + used + ' kg × ' + S.settings.proteinPerKg + '，把蛋白目标改成 ' + sug + ' g？可手改小一点。', function(){
        applyProteinFromWeight();
      }, { title:'按体重更新目标', okText:'改成 ' + sug + ' g' });
    }
  }, { title:'当前体重', okText:'保存', type:'number', placeholder:'例如 80' });
});
$('btnSetPerKg').addEventListener('click', function(){
  showPrompt('每公斤体重记多少克蛋白（0.8–2.5）：', String(S.settings.proteinPerKg), async function(v){
    if(v === '' || v == null){ return; }
    var n = Number(v);
    if(!Number.isFinite(n) || n < PROTEIN_PER_KG_MIN || n > PROTEIN_PER_KG_MAX){
      showToast('请输入 ' + PROTEIN_PER_KG_MIN + '–' + PROTEIN_PER_KG_MAX, 'error'); return;
    }
    n = Math.round(n * 10) / 10;
    if(!await mutateState(function(){ S.settings.proteinPerKg = n; })){ renderSettings(); return; }
    renderSettings();
    showToast('已设为 ' + n + ' g/kg', 'success');
  }, { title:'每公斤蛋白', okText:'保存', type:'number', placeholder:'1.4' });
});
$('btnUseWeightTarget').addEventListener('click', function(){ applyProteinFromWeight(); });
$('btnSetWater').addEventListener('click', function(){
  showPrompt('每日饮水目标（500–6000 ml）：', String(S.settings.waterTarget), async function(v){
    if(v === '' || v == null){ return; }
    var n = Number(v);
    if(!Number.isFinite(n) || n < WATER_ML_MIN || n > WATER_ML_MAX){
      showToast('请输入 ' + WATER_ML_MIN + '–' + WATER_ML_MAX, 'error'); return;
    }
    if(!await mutateState(function(){ S.settings.waterTarget = Math.round(n); })){ renderSettings(); return; }
    renderSettings(); renderToday();
    showToast('饮水目标 ' + Math.round(n) + ' ml', 'success');
  }, { title:'饮水目标', okText:'保存', type:'number', placeholder:'2000' });
});
['setSound','setVoice','setMotion'].forEach(function(id){
  $(id).addEventListener('change', async function(){
    var key = id === 'setSound' ? 'sound' : (id === 'setVoice' ? 'voice' : 'motion');
    var val = $(id).checked;
    if(!await mutateState(function(){ S.settings[key] = val; })){ renderSettings(); }
  });
});

function downloadJson(payload, filename, rawText){
  var a = document.createElement('a'), url = URL.createObjectURL(new Blob([rawText ? payload : JSON.stringify(payload, null, 2)], {type:'application/json'}));
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(function(){ URL.revokeObjectURL(url); }, 30000);
}
function monthKey(ts){ var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
var archiveLimit = 30;
function monthEntries(month){
  return S.logs.filter(function(l){ return monthKey(l.ts) === month; }).concat(
    S.weights.filter(function(w){ return monthKey(w.ts) === month; }).map(function(w){ return {type:'weight', ts:w.ts, kg:w.kg}; })
  ).sort(function(a,b){ return b.ts - a.ts; });
}
function renderArchive(){
  var field = $('archiveMonth');
  if(!field.value){ field.value = monthKey(Date.now()); }
  var entries = monthEntries(field.value);
  $('archiveSummary').textContent = entries.length + ' 条记录 · 当前显示 ' + Math.min(entries.length, archiveLimit) + ' 条';
  $('archiveList').innerHTML = entries.slice(0, archiveLimit).map(function(l){
    var label = l.type === 'protein' ? l.food : ({water:'饮水', walk:'走路', weight:'体重', training:routineNames[l.routine] || '训练'}[l.type]);
    var amount = l.type === 'protein' ? l.grams + 'g' : (l.type === 'water' ? l.ml + 'ml' : (l.type === 'weight' ? l.kg + 'kg' : Math.round((l.minutes || (l.actualSeconds || 0)/60) * 10)/10 + '分'));
    return '<div class="log-item"><span class="t">' + new Date(l.ts).getDate() + '日 ' + fmtTime(l.ts) + '</span><span class="f">' + escapeHtml(label || '记录') + '</span><span class="g">' + escapeHtml(amount) + '</span></div>';
  }).join('') || '<div class="empty-hint">这个月还没有记录</div>';
  $('archiveMore').hidden = entries.length <= archiveLimit;
  $('btnArchiveExport').disabled = !entries.length;
}
$('archiveMonth').addEventListener('change', function(){ archiveLimit = 30; renderArchive(); });
$('archiveMore').addEventListener('click', function(){ archiveLimit += 30; renderArchive(); });
$('btnArchiveExport').addEventListener('click', function(){
  var month = $('archiveMonth').value;
  downloadJson({kind:'qingdaka-monthly-archive', month:month, logs:S.logs.filter(function(l){ return monthKey(l.ts) === month; }), weights:S.weights.filter(function(w){ return monthKey(w.ts) === month; })}, '轻打卡月度记录_' + month + '.json');
  showToast('本月记录已生成；完整迁移请使用「我的 → 导出备份」');
});
$('btnExport').addEventListener('click', async function(){
  await storageInit; await mutationQueue;
  var payload = S, prefix = '轻打卡备份_', rawText = false;
  if(storageReadOnly){
    try{
      var original = __boot.rawText || window.localStorage.getItem(V5KEY) || window.localStorage.getItem(CORRUPT_KEY);
      if(original != null){ payload = original; rawText = true; prefix = '轻打卡原始数据_'; }
    }catch(e){}
    if(!rawText){ showToast('未能读取原始数据，当前没有生成备份。', 'error'); return; }
  }
  downloadJson(payload, prefix + monthKey(Date.now()) + '-' + pad2(new Date().getDate()) + '.json', rawText);
  if(!storageReadOnly){ await mutateState(function(){ S.lastBackupAt = Date.now(); }); }
  renderSettings();
  showToast('备份文件已生成，请确认下载已保存', 'success');
});
$('btnImport').addEventListener('click', function(){ $('importFile').click(); });
$('importFile').addEventListener('change', async function(e){
  var f = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!f){ return; }
  if(f.size > IMPORT_MAX_BYTES){ showToast('备份文件超过 20MB，请先分开检查', 'error'); return; }
  try{
    var raw = migrateState(JSON.parse(await f.text()));
    if(!raw || !Array.isArray(raw.logs) || !Array.isArray(raw.weights)){ throw new Error('bad-backup'); }
    var next = hydrateState(raw);
    var invalid = raw.logs.length + raw.weights.length - next.logs.length - next.weights.length;
    if(invalid){ showToast('备份有 ' + invalid + ' 条无效记录，未导入。请先检查文件。', 'error'); return; }
    var dates = next.logs.concat(next.weights).map(function(l){ return l.ts; }).sort(function(a,b){ return a-b; });
    var span = dates.length ? '，时间 ' + new Date(dates[0]).toLocaleDateString() + ' 至 ' + new Date(dates[dates.length-1]).toLocaleDateString() : '';
    showConfirm('将覆盖本机 ' + S.logs.length + ' 条记录，导入 ' + next.logs.length + ' 条记录、' + next.weights.length + ' 条体重' + span + '。请先保留当前备份。', async function(){
      if(!await mutateState(function(){ S = next; }, true)){ return; }
      moves = routines[S.settings.routine] || routines.bodyweight;
      resetWorkout(); renderAll();
      showToast('备份已导入并保存', 'success');
    }, {title:'核对备份内容', okText:'覆盖导入', danger:true});
  }catch(err){ showToast('不是有效的完整备份文件，当前记录未改变', 'error'); }
});
$('btnClear').addEventListener('click', function(){
  showConfirm('清空全部本机记录？请先导出完整备份。', function(){
    showConfirm('确定清空？此操作不可恢复。', async function(){
      if(!await mutateState(function(){ S = defaultState(); }, true)){ return; }
      try{ window.localStorage.removeItem(CORRUPT_KEY); }catch(e){}
      moves = routines[S.settings.routine];
      resetWorkout(); renderAll(); showToast('本机数据已清空');
    }, {title:'再次确认', okText:'确认清空', danger:true});
  }, {title:'清空数据', okText:'继续', danger:true});
});

/* ---- 总渲染 ---- */
function renderAll(){
  renderToday();
  if(document.getElementById('page-training').classList.contains('active')){ renderTraining(); }
  if(document.getElementById('page-data').classList.contains('active')){ renderData(); }
  if(document.getElementById('page-me').classList.contains('active')){ renderSettings(); }
}

/* ---- 离线准备与用户确认更新 ---- */
var appRegistration = null, updateRequested = false, offlineProbe = 0;
function updateOfflineStatus(){
  showWaitingUpdate();
  if(!$('offlineStatus')){ return; }
  var probe = ++offlineProbe;
  var active = appRegistration && appRegistration.active;
  if(!active){ setText('offlineStatus', '离线资源准备中，完成前请保持联网。'); return; }
  var channel = new MessageChannel();
  var timeout = window.setTimeout(function(){
    channel.port1.close();
    if(probe === offlineProbe){ setText('offlineStatus', '暂未确认离线准备状态，请联网检查更新。'); }
  }, 4000);
  channel.port1.onmessage = function(e){
    window.clearTimeout(timeout);
    channel.port1.close();
    if(probe !== offlineProbe){ return; }
    setText('offlineStatus', e.data && e.data.ready
      ? '可离线打开。示范图在联网浏览后保存。'
      : '离线资源尚不完整，请联网重新打开后检查。');
  };
  active.postMessage({type:'OFFLINE_STATUS'}, [channel.port2]);
}
function showWaitingUpdate(){
  if($('btnUpdateApp')){ $('btnUpdateApp').hidden = !(appRegistration && appRegistration.waiting); }
}
if($('btnUpdateApp')){ $('btnUpdateApp').addEventListener('click', async function(){
  if(sessionInProgress()){ showToast('请先结束并记录本次训练，再更新应用'); return; }
  await mutationQueue;
  if(appRegistration && appRegistration.waiting){
    updateRequested = true;
    appRegistration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
  }
}); }
if('serviceWorker' in navigator){
  window.addEventListener('load', async function(){
    try{
      appRegistration = await navigator.serviceWorker.register('./sw.js');
      showWaitingUpdate();
      appRegistration.addEventListener('updatefound', function(){
        var installing = appRegistration.installing;
        if(installing){ installing.addEventListener('statechange', function(){
          if(installing.state === 'installed'){ showWaitingUpdate(); updateOfflineStatus(); }
          if(installing.state === 'redundant'){ setText('offlineStatus', '本次离线更新未完成，现有版本仍可继续使用。'); }
        }); }
      });
      await navigator.serviceWorker.ready;
      updateOfflineStatus();
      appRegistration.update().catch(function(){});
    }catch(e){ setText('offlineStatus', '本次未能启用离线功能，请保持联网使用。'); }
  });
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if(updateRequested || !sessionInProgress()){ window.location.reload(); }
    else { updateOfflineStatus(); }
  });
} else { setText('offlineStatus', '当前浏览器不支持离线安装，请保持联网使用。'); }

/* ---- 初始化 ---- */
try{
  buildSteps();
  renderToday();
  renderSettings();
}catch(e){ reportAppError(e); }
storageInit = Promise.resolve();
storageReady = true;
if(storageReadOnly){ showToast('数据读取异常，原文已保留。请到「我的」导出或导入备份。', 'error'); }

/* ---- 跨标签页同步 ---- */
window.addEventListener('storage', function(e){
  if(e.key !== V5KEY){ return; }
  mutationQueue = mutationQueue.then(function(){
    var fresh = readState().state;
    if(fresh && fresh.updatedAt > (S.updatedAt || 0)){
      S = fresh; bumpLogIndex();
      if(!sessionInProgress()){ moves = routines[S.settings.routine]; buildSteps(); }
      renderAll();
    }
  }).catch(function(){ return false; });
});

/* ---- 测试钩子：仅在 test.html 设置 window.__EXPOSE_FOR_TEST__ 时暴露纯函数 ---- */
if(window.__EXPOSE_FOR_TEST__){
  window.__T = {
    normalizeLogs:normalizeLogs, normalizeSettings:normalizeSettings, normalizeWeights:normalizeWeights,
    isActualTraining:isActualTraining,
    clampNumber:clampNumber, cleanText:cleanText, isPlainObject:isPlainObject, escapeHtml:escapeHtml,
    dayStart:dayStart, uid:uid, migrateState:migrateState, defaultState:defaultState, pad2:pad2,
    computeTrainingStreak:computeTrainingStreak, rebuildLogIndexFromLogs:rebuildLogIndexFromLogs,
    getRoutineIds:function(){ return ROUTINE_IDS.slice(); },
    getRoutineMoveIds:function(r){ return (routines[r] || []).map(function(m){ return m.id; }); },
    mealFromTs:mealFromTs,
    suggestedProteinTarget:suggestedProteinTarget, adjustedWeightKg:adjustedWeightKg, idealWeightKg:idealWeightKg,
    weekStart:weekStart, weekAvgWeight:weekAvgWeight,
    isStrengthTraining:isStrengthTraining, countWeekStrengthDays:countWeekStrengthDays,
    liftKind:liftKind, normalizeLifts:normalizeLifts, normalizeLiftSet:normalizeLiftSet,
    suggestNextKg:suggestNextKg, formatLiftLine:formatLiftLine, nextLevelId:nextLevelId,
    /* ---- P1-4: 跟练计时内部状态（仅供测试） ---- */
    captureStepProgress:captureStepProgress,
    resetSessionStats:resetSessionStats,
    buildSteps:buildSteps,
    getSteps:function(){ return session.steps; },
    setSteps:function(v){ session.steps = v; },
    getStepIndex:function(){ return session.stepIndex; },
    setStepIndex:function(v){ session.stepIndex = v; },
    getLeft:function(){ return session.left; },
    setLeft:function(v){ session.left = v; },
    getSessionElapsed:function(){ return session.elapsed; },
    getWorkElapsed:function(){ return session.workElapsed; },
    getStretchElapsed:function(){ return session.stretchElapsed; },
    getStepElapsedCounted:function(){ return session.stepCounted; },
    setStepElapsedCounted:function(v){ session.stepCounted = v; },
    getSkippedWork:function(){ return session.skippedWork; },
    getCompletedMoveIds:function(){ return session.completedMoveIds; },
    getCompletedStretchIds:function(){ return session.completedStretchIds; },
    getTotalDuration:function(){ return session.totalDuration; },
    getPresets:function(){ return presets; },
    getSettings:function(){ return S.settings; },
    setPreset:function(p){ S.settings.preset = p; },
    setRoutine:function(r){ S.settings.routine = r; moves = routines[r] || routines.bodyweight; }
  };
}
})();
