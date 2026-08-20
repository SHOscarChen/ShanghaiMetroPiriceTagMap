// 批量导出每个站点的三合一 PNG：
// 用系统 Edge 无头模式打开本项目自带的 png-export.html，把 canvas 结果截图保存。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) { console.error('未找到 Edge'); process.exit(1); }

const OUT_DIR = path.join(ROOT, '涨价方案对比');
const LINE_NAME = { '01':'1号线','02':'2号线','03':'3号线','04':'4号线','05':'5号线','06':'6号线','07':'7号线','08':'8号线','09':'9号线','10':'10号线','11':'11号线','12':'12号线','13':'13号线','14':'14号线','15':'15号线','16':'16号线','17':'17号线','18':'18号线','41':'浦江线','51':'市域机场线' };

const coords = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/stations-coords.json'), 'utf8'));
// 每个线路代码（含换乘站各线的代码、hidden 同站代码）都生成一张，51 机场线除外。
const jobs = coords
  .filter((s) => !s.code.startsWith('51'))
  .map((s) => {
    const line = LINE_NAME[s.code.substring(0, 2)];
    return { code: s.code, name: s.name, line, target: path.join(OUT_DIR, line, `${s.name}_三合一.png`) };
  });

const EDGE_TMP = 'C:\\Users\\OSCARC~1\\AppData\\Local\\Temp\\opencode\\edge-batch';
fs.mkdirSync(EDGE_TMP, { recursive: true });

function shot(job) {
  return new Promise((resolve) => {
    const tmp = path.join(EDGE_TMP, `${job.code}.png`);
    const args = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      `--user-data-dir=${path.join(EDGE_TMP, job.code)}`,
      `--screenshot=${tmp}`, '--window-size=5277,7385', '--virtual-time-budget=12000',
      `http://127.0.0.1:3000/png-export.html?station=${job.code}`,
    ];
    const proc = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
    const to = setTimeout(() => { try { proc.kill(); } catch {} }, 60000);
    proc.on('exit', () => {
      clearTimeout(to);
      let ok = false;
      try { ok = fs.statSync(tmp).size > 100000; } catch {}
      resolve(ok);
    });
  });
}

async function main() {
  const pending = jobs.filter((j) => !(fs.existsSync(j.target) && fs.statSync(j.target).size > 100000));
  console.log(`共 ${jobs.length} 站，待生成 ${pending.length} 张`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const CONC = 3;
  let idx = 0, okCount = 0, fail = [];
  const workers = [];
  for (let w = 0; w < CONC; w++) {
    workers.push((async () => {
      while (idx < pending.length) {
        const job = pending[idx++];
        fs.mkdirSync(path.dirname(job.target), { recursive: true });
        let ok = await shot(job);
        if (!ok) ok = await shot(job); // 重试一次
        if (ok) {
          fs.copyFileSync(path.join(EDGE_TMP, `${job.code}.png`), job.target);
          okCount++;
          console.log(`[${okCount}/${pending.length}] ${job.line} ${job.name}`);
        } else {
          fail.push(job.code + ' ' + job.name);
          console.log(`[FAIL] ${job.line} ${job.name}`);
        }
      }
    })());
  }
  await Promise.all(workers);
  console.log(`\n完成：成功 ${okCount} / ${pending.length}`);
  if (fail.length) console.log('失败：', fail.join(', '));
  // 清理临时文件
  try { fs.rmSync(EDGE_TMP, { recursive: true, force: true }); } catch {}
}

main();