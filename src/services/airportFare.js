// 市域机场线相关站对的方案一/方案二计价。
//
// 背景：机场线是独立计价的市域线（费率机制），不随地铁听证方案一/方案二调整。
// 对涉及机场线站点的站对（一端为 51xx，另一端为普通地铁站），
// 正确的方案一/方案二票价应拆成两段累加：
//   · 地铁段：普通地铁站 → 机场线换乘站（按该方案的地铁里程阶梯计价）
//   · 机场线段：换乘站（机场线）→ 目的机场线站（取 fares.json 官方段价，不随方案变）
// 最终取「经中春路」与「经景洪路」两条换乘路径中总价较低者。
// 两端都是机场线站或两端都是普通地铁站时返回 null（交由调用方走各自原逻辑）。

const fs = require('fs');
const path = require('path');
const { priceOf } = require('./fareCalc');

const FARE_PATH = path.join(__dirname, '../../data/fares.json');

// 机场线换乘站：{ 普通地铁站码, 机场线站码, 换乘站名 }
const AIRPORT_TRANSFERS = [
  { metro: '0927', airport: '5132' }, // 中春路
  { metro: '1528', airport: '5133' }, // 景洪路
];

// 机场线站点集合（市域机场线 51xx）
const AIRPORT_CODES = new Set(['5131', '5132', '5133', '5134', '5135', '5136', '5137']);

let fares = null;
function getFares() {
  if (!fares) fares = JSON.parse(fs.readFileSync(FARE_PATH, 'utf8'));
  return fares;
}
// 官方段价取值（兼容 { price } / { price, fast } / 字符串）
function officialOf(v) {
  if (v == null) return null;
  if (typeof v === 'object') return Number(v.price != null ? v.price : v.normal);
  return Number(v);
}
// 市域机场线新票价取「快线价」：有 fast 用 fast，否则用普通价。
// 依据 2026-11 H5 全量核验的 25 条机场线边界样本（含纯机场线段与同站换乘）。
function fastOf(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.fast != null) return Number(v.fast);
  return officialOf(v);
}

// 计算涉及机场线的站对 (o, d) 在指定 scheme 下的票价；若不适用返回 null。
// distances: distances.json 的 { '甲:乙': km }（排序 key）
function computeAirportScheme(o, d, scheme, distances) {
  const inAir = (c) => AIRPORT_CODES.has(c);
  const oAir = inAir(o), dAir = inAir(d);

  // 两端均为机场线站：直接取机场线段官方价（新票价用 fast 价）
  if (oAir && dAir) {
    const v = getFares()[[o, d].sort().join(':')];
    return scheme === 'new' ? fastOf(v) : officialOf(v);
  }
  // 仅处理「一端机场线、一端普通地铁」的站对
  if (oAir === dAir) return null;

  const metroSide = oAir ? d : o; // 普通地铁站
  const airSide = oAir ? o : d;   // 机场线站

  const fareMap = getFares();
  let best = Infinity;
  for (const t of AIRPORT_TRANSFERS) {
    // 地铁段：普通地铁站 → 换乘站(地铁码) 的距离
    const metroKey = [metroSide, t.metro].sort().join(':');
    const metroDist = metroSide === t.metro ? 0 : (distances ? distances[metroKey] : null);
    if (metroDist == null) continue;
    // 同站换乘不另收地铁起步价（仅新票价规则；旧存档保持原逻辑）
    const metroPrice = metroDist === 0 && scheme === 'new' ? 0 : priceOf(metroDist, scheme);

    // 机场线段：换乘站(机场线码) → 目的机场线站 的官方段价
    // 目的站本身即该换乘站时，机场线段为 0
    const jcPrice = airSide === t.airport
      ? 0
      : (scheme === 'new'
        ? fastOf(fareMap[[t.airport, airSide].sort().join(':')])
        : officialOf(fareMap[[t.airport, airSide].sort().join(':')]));
    if (jcPrice == null) continue;

    const total = metroPrice + jcPrice;
    if (total < best) best = total;
  }
  return best === Infinity ? null : best;
}

module.exports = { computeAirportScheme, AIRPORT_CODES, AIRPORT_TRANSFERS, officialOf, fastOf };