const fs = require('fs');
const path = require('path');

const cachePath = path.join(__dirname, '../../data/fares.json');
const META_PATH = path.join(__dirname, '../../data/fares.meta.json');

// 永久本地票价存储，无过期时间。本地命中就直接返回，不请求官网。
let cache = {};
let meta = { builtAt: null, stationCount: 0, pairCount: 0 };

function loadCache() {
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    cache = {};
  }
  try {
    meta = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
  } catch {
    meta = { builtAt: null, stationCount: 0, pairCount: 0 };
  }
}

function saveCache() {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
  meta.pairCount = Object.keys(cache).length;
  meta.updatedAt = Date.now();
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
}

function getCacheKey(originCode, destCode) {
  const arr = [originCode, destCode].sort();
  return arr.join(':');
}

// 读取票价。返回单价格字符串（无快速价）或 { normal, fast } 对象（双价）。
// 兼容旧存储格式 { price }。
function getFare(originCode, destCode) {
  const key = getCacheKey(originCode, destCode);
  const entry = cache[key];
  if (!entry) return null;
  if (entry.fast !== undefined) return { normal: entry.price, fast: entry.fast };
  return entry.price;
}

// 保存票价。fare 可为单价格字符串或 { normal, fast } 对象。
function setFare(originCode, destCode, fare) {
  const key = getCacheKey(originCode, destCode);
  if (fare && typeof fare === 'object') {
    cache[key] = { price: fare.normal, fast: fare.fast };
  } else {
    cache[key] = { price: fare };
  }
  saveCache();
}

// 旧接口兼容：返回 { other: 单价格字符串 }，无快速价
function getCachedPricesForOrigin(originCode) {
  const results = {};
  for (const [key, entry] of Object.entries(cache)) {
    const [a, b] = key.split(':');
    if (a === originCode || b === originCode) {
      const other = a === originCode ? b : a;
      results[other] = entry.price;
    }
  }
  return results;
}

// 返回 { other: 单价格字符串 或 { normal, fast } }，供双价展示
function getCachedFaresForOrigin(originCode) {
  const results = {};
  for (const [key, entry] of Object.entries(cache)) {
    const [a, b] = key.split(':');
    if (a === originCode || b === originCode) {
      const other = a === originCode ? b : a;
      results[other] = entry.fast !== undefined ? { normal: entry.price, fast: entry.fast } : entry.price;
    }
  }
  return results;
}

function stats() {
  return {
    ...meta,
    totalPairs: Object.keys(cache).length,
  };
}

loadCache();

module.exports = { getFare, setFare, getCachedPricesForOrigin, getCachedFaresForOrigin, stats };