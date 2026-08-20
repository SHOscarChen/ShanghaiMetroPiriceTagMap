// 按线路走向顺序，把每站三合一 PNG 合成一个 PDF（一张图一页）。
// 顺序来源：data/latlng_dist.json 各线的车站序列。机场联络线(51)不参与。
// 用法：node scripts/build-line-pdfs.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '涨价方案对比');
const TMP_DIR = 'C:\\Users\\OSCARC~1\\AppData\\Local\\Temp\\opencode\\pdf-batch';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('未找到 Edge'); process.exit(1); }

const PG = { w: 5277, h: 7385 };
const LINE_NAME = { '01':'1号线','02':'2号线','03':'3号线','04':'4号线','05':'5号线','06':'6号线','07':'7号线','08':'8号线','09':'9号线','10':'10号线','11':'11号线','12':'12号线','13':'13号线','14':'14号线','15':'15号线','16':'16号线','17':'17号线','18':'18号线','41':'浦江线','51':'市域机场线' };

const coords = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/stations-coords.json'), 'utf8'));
const nameByCode = new Map(coords.map((s) => [s.code, s.name]));
const grid = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/latlng_dist.json'), 'utf8'));

fs.mkdirSync(TMP_DIR, { recursive: true });

function fileUrl(abspath) {
  const segs = abspath.replace(/\\/g, '/').split('/');
  return 'file:///' + segs.map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
}

function buildHtml(stations, lineName) {
  const pages = [];
  for (const st of stations) {
    const name = nameByCode.get(st.code);
    const png = path.join(OUT_DIR, lineName, `${name}_三合一.png`);
    if (!fs.existsSync(png)) { console.warn(`  [跳过缺失] ${lineName} ${st.code} ${name}`); continue; }
    pages.push(`<div class="pg"><img src="${fileUrl(png)}"/></div>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:${PG.w}px ${PG.h}px;margin:0;}
html,body{margin:0;padding:0;}
.pg{width:${PG.w}px;height:${PG.h}px;break-after:page;overflow:hidden;}
.pg:last-child{break-after:auto;}
img{width:${PG.w}px;height:${PG.h}px;display:block;}
</style></head><body>${pages.join('\n')}</body></html>`;
}

function printPdf(htmlFile, outPdf) {
  return new Promise((resolve) => {
    const args = [
      '--headless=new', '--disable-gpu',
      `--user-data-dir=${TMP_DIR}\\prof${Date.now()}`,
      `--print-to-pdf=${outPdf}`, '--no-pdf-header-footer',
      '--virtual-time-budget=20000', fileUrl(htmlFile),
    ];
    const proc = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
    const to = setTimeout(() => { try { proc.kill(); } catch {} }, 120000);
    proc.on('exit', () => { clearTimeout(to); resolve(fs.existsSync(outPdf) && fs.statSync(outPdf).size > 100000); });
  });
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) { console.error('先运行 scripts/export-combo-png.js 生成 PNG'); process.exit(1); }
  for (const g of grid) {
    const code = String(g.line).padStart(2, '0');
    if (code === '51') continue;
    const lineName = LINE_NAME[code];
    if (!lineName || !fs.existsSync(path.join(OUT_DIR, lineName))) { console.warn('跳过线路:', code); continue; }
    const html = buildHtml(g.stations, lineName);
    const htmlFile = path.join(TMP_DIR, `line-${code}.html`);
    const outPdf = path.join(OUT_DIR, `${lineName}.pdf`);
    fs.writeFileSync(htmlFile, html, 'utf8');
    const ok = await printPdf(htmlFile, outPdf);
    const size = ok ? Math.round(fs.statSync(outPdf).size / 1024 / 1024) : 0;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${lineName}  页数=${g.stations.length}  PDF=${size}MB`);
  }
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
}

main();