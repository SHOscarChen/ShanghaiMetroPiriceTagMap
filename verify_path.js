const fs = require('fs');
const g = JSON.parse(fs.readFileSync('data/latlng_dist.json', 'utf8'));
const coord = {};
for (const line of g) for (const s of line.stations) if (!coord[s.code] && s.lng != null) coord[s.code] = { lng: s.lng, lat: s.lat, name: s.name };
const codes = Object.keys(coord);

class UF {
  constructor(keys) { this.p = {}; keys.forEach((k) => (this.p[k] = k)); }
  find(x) { if (this.p[x] !== x) this.p[x] = this.find(this.p[x]); return this.p[x]; }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p[ra] = rb; }
}
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
// 换乘 0 边：簇内所有 code 两两相连
for (const mem of Object.values(cluster)) {
  if (mem.length < 2) continue;
  for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) addEdge(mem[i], mem[j], 0);
}
console.log('0123 & 0245 same cluster?', uf.find('0123') === uf.find('0245'));
console.log('0123 adj:', adj['0123'].map(([c, w]) => `${coord[c].name}(${w})`).join(' '));
console.log('0245 adj:', (adj['0245'] || []).map(([c, w]) => `${coord[c].name}(${w})`).join(' '));
console.log('1633 adj:', (adj['1633'] || []).map(([c, w]) => `${coord[c].name}(${w})`).join(' '));

function dijkstra(src) {
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
function priceOf(d) { return d <= 6 ? 3 : 3 + Math.ceil((d - 6) / 10); }
const fareCache = JSON.parse(fs.readFileSync('data/fares.json', 'utf8'));
function getFare(a, b) { const e = fareCache[[a, b].sort().join(':')]; return e ? Number(e.price) : null; }
const tests = [['0111', '0123'], ['0123', '1633'], ['0329', '1629'], ['0111', '5137'], ['0111', '1521'], ['0123', '0245']];
for (const [a, b] of tests) {
  const d = dijkstra(a)[b];
  const calc = d == null ? null : priceOf(d);
  const real = getFare(a, b);
  console.log(`${coord[a]?.name}(${a}) → ${coord[b]?.name}(${b}): ${d?.toFixed(1) ?? '?'}km 计算=${calc} 官方=${real} ${calc == real ? '✅' : '❌'}`);
}