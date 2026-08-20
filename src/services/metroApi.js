const cache = require('./cache');
const { getStations } = require('./stationData');

const PRICE_API = 'https://service.shmetro.com/i/p';
const TRIP_API = 'https://m.shmetro.com/interface/plantrip/pt.aspx';
const CONCURRENCY = 4;
const REQUEST_TIMEOUT = 12000;
const MAX_ATTEMPTS = 3;

// 官网 /i/p 接口不支持的站点代码（18号线北段延伸段新站），需用行程接口兜底
const UNSUPPORTED_CODES = new Set(['1847', '1848', '1850', '1851', '1852']);

// 市域机场线(51xx)站点：官网 /i/p 简单接口价格错误（严重偏高，如景洪路→莘庄高达12元）
// 官网 cphc 页面实际使用行程接口(plantrip)计算，因此涉及这些站点时直接走行程接口
const SHJIAO_CODES = new Set(['5131', '5132', '5133', '5134', '5135', '5136', '5137']);

// 官网对某些相邻站点组合始终报错（如 长江西路1848 ↔ 爱辉路1850）
// 这些是同线相邻站，票价固定为 3 元（与 18号线其他相邻站一致）
const ADJACENT_OVERRIDES = {
  '1848:1850': '3',
};

// 参与「普通票价/快速票价」双价逻辑的站点代码。
// 松江段（9号线 上海松江站至星中路）+ 机场联络线站点。
// 含与机场线共用点位的常规地铁代码（0927中春路、1528景洪路），
// 以便无论用户选择共用点位的哪个代码，双价逻辑都能触发。
const DUAL_FARE_SET = new Set([
  // 松江段
  '0918', '0919', '0920', '0921', '0922', '0923', '0924', '0925', '0926', '0927', '0928', '0929',
  // 机场联络线
  '5131', '5132', '5133', '5134', '5135', '5136', '5137',
  // 与机场线共用点位的地铁代码
  '1528',
]);

let queue = [];
let active = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      // 官网可能返回空/HTML/错误页（如下标的 500 页），返回空对象让调用方触发反向查询
      return {};
    }
  } finally {
    clearTimeout(timer);
  }
}

// 简单票价接口：官网 /i/p?o={o}&d={d}，失败可重试
async function fetchPriceSimple(originCode, destCode) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const data = await fetchJson(`${PRICE_API}?o=${originCode}&d=${destCode}`);
    const p = data?.data?.p;
    if (p) return p;
    if (i < MAX_ATTEMPTS - 1) await sleep(300 * (i + 1));
  }
  return null;
}

// 行程接口兜底：官网 /interface/plantrip/pt.aspx
// 注意：长江西路(1848) 作为起点时官网会返回错误页，需反向查询（票价双向对称）
async function fetchPriceTrip(originCode, destCode) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let data = await fetchJson(
      `${TRIP_API}?func=plantrip&startId=${originCode}&endId=${destCode}&planTime=12:00&week=1&ticket=oneCard&type=1`
    );
    let price = data?.pathList?.[0]?.price || null;
    if (price !== null) return price;

    // 反向查询兜底（正方向失败，反方向往往可用）
    data = await fetchJson(
      `${TRIP_API}?func=plantrip&startId=${destCode}&endId=${originCode}&planTime=12:00&week=1&ticket=oneCard&type=1`
    );
    price = data?.pathList?.[0]?.price || null;
    if (price !== null) return price;

    if (attempt < MAX_ATTEMPTS - 1) await sleep(500 * (attempt + 1));
  }
  return null;
}

function collectPathPrices(data) {
  const prices = [];
  for (const p of data?.pathList || []) {
    if (p.price != null) prices.push(p.price);
  }
  return prices;
}

// 行程接口多方案：收集该 OD 对官网返回的全部方案价格（去重），用于区分普通/快速票价
async function fetchTripPrices(originCode, destCode) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let data = await fetchJson(
      `${TRIP_API}?func=plantrip&startId=${originCode}&endId=${destCode}&planTime=12:00&week=1&ticket=oneCard&type=1`
    );
    let prices = collectPathPrices(data);
    if (prices.length === 0) {
      data = await fetchJson(
        `${TRIP_API}?func=plantrip&startId=${destCode}&endId=${originCode}&planTime=12:00&week=1&ticket=oneCard&type=1`
      );
      prices = collectPathPrices(data);
    }
    if (prices.length > 0) return [...new Set(prices)];
    if (attempt < MAX_ATTEMPTS - 1) await sleep(500 * (attempt + 1));
  }
  return null;
}

async function fetchFare(originCode, destCode) {
  const isDualPair = DUAL_FARE_SET.has(originCode) && DUAL_FARE_SET.has(destCode);

  const cached = cache.getFare(originCode, destCode);
  // 双价对：旧缓存可能是单价格字符串（升级前写入），需忽略并重新查询以补充快速价
  if (cached !== null && (!isDualPair || typeof cached === 'object')) return cached;

  // 官网无法查询的相邻站组合，直接返回内置票价
  const overrideKey = originCode + ':' + destCode;
  if (ADJACENT_OVERRIDES[overrideKey] !== undefined) {
    cache.setFare(originCode, destCode, ADJACENT_OVERRIDES[overrideKey]);
    return ADJACENT_OVERRIDES[overrideKey];
  }

  try {
    let fare = null;
    if (isDualPair) {
      const prices = await fetchTripPrices(originCode, destCode);
      if (prices && prices.length > 0) {
        const nums = prices.map(Number).sort((a, b) => a - b);
        const normal = nums[0];
        const fast = nums.length > 1 && nums[nums.length - 1] > normal ? nums[nums.length - 1] : null;
        fare = { normal: String(normal), fast: fast !== null ? String(fast) : null };
      }
    } else {
      // 常规单票价逻辑
      let price = null;
      // 涉及18号线新站或市域机场线时，直接走行程接口（/i/p 对这些站点缺失或价格错误）
      if (UNSUPPORTED_CODES.has(originCode) || UNSUPPORTED_CODES.has(destCode) ||
          SHJIAO_CODES.has(originCode) || SHJIAO_CODES.has(destCode)) {
        price = await fetchPriceTrip(originCode, destCode);
      } else {
        price = await fetchPriceSimple(originCode, destCode);
        if (price === null) {
          price = await fetchPriceTrip(originCode, destCode);
        }
      }
      if (price) fare = price;
    }
    if (fare !== null) {
      cache.setFare(originCode, destCode, fare);
      return fare;
    }
    return null;
  } catch {
    // 从简单接口抛错时尝试行程接口兜底
    try {
      const price = await fetchPriceTrip(originCode, destCode);
      if (price) {
        cache.setFare(originCode, destCode, price);
        return price;
      }
    } catch { /* 忽略 */ }
    return null;
  }
}

async function fetchPrice(originCode, destCode) {
  const fare = await fetchFare(originCode, destCode);
  if (fare === null) return null;
  return typeof fare === 'object' ? fare.normal : fare;
}

async function processQueue() {
  while (queue.length > 0 && active < CONCURRENCY) {
    const task = queue.shift();
    active++;
    task.resolve(await fetchFare(task.o, task.d));
    active--;
    processQueue();
  }
}

function enqueue(originCode, destCode) {
  return new Promise((resolve) => {
    queue.push({ o: originCode, d: destCode, resolve });
    processQueue();
  });
}

async function getAllPrices(originCode) {
  const stations = getStations();
  const cached = cache.getCachedFaresForOrigin(originCode);
  const uncached = stations.filter((s) => {
    if (s.code === originCode) return false;
    const c = cached[s.code];
    if (c === undefined) return true;
    // 双价对：旧缓存可能只有单价格字符串（升级前写入），需重新查询以补充快速价
    if (DUAL_FARE_SET.has(originCode) && DUAL_FARE_SET.has(s.code) && typeof c !== 'object') return true;
    return false;
  });

  const promises = uncached.map((s) => enqueue(originCode, s.code));
  const results = await Promise.all(promises);

  const allPrices = { ...cached };
  let idx = 0;
  for (const s of uncached) {
    if (results[idx] !== null) allPrices[s.code] = results[idx];
    idx++;
  }
  allPrices[originCode] = '0';
  return allPrices;
}

module.exports = { fetchFare, fetchPrice, getAllPrices };