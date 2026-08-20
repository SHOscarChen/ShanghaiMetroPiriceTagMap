const fs = require('fs');
const g = JSON.parse(fs.readFileSync('data/latlng_dist.json', 'utf8'));
const coord = {};
for (const line of g) for (const s of line.stations) {
  if (!coord[s.code] && s.lng != null) coord[s.code] = { lng: s.lng, lat: s.lat, name: s.name };
}
console.log('total codes:', Object.keys(coord).length);
console.log('0123:', JSON.stringify(coord['0123']));
console.log('0245:', JSON.stringify(coord['0245']));
console.log('0233:', JSON.stringify(coord['0233']));
console.log('1633:', JSON.stringify(coord['1633']));

// check line1 contains 0123
const l1 = g.find(l=>l.line===1);
console.log('line1 has 0123:', l1.stations.some(s=>s.code==='0123'), 'idx', l1.stations.findIndex(s=>s.code==='0123'));
console.log('line1 codes:', l1.stations.map(s=>s.code).join(' '));
// check each station has distNext
const missingDist = [];
for (const line of g) for (const s of line.stations.filter(x=>x.distNext==null)) missingDist.push(line.line + ':' + s.code + ':' + s.name);
console.log('stations missing distNext:', missingDist.length, missingDist.slice(0, 30).join(' '));
// check station codes not in stations-coords (x,y null)
console.log('sample with x/y null:', g[0].stations.filter(s=>s.x==null).length);