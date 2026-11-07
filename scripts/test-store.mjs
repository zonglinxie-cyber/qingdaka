import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test as nodeTest} from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../store.js', import.meta.url), 'utf8');
const sessionSource = readFileSync(new URL('../session.js', import.meta.url), 'utf8');
const KEY = 'qingdaka-habits-v1';

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const copy = value => JSON.parse(JSON.stringify(value));
const test = (name, run) => nodeTest(name, {timeout:10000}, run);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};
const code = expected => err => err?.code === expected;
function state(){
  return {
    version:1, revision:0, updatedAt:0,
    settings:{onboarded:false, wakeTime:'', windDownTime:'', anchor:'lunch', focus:'move', sound:true, motion:true},
    days:{}, sessions:[], activeSession:null
  };
}
function session(id = 'session-1'){
  return {
    id, date:'2026-11-05', startedAt:NOW, endedAt:NOW + 90000,
    courseId:'home-light', mode:'seated', plannedSeconds:60, activeSeconds:50,
    elapsedSeconds:90, status:'completed', feedback:'okay', recovery:'good'
  };
}
function active(){
  return {
    id:'in-progress', courseId:'home-light', mode:'standing', startedAt:NOW,
    phase:'running', stepIndex:1, left:20.5, elapsedSeconds:30.5, activeSeconds:20,
    updatedAt:NOW + 30500, planKey:'[["prepare","prepare",10],["move","move",40.5]]'
  };
}
function backup(s = state()){
  return {format:'qingdaka-habits', exportedAt:'2026-11-05T12:00:00.000Z', state:s};
}

// Model independent browser realms sharing storage and a browser lock manager.
// Storage events are delivered asynchronously, with each receiver's storageArea.
function browser(initial = []){
  const items = new Map(initial);
  const tabs = [];
  const events = [];
  const writes = [];
  const lockCalls = [];
  const lockQueues = new Map();
  const locks = {
    request(name, options, callback){
      lockCalls.push({name, ...options});
      const task = (lockQueues.get(name) || Promise.resolve()).then(() => callback({name, mode:options.mode}));
      lockQueues.set(name, task.catch(() => {}));
      return task;
    }
  };
  // Empty IDB store with real readwrite scheduling semantics: only one request
  // callback can own the gate at a time. There is deliberately no put() API.
  const objectStores = new Set();
  const gateCalls = [];
  let idbQueue = Promise.resolve();
  let failGate = false;
  const indexedDB = {
    open(name, version){
      const request = {};
      queueMicrotask(() => {
        let closed = false;
        const db = {
          objectStoreNames:{contains:name => objectStores.has(name)},
          createObjectStore(name){ objectStores.add(name); },
          close(){ closed = true; },
          transaction(store, mode){
            assert.equal(closed, false);
            assert.equal(store, 'gate');
            assert.equal(mode, 'readwrite');
            gateCalls.push({name, version, store, mode});
            const transaction = {
              objectStore(storeName){
                assert.equal(storeName, 'gate');
                return {get(key){
                  assert.equal(key, 'commit');
                  const getRequest = {};
                  idbQueue = idbQueue.then(async () => {
                    if(failGate){ transaction.onabort?.(); return; }
                    getRequest.result = undefined;
                    getRequest.onsuccess?.();
                    await Promise.resolve();
                    transaction.oncomplete?.();
                  });
                  return getRequest;
                }};
              }
            };
            return transaction;
          }
        };
        request.result = db;
        if(!objectStores.size){ request.onupgradeneeded?.(); }
        request.onsuccess?.();
      });
      return request;
    }
  };
  function change(key, value, sourceTab = null){
    const oldValue = items.has(key) ? items.get(key) : null;
    if(value === null){ items.delete(key); } else { items.set(key, value); }
    if(oldValue === value){ return; }
    for(const tab of tabs){
      if(tab !== sourceTab){
        events.push(() => tab.dispatch({key, oldValue, newValue:value, storageArea:tab.storage}));
      }
    }
  }
  function tab({webLocks = true, idb = true, lockManager = locks} = {}){
    const handlers = new Map();
    const tab = {
      readFailure:false, writeFailure:null, accessFailure:false, now:NOW,
      dispatch(event){ for(const fn of handlers.get('storage') || []){ fn(event); } }
    };
    tab.storage = {
      getItem(key){
        assert.equal(key, KEY, 'only the new data key may be read');
        if(tab.readFailure){ throw new Error('read denied'); }
        return items.has(key) ? items.get(key) : null;
      },
      setItem(key, value){
        if(tab.writeFailure){ throw tab.writeFailure; }
        assert.equal(key, KEY, 'only the new data key may be written');
        writes.push({tab, key, value});
        change(key, String(value), tab);
      },
      removeItem(){ assert.fail('the store must reset via a locked write, never removeItem'); },
      clear(){ assert.fail('the store must never clear localStorage'); }
    };
    const window = {
      navigator:webLocks ? {locks:lockManager} : {},
      indexedDB:idb ? indexedDB : undefined,
      get localStorage(){
        if(tab.accessFailure){ throw new Error('localStorage unavailable'); }
        return tab.storage;
      },
      addEventListener(type, fn){
        if(!handlers.has(type)){ handlers.set(type, []); }
        handlers.get(type).push(fn);
      }
    };
    class Clock extends Date { static now(){ return tab.now; } }
    tab.context = vm.createContext({window, Date:Clock});
    vm.runInContext(source, tab.context, {filename:'store.js'});
    tab.store = window.QDK_STORE;
    tabs.push(tab);
    return tab;
  }
  async function flush(){
    for(let i = 0; i < 4; i++){
      events.splice(0).forEach(dispatch => dispatch());
      await new Promise(setImmediate);
    }
  }
  return {items, tab, change, flush, writes, lockCalls, gateCalls, objectStores, failGate(){ failGate = true; }};
}

async function unchanged(store, hub, action, expectedCode){
  const raw = hub.items.get(KEY);
  const before = copy(store.get());
  await assert.rejects(action(), expectedCode ? code(expectedCode) : undefined);
  assert.equal(hub.items.get(KEY), raw);
  assert.deepEqual(copy(store.get()), before);
}

test('plain IIFE: exact defaults, no eager write, detached snapshots and no personal/protein fields', async () => {
  const hub = browser();
  const {store} = hub.tab();
  assert.throws(() => store.get(), code('NOT_LOADED'));
  const loaded = await store.load();
  assert.deepEqual(copy(loaded), state());
  assert.equal(hub.items.size, 0);
  assert.equal(hub.writes.length, 0);
  loaded.settings.sound = false;
  loaded.days['2026-11-05'] = {note:'not saved'};
  assert.deepEqual(copy(store.get()), state());
  const read = store.get();
  read.sessions.push(session());
  assert.equal(store.get().sessions.length, 0);
  assert.equal(store.exportRaw(), null);
  assert.deepEqual(Object.keys(store).sort(), [
    'load','transact','get','subscribe','exportData','importData','exportRaw','reset'
  ].sort());
});

test('transactions accept void/async mutators, ignore return values, own metadata, detach retained drafts', async () => {
  const hub = browser();
  const tab = hub.tab();
  const {store} = tab;
  await store.load();
  let retained;
  const result = await store.transact(async draft => {
    await Promise.resolve();
    retained = draft;
    draft.days['2026-11-05'] = {wakeTime:'07:30', windDown:true, breaks:2, rest:false, note:'轻活动', updatedAt:NOW};
    draft.sessions.push(session());
    return state();
  });
  assert.equal(result.revision, 1);
  assert.equal(result.updatedAt, NOW);
  assert.equal(result.sessions.length, 1);
  retained.sessions.length = 0;
  result.settings.sound = false;
  assert.equal(store.get().sessions.length, 1);
  assert.equal(store.get().settings.sound, true);
  tab.now -= 10000;
  const second = await store.transact(draft => { draft.settings.onboarded = true; });
  assert.equal(second.revision, 2);
  assert.equal(second.updatedAt, NOW + 1, 'clock rollback must not roll metadata backward');
  assert.deepEqual(JSON.parse(hub.items.get(KEY)), copy(second));
});

test('same-page queue never drops transactions, and recovers after a mutator throws', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.load();
  const tasks = Array.from({length:40}, (_, i) => store.transact(async draft => {
    await Promise.resolve();
    draft.sessions.push(session('page-' + i));
  }));
  const results = await Promise.all(tasks);
  assert.deepEqual(results.map(value => value.revision), Array.from({length:40}, (_, i) => i + 1));
  await unchanged(store, hub, () => store.transact(draft => { draft.sessions.length = 0; throw new Error('mutator failed'); }));
  await store.transact(draft => { draft.sessions.push(session('after-error')); });
  assert.equal(store.get().sessions.length, 41);
});

test('Web Locks serialize independent tabs with async drafts: all 80 records survive', async () => {
  const hub = browser();
  const a = hub.tab().store, b = hub.tab().store;
  await Promise.all([a.load(), b.load()]);
  const tasks = Array.from({length:80}, (_, i) => (i % 2 ? a : b).transact(async draft => {
    await Promise.resolve();
    draft.sessions.push(session('tab-' + i));
  }));
  await Promise.all(tasks);
  const saved = JSON.parse(hub.items.get(KEY));
  assert.equal(saved.sessions.length, 80);
  assert.equal(new Set(saved.sessions.map(entry => entry.id)).size, 80);
  assert.equal(saved.revision, 80);
  assert.equal(hub.lockCalls.length, 80);
  assert.ok(hub.lockCalls.every(call => call.name === KEY + ':write' && call.mode === 'exclusive'));
  await hub.flush();
  assert.deepEqual(copy(a.get()), saved);
  assert.deepEqual(copy(b.get()), saved);
});

test('a stale tab rereads inside the Web Lock, rather than replacing the latest state', async () => {
  const hub = browser();
  const a = hub.tab().store, b = hub.tab().store;
  await Promise.all([a.load(), b.load()]);
  const entered = deferred(), release = deferred();
  const first = a.transact(async draft => {
    draft.sessions.push(session('first'));
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const second = b.transact(draft => { draft.sessions.push(session('second')); });
  release.resolve();
  await first;
  const latest = await second;
  assert.deepEqual(Array.from(latest.sessions, entry => entry.id), ['first', 'second']);
});

test('fallback uses an empty IDB commit gate and rejects competing drafts without losing the winner', async () => {
  const hub = browser();
  const a = hub.tab({webLocks:false}).store, b = hub.tab({webLocks:false}).store;
  await Promise.all([a.load(), b.load()]);
  const enteredA = deferred(), enteredB = deferred(), release = deferred();
  const first = a.transact(async draft => {
    draft.sessions.push(session('first'));
    enteredA.resolve();
    await release.promise;
  });
  const second = b.transact(async draft => {
    draft.sessions.push(session('second'));
    enteredB.resolve();
    await release.promise;
  });
  await Promise.all([enteredA.promise, enteredB.promise]);
  release.resolve();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CONFLICT');
  const loser = results[0].status === 'rejected' ? a : b;
  assert.equal(loser.get().sessions.length, 0, 'a conflict must not commit its draft in memory');
  const rejectedId = results[0].status === 'rejected' ? 'first' : 'second';
  await loser.load();
  await loser.transact(draft => { draft.sessions.push(session(rejectedId)); });
  assert.equal(JSON.parse(hub.items.get(KEY)).sessions.length, 2);
  assert.equal(hub.lockCalls.length, 0);
  assert.equal(hub.gateCalls.length, 3);
  assert.deepEqual([...hub.objectStores], ['gate']);
  assert.deepEqual([...hub.items.keys()], [KEY]);
});

test('fallback serializes one page and protects import/reset from stale replacement conflicts', async () => {
  const hub = browser();
  const a = hub.tab({webLocks:false}).store, b = hub.tab({webLocks:false}).store;
  await Promise.all([a.load(), b.load()]);
  await Promise.all(Array.from({length:12}, (_, i) => a.transact(draft => { draft.sessions.push(session('fallback-' + i)); })));
  assert.equal(a.get().sessions.length, 12);
  for(const replace of [() => b.reset(), () => b.importData(backup())]){
    const entered = deferred(), release = deferred();
    const writing = a.transact(async draft => {
      draft.sessions.push(session('blocked-' + draft.revision));
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const replaced = await replace();
    release.resolve();
    await assert.rejects(writing, code('CONFLICT'));
    assert.deepEqual(JSON.parse(hub.items.get(KEY)), copy(replaced));
  }
});

test('without a safe lock provider writes fail closed; reads and exports remain available', async () => {
  const hub = browser([[KEY, JSON.stringify(state())]]);
  const {store} = hub.tab({webLocks:false, idb:false});
  await store.load();
  for(const action of [() => store.transact(draft => { draft.settings.sound = false; }), () => store.importData(backup()), () => store.reset()]){
    await unchanged(store, hub, action, 'LOCK_UNAVAILABLE');
  }
  assert.equal((await store.exportData()).format, 'qingdaka-habits');
  assert.equal(store.exportRaw(), hub.items.get(KEY));
  assert.equal(hub.writes.length, 0);
});

test('IDB abort before commit fails without writing or changing memory', async () => {
  const hub = browser();
  const {store} = hub.tab({webLocks:false});
  await store.load();
  hub.failGate();
  await unchanged(store, hub, () => store.transact(draft => { draft.sessions.push(session()); }), 'LOCK_UNAVAILABLE');
});

test('Web Lock failure never downgrades to a competing lock protocol', async () => {
  const hub = browser();
  const {store} = hub.tab({lockManager:{request(){ return Promise.reject(new Error('denied')); }}});
  await store.load();
  await unchanged(store, hub, () => store.reset(), 'LOCK_UNAVAILABLE');
  assert.equal(hub.gateCalls.length, 0);
  assert.equal(hub.writes.length, 0);
});

test('corrupt/unknown stored data is read-only, untouched and exportable verbatim', async () => {
  const invalidStates = ['', 'not-json', 'null', '[]', '{broken original',
    JSON.stringify({...state(), version:2}), JSON.stringify({...state(), extra:true}),
    JSON.stringify({...state(), sessions:[{id:'broken'}]})];
  for(const raw of invalidStates){
    const hub = browser([[KEY, raw]]);
    const {store} = hub.tab();
    const errors = [];
    store.subscribe((value, err) => { errors.push({value, code:err?.code}); });
    await assert.rejects(store.load());
    assert.throws(() => store.get());
    let called = false;
    await assert.rejects(store.transact(() => { called = true; }));
    await assert.rejects(store.exportData());
    assert.equal(called, false);
    assert.equal(hub.items.get(KEY), raw);
    assert.equal(store.exportRaw(), raw);

    assert.equal(hub.writes.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].value, null);
    assert.ok(['INVALID_DATA', 'UNSUPPORTED_VERSION'].includes(errors[0].code));
  }
});

test('corruption arriving after load blocks mutations; a complete import repairs read-only state', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.load();
  await store.transact(draft => { draft.sessions.push(session('before')); });
  hub.change(KEY, ' damaged raw \n');
  await assert.rejects(store.transact(draft => { draft.sessions.length = 0; }), code('INVALID_DATA'));
  assert.equal(store.exportRaw(), ' damaged raw \n');
  await assert.rejects(store.importData({state:state()}), code('INVALID_DATA'));
  assert.throws(() => store.get(), code('INVALID_DATA'));
  const recovered = state();
  recovered.days['2026-11-05'] = {rest:true};
  const result = await store.importData(backup(recovered));
  assert.deepEqual(copy(result.days), recovered.days);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.revision, 2);
  await store.transact(draft => { draft.settings.onboarded = true; });
  assert.equal(store.get().settings.onboarded, true);
});

test('out-of-protocol changes during async drafts are rejected rather than overwritten', async () => {
  const hub = browser([[KEY, JSON.stringify(state())]]);
  const {store} = hub.tab();
  await store.load();
  const entered = deferred(), release = deferred();
  const writing = store.transact(async draft => {
    draft.sessions.push(session());
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  hub.change(KEY, 'external unknown raw');
  release.resolve();
  await assert.rejects(writing, code('CONFLICT'));
  assert.equal(hub.items.get(KEY), 'external unknown raw');
  assert.equal(store.get().sessions.length, 0);
  await assert.rejects(store.load(), code('INVALID_DATA'));
  assert.equal(store.exportRaw(), 'external unknown raw');
});

test('storage events reload the latest JSON, broadcast reset, ignore unrelated/session storage and unsubscribe', async () => {
  const hub = browser();
  const a = hub.tab(), b = hub.tab();
  await Promise.all([a.store.load(), b.store.load()]);
  const received = [];
  const unsubscribe = b.store.subscribe((value, err) => { received.push({value:copy(value), code:err?.code}); });
  await a.store.transact(draft => { draft.sessions.push(session()); });
  await hub.flush();
  assert.equal(received.length, 1);
  assert.equal(received[0].value.sessions.length, 1);
  b.dispatch({key:'unrelated-key', storageArea:b.storage});
  b.dispatch({key:KEY, storageArea:{}});
  await hub.flush();
  assert.equal(received.length, 1);
  await a.store.reset();
  await hub.flush();
  assert.equal(received.at(-1).value.sessions.length, 0);
  assert.equal(b.store.get().revision, 2);
  hub.change(KEY, 'bad event data');
  await hub.flush();
  assert.equal(received.at(-1).value, null);
  assert.equal(received.at(-1).code, 'INVALID_DATA');
  await a.store.importData(backup());
  await hub.flush();
  assert.equal(received.at(-1).value.activeSession, null);
  assert.equal(received.at(-1).code, undefined);
  const count = received.length;
  unsubscribe();
  await a.store.reset();
  await hub.flush();
  assert.equal(received.length, count);
  // clear() notifications have key:null. Do not trust an old event.newValue.
  hub.items.delete(KEY);
  b.dispatch({key:null, newValue:'stale', storageArea:b.storage});
  await hub.flush();
  assert.deepEqual(copy(b.store.get()), state());
});

test('subscriber mutations/exceptions cannot mutate internal state or fail an already committed write', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.load();
  const observed = [];
  store.subscribe(value => { value.sessions.length = 0; throw new Error('render failed'); });
  store.subscribe(value => { observed.push(value.sessions.length); });
  const saved = await store.transact(draft => { draft.sessions.push(session()); });
  assert.equal(saved.sessions.length, 1);
  assert.deepEqual(observed, [1]);
  assert.equal(JSON.parse(hub.items.get(KEY)).sessions.length, 1);
});

test('export is a detached complete backup with null activeSession, without modifying local workout or metadata', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.transact(draft => {
    draft.activeSession = active();
    draft.sessions.push(session());
    draft.days['2026-11-05'] = {breaks:3};
  });
  const originalRaw = hub.items.get(KEY);
  const exported = await store.exportData();
  assert.deepEqual(Object.keys(exported).sort(), ['exportedAt','format','state']);
  assert.equal(exported.format, 'qingdaka-habits');
  assert.equal(new Date(exported.exportedAt).toISOString(), exported.exportedAt);
  assert.equal(exported.state.activeSession, null);
  assert.equal(store.get().activeSession.phase, 'running');
  assert.equal(hub.items.get(KEY), originalRaw);
  exported.state.sessions.length = 0;
  assert.equal(store.get().sessions.length, 1);
});

test('import snapshots its input, atomically replaces data and advances local revision; training guard belongs to UI', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.transact(draft => { draft.activeSession = active(); draft.sessions.push(session('old')); });
  const imported = state();
  imported.revision = 800;
  imported.updatedAt = 1;
  imported.days['2024-02-29'] = {};
  imported.sessions = [session('imported')];
  const object = backup(imported);
  const importing = store.importData(object);
  object.state.sessions[0].id = 'changed-after-call';
  const result = await importing;
  assert.equal(result.revision, 2);
  assert.equal(result.updatedAt, NOW + 1);
  assert.equal(result.activeSession, null);
  assert.deepEqual(Array.from(result.sessions, entry => entry.id), ['imported']);
  assert.deepEqual(copy(result.days), {'2024-02-29':{}});
  assert.equal(hub.writes.length, 2);
});

test('strict imports reject incomplete backups, bad dates/enums/numbers, unknown fields and malformed records atomically', async () => {
  const hub = browser([[KEY, JSON.stringify(state())]]);
  const {store} = hub.tab();
  await store.load();
  const cases = [
    ['format', b => { b.format = 'other-format'; }],
    ['missing format', b => { delete b.format; }],
    ['extra envelope', b => { b.note = 'unexpected'; }],
    ['missing exportedAt', b => { delete b.exportedAt; }],
    ['rolled ISO date', b => { b.exportedAt = '2026-02-30T12:00:00.000Z'; }],
    ['ISO timezone required', b => { b.exportedAt = '2026-11-05T12:00:00'; }],
    ['unknown version', b => { b.state.version = 3; }],
    ['missing sessions', b => { delete b.state.sessions; }],
    ['unknown root', b => { b.state.age = 30; }],
    ['revision string', b => { b.state.revision = '1'; }],
    ['revision fractional', b => { b.state.revision = 1.5; }],
    ['revision unsafe', b => { b.state.revision = Number.MAX_SAFE_INTEGER + 1; }],
    ['negative timestamp', b => { b.state.updatedAt = -1; }],
    ['invalid timestamp', b => { b.state.updatedAt = Infinity; }],
    ['timestamp range', b => { b.state.updatedAt = 8640000000000001; }],
    ['settings missing boolean', b => { delete b.state.settings.motion; }],
    ['settings extra', b => { b.state.settings.proteinTarget = 100; }],
    ['boolean coercion', b => { b.state.settings.onboarded = 1; }],
    ['wake time', b => { b.state.settings.wakeTime = '24:00'; }],
    ['wind-down time', b => { b.state.settings.windDownTime = '7:00'; }],
    ['empty anchor', b => { b.state.settings.anchor = ''; }],
    ['focus type', b => { b.state.settings.focus = null; }],
    ['invalid leap day', b => { b.state.days['2025-02-29'] = {}; }],
    ['century leap day', b => { b.state.days['1900-02-29'] = {}; }],
    ['month', b => { b.state.days['2026-13-01'] = {}; }],
    ['day zero', b => { b.state.days['2026-01-00'] = {}; }],
    ['year zero', b => { b.state.days['0000-01-01'] = {}; }],
    ['noncanonical date', b => { b.state.days['2026-1-01'] = {}; }],
    ['null day', b => { b.state.days['2026-11-05'] = null; }],
    ['day missing time value', b => { b.state.days['2026-11-05'] = {wakeTime:''}; }],
    ['fractional break', b => { b.state.days['2026-11-05'] = {breaks:1.2}; }],
    ['negative breaks', b => { b.state.days['2026-11-05'] = {breaks:-1}; }],
    ['null note', b => { b.state.days['2026-11-05'] = {note:null}; }],
    ['undefined note', b => { b.state.days['2026-11-05'] = {note:undefined}; }],
    ['windDown boolean', b => { b.state.days['2026-11-05'] = {windDown:'yes'}; }],
    ['rest boolean', b => { b.state.days['2026-11-05'] = {rest:0}; }],
    ['day timestamp', b => { b.state.days['2026-11-05'] = {updatedAt:NaN}; }],
    ['unknown day field', b => { b.state.days['2026-11-05'] = {protein:10}; }],
    ['sessions not array', b => { b.state.sessions = {}; }],
    ['incomplete session', b => { delete b.state.sessions[0].feedback; }],
    ['extra session field', b => { b.state.sessions[0].weight = 60; }],
    ['empty id', b => { b.state.sessions[0].id = ' '; }],
    ['course type', b => { b.state.sessions[0].courseId = 123; }],
    ['session date', b => { b.state.sessions[0].date = '2026-04-31'; }],
    ['negative start', b => { b.state.sessions[0].startedAt = -1; }],
    ['end before start', b => { b.state.sessions[0].endedAt = NOW - 1; }],
    ['bad mode', b => { b.state.sessions[0].mode = 'lying'; }],
    ['bad status', b => { b.state.sessions[0].status = 'done'; }],
    ['bad feedback', b => { b.state.sessions[0].feedback = ''; }],
    ['bad recovery', b => { b.state.sessions[0].recovery = 'fine'; }],
    ['NaN seconds', b => { b.state.sessions[0].activeSeconds = NaN; }],
    ['negative seconds', b => { b.state.sessions[0].plannedSeconds = -1; }],
    ['seconds type', b => { b.state.sessions[0].elapsedSeconds = '90'; }],
    ['active > elapsed', b => { b.state.sessions[0].activeSeconds = 91; }],
    ['duplicate id', b => { b.state.sessions.push(copy(b.state.sessions[0])); }],
    ['array hole', b => { b.state.sessions.length = 2; }],
    ['array extra property', b => { b.state.sessions.extra = true; }],
    ['valid but nonportable active session', b => { b.state.activeSession = active(); }],
    ['missing activeSession', b => { delete b.state.activeSession; }],
    ['prototype pollution key', b => { b.state.days = JSON.parse('{"__proto__":{"polluted":true}}'); }]
  ];
  for(const [label, mutate] of cases){
    const object = backup();
    object.state.sessions.push(session());
    mutate(object);
    await unchanged(store, hub, () => store.importData(object));
    assert.equal(hub.writes.length, 0, label);
  }
  for(const object of [null, [], 'json text', state(), {format:'qingdaka-habits', exportedAt:'bad', state:state()}]){
    await unchanged(store, hub, () => store.importData(object));
  }
  assert.equal({}.polluted, undefined);
});

test('non-JSON objects/accessors/symbols are rejected without invoking getters or toJSON', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.load();
  let invoked = false;
  const getter = backup();
  Object.defineProperty(getter.state.settings, 'sound', {enumerable:true, get(){ invoked = true; return true; }});
  await unchanged(store, hub, () => store.importData(getter), 'INVALID_DATA');
  const customJSON = backup();
  customJSON.state.toJSON = () => { invoked = true; return state(); };
  await unchanged(store, hub, () => store.importData(customJSON), 'INVALID_DATA');
  const arraySubclass = backup();
  class CustomArray extends Array { toJSON(){ invoked = true; return []; } }
  arraySubclass.state.sessions = new CustomArray(session());
  await unchanged(store, hub, () => store.importData(arraySubclass), 'INVALID_DATA');
  const arrayGetter = backup();
  arrayGetter.state.sessions = [session()];
  Object.defineProperty(arrayGetter.state.sessions, '0', {enumerable:true, get(){ invoked = true; return session(); }});
  await unchanged(store, hub, () => store.importData(arrayGetter), 'INVALID_DATA');
  const symbol = backup();
  symbol.state[Symbol('extra')] = true;
  await unchanged(store, hub, () => store.importData(symbol), 'INVALID_DATA');
  const hidden = backup();
  Object.defineProperty(hidden.state, 'hidden', {value:true});
  await unchanged(store, hub, () => store.importData(hidden), 'INVALID_DATA');
  assert.equal(invoked, false);
  const instance = backup();
  instance.state.settings = new (class Settings { constructor(){ Object.assign(this, state().settings); } })();
  await unchanged(store, hub, () => store.importData(instance), 'INVALID_DATA');
});

test('activeSession uses the exact schema, all phases work, invalid drafts never get repaired', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.load();
  for(const phase of ['ready','running','paused','done']){
    await store.transact(draft => { draft.activeSession = {...active(), phase}; });
    assert.equal(store.get().activeSession.phase, phase);
  }
  const changes = [
    value => { value.phase = 'finished'; }, value => { value.mode = 'other'; },
    value => { value.stepIndex = 0.5; }, value => { value.left = -1; },
    value => { value.elapsedSeconds = Infinity; }, value => { value.activeSeconds = 40; },
    value => { value.updatedAt = NOW - 1; }, value => { value.id = ''; },
    value => { value.startedAt = 'now'; }, value => { delete value.courseId; },
    value => { value.extra = true; }
  ];
  for(const change of changes){
    await unchanged(store, hub, () => store.transact(draft => { change(draft.activeSession); }), 'INVALID_DATA');
  }
  await unchanged(store, hub, () => store.transact(draft => { draft.revision++; }), 'INVALID_DATA');
  await unchanged(store, hub, () => store.transact(draft => { draft.updatedAt++; }), 'INVALID_DATA');
  await unchanged(store, hub, () => store.transact(draft => { draft.version = 2; }), 'UNSUPPORTED_VERSION');
  await unchanged(store, hub, () => store.transact(draft => { draft.sessions.push({id:'bad'}); }), 'INVALID_DATA');
});

test('activeSession.planKey is required, nonblank, bounded and preserved without normalization', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.load();
  for(const planKey of ['p', ' signature with spaces ', 'p'.repeat(65536)]){
    const saved = await store.transact(draft => { draft.activeSession = {...active(), planKey}; });
    assert.equal(saved.activeSession.planKey, planKey);
    assert.equal((await hub.tab().store.load()).activeSession.planKey, planKey);
  }
  const invalidKeys = [undefined, null, '', ' \t\n', 123, {}, [], 'p'.repeat(65537)];
  for(const planKey of invalidKeys){
    const invalidActive = {...active(), planKey};
    if(planKey === undefined){ delete invalidActive.planKey; }
    await unchanged(store, hub, () => store.transact(draft => { draft.activeSession = invalidActive; }), 'INVALID_DATA');
    const raw = JSON.stringify({...state(), activeSession:invalidActive});
    const corruptHub = browser([[KEY, raw]]);
    const reader = corruptHub.tab().store;
    await assert.rejects(reader.load(), code('INVALID_DATA'));
    await assert.rejects(reader.transact(() => assert.fail('must not repair or discard a damaged snapshot')), code('INVALID_DATA'));
    assert.equal(reader.exportRaw(), raw);
    assert.equal(corruptHub.writes.length, 0);
  }
});

test('real session snapshots roundtrip via store with ms timestamps, including pending-feedback done', async () => {
  const plan = [
    {id:'prepare', kind:'prepare', seconds:0.25},
    {id:'move', kind:'move', seconds:1},
    {id:'rest', kind:'rest', seconds:0.25},
    {id:'settle', kind:'settle', seconds:0.25}
  ];
  const expectedPlanKey = JSON.stringify(plan.map(step => [step.id, step.kind, step.seconds]));
  for(const scenario of ['ready','running','paused','done-early','done-natural']){
    let now = NOW;
    const context = vm.createContext({window:{}});
    vm.runInContext(sessionSource, context, {filename:'session.js'});
    const create = options => context.window.QDK_SESSION.create({
      plan, now:() => now, schedule:() => 0, cancel(){}, ...options
    });
    const engine = create();
    if(scenario !== 'ready'){
      engine.start();
      now += scenario === 'done-natural' ? 1750 : 750;
      engine.pause();
      if(scenario === 'running'){ engine.start(); }
      if(scenario === 'done-early'){ engine.finish(); }
    }
    const snapshot = copy(engine.get());
    assert.deepEqual(Object.keys(snapshot).sort(), ['phase','stepIndex','left','elapsedSeconds','activeSeconds','updatedAt','planKey'].sort());
    assert.equal(snapshot.planKey, expectedPlanKey);
    assert.equal(snapshot.updatedAt, now / 1000);
    assert.equal(snapshot.phase, scenario.startsWith('done-') ? 'done' : scenario);
    const activeSession = {
      id:'roundtrip-' + scenario, courseId:'home-light', mode:'seated', startedAt:NOW,
      ...snapshot, updatedAt:snapshot.updatedAt * 1000
    };
    const hub = browser();
    const {store} = hub.tab();
    await store.load();
    // Omitting the UI's seconds -> milliseconds conversion must not corrupt storage.
    await unchanged(store, hub, () => store.transact(draft => {
      draft.activeSession = {...activeSession, updatedAt:snapshot.updatedAt};
    }), 'INVALID_DATA');
    const saved = await store.transact(draft => { draft.activeSession = activeSession; });
    assert.deepEqual(copy(saved.activeSession), activeSession);
    assert.deepEqual(JSON.parse(hub.items.get(KEY)).activeSession, activeSession);
    const reloaded = await hub.tab().store.load();
    assert.deepEqual(copy(reloaded.activeSession), activeSession);
    assert.equal(reloaded.sessions.length, 0, 'done waits for UI feedback; store must not auto-finalize');
    const restoreSnapshot = {...copy(reloaded.activeSession), updatedAt:reloaded.activeSession.updatedAt / 1000};
    let callbacks = 0;
    const restored = create({snapshot:restoreSnapshot, onChange(){ callbacks++; }, onFinish(){ callbacks++; }});
    assert.deepEqual(copy(restored.get()), {...snapshot, phase:snapshot.phase === 'done' ? 'done' : 'paused'});
    assert.equal(callbacks, 0, 'restoring done must not emit a second finish callback');
    if(snapshot.phase === 'done'){
      assert.equal(restored.get().left, 0);
      assert.equal(restored.get().stepIndex, scenario === 'done-early' ? 1 : plan.length - 1);
      assert.equal(snapshot.elapsedSeconds, scenario === 'done-early' ? 0.75 : 1.75);
    }
    const differentPlan = plan.map(step => ({...step}));
    differentPlan[1].seconds = 2;
    const mismatched = create({plan:differentPlan, snapshot:restoreSnapshot});
    assert.equal(mismatched.get().phase, 'ready');
    assert.equal(mismatched.get().elapsedSeconds, 0);
    assert.notEqual(mismatched.get().planKey, snapshot.planKey);
    assert.equal((await store.exportData()).state.activeSession, null, 'portable backups still exclude resumable sessions');
    engine.destroy();
    restored.destroy();
    mismatched.destroy();
  }
});

test('calendar boundaries, optional day fields, enum values and fractional seconds are retained exactly', async () => {
  const hub = browser();
  const {store} = hub.tab();
  const imported = state();
  imported.days = {'0001-01-01':{}, '2000-02-29':{wakeTime:'00:00'}, '9999-12-31':{wakeTime:'23:59', note:''}};
  imported.settings.wakeTime = '07:05';
  imported.settings.windDownTime = '22:30';
  const feedback = ['easy','okay','hard','discomfort','unknown'];
  const recovery = ['good','tired','pain','unknown'];
  imported.sessions = feedback.map((value, i) => ({
    ...session('enum-' + i), mode:i % 2 ? 'standing' : 'seated',
    status:['completed','partial','stopped'][i % 3], feedback:value,
    recovery:recovery[i % 4], plannedSeconds:90.5, activeSeconds:0.25, elapsedSeconds:0.5
  }));
  const object = backup(imported);
  object.exportedAt = '2026-11-05T20:00:00+08:00';
  const saved = await store.importData(object);
  assert.deepEqual(copy(saved.days), imported.days);
  assert.deepEqual(copy(saved.sessions), imported.sessions);
});

test('20 MiB import bound counts UTF-8 JSON bytes, rejects oversized backups without truncation', async () => {
  const hub = browser();
  const {store} = hub.tab();
  await store.load();
  const object = backup();
  object.state.days['2026-11-05'] = {note:''};
  const overhead = Buffer.byteLength(JSON.stringify(object));
  object.state.days['2026-11-05'].note = 'a'.repeat(20 * 1024 * 1024 - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(object)), 20 * 1024 * 1024);
  await store.importData(object);
  assert.equal(store.get().days['2026-11-05'].note.length, 20 * 1024 * 1024 - overhead);
  object.state.days['2026-11-05'].note += 'a';
  await unchanged(store, hub, () => store.importData(object), 'IMPORT_TOO_LARGE');
  object.state.days['2026-11-05'].note = '中'.repeat(7 * 1024 * 1024);
  assert.ok(JSON.stringify(object).length < 20 * 1024 * 1024);
  await unchanged(store, hub, () => store.importData(object), 'IMPORT_TOO_LARGE');
});

test('session history has no record cap; more than 6000 entries survive load/export/import', async () => {
  const imported = state();
  imported.sessions = Array.from({length:6501}, (_, i) => session('history-' + i));
  const hub = browser([[KEY, JSON.stringify(imported)]]);
  const {store} = hub.tab();
  assert.equal((await store.load()).sessions.length, 6501);
  const exported = await store.exportData();
  assert.equal(exported.state.sessions.length, 6501);
  await store.reset();
  assert.equal((await store.importData(exported)).sessions.length, 6501);
  assert.deepEqual(copy(store.get().sessions), imported.sessions);
});

test('quota/write failures roll back transactions, imports and resets; queue remains usable', async () => {
  const hub = browser();
  const tab = hub.tab();
  const {store} = tab;
  await store.transact(draft => { draft.sessions.push(session('retained')); });
  const notifications = [];
  store.subscribe(value => notifications.push(value));
  tab.writeFailure = Object.assign(new Error('quota'), {name:'QuotaExceededError'});
  for(const action of [
    () => store.transact(draft => { draft.sessions.push(session('not-saved')); }),
    () => store.importData(backup()), () => store.reset()
  ]){
    await unchanged(store, hub, action, 'QUOTA_EXCEEDED');
  }
  assert.equal(notifications.length, 0);
  tab.writeFailure = new Error('permission denied');
  await unchanged(store, hub, () => store.reset(), 'WRITE_FAILED');
  tab.writeFailure = null;
  await store.transact(draft => { draft.sessions.push(session('after-quota')); });
  assert.equal(store.get().sessions.length, 2);
  assert.equal(store.get().revision, 2);
});

test('failed recovery preserves corrupt original, read-only status and raw export even if storage later becomes inaccessible', async () => {
  const raw = '\n invalid original { 保留 🏡';
  const hub = browser([[KEY, raw]]);
  const tab = hub.tab();
  const {store} = tab;
  await assert.rejects(store.load(), code('INVALID_DATA'));
  tab.writeFailure = Object.assign(new Error('quota'), {name:'QuotaExceededError'});
  await assert.rejects(store.importData(backup()), code('QUOTA_EXCEEDED'));
  await assert.rejects(store.reset(), code('QUOTA_EXCEEDED'));
  assert.throws(() => store.get(), code('INVALID_DATA'));
  assert.equal(hub.items.get(KEY), raw);
  tab.accessFailure = true;
  await assert.rejects(store.load(), code('STORAGE_UNAVAILABLE'));
  assert.equal(store.exportRaw(), raw);
  tab.accessFailure = false;
  tab.writeFailure = null;
  const reset = await store.reset();
  assert.equal(reset.sessions.length, 0);
  assert.equal(reset.revision, 1);
  assert.deepEqual(copy(store.get()), copy(reset));
});

test('storage read denial never initializes over existing data or reports successful writes', async () => {
  const raw = JSON.stringify(state());
  const hub = browser([[KEY, raw]]);
  const tab = hub.tab();
  tab.readFailure = true;
  await assert.rejects(tab.store.load(), code('STORAGE_UNAVAILABLE'));
  await assert.rejects(tab.store.transact(() => assert.fail('must not invoke mutator')), code('STORAGE_UNAVAILABLE'));
  await assert.rejects(tab.store.reset(), code('STORAGE_UNAVAILABLE'));
  await assert.rejects(tab.store.importData(backup()), code('STORAGE_UNAVAILABLE'));
  assert.throws(() => tab.store.exportRaw(), code('STORAGE_UNAVAILABLE'));
  assert.equal(hub.items.get(KEY), raw);
  assert.equal(hub.writes.length, 0);
  tab.readFailure = false;
  await tab.store.load();
  await tab.store.reset();
});

test('metadata overflow rejects safely rather than losing revision precision', async () => {
  const initial = state();
  initial.revision = Number.MAX_SAFE_INTEGER;
  const hub = browser([[KEY, JSON.stringify(initial)]]);
  const {store} = hub.tab();
  await store.load();
  await unchanged(store, hub, () => store.transact(draft => { draft.settings.sound = false; }), 'REVISION_OVERFLOW');
});
