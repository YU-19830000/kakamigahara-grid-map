// ============================================================
// 各務原市 1kmグリッドマップ
// 工程9：スプレッドシート読み込み・同期対応版
// ============================================================

const DATA_PATHS = {
  boundary: "./data/kakamigahara_boundary.geojson",
  grid: "./data/kakamigahara_grid.geojson",
};

const INITIAL_VIEW = {
  center: [35.41, 136.86],
  zoom: 12,
};

const STORAGE_KEY = "kakamigahara_grid_markers_v1";

const SHEET_API = {
  url: "https://script.google.com/macros/s/AKfycbzQ4-9u06FhgpoDrjimsgEPG3vG9aqvGpV6vkl1fpiLB37-vgmkDkKppK4-wDGV83vd/exec",
  token: "kakamigahara-grid-v1",
};

const loadStatusEl = document.getElementById("loadStatus");
const gridCountEl = document.getElementById("gridCount");
const markerCountEl = document.getElementById("markerCount");
const syncStatusEl = document.getElementById("syncStatus");
const locateButtonEl = document.getElementById("locateButton");
const markerListButtonEl = document.getElementById("markerListButton");
const syncButtonEl = document.getElementById("syncButton");
const saveMarkerButtonEl = document.getElementById("saveMarkerButton");

const markerModalEl = document.getElementById("markerModal");
const modalBackdropEl = document.getElementById("modalBackdrop");
const closeModalButtonEl = document.getElementById("closeModalButton");
const cancelMarkerButtonEl = document.getElementById("cancelMarkerButton");
const markerFormEl = document.getElementById("markerForm");

const markerLatEl = document.getElementById("markerLat");
const markerLngEl = document.getElementById("markerLng");
const markerLatTextEl = document.getElementById("markerLatText");
const markerLngTextEl = document.getElementById("markerLngText");
const markerTypeEl = document.getElementById("markerType");
const markerUserNameEl = document.getElementById("markerUserName");
const markerGridIdEl = document.getElementById("markerGridId");
const markerAreaNameEl = document.getElementById("markerAreaName");
const markerStatusEl = document.getElementById("markerStatus");
const markerMemoEl = document.getElementById("markerMemo");

const listModalEl = document.getElementById("listModal");
const listModalBackdropEl = document.getElementById("listModalBackdrop");
const closeListModalButtonEl = document.getElementById("closeListModalButton");
const markerListEl = document.getElementById("markerList");
const clearMarkersButtonEl = document.getElementById("clearMarkersButton");
const exportJsonButtonEl = document.getElementById("exportJsonButton");

let currentLocationMarker = null;
let currentLocationCircle = null;
let gridLayer = null;
let boundaryLayer = null;
let markerLayerGroup = null;
let loadedGridGeoJson = null;
let markers = [];

// ------------------------------------------------------------
// 共通関数
// ------------------------------------------------------------

function setStatus(text, type) {
  if (!loadStatusEl) return;

  loadStatusEl.textContent = text;
  loadStatusEl.classList.remove("ok", "error");

  if (type === "ok") {
    loadStatusEl.classList.add("ok");
  }

  if (type === "error") {
    loadStatusEl.classList.add("error");
  }
}

function setSyncStatus(text) {
  if (syncStatusEl) {
    syncStatusEl.textContent = `同期：${text}`;
  }
}

function formatPercent(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }

  return `${Math.round(Number(value) * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(isoString) {
  if (!isoString) return "-";

  const date = new Date(isoString);

  if (Number.isNaN(date.getTime())) return isoString;

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");

  return `${y}/${m}/${d} ${hh}:${mm}`;
}

async function loadGeoJson(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`GeoJSONの読み込みに失敗しました: ${path}`);
  }

  return await response.json();
}

// ------------------------------------------------------------
// JSONP読み込み
// ------------------------------------------------------------

function loadJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonpCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${separator}callback=${encodeURIComponent(callbackName)}`;

    const script = document.createElement("script");
    script.src = fullUrl;
    script.async = true;

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("JSONP読み込みがタイムアウトしました。"));
    }, 15000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      delete window[callbackName];

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP読み込みに失敗しました。"));
    };

    document.body.appendChild(script);
  });
}

// ------------------------------------------------------------
// 地図初期化
// ------------------------------------------------------------

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true,
}).setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);

L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution:
    '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
}).addTo(map);

L.control.scale({
  metric: true,
  imperial: false,
  position: "bottomleft",
}).addTo(map);

markerLayerGroup = L.layerGroup().addTo(map);

// ------------------------------------------------------------
// レイヤ作成
// ------------------------------------------------------------

function createBoundaryLayer(boundaryGeoJson) {
  return L.geoJSON(boundaryGeoJson, {
    style: {
      color: "#0057b8",
      weight: 3,
      opacity: 0.95,
      fillOpacity: 0,
    },
    onEachFeature: (feature, layer) => {
      layer.bindPopup(`
        <div class="popup-title">各務原市境界</div>
        <div class="popup-row">対象：岐阜県各務原市</div>
      `);
    },
  });
}

function createGridLayer(gridGeoJson) {
  return L.geoJSON(gridGeoJson, {
    style: {
      color: "#c92a2a",
      weight: 1,
      opacity: 0.9,
      fillColor: "#ff6b6b",
      fillOpacity: 0.25,
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};

      const gridId = props.grid_id || "-";
      const coverageRatio = formatPercent(props.coverage_ratio);
      const centroidLat = props.centroid_lat ?? "-";
      const centroidLng = props.centroid_lng ?? "-";

      layer.on("click", (event) => {
        if (event.originalEvent) {
          L.DomEvent.stop(event.originalEvent);
        }

        openMarkerModal(event.latlng.lat, event.latlng.lng);
      });

      layer.on("mouseover", () => {
        layer.setStyle({
          weight: 2,
          fillOpacity: 0.42,
        });
      });

      layer.on("mouseout", () => {
        if (gridLayer) {
          gridLayer.resetStyle(layer);
        }
      });

      layer.on("contextmenu", (event) => {
        if (event.originalEvent) {
          L.DomEvent.stop(event.originalEvent);
        }

        layer
          .bindPopup(`
            <div class="popup-title">${escapeHtml(gridId)}</div>
            <div class="popup-row">グリッドサイズ：1km × 1km</div>
            <div class="popup-row">市域重なり率：${escapeHtml(coverageRatio)}</div>
            <div class="popup-row">中心緯度：${escapeHtml(centroidLat)}</div>
            <div class="popup-row">中心経度：${escapeHtml(centroidLng)}</div>
          `)
          .openPopup(event.latlng);
      });
    },
  });
}

// ------------------------------------------------------------
// 現在地
// ------------------------------------------------------------

function locateCurrentPosition() {
  if (!navigator.geolocation) {
    alert("このブラウザでは現在地機能が使えません。");
    return;
  }

  locateButtonEl.disabled = true;
  locateButtonEl.textContent = "測位中...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      const latlng = [lat, lng];

      if (currentLocationMarker) {
        currentLocationMarker.setLatLng(latlng);
      } else {
        currentLocationMarker = L.marker(latlng).addTo(map);
      }

      currentLocationMarker
        .bindPopup(`
          <div class="popup-title">現在地</div>
          <div class="popup-row">緯度：${lat.toFixed(6)}</div>
          <div class="popup-row">経度：${lng.toFixed(6)}</div>
          <div class="popup-row">精度：約${Math.round(accuracy)}m</div>
        `)
        .openPopup();

      if (currentLocationCircle) {
        currentLocationCircle.setLatLng(latlng);
        currentLocationCircle.setRadius(accuracy);
      } else {
        currentLocationCircle = L.circle(latlng, {
          radius: accuracy,
          color: "#1971c2",
          weight: 1,
          fillColor: "#74c0fc",
          fillOpacity: 0.2,
        }).addTo(map);
      }

      map.setView(latlng, 16);

      locateButtonEl.disabled = false;
      locateButtonEl.textContent = "現在地";
    },
    (error) => {
      console.error(error);

      let message = "現在地を取得できませんでした。";

      if (error.code === error.PERMISSION_DENIED) {
        message =
          "位置情報の利用が許可されていません。Safariの設定で位置情報を許可してください。";
      }

      if (error.code === error.POSITION_UNAVAILABLE) {
        message =
          "現在地情報を取得できませんでした。屋外や窓際で再度試してください。";
      }

      if (error.code === error.TIMEOUT) {
        message = "現在地取得がタイムアウトしました。再度試してください。";
      }

      alert(message);

      locateButtonEl.disabled = false;
      locateButtonEl.textContent = "現在地";
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

// ------------------------------------------------------------
// 点がグリッド内か判定する処理
// ------------------------------------------------------------

function pointInRing(pointLngLat, ring) {
  const x = pointLngLat[0];
  const y = pointLngLat[1];

  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

function pointInPolygon(pointLngLat, polygonCoordinates) {
  if (!polygonCoordinates || polygonCoordinates.length === 0) return false;

  const outerRing = polygonCoordinates[0];

  if (!pointInRing(pointLngLat, outerRing)) {
    return false;
  }

  for (let i = 1; i < polygonCoordinates.length; i++) {
    if (pointInRing(pointLngLat, polygonCoordinates[i])) {
      return false;
    }
  }

  return true;
}

function findGridIdByLatLng(lat, lng) {
  if (!loadedGridGeoJson || !Array.isArray(loadedGridGeoJson.features)) {
    return "";
  }

  const point = [lng, lat];

  for (const feature of loadedGridGeoJson.features) {
    const geometry = feature.geometry;
    const props = feature.properties || {};

    if (!geometry) continue;

    if (geometry.type === "Polygon") {
      if (pointInPolygon(point, geometry.coordinates)) {
        return props.grid_id || "";
      }
    }

    if (geometry.type === "MultiPolygon") {
      for (const polygonCoordinates of geometry.coordinates) {
        if (pointInPolygon(point, polygonCoordinates)) {
          return props.grid_id || "";
        }
      }
    }
  }

  return "";
}

// ------------------------------------------------------------
// マーキング保存・表示
// ------------------------------------------------------------

function getMarkerClass(type) {
  switch (type) {
    case "通信可":
      return "ok";
    case "通信不安定":
      return "unstable";
    case "通信不可":
      return "ng";
    case "要確認":
      return "check";
    case "危険箇所":
      return "danger";
    default:
      return "check";
  }
}

function createMarkerIcon(type) {
  const className = getMarkerClass(type);

  return L.divIcon({
    html: `<div class="marker-icon ${className}"></div>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
  });
}

function makeMarkerPopup(marker) {
  return `
    <div class="popup-title">${escapeHtml(marker.type)}</div>
    <div class="popup-row">ID：${escapeHtml(marker.id)}</div>
    <div class="popup-row">日時：${escapeHtml(formatDateTime(marker.created_at))}</div>
    <div class="popup-row">登録者：${escapeHtml(marker.user_name || "-")}</div>
    <div class="popup-row">グリッド：${escapeHtml(marker.grid_id || "範囲外")}</div>
    <div class="popup-row">地区名：${escapeHtml(marker.area_name || "-")}</div>
    <div class="popup-row">状況：${escapeHtml(marker.status || "-")}</div>
    <div class="popup-row">緯度：${escapeHtml(Number(marker.lat).toFixed(6))}</div>
    <div class="popup-row">経度：${escapeHtml(Number(marker.lng).toFixed(6))}</div>
    <div class="popup-row">メモ：<br>${escapeHtml(marker.memo || "-")}</div>
  `;
}

function renderMarkers() {
  markerLayerGroup.clearLayers();

  for (const marker of markers) {
    const leafletMarker = L.marker([marker.lat, marker.lng], {
      icon: createMarkerIcon(marker.type),
    });

    leafletMarker.bindPopup(makeMarkerPopup(marker));
    leafletMarker.addTo(markerLayerGroup);
  }

  updateMarkerCount();
  renderMarkerList();
}

function updateMarkerCount() {
  if (markerCountEl) {
    markerCountEl.textContent = `記録数：${markers.length}`;
  }
}

function saveMarkersToLocalStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
}

function loadMarkersFromLocalStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    markers = [];
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    markers = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(error);
    markers = [];
  }
}

function mergeMarkersById(baseMarkers, incomingMarkers) {
  const mapById = new Map();

  for (const marker of baseMarkers) {
    if (marker && marker.id) {
      mapById.set(marker.id, marker);
    }
  }

  for (const marker of incomingMarkers) {
    if (marker && marker.id) {
      mapById.set(marker.id, marker);
    }
  }

  return Array.from(mapById.values()).sort((a, b) => {
    return String(a.created_at).localeCompare(String(b.created_at));
  });
}

async function sendMarkerToSheet(marker) {
  if (!SHEET_API.url || SHEET_API.url.includes("ここにGAS")) {
    console.warn("GAS WebアプリURLが未設定です。");
    return {
      ok: false,
      message: "GAS WebアプリURL未設定",
    };
  }

  const payload = {
    action: "saveMarker",
    token: SHEET_API.token,
    marker: marker,
  };

  try {
    await fetch(SHEET_API.url, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    return {
      ok: true,
      message: "送信しました。スプレッドシート側で確認してください。",
    };
  } catch (error) {
    console.error(error);

    return {
      ok: false,
      message:
        "送信に失敗しました。ネットワークまたはGAS URLを確認してください。",
    };
  }
}

async function loadMarkersFromSheet() {
  if (!SHEET_API.url || SHEET_API.url.includes("ここにGAS")) {
    throw new Error("GAS WebアプリURLが未設定です。");
  }

  const url =
    `${SHEET_API.url}?action=listMarkers` +
    `&token=${encodeURIComponent(SHEET_API.token)}` +
    `&v=${Date.now()}`;

  const data = await loadJsonp(url);

  if (!data || !data.ok) {
    throw new Error(data && data.error ? data.error : "markersの読み込みに失敗しました。");
  }

  return Array.isArray(data.markers) ? data.markers : [];
}

async function syncMarkersFromSheet(options = {}) {
  const silent = Boolean(options.silent);

  try {
    if (syncButtonEl) {
      syncButtonEl.disabled = true;
      syncButtonEl.textContent = "同期中...";
    }

    setSyncStatus("同期中");

    const sheetMarkers = await loadMarkersFromSheet();

    markers = mergeMarkersById(markers, sheetMarkers);
    saveMarkersToLocalStorage();
    renderMarkers();

    setSyncStatus(`${sheetMarkers.length}件読込`);

    if (!silent) {
      alert(`スプレッドシートから${sheetMarkers.length}件を読み込みました。`);
    }

  } catch (error) {
    console.error(error);
    setSyncStatus("失敗");

    if (!silent) {
      alert(
        "スプレッドシートからの読み込みに失敗しました。\n\n" +
        String(error && error.message ? error.message : error)
      );
    }

  } finally {
    if (syncButtonEl) {
      syncButtonEl.disabled = false;
      syncButtonEl.textContent = "同期";
    }
  }
}

function renderMarkerList() {
  if (!markerListEl) return;

  if (markers.length === 0) {
    markerListEl.textContent = "記録はまだありません。";
    return;
  }

  const sorted = [...markers].sort((a, b) => {
    return String(b.created_at).localeCompare(String(a.created_at));
  });

  markerListEl.innerHTML = sorted
    .map((marker) => {
      return `
        <article class="marker-list-item">
          <div class="marker-list-title">
            ${escapeHtml(marker.type)} / ${escapeHtml(marker.grid_id || "範囲外")}
          </div>
          <div class="marker-list-meta">
            ID：${escapeHtml(marker.id)}<br>
            日時：${escapeHtml(formatDateTime(marker.created_at))}<br>
            登録者：${escapeHtml(marker.user_name || "-")}<br>
            地区名：${escapeHtml(marker.area_name || "-")}<br>
            状況：${escapeHtml(marker.status || "-")}<br>
            緯度経度：${Number(marker.lat).toFixed(6)}, ${Number(marker.lng).toFixed(6)}
          </div>
          <div class="marker-list-memo">${escapeHtml(marker.memo || "")}</div>
        </article>
      `;
    })
    .join("");
}

function openMarkerModal(lat, lng) {
  const gridId = findGridIdByLatLng(lat, lng);

  markerLatEl.value = String(lat);
  markerLngEl.value = String(lng);
  markerLatTextEl.textContent = lat.toFixed(6);
  markerLngTextEl.textContent = lng.toFixed(6);

  markerGridIdEl.value = gridId || "範囲外";

  markerTypeEl.value = "通信不安定";
  markerAreaNameEl.value = "";
  markerStatusEl.value = "未対応";
  markerMemoEl.value = "";

  markerModalEl.classList.remove("hidden");
  markerModalEl.setAttribute("aria-hidden", "false");

  setTimeout(() => {
    markerTypeEl.focus();
  }, 50);
}

function closeMarkerModal() {
  markerModalEl.classList.add("hidden");
  markerModalEl.setAttribute("aria-hidden", "true");
}

function openListModal() {
  renderMarkerList();
  listModalEl.classList.remove("hidden");
  listModalEl.setAttribute("aria-hidden", "false");
}

function closeListModal() {
  listModalEl.classList.add("hidden");
  listModalEl.setAttribute("aria-hidden", "true");
}

async function handleMarkerSubmit(event) {
  event.preventDefault();

  const lat = Number(markerLatEl.value);
  const lng = Number(markerLngEl.value);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    alert("緯度経度が不正です。もう一度地図をタップしてください。");
    return;
  }

  if (saveMarkerButtonEl) {
    saveMarkerButtonEl.disabled = true;
    saveMarkerButtonEl.textContent = "保存中...";
  }

  const now = new Date();
  const id = `M-${now.getTime()}`;

  const marker = {
    id,
    created_at: now.toISOString(),
    user_name: markerUserNameEl.value.trim(),
    type: markerTypeEl.value,
    lat,
    lng,
    grid_id: markerGridIdEl.value === "範囲外" ? "" : markerGridIdEl.value,
    area_name: markerAreaNameEl.value.trim(),
    memo: markerMemoEl.value.trim(),
    status: markerStatusEl.value,
    photo_url: "",
  };

  markers.push(marker);
  saveMarkersToLocalStorage();
  renderMarkers();
  closeMarkerModal();

  const result = await sendMarkerToSheet(marker);

  if (saveMarkerButtonEl) {
    saveMarkerButtonEl.disabled = false;
    saveMarkerButtonEl.textContent = "登録する";
  }

  if (result.ok) {
    alert(
      "マーキングを登録しました。\n\n" +
      "ブラウザ内に保存し、スプレッドシートへ送信しました。"
    );
  } else {
    alert(
      "マーキングをブラウザ内に保存しました。\n\n" +
      "ただし、スプレッドシート送信は未完了です。\n" +
      result.message
    );
  }
}

function clearAllMarkers() {
  if (markers.length === 0) {
    alert("削除する記録がありません。");
    return;
  }

  const ok = confirm(
    "このブラウザ内に一時保存されているマーキングをすべて削除します。\n" +
    "スプレッドシートの記録は削除されません。\n\n" +
    "よろしいですか？"
  );

  if (!ok) return;

  markers = [];
  saveMarkersToLocalStorage();
  renderMarkers();
  setSyncStatus("端末内削除");
}

function showJsonForDebug() {
  if (markers.length === 0) {
    alert("記録はまだありません。");
    return;
  }

  const json = JSON.stringify(markers, null, 2);
  console.log(json);
  alert("ConsoleにJSONを出力しました。Macのブラウザで検証 > Consoleを確認してください。");
}

// ------------------------------------------------------------
// 初期処理
// ------------------------------------------------------------

async function main() {
  try {
    setStatus("読込中", "");

    const [boundaryGeoJson, gridGeoJson] = await Promise.all([
      loadGeoJson(DATA_PATHS.boundary),
      loadGeoJson(DATA_PATHS.grid),
    ]);

    loadedGridGeoJson = gridGeoJson;

    boundaryLayer = createBoundaryLayer(boundaryGeoJson).addTo(map);
    gridLayer = createGridLayer(gridGeoJson).addTo(map);

    const gridCount = gridGeoJson.features ? gridGeoJson.features.length : 0;

    if (gridCountEl) {
      gridCountEl.textContent = `グリッド数：${gridCount}`;
    }

    map.fitBounds(boundaryLayer.getBounds(), {
      padding: [20, 20],
    });

    const baseLayers = {};
    const overlayLayers = {
      "各務原市境界": boundaryLayer,
      "1kmグリッド": gridLayer,
      "マーキング": markerLayerGroup,
    };

    L.control.layers(baseLayers, overlayLayers, {
      collapsed: false,
      position: "topright",
    }).addTo(map);

    loadMarkersFromLocalStorage();
    renderMarkers();

    setStatus("読込完了", "ok");

    // 起動時にスプレッドシートから静かに同期する
    syncMarkersFromSheet({ silent: true });

  } catch (error) {
    console.error(error);
    setStatus("エラー", "error");

    alert(
      "地図データの読み込みに失敗しました。\n\n" +
        "確認してください：\n" +
        "1. Live Serverで開いているか\n" +
        "2. web/data内にGeoJSONがあるか\n" +
        "3. ファイル名が正しいか\n\n" +
        "詳細はブラウザのConsoleを確認してください。"
    );
  }
}

// ------------------------------------------------------------
// イベント登録
// ------------------------------------------------------------

if (locateButtonEl) {
  locateButtonEl.addEventListener("click", locateCurrentPosition);
}

if (markerListButtonEl) {
  markerListButtonEl.addEventListener("click", openListModal);
}

if (syncButtonEl) {
  syncButtonEl.addEventListener("click", () => {
    syncMarkersFromSheet({ silent: false });
  });
}

if (closeModalButtonEl) {
  closeModalButtonEl.addEventListener("click", closeMarkerModal);
}

if (cancelMarkerButtonEl) {
  cancelMarkerButtonEl.addEventListener("click", closeMarkerModal);
}

if (modalBackdropEl) {
  modalBackdropEl.addEventListener("click", closeMarkerModal);
}

if (markerFormEl) {
  markerFormEl.addEventListener("submit", handleMarkerSubmit);
}

if (closeListModalButtonEl) {
  closeListModalButtonEl.addEventListener("click", closeListModal);
}

if (listModalBackdropEl) {
  listModalBackdropEl.addEventListener("click", closeListModal);
}

if (clearMarkersButtonEl) {
  clearMarkersButtonEl.addEventListener("click", clearAllMarkers);
}

if (exportJsonButtonEl) {
  exportJsonButtonEl.addEventListener("click", showJsonForDebug);
}

map.on("click", (event) => {
  if (!event || !event.latlng) return;

  const lat = event.latlng.lat;
  const lng = event.latlng.lng;

  openMarkerModal(lat, lng);
});

main();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        console.log("Service Worker registered:", registration.scope);
      })
      .catch((error) => {
        console.warn("Service Worker registration failed:", error);
      });
  });
}