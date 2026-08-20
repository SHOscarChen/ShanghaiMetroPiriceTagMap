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

// 官方线路总里程（用于按线校准边长）
const LINE_KM = {
  1: 36.8, 2: 64.0, 3: 40.3, 4: 33.7, 5: 33.77, 6: 33.5, 7: 44.5, 8: 48.6,
  9: 81.5, 10: 46.0, 11: 82.5, 12: 44.6, 13: 38.9, 14: 38.5, 15: 42.1,
  16: 58.96, 17: 35.3, 18: 36.9, 41: 6.7
};

// 计算每条线路的经纬度总和，得到校准系数
const lineCal = {};
for (const line of g) {
  const st = line.stations;
  let sum = 0, n = 0;
  for (let i = 0; i < st.length - 1; i++) {
    if (st[i].distNext == null) continue;
    sum += st[i].distNext; n++;
  }
  const off = LINE_KM[line.line];
  if (off && n) lineCal[line.line] = off / sum;
}
console.log('按线校准系数:', JSON.stringify(lineCal, null, 0));

function buildGraph(scaled) {
  const adj = {};
  codes.forEach((c) => (adj[c] = []));
  const addEdge = (a, b, w) => { if (w == null || a === b) return; adj[a].push([b, w]); adj[b].push([a, w]); };
  for (const line of g) {
    const st = line.stations;
    const factor = scaled ? lineCal[line.line] : 1;
    for (let i = 0; i < st.length - 1; i++) addEdge(st[i].code, st[i + 1].code, st[i].distNext != null ? st[i].distNext * factor : null);
  }
  for (const mem of Object.values(cluster)) {
    if (mem.length < 2) continue;
    for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) addEdge(mem[i], mem[j], 0);
  }
  return adj;
}

function dijkstra(adj, src) {
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

const starts = ['0111', '0123', '0138', '1633', '0201', '0821', '1521', '1821'];
for (const scaled of [false, true]) {
  const adj = buildGraph(scaled);
  let t = 0, h = 0;
  const diffs = {};
  for (const s of starts) {
    const dist = dijkstra(adj, s);
    for (const dest of codes) {
      if (dest === s || dest.startsWith('51')) continue;
      const d = dist[dest]; if (d == null) continue;
      const real = getFare(s, dest); if (real == null) continue;
      const diff = priceOf(d) - real;
      diffs[diff] = (diffs[diff] || 0) + 1;
      t++; if (diff === 0) h++;
    }
  }
  console.log(`${scaled ? '按线校准' : '原始经纬度'} (不含51机场线): 匹配 ${h}/${t} = ${(h / t * 100).toFixed(1)}%  偏差分布:`, JSON.stringify(diffs));
}