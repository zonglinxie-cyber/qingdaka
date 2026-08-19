// 轻打卡 · Service Worker（离线可用 / 安装到主屏幕）
// 仅在被通过 https:// 或 http://localhost 访问时生效；file:// 打开时浏览器不会注册 SW。
var VERSION = 'v41-birddog';
var CACHE_PREFIX = 'workbuddy:' + encodeURIComponent(self.registration.scope) + ':';
var SHELL = CACHE_PREFIX + 'shell-' + VERSION;
var RUNTIME = CACHE_PREFIX + 'runtime-' + VERSION;
// 动图/海报按需进运行时缓存（约 70 张示范图），给足余量避免刚练完就被裁掉
var RUNTIME_MAX = 120;

var APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png',
  './voice-scripts.json'
];
var VOICE_MANIFEST = './voice-scripts.json';

function cacheFiles(cache, files){
  return Promise.allSettled(files.map(function(url){
    return fetch(url, { cache: 'no-cache' }).then(function(res){
      if(res && res.ok){ return cache.put(url, res); }
    }).catch(function(){});
  }));
}

// voice-scripts.json 是语音 key 的单一清单。用它生成 m4a 列表，避免 SW 再维护一份名单。
function cacheVoiceFiles(cache){
  return fetch(VOICE_MANIFEST, { cache: 'no-cache' }).then(function(res){
    if(!res || !res.ok){ throw new Error('voice-manifest-unavailable'); }
    return res.json();
  }).then(function(entries){
    if(!Array.isArray(entries)){ return []; }
    var urls = entries.map(function(entry){
      var key = entry && typeof entry.key === 'string' ? entry.key : '';
      return /^[a-z0-9-]+$/i.test(key) ? './assets/voice/' + key + '.m4a' : null;
    }).filter(Boolean);
    return cacheFiles(cache, urls);
  }).catch(function(){ return []; });
}

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(SHELL).then(function(cache){
      // 应用壳 + 语音清单。动图首次跟练再进 runtime。
      // 语音按清单预缓存；fetch 里把 Range 转成 206，避免 iOS 收到整包 200。
      return cacheFiles(cache, APP_FILES).then(function(){ return cacheVoiceFiles(cache); });
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){
        return k.indexOf(CACHE_PREFIX) === 0 && k !== SHELL && k !== RUNTIME;
      }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// 裁剪运行时缓存，保留最近 RUNTIME_MAX 条
function trimRuntimeCache(){
  caches.open(RUNTIME).then(function(cache){
    cache.keys().then(function(keys){
      if(keys.length > RUNTIME_MAX){
        var toDelete = keys.slice(0, keys.length - RUNTIME_MAX);
        toDelete.forEach(function(req){ cache.delete(req); });
      }
    });
  });
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
  return caches.match(url.href).then(function(hit){
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
  if (req.method !== 'GET') return;

  // 页面导航：联网优先，断网时回退到缓存的应用页（保证离线可打开）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function(res){
        if(!res || !res.ok){ throw new Error('navigation-failed'); }
        try {
          if(res.type === 'basic'){
            var copy = res.clone();
            caches.open(SHELL).then(function(c){ c.put('./index.html', copy); });
          }
        } catch {}
        return res;
      }).catch(function(){
        return caches.match('./index.html')
          .then(function(r){ return r || caches.match('./'); });
      })
    );
    return;
  }

  var url = new URL(req.url);
  // 语音文件：缓存完整 m4a，Range 请求从缓存切出 RFC 兼容的 206 响应。
  if (url.origin === self.location.origin && /\/assets\/voice\//.test(url.pathname)) {
    e.respondWith(voiceResponse(req, url));
    return;
  }
  // 同源静态资源：缓存优先 + 后台更新（stale-while-revalidate）
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function(hit){
        var net = fetch(req).then(function(res){
          if (res && res.ok && res.type === 'basic') {
            var copy = res.clone();
            caches.open(RUNTIME).then(function(c){ c.put(req, copy); trimRuntimeCache(); });
          }
          return res;
        }).catch(function(){ return hit; });
        return hit || net;
      })
    );
    return;
  }
  // 其余跨域 GET：直接放行
});
