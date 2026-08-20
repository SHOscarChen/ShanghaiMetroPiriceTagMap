const fs = require('fs');
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
for (const line of g) {
  const st = line.stations;
  for (let i = 0; i < st.length - 1; i++) addEdge(st[i].code, st[i + 1].code, st[i].distNext);
}
for (const mem of Object.values(cluster)) {
  if (mem.length < 2) continue;
  for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) addEdge(mem[i], mem[j], 0);
}
function dijkstra(src) {
  const dist = {}; dist[src] = 0; const pq = [[0, src]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]); const [d, u] = pq.shift();
    if (d > (dist[u] ?? Infinity)) continue;
    for (const [v, w] of adj[u] || []) { const nd = d + w; if (nd < (dist[v] ?? Infinity)) { dist[v] = nd; pq.push([nd, v]); } }
  }
  return dist;
}
function priceOf(d) { return d <= 6 ? 3 : 3 + Math.ceil((d - 6) / 10); }
const fareCache = JSON.parse(fs.readFileSync('data/fares.json', 'utf8'));
function getFare(a, b) { const e = fareCache[[a, b].sort().join(':')]; if (!e) return null; const v = typeof e === 'object' ? e.price : e; return Number(v); }

// 全网抽样评估：5 个起点，各随机取 30 个终点，统计匹配率
const starts = ['0111', '0123', '0138', '1633', '0201'];
const rng = [13, 42, 71, 99, 5];
let total = 0, hit = 0;
for (const s of starts) {
  const dist = dijkstra(s);
  const others = codes.filter((c) => c !== s);
  for (let i = 0; i < 30 && i < others.length; i++) {
    const dest = others[(i * 7 + rng[starts.indexOf(s)]) % others.length];
    const d = dist[dest]; if (d == null) continue;
    const real = getFare(s, dest); if (real == null) continue;
    total++; if (priceOf(d) === real) hit++;
  }
}
console.log(`匹配率: ${hit}/${total} = ${(hit / total * 100).toFixed(1)}%`);
// 展示普通站对（不含 51xx 机场线）
let t2 = 0, h2 = 0;
for (const s of starts) {
  const dist = dijkstra(s);
  for (const dest of codes) {
    if (dest === s || dest.startsWith('51')) continue;
    const d = dist[dest]; if (d == null) continue;
    const real = getFare(s, dest); if (real == null) continue;
    t2++; if (priceOf(d) === real) h2++;
  }
}
console.log(`不含机场线匹配率: ${h2}/${t2} = ${(h2 / t2 * 100).toFixed(1)}%`);
// 偏差分布
const diffs = {};
for (const s of starts) {
  const dist = dijkstra(s);
  for (const dest of codes) {
    if (dest === s) continue;
    const d = dist[dest]; if (d == null) continue;
    const real = getFare(s, dest); if (real == null) continue;
    const diff = priceOf(d) - real;
    diffs[diff] = (diffs[diff] || 0) + 1;
  }
}
console.log('偏差分布(计算-官方):', JSON.stringify(diffs, null, 1));