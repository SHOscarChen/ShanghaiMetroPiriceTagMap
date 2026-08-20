const express = require('express');
const router = express.Router();
const { fetchFare, getAllPrices, SHJIAO_CODES } = require('../services/metroApi');
const { getStations, getStationName, getMapData } = require('../services/stationData');
const { getDistances } = require('../services/distances');
const { priceOf, SCHEME_LABELS } = require('../services/fareCalc');

router.get('/stations', (req, res) => {
  res.json(getStations());
});

router.get('/map', (req, res) => res.json(getMapData()));

router.get('/stcoords', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../../data/officialStations.json'));
});

router.get('/fare-stats', (req, res) => {
  res.json(require('../services/cache').stats());
});

// 一站到全网票价。返回三套方案：
//   prices  : 现行票价（键=目的站代码，值=字符串/或 {normal,fast}，兼容旧前端）
//   schemes : { current, scheme1, scheme2 } 均为 { code: 数字票价 }
router.get('/prices/:origin', async (req, res) => {
  const { origin } = req.params;
  const prices = await getAllPrices(origin);
  const result = { origin, originName: getStationName(origin), prices, schemes: {} };

  // 现行：直接复用官网缓存票价
  const cur = {};
  for (const [code, v] of Object.entries(prices)) {
    cur[code] = typeof v === 'object' ? Number(v.normal) : Number(v);
  }
  result.schemes.current = cur;

  // 方案一 / 方案二：基于里程阶梯
  // 注意：涉及市域机场线(51xx)的站对按官方独立计价（站间费率按段计价），
  //       不受地铁听证方案一/方案二影响，保持官方现行价即可。
  let distances = null;
  try { distances = getDistances(); } catch { distances = null; }
  for (const scheme of ['scheme1', 'scheme2']) {
    const out = {};
    for (const [code, v] of Object.entries(prices)) {
      let price = null;
      const key = [origin, code].sort().join(':');
      if (SHJIAO_CODES.has(origin) || SHJIAO_CODES.has(code)) {
        // 机场线按段计价：现行=方案一=方案二（官方口径）
        price = typeof v === 'object' ? Number(v.normal) : Number(v);
      } else if (distances && distances[key] != null) {
        price = priceOf(distances[key], scheme);
      } else if (typeof v === 'object') {
        price = priceOf(Number(v.normal), 'current');
      } else {
        price = priceOf(Number(v), 'current');
      }
      out[code] = price;
    }
    result.schemes[scheme] = out;
  }
  result.schemesLabel = SCHEME_LABELS;
  res.json(result);
});

router.get('/price', async (req, res) => {
  const { src, dst } = req.query;
  const fare = await fetchFare(src, dst);
  if (fare === null) return res.status(502).json({ error: '获取票价失败' });
  const normal = typeof fare === 'object' ? fare.normal : fare;
  const fast = typeof fare === 'object' ? fare.fast : undefined;
  res.json({ src, dst, srcName: getStationName(src), dstName: getStationName(dst), price: normal, fast });
});

module.exports = router;