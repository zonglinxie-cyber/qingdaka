// 轻打卡 · Service Worker（离线可用 / 安装到主屏幕）
// 仅在被通过 https:// 或 http://localhost 访问时生效；file:// 打开时浏览器不会注册 SW。
var VERSION = 'v42-397c0d9b08571eba';
var CACHE_PREFIX = 'workbuddy:' + encodeURIComponent(self.registration.scope) + ':';
var SHELL = CACHE_PREFIX + 'shell-' + VERSION;
var RUNTIME = CACHE_PREFIX + 'runtime-media';
// 动图/海报按需进运行时缓存（约 70 张示范图），给足余量避免刚练完就被裁掉
var RUNTIME_MAX = 120;

var APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './content.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png',
  './voice-scripts.json'
];
var VOICE_MANIFEST = './voice-scripts.json';

function cacheFiles(cache, files){
  return Promise.all(files.map(async function(url){
    var response = await fetch(url, { cache:'reload' });
    if(!response.ok){ throw new Error('offline-file-unavailable: ' + url); }
    await cache.put(url, response);
  }));
}
async function voiceUrls(cache){
  var manifest = await cache.match(VOICE_MANIFEST);
  var entries = manifest && await manifest.json();
  if(!Array.isArray(entries) || !entries.length){ throw new Error('voice-manifest-unavailable'); }
  return entries.map(function(entry){
    if(!entry || !/^[a-z0-9-]+$/i.test(entry.key)){ throw new Error('invalid-voice-key'); }
    return './assets/voice/' + entry.key + '.m4a';
  });
}
self.addEventListener('install', function(e){
  e.waitUntil((async function(){
    var cache = await caches.open(SHELL);
    await cacheFiles(cache, APP_FILES);
    await cacheFiles(cache, await voiceUrls(cache));
    // 更新先等待用户确认，整套核心文件及语音完整后才能成为活动版本。
  })());
});
self.addEventListener('activate', function(e){
  e.waitUntil((async function(){
    var keys = await caches.keys();
    var media = await caches.open(RUNTIME);
    for(var name of keys.filter(function(k){ return k.indexOf(CACHE_PREFIX + 'runtime-') === 0 && k !== RUNTIME; })){
      try{
        var old = await caches.open(name), requests = await old.keys();
        for(var request of requests){
          if(!await media.match(request)){ await media.put(request, await old.match(request)); }
        }
        await caches.delete(name);
      }catch(err){ /* 空间不足时保留旧示范缓存，读取时仍可回退。 */ }
    }
    await trimRuntimeCache(media);
    await Promise.all(keys.filter(function(k){
      // 示范图沿用同一运行时缓存，不因更新而失去已下载的课程。
      return k.indexOf(CACHE_PREFIX + 'shell-') === 0 && k !== SHELL;
    }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
  })());
});
self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'ACTIVATE_UPDATE'){ self.skipWaiting(); }
  if(e.data && e.data.type === 'OFFLINE_STATUS' && e.ports[0]){
    e.waitUntil((async function(){
      try{
        var cache = await caches.open(SHELL), files = APP_FILES.concat(await voiceUrls(cache));
        var hits = await Promise.all(files.map(function(url){ return cache.match(url); }));
        e.ports[0].postMessage({ ready:hits.every(Boolean), version:VERSION });
      }catch(err){ e.ports[0].postMessage({ ready:false }); }
    })());
  }
});
async function trimRuntimeCache(cache){
  var keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - RUNTIME_MAX)).map(function(req){ return cache.delete(req); }));
}

function rangeResponse(response, rangeHeader){
  return response.arrayBuffer().then(function(buffer){
    var match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || '').trim());
    var size = buffer.byteLength;
    var start, end;
    if(!match || (!match[1] && !match[2])){
      return new Response(null, { status:416, headers:{ 'Content-Range':'bytes */' + size } });
    }
    if(!match[1]){
      var suffixLength = Number(match[2]);
      if(!Number.isFinite(suffixLength) || suffixLength <= 0){
        return new Response(null, { status:416, headers:{ 'Content-Range':'bytes */' + size } });
      }
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if(!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start){
      return new Response(null, { status:416, headers:{ 'Content-Range':'bytes */' + size } });
    }
    var headers = new Headers(response.headers);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(buffer.slice(start, end + 1), { status:206, statusText:'Partial Content', headers:headers });
  });
}

function voiceResponse(req, url){
  var range = req.headers.get('Range');
  return caches.open(SHELL).then(function(c){ return c.match(url.href); }).then(function(hit){
    if(hit){ return range ? rangeResponse(hit, range) : hit; }
    // 首次 Range 请求也拉取完整 m4a 后再切片：缓存可用于后续离线播放，且
    // 返回的仍是符合媒体元素预期的 206，而不是会触发 iOS 错误的整包 200。
    return fetch(url.href, { cache:'no-store' }).then(function(res){
      if(!res || !res.ok){ return res; }
      return caches.open(SHELL).then(function(cache){
        return cache.put(url.href, res.clone()).catch(function(){});
      }).then(function(){ return range ? rangeResponse(res, range) : res; });
    });
  });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET'){ return; }
  var url = new URL(req.url), root = new URL(self.registration.scope);
  if(url.origin !== root.origin || url.pathname.indexOf(root.pathname) !== 0){ return; }
  var entryPage = url.pathname === root.pathname || url.pathname === root.pathname + 'index.html';
  var shellFile = APP_FILES.some(function(file){ return new URL(file, root).pathname === url.pathname; });
  // 页面与代码来自同一版本；其他页面（如测试页）绝不覆盖首页缓存。
  if(entryPage || shellFile){
    e.respondWith(caches.open(SHELL).then(async function(cache){
      return await cache.match(entryPage ? './index.html' : url.origin + url.pathname) || fetch(req);
    }));
    return;
  }
  if(req.mode === 'navigate'){ return; }
  if(url.pathname.indexOf(root.pathname + 'assets/voice/') === 0){
    e.respondWith(voiceResponse(req, url));
    return;
  }
  if(url.pathname.indexOf(root.pathname + 'assets/exercise-guides/') === 0){
    var cached = caches.open(RUNTIME).then(async function(cache){
      var hit = await cache.match(req);
      if(!hit){
        for(var name of await caches.keys()){
          if(name !== RUNTIME && name.indexOf(CACHE_PREFIX + 'runtime-') === 0){
            hit = await (await caches.open(name)).match(req);
            if(hit){ break; }
          }
        }
      }
      var update = fetch(req).then(async function(res){
        if(res.ok && res.type === 'basic'){
          await cache.put(req, res.clone()); await trimRuntimeCache(cache);
        }
        return res;
      }).catch(function(){ return hit || new Response('', {status:503}); });
      return {hit:hit, update:update};
    });
    e.respondWith(cached.then(function(result){ return result.hit || result.update; }));
    e.waitUntil(cached.then(function(result){ return result.update; }));
  }
});
