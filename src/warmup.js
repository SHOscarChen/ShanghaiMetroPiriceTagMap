const { getAllPrices } = require('./services/metroApi');
const { getStations, getStationName } = require('./services/stationData');
const cache = require('./services/cache');

// 线路到站点代码前缀的映射（按 1号线 开始顺序）
const LINE_PREFIXES = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '12', '13', '14', '15', '16', '17', '18',
  '41', '51'
];
const LINE_NAMES = {
  '01':'1号线','02':'2号线','03':'3号线','04':'4号线','05':'5号线','06':'6号线',
  '07':'7号线','08':'8号线','09':'9号线','10':'10号线','11':'11号线','12':'12号线',
  '13':'13号线','14':'14号线','15':'15号线','16':'16号线','17':'17号线','18':'18号线',
  '41':'浦江线','51':'市域机场线'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 按线路分组站点
function groupByLine(stations) {
  const groups = new Map();
  for (const prefix of LINE_PREFIXES) {
    const list = stations.filter((s) => s.code.startsWith(prefix));
    if (list.length) groups.set(prefix, list);
  }
  return groups;
}

async function processLine(prefix, stations, threshold, onProgress) {
  const name = LINE_NAMES[prefix] || prefix + '号线';
  let lineDone = 0;
  let lineFail = 0;
  let lineStart = Date.now();

  for (const s of stations) {
    // 跳过已完整缓存的站点（该站到全网所有非本站票价已存在）
    const cached = cache.getCachedPricesForOrigin(s.code);
    if (stations.every((x) => x.code === s.code || cached[x.code] !== undefined)) {
      lineDone++;
      onProgress && onProgress({ name, prefix, lineDone, lineTotal: stations.length, lineFail, skipped: true, code: s.code });
      continue;
    }

    const prices = await getAllPrices(s.code);
    lineDone++;
    const failCount = stations.filter((x) => x.code !== s.code && prices[x.code] === undefined).length;
    if (failCount) lineFail++;
    onProgress && onProgress({ name, prefix, lineDone, lineTotal: stations.length, lineFail, skipped: false, code: s.code, failCount });
    await sleep(100);
  }

  const elapsed = Math.round((Date.now() - lineStart) / 1000);
  return { name, lineDone, lineTotal: stations.length, lineFail, elapsed };
}

async function main() {
  const stations = getStations();
  const groups = groupByLine(stations);
  const totalStations = stations.length;
  let overallDone = 0;
  const t0 = Date.now();

  console.log('========================================');
  console.log('  上海地铁票价分批采集（按线路）');
  console.log('  现有本地票价: ' + cache.stats().totalPairs + ' 对');
  console.log('  站点总数: ' + totalStations);
  console.log('========================================\n');

  for (const [prefix, lineStations] of groups) {
    const stats = await processLine(prefix, lineStations, null, (p) => {
      const status = p.skipped ? '已缓存跳过' : `完成${p.lineDone}${p.lineFail?' 失败'+p.lineFail+':':' 全成功'}`;
      console.log(`  [${p.name}] ${p.code} ${getStationName(p.code)} ${status}`);
    });
    overallDone += stats.lineDone;
    console.log(`\n>>> ${stats.name} 完成: ${stats.lineDone}/${stats.lineTotal} 站，失败 ${stats.lineFail}，耗时 ${stats.elapsed}s\n`);
  }

  const totalElapsed = Math.round((Date.now() - t0) / 60000);
  console.log('========================================');
  console.log('全部线路采集完成！');
  console.log('处理站点: ' + overallDone + '/' + totalStations);
  console.log('本地票价对总数: ' + cache.stats().totalPairs);
  console.log('数据已永久保存到 data/fares.json');
  console.log('========================================');
}

main().catch(console.error);