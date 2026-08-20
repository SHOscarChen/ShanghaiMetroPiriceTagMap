// 模拟 GitHub Pages 纯静态环境：只服务 public/，无任何后端 API
// 支持 BASE 环境变量模拟子路径（如 /ShanghaiMetroPiriceTagMap/）
// 用法: node serve-static.js [端口]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.argv[2]) || 8080;
const BASE = process.env.BASE || '';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (BASE && url.startsWith(BASE)) url = url.slice(BASE.length);
  if (url === '/') url = '/index.html';
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404); res.end('404 Not Found: ' + url); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`静态预览(模拟 GitHub Pages): http://localhost:${PORT}${BASE}`));