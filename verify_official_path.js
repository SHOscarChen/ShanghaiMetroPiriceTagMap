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
for (const line of g) { const st = line.stations; for (let i = 0; i < st.length - 1; i++) addEdge(st[i].code, st[i + 1].code, st[i].distNext); }
const ufSet = new Set();
for (const mem of Object.values(cluster)) if (mem.length >= 2) for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) addEdge(mem[i], mem[j], 0);

// 带路径记录的 Dijkstra
function dijkstraPath(src, dst) {
  const dist = {}; dist[src] = 0;
  const prev = {};
  const pq = [[0, src]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, u] = pq.shift();
    if (d > (dist[u] ?? Infinity)) continue;
    if (u === dst) break;
    for (const [v, w] of adj[u] || []) {
      const nd = d + w;
      if (nd < (dist[v] ?? Infinity)) { dist[v] = nd; prev[v] = u; pq.push([nd, v]); }
    }
  }
  if (dist[dst] == null) return null;
  const path = []; let cur = dst;
  while (cur !== undefined) { path.unshift(cur); cur = prev[cur]; }
  return { dist: dist[dst], path };
}

async function plantrip(a, b) {
  const u = `https://m.shmetro.com/interface/plantrip/pt.aspx?func=plantrip&startId=${a}&endId=${b}&planTime=12:00&week=1&ticket=oneCard&type=1`;
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  const p = j.pathList && j.pathList[0];
  if (!p) return { ok: false };
  // 官方路径：passStationList 里的 stationId（注意是 2-3 位或 4 位）→ 补零
  const pass = (p.passStationList || []).map((s) => String(s.stationId).padStart(4, '0'));
  return { ok: true, price: p.price, pass, transfer: (p.transferStationList || []).map(t => ({ line: t.line, name: t.stationName })), begin: p.beginTravelTime };
}

const tests = [
  ['0111', '0123'], ['0123', '1633'], ['0329', '1629'], ['0111', '5137'], ['0111', '1521'],
  ['0111', '0321'], ['0123', '0245'], ['0201', '0138'], ['0123', '0821'], ['0518', '0163'],
];

async function main() {
  for (const [a, b] of tests) {
    const pr = await plantrip(a, b);
    const mine = dijkstraPath(a, b);
    console.log('============================================');
    console.log(`${coord[a]?.name}(${a}) → ${coord[b]?.name}(${b})`);
    if (!pr.ok) { console.log('官网查询失败'); continue; }
    console.log('官网价:', pr.price, '| 官网换乘:', pr.transfer.map(t => t.line + '号线').join(' → '));
    if (!mine) { console.log('我的模型不可达'); continue; }
    // 归一化对比：官网路径经过我的物理站（聚类根）
    const mineRoots = mine.path.map((c) => (cluster[uf.find(c)] || [c])[0]);
    const offRoots = pr.pass.map((c) => (coord[c] ? cluster[uf.find(c)] || c : c));
    // 官网站序列 → 聚类根序列压缩
    const comp = (arr) => { const out = []; for (const x of arr) if (out[out.length - 1] !== x) out.push(x); return out; };
    const mRoot = comp(mineRoots.map((r) => (coord[Object.values(cluster)[0]] ? uf.find(r) : r)));
    const oRoot = comp(offRoots.map((r) => uf.find(r)));
    const mNames = mRoot.map((r) => coord[r]?.name || r);
    const oNames = oRoot.map((r) => coord[r]?.name || r);
    console.log('官网路径(聚类):', oNames.join(' → '));
    console.log('我算路径(聚类):', mNames.join(' → '));
    // 判断是否一致（按物理站根比较集合）
    const same = mRoot.length === oRoot.length && mRoot.every((r, i) => r === oRoot[i]);
    console.log(same ? '✅ 路径一致' : '❌ 路径不一致');
    console.log('我算里程:', mine.dist.toFixed(1) + 'km');
  }
}
main().catch((e) => console.error('ERR', e.message));