// 轻打卡 · Service Worker（离线可用 / 安装到主屏幕）
// 仅在被通过 https:// 或 http://localhost 访问时生效；file:// 打开时浏览器不会注册 SW。
var VERSION = 'v32-github-pages';
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
  './icons/apple-touch-icon-180.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(SHELL).then(function(cache){
      // 只预缓存应用壳。示范动图首次跟练时再进 runtime（见 fetch）。
      // 语音 assets/voice 走网络直连，不拦截。
      return Promise.allSettled(APP_FILES.map(function(url){
        return fetch(url, { cache: 'no-cache' }).then(function(res){
          if(res && res.ok){ return cache.put(url, res); }
        }).catch(function(){});
      }));
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

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return; // 不拦截 POST（如拍照识别请求）

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
  // 语音文件：不走 SW 缓存拦截，交给浏览器/ CDN 原生 Range 处理
  // （微信 iOS Audio 常发 Range；SW 回整包 200 易触发 NotSupportedError）
  if (url.origin === self.location.origin && /\/assets\/voice\//.test(url.pathname)) {
    return; // 不 respondWith = 默认网络，保留正确 Content-Type + Accept-Ranges
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
