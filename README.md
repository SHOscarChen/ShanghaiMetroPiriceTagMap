# 上海地铁新旧票价对比

2026-11-23，上海市发改委发布《关于优化上海市轨道交通票价机制的复函》（沪发改价调〔2026〕58号），新票价机制自 **2026-12-01** 起执行：

> 起乘价 3 元，起乘间距 0–4 公里；后续每 4、4、4、7、7、10、10 公里加 1 元，50 公里以上每 15 公里加 1 元。

本项目在官方静态线路图上对比两套票价：

- **现行票价**：2005 机制，至 2026-11-30
- **新票价**：2026-12-01 起执行的最终方案
- **涨跌视图**：红涨 / 绿降 / 灰不变，一眼看出每条线路、每个站点的变化

适用范围：全市轨道交通，不含磁浮线、金山铁路、市域机场线及以后开通的市域线；涉及市域机场线的行程按「地铁段新价 + 机场线官方段价」计算。

- 官方来源：<https://fgw.sh.gov.cn/fgw_jjjctk/20261123/f57b63885c514c829ee269ed589ab2b9.html>
- 旧版页面存档：`archive/2025-fare/`（站内可直接访问，仍可查 2005 机制票价）

---

## 功能特性

| 特性 | 说明 |
|------|------|
| 官方静态底图 | 使用稳定的 SVG 线网图（2638×3692），不随线路数据变动 |
| 新旧对比 | 现行价 / 新票价 / 涨跌三种视图，点击任意站点切换起点 |
| 涨跌统计 | 自动统计涨价、不变、降价站点数与单站最高涨幅 |
| 官方口径 | 旧价来自官方快照；新价按复函阶梯与最短路径里程计算 |
| 机场线拆分 | 市域机场线不随新机制调整，按地铁段 + 机场线段分段累加 |
| 站内存档 | `/archive/2025-fare/` 保留旧版完整查询页 |
| 图片导出 | 保存当前视图的 PNG 价目表，含起点、口径与统计 |

---

## 构建与发布

```bash
npm ci
npm run build:static   # 生成 public/data 与 public/archive/2025-fare/data
node serve-static.js 8080
```

构建过程**不访问线上接口**：旧价读取 `data/fares.json` 官方快照，新价读取 `data/distances.json` 同源的线网数据并重新计算，因此 2026-12-01 之后仍可重复生成。

推送到 `main` 后由 `.github/workflows/deploy.yml` 自动部署到 GitHub Pages。

---

> 以下“技术架构 / 目录结构 / 核心模块说明 / 数据流 / 官网接口”等章节是旧版实时抓取版本的开发文档，保留作参考；当前页面已改为离线快照 + 里程计算，不再依赖线上接口。

---

## 技术架构

```
┌──────────────────────────────────────────────────────┐
│                    前端 (public/)                     │
│  index.html   官方SVG底图 + 叠加票价圆圈/数字         │
│  app.js       站点选择、SVG渲染、缩放平移、点击切换    │
│  calibrate.html  坐标校准工具（独立页）                │
└───────────────┬──────────────────────────────────────┘
                │ HTTP / JSON
┌───────────────▼──────────────────────────────────────┐
│                 后端 (src/server.js)                  │
│  Express + CORS + 静态资源                           │
│  ┌──────────────────────────────────────────────┐    │
│  │  routes/api.js       REST 路由               │    │
│  │  services/metroApi.js  官网接口对接（多级兜底）│    │
│  │  services/cache.js      永久本地票价库       │    │
│  │  services/stationData.js 站点数据            │    │
│  └──────────────────────────────────────────────┘    │
└───────────────┬──────────────────────────────────────┘
                │ 探测式抓取（仅本地未命中时）
┌───────────────▼──────────────────────────────────────┐
│       上海地铁官网 data sources                       │
│  service.shmetro.com/i/p          (简单票价接口)      │
│  m.shmetro.com/interface/plantrip (行程接口兜底)     │
│  marketing.cyberspaceit.cn/metromap (SVG+坐标来源)   │
└──────────────────────────────────────────────────────┘
```

---

## 目录结构

```
pricetag/
├── src/
│   ├── server.js              # Express 入口（端口 3000）
│   ├── warmup.js              # 分批采集全网票价脚本
│   ├── buildData.js           # 从官网地图API提取站点坐标
│   ├── extractMetroData.js    # 坐标提取辅助脚本
│   ├── generateMapData.js     # 旧版GIS数据生成（历史保留）
│   ├── services/
│   │   ├── metroApi.js        # 官网接口对接 + 多级兜底 + 并发
│   │   ├── cache.js           # 永久本地票价库（fares.json）
│   │   └── stationData.js     # 站点列表/名称加载
│   └── routes/
│       └── api.js             # REST API 路由
├── public/
│   ├── index.html             # 主页面
│   ├── calibrate.html         # 坐标校准工具页
│   ├── images/linesh.svg      # 官方线路图底图 (1.5MB)
│   ├── stations-coords.json   # 站点SVG坐标（532站）
│   ├── css/style.css          # 主页面样式
│   ├── css/calibrate.css      # 校准工具样式
│   └── js/
│       ├── app.js             # 主页面逻辑
│       ├── calibrate.js       # 校准工具逻辑
│       └── mapRenderer.js     # 旧版渲染器（历史保留）
├── data/
│   ├── fares.json             # ★ 永久本地票价库
│   ├── fares.meta.json        # 票价库元数据
│   ├── stations.json          # 全部站点列表（532站）
│   ├── officialStations.json  # 站点SVG坐标（源）
│   ├── metromap.json          # 官网地图API原始数据
│   └── *.log                  # warmup 运行日志
├── API.md                     # 接口文档
└── package.json
```

---

## 核心模块说明

### `src/services/metroApi.js` —— 官网接口对接

查询票价的核心。涉及三个官网数据源：

| 接口 | URL | 用途 |
|------|-----|------|
| 简单票价 | `service.shmetro.com/i/p?o=&d=` | 首选，返回 `{"data":{"p":"7"}}` |
| 行程规划 | `m.shmetro.com/interface/plantrip/pt.aspx` | 兜底，返回 `pathList[0].price` |

**查询策略（多级兜底）：**
```
1. 查本地票价库 → 命中直接返回（不请求官网）
2. 官网 /i/p 简单接口（重试3次）
3. 官网行程接口兜底（正反方向各尝试）
4. 特殊站点组合内置票价（ADJACENT_OVERRIDES）
```

要点：
- 并发控制 `CONCURRENCY = 4`，避免官网限流
- 每个请求超时 12s，自动重试 3 次
- 失败站点会在下次 `getAllPrices` 自动补齐

### `src/services/cache.js` —— 永久本地票价库

- 保存到 `data/fares.json`
- **无过期时间**，本地命中直接返回
- 键：`{codeA}:{codeB}`（排序，票价双向对称共用）
- 提供 `stats()` 查询构建状态

### `src/warmup.js` —— 分批采集脚本

按线路（1号线→2号线→…→市域机场线）逐站采集全网票价。
- **自动跳过已完整缓存的站点**（断点续传）
- 每个站完成后打印结果，含失败统计
- 失败站点不阻塞，后续重跑自动补齐
- 所有数据永久写入 `data/fares.json`

### `src/routes/api.js` —— REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stations` | 全部站点列表 |
| GET | `/stations-coords.json` | 站点 SVG 坐标 |
| GET | `/api/map` | 旧版地图数据（历史） |
| GET | `/api/stcoords` | 站点 SVG 坐标（JSON源） |
| GET | `/api/fare-stats` | 本地票价库统计 |
| GET | `/api/prices/:origin` | 一站 → 全网票价 |
| GET | `/api/price?src=&dst=` | 两站间票价 |
| GET | `/images/linesh.svg` | 官方线路图 |
| GET | `/calibrate.html` | 坐标校准工具 |

完整接口示例见 `API.md`。

---

## 数据流与存储

### 票价查询数据流
```
用户选择站点 (前端)
  → GET /api/prices/{origin} (后端)
    → 读取本地 fares.json
      → 本地命中? 直接返回
      → 未命中:
          官网 /i/p -> 官网行程接口 -> 特殊内置
          结果写入 fares.json (永久)
  → 前端在地图上渲染票价数字
```

### 存储文件
| 文件 | 内容 | 是否永久 |
|------|------|---------|
| `data/fares.json` | 票价对 `{codeA:codeB: {price}}` | 是 |
| `data/fares.meta.json` | 构建统计 | 是 |
| `data/stations.json` | 站点列表 | 是 |
| `data/officialStations.json` | SVG 坐标 | 是 |

---

## 官网接口对接

### 1. 简单票价接口
```
GET https://service.shmetro.com/i/p?o={起点}&d={终点}
```
响应：
```json
{"flag":0,"data":{"p":"7"}}
```
- `p` 为票价（元）
- 对 18 号线北段新站（1847/1848/1850/1851/1852）返回**空数据**，需走行程接口

### 2. 行程规划接口（兜底）
```
GET https://m.shmetro.com/interface/plantrip/pt.aspx
    ?func=plantrip&startId={o}&endId={d}&planTime=12:00&week=1&ticket=oneCard&type=1
```
响应中 `pathList[0].price` 为票价。
- 长江西路(1848) 作为起点会返回错误页，需**反向查询**（票价对称）

### 3. 站点坐标来源
```
GET https://marketing.cyberspaceit.cn/interface/metromap/metromap.aspx
```
返回各站点在 SVG 上的百分比坐标，已通过 `buildData.js` 提取为 `officialStations.json`。

---

## 已知问题与应对

| 问题 | 表现 | 应对 |
|------|------|------|
| 官网 18 号线北段新站 /i/p 查不到 | 空返回值 | 改用行程接口 |
| 长江西路(1848) 做起点报错 | 返回 500/HTML | 反向查询（票价对称） |
| 市域机场线(51xx) /i/p 价格错误 | 价格严重偏高（如景洪路30元） | 涉及市域机场线站直接走行程接口 |
| 个别站官网偶发不稳 | 查询返回 null | 自动重试 3 次 + 下一轮补齐 |
| 官网限流 | 批量时部分失败 | 并发控制为 4 + 失败重试 |
| 相邻特殊站组合 | 官网始终报错 | `ADJACENT_OVERRIDES` 内置票价 |

---

## 开发调试

### 运行命令
```bash
npm start          # 启动服务（端口 3000，支持热改 src 后手动重启）
npm run warmup     # 分批采集全网票价（断点续传）
npm run rebuild    # 从官网API重新提取站点坐标
npm run generate   # 重新生成旧版GIS数据（历史）
```

### 查看采集进度
方式一：实时看 `npm run warmup` 的终端输出。
方式二：访问 `http://localhost:3000/api/fare-stats` 的 `totalPairs`（票价对数）。
方式三：直接读 `data/fares.json`。

### 坐标校准
访问 `http://localhost:3000/calibrate.html`，可拖拽校准站点位置并导出结果。

### 清除本地票价重新采集
删除 `data/fares.json` 和 `data/fares.meta.json` 后重跑 `npm run warmup`。

---

### 接口文档
详细接口说明见 [API.md](./API.md)。