(() => {
  const EARTH_RADIUS_METERS = 6371008.8;
  const TILE_SIZE = 256;
  const CLICK_MOVE_TOLERANCE_PX = 6;
  const rootId = "gmor-root";
  const canvasId = "gmor-canvas";
  const toolId = "gmor-tool";
  const unitStorageKey = "gmor-unit-system";
  const fallbackMessages = {
    oldRuler: "Regla vieja",
    clickHint: "Clic para puntos, arrastra/zoom normal.",
    activate: "Activar",
    pause: "Pausar",
    undo: "Deshacer",
    clear: "Limpiar",
    statusStart: "Activa la regla para empezar.",
    statusGeo: "Distancia con coordenadas del mapa.",
    statusApprox: "Distancia aproximada.",
    statusEnabledSuffix: "El mapa conserva arrastre y zoom.",
    statusPaused: "Pausada. Tus puntos se quedan visibles.",
    segment: "Segmento $1",
    metric: "Metrico",
    imperial: "Imperial",
    unitsTitle: "Unidades de distancia",
    credit: "Por Hsilamot",
  };

  if (document.getElementById(rootId)) {
    return;
  }

  const state = {
    enabled: false,
    points: [],
    screenPoints: [],
    pointerDown: null,
    lastView: null,
    lastKnownView: null,
    lastMetersPerPixel: null,
    measurementMode: "geo",
    unitSystem: getInitialUnitSystem(),
  };

  const toolButton = document.createElement("button");
  toolButton.className = "gmor-tool";
  toolButton.id = toolId;
  toolButton.type = "button";
  toolButton.title = t("oldRuler");
  toolButton.innerHTML = `
    <span class="gmor-tool-icon" aria-hidden="true"></span>
    <span data-i18n="oldRuler">${t("oldRuler")}</span>
  `;

  const root = document.createElement("div");
  root.className = "gmor-root";
  root.id = rootId;
  root.innerHTML = `
    <div class="gmor-panel">
      <div class="gmor-row">
        <div>
          <div class="gmor-title">Regla vieja</div>
          <div class="gmor-meta" data-i18n="clickHint">Clic para puntos, arrastra/zoom normal.</div>
        </div>
        <div class="gmor-total" data-total>0 m</div>
      </div>
      <div class="gmor-actions">
        <button class="gmor-button" type="button" data-toggle>Pausar</button>
        <button class="gmor-button" type="button" data-undo>Deshacer</button>
        <button class="gmor-button" type="button" data-clear data-danger="true">Limpiar</button>
      </div>
      <div class="gmor-unit-toggle" role="group" aria-label="Unidades de distancia" data-units>
        <button class="gmor-unit-button" type="button" data-unit="metric">Metrico</button>
        <button class="gmor-unit-button" type="button" data-unit="imperial">Imperial</button>
      </div>
      <div class="gmor-meta" data-status>Activa la regla para empezar.</div>
      <div class="gmor-segments" data-segments></div>
      <div class="gmor-credit" data-i18n="credit">Por Hsilamot</div>
    </div>
  `;

  const canvas = document.createElement("canvas");
  canvas.className = "gmor-canvas";
  canvas.id = canvasId;

  document.documentElement.append(canvas, toolButton, root);

  const ctx = canvas.getContext("2d");
  const totalNode = root.querySelector("[data-total]");
  const statusNode = root.querySelector("[data-status]");
  const segmentsNode = root.querySelector("[data-segments]");
  const toggleButton = root.querySelector("[data-toggle]");
  const undoButton = root.querySelector("[data-undo]");
  const clearButton = root.querySelector("[data-clear]");
  const unitButtons = [...root.querySelectorAll("[data-unit]")];

  applyTranslations();

  toolButton.addEventListener("click", toggleRuler);
  toggleButton.addEventListener("click", toggleRuler);

  undoButton.addEventListener("click", () => {
    state.points.pop();
    state.screenPoints.pop();
    render();
  });

  clearButton.addEventListener("click", () => {
    state.points = [];
    state.screenPoints = [];
    render();
  });

  unitButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.unitSystem = button.dataset.unit === "imperial" ? "imperial" : "metric";
      localStorage.setItem(unitStorageKey, state.unitSystem);
      render();
    });
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!state.enabled || isExtensionUi(event.target) || event.button !== 0) {
        return;
      }

      state.pointerDown = {
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
        time: Date.now(),
      };
    },
    true
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (!state.enabled || !state.pointerDown || isExtensionUi(event.target)) {
        return;
      }

      const pointerDown = state.pointerDown;
      const totalMove = Math.hypot(event.clientX - pointerDown.startX, event.clientY - pointerDown.startY);
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;

      pointerDown.x = event.clientX;
      pointerDown.y = event.clientY;

      if (totalMove <= CLICK_MOVE_TOLERANCE_PX) {
        return;
      }

      pointerDown.dragging = true;
      if (!getMapView() && state.screenPoints.length > 0) {
        shiftApproximateRoute(dx, dy);
        render();
      }
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!state.enabled || isExtensionUi(event.target) || event.button !== 0) {
        return;
      }

      const pointerDown = state.pointerDown;
      state.pointerDown = null;

      if (!pointerDown) {
        return;
      }

      const moved = distancePixels(pointerDown, event) > CLICK_MOVE_TOLERANCE_PX;
      if (moved || pointerDown.dragging) {
        return;
      }

      const view = getMapView();
      if (view && !isInsideMapViewport(event.clientX, event.clientY, view)) {
        return;
      }

      state.screenPoints.push({ x: event.clientX, y: event.clientY });
      state.points.push(view ? screenToLatLng(event.clientX, event.clientY, view) : null);
      render();
    },
    true
  );

  window.addEventListener("resize", render);
  window.addEventListener("popstate", render);
  setInterval(renderIfViewChanged, 500);
  setInterval(positionToolButton, 1000);

  render();
  positionToolButton();

  function renderIfViewChanged() {
    const view = getMapView();
    const key = view
      ? `${view.lat.toFixed(7)},${view.lng.toFixed(7)},${view.zoom.toFixed(3)},${Math.round(view.left)},${Math.round(view.top)},${Math.round(view.width)},${Math.round(view.height)}`
      : "";
    if (key !== state.lastView) {
      state.lastView = key;
      render();
    }
  }

  function toggleRuler() {
    state.enabled = !state.enabled;
    root.dataset.open = String(state.enabled || state.points.length > 0);
    render();
  }

  function render() {
    resizeCanvas();
    positionToolButton();
    root.dataset.open = String(state.enabled || state.points.length > 0);
    toolButton.dataset.active = String(state.enabled);
    toggleButton.dataset.active = String(state.enabled);
    toggleButton.textContent = state.enabled ? t("pause") : t("activate");
    unitButtons.forEach((button) => {
      button.dataset.active = String(button.dataset.unit === state.unitSystem);
    });

    const distances = getSegmentDistances();
    const total = distances.reduce((sum, distance) => sum + distance, 0);
    totalNode.textContent = formatDistance(total);

    const modeText = state.measurementMode === "geo" ? t("statusGeo") : t("statusApprox");
    statusNode.textContent = state.enabled
      ? `${modeText} ${t("statusEnabledSuffix")}`
      : t("statusPaused");

    segmentsNode.innerHTML = "";
    distances.forEach((distance, index) => {
      const row = document.createElement("div");
      row.className = "gmor-segment";
      row.innerHTML = `<span>${escapeHtml(t("segment", String(index + 1)))}</span><strong>${formatDistance(distance)}</strong>`;
      segmentsNode.append(row);
    });

    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const view = getMapView();
    if (state.points.length === 0) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const screenPoints = getDrawablePoints(view);
    const cumulativeDistances = getCumulativeDistances();

    ctx.save();
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#176b87";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
    ctx.shadowBlur = 4;

    if (screenPoints.length > 1) {
      ctx.beginPath();
      screenPoints.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    screenPoints.forEach((point, index) => {
      ctx.fillStyle = "#fffdf7";
      ctx.strokeStyle = "#0f4f66";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#0f4f66";
      ctx.font = "700 11px Arial, Helvetica, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), point.x, point.y);

      if (index > 0) {
        drawDistancePill(point, formatDistance(cumulativeDistances[index]));
      }
    });

    ctx.restore();
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  function getSegmentDistances() {
    const distances = [];
    for (let index = 1; index < state.points.length; index += 1) {
      const previous = state.points[index - 1];
      const current = state.points[index];
      if (previous && current) {
        distances.push(haversineDistance(previous, current));
        state.measurementMode = "geo";
      } else {
        distances.push(getApproximateScreenDistance(index - 1, index));
        state.measurementMode = "scale";
      }
    }
    return distances;
  }

  function getMapView() {
    const atMatch = location.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
    const viewport = getMapViewport();
    if (atMatch) {
      state.lastKnownView = {
        lat: Number(atMatch[1]),
        lng: Number(atMatch[2]),
        zoom: Number(atMatch[3]),
        ...viewport,
      };
      return state.lastKnownView;
    }

    const queryView = getQueryMapView();
    if (queryView) {
      state.lastKnownView = {
        ...queryView,
        ...viewport,
      };
      return state.lastKnownView;
    }

    const dataMatch = location.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (dataMatch && state.lastKnownView) {
      state.lastKnownView = {
        ...state.lastKnownView,
        lat: Number(dataMatch[1]),
        lng: Number(dataMatch[2]),
        ...viewport,
      };
      return state.lastKnownView;
    }

    return state.lastKnownView ? { ...state.lastKnownView, ...viewport } : null;
  }

  function screenToLatLng(x, y, view) {
    const scale = TILE_SIZE * 2 ** view.zoom;
    const center = project(view.lat, view.lng, scale);
    const worldX = center.x + x - (view.left + view.width / 2);
    const worldY = center.y + y - (view.top + view.height / 2);
    return unproject(worldX, worldY, scale);
  }

  function latLngToScreen(lat, lng, view) {
    const scale = TILE_SIZE * 2 ** view.zoom;
    const center = project(view.lat, view.lng, scale);
    const point = project(lat, lng, scale);
    return {
      x: point.x - center.x + view.left + view.width / 2,
      y: point.y - center.y + view.top + view.height / 2,
    };
  }

  function project(lat, lng, scale) {
    const sinLat = Math.sin((lat * Math.PI) / 180);
    return {
      x: ((lng + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
    };
  }

  function unproject(x, y, scale) {
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lng };
  }

  function haversineDistance(a, b) {
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function formatDistance(meters) {
    if (state.unitSystem === "imperial") {
      const feet = meters * 3.280839895;
      const miles = meters / 1609.344;

      if (feet < 1000) {
        return `${Math.round(feet)} ft`;
      }

      if (miles < 100) {
        return `${miles.toFixed(2)} mi`;
      }

      return `${Math.round(miles).toLocaleString()} mi`;
    }

    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }

    if (meters < 100000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }

    return `${Math.round(meters / 1000).toLocaleString()} km`;
  }

  function getDrawablePoints(view) {
    if (!view) {
      return state.screenPoints;
    }

    return state.points.map((point, index) => {
      if (!point) {
        return state.screenPoints[index];
      }

      return latLngToScreen(point.lat, point.lng, view);
    });
  }

  function getCumulativeDistances() {
    let total = 0;
    return [0, ...getSegmentDistances().map((distance) => {
      total += distance;
      return total;
    })];
  }

  function getApproximateScreenDistance(fromIndex, toIndex) {
    const from = state.screenPoints[fromIndex];
    const to = state.screenPoints[toIndex];
    const metersPerPixel = getMetersPerPixelFromScale();

    if (!from || !to || !metersPerPixel) {
      return 0;
    }

    return Math.hypot(from.x - to.x, from.y - to.y) * metersPerPixel;
  }

  function getMetersPerPixelFromScale() {
    const candidates = [...document.querySelectorAll("div, span")]
      .map((node) => ({ node, text: node.textContent ? node.textContent.trim() : "" }))
      .filter(({ text }) => /^\d+(?:\.\d+)?\s*(m|km|ft|mi)$/i.test(text));

    for (const candidate of candidates) {
      const rect = candidate.node.getBoundingClientRect();
      const parentRect = candidate.node.parentElement
        ? candidate.node.parentElement.getBoundingClientRect()
        : rect;
      const width = parentRect.width > rect.width && parentRect.width < 300 ? parentRect.width : rect.width;
      if (width < 20 || width > 300 || rect.height > 28) {
        continue;
      }

      const meters = parseScaleText(candidate.text);
      if (meters) {
        state.lastMetersPerPixel = meters / width;
        return state.lastMetersPerPixel;
      }
    }

    if (state.lastMetersPerPixel) {
      return state.lastMetersPerPixel;
    }

    const view = getMapView();
    if (view) {
      const metersPerPixel =
        (Math.cos(toRadians(view.lat)) * 2 * Math.PI * 6378137) / (TILE_SIZE * 2 ** view.zoom);
      state.lastMetersPerPixel = metersPerPixel;
      return metersPerPixel;
    }

    state.lastMetersPerPixel = 1;
    return state.lastMetersPerPixel;
  }

  function parseScaleText(text) {
    const match = text.match(/^(\d+(?:\.\d+)?)\s*(m|km|ft|mi)$/i);
    if (!match) {
      return null;
    }

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();

    if (unit === "m") return value;
    if (unit === "km") return value * 1000;
    if (unit === "ft") return value * 0.3048;
    if (unit === "mi") return value * 1609.344;
    return null;
  }

  function getQueryMapView() {
    const urlView = parseQueryMapView(location.href);
    if (urlView) {
      return urlView;
    }

    const metaUrl = document.querySelector('meta[itemprop="url"], meta[property="og:url"]');
    if (metaUrl && metaUrl.content) {
      return parseQueryMapView(metaUrl.content);
    }

    return null;
  }

  function parseQueryMapView(url) {
    let parsed;
    try {
      parsed = new URL(url, location.href);
    } catch (error) {
      return null;
    }

    const ll = parsed.searchParams.get("ll");
    const zoom = Number(parsed.searchParams.get("z"));
    if (!ll || !Number.isFinite(zoom)) {
      return null;
    }

    const [lat, lng] = ll.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return { lat, lng, zoom };
  }

  function getMapViewport() {
    const candidates = [...document.querySelectorAll(".gm-style")]
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 300 && rect.height > 300);

    if (candidates.length === 0) {
      return {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }

    const rect = candidates.reduce(
      (largest, current) => (current.width * current.height > largest.width * largest.height ? current : largest),
      candidates[0]
    );

    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function isInsideMapViewport(x, y, view) {
    return x >= view.left && x <= view.left + view.width && y >= view.top && y <= view.top + view.height;
  }

  function drawDistancePill(point, label) {
    const paddingX = 8;
    const height = 24;
    ctx.font = "700 12px Arial, Helvetica, sans-serif";
    const width = Math.ceil(ctx.measureText(label).width) + paddingX * 2;
    const x = point.x + 10;
    const y = point.y - 26;
    const radius = 12;

    ctx.fillStyle = "#4f86f7";
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width / 2, y + height / 2);
  }

  function distancePixels(a, b) {
    return Math.hypot(a.startX - b.clientX, a.startY - b.clientY);
  }

  function isExtensionUi(target) {
    return target instanceof Element && Boolean(target.closest(`#${rootId}, #${toolId}`));
  }

  function shiftApproximateRoute(dx, dy) {
    state.screenPoints = state.screenPoints.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    }));
  }

  function positionToolButton() {
    const controls = [...document.querySelectorAll('button, [role="button"]')]
      .filter((node) => node instanceof HTMLElement && !node.closest(`#${rootId}, #${toolId}`))
      .map((node) => node.getBoundingClientRect())
      .filter(
        (rect) =>
          rect.width >= 20 &&
          rect.width <= 64 &&
          rect.height >= 20 &&
          rect.height <= 64 &&
          rect.top >= 40 &&
          rect.top <= 120 &&
          rect.left >= 150 &&
          rect.right <= window.innerWidth - 340
      );

    if (controls.length === 0) {
      toolButton.style.left = "420px";
      toolButton.style.top = "70px";
      return;
    }

    const rightmost = controls.reduce((best, rect) => (rect.right > best.right ? rect : best), controls[0]);
    toolButton.style.left = `${Math.round(rightmost.right + 8)}px`;
    toolButton.style.top = `${Math.round(rightmost.top)}px`;
  }

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function applyTranslations() {
    root.querySelector(".gmor-title").textContent = t("oldRuler");
    root.querySelector('[data-i18n="clickHint"]').textContent = t("clickHint");
    root.querySelector('[data-i18n="credit"]').textContent = t("credit");
    root.querySelector("[data-units]").setAttribute("aria-label", t("unitsTitle"));
    undoButton.textContent = t("undo");
    clearButton.textContent = t("clear");
    unitButtons.forEach((button) => {
      button.textContent = t(button.dataset.unit === "imperial" ? "imperial" : "metric");
      button.title = t("unitsTitle");
    });
    statusNode.textContent = t("statusStart");
  }

  function getInitialUnitSystem() {
    const saved = localStorage.getItem(unitStorageKey);
    if (saved === "metric" || saved === "imperial") {
      return saved;
    }

    return navigator.language && navigator.language.toLowerCase() === "en-us" ? "imperial" : "metric";
  }

  function t(key, substitution) {
    if (typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getMessage) {
      const translated = chrome.i18n.getMessage(key, substitution ? [substitution] : undefined);
      if (translated) {
        return translated;
      }
    }

    const fallback = fallbackMessages[key] || key;
    return substitution ? fallback.replace("$1", substitution) : fallback;
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => {
      if (char === "&") return "&amp;";
      if (char === "<") return "&lt;";
      if (char === ">") return "&gt;";
      if (char === '"') return "&quot;";
      return "&#39;";
    });
  }
})();
