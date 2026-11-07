import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { PROJECT_ROOT, listFiles, precacheFiles, releaseVersion, renderServiceWorker, sha256 } from './build-dist.mjs';
import { checkArtifact } from './check-dist.mjs';

// 纯 Node/内存测试：不启动服务器、不读取或改写 dist，也不需要浏览器依赖。
const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const manifestSource = await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8');
const scope = 'https://example.test/qingdaka/';
const guide = './assets/habit-guides/guide.svg';
const prefix = value => 'qingdaka-habits:' + encodeURIComponent(value) + ':';
const legacyPrefix = value => 'workbuddy:' + encodeURIComponent(value) + ':';
const contentFixture = `window.QDK_CONTENT = {
  courses: [{id:'minute',minutes:1},{id:'gentle',minutes:3},{id:'steady',minutes:5}],
  modes: [{id:'seated'},{id:'standing'}],
  buildPlan: function(id, mode) {
    var seconds = {minute:60,gentle:180,steady:300}[id];
    return [
      {id:'prepare',kind:'prepare',mode:mode,seconds:10,activeSeconds:0,image:'${guide}'},
      {id:'move',kind:'move',mode:mode,seconds:seconds-20,activeSeconds:seconds-20,image:'${guide}'},
      {id:'settle',kind:'settle',mode:mode,seconds:10,activeSeconds:0,image:'${guide}'}
    ];
  }
};`;

function compile(files) {
  const version = releaseVersion(files);
  const precache = precacheFiles(files);
  const hashes = Object.fromEntries(precache.map(file => [file, sha256(files.get(file.slice(2)))]));
  const sw = renderServiceWorker(files.get('sw.js').toString(), { version, precache, hashes });
  files.set('sw.js', Buffer.from(sw));
  return { files, version, precache, sw };
}

function release(label = 'A') {
  const files = new Map(Object.entries({
    'index.html': '<!doctype html><title>轻打卡 · 动起来</title><link rel="stylesheet" href="./styles.css"><script src="./content.js"></script><script src="./store.js"></script><script src="./session.js"></script><script src="./app.js"></script>',
    'styles.css': 'body { color: #203f36; }',
    'app.js': 'window.release = ' + JSON.stringify(label) + ';',
    'content.js': contentFixture,
    'store.js': 'window.store = {};',
    'session.js': 'window.session = {};',
    'manifest.webmanifest': manifestSource,
    '.nojekyll': '',
    'icons/icon-192.png': 'fixture-icon-192',
    'icons/icon-512.png': 'fixture-icon-512',
    'icons/icon-512-maskable.png': 'fixture-icon-maskable',
    'icons/apple-touch-icon-180.png': 'fixture-icon-apple',
    'assets/habit-guides/guide.svg': '<svg xmlns="http://www.w3.org/2000/svg"><title>自制示意</title></svg>',
    'assets/habit-guides/extra.svg': '<svg xmlns="http://www.w3.org/2000/svg"><title>备用示意</title></svg>',
    'sw.js': source
  }).map(([name, value]) => [name, Buffer.from(value)]));
  return compile(files);
}

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
    const result = state.emit('fetch', { request: { url: new URL(path, base).href, method: 'GET', mode: 'same-origin', ...options } });
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

function setup(pack = release(), options = {}) {
  return worker(pack.sw, { net: network(pack.files, options.base || scope), ...options });
}

async function installed(pack = release(), options = {}) {
  const sw = setup(pack, options);
  await sw.dispatch('install');
  return sw;
}

test('本地 serve 配置对核心和同名素材禁用长缓存，SW 必须重新验证', async () => {
  const config = JSON.parse(await readFile(new URL('../serve.json', import.meta.url), 'utf8'));
  assert.equal(config.public, '.');
  assert.equal(config.cleanUrls, false);
  const cacheControl = rule => rule.headers.find(header => header.key === 'Cache-Control')?.value;
  assert.equal(cacheControl(config.headers.find(rule => rule.source === '**')), 'no-cache');
  assert.match(cacheControl(config.headers.find(rule => rule.source === 'sw.js')), /no-cache.*no-store/);
  assert.ok(config.headers.every(rule => !/immutable|max-age/.test(cacheControl(rule) || '')));
});

test('首次安装完整包：不主动 skipWaiting，自然 activate 后 claim', async () => {
  const pack = release();
  const sw = await installed(pack);
  assert.equal(sw.skipped, 0);
  assert.equal(sw.claimed, 0);
  assert.deepEqual(await sw.status(), { ready: true, courseReady: true, version: pack.version });
  assert.equal(sw.net.calls.length, pack.precache.length);
  assert.ok(sw.net.calls.every(call => call.options.cache === 'no-store' && call.options.redirect === 'error'));
  await sw.dispatch('activate');
  assert.equal(sw.claimed, 1);
  assert.equal(sw.skipped, 0);
  sw.net.online = false;
  for (const file of pack.precache) {
    assert.deepEqual(Buffer.from(await (await sw.request(file)).arrayBuffer()), pack.files.get(file.slice(2)));
  }
  assert.equal(sw.net.calls.length, pack.precache.length, '离线命中不能启动后台网络更新');
});

test('已有 active：新包等待明确 ACTIVATE_UPDATE，旧控制器继续返回同一旧包', async () => {
  const old = await installed(release('A'));
  await old.dispatch('activate');
  const next = await installed(release('B'), { cache: old.cache, active: {} });
  assert.equal(next.skipped, 0);
  assert.equal(next.claimed, 0);
  assert.ok((await old.cache.keys()).includes(old.name));
  const calls = old.net.calls.length;
  assert.equal(await (await old.request('./app.js?cacheBust=new')).text(), 'window.release = "A";');
  assert.equal(old.net.calls.length, calls);
  await next.dispatch('message', { data: { type: 'UNRELATED' } });
  assert.equal(next.skipped, 0);
  await next.accept();
  assert.equal(next.skipped, 1);
  assert.equal(next.claimed, 0, 'skipWaiting 不等于已经 activate');
  await next.dispatch('activate');
  assert.equal(next.claimed, 1);
  assert.equal(await (await next.request('./app.js')).text(), 'window.release = "B";');
  assert.ok(!(await old.cache.keys()).includes(old.name));
});

test('失败安装不能 waiting 或破坏 active：离线、404、重定向、hash 错误和写入失败', async t => {
  for (const failure of ['offline', '404', 'redirect', 'integrity', 'quota']) {
    await t.test(failure, async () => {
      const old = await installed(release('A'));
      const pack = release('B');
      const next = setup(pack, { cache: old.cache, active: {} });
      const url = new URL(guide, scope).href;
      if (failure === 'offline') { next.net.online = false; }
      if (failure === '404') { next.net.failures.set(url, 404); }
      if (failure === 'redirect') { next.net.failures.set(url, 302); }
      if (failure === 'integrity') { next.net.files.set(url, Buffer.from('<svg>wrong release</svg>')); }
      if (failure === 'quota') { next.cache.failPut = 'guide.svg'; next.cache.delayedPuts = 2; }
      await assert.rejects(next.dispatch('install'));
      assert.equal(next.skipped, 0);
      assert.equal(next.claimed, 0);
      assert.ok(!(await next.cache.keys()).includes(next.name), '半成品包应清理');
      assert.ok((await next.cache.keys()).includes(old.name));
      assert.equal((await next.status()).ready, false);
      assert.equal((await old.status()).ready, true);
      old.net.online = false;
      assert.equal(await (await old.request('./app.js')).text(), 'window.release = "A";');
      await assert.rejects(next.accept());
      assert.equal(next.skipped, 0);
    });
  }
});

test('同版本重装失败不删除已 active 的完整缓存', async () => {
  const pack = release();
  const old = await installed(pack);
  const next = setup(pack, { cache: old.cache, active: {} });
  next.net.online = false;
  await assert.rejects(next.dispatch('install'));
  assert.equal((await old.status()).ready, true);
  assert.equal(await (await old.request('./app.js')).text(), 'window.release = "A";');
});

test('安装未结束时收到明确更新消息，仍须先等整包成功', async () => {
  const sw = setup();
  let releaseNetwork;
  sw.net.gate = new Promise(resolve => { releaseNetwork = resolve; });
  const installation = sw.dispatch('install');
  const acceptance = sw.accept();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sw.skipped, 0);
  releaseNetwork();
  await Promise.all([installation, acceptance]);
  assert.equal(sw.skipped, 1);
});

test('不完整包不可显式接管或 activate；旧缓存保留', async () => {
  const sw = setup();
  await sw.cache.open(legacyPrefix(scope) + 'shell-old');
  await sw.accept();
  assert.equal(sw.skipped, 0);
  await assert.rejects(sw.dispatch('activate'), /offline-release-incomplete/);
  assert.equal(sw.claimed, 0);
  assert.ok((await sw.cache.keys()).includes(legacyPrefix(scope) + 'shell-old'));
});

test('激活只清理完全匹配 scope 的新版/旧版缓存', async () => {
  const sw = await installed();
  const removed = [prefix(scope) + 'old', legacyPrefix(scope) + 'shell-v44', legacyPrefix(scope) + 'runtime-media'];
  const kept = [
    prefix('https://example.test/qingdaka/child/') + 'old',
    prefix('https://example.test/qingdaka-other/') + 'old',
    prefix('https://example.test/') + 'old',
    legacyPrefix('https://example.test/other/') + 'shell-old',
    legacyPrefix('https://other.test/qingdaka/') + 'runtime-media',
    'workbuddy:shell-v1', 'unrelated-cache'
  ];
  for (const name of [...removed, ...kept]) { await sw.cache.open(name); }
  await sw.dispatch('activate');
  assert.deepEqual((await sw.cache.keys()).sort(), [...kept, sw.name].sort());
});

test('固定版本 cache-first：页面别名、query、SVG 均不更新已缓存内容', async () => {
  const sw = await installed();
  const calls = sw.net.calls.length;
  sw.net.files.set(new URL('index.html', scope).href, Buffer.from('new homepage'));
  sw.net.files.set(new URL(guide, scope).href, Buffer.from('<svg>new course</svg>'));
  assert.match(await (await sw.request('./?campaign=home', { mode: 'navigate' })).text(), /轻打卡/);
  assert.match(await (await sw.request('./index.html?v=new')).text(), /轻打卡/);
  assert.match(await (await sw.request(guide + '?v=new')).text(), /自制示意/);
  assert.equal(sw.net.calls.length, calls);
});

test('缓存 miss 只补回同版本；拒绝新版本、HTTP 错误及跨缓存回退', async () => {
  const pack = release();
  const sw = await installed(pack);
  const url = new URL('./app.js', scope).href;
  const cache = await sw.cache.open(sw.name);
  await cache.delete(url);
  assert.equal((await sw.status()).ready, false);
  const calls = sw.net.calls.length;
  assert.equal(await (await sw.request('./app.js?bypass=1')).text(), 'window.release = "A";');
  assert.equal(sw.net.calls.length, calls + 1);
  assert.equal((await sw.status()).ready, true);
  await cache.delete(url);
  await (await sw.cache.open(prefix(scope) + 'other-release')).put(url, new Response('wrong cached version'));
  sw.net.files.set(url, Buffer.from('window.release = "B";'));
  assert.equal((await sw.request('./app.js')).status, 503);
  assert.equal(await cache.match(url), undefined);
  sw.net.failures.set(url, 404);
  assert.equal((await sw.request('./app.js')).status, 503);
  sw.net.online = false;
  assert.equal((await sw.request('./app.js')).status, 503);
  assert.equal((await sw.status()).ready, false);
});

test('缺少课程图必须报告离线未就绪，不能只检查 HTML/JS', async () => {
  const sw = await installed();
  await (await sw.cache.open(sw.name)).delete(new URL(guide, scope).href);
  assert.deepEqual(await sw.status(), { ready: false, courseReady: false, version: sw.version });
});

test('消息端口和 CacheStorage 失败时返回稳定状态，不误报完整离线', async () => {
  const sw = await installed();
  await sw.dispatch('message', {});
  await sw.dispatch('message', { data: { type: 'OFFLINE_STATUS' } });
  sw.cache.failOpen = true;
  assert.deepEqual(await sw.status(), { ready: false, courseReady: false, version: sw.version });
  assert.equal(await (await sw.request('./app.js')).text(), 'window.release = "A";');
  sw.net.online = false;
  assert.equal((await sw.request('./app.js')).status, 503);
});

test('仅处理 scope 内白名单 GET；不劫持其他站点、旧素材及未知导航', async () => {
  const sw = await installed();
  const calls = sw.net.calls.length;
  for (const path of [
    'https://elsewhere.test/qingdaka/app.js', '/qingdaka-other/app.js',
    './test.html', './unknown-route', './assets/exercise-guides/old.svg',
    './assets/voice/old.m4a', './assets/habit-guides/not-in-release.svg', './sw.js'
  ]) { assert.equal(await sw.request(path, { mode: 'navigate' }), undefined, path); }
  assert.equal(await sw.request('./app.js', { method: 'POST' }), undefined);
  assert.equal(sw.net.calls.length, calls);
});

test('源码默认清单同步全部现有 SVG，安装后首次查看示范也可离线', async () => {
  const net = network(new Map());
  const sw = worker(source, { net });
  const guides = (await listFiles(PROJECT_ROOT, 'assets/habit-guides')).filter(name => name.endsWith('.svg'));
  assert.ok(guides.length > 0);
  assert.deepEqual(sw.core.filter(file => file.startsWith('./assets/habit-guides/')).sort(), guides.map(name => './' + name).sort());
  assert.deepEqual(await sw.cache.keys(), []);
  assert.equal((await sw.status()).ready, false);
  assert.deepEqual(await sw.cache.keys(), [], '状态查询不得创建半成品缓存');
  for (const file of sw.core) { net.files.set(new URL(file, scope).href, Buffer.from(file)); }
  await sw.dispatch('install');
  assert.deepEqual(await sw.status(), { ready: true, courseReady: true, version: sw.version });
  net.online = false;
  for (const name of guides) { assert.equal(await (await sw.request('./' + name)).text(), './' + name); }
});

test('只有核心的源码模式不夸大离线：按需缓存 SVG 后 courseReady 仍为 false', async () => {
  const net = network(new Map());
  const defaults = worker(source, { net });
  const coreSource = renderServiceWorker(source, {
    version: 'habits-dev-core-only', precache: defaults.core.filter(file => !file.startsWith('./assets/')),
    hashes: {}, complete: false
  });
  const sw = worker(coreSource, { net });
  for (const file of sw.core) { net.files.set(new URL(file, scope).href, Buffer.from(file)); }
  for (const file of ['./index.html', './styles.css', './app.js', './content.js', './store.js', './session.js', './manifest.webmanifest']) {
    assert.ok(sw.core.includes(file));
  }
  net.files.set(new URL(guide, scope).href, Buffer.from('<svg>local guide</svg>'));
  await sw.dispatch('install');
  assert.deepEqual(await sw.status(), { ready: true, courseReady: false, version: sw.version });
  assert.equal(await (await sw.request(guide)).text(), '<svg>local guide</svg>');
  net.online = false;
  const calls = net.calls.length;
  assert.equal(await (await sw.request(guide)).text(), '<svg>local guide</svg>');
  assert.equal(net.calls.length, calls);
  assert.equal((await sw.status()).courseReady, false);
});

test('构建 hash 可复算且确定；核心、SVG、SW 策略变化均换版本', () => {
  const original = release();
  assert.equal(original.version, release().version);
  assert.equal(original.version, releaseVersion(original.files));
  for (const name of ['styles.css', 'store.js', 'session.js', 'assets/habit-guides/guide.svg', 'sw.js']) {
    const changed = new Map(original.files);
    changed.set(name, Buffer.concat([changed.get(name), Buffer.from('\n/* changed */')]));
    assert.notEqual(releaseVersion(changed), original.version, name);
  }
  const reordered = new Map([...original.files].reverse());
  assert.equal(releaseVersion(reordered), original.version);
  assert.throws(() => renderServiceWorker(source.replace('/* BUILD_HASHES_END */', ''), {
    version: 'bad', precache: [], hashes: {}
  }), /marker/);
});

test('发布门槛接受完整静态包并覆盖所有 SVG（包括尚未引用的自制图）', async () => {
  const pack = release();
  const result = await checkArtifact(pack.files);
  assert.equal(result.plans, 6);
  assert.equal(result.guides, 2);
  assert.ok(pack.precache.includes('./assets/habit-guides/extra.svg'));
});

test('真实课程内容和自制 SVG 通过六套计划校验（用最小 UI 隔离主代理的并行改造）', async () => {
  const pack = release();
  pack.files.set('content.js', await readFile(new URL('../content.js', import.meta.url)));
  for (const name of [...pack.files.keys()]) {
    if (name.startsWith('assets/habit-guides/')) { pack.files.delete(name); }
  }
  const guides = (await listFiles(PROJECT_ROOT, 'assets/habit-guides')).filter(name => name.endsWith('.svg'));
  for (const name of guides) { pack.files.set(name, await readFile(new URL('../' + name, import.meta.url))); }
  const result = await checkArtifact(compile(pack.files).files);
  assert.equal(result.plans, 6);
  assert.equal(result.guides, guides.length);
  assert.ok(result.usedImages > 0);
});

test('发布门槛拒绝漏图、漏缓存、非精确时长、旧功能、文档和篡改', async t => {
  await t.test('missing image', async () => {
    const pack = release();
    pack.files.set('content.js', Buffer.from(contentFixture.replaceAll('guide.svg', 'missing.svg')));
    await assert.rejects(checkArtifact(compile(pack.files).files), /不存在的资源/);
  });
  await t.test('missing precache', async () => {
    const pack = release();
    const hashes = Object.fromEntries(pack.precache.map(file => [file, sha256(pack.files.get(file.slice(2)))]));
    pack.files.set('sw.js', Buffer.from(renderServiceWorker(source, {
      version: pack.version, precache: pack.precache.filter(file => file !== guide), hashes
    })));
    await assert.rejects(checkArtifact(pack.files), /预缓存/);
  });
  await t.test('wrong duration', async () => {
    const pack = release();
    pack.files.set('content.js', Buffer.from(contentFixture.replaceAll('seconds-20', 'seconds-19')));
    await assert.rejects(checkArtifact(compile(pack.files).files), /总时长/);
  });
  for (const name of ['README.md', 'scripts/test-sw.mjs', 'assets/voice/a.m4a', 'assets/exercise-guides/a.svg', 'assets/habit-guides/notes.txt']) {
    await t.test(name, async () => {
      const pack = release();
      pack.files.set(name, Buffer.from('not publishable'));
      await assert.rejects(checkArtifact(pack.files), /泄漏/);
    });
  }
  await t.test('legacy UI', async () => {
    const pack = release();
    pack.files.set('index.html', Buffer.from(pack.files.get('index.html').toString() + '<p>记蛋白</p>'));
    await assert.rejects(checkArtifact(compile(pack.files).files), /旧蛋白/);
  });
  await t.test('tampered asset', async () => {
    const pack = release();
    pack.files.set('assets/habit-guides/guide.svg', Buffer.from('<svg>tampered</svg>'));
    await assert.rejects(checkArtifact(pack.files), /hash/);
  });
});
