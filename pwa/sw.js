// 코웨이 견적 계산기 PWA 서비스 워커 (적용 범위: /pwa/ 폴더만)
// - 화면 파일(HTML 등): 네트워크 우선, 실패(오프라인)하면 저장본 → 코드 수정은 자동 반영됨
// - data.json(가격표): 저장본 우선 → 구글/네트워크 상태와 무관하게 즉시 열림. 갱신은 사용자가 "업데이트"를 눌렀을 때만 (?fresh= 요청)
// - version.json: 항상 네트워크 (업데이트 확인용, 실패해도 앱은 저장본으로 동작)
// - 다른 도메인(GAS, CDN, 폰트)은 가로채지 않음
var APP_CACHE = 'coway-pwa-app-v1';
var DATA_CACHE = 'coway-pwa-data'; // 버전 올려도 지우지 않음(가격표 저장본 보존)
var FONT_CACHE = 'coway-pwa-fonts'; // 버전 올려도 지우지 않음(약 4MB, 한 번 받으면 유지)
var APP_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './lib/html2canvas.min.js', './lib/jspdf.umd.min.js', './fonts/fonts.css'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    Promise.all([
      caches.open(APP_CACHE).then(function(c) { return c.addAll(APP_FILES); }),
      caches.open(DATA_CACHE).then(function(c) {
        return c.match('./data.json').then(function(hit) {
          return hit ? null : c.add('./data.json'); // 최초 설치 때만 가격표 저장
        });
      })
    ]).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) {
        return k !== APP_CACHE && k !== DATA_CACHE && k !== FONT_CACHE;
      }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GAS·CDN·폰트는 건드리지 않음
  if (url.pathname.indexOf('/pwa/') !== 0) return;

  var name = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);

  if (url.pathname.indexOf('/pwa/fonts/') === 0 && name.slice(-6) === '.woff2') {
    // 폰트 파일: 저장본 우선, 없으면 받아서 저장
    e.respondWith(caches.open(FONT_CACHE).then(function(c) {
      return c.match(req).then(function(hit) {
        return hit || fetch(req).then(function(res) {
          if (res.ok) c.put(req, res.clone());
          return res;
        });
      });
    }));
    return;
  }

  if (name === 'version.json') return; // 네트워크 그대로 (실패하면 페이지가 알아서 무시)

  if (name === 'data.json') {
    e.respondWith(
      caches.open(DATA_CACHE).then(function(c) {
        if (url.searchParams.has('fresh')) {
          // 사용자가 업데이트를 눌렀을 때: 네트워크에서 받아 저장본 교체
          return fetch(new Request('./data.json', { cache: 'reload' })).then(function(res) {
            if (res.ok) c.put('./data.json', res.clone());
            return res;
          });
        }
        return c.match('./data.json').then(function(hit) {
          return hit || fetch(req).then(function(res) {
            if (res.ok) c.put('./data.json', res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // 화면 파일: 네트워크 우선 → 실패하면 저장본
  e.respondWith(
    fetch(req).then(function(res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open(APP_CACHE).then(function(c) { c.put(req, copy); });
      }
      return res;
    }).catch(function() {
      return caches.match(req, { ignoreSearch: true }).then(function(hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});

// 페이지가 "warm-fonts" 메시지를 보내면 fonts.css에 적힌 모든 폰트 파일을 백그라운드로 저장(이미 있는 건 건너뜀)
self.addEventListener('message', function(e) {
  if (e.data !== 'warm-fonts') return;
  e.waitUntil(
    Promise.all([caches.open(FONT_CACHE), fetch('./fonts/fonts.css')]).then(function(arr) {
      var c = arr[0];
      return arr[1].text().then(function(css) {
        var files = [], m, re = /url\(([^)]+\.woff2)\)/g;
        while ((m = re.exec(css))) if (files.indexOf(m[1]) < 0) files.push(m[1]);
        var i = 0;
        function worker() {
          if (i >= files.length) return Promise.resolve();
          var f = './fonts/' + files[i++];
          return c.match(f).then(function(hit) {
            return hit || fetch(f).then(function(res) { if (res.ok) return c.put(f, res); });
          }).catch(function() {}).then(worker);
        }
        return Promise.all([worker(), worker(), worker(), worker()]);
      });
    }).catch(function() {})
  );
});
