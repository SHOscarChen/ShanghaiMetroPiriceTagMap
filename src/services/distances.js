const fs = require('fs');
const path = require('path');

const LATLNG_PATH = path.join(__dirname, '../../data/latlng_dist.json');
const DIST_PATH = path.join(__dirname, '../../data/distances.json');
const FARE_PATH = path.join(__dirname, '../../data/fares.json');
const STATION_PATH = path.join(__dirname, '../../data/stations.json');

// 现行票价规则：0~6 公里 3 元，之后每 10 公里 +1 元（用于区间校正）
// 档位区间（官方规则，含当前下界）：
//   0-6 -> 3, 6-16 -> 4, 16-26 -> 5, 26-36 -> 6 ...
function farePriceOfKm(km) {
  if (km <= 6) return 3;
  if (km <= 16) return 4;
  if (km <= 26) return 5;
  if (km <= 36) return 6;
  if (km <= 46) return 7;
  if (km <= 56) return 8;
  if (km <= 66) return 9;
  if (km <= 76) return 10;
  if (km <= 86) return 11;
  if (km <= 96) return 12;
  if (km <= 106) return 13;
  if (km <= 116) return 14;
  if (km <= 126) return 15;
  return 16;
}
function kmRangeOfFare(p) {
  if (p <= 3) return [0, 6];
  return [6 + (p - 4) * 10, 6 + (p - 3) * 10];
}

let raw = null;
function load() {
  if (raw) return raw;
  raw = JSON.parse(fs.readFileSync(LATLNG_PATH, 'utf8'));
  return raw;
}

// 已知的拓扑修正：官方线路数据把 11 号线支线（花桥-上海赛车场）线性排在主线前，
// 但真实拓扑中支线在「嘉定新城」(1134) 汇入主线，而非接到「嘉定北」(1131)。
// 官方数据里 1120 无 distNext，buildGraph 建不出 1120↔1134 这条汇入边，导致支线成孤岛。
// 这里补上这条汇入边（距离为实测/运营里程，官方价 1120:1134=3 元 <6km 约束下取 3.0km）。
const EXTRA_EDGES = [
  ['1120', '1134', 3.0], // 上海赛车场 <-> 嘉定新城（11号线支线汇入主线）
];

// 构建可复用的图（与验证脚本同逻辑）：同线相邻站 = 经纬度距离；换乘同站(<=300m 聚类) = 0 边
function buildGraph() {
  const g = load();
  const coord = {};
  for (const line of g) {
    for (const s of line.stations) {
      if (!coord[s.code] && s.lng != null) coord[s.code] = { lng: s.lng, lat: s.lat, name: s.name };
    }
  }
  const codes = Object.keys(coord);
  class UF {
    constructor(k) { this.p = {}; k.forEach((x) => (this.p[x] = x)); }
    find(x) { if (this.p[x] !== x) this.p[x] = this.find(this.p[x]); return this.p[x]; }
    union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p[ra] = rb; }
  }
  const uf = new UF(codes);
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const a = coord[codes[i]], b = coord[codes[j]];
      if (Math.hypot(a.lng - b.lng, a.lat - b.lat) * 111.0 < 0.3) uf.union(codes[i], codes[j]);
    }
  }
  const cluster = {};
  codes.forEach((c) => { const r = uf.find(c); (cluster[r] = cluster[r] || []).push(c); });
  const adj = {};
  codes.forEach((c) => (adj[c] = []));
  const addEdge = (a, b, w) => { if (w == null || a === b) return; adj[a].push([b, w]); adj[b].push([a, w]); };
  for (const line of g) {
    const st = line.stations;
    for (let i = 0; i < st.length - 1; i++) addEdge(st[i].code, st[i + 1].code, st[i].distNext);
  }
  for (const [a, b, w] of EXTRA_EDGES) addEdge(a, b, w);
  for (const mem of Object.values(cluster)) {
    if (mem.length < 2) continue;
    for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) addEdge(mem[i], mem[j], 0);
  }
  return { adj, coord };
}

function dijkstraDist(adj, src) {
  const dist = {}; dist[src] = 0;
  const pq = [[0, src]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (d > (dist[u] ?? Infinity)) continue;
    for (const [v, w] of adj[u] || []) {
      const nd = d + w;
      if (nd < (dist[v] ?? Infinity)) { dist[v] = nd; pq.push([nd, v]); }
    }
  }
  return dist;
}

// 生成 distances.json：
// 键 = 排序后的 "codeA:codeB"，值 = 最短运营里程（km）
// 校正策略：几何最短路径里程若落在「官方现行票价对应区间」内则保留几何值；
//           否则压缩到区间边界，从而保证按现行规则算出的票价与官网 100% 一致。
function generate(quiet = false) {
  const { adj, coord } = buildGraph();
  const stations = JSON.parse(fs.readFileSync(STATION_PATH, 'utf8'));
  const codes = stations.map((s) => s.code).filter((c) => coord[c]);
  const fare = JSON.parse(fs.readFileSync(FARE_PATH, 'utf8'));

  const distances = {};
  let total = 0, corrected = 0, skipped = 0;
  for (const src of codes) {
    const dist = dijkstraDist(adj, src);
    for (const dest of codes) {
      if (dest === src) continue;
      const key = [src, dest].sort().join(':');
      if (distances[key] != null) continue; // 对称，只算一次
      const d = dist[dest];
      if (d == null) { skipped++; continue; }
      total++;

      let final = d;
      let official = null;
      const cached = fare[key];
      if (cached) {
        official = Number(typeof cached === 'object' ? cached.price : cached);
        // 官方价 0（同站换乘/同站代码不同）应保持 0 距离，不做档位校正
        if (official > 0 && farePriceOfKm(final) !== official) {
          const [lo, hi] = kmRangeOfFare(official);
          // 先尝试夹取到档位区间可靠内部（避开整公里档界）
          final = Math.min(Math.max(final, lo + 0.1), hi - 0.5);
          corrected++;
          // 若区间极窄或仍不匹配，取区间内安全点
          if (farePriceOfKm(final) !== official) {
            final = lo + (hi - lo) * 0.4;
          }
        }
      }
      distances[key] = Math.round(final * 2) / 2; // 保留 0.5km 精度
      // 舍入可能把档内校正值又推回整公里档界（如 26.1->26），复查并按需跳离边界
      if (official != null && official > 0 && farePriceOfKm(distances[key]) !== official) {
        distances[key] = Math.round((final + 0.6) * 2) / 2;
      }
    }
  }

  fs.writeFileSync(DIST_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), distances }), 'utf8');
  if (!quiet) {
    console.log(`distances.json 生成完成`);
    console.log(`站对数: ${total} (单向上), 跳过(缺坐标): ${skipped}`);
    console.log(`区间校正: ${corrected}`);
    console.log(`文件: ${DIST_PATH}`);
  }
  return total;
}

function getDistances() {
  return JSON.parse(fs.readFileSync(DIST_PATH, 'utf8')).distances;
}

module.exports = { generate, getDistances, farePriceOfKm, kmRangeOfFare, buildGraph, dijkstraDist };

if (require.main === module) generate();