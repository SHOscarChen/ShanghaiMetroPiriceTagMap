const fs = require('fs');
const path = require('path');

// 读取当前坐标映射
const stations = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/officialStations.json'), 'utf-8'));

// 站点代码 -> 所在线路（用于判断优先级）
// 常规地铁线(01-18)优先，浦江线(41)其次，市域机场线(51)最低
// 因为普通地铁线的站是城市轨道交通，同名换乘时应优先用普通地铁代码（票价正常）
function lineRank(code) {
  if (code.startsWith('51')) return 100; // 市域机场线，最低优先
  if (code.startsWith('41')) return 50;  // 浦江线
  const p = parseInt(code.slice(0, 2), 10);
  return p; // 常规 01-18 号线，数字越小越优先
}

// 按 (x, y, 去除空格后的名称) 分组
const groups = {};
for (const s of stations) {
  const key = `${s.x}_${s.y}_${s.name.replace(/\s+/g, '')}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(s);
}

// 每组选一个主站点，其余标记为隐藏（不被地图渲染/点击）
const keptCodes = new Set();
const hiddenCodes = new Set();
let upgraded = 0;

for (const [key, list] of Object.entries(groups)) {
  if (list.length === 1) {
    keptCodes.add(list[0].code);
    continue;
  }
  // 多代码共点（换乘站）：选线路优先级最高的作为主代码
  list.sort((a, b) => lineRank(a.code) - lineRank(b.code));
  keptCodes.add(list[0].code);
  for (let i = 1; i < list.length; i++) {
    hiddenCodes.add(list[i].code);
    upgraded++;
  }
}

// 加 hidden 标记
const result = stations.map((s) => {
  if (hiddenCodes.has(s.code)) return { ...s, hidden: true };
  return s;
});

fs.writeFileSync(path.join(__dirname, '../data/officialStations.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(__dirname, '../public/stations-coords.json'), JSON.stringify(result, null, 2));

console.log('H标（原坐标数）:', stations.length);
console.log('保留主站点:', keptCodes.size);
console.log('隐藏的同名重复站（不渲染/不可点击）:', hiddenCodes.size);
console.log('隐藏的站点:', [...hiddenCodes].join(', '));
console.log('\n已验证浦东机场:');
result.filter((s) => s.code === '0263' || s.code === '5137').forEach((s) => console.log('  ' + s.code + ' ' + s.name + (s.hidden ? ' (hidden)' : ' (主站点)')));