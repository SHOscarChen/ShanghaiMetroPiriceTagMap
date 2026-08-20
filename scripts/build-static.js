// 预生成 GitHub Pages 静态部署所需的全部数据文件：
//   public/data/stations.json              起始站列表（原 /api/stations）
//   public/data/prices/{origin}.json       每站三套票价（原 /api/prices/:origin）
//   public/data/schemes.json               方案名称/标签元数据
// 生成后整个 public/ 目录即为纯静态站点，可直接托管到 GitHub Pages。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/data');

const { getStations } = require(path.join(ROOT, 'src/services/stationData'));
const { getDistances } = require(path.join(ROOT, 'src/services/distances'));
const { priceOf, SCHEME_LABELS } = require(path.join(ROOT, 'src/services/fareCalc'));
const { getAllPrices, SHJIAO_CODES } = require(path.join(ROOT, 'src/services/metroApi'));
const { computeAirportScheme } = require(path.join(ROOT, 'src/services/airportFare'));

const stations = getStations();
const distances = getDistances();

// 与 src/routes/api.js 保持一致的方案计算
function calcSchemes(origin, prices) {
  const cur = {}, s1 = {}, s2 = {};
  for (const [code, v] of Object.entries(prices)) {
    cur[code] = typeof v === 'object' ? Number(v.normal) : Number(v);
    if (v === null) { s1[code] = null; s2[code] = null; continue; }
    const key = [origin, code].sort().join(':');
    if (SHJIAO_CODES.has(origin) || SHJIAO_CODES.has(code)) {
      // 地铁段(方案阶梯) + 机场线段(官方段价) 累加；两端均为机场线站时走官方段价
      const officialPrice = typeof v === 'object' ? Number(v.normal) : Number(v);
      const a1 = computeAirportScheme(origin, code, 'scheme1', distances);
      const a2 = computeAirportScheme(origin, code, 'scheme2', distances);
      s1[code] = a1 != null ? a1 : officialPrice;
      s2[code] = a2 != null ? a2 : officialPrice;
    } else if (distances[key] != null) {
      s1[code] = priceOf(distances[key], 'scheme1');
      s2[code] = priceOf(distances[key], 'scheme2');
    } else {
      const p = typeof v === 'object' ? Number(v.normal) : Number(v);
      s1[code] = priceOf(p, 'current');
      s2[code] = priceOf(p, 'current');
    }
  }
  return { current: cur, scheme1: s1, scheme2: s2 };
}

async function buildOne(origin) {
  const prices = await getAllPrices(origin); // 复用 API 的取价/双价/兜底逻辑
  const schemes = calcSchemes(origin, prices);
  return { origin, originName: stations.find((s) => s.code === origin)?.name || origin, prices, schemes, schemesLabel: SCHEME_LABELS };
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'prices'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'stations.json'), JSON.stringify(stations), 'utf8');
  fs.writeFileSync(path.join(OUT, 'schemes.json'), JSON.stringify(SCHEME_LABELS), 'utf8');

  let n = 0, bytes = 0;
  for (const s of stations) {
    const obj = await buildOne(s.code);
    const file = path.join(OUT, 'prices', `${s.code}.json`);
    const data = JSON.stringify(obj);
    fs.writeFileSync(file, data, 'utf8');
    n++;
    bytes += data.length;
    if (n % 50 === 0) console.log(`... ${n}/530`);
  }
  console.log(`生成完成: ${n} 个起始站文件 (${(bytes / 1024 / 1024).toFixed(1)} MB) → public/data/`);
  console.log('stations.json / schemes.json 已写入');
}

main().catch((e) => { console.error(e); process.exit(1); });