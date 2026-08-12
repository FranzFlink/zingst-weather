/* Wetter Zingst — dashboard logic. Vanilla JS, no dependencies. */
(function () {
  "use strict";

  // ------------------------------------------------------------- config

  // Direction the open sea lies in, as seen from the beach (degrees).
  // Zingst's beach faces roughly north -> wind FROM ~0° is onshore,
  // wind FROM ~180° is offshore. Adjust here if needed.
  var SHORE_SEA_DIR = 0;

  var REFRESH_LATEST_S = 60;
  var REFRESH_HISTORY_S = 300;
  var STALE_AFTER_MIN = 30;   // station transfer batches can lag ~15 min

  // ------------------------------------------------------------- i18n

  var I18N = {
    de: {
      skip: "Zum Inhalt springen",
      tagline: "Live vom Messfeld · Leipziger Institut für Meteorologie",
      wind_now: "Wind jetzt",
      gusts_upto: "Böen bis",
      tile_gust: "Böen",
      tile_gust_sub: "3-Sekunden-Maximum, letzte 10 min",
      tile_temp: "Temperatur",
      tile_temp_sub: "akustisch gemessen (virtuell)",
      tile_max: "Max. Böe heute",
      tile_trend: "Tendenz",
      history: "Verlauf",
      legend_wind: "Wind (10-min-Mittel)",
      legend_peak: "Böen (1-min-Spitze)",
      table_toggle: "Daten als Tabelle",
      th_time: "Zeit", th_wind: "Wind", th_peak: "Spitze", th_dir: "Richtung",
      about_title: "Über die Station",
      about_text: "Die Daten stammen vom meteorologischen Messfeld Zingst des Leipziger Instituts für Meteorologie (Universität Leipzig), direkt an der Ostseeküste. Wind wird mit einem Ultraschall-Anemometer in rund 10 m Höhe gemessen und minütlich aktualisiert.",
      safety_text: "Bei ablandigem Wind (aus Süd) treiben SUP-Boards und Luftmatratzen aufs offene Meer – bitte besonders vorsichtig sein.",
      coming_soon: "Luftdruck, Regen und Sonnenstrahlung folgen in Kürze.",
      foot_operator: "Meteorologisches Messfeld Zingst · Leipziger Institut für Meteorologie · Universität Leipzig",
      disclaimer: "Alle Angaben ohne Gewähr. Die Daten sind Rohdaten einer Forschungsstation und ersetzen keine amtlichen Warnungen (z. B. des DWD).",
      updated: "Stand",
      onshore: "Auflandiger Wind", cross: "Seitenwind", offshore: "Ablandiger Wind – Vorsicht!",
      rising: "zunehmend", falling: "abnehmend", steady: "gleichbleibend",
      vs_hour: "gegenüber vor 1 Std.",
      at_time: "um {t} Uhr",
      stale: "Keine aktuellen Daten – letzte Messung: {t}",
      no_data: "Daten derzeit nicht verfügbar.",
      imprint: "Impressum & Datenschutz",
      contact: "Kontakt",
      map_sea: "Ostsee",
      map_beach: "Strand",
      map_tower: "Messturm",
      map_caption: "Der Messturm steht in den Dünen am Strandübergang 13",
      map_open: "Karte öffnen",
      freshness: "Messwert von {t} Uhr · 10-min-Mittel in ca. 10 m Höhe · aktualisiert sich automatisch",
      cardinals: ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
      compass_e: "O",
      lang_btn: "EN", lang_btn_aria: "Switch to English",
      day_short: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
    },
    en: {
      skip: "Skip to content",
      tagline: "Live from the field site · Leipzig Institute for Meteorology",
      wind_now: "Wind now",
      gusts_upto: "Gusts up to",
      tile_gust: "Gusts",
      tile_gust_sub: "3-second maximum, last 10 min",
      tile_temp: "Temperature",
      tile_temp_sub: "acoustic measurement (virtual)",
      tile_max: "Max gust today",
      tile_trend: "Trend",
      history: "History",
      legend_wind: "Wind (10-min mean)",
      legend_peak: "Gusts (1-min peak)",
      table_toggle: "Data as table",
      th_time: "Time", th_wind: "Wind", th_peak: "Peak", th_dir: "Direction",
      about_title: "About the station",
      about_text: "The data comes from the Zingst meteorological field site of the Leipzig Institute for Meteorology (Leipzig University), right on the Baltic Sea coast. Wind is measured with an ultrasonic anemometer at around 10 m height and updated every minute.",
      safety_text: "With offshore wind (from the south), SUP boards and inflatables drift out to open sea – please take extra care.",
      coming_soon: "Air pressure, rain and solar radiation coming soon.",
      foot_operator: "Zingst meteorological field site · Leipzig Institute for Meteorology · Leipzig University",
      disclaimer: "No warranty. This is raw data from a research station and does not replace official warnings (e.g. by the German Weather Service).",
      updated: "Updated",
      onshore: "Onshore wind", cross: "Cross-shore wind", offshore: "Offshore wind – take care!",
      rising: "increasing", falling: "decreasing", steady: "steady",
      vs_hour: "vs. one hour ago",
      at_time: "at {t}",
      stale: "No current data – last measurement: {t}",
      no_data: "Data currently unavailable.",
      imprint: "Imprint & privacy",
      contact: "Contact",
      map_sea: "Baltic Sea",
      map_beach: "Beach",
      map_tower: "Met tower",
      map_caption: "The met tower stands in the dunes at beach crossing 13",
      map_open: "Open map",
      freshness: "Reading from {t} · 10-min mean at approx. 10 m height · refreshes automatically",
      cardinals: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
      compass_e: "E",
      lang_btn: "DE", lang_btn_aria: "Auf Deutsch wechseln",
      day_short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    }
  };

  // ------------------------------------------------------------- state

  var state = {
    lang: localStorage.getItem("zw-lang") || "de",
    unit: localStorage.getItem("zw-unit") || "kmh",
    range: 24,
    latest: null,
    history: null
  };
  if (!I18N[state.lang]) state.lang = "de";
  if (["kn", "ms", "kmh"].indexOf(state.unit) < 0) state.unit = "kn";

  function t(key) { return I18N[state.lang][key] || I18N.de[key] || key; }

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------- units & formatting

  var UNITS = {
    kn: { label: "kn", factor: 1.943844, dec: 1 },
    ms: { label: "m/s", factor: 1, dec: 1 },
    kmh: { label: "km/h", factor: 3.6, dec: 0 }
  };

  function conv(ms) { return ms * UNITS[state.unit].factor; }

  function fmt(num, dec) {
    if (num == null || isNaN(num)) return "–";
    return num.toLocaleString(state.lang === "de" ? "de-DE" : "en-GB",
      { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function fmtSpeed(ms) { return fmt(conv(ms), UNITS[state.unit].dec); }

  function fmtTime(date) {
    return date.toLocaleTimeString(state.lang === "de" ? "de-DE" : "en-GB",
      { hour: "2-digit", minute: "2-digit" });
  }

  function beaufort(ms) {
    var th = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
    for (var b = 0; b < th.length; b++) if (ms < th[b]) return b;
    return 12;
  }

  function cardinal(deg) {
    return t("cardinals")[Math.round(deg / 22.5) % 16];
  }

  function angDist(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  // ------------------------------------------------------------- static i18n render

  function applyI18n() {
    document.documentElement.lang = state.lang;
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    $("langBtn").textContent = t("lang_btn");
    $("langBtn").setAttribute("aria-label", t("lang_btn_aria"));
    $("cardE").textContent = t("compass_e");
  }

  // ------------------------------------------------------------- hero + tiles

  function renderLatest() {
    var wind = state.latest && state.latest.wind;
    var banner = $("staleBanner");

    if (!wind) {
      $("windValue").textContent = "–";
      banner.hidden = false;
      $("staleText").textContent = t("no_data");
      return;
    }

    var until = new Date(wind.data_until);
    var ageMin = (Date.now() - until.getTime()) / 60000;
    var stale = ageMin > STALE_AFTER_MIN;
    banner.hidden = !stale;
    if (stale) $("staleText").textContent = t("stale").replace("{t}", fmtTime(until));

    $("windValue").textContent = fmtSpeed(wind.speed_ms);
    $("windUnitLabel").textContent = UNITS[state.unit].label;
    $("gustValue").textContent = fmtSpeed(wind.gust_ms) + " " + UNITS[state.unit].label;
    $("bftChip").textContent = beaufort(wind.speed_ms) + " Bft";
    $("freshness").textContent = t("freshness").replace("{t}", fmtTime(until));

    // compass
    if (wind.dir_deg != null) {
      $("dirCardinal").textContent = cardinal(wind.dir_deg);
      $("dirDeg").textContent = Math.round(wind.dir_deg) + "°";
      // arrow flies WITH the wind: rotate so it points where the wind blows to
      var arrowEl = $("windArrow");
      if (!arrowEl.dataset.init) {          // first render: snap, don't spin from 0°
        arrowEl.style.transition = "none";
        arrowEl.dataset.init = "1";
        requestAnimationFrame(function () { arrowEl.style.transition = ""; });
      }
      arrowEl.style.transform = "rotate(" + ((wind.dir_deg + 180) % 360) + "deg)";
    }

    // shore badge (icon + label, never color alone)
    var chip = $("shoreChip");
    if (wind.dir_deg != null) {
      var d = angDist(wind.dir_deg, SHORE_SEA_DIR);
      chip.hidden = false;
      chip.className = "chip";
      if (d <= 45) { chip.classList.add("chip-onshore"); chip.textContent = "🌊 " + t("onshore"); }
      else if (d >= 135) { chip.classList.add("chip-offshore"); chip.textContent = "⚠️ " + t("offshore"); }
      else { chip.classList.add("chip-cross"); chip.textContent = "↔️ " + t("cross"); }
    } else {
      chip.hidden = true;
    }

    // tiles
    $("tileGust").textContent = fmtSpeed(wind.gust_ms) + " " + UNITS[state.unit].label;
    $("tileTemp").textContent = wind.vt_c != null ? fmt(wind.vt_c, 1) : "–";

    renderDerivedTiles();
    $("updatedAt").textContent = state.latest.generated_at
      ? fmtTime(new Date(state.latest.generated_at)) : "–";
  }

  function renderDerivedTiles() {
    var pts = (state.history && state.history.points) || [];
    var wind = state.latest && state.latest.wind;

    // max gust today (highest 1-min peak since local midnight)
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    var best = null;
    for (var i = 0; i < pts.length; i++) {
      var pt = pts[i];
      if (new Date(pt.t) >= midnight && (best === null || pt.peak > best.peak)) best = pt;
    }
    if (wind && (best === null || wind.gust_ms > best.peak)) {
      best = { peak: wind.gust_ms, t: wind.data_until };
    }
    if (best) {
      $("tileMax").textContent = fmtSpeed(best.peak) + " " + UNITS[state.unit].label;
      $("tileMaxSub").textContent = t("at_time").replace("{t}", fmtTime(new Date(best.t)));
    } else {
      $("tileMax").textContent = "–";
      $("tileMaxSub").textContent = "–";
    }

    // trend: current speed vs bucket one hour ago
    var arrow = "→", label = t("steady");
    if (wind && pts.length) {
      var hourAgo = Date.now() - 3600000;
      var ref = null;
      for (var j = pts.length - 1; j >= 0; j--) {
        if (new Date(pts[j].t).getTime() <= hourAgo) { ref = pts[j]; break; }
      }
      if (ref) {
        var diff = wind.speed_ms - ref.ws;
        var thresh = Math.max(0.5, 0.15 * ref.ws);
        if (diff > thresh) { arrow = "↗"; label = t("rising"); }
        else if (diff < -thresh) { arrow = "↘"; label = t("falling"); }
      }
    }
    $("tileTrendArrow").textContent = arrow;
    $("tileTrendText").textContent = label + " · " + t("vs_hour");
  }

  // ------------------------------------------------------------- compass ticks

  function buildCompassTicks() {
    var g = $("compassTicks");
    var svgNS = "http://www.w3.org/2000/svg";
    for (var a = 0; a < 360; a += 30) {
      if (a % 90 === 0) continue;
      var rad = (a - 90) * Math.PI / 180;
      var line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", 80 + 66 * Math.cos(rad));
      line.setAttribute("y1", 80 + 66 * Math.sin(rad));
      line.setAttribute("x2", 80 + 72 * Math.cos(rad));
      line.setAttribute("y2", 80 + 72 * Math.sin(rad));
      g.appendChild(line);
    }
  }

  // ------------------------------------------------------------- chart

  var chart = {
    pad: { top: 12, right: 14, bottom: 24, left: 34 },
    height: 240
  };

  function visiblePoints() {
    var pts = (state.history && state.history.points) || [];
    var cutoff = Date.now() - state.range * 3600000;
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var time = new Date(pts[i].t).getTime();
      if (time >= cutoff) out.push({ x: time, ws: pts[i].ws, peak: pts[i].peak, dir: pts[i].dir });
    }
    return out;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var steps = [1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200];
    for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i];
    return Math.ceil(v / 100) * 100;
  }

  function renderChart() {
    var svg = $("chart");
    var wrap = $("chartWrap");
    var width = wrap.clientWidth || 600;
    var height = chart.height;
    var p = chart.pad;
    var pts = visiblePoints();

    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("height", height);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!pts.length) return;

    var x0 = pts[0].x, x1 = Date.now();
    var maxVal = 0;
    for (var i = 0; i < pts.length; i++) maxVal = Math.max(maxVal, conv(pts[i].peak));
    var yMax = niceMax(maxVal * 1.1);

    var plotW = width - p.left - p.right, plotH = height - p.top - p.bottom;
    var X = function (tms) { return p.left + (tms - x0) / (x1 - x0) * plotW; };
    var Y = function (v) { return p.top + plotH - (v / yMax) * plotH; };

    var svgNS = "http://www.w3.org/2000/svg";
    function el(name, attrs, parent) {
      var node = document.createElementNS(svgNS, name);
      for (var k in attrs) node.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(node);
      return node;
    }

    // horizontal gridlines + y labels (clean steps: 1/2/2.5/5 × 10^n)
    var target = yMax / 4, mag = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
    var step = 10 * mag, cands = [1, 2, 2.5, 5, 10];
    for (var c = 0; c < cands.length; c++) {
      var s = cands[c] * mag;
      if (s >= target && Math.abs(yMax / s - Math.round(yMax / s)) < 1e-9) { step = s; break; }
    }
    for (var tv = step; tv <= yMax + 1e-9; tv += step) {
      var y = Y(tv);
      el("line", { x1: p.left, x2: width - p.right, y1: y, y2: y, class: "grid-line" });
      var lbl = el("text", { x: p.left - 6, y: y + 4, class: "axis-text", "text-anchor": "end" });
      lbl.textContent = fmt(tv, step < 1 ? 1 : 0);
    }
    // baseline
    el("line", { x1: p.left, x2: width - p.right, y1: Y(0), y2: Y(0), class: "axis-line" });

    // x labels: every 3/6/12 h depending on range and width
    var stepH = state.range <= 12 ? 2 : state.range <= 24 ? 4 : 8;
    if (width < 480) stepH *= 2;
    var d0 = new Date(x0); d0.setMinutes(0, 0, 0);
    for (var tms = d0.getTime(); tms <= x1; tms += 3600000) {
      var dt = new Date(tms);
      if (dt.getHours() % stepH !== 0 || tms < x0) continue;
      var lx = X(tms);
      var text = el("text", { x: lx, y: height - 6, class: "axis-text", "text-anchor": "middle" });
      text.textContent = dt.getHours() === 0
        ? t("day_short")[dt.getDay()] + " " + dt.getDate() + "."
        : fmtTime(dt);
    }

    // series paths
    function pathFor(key) {
      var d = "";
      for (var i = 0; i < pts.length; i++) {
        d += (i ? "L" : "M") + X(pts[i].x).toFixed(1) + " " + Y(conv(pts[i][key])).toFixed(1);
      }
      return d;
    }
    var areaD = pathFor("ws") +
      "L" + X(pts[pts.length - 1].x).toFixed(1) + " " + Y(0).toFixed(1) +
      "L" + X(pts[0].x).toFixed(1) + " " + Y(0).toFixed(1) + "Z";
    el("path", { d: areaD, class: "area-wind" });
    el("path", { d: pathFor("peak"), class: "series-peak" });
    el("path", { d: pathFor("ws"), class: "series-wind" });

    // end dots (>=8px, surface ring)
    var last = pts[pts.length - 1];
    el("circle", { cx: X(last.x), cy: Y(conv(last.peak)), r: 4, class: "end-dot end-dot-peak" });
    el("circle", { cx: X(last.x), cy: Y(conv(last.ws)), r: 4, class: "end-dot end-dot-wind" });

    // hover layer: crosshair snaps to nearest bucket, tooltip lists both series
    var crosshair = el("line", { y1: p.top, y2: p.top + plotH, class: "crosshair", visibility: "hidden" });
    var hoverWind = el("circle", { r: 4, class: "hover-dot end-dot-wind", visibility: "hidden" });
    var hoverPeak = el("circle", { r: 4, class: "hover-dot end-dot-peak", visibility: "hidden" });
    var overlay = el("rect", { x: p.left, y: p.top, width: plotW, height: plotH, fill: "transparent" });
    var tooltip = $("tooltip");

    function nearest(tms) {
      var lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (pts[mid].x < tms) lo = mid; else hi = mid;
      }
      return (tms - pts[lo].x < pts[hi].x - tms) ? lo : hi;
    }

    function showTooltip(clientX) {
      var rect = svg.getBoundingClientRect();
      var tms = x0 + (clientX - rect.left - p.left) / plotW * (x1 - x0);
      var pt = pts[nearest(tms)];
      var px = X(pt.x);
      crosshair.setAttribute("x1", px); crosshair.setAttribute("x2", px);
      crosshair.setAttribute("visibility", "visible");
      hoverWind.setAttribute("cx", px); hoverWind.setAttribute("cy", Y(conv(pt.ws)));
      hoverPeak.setAttribute("cx", px); hoverPeak.setAttribute("cy", Y(conv(pt.peak)));
      hoverWind.setAttribute("visibility", "visible");
      hoverPeak.setAttribute("visibility", "visible");

      // build tooltip content (textContent only)
      while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);
      var timeDiv = document.createElement("div");
      timeDiv.className = "tt-time";
      var dt = new Date(pt.x);
      timeDiv.textContent = fmtTime(dt) + (pt.dir != null ? " · " + cardinal(pt.dir) : "");
      tooltip.appendChild(timeDiv);
      [["peak", "var(--s2)", t("legend_peak")], ["ws", "var(--s1)", t("legend_wind")]].forEach(function (row) {
        var div = document.createElement("div");
        div.className = "tt-row";
        var key = document.createElement("span");
        key.className = "tt-key";
        key.style.borderColor = row[1];
        var val = document.createElement("span");
        val.className = "tt-val";
        val.textContent = fmtSpeed(pt[row[0]]) + " " + UNITS[state.unit].label;
        var name = document.createElement("span");
        name.className = "tt-name";
        name.textContent = row[2];
        div.appendChild(key); div.appendChild(val); div.appendChild(name);
        tooltip.appendChild(div);
      });

      tooltip.hidden = false;
      var wrapRect = wrap.getBoundingClientRect();
      var ttW = tooltip.offsetWidth;
      var left = px + 12;
      if (left + ttW > wrapRect.width - 4) left = px - ttW - 12;
      tooltip.style.left = Math.max(4, left) + "px";
      tooltip.style.top = (p.top + 6) + "px";
    }

    function hideTooltip() {
      tooltip.hidden = true;
      crosshair.setAttribute("visibility", "hidden");
      hoverWind.setAttribute("visibility", "hidden");
      hoverPeak.setAttribute("visibility", "hidden");
    }

    overlay.addEventListener("pointermove", function (e) { showTooltip(e.clientX); });
    overlay.addEventListener("pointerdown", function (e) { showTooltip(e.clientX); });
    overlay.addEventListener("pointerleave", hideTooltip);

    renderDirStrip(pts);
    renderTable(pts);
  }

  function renderDirStrip(pts) {
    var strip = $("dirStrip");
    while (strip.firstChild) strip.removeChild(strip.firstChild);
    if (!pts.length) return;
    var slots = Math.min(12, Math.max(6, Math.floor(strip.clientWidth / 56)));
    for (var s = 0; s < slots; s++) {
      var idx = Math.round(s * (pts.length - 1) / (slots - 1));
      var span = document.createElement("span");
      var dir = pts[idx].dir;
      if (dir != null) {
        span.textContent = "↓";
        span.style.display = "inline-block";
        span.style.transform = "rotate(" + dir + "deg)";
        span.title = Math.round(dir) + "°";
      } else {
        span.textContent = "·";
      }
      strip.appendChild(span);
    }
  }

  function renderTable(pts) {
    var tbody = document.querySelector("#dataTable tbody");
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    var unit = UNITS[state.unit].label;
    for (var i = pts.length - 1; i >= 0; i--) {
      var pt = pts[i];
      var tr = document.createElement("tr");
      var dt = new Date(pt.x);
      [fmtTime(dt),
       fmtSpeed(pt.ws) + " " + unit,
       fmtSpeed(pt.peak) + " " + unit,
       pt.dir != null ? cardinal(pt.dir) + " (" + Math.round(pt.dir) + "°)" : "–"
      ].forEach(function (text) {
        var td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
  }

  // ------------------------------------------------------------- data loading

  function loadJson(name) {
    if (window.ZW_INLINE) return Promise.resolve(window.ZW_INLINE[name]);
    return fetch("data/" + name + ".json?ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function refreshLatest() {
    return loadJson("latest").then(function (d) {
      state.latest = d;
      renderLatest();
    }).catch(function () { renderLatest(); });
  }

  function refreshHistory() {
    var wrap = $("chartWrap");
    wrap.classList.add("loading");
    return loadJson("history").then(function (d) {
      state.history = d;
      renderChart();
      renderDerivedTiles();
    }).catch(function () {}).then(function () {
      wrap.classList.remove("loading");
    });
  }

  function renderAll() {
    applyI18n();
    renderLatest();
    renderChart();
  }

  // ------------------------------------------------------------- events

  document.querySelectorAll(".unit-seg [data-unit]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.unit = btn.getAttribute("data-unit");
      localStorage.setItem("zw-unit", state.unit);
      document.querySelectorAll("[data-unit]").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      renderAll();
    });
    btn.classList.toggle("active", btn.getAttribute("data-unit") === state.unit);
  });

  document.querySelectorAll(".range-seg [data-range]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.range = parseInt(btn.getAttribute("data-range"), 10);
      document.querySelectorAll("[data-range]").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      renderChart();
    });
  });

  $("langBtn").addEventListener("click", function () {
    state.lang = state.lang === "de" ? "en" : "de";
    localStorage.setItem("zw-lang", state.lang);
    renderAll();
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 150);
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !window.ZW_INLINE) { refreshLatest(); refreshHistory(); }
  });

  // ------------------------------------------------------------- boot

  buildCompassTicks();
  applyI18n();
  refreshLatest();
  refreshHistory();
  if (!window.ZW_INLINE) {
    setInterval(refreshLatest, REFRESH_LATEST_S * 1000);
    setInterval(refreshHistory, REFRESH_HISTORY_S * 1000);
  }
})();
