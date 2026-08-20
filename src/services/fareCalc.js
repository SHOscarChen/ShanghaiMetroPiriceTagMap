// 三套票价方案的里程阶梯计价（单位：公里，区间 (min, max]）
// 数据来源与校验：
//  - 方案一、方案二按官方《优化上海市轨道交通票价机制听证方案》整理
//  - 已用官方问答示例校准：中山公园→世纪公园(14.3km) 方案一6/方案二6；
//    九亭→人民广场(19.4km) 方案一7/方案二6

const CURRENT_STEPS = [
  { max: 6, price: 3 }, { max: 16, price: 4 }, { max: 26, price: 5 },
  { max: 36, price: 6 }, { max: 46, price: 7 }, { max: 56, price: 8 },
  { max: 66, price: 9 }, { max: 76, price: 10 }, { max: 86, price: 11 },
  { max: 96, price: 12 }, { max: 106, price: 13 }, { max: 116, price: 14 },
  { max: 126, price: 15 }, { max: Infinity, price: 16 },
];

// 方案一：起步 3 元 / 0-4km；加价间距 4/4/4/7/7/7/10/10/10 km；67km 后 13 元起每 15km +1 元
const SCHEME1_STEPS = [
  { max: 4, price: 3 }, { max: 8, price: 4 }, { max: 12, price: 5 },
  { max: 16, price: 6 }, { max: 23, price: 7 }, { max: 30, price: 8 },
  { max: 37, price: 9 }, { max: 47, price: 10 }, { max: 57, price: 11 },
  { max: 67, price: 12 }, { max: 82, price: 13 }, { max: 97, price: 14 },
  { max: 112, price: 15 }, { max: 127, price: 16 }, { max: 142, price: 17 },
  { max: 157, price: 18 }, { max: Infinity, price: 19 },
];

// 方案二：起步 4 元 / 0-6km；加价间距 6/8/8/10/10/12/12/14 km；72km 后 12 元起每 14km +1 元
const SCHEME2_STEPS = [
  { max: 6, price: 4 }, { max: 14, price: 5 }, { max: 22, price: 6 },
  { max: 32, price: 7 }, { max: 42, price: 8 }, { max: 54, price: 9 },
  { max: 66, price: 10 }, { max: 72, price: 11 }, { max: 86, price: 12 },
  { max: 100, price: 13 }, { max: 114, price: 14 }, { max: 128, price: 15 },
  { max: 142, price: 16 }, { max: Infinity, price: 17 },
];

const SCHEMES = {
  current: CURRENT_STEPS,
  scheme1: SCHEME1_STEPS,
  scheme2: SCHEME2_STEPS,
};

const SCHEME_LABELS = {
  current: '现行票价',
  scheme1: '方案一',
  scheme2: '方案二',
};

function priceOf(km, scheme) {
  const steps = SCHEMES[scheme] || SCHEMES.current;
  for (const b of steps) if (km <= b.max) return b.price;
  return steps[steps.length - 1].price;
}

module.exports = { SCHEMES, SCHEME_LABELS, priceOf };