// PWA 오프라인 견적서(이미지/PDF)용 외부 리소스를 pwa/ 아래로 내려받아 자체 호스팅 (한 번만 실행하면 됨, 버전 올릴 때만 재실행)
// - html2canvas, jsPDF → pwa/lib/
// - Noto Sans KR + Song Myung 웹폰트 → pwa/fonts/ (+ 로컬 경로로 바꾼 fonts.css)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const OUT = path.join(__dirname, '..', 'pwa');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const get = async (u, opt) => { const r = await fetch(u, opt); if (!r.ok) throw new Error(u + ' ' + r.status); return Buffer.from(await r.arrayBuffer()); };

(async () => {
  fs.mkdirSync(path.join(OUT, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  const libs = {
    'html2canvas.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'jspdf.umd.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  };
  for (const [n, u] of Object.entries(libs)) { const b = await get(u); fs.writeFileSync(path.join(OUT, 'lib', n), b); console.log('lib', n, b.length); }

  // index.html의 ensureAssetsLoaded()와 동일한 폰트 요청
  const cssUrl = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Song+Myung&display=swap';
  let css = (await get(cssUrl, { headers: { 'User-Agent': UA } })).toString('utf8');
  const urls = [...new Set([...css.matchAll(/url\(([^)]*)\)/g)].map(m => m[1]))];
  console.log('font files', urls.length);
  const map = {};
  let done = 0, total = 0;
  const queue = urls.slice();
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const u = queue.shift();
      const name = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12) + '.woff2';
      const f = path.join(OUT, 'fonts', name);
      if (!fs.existsSync(f)) fs.writeFileSync(f, await get(u));
      total += fs.statSync(f).size; map[u] = name; done++;
    }
  }));
  for (const u of urls) css = css.split(u).join(map[u]);
  fs.writeFileSync(path.join(OUT, 'fonts', 'fonts.css'), css);
  console.log('fonts done', done, 'MB', (total / 1048576).toFixed(2));
})().catch(e => { console.error(e); process.exit(1); });
