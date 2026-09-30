# Wetter Zingst — Dashboard

Live wind (and soon full weather) dashboard for the meteorological field site Zingst,
Leipziger Institut für Meteorologie (LIM), Universität Leipzig. Aimed at surfers,
rescue swimmers and beach tourists.

**Design goals:** not overcrowded, pastel coastal look, great on iOS/Android,
German/English, no external dependencies (a single static site + tiny JSON files).

## How it works

```
tower ──▶ /dwddaten/limdat/DL16_Zingst/…      (raw logger output, read-only)
                    │
                    ▼   cron, every 5 min (deploy/update.sh)
          pipeline/build_data.py              (stdlib Python, ~0.3 s)
                    │
                    ▼
          docs/data/latest.json  (~0.4 kB)    current conditions
          docs/data/history.json (~24 kB)     48 h of 10-min buckets
                    │
                    ▼
          docs/  (static HTML/CSS/JS)         the dashboard, served by GitHub Pages
```

- **Live panel** — last 10 min of the ~8 Hz raw anemometer files
  (`raw_values_wind/`): 10-min mean wind + direction, gusts as the WMO-style
  max 3-second running mean.
- **History chart** — hourly `avg_values_wind/` files (1-min means), bucketed
  to 10 min; the current, not-yet-averaged hour is filled from the raw files.
- **DL16 logger** (temperature, humidity, pressure, radiation, rain): parser is
  ready in `build_data.py` (`MEASUREMENTS_DL16`) but the directories
  `raw_values_dl16/` and `avg_values_dl16/` are currently only readable for the
  `dwddaten` group → see *Open points*.

## Commands

```bash
python3 pipeline/build_data.py      # rebuild docs/data/*.json from tower data
python3 pipeline/make_preview.py    # bundle everything into one preview.html
```

To serve locally for a quick look (only binds to this machine, stop with Ctrl-C):

```bash
cd docs && python3 -m http.server 8931 --bind 127.0.0.1
```

Enable the cron refresh (user crontab only, nothing system-wide):

```bash
crontab -e    # then paste the line from deploy/crontab.example
```

## Hosting — LIVE ✅

- **Site**: https://franzflink.github.io/zingst-weather/
- **Repo**: https://github.com/FranzFlink/zingst-weather (public — GitHub Pages
  on the free plan requires it; source: branch `main`, folder `/docs`)
- A user cron job on barat runs `deploy/update.sh` every 5 minutes:
  rebuild JSON → commit → push; Pages redeploys automatically (~1 min).
  Inspect with `crontab -l`, remove via `crontab -e`. Log: `logs/update.log`.
- GitHub auth: `gh` CLI in `~/.local/bin/gh` (account FranzFlink), git pushes
  use its credential helper — no tokens stored in the repo.
- Optional next step: a friendly domain (e.g. `wetter-zingst.de`) via CNAME.

Nothing listens on the university server, no ports are opened, only outbound
`git push`. The vendor manuals (PDFs) are gitignored on purpose — they are
copyrighted and don't belong in a public repo.

## Open points

- [ ] **DL16 read access**: ask Steffen to make `raw_values_dl16/` and
      `avg_values_dl16/` group- or world-readable like the wind directories
      (`chmod o+rx` on the two directories, or add `jomueller` to the
      `dwddaten` group). The dashboard picks the data up automatically.
- [ ] **Channel mapping**: once DL16 is readable, confirm with Steffen which
      `Temperatur_CHxx` / `Relative_Feuchte_CHxx` channel is the 2 m air value
      before showing it on the dashboard.
- [x] **Logos**: official files in `docs/assets/logo-lim.png` /
      `logo-uni-leipzig.png`, linked to the institute / university websites.
- [x] **Impressum**: filled (responsible person, GitHub Pages privacy entry) —
      still worth cross-checking against the university's Impressum template.
- [ ] **Anemometer height**: the site says "ca. 10 m" (freshness line, about
      section, `sensor_height_m_approx` in latest.json) — confirm the exact
      height with Steffen and update if needed.
- [ ] **Shore orientation**: `SHORE_SEA_DIR` in `docs/js/app.js` is set to 0°
      (sea due north). Adjust if the beach section of interest faces differently.
- [ ] Institute sign-off for public hosting.

## Data format

- Wind: Thies 2D ultrasonic anemometer, "Wissenschaftliches Telegramm" 12,
  `;`-separated: `WG;WR;VT;VY;VX;T13;T24;C31;C42;C13;C24;PA;INTER;AV[;STh;STgen;LC];timestamp`.
  Raw files: one per minute, ~8 Hz samples. Avg files: one per hour, 1-min means.
  `-273.15` in T13/T24 marks invalid values; timestamps are local (Europe/Berlin).
- DL16: fixed-width lines, spec in `MEASUREMENTS_DL16` in `pipeline/build_data.py`.
- Manuals: the two PDFs in the project root (DL16-Pro logger, Thies 2D anemometer).
