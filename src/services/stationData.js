const fs = require('fs');
const path = require('path');

const stationsPath = path.join(__dirname, '../../data/stations.json');
const mapDataPath = path.join(__dirname, '../../data/mapData.json');

let stations = [];
let stationMap = {};
let mapData = null;

function loadStations() {
  const raw = fs.readFileSync(stationsPath, 'utf-8');
  stations = JSON.parse(raw);
  stationMap = {};
  for (const s of stations) {
    stationMap[s.code] = s.name;
  }
  return stations;
}

function loadMapData() {
  const raw = fs.readFileSync(mapDataPath, 'utf-8');
  mapData = JSON.parse(raw);
  return mapData;
}

function getStations() {
  if (stations.length === 0) loadStations();
  return stations;
}

function getStationName(code) {
  if (!stationMap[code]) {
    if (stations.length === 0) loadStations();
  }
  return stationMap[code] || code;
}

function getMapData() {
  if (!mapData) loadMapData();
  return mapData;
}

module.exports = { getStations, getStationName, getMapData };