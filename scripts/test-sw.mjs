import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { PROJECT_ROOT, listFiles, precacheFiles, prepareBuild, releaseVersion, renderServiceWorker, sha256 } from './build-dist.mjs';
import { checkArtifact } from './check-dist.mjs';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/qingdaka/';
const prefix = value => 'qingdaka-habits:' + encodeURIComponent(value) + ':';
const legacyPrefix = value => 'workbuddy:' + encodeURIComponent(value) + ':';

function storage() {
  const buckets = new Map();
  const state = { buckets, failOpen: false, failPut: '', delayedPuts: 0 };
  const key = input => typeof input === 'string' ? input : input.url;
  state.open = async name => {
    if (state.failOpen) { throw new Error('cache-storage-unavailable'); }
    if (!buckets.has(name)) { buckets.set(name, new Map()); }
    const entries = buckets.get(name);
    return {
      match: async input => entries.get(key(input))?.clone(),
      put: async (input, response) => {
        if (state.delayedPuts) { await new Promise(resolve => setTimeout(resolve, state.delayedPuts)); }
        if (key(input).endsWith(state.failPut) && state.failPut) { throw new Error('quota-exceeded'); }
        entries.set(key(input), response.clone());
      },
      delete: async input => entries.delete(key(input)),
      keys: async () => [...entries.keys()].map(url => new Request(url))
    };
  };
  state.keys = async () => [...buckets.keys()];
  state.delete = async name => buckets.delete(name);
  return state;
}

function network(files, base = scope) {
  const state = {
    calls: [], online: true, failures: new Map(), gate: null,
    files: new Map([...files].map(([name, value]) => [new URL(name, base).href, value]))
  };
  state.fetch = async (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    state.calls.push({ url, options });
    if (state.gate) { await state.gate; }
    if (!state.online) { throw new Error('offline'); }
    if (state.failures.has(url)) { return new Response('unavailable', { status: state.failures.get(url) }); }
    const body = state.files.get(url);
    return new Response(body ?? 'not found', { status: body === undefined ? 404 : 200 });
  };
  return state;
}

function worker(sw, { cache = storage(), net, active = null, base = scope } = {}) {
  const handlers = new Map();
  const state = { skipped: 0, claimed: 0, cache, net, base };
  const self = {
    registration: { scope: base, active },
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: async () => { state.skipped++; },
    clients: { claim: async () => { state.claimed++; } }
  };
  const context = vm.createContext({ self, caches: cache, fetch: net.fetch, URL, Response, Request, Headers, crypto: webcrypto });
  vm.runInContext(sw, context, { timeout: 1000, filename: 'sw.js' });
  state.version = context.VERSION;
  state.name = context.CACHE_NAME;
  state.core = Array.from(context.CORE);
  state.emit = (type, init = {}) => {
    const promises = [];
    let response;
    handlers.get(type)({
      ...init,
      waitUntil: promise => promises.push(Promise.resolve(promise)),
      respondWith: promise => { response = Promise.resolve(promise); }
    });
    return { done: Promise.all(promises), response };
  };
  state.dispatch = async (type, init) => { await state.emit(type, init).done; };
  state.request = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    const req = new Request(new URL(path, base).href, {
      method: options.method || 'GET',
      headers: headers
    });
    const result = state.emit('fetch', { request: req });
    await result.done;
    return result.response;
  };
  state.status = async () => {
    let reply;
    await state.dispatch('message', {
      data: { type: 'OFFLINE_STATUS' }, ports: [{ postMessage: value => { reply = JSON.parse(JSON.stringify(value)); } }]
    });
    return reply;
  };
  state.accept = () => state.dispatch('message', { data: { type: 'ACTIVATE_UPDATE' } });
  return state;
}

test('本地 serve.json 对核心和素材禁用强缓存，SW 必须重新验证', async () => {
  const config = JSON.parse(await readFile(new URL('../serve.json', import.meta.url), 'utf8'));
  assert.equal(config.public, '.');
  assert.equal(config.cleanUrls, false);
  const cacheControl = rule => rule.headers.find(header => header.key === 'Cache-Control')?.value;
  assert.equal(cacheControl(config.headers.find(rule => rule.source === '**')), 'no-cache');
  assert.match(cacheControl(config.headers.find(rule => rule.source === 'sw.js')), /no-cache.*no-store/);
});

test('完整包构建与检查：版本 hash 可复算且精确通过全部断言', async () => {
  const { files, version } = await prepareBuild();
  const check = await checkArtifact(files);
  assert.equal(check.plans, 5);
  assert.equal(check.moves, 31);
  assert.match(version, /^coach-[a-f0-9]{20}$/);
});

test('首次安装完整包并预缓存全部 3D 动图、海报与预录语音', async () => {
  const { files, version } = await prepareBuild();
  const swText = files.get('sw.js').toString('utf8');
  const net = network(files);
  const sw = worker(swText, { net });

  await sw.dispatch('install');
  assert.equal(sw.skipped, 1, '安装完成时必须自动调用 skipWaiting 接管旧版客户端');
  assert.equal(sw.claimed, 0);

  const status = await sw.status();
  assert.deepEqual(status, { ready: true, courseReady: true, version });

  await sw.dispatch('activate');
  assert.equal(sw.claimed, 1);

  // 离线状态下全部预缓存资源均可命中
  net.online = false;
  const sampleVoice = await sw.request('./assets/voice/countdown-3.m4a');
  assert.equal(sampleVoice.status, 200);
  assert.deepEqual(Buffer.from(await sampleVoice.arrayBuffer()), files.get('assets/voice/countdown-3.m4a'));

  const sampleGif = await sw.request('./assets/exercise-guides/0291.gif');
  assert.equal(sampleGif.status, 200);
  assert.deepEqual(Buffer.from(await sampleGif.arrayBuffer()), files.get('assets/exercise-guides/0291.gif'));
});

test('Audio Range 请求放行并返回 206 Partial Content（支持 iOS Safari）', async () => {
  const { files } = await prepareBuild();
  const swText = files.get('sw.js').toString('utf8');
  const net = network(files);
  const sw = worker(swText, { net });
  await sw.dispatch('install');
  await sw.dispatch('activate');

  const voiceData = files.get('assets/voice/countdown-3.m4a');
  const totalSize = voiceData.byteLength;
  assert.ok(totalSize > 32);

  // 发起 Range: bytes=0-31
  const res = await sw.request('./assets/voice/countdown-3.m4a', {
    headers: { 'Range': 'bytes=0-31' }
  });
  assert.equal(res.status, 206);
  assert.equal(res.statusText, 'Partial Content');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('Content-Range'), `bytes 0-31/${totalSize}`);
  assert.equal(res.headers.get('Content-Length'), '32');

  const slice = Buffer.from(await res.arrayBuffer());
  assert.equal(slice.byteLength, 32);
  assert.deepEqual(slice, voiceData.subarray(0, 32));
});

test('激活时清理匹配 scope 的旧版缓存，保留其他站点缓存', async () => {
  const { files } = await prepareBuild();
  const swText = files.get('sw.js').toString('utf8');
  const net = network(files);
  const sw = worker(swText, { net });
  await sw.dispatch('install');

  const removed = [prefix(scope) + 'old', legacyPrefix(scope) + 'shell-old'];
  const kept = [
    prefix('https://example.test/other/') + 'old',
    'unrelated-cache'
  ];
  for (const name of [...removed, ...kept]) { await sw.cache.open(name); }

  await sw.dispatch('activate');
  const currentKeys = await sw.cache.keys();
  for (const r of removed) { assert.ok(!currentKeys.includes(r), `应清理：${r}`); }
  for (const k of kept) { assert.ok(currentKeys.includes(k), `应保留：${k}`); }
  assert.ok(currentKeys.includes(sw.name));
});
