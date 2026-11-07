(function(){
'use strict';

/* Local-only v1 store. Only KEY is read or written; unrelated storage is ignored.
 * Async API: load(), transact(mutator), exportData(), importData(backup), reset().
 * Sync API: get() returns a state clone; subscribe(fn) returns unsubscribe;
 * exportRaw() returns this key's original string or null (cached on read failure).
 * Invalid stored data blocks normal mutations; importData/reset explicitly recover.
 * Web Locks cover read -> async mutator -> write. Without Web Locks, an empty
 * IndexedDB object store serializes compare-and-write: stale drafts are rejected,
 * never merged/retried. It contains no records or health data. Without either
 * primitive, writes fail closed; localStorage get/set alone is NOT a mutex.
 * All writers must use this module. Import/reset are explicit replacements;
 * their confirmation and the prohibition on importing during training belong to UI.
 */
var KEY = 'qingdaka-habits-v1';

var LOCK_NAME = KEY + ':write';
var GATE_DB = KEY + '-write-gate';
var IMPORT_MAX_BYTES = 20 * 1024 * 1024;
var MAX_TIMESTAMP = 8640000000000000;
// session.js uses the full ordered-plan JSON as an opaque signature, not a hash.
var MAX_PLAN_KEY_LENGTH = 64 * 1024;
var own = function(object, key){ return Object.prototype.hasOwnProperty.call(object, key); };
var queue = Promise.resolve();
var listeners = new Set();
var current = null;
var currentRaw;
var cachedRaw;
var readError = null;
var gateConnection = null;

function error(code, message){
  var err = new Error(message);
  err.name = 'QDKStoreError';
  err.code = code;
  return err;
}
function invalid(path, expected){
  throw error('INVALID_DATA', path + ': ' + expected);
}
function clone(value){ return JSON.parse(JSON.stringify(value)); }
function defaultState(){
  return {
    version:1, revision:0, updatedAt:0,
    settings:{onboarded:false, wakeTime:'', windDownTime:'', anchor:'lunch', focus:'move', sound:true, motion:true},
    days:{}, sessions:[], activeSession:null
  };
}
function plainObject(value, path){
  if(!value || typeof value !== 'object' || Array.isArray(value)){
    invalid(path, 'expected a plain JSON object');
  }
  var proto = Object.getPrototypeOf(value);
  // Accept JSON objects from another realm (including a vm), but not class instances.
  var constructor = proto && Object.getOwnPropertyDescriptor(proto, 'constructor');
  if(proto !== null && (Object.getPrototypeOf(proto) !== null || !constructor || typeof constructor.value !== 'function' || constructor.value.name !== 'Object')){
    invalid(path, 'expected a plain JSON object');
  }
  Reflect.ownKeys(value).forEach(function(key){
    var descriptor = Object.getOwnPropertyDescriptor(value, key);
    if(typeof key !== 'string' || !descriptor.enumerable || !own(descriptor, 'value')){
      invalid(path, 'only enumerable JSON data properties are allowed');
    }
  });
}
function fields(value, required, optional, path){
  plainObject(value, path);
  required.forEach(function(key){
    if(!own(value, key)){ invalid(path + '.' + key, 'missing required field'); }
  });
  Object.keys(value).forEach(function(key){
    if(required.indexOf(key) < 0 && optional.indexOf(key) < 0){ invalid(path + '.' + key, 'unknown field'); }
  });
}
function number(value, path, maximum){
  if(typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum){
    invalid(path, 'expected a finite nonnegative number <= ' + maximum);
  }
}
function integer(value, path){
  if(!Number.isSafeInteger(value) || value < 0){ invalid(path, 'expected a nonnegative safe integer'); }
}
function timestamp(value, path){ number(value, path, MAX_TIMESTAMP); }
function seconds(value, path){ number(value, path, Number.MAX_SAFE_INTEGER); }
function text(value, path, nonempty){
  if(typeof value !== 'string' || (nonempty && !value.trim())){ invalid(path, 'expected ' + (nonempty ? 'a nonempty string' : 'a string')); }
}
function boolean(value, path){
  if(typeof value !== 'boolean'){ invalid(path, 'expected a boolean'); }
}
function enumeration(value, values, path){
  if(values.indexOf(value) < 0){ invalid(path, 'expected one of ' + values.join(', ')); }
}
function validDate(value){
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)){ return false; }
  var year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  var lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= lengths[month - 1];
}
function date(value, path){
  if(!validDate(value)){ invalid(path, 'expected a real calendar date YYYY-MM-DD'); }
}
function time(value, path, allowEmpty){
  if(allowEmpty && value === ''){ return; }
  if(typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)){
    invalid(path, 'expected HH:MM' + (allowEmpty ? ' or an empty string' : ''));
  }
}
function isoTime(value, path){
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))){
    invalid(path, 'expected an ISO timestamp with a timezone');
  }
}
function validateSettings(settings){
  fields(settings, ['onboarded','wakeTime','windDownTime','anchor','focus','sound','motion'], [], 'state.settings');
  boolean(settings.onboarded, 'state.settings.onboarded');
  time(settings.wakeTime, 'state.settings.wakeTime', true);
  time(settings.windDownTime, 'state.settings.windDownTime', true);
  // The schema gives defaults, not an enum, for anchor/focus. Do not invent UI options.
  text(settings.anchor, 'state.settings.anchor', true);
  text(settings.focus, 'state.settings.focus', true);
  boolean(settings.sound, 'state.settings.sound');
  boolean(settings.motion, 'state.settings.motion');
}
function validateDay(day, path){
  fields(day, [], ['wakeTime','windDown','breaks','rest','note','updatedAt'], path);
  if(own(day, 'wakeTime')){ time(day.wakeTime, path + '.wakeTime', false); }
  if(own(day, 'windDown')){ boolean(day.windDown, path + '.windDown'); }
  if(own(day, 'breaks')){ integer(day.breaks, path + '.breaks'); }
  if(own(day, 'rest')){ boolean(day.rest, path + '.rest'); }
  if(own(day, 'note')){ text(day.note, path + '.note', false); }
  if(own(day, 'updatedAt')){ timestamp(day.updatedAt, path + '.updatedAt'); }
}
function validateSession(session, path){
  fields(session, ['id','date','startedAt','endedAt','courseId','mode','plannedSeconds','activeSeconds','elapsedSeconds','status','feedback','recovery'], [], path);
  text(session.id, path + '.id', true);
  date(session.date, path + '.date');
  timestamp(session.startedAt, path + '.startedAt');
  timestamp(session.endedAt, path + '.endedAt');
  text(session.courseId, path + '.courseId', true);
  enumeration(session.mode, ['seated','standing'], path + '.mode');
  seconds(session.plannedSeconds, path + '.plannedSeconds');
  seconds(session.activeSeconds, path + '.activeSeconds');
  seconds(session.elapsedSeconds, path + '.elapsedSeconds');
  enumeration(session.status, ['completed','partial','stopped'], path + '.status');
  enumeration(session.feedback, ['easy','okay','hard','discomfort','unknown'], path + '.feedback');
  enumeration(session.recovery, ['good','tired','pain','unknown'], path + '.recovery');
  if(session.endedAt < session.startedAt){ invalid(path + '.endedAt', 'must not precede startedAt'); }
  if(session.activeSeconds > session.elapsedSeconds){ invalid(path + '.activeSeconds', 'must not exceed elapsedSeconds'); }
}
function validateActive(session){
  if(session === null){ return; }
  var path = 'state.activeSession';
  fields(session, ['id','courseId','mode','startedAt','phase','stepIndex','left','elapsedSeconds','activeSeconds','updatedAt','planKey'], [], path);
  text(session.id, path + '.id', true);
  text(session.courseId, path + '.courseId', true);
  text(session.planKey, path + '.planKey', true);
  if(session.planKey.length > MAX_PLAN_KEY_LENGTH){ invalid(path + '.planKey', 'must not exceed ' + MAX_PLAN_KEY_LENGTH + ' UTF-16 code units'); }
  enumeration(session.mode, ['seated','standing'], path + '.mode');
  timestamp(session.startedAt, path + '.startedAt');
  enumeration(session.phase, ['ready','running','paused','done'], path + '.phase');
  integer(session.stepIndex, path + '.stepIndex');
  seconds(session.left, path + '.left');
  seconds(session.elapsedSeconds, path + '.elapsedSeconds');
  seconds(session.activeSeconds, path + '.activeSeconds');
  timestamp(session.updatedAt, path + '.updatedAt');
  if(session.updatedAt < session.startedAt){ invalid(path + '.updatedAt', 'must not precede startedAt'); }
  if(session.activeSeconds > session.elapsedSeconds){ invalid(path + '.activeSeconds', 'must not exceed elapsedSeconds'); }
}
function validateState(state){
  fields(state, ['version','revision','updatedAt','settings','days','sessions','activeSession'], [], 'state');
  if(state.version !== 1){ throw error('UNSUPPORTED_VERSION', 'Only state.version 1 is supported; original data was not changed.'); }
  integer(state.revision, 'state.revision');
  timestamp(state.updatedAt, 'state.updatedAt');
  validateSettings(state.settings);
  plainObject(state.days, 'state.days');
  Object.keys(state.days).forEach(function(key){
    date(key, 'state.days key');
    validateDay(state.days[key], 'state.days.' + key);
  });
  if(!Array.isArray(state.sessions)){ invalid('state.sessions', 'expected an array'); }
  var arrayProto = Object.getPrototypeOf(state.sessions);
  var arrayConstructor = arrayProto && Object.getOwnPropertyDescriptor(arrayProto, 'constructor');
  if(!Array.isArray(arrayProto) || !arrayConstructor || typeof arrayConstructor.value !== 'function' || arrayConstructor.value.name !== 'Array'){
    invalid('state.sessions', 'expected a plain JSON array, not a subclass or custom prototype');
  }
  if(Reflect.ownKeys(state.sessions).length !== state.sessions.length + 1){
    invalid('state.sessions', 'expected a dense JSON array without extra properties');
  }
  var ids = new Set();
  for(var i = 0; i < state.sessions.length; i++){
    var descriptor = Object.getOwnPropertyDescriptor(state.sessions, String(i));
    if(!descriptor || !descriptor.enumerable || !own(descriptor, 'value')){ invalid('state.sessions', 'expected a dense JSON array'); }
    var session = descriptor.value;
    validateSession(session, 'state.sessions[' + i + ']');
    if(ids.has(session.id)){ invalid('state.sessions[' + i + '].id', 'duplicate session id'); }
    ids.add(session.id);
  }
  validateActive(state.activeSession);
}
function utf8Bytes(value){
  var bytes = 0;
  for(var i = 0; i < value.length; i++){
    var unit = value.charCodeAt(i);
    if(unit < 0x80){ bytes++; }
    else if(unit < 0x800){ bytes += 2; }
    else if(unit >= 0xd800 && unit <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff){ bytes += 4; i++; }
    else { bytes += 3; }
  }
  return bytes;
}
function enqueue(work){
  var task = queue.then(work);
  queue = task.catch(function(){});
  return task;
}
function notify(){
  Array.from(listeners).forEach(function(listener){
    try{
      listener(readError ? null : clone(current), readError ? error(readError.code, readError.message) : null);
    }catch(_){ /* A subscriber cannot roll back an already committed write. */ }
  });
}
function block(err){
  var changed = !readError || readError.code !== err.code || readError.message !== err.message;
  readError = err;
  if(changed){ notify(); }
}
function readKey(){
  try{ return window.localStorage.getItem(KEY); }
  catch(_){ throw error('STORAGE_UNAVAILABLE', 'Local storage could not be read; no write was attempted.'); }
}
function snapshot(){
  var raw;
  try{ raw = readKey(); }
  catch(err){ block(err); throw err; }
  cachedRaw = raw;
  if(raw === null){ return {raw:raw, state:defaultState(), error:null}; }
  try{
    var state;
    try{ state = JSON.parse(raw); }
    catch(_){ throw error('INVALID_DATA', 'Stored JSON is damaged; exportRaw() preserves the original text.'); }
    validateState(state);
    return {raw:raw, state:state, error:null};
  }catch(err){
    return {raw:raw, state:null, error:err};
  }
}
function accept(snap){
  if(snap.error){ block(snap.error); throw snap.error; }
  var changed = current === null || readError !== null || currentRaw !== snap.raw;
  current = snap.state;
  currentRaw = snap.raw;
  cachedRaw = snap.raw;
  readError = null;
  if(changed){ notify(); }
  return clone(current);
}
function load(){ return enqueue(function(){ return accept(snapshot()); }); }
function get(){
  if(readError){ throw error(readError.code, readError.message); }
  if(current === null){ throw error('NOT_LOADED', 'Call and await load() before get().'); }
  return clone(current);
}
function subscribe(fn){
  if(typeof fn !== 'function'){ throw new TypeError('subscribe requires a function'); }
  listeners.add(fn);
  return function(){ listeners.delete(fn); };
}

function openGate(){
  if(gateConnection){ return gateConnection; }
  gateConnection = new Promise(function(resolve, reject){
    var request, settled = false;
    function fail(){
      if(settled){ return; }
      settled = true;
      reject(error('LOCK_UNAVAILABLE', 'Web Locks unavailable and IndexedDB write gate inaccessible; writes are disabled.'));
    }
    try{
      if(!window.indexedDB){ fail(); return; }
      request = window.indexedDB.open(GATE_DB, 1);
      request.onupgradeneeded = function(){
        var db = request.result;
        if(!db.objectStoreNames.contains('gate')){ db.createObjectStore('gate'); }
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = function(){
        var db = request.result;
        if(settled){ db.close(); return; }
        settled = true;
        db.onversionchange = function(){ db.close(); gateConnection = null; };
        db.onclose = function(){ gateConnection = null; };
        resolve(db);
      };
    }catch(_){ fail(); }
  });
  gateConnection = gateConnection.catch(function(err){ gateConnection = null; throw err; });
  return gateConnection;
}
async function withCommitGate(commit){
  var db = await openGate();
  return new Promise(function(resolve, reject){
    var transaction, request;
    function fail(){ reject(error('LOCK_UNAVAILABLE', 'IndexedDB write gate failed; retry after closing other app tabs.')); }
    try{
      transaction = db.transaction('gate', 'readwrite');
      transaction.onabort = fail;
      transaction.onerror = fail;
      request = transaction.objectStore('gate').get('commit');
      request.onerror = fail;
      request.onsuccess = function(){
        // This synchronous callback owns the IDB write lock. The database remains
        // empty: localStorage.setItem is the commit, so a later IDB abort cannot
        // undo it and must not turn a successful save into a reported failure.
        try{ resolve(commit()); }catch(err){ reject(err); }
      };
    }catch(_){ fail(); }
  });
}
function webLocks(){
  try{
    var locks = window.navigator && window.navigator.locks;
    return locks && typeof locks.request === 'function' ? locks : null;
  }catch(_){ throw error('LOCK_UNAVAILABLE', 'Web Locks could not be accessed; writes are disabled.'); }
}
function stamp(next, base){
  if(base.revision >= Number.MAX_SAFE_INTEGER){ throw error('REVISION_OVERFLOW', 'Revision cannot be incremented safely; no data was changed.'); }
  next.revision = base.revision + 1;
  next.updatedAt = Math.max(Date.now(), base.updatedAt + 1);
  validateState(next);
}
function commit(next, expectedRaw){
  // Also reject writers outside this module that changed the JSON during a draft.
  if(readKey() !== expectedRaw){ throw error('CONFLICT', 'Data changed in another tab. Reload and explicitly retry; nothing was written.'); }
  var raw = JSON.stringify(next);
  var detached = JSON.parse(raw);
  try{ window.localStorage.setItem(KEY, raw); }
  catch(err){
    throw error(err && err.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'WRITE_FAILED', 'Save failed; the previous in-memory state and stored text were retained.');
  }
  // setItem broadcasts a native storage event to other tabs. Notify this page too.
  return accept({raw:raw, state:detached, error:null});
}
function write(prepare, recovery){
  return enqueue(async function(){
    async function draft(){
      var snap = snapshot();
      if(snap.error){
        block(snap.error);
        if(!recovery){ throw snap.error; }
      }
      var base = snap.state || current || defaultState();
      var next = await prepare(clone(base));
      stamp(next, base);
      return {next:next, raw:snap.raw};
    }
    var locks = webLocks();
    if(locks){
      var entered = false;
      try{
        return await locks.request(LOCK_NAME, {mode:'exclusive'}, async function(){
          entered = true;
          var prepared = await draft();
          return commit(prepared.next, prepared.raw);
        });
      }catch(err){
        if(!entered){ throw error('LOCK_UNAVAILABLE', 'The Web Lock could not be acquired; no write was attempted.'); }
        throw err;
      }
    }
    // Capture before awaiting IDB: competing drafts must fail, not silently win.
    var prepared = await draft();
    return withCommitGate(function(){ return commit(prepared.next, prepared.raw); });
  });
}
function transact(mutator){
  if(typeof mutator !== 'function'){ return Promise.reject(new TypeError('transact requires a function')); }
  return write(async function(draft){
    var revision = draft.revision, updatedAt = draft.updatedAt;
    await mutator(draft);
    validateState(draft);
    if(draft.revision !== revision || draft.updatedAt !== updatedAt){
      invalid('state', 'revision and updatedAt are managed by the store');
    }
    // Detach even if a caller retains the draft or returns it from the mutator.
    return clone(draft);
  }, false);
}
function exportData(){
  return enqueue(function(){
    var state = accept(snapshot());
    state.activeSession = null;
    return {format:'qingdaka-habits', exportedAt:new Date().toISOString(), state:state};
  });
}
async function importData(object){
  fields(object, ['format','exportedAt','state'], [], 'backup');
  if(object.format !== 'qingdaka-habits'){ invalid('backup.format', 'expected qingdaka-habits'); }
  isoTime(object.exportedAt, 'backup.exportedAt');
  validateState(object.state);
  var raw = JSON.stringify(object);
  if(utf8Bytes(raw) > IMPORT_MAX_BYTES){ throw error('IMPORT_TOO_LARGE', 'The complete backup exceeds 20 MiB (UTF-8 JSON).'); }
  var imported = JSON.parse(raw).state;
  // A complete portable backup may never resume a different device's workout.
  if(imported.activeSession !== null){ invalid('backup.state.activeSession', 'portable backups require null'); }
  return write(function(){ return imported; }, true);
}
function reset(){ return write(function(){ return defaultState(); }, true); }
function exportRaw(){
  try{ cachedRaw = readKey(); }
  catch(err){ if(cachedRaw === undefined){ throw err; } }
  return cachedRaw;
}


window.QDK_STORE = Object.freeze({
  load:load, transact:transact, get:get, subscribe:subscribe,
  exportData:exportData, importData:importData, exportRaw:exportRaw, reset:reset
});
window.addEventListener('storage', function(event){
  if(event.key !== KEY && event.key !== null){ return; }
  try{ if(event.storageArea && event.storageArea !== window.localStorage){ return; } }
  catch(_){ /* load() will report inaccessible storage to subscribers. */ }
  // Read the latest value, not event.newValue: queued events can already be stale.
  load().catch(function(){});
});
})();
