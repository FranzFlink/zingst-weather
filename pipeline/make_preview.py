#!/usr/bin/env python3
"""
Bundle the dashboard into ONE self-contained HTML file (CSS, JS, current data
and logos inlined). Handy for previewing on a phone or mailing around before
hosting exists.

Usage:  python3 pipeline/make_preview.py [output.html]
Default output: preview.html in the project root.
"""

import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "docs"


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "preview.html"

    html = (SITE / "index.html").read_text(encoding="utf-8")
    css = (SITE / "css" / "style.css").read_text(encoding="utf-8")
    js = (SITE / "js" / "app.js").read_text(encoding="utf-8")
    latest = json.loads((SITE / "data" / "latest.json").read_text(encoding="utf-8"))
    history = json.loads((SITE / "data" / "history.json").read_text(encoding="utf-8"))

    html = html.replace(
        '<link rel="stylesheet" href="css/style.css">',
        "<style>\n" + css + "\n</style>")

    inline_data = ("<script>window.ZW_INLINE = " +
                   json.dumps({"latest": latest, "history": history}, ensure_ascii=False) +
                   ";</script>")
    html = html.replace(
        '<script src="js/app.js"></script>',
        inline_data + "\n<script>\n" + js + "\n</script>")

    mimes = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg"}
    for asset in (SITE / "assets").iterdir():
        mime = mimes.get(asset.suffix.lower())
        if not mime:
            continue
        data_uri = ("data:" + mime + ";base64," +
                    base64.b64encode(asset.read_bytes()).decode("ascii"))
        html = html.replace(f"assets/{asset.name}", data_uri)

    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
