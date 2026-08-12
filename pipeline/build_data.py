#!/usr/bin/env python3
"""
Build the JSON files for the Zingst weather dashboard.

Reads the tower data written by the DL16 logger / Thies 2D anemometer:

  wind  raw : /dwddaten/limdat/DL16_Zingst/raw_values_wind/YYYY/MM/DD/HH/raw_values_wind_YYYY-MM-DD_HH-MM.txt
              (~8 Hz samples, one file per minute -> used for the live panel + 3 s gusts)
  wind  avg : /dwddaten/limdat/DL16_Zingst/avg_values_wind/YYYY/MM/DD/avg_values_wind_YYYY-MM-DD_HH.txt
              (1-minute means, one file per hour, written ~1 min after the hour -> used for history)
  dl16  raw : /dwddaten/limdat/DL16_Zingst/raw_values_dl16   (fixed width, see MEASUREMENTS_DL16)
              currently NOT readable for this account (group dwddaten only) - handled gracefully.

Writes (atomically):
  docs/data/latest.json   - current conditions, refreshed by cron
  docs/data/history.json  - 48 h of 10-minute buckets for the charts

Stdlib only, no external dependencies. Run:  python3 pipeline/build_data.py
"""

import json
import math
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# --------------------------------------------------------------------------- config

TZ = ZoneInfo("Europe/Berlin")  # logger timestamps are local time

BASE = Path("/dwddaten/limdat/DL16_Zingst")
WIND_RAW = BASE / "raw_values_wind"
WIND_AVG = BASE / "avg_values_wind"
DL16_RAW = BASE / "raw_values_dl16"

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"

HISTORY_HOURS = 48        # chart depth
BUCKET_MIN = 10           # chart resolution
LIVE_WINDOW_MIN = 10      # WMO wind = 10-minute mean
GUST_WINDOW_S = 3.0       # WMO gust = max 3-second running mean

# plausibility limits (drop anything outside)
WG_MAX = 75.0             # m/s
VT_MIN, VT_MAX = -40.0, 60.0

# Thies "Wissenschaftliches Telegramm" (telegram 12) columns, ';'-separated.
# avg files carry 14 values + timestamp, raw files 17 values + timestamp
# (raw additionally has STh, STgen, LC before the timestamp).
IDX_WG, IDX_WR, IDX_VT = 0, 1, 2

# DL16 fixed-width line format (positions are 1-indexed), from Steffen's mail.
# Not yet readable for this account - parser activates automatically once
# read permission on raw_values_dl16/ is granted.
MEASUREMENTS_DL16 = [
    {"name": "Mevis_Zeit_DL16", "position": 1, "length": 7},
    {"name": "Batteriespannung", "position": 9, "length": 4},
    {"name": "Versorgungsspannung_UAC", "position": 14, "length": 4},
    {"name": "Batterieladestrom", "position": 19, "length": 4},
    {"name": "Luftdruck", "position": 24, "length": 6},
    {"name": "Temperatur_Druckluftsensor", "position": 31, "length": 5},
    {"name": "Relative_Feuchte_CH06", "position": 37, "length": 5},
    {"name": "Relative_Feuchte_CH08", "position": 43, "length": 5},
    {"name": "Relative_Feuchte_CH10", "position": 49, "length": 5},
    {"name": "Temperatur_CH07", "position": 55, "length": 5},
    {"name": "Temperatur_CH09", "position": 61, "length": 5},
    {"name": "Temperatur_CH11", "position": 67, "length": 5},
    {"name": "Temperatur_CNR4_CH12", "position": 73, "length": 5},
    {"name": "Kurzwellige_Strahlung_oben_CH13", "position": 79, "length": 6},
    {"name": "Kurzwellige_Strahlung_unten_CH14", "position": 86, "length": 6},
    {"name": "Langwellige_Strahlung_oben_CH15", "position": 93, "length": 6},
    {"name": "Langwellige_Strahlung_unten_CH16", "position": 100, "length": 6},
    {"name": "Windgeschwindigkeit_COM4", "position": 107, "length": 4},
    {"name": "Windrichtung_COM4", "position": 112, "length": 3},
    {"name": "Windgeschwindigkeit_Stdabw_COM4", "position": 116, "length": 4},
    {"name": "Windrichtung_Stdabw_COM4", "position": 121, "length": 3},
    {"name": "Virtuelle_Temperatur_COM4", "position": 125, "length": 5},
    {"name": "SYNOP_4680_COM5", "position": 131, "length": 2},
    {"name": "Niederschlagsmenge_COM5", "position": 134, "length": 5},
    {"name": "Stromeingang_mA_CH01", "position": 140, "length": 6},
    {"name": "Spannungseingang_mV_CH02", "position": 147, "length": 6},
    {"name": "Spannungseingang_V_CH03", "position": 154, "length": 6},
    {"name": "Spannungseingang_V_CH04", "position": 161, "length": 6},
    {"name": "Spannungseingang_V_CH05", "position": 168, "length": 6},
    {"name": "DL16_Datum_aa_bb_cc", "position": 175, "length": 8},
    {"name": "DL16_Uhrzeit_aa_bb_cc", "position": 184, "length": 8},
]

# --------------------------------------------------------------------------- helpers


def circ_mean_deg(degrees):
    """Circular mean of wind directions in degrees (0..360)."""
    if not degrees:
        return None
    s = sum(math.sin(math.radians(d)) for d in degrees)
    c = sum(math.cos(math.radians(d)) for d in degrees)
    if s == 0 and c == 0:
        return None
    return round(math.degrees(math.atan2(s, c)) % 360.0, 1)


def parse_wind_fields(line):
    """Parse one telegram-12 line -> (wg, wr, vt) or None if implausible."""
    parts = line.strip().split(";")
    if len(parts) < 3:
        return None
    try:
        wg = float(parts[IDX_WG])
        wr = float(parts[IDX_WR])
        vt = float(parts[IDX_VT])
    except ValueError:
        return None
    if not (0.0 <= wg <= WG_MAX) or not (0.0 <= wr <= 360.0):
        return None
    if not (VT_MIN <= vt <= VT_MAX):
        vt = None  # keep the wind sample, drop the bad temperature
    return wg, wr, vt


def avg_file_path(dt):
    return (WIND_AVG / f"{dt:%Y}" / f"{dt:%m}" / f"{dt:%d}"
            / f"avg_values_wind_{dt:%Y-%m-%d}_{dt:%H}.txt")


def raw_minute_path(dt):
    return (WIND_RAW / f"{dt:%Y}" / f"{dt:%m}" / f"{dt:%d}" / f"{dt:%H}"
            / f"raw_values_wind_{dt:%Y-%m-%d}_{dt:%H}-{dt:%M}.txt")


def read_lines(path):
    try:
        with open(path, "r", encoding="ascii", errors="replace") as fh:
            return fh.readlines()
    except OSError:
        return []


def minute_stats_from_avg_file(path):
    """avg file -> list of (dt, wg, wr, vt), one entry per minute."""
    out = []
    for line in read_lines(path):
        parts = line.strip().split(";")
        if len(parts) < 4:
            continue
        fields = parse_wind_fields(line)
        if fields is None:
            continue
        try:
            dt = datetime.strptime(parts[-1].strip(), "%d.%m.%Y %H:%M:%S").replace(tzinfo=TZ)
        except ValueError:
            continue
        out.append((dt, *fields))
    return out


def minute_stats_from_raw_hour(hour_dt):
    """Fallback for hours without an avg file yet: average each raw minute file."""
    out = []
    for minute in range(60):
        dt = hour_dt.replace(minute=minute, second=0, microsecond=0)
        samples = [parse_wind_fields(l) for l in read_lines(raw_minute_path(dt))]
        samples = [s for s in samples if s is not None]
        if not samples:
            continue
        wgs = [s[0] for s in samples]
        wrs = [s[1] for s in samples]
        vts = [s[2] for s in samples if s[2] is not None]
        out.append((dt,
                    sum(wgs) / len(wgs),
                    circ_mean_deg(wrs),
                    (sum(vts) / len(vts)) if vts else None))
    return out


# --------------------------------------------------------------------------- history


def build_history(now):
    """48 h of 10-minute buckets from avg files, current hour filled from raw."""
    minutes = []  # (dt, wg, wr, vt)
    start = (now - timedelta(hours=HISTORY_HOURS + 1)).replace(minute=0, second=0, microsecond=0)
    hour = start
    while hour <= now:
        path = avg_file_path(hour)
        if path.is_file():
            minutes.extend(minute_stats_from_avg_file(path))
        elif now - hour <= timedelta(hours=3):
            # avg file not written yet (appears ~1 min past the hour) -> use raw
            minutes.extend(minute_stats_from_raw_hour(hour))
        hour += timedelta(hours=1)

    cutoff = now - timedelta(hours=HISTORY_HOURS)
    minutes = [m for m in minutes if m[0] >= cutoff]
    minutes.sort(key=lambda m: m[0])

    buckets = {}
    for dt, wg, wr, vt in minutes:
        key = dt.replace(minute=dt.minute - dt.minute % BUCKET_MIN, second=0, microsecond=0)
        buckets.setdefault(key, []).append((wg, wr, vt))

    points = []
    for key in sorted(buckets):
        rows = buckets[key]
        wgs = [r[0] for r in rows]
        wrs = [r[1] for r in rows if r[1] is not None]
        vts = [r[2] for r in rows if r[2] is not None]
        points.append({
            "t": key.isoformat(timespec="minutes"),
            "ws": round(sum(wgs) / len(wgs), 2),          # mean wind, m/s
            "peak": round(max(wgs), 2),                   # highest 1-min mean, m/s
            "dir": circ_mean_deg(wrs),
            "vt": round(sum(vts) / len(vts), 1) if vts else None,
            "n": len(rows),
        })
    return points


# --------------------------------------------------------------------------- live panel


def build_live(now, max_lookback_min=90):
    """Current conditions from the newest LIVE_WINDOW_MIN raw minute files.

    The transfer from the station arrives in batches (files can lag ~15 min
    behind the clock), so the window is anchored at the newest existing file,
    not at 'now' — the dashboard shows the measurement time separately.
    """
    samples = []          # flat list of (wg, wr, vt) at ~8 Hz
    files_found = 0
    data_until = None
    misses = 0
    back = 0
    while back < max_lookback_min:
        dt = (now - timedelta(minutes=back)).replace(second=0, microsecond=0)
        back += 1
        rows = [parse_wind_fields(l) for l in read_lines(raw_minute_path(dt))]
        rows = [r for r in rows if r is not None]
        if not rows:
            if files_found:      # tolerate small gaps inside the window
                misses += 1
                if misses > 3:
                    break
            continue
        files_found += 1
        if data_until is None:
            data_until = dt + timedelta(minutes=1)
        samples[:0] = rows  # prepend: we iterate newest -> oldest
        if files_found >= LIVE_WINDOW_MIN:
            break

    if not samples:
        return None

    wgs = [s[0] for s in samples]
    wrs = [s[1] for s in samples]
    vts = [s[2] for s in samples if s[2] is not None]

    # gust: max of a GUST_WINDOW_S running mean over the ~8 Hz series
    rate = len(samples) / (files_found * 60.0)
    k = max(1, round(GUST_WINDOW_S * rate))
    gust = 0.0
    window_sum = sum(wgs[:k])
    gust = window_sum / k
    for i in range(k, len(wgs)):
        window_sum += wgs[i] - wgs[i - k]
        gust = max(gust, window_sum / k)

    return {
        "speed_ms": round(sum(wgs) / len(wgs), 2),
        "gust_ms": round(gust, 2),
        "dir_deg": circ_mean_deg(wrs),
        "vt_c": round(sum(vts) / len(vts), 1) if vts else None,
        "window_min": files_found,
        "sample_hz": round(rate, 1),
        "data_until": data_until.isoformat(timespec="minutes"),
    }


# --------------------------------------------------------------------------- DL16 (dormant)


def parse_dl16_line(line):
    values = {}
    for m in MEASUREMENTS_DL16:
        raw = line[m["position"] - 1: m["position"] - 1 + m["length"]].strip()
        if not raw:
            continue
        try:
            values[m["name"]] = float(raw.replace(",", "."))
        except ValueError:
            values[m["name"]] = raw
    return values


def build_dl16():
    """Latest DL16 record, or an error marker while we lack read permission.

    NOTE: once readable, confirm with Steffen which Temperatur/Feuchte channel
    is the 2 m air value before surfacing it on the dashboard.
    """
    try:
        if not os.access(DL16_RAW, os.R_OK | os.X_OK):
            return {"available": False, "reason": "permission"}
        newest = None
        for root, _dirs, files in os.walk(DL16_RAW):
            for f in files:
                p = Path(root) / f
                if newest is None or p.stat().st_mtime > newest.stat().st_mtime:
                    newest = p
        if newest is None:
            return {"available": False, "reason": "no-files"}
        lines = read_lines(newest)
        if not lines:
            return {"available": False, "reason": "empty"}
        return {"available": True, "file": str(newest), "values": parse_dl16_line(lines[-1])}
    except OSError as exc:
        return {"available": False, "reason": str(exc)}


# --------------------------------------------------------------------------- output


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def main():
    now = datetime.now(TZ)
    live = build_live(now)
    history = build_history(now)
    dl16 = build_dl16()

    latest = {
        "generated_at": now.isoformat(timespec="seconds"),
        "station": {
            "name": "Messfeld Zingst",
            "operator": "Leipziger Institut für Meteorologie, Universität Leipzig",
            "lat": 54.4416, "lon": 12.7041,   # tower in the dunes at Strandübergang 13
            "sensor_height_m_approx": 10,
            "timezone": "Europe/Berlin",
        },
        "wind": live,
        "dl16": dl16,
    }
    write_json(OUT_DIR / "latest.json", latest)
    write_json(OUT_DIR / "history.json", {
        "generated_at": now.isoformat(timespec="seconds"),
        "bucket_min": BUCKET_MIN,
        "points": history,
    })

    ok = live is not None and bool(history)
    print(f"latest: wind={'ok' if live else 'MISSING'} dl16={'ok' if dl16.get('available') else dl16.get('reason')}")
    print(f"history: {len(history)} buckets ({HISTORY_HOURS} h @ {BUCKET_MIN} min)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
