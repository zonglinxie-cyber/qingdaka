'use strict';

// 构建会替换这四组标记，自动纳入目录内所有 SVG 并绑定内容 hash。
// 源码默认清单同步当前课程；新增素材时需同步此处，test-sw 会检查遗漏。
var VERSION = /* BUILD_VERSION_START */ 'habits-dev-2' /* BUILD_VERSION_END */;
var CORE = /* BUILD_PRECACHE_START */ [
  './index.html',
  './styles.css',
  './app.js',
  './content.js',
  './store.js',
  './session.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png',
  './assets/habit-guides/seated-arms.svg',
  './assets/habit-guides/seated-chest.svg',
  './assets/habit-guides/seated-knee.svg',
  './assets/habit-guides/seated-neck.svg',
  './assets/habit-guides/seated-pause.svg',
  './assets/habit-guides/seated-ready.svg',
  './assets/habit-guides/standing-pause.svg',
  './assets/habit-guides/standing-ready.svg',
  './assets/habit-guides/standing-shoulders.svg',
  './assets/habit-guides/standing-walk.svg'
] /* BUILD_PRECACHE_END */;
var COMPLETE_RELEASE = /* BUILD_COMPLETE_START */ false /* BUILD_COMPLETE_END */;
var RELEASE_HASHES = /* BUILD_HASHES_START */ {} /* BUILD_HASHES_END */;

var SCOPE = new URL(self.registration.scope);
var CACHE_PREFIX = 'qingdaka-habits:' + encodeURIComponent(SCOPE.href) + ':';
var LEGACY_PREFIX = 'workbuddy:' + encodeURIComponent(SCOPE.href) + ':';
var CACHE_NAME = CACHE_PREFIX + VERSION;
var FILES = new Map(CORE.map(function (file) {
  return [new URL(file, SCOPE).href, file];
}));
var installation;

async function checkedFetch(url, file) {
  // 文件名不带 hash，不能相信 HTTP 长缓存，也不能把新发布的文件补进旧缓存。
  var response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  if (!response || response.status !== 200 || response.redirected || response.type === 'opaque') {
    throw new Error('offline-file-unavailable: ' + file);
  }
  var expected = RELEASE_HASHES[file];
  if (COMPLETE_RELEASE && !expected) { throw new Error('offline-integrity-missing: ' + file); }
  if (expected) {
    var digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    var actual = Array.from(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
    if (actual !== expected) { throw new Error('offline-version-mismatch: ' + file); }
  }
  return response;
}

async function offlineStatus() {
  try {
    if (!(await caches.keys()).includes(CACHE_NAME)) {
      return { ready: false, version: VERSION, courseReady: false };
    }
    var cache = await caches.open(CACHE_NAME);
    var hits = await Promise.all(CORE.map(function (file) {
      return cache.match(new URL(file, SCOPE).href);
    }));
    var ready = hits.length > 0 && hits.every(function (response) { return response && response.status === 200; });
    return {
      ready: ready,
      version: VERSION,
      courseReady: ready && CORE.some(function (file) {
        return file.indexOf('./assets/habit-guides/') === 0;
      })
    };
  } catch (error) {
    return { ready: false, version: VERSION, courseReady: false };
  }
}

async function installRelease() {
  var existed = (await caches.keys()).includes(CACHE_NAME);
  try {
    // 先完整下载并校验，再写缓存；失败的更新不能污染仍在运行的旧版本。
    var responses = await Promise.all(CORE.map(function (file) {
      return checkedFetch(new URL(file, SCOPE).href, file);
    }));
    var cache = await caches.open(CACHE_NAME);
    // 等待所有写入结束后才清理失败包，避免晚到的 put 重新创建半成品。
    var writes = await Promise.allSettled(CORE.map(function (file, index) {
      return cache.put(new URL(file, SCOPE).href, responses[index]);
    }));
    var failed = writes.find(function (result) { return result.status === 'rejected'; });
    if (failed) { throw failed.reason; }
    if (!(await offlineStatus()).ready) { throw new Error('offline-release-incomplete'); }
  } catch (error) {
    // 同版本缓存可能属于现有 active（尤其源码调试），不能误删它。
    if (!existed) { await caches.delete(CACHE_NAME); }
    throw error;
  }
}

self.addEventListener('install', function (event) {
  installation = installRelease();
  event.waitUntil(installation);
  // 首装由浏览器自然激活；已有 active 时必须等待用户明确接受更新。
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    if (!(await offlineStatus()).ready) { throw new Error('offline-release-incomplete'); }
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (key) {
      // 不删除无 scope 的历史缓存：同 origin 的其他站点可能仍在使用它。
      return key !== CACHE_NAME && (key.indexOf(CACHE_PREFIX) === 0 || key.indexOf(LEGACY_PREFIX) === 0);
    }).map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
    // 页面是否 reload 由应用决定，SW 不 navigate 客户端。
  })());
});

self.addEventListener('message', function (event) {
  if (!event.data) { return; }
  if (event.data.type === 'ACTIVATE_UPDATE') {
    event.waitUntil((async function () {
      if (installation) { await installation; }
      if ((await offlineStatus()).ready) { await self.skipWaiting(); }
    })());
  }
  if (event.data.type === 'OFFLINE_STATUS' && event.ports && event.ports[0]) {
    event.waitUntil(offlineStatus().then(function (status) { event.ports[0].postMessage(status); }));
  }
});

async function cacheFirst(url, file) {
  var cache;
  try {
    cache = await caches.open(CACHE_NAME);
    var hit = await cache.match(url);
    if (hit) { return hit; }
  } catch (error) { /* 存储不可用时仍尝试获取经过版本校验的网络响应。 */ }
  try {
    var response = await checkedFetch(url, file);
    // 缓存空间不足时仍可在线使用；OFFLINE_STATUS 会如实反映缺失文件。
    try { if (cache) { await cache.put(url, response.clone()); } } catch (error) { /* 保留完整的网络响应。 */ }
    return response;
  } catch (error) {
    return new Response('This release is unavailable offline. Reconnect and accept the complete update.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') { return; }
  var url = new URL(request.url);
  if (url.origin !== SCOPE.origin || url.pathname.indexOf(SCOPE.pathname) !== 0) { return; }
  url.search = '';
  url.hash = '';
  if (url.pathname === SCOPE.pathname) { url = new URL('./index.html', SCOPE); }
  var file = FILES.get(url.href);
  if (!file && !COMPLETE_RELEASE) {
    var relative = url.pathname.slice(SCOPE.pathname.length);
    // 源码开发允许按需预览新 SVG；生产只接受构建时固定的完整清单。
    if (/^assets\/habit-guides\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.svg$/.test(relative)) {
      file = './' + relative;
    }
  }
  if (!file) { return; }
  event.respondWith(cacheFirst(url.href, file));
});
