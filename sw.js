'use strict';

// 构建会替换这四组标记，自动绑定内容 hash。
var VERSION = /* BUILD_VERSION_START */ 'coach-dev-1' /* BUILD_VERSION_END */;
var CORE = /* BUILD_PRECACHE_START */ [
  './index.html',
  './styles.css',
  './app.js',
  './content.js',
  './session.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512-maskable.png',
  './icons/icon-512.png',
  './assets/exercise-guides/0257-poster.png',
  './assets/exercise-guides/0257.gif',
  './assets/exercise-guides/0276-poster.png',
  './assets/exercise-guides/0276.gif',
  './assets/exercise-guides/0291-poster.png',
  './assets/exercise-guides/0291.gif',
  './assets/exercise-guides/0292-poster.png',
  './assets/exercise-guides/0292.gif',
  './assets/exercise-guides/0404-poster.png',
  './assets/exercise-guides/0404.gif',
  './assets/exercise-guides/0576-poster.png',
  './assets/exercise-guides/0576.gif',
  './assets/exercise-guides/0579-poster.png',
  './assets/exercise-guides/0579.gif',
  './assets/exercise-guides/0588-poster.png',
  './assets/exercise-guides/0588.gif',
  './assets/exercise-guides/0599-poster.png',
  './assets/exercise-guides/0599.gif',
  './assets/exercise-guides/0603-poster.png',
  './assets/exercise-guides/0603.gif',
  './assets/exercise-guides/0643-poster.png',
  './assets/exercise-guides/0643.gif',
  './assets/exercise-guides/0659-poster.png',
  './assets/exercise-guides/0659.gif',
  './assets/exercise-guides/0669-poster.png',
  './assets/exercise-guides/0669.gif',
  './assets/exercise-guides/0710-poster.png',
  './assets/exercise-guides/0710.gif',
  './assets/exercise-guides/0794-poster.png',
  './assets/exercise-guides/0794.gif',
  './assets/exercise-guides/1167-poster.png',
  './assets/exercise-guides/1167.gif',
  './assets/exercise-guides/1365-poster.png',
  './assets/exercise-guides/1365.gif',
  './assets/exercise-guides/1368-poster.png',
  './assets/exercise-guides/1368.gif',
  './assets/exercise-guides/1373-poster.png',
  './assets/exercise-guides/1373.gif',
  './assets/exercise-guides/1377-poster.png',
  './assets/exercise-guides/1377.gif',
  './assets/exercise-guides/1403-poster.png',
  './assets/exercise-guides/1403.gif',
  './assets/exercise-guides/1424-poster.png',
  './assets/exercise-guides/1424.gif',
  './assets/exercise-guides/1428-poster.png',
  './assets/exercise-guides/1428.gif',
  './assets/exercise-guides/1459-poster.png',
  './assets/exercise-guides/1459.gif',
  './assets/exercise-guides/1576-poster.png',
  './assets/exercise-guides/1576.gif',
  './assets/exercise-guides/1677-poster.png',
  './assets/exercise-guides/1677.gif',
  './assets/exercise-guides/2133-poster.png',
  './assets/exercise-guides/2133.gif',
  './assets/exercise-guides/2287-poster.png',
  './assets/exercise-guides/2287.gif',
  './assets/exercise-guides/3013-poster.png',
  './assets/exercise-guides/3013.gif',
  './assets/exercise-guides/3221-poster.png',
  './assets/exercise-guides/3221.gif',
  './assets/exercise-guides/3239-poster.png',
  './assets/exercise-guides/3239.gif'
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
        return file.indexOf('./assets/exercise-guides/') === 0;
      })
    };
  } catch (error) {
    return { ready: false, version: VERSION, courseReady: false };
  }
}

async function installRelease() {
  var existed = (await caches.keys()).includes(CACHE_NAME);
  try {
    var responses = await Promise.all(CORE.map(function (file) {
      return checkedFetch(new URL(file, SCOPE).href, file);
    }));
    var cache = await caches.open(CACHE_NAME);
    var writes = await Promise.allSettled(CORE.map(function (file, index) {
      return cache.put(new URL(file, SCOPE).href, responses[index]);
    }));
    var failed = writes.find(function (result) { return result.status === 'rejected'; });
    if (failed) { throw failed.reason; }
    if (!(await offlineStatus()).ready) { throw new Error('offline-release-incomplete'); }
  } catch (error) {
    if (!existed) { await caches.delete(CACHE_NAME); }
    throw error;
  }
}

self.addEventListener('install', function (event) {
  installation = installRelease();
  event.waitUntil(installation.then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    if (!(await offlineStatus()).ready) { throw new Error('offline-release-incomplete'); }
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (key) {
      return key !== CACHE_NAME && (key.indexOf(CACHE_PREFIX) === 0 || key.indexOf(LEGACY_PREFIX) === 0);
    }).map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
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
  var cache, hit;
  try {
    cache = await caches.open(CACHE_NAME);
    hit = await cache.match(url);
    if (hit) {
      return hit;
    }
  } catch (error) {}
  try {
    var response = await checkedFetch(url, file);
    try {
      if (cache) { await cache.put(url, response.clone()); }
    } catch (error) {}
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
    if (/^assets\/exercise-guides\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|gif)$/.test(relative)) {
      file = './' + relative;
    }
  }
  if (!file) { return; }
  event.respondWith(cacheFirst(url.href, file));
});
