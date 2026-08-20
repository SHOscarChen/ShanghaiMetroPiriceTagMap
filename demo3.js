const fs = require('fs');

// ===== 三方案阶梯（已用官方校验点校准）=====
const CURRENT = [
  { max: 6, price: 3 }, { max: 16, price: 4 }, { max: 26, price: 5 },
  { max: 36, price: 6 }, { max: 46, price: 7 }, { max: 56, price: 8 },
  { max: 66, price: 9 }, { max: 76, price: 10 }, { max: 86, price: 11 },
  { max: 96, price: 12 }, { max: 106, price: 13 }, { max: 116, price: 14 },
  { max: 126, price: 15 }, { max: Infinity, price: 16 },
];
const SCHEME1 = [
  { max: 4, price: 3 }, { max: 8, price: 4 }, { max: 12, price: 5 },
  { max: 16, price: 6 }, { max: 23, price: 7 }, { max: 30, price: 8 },
  { max: 37, price: 9 }, { max: 47, price: 10 }, { max: 57, price: 11 },
  { max: 67, price: 12 }, { max: 82, price: 13 }, { max: 97, price: 14 },
  { max: 112, price: 15 }, { max: 127, price: 16 }, { max: 142, price: 17 },
  { max: 157, price: 18 }, { max: Infinity, price: 19 },
];
const SCHEME2 = [
  { max: 6, price: 4 }, { max: 14, price: 5 }, { max: 22, price: 6 },
  { max: 32, price: 7 }, { max: 42, price: 8 }, { max: 54, price: 9 },
  { max: 66, price: 10 }, { max: 72, price: 11 }, { max: 86, price: 12 },
  { max: 100, price: 13 }, { max: 114, price: 14 }, { max: 128, price: 15 },
  { max: 142, price: 16 }, { max: Infinity, price: 17 },
];
function priceFor(scheme, km) { for (const b of scheme) if (km <= b.max) return b.price; }

// ===== 里程图 =====
const g = JSON.parse(fs.readFileSync('data/latlng_dist.json', 'utf8'));
const coord = {};
for (const line of g) for (const s of line.stations) if (!coord[s.code] && s.lng != null) coord[s.code] = { lng: s.lng, lat: s.lat, name: s.name };
const codes = Object.keys(coord);
class UF { constructor(k){this.p={};k.forEach(x=>this.p[x]=x);} find(x){if(this.p[x]!==x)this.p[x]=this.find(this.p[x]);return this.p[x];} union(a,b){const ra=this.find(a),rb=this.find(b);if(ra!==rb)this.p[ra]=rb;} }
const uf = new UF(codes);
for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
  const a = coord[codes[i]], b = coord[codes[j]];
  if (Math.hypot(a.lng - b.lng, a.lat - b.lat) * 111.0 < 0.3) uf.union(codes[i], codes[j]);
}
const cluster = {};
codes.forEach((c) => { const r = uf.find(c); (cluster[r] = cluster[r] || []).push(c); });
const adj = {};
codes.forEach((c) => (adj[c] = []));
const addEdge = (a, b, w) => { if (w == null || a === b) return; adj[a].push([b, w]); adj[b].push([a, w]); };
for (const line of g) { const st = line.stations; for (let i = 0; i < st.length - 1; i++) addEdge(st[i].code, st[i + 1].code, st[i].distNext); }
for (const mem of Object.values(cluster)) if (mem.length >= 2) for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) addEdge(mem[i], mem[j], 0);
function dijkstraDist(src) {
  const dist = {}; dist[src] = 0; const pq = [[0, src]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]); const [d, u] = pq.shift();
    if (d > (dist[u] ?? Infinity)) continue;
    for (const [v, w] of adj[u] || []) { const nd = d + w; if (nd < (dist[v] ?? Infinity)) { dist[v] = nd; pq.push([nd, v]); } }
  }
  return dist;
}

const _cache = {};
function minDist(acodes, bcodes) {
  const key = acodes.slice().sort().join(',') + '|' + bcodes.slice().sort().join(',');
  if (_cache[key] != null) return _cache[key];
  let best = null;
  for (const a of acodes) { const d = dijkstraDist(a); for (const b of bcodes) { const v = d[b]; if (v != null && (best == null || v < best)) best = v; } }
  _cache[key] = best; return best;
}

// 官网票价（用于对照）
const fare = JSON.parse(fs.readFileSync('data/fares.json', 'utf8'));
function officialFare(a, b) { const e = fare[[a, b].sort().join(':')]; return e ? (typeof e === 'object' ? e.price : e) : '?'; }

const origins = [
  ['人民广场', ['0123', '0245', '0835']],
  ['上海火车站', ['0126', '0323', '0410']],
  ['上海虹桥站', ['0235', '1041', '1721']],
];
const dests = [
  ['南京东路', ['0246', '1056']],
  ['徐家汇', ['0118', '0934', '1149']],
  ['中山公园', ['0241', '0318', '0405']],
  ['世纪大道', ['0249', '0417', '0632', '0942']],
  ['龙阳路', ['0252', '1621', '1832']],
  ['莘庄', ['0111', '0501']],
  ['滴水湖', ['1633']],
  ['浦东机场1号2号航站楼', ['0263', '5137']],
  ['虹桥2号航站楼', ['0236', '1042', '5131']],
];

const lines = [];
lines.push('');
lines.push('============================================================');
lines.push('  三方案票价对比示例（里程由经纬度短路径模型估算）');
lines.push('============================================================');
for (const [on, oc] of origins) {
  lines.push('');
  lines.push(`◤ ${on} ◢`);
  lines.push('  终点'.padEnd(10) + '里程'.padEnd(7) + '现行'.padEnd(6) + '方案一'.padEnd(6) + '方案二'.padEnd(6) + '官网现行(对照)');
  lines.push('  ' + '-'.repeat(50));
  const rows = [];
  for (const [dn, dc] of dests) {
    const km = minDist(oc, dc);
    if (km == null) continue;
    const cur = priceFor(CURRENT, km), s1 = priceFor(SCHEME1, km), s2 = priceFor(SCHEME2, km);
    const off = officialFare(oc[0], dc[0]);
    rows.push(`  ${dn.padEnd(10)} ${km.toFixed(1).padEnd(5)} ${String(cur).padEnd(6)} ${String(s1).padEnd(6)} ${String(s2).padEnd(6)} ${off}`);
  }
  lines.push(rows.join('\n'));
}
fs.writeFileSync('demo_result.txt', lines.join('\n'), 'utf8');
console.log(lines.join('\n'));