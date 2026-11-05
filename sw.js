'use strict';

// 构建会替换这四组标记，自动纳入目录内所有 SVG 并绑定内容 hash。
// 源码默认清单同步当前课程；新增素材时需同步此处，test-sw 会检查遗漏。
var VERSION = /* BUILD_VERSION_START */ "habits-202a71d31ae99825ed2f" /* BUILD_VERSION_END */;
var CORE = /* BUILD_PRECACHE_START */ [
  "./app.js",
  "./assets/habit-guides/seated-arms.svg",
  "./assets/habit-guides/seated-chest.svg",
  "./assets/habit-guides/seated-knee.svg",
  "./assets/habit-guides/seated-neck.svg",
  "./assets/habit-guides/seated-pause.svg",
  "./assets/habit-guides/seated-ready.svg",
  "./assets/habit-guides/standing-pause.svg",
  "./assets/habit-guides/standing-ready.svg",
  "./assets/habit-guides/standing-shoulders.svg",
  "./assets/habit-guides/standing-walk.svg",
  "./content.js",
  "./icons/apple-touch-icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512-maskable.png",
  "./icons/icon-512.png",
  "./index.html",
  "./manifest.webmanifest",
  "./session.js",
  "./store.js",
  "./styles.css"
] /* BUILD_PRECACHE_END */;
var COMPLETE_RELEASE = /* BUILD_COMPLETE_START */ true /* BUILD_COMPLETE_END */;
var RELEASE_HASHES = /* BUILD_HASHES_START */ {
  "./app.js": "b168078bb7d56412f024c5ec19148fe0213c7da7fcb6e517186e1cb0eef8ae50",
  "./assets/habit-guides/seated-arms.svg": "bdf97d0fe0b9d39aaebbc3e54567d0236fb601d8db24ec446ba4818001473197",
  "./assets/habit-guides/seated-chest.svg": "22ced98b9742bcf4cff978c203b95053ce5d1c9736a88286181c44a8892d2885",
  "./assets/habit-guides/seated-knee.svg": "5595bfe62123f77eec69628ab5a4ca8e008367a84548bac07970a0760bb097d6",
  "./assets/habit-guides/seated-neck.svg": "226792c90eaf57d4dbca64db15675599671958d91f3c3a590ef91449c5eb4faf",
  "./assets/habit-guides/seated-pause.svg": "0c839f3254f562b6db55b686099037179e251644bd8aab9d36aff7117da49dc1",
  "./assets/habit-guides/seated-ready.svg": "213facbbcb2db83ce67b2a94cdbccfcaa57e5febbc0f90e4eca627aafc658fc3",
  "./assets/habit-guides/standing-pause.svg": "74df5d8e4130a408d37b3e4f90d6372e72f518f1ffedc01f008ae29700beaa10",
  "./assets/habit-guides/standing-ready.svg": "4295d252a1acc1df9671386ff9d5b826a70eccda97dc94d1bfed7e7dd6411ec1",
  "./assets/habit-guides/standing-shoulders.svg": "ec1a8dc5c0f79c1bc5c9ea122fa8225337692b573471853abdfc5c473da98e93",
  "./assets/habit-guides/standing-walk.svg": "fdb8faf2eefa856a6032840850c29924bd5a3d84c005c1df8b6a4cef6d76ed2e",
  "./content.js": "e75f5edf29e8c6e1a5514ab9e130cc3d288ca48e1d1e1313d4aeb6c2992e89ed",
  "./icons/apple-touch-icon-180.png": "989da9616e205b878097be824e97fb7da865b4c7b9546933da28fa62bed47bb6",
  "./icons/icon-192.png": "6c392bf8142fee95fce333905eab906a62abd37c7781e84ea2c07ff8d95bdfac",
  "./icons/icon-512-maskable.png": "b5b9a9e528e6f024db137a1ba0986f33b6c355c8608108d3e020bfdd29721153",
  "./icons/icon-512.png": "b5b9a9e528e6f024db137a1ba0986f33b6c355c8608108d3e020bfdd29721153",
  "./index.html": "e833e038d8fd90ee78619bbe29d6fbbbb585984a26ff7e1c791a726bf512f460",
  "./manifest.webmanifest": "fdb63da2d7ff2454b686825ad108ebe7c5ced5c407e76c0946f2e3022468137e",
  "./session.js": "517efbff8e096077b820fa41e8b90e7b6a4fb24fb61875aab0c54d7bfa728b3c",
  "./store.js": "45e97d14f1ef687da92136272b7c93b6c300b37985bbbbdf012cd60ae69d96cd",
  "./styles.css": "64f6d4768a2b054f26020eb0ec5f7222ea604520809f5fcd8a3e12e27a578a25"
} /* BUILD_HASHES_END */;

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
