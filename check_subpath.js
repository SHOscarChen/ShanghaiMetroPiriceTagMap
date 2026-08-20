const http = require('http');
const BASE = '/ShanghaiMetroPiriceTagMap';
function get(u) { return new Promise((ok, er) => http.get(u, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => ok({ status: r.statusCode, body: b })); }).on('error', er)); }
(async () => {
  const base = 'http://localhost:8081' + BASE;
  const idx = await get(base + '/');
  console.log('首页:', idx.status, idx.body.includes('上海地铁票价速查') ? '内容OK' : '内容异常');
  console.log('  base标签:', idx.body.includes('<base href="./">') ? 'OK' : '缺失');
  console.log('  css相对路径:', idx.body.includes('href="css/style.css"') ? 'OK' : '异常');
  console.log('  js相对路径:', idx.body.includes('src="js/app.js"') ? 'OK' : '异常');

  // 模拟浏览器用相对路径解析
  const css = await get(base + '/css/style.css');
  console.log('css/style.css:', css.status, '含.scheme-btn:', css.body.includes('.scheme-btn'));
  const js = await get(base + '/js/app.js');
  console.log('js/app.js:', js.status, '含fetch相对路径:', js.body.includes("fetch('data/stations.json')") && js.body.includes('data/prices/${originCode}'));
  const coords = await get(base + '/stations-coords.json');
  console.log('stations-coords.json:', coords.status, JSON.parse(coords.body).length, '条');
  const st = await get(base + '/data/stations.json');
  console.log('data/stations.json:', st.status, JSON.parse(st.body).length, '站');
  const pr = await get(base + '/data/prices/0111.json');
  const j = JSON.parse(pr.body);
  console.log('data/prices/0111.json:', pr.status, j.originName, '人民广场', j.schemes.current['0123'], '方案一', j.schemes.scheme1['0123']);
  const img = await get(base + '/images/linesh.svg');
  console.log('images/linesh.svg:', img.status);
  const api = await get(base + '/api/prices/0111');
  console.log('api(应404走回退):', api.status);
})();