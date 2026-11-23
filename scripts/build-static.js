// 预生成 GitHub Pages 静态部署所需的全部数据文件。
//
// 新站（public/data/）：
//   stations.json            起始站列表
//   prices/{origin}.json     该站到全网的「现行价 / 新票价」两套票价
//   meta.json                执行日期、文号、数据来源、存档入口
//
// 旧版存档（public/archive/2025-fare/）：
//   复制 archive/2025-fare/ 的页面与静态资源，并按旧版前端格式生成
//   data/stations.json、data/schemes.json、data/prices/{origin}.json
//
// 旧价使用 data/fares.json 的官方快照（2026-11 之前抓取），
// 新价使用原始最短路径里程 + 沪发改价调〔2026〕58号 阶梯，
// 整个构建过程不依赖线上接口，可在 2026-12-01 之后重复生成。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/data');
const ARCHIVE_SRC = path.join(ROOT, 'archive/2025-fare');
const ARCHIVE_OUT = path.join(ROOT, 'public/archive/2025-fare');

const { getStations } = require(path.join(ROOT, 'src/services/stationData'));
const { getDistances, getRawDistances } = require(path.join(ROOT, 'src/services/distances'));
const { priceOf, SCHEME_LABELS } = require(path.join(ROOT, 'src/services/fareCalc'));
const { computeAirportScheme, AIRPORT_CODES } = require(path.join(ROOT, 'src/services/airportFare'));

const FARES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fares.json'), 'utf8'));
const stations = getStations();
const stationName = Object.fromEntries(stations.map((s) => [s.code, s.name]));
const distancesOld = getDistances();
const distancesRaw = getRawDistances();

const META = {
  effectiveDate: '2026-12-01',
  publishedDate: '2026-11-23',
  docNo: '沪发改价调〔2026〕58号',
  sourceUrl: 'https://fgw.sh.gov.cn/fgw_jjjctk/20261123/f57b63885c514c829ee269ed589ab2b9.html',
  archiveUrl: 'archive/2025-fare/',
  oldLabel: '现行票价（至2026-11-30）',
  newLabel: '新票价（2026-12-01起）',
};

const keyOf = (a, b) => [a, b].sort().join(':');

// 官方快照里的票价：普通价（obj.price / 字符串 / 数字）
function officialOf(v) {
  if (v == null) return null;
  if (typeof v === 'object') return Number(v.price != null ? v.price : v.normal);
  return Number(v);
}

// 旧版前端需要的 prices 字段：单价为字符串，双价为 { normal, fast }
function legacyPriceOf(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    const normal = String(v.price != null ? v.price : v.normal);
    return { normal, fast: v.fast != null ? String(v.fast) : null };
  }
  return String(v);
}

function newPriceOf(origin, dest, oldPrice) {
  if (AIRPORT_CODES.has(origin) || AIRPORT_CODES.has(dest)) {
    const ap = computeAirportScheme(origin, dest, 'new', distancesRaw);
    return ap != null ? ap : oldPrice;
  }
  const km = distancesRaw[keyOf(origin, dest)];
  return km != null ? priceOf(km, 'new') : oldPrice;
}

function archiveSchemePrice(origin, dest, official, scheme) {
  if (official === null) return null;
  if (AIRPORT_CODES.has(origin) || AIRPORT_CODES.has(dest)) {
    const ap = computeAirportScheme(origin, dest, scheme, distancesOld);
    return ap != null ? ap : official;
  }
  const km = distancesOld[keyOf(origin, dest)];
  return km != null ? priceOf(km, scheme) : priceOf(official, 'current');
}

function buildNewPair(origin) {
  const old = {}, next = {};
  for (const s of stations) {
    const code = s.code;
    if (code === origin) { old[code] = 0; next[code] = 0; continue; }
    const f = FARES[keyOf(origin, code)];
    const official = officialOf(f);
    old[code] = official != null ? official : null;
    next[code] = official != null ? newPriceOf(origin, code, official) : null;
  }
  return { origin, originName: stationName[origin] || origin, old, new: next };
}

function buildArchivePair(origin) {
  const prices = {}, current = {}, scheme1 = {}, scheme2 = {};
  for (const s of stations) {
    const code = s.code;
    if (code === origin) { prices[code] = '0'; current[code] = 0; scheme1[code] = 0; scheme2[code] = 0; continue; }
    const f = FARES[keyOf(origin, code)];
    const official = officialOf(f);
    prices[code] = legacyPriceOf(f);
    current[code] = official;
    scheme1[code] = archiveSchemePrice(origin, code, official, 'scheme1');
    scheme2[code] = archiveSchemePrice(origin, code, official, 'scheme2');
  }
  return {
    origin,
    originName: stationName[origin] || origin,
    prices,
    schemes: { current, scheme1, scheme2 },
    schemesLabel: { current: '现行票价', scheme1: '方案一', scheme2: '方案二' },
  };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'data') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'prices'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'stations.json'), JSON.stringify(stations), 'utf8');
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(META), 'utf8');

  copyDir(ARCHIVE_SRC, ARCHIVE_OUT);
  const archiveData = path.join(ARCHIVE_OUT, 'data');
  fs.mkdirSync(path.join(archiveData, 'prices'), { recursive: true });
  fs.writeFileSync(path.join(archiveData, 'stations.json'), JSON.stringify(stations), 'utf8');
  fs.writeFileSync(
    path.join(archiveData, 'schemes.json'),
    JSON.stringify({ current: '现行票价', scheme1: '方案一', scheme2: '方案二' }),
    'utf8'
  );

  let n = 0;
  for (const s of stations) {
    const newData = buildNewPair(s.code);
    const archiveDataObj = buildArchivePair(s.code);
    fs.writeFileSync(path.join(OUT, 'prices', `${s.code}.json`), JSON.stringify(newData), 'utf8');
    fs.writeFileSync(path.join(archiveData, 'prices', `${s.code}.json`), JSON.stringify(archiveDataObj), 'utf8');
    n++;
    if (n % 50 === 0) console.log(`... ${n}/${stations.length}`);
  }

  console.log(`生成完成: ${n} 个起始站文件 → public/data/ 与 public/archive/2025-fare/data/`);
  console.log(`旧价快照: data/fares.json (${Object.keys(FARES).length} 对)；新票价自 ${META.effectiveDate} 起执行`);
}

main().catch((e) => { console.error(e); process.exit(1); });
