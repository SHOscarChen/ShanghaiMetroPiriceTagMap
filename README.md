# 上海地铁票价速查系统

一个基于 **上海地铁官网票价接口** 的本地票价查询与可视化工具。
在官方线路图上直观展示「所选站点 → 全网各站」的票价。

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [技术架构](#技术架构)
- [目录结构](#目录结构)
- [核心模块说明](#核心模块说明)
- [数据流与存储](#数据流与存储)
- [官网接口对接](#官网接口对接)
- [已知问题与应对](#已知问题与应对)
- [开发调试](#开发调试)

---

## 项目简介

用户选择上海地铁任意一个站点，即可在该线路图上看到：
- 每个站点圆圈内显示**到该站的票价数字**
- 起点为红色高亮
- 支持滚轮缩放、拖拽平移、点击切换起点

数据从上海地铁官网实时抓取（首次），之后**永久保存在本地**，本地命中不再请求官网。

---

## 功能特性

| 特性 | 说明 |
|------|------|
| 官方底图 | 使用官网高清 SVG 线路图（2638×3692） |
| 准确的站点坐标 | 从官网地图 API 提取校准 |
| 国际惯例颜色 | 20 条线路标准配色 |
| 叠加票价 | 站点圆圈 + 数字，醒目清晰 |
| 交互 | 滚轮缩放、拖拽平移、点击切换起点 |
| 永久本地缓存 | 查过的票价永久保存，本地命中秒回 |
| 可续跑采集 | 分批按线路采集，支持断点续传 |
| 坐标校准工具 | 拖拽校准站点位置（[打开校准页](http://localhost:3000/calibrate.html)） |

---

## 快速开始

### 环境要求
- Node.js ≥ 20（使用了原生 `fetch`）

### 安装依赖
```bash
npm install
```

### 启动服务
```bash
npm start
```
浏览器访问 `http://localhost:3000`

### 首次查询
页面顶部下拉选择起始站，等待 1-2 分钟完成首次查询（需联网抓取官网），之后所有站点票价秒回。

### 预采集全网票价（可选，推荐）
```bash
npm run warmup
```
从 1 号线开始，按线路逐站查询并永久保存到本地。**支持断点续跑**，中断后重跑会自动跳过已完成站点。

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