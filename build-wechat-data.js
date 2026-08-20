// 从 pricetag/data 生成微信小程序用的紧凑数据包
// 用法: node build-wechat-data.js
// 输出: ../pricetagwechat/data/prices.js
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const OUT_DIR = path.join(__dirname, '../pricetagwechat/data');
const OUT_FILE = path.join(OUT_DIR, 'prices.js');

const stations = JSON.parse(fs.readFileSync(path.join(DATA, 'stations.json'), 'utf8'));
const fares = JSON.parse(fs.readFileSync(path.join(DATA, 'fares.json'), 'utf8'));
const dists = JSON.parse(fs.readFileSync(path.join(DATA, 'distances.json'), 'utf8')).distances;

const LINE_ORDER = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','41','51'];
const LINE_NAMES = {
  '01':'1号线','02':'2号线','03':'3号线','04':'4号线','05':'5号线','06':'6号线',
  '07':'7号线','08':'8号线','09':'9号线','10':'10号线','11':'11号线','12':'12号线',
  '13':'13号线','14':'14号线','15':'15号线','16':'16号线','17':'17号线','18':'18号线',
  '41':'浦江线','51':'市域机场线'
};

function lineOrder(code) {
  const p = code.substring(0, 2);
  const idx = LINE_ORDER.indexOf(p);
  return idx === -1 ? 99 : idx;
}

const ordered = stations
  .slice()
  .sort((a, b) => lineOrder(a.code) - lineOrder(b.code) || a.code.localeCompare(b.code));

const codeIndex = {};
const STATIONS = ordered.map((s, i) => {
  const p = s.code.substring(0, 2);
  codeIndex[s.code] = i;
  return { code: s.code, name: s.name, line: LINE_NAMES[p] || ('线路' + p), lineCode: p };
});

const n = STATIONS.length;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function encChar(v) { return ALPHABET[Math.max(0, Math.min(35, Math.round(v)))]; }

// 扁平字符串: 索引 = o*n + d, 值为 base36 单字符
const CURRENT = new Array(n * n).fill('0');
const FAST = new Array(n * n).fill('0');
const DIST = new Array(n * n).fill('00');

let dual = 0, missingDist = 0;
for (const [key, entry] of Object.entries(fares)) {
  const [a, b] = key.split(':');
  const o = codeIndex[a], d = codeIndex[b];
  if (o === undefined || d === undefined) continue;
  const normal = parseInt(entry.price, 10);
  const fast = entry.fast ? parseInt(entry.fast, 10) : 0;
  CURRENT[o * n + d] = encChar(normal);
  CURRENT[d * n + o] = encChar(normal);
  if (fast && fast > 0 && fast !== normal) {
    FAST[o * n + d] = encChar(fast);
    FAST[d * n + o] = encChar(fast);
    dual++;
  }
}

for (const [key, value] of Object.entries(dists)) {
  const [a, b] = key.split(':');
  const o = codeIndex[a], d = codeIndex[b];
  if (o === undefined || d === undefined) continue;
  const v = Math.round(Number(value) * 2); // 保留 0.5km 精度
  const enc = encChar(Math.floor(v / 36)) + encChar(v % 36);
  DIST[o * n + d] = enc;
  DIST[d * n + o] = enc;
}

for (let i = 0; i < n; i++) {
  CURRENT[i * n + i] = '0';
  DIST[i * n + i] = '00';
}

// 校验: fares.json 必须覆盖所有站点对(0 价=同站换乘代码对, 属正常)
const fareKeys = new Set(Object.keys(fares));
const missing = [];
for (let o = 0; o < n; o++) {
  for (let d = o + 1; d < n; d++) {
    const key = [STATIONS[o].code, STATIONS[d].code].sort().join(':');
    if (!fareKeys.has(key)) missing.push(key);
  }
}
if (missing.length) {
  console.error(`fares.json 缺失票价 ${missing.length} 对, 示例: ${missing.slice(0, 5).join(', ')}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = `// 由 build-wechat-data.js 生成, 请勿手改
// 站点 530 个, 票价/距离为按站点索引的扁平 base36 字符串
var STATIONS = ${JSON.stringify(STATIONS)};
var CURRENT = "${CURRENT.join('')}";
var FAST = "${FAST.join('')}";
var DIST = "${DIST.join('')}";
var N = ${n};
var LINE_LIST = ${JSON.stringify(LINE_ORDER.map(p => ({ code: p, name: LINE_NAMES[p] || ('线路' + p) })))};
var LINE_STATIONS = {};
var c2v = function (ch) { var v = ch.charCodeAt(0); return v <= 57 ? v - 48 : v - 87; };
var idx = function (o, d) { return o * N + d; };
function priceAt(str, o, d) { return c2v(str[idx(o, d)]); }
function distAt(o, d) { var i = idx(o, d) * 2; return (c2v(DIST[i]) * 36 + c2v(DIST[i + 1])) / 2; }
for (var i = 0; i < N; i++) {
  var p = STATIONS[i].lineCode;
  (LINE_STATIONS[p] = LINE_STATIONS[p] || []).push(i);
}
module.exports = {
  N: N,
  stations: STATIONS,
  lineList: LINE_LIST,
  lineStations: LINE_STATIONS,
  priceCurrent: function (o, d) { return priceAt(CURRENT, o, d); },
  priceFast: function (o, d) { return priceAt(FAST, o, d); },
  dist: distAt
};
`;

fs.writeFileSync(OUT_FILE, out, 'utf8');
const size = fs.statSync(OUT_FILE).size;
console.log(`已生成 ${OUT_FILE}`);
console.log(`站点数: ${n}`);
console.log(`双价对: ${dual}`);
console.log(`缺失票价: ${missing.length}`);
console.log(`数据文件大小: ${(size / 1024 / 1024).toFixed(2)} MB`);