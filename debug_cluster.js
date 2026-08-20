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
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
    if (uf.find(st[i].code) === uf.find(st[j].code)) addEdge(st[i].code, st[j].code, 0);
  }
}
console.log('sort key 0123 & 0245 same cluster?', uf.find('0123') === uf.find('0245'));
console.log('0123 adj:', adj['0123'].map(([c, w]) => `${c}(${coord[c].name},${w.toFixed ? w.toFixed(1) : w})`).join(' '));
console.log('0245 cluster codes:', cluster[uf.find('0245')], 'adj count', (adj['0245'] || []).length);
console.log('1633 adj:', adj['1633'].map(([c, w]) => `${c}(${coord[c].name},${w})`).join(' '));
console.log('0123 has 0-edge to what:', adj['0123'].filter(e => e[1] === 0).map(e => e[0]).join(','));