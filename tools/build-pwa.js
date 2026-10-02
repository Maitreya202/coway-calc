// PWA 테스트 빌드: node tools/build-pwa.js
// 1) 구글 getData 응답을 pwa/data.json(+ pwa/version.json)로 저장 — 내용이 안 바뀌면 기준 시각 유지
// 2) index.html을 읽어 데이터 로딩부만 바꾼 pwa/index.html 생성 (index.html 수정 시 다시 실행하면 드리프트 없음)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const GAS_URL = 'https://script.google.com/macros/s/AKfycbw_06KQ9F7v2qibjtlrm6s2qfysb0FSaCEVnijccb3-ANZu7ahER0W245c9lYoZ2UMMSA/exec';

async function fetchGas() {
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(GAS_URL + '?action=getData&_ts=' + Date.now(), { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.products || j.products.length < 100) throw new Error('products 비정상: ' + (j.products && j.products.length));
      return j;
    } catch (e) { console.log('getData 시도 ' + i + ' 실패: ' + e.message); }
  }
  throw new Error('getData 실패');
}

(async () => {
  const resp = await fetchGas();
  const version = crypto.createHash('sha1').update(JSON.stringify(resp)).digest('hex').slice(0, 12);
  const dataPath = path.join(ROOT, 'pwa', 'data.json');
  let updatedAt = new Date().toISOString();
  try {
    const old = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    if (old._meta && old._meta.version === version) updatedAt = old._meta.updatedAt;
  } catch (e) {}
  const meta = { version, updatedAt };
  fs.writeFileSync(dataPath, JSON.stringify(Object.assign({}, resp, { _meta: meta })));
  fs.writeFileSync(path.join(ROOT, 'pwa', 'version.json'), JSON.stringify(meta));
  console.log('data.json', version, updatedAt, 'products', resp.products.length);

  let s = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const rep = (a, b) => { if (s.split(a).length !== 2) throw new Error('패치 위치를 못 찾음: ' + a.slice(0, 60)); s = s.replace(a, () => b); };

  // 1) 로딩: 저장된 data.json 우선, 실패하면 기존 구글 방식으로 폴백
  rep("  fetch(GAS_URL + '?action=getData&_ts=' + Date.now(), {method:'GET', mode:'cors', redirect:'follow', cache:'no-store', signal:_ctl?_ctl.signal:undefined})",
      "  pwaFetchData('./data.json', _ctl)");
  rep("      var rows = resp.products || resp; // 하위 호환: 구 버전은 배열 직접",
      "      window.__dataMeta = resp._meta || null;\n      var rows = resp.products || resp; // 하위 호환: 구 버전은 배열 직접");
  rep("      document.getElementById('noDataMsg').style.display = (PRODUCTS.length===0) ? 'block' : 'none';\n    })",
      "      document.getElementById('noDataMsg').style.display = (PRODUCTS.length===0) ? 'block' : 'none';\n      pwaAfterLoad();\n    })");

  // 2) "데이터 업데이트" 버튼/배너: 구글 대신 새 data.json을 받아 저장본 교체
  rep("  fetch(GAS_URL+'?action=clearCache')\n    .then(function(){ return fetch(GAS_URL+'?action=getData&_ts='+Date.now(),{method:'GET',mode:'cors',redirect:'follow',cache:'no-store'}); })\n    .then(function(r){ return r.json(); })\n    .then(function(resp){\n      var rows=resp.products||resp;",
      "  pwaFetchData('./data.json?fresh='+Date.now(), null)\n    .then(function(r){ return r.json(); })\n    .then(function(resp){\n      window.__dataMeta=resp._meta||null;\n      var rows=resp.products||resp;");
  rep("      document.getElementById('app').style.display='block';\n      renderCart();\n    })\n    .catch(function(e){\n      document.getElementById('loadingScreen').style.display='none';",
      "      document.getElementById('app').style.display='block';\n      if(cond.cards) CARDS=cond.cards;\n      renderCart();\n      pwaAfterLoad();\n    })\n    .catch(function(e){\n      document.getElementById('loadingScreen').style.display='none';");

  // 3) <head>: manifest / 아이콘
  rep('<meta name="theme-color" content="#1d4ed8">',
      '<meta name="theme-color" content="#1d4ed8">\n<link rel="manifest" href="manifest.webmanifest" crossorigin="use-credentials">\n<link rel="apple-touch-icon" href="icon-192.png">');

  // 4) PWA 보조 스크립트 (맨 마지막 script 앞 — loadAppData() 호출 전에 정의돼야 하므로 첫 <script> 앞에 삽입)
  const pwaJs = fs.readFileSync(path.join(__dirname, 'pwa-snippet.html'), 'utf8');
  const firstScript = s.indexOf('<script>');
  if (firstScript < 0) throw new Error('script 태그 없음');
  s = s.slice(0, firstScript) + pwaJs + '\n' + s.slice(firstScript);

  fs.writeFileSync(path.join(ROOT, 'pwa', 'index.html'), s);
  console.log('pwa/index.html 생성', s.length, 'bytes');
})().catch(e => { console.error(e); process.exit(1); });
