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
  './assets/exercise-guides/bird-dog-poster.png',
  './assets/exercise-guides/bird-dog.gif',
  './assets/exercise-guides/generated/wall-plank-anatomy.png',
  './assets/voice/countdown-3.m4a',
  './assets/voice/countdown-start.m4a',
  './assets/voice/encourage-1.m4a',
  './assets/voice/encourage-2.m4a',
  './assets/voice/encourage-3.m4a',
  './assets/voice/encourage-4.m4a',
  './assets/voice/encourage-5.m4a',
  './assets/voice/finish-done.m4a',
  './assets/voice/finish-stretch.m4a',
  './assets/voice/stretch-0643.m4a',
  './assets/voice/stretch-0669.m4a',
  './assets/voice/stretch-0794.m4a',
  './assets/voice/stretch-1365.m4a',
  './assets/voice/stretch-1377.m4a',
  './assets/voice/stretch-1403.m4a',
  './assets/voice/stretch-1424.m4a',
  './assets/voice/stretch-1576.m4a',
  './assets/voice/switch-side.m4a',
  './assets/voice/warmup-0257.m4a',
  './assets/voice/warmup-1167.m4a',
  './assets/voice/warmup-1368.m4a',
  './assets/voice/warmup-1428.m4a',
  './assets/voice/warmup-3221.m4a',
  './assets/voice/work-0276.m4a',
  './assets/voice/work-0291.m4a',
  './assets/voice/work-0292.m4a',
  './assets/voice/work-0404.m4a',
  './assets/voice/work-0576.m4a',
  './assets/voice/work-0579.m4a',
  './assets/voice/work-0588.m4a',
  './assets/voice/work-0599.m4a',
  './assets/voice/work-0603.m4a',
  './assets/voice/work-0659.m4a',
  './assets/voice/work-0710.m4a',
  './assets/voice/work-1373.m4a',
  './assets/voice/work-1459.m4a',
  './assets/voice/work-1677.m4a',
  './assets/voice/work-2287.m4a',
  './assets/voice/work-3013.m4a'
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
  event.waitUntil(installation);
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

function rangeResponse(response, rangeHeader) {
  return response.arrayBuffer().then(function (buffer) {
    var match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || '').trim());
    var size = buffer.byteLength;
    var start, end;
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    }
    if (!match[1]) {
      var suffixLength = Number(match[2]);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
      }
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    }
    var headers = new Headers(response.headers);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(buffer.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: headers });
  });
}

async function cacheFirst(url, file, rangeHeader) {
  var cache, hit;
  try {
    cache = await caches.open(CACHE_NAME);
    hit = await cache.match(url);
    if (hit) {
      return rangeHeader ? rangeResponse(hit, rangeHeader) : hit;
    }
  } catch (error) {}
  try {
    var response = await checkedFetch(url, file);
    try {
      if (cache) { await cache.put(url, response.clone()); }
    } catch (error) {}
    return rangeHeader ? rangeResponse(response, rangeHeader) : response;
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
    if (/^assets\/(?:exercise-guides\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|gif)|voice\/[a-zA-Z0-9_-]+\.m4a)$/.test(relative)) {
      file = './' + relative;
    }
  }
  if (!file) { return; }
  var rangeHeader = request.headers && typeof request.headers.get === 'function' ? request.headers.get('Range') : null;
  event.respondWith(cacheFirst(url.href, file, rangeHeader));
});
