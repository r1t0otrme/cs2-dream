#!/usr/bin/env python3
"""bundle.py - собирает один html со всей базой внутри (версия для телефона).

    python tools/bundle.py           -> phone/cs2-dream.html

Внутри: стили, код, база 13 925 предметов и data/live.json.
Файл открывается с телефона как обычный документ: ни сервера, ни папок.
Цены обновляются по сети, если она есть; без сети показываются вшитые.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "phone")
OUT = os.path.join(OUT_DIR, "cs2-dream.html")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def esc_json(txt):
    # чтобы "</script>" внутри данных не закрыл тег
    return txt.replace("</", "<\\/")


def main():
    html = read("index.html")
    css = read("style.css")
    js = read("app.js")
    catalog = read("data", "catalog.json")
    live = read("data", "live.json")

    html = html.replace('<link rel="stylesheet" href="style.css">',
                        "<style>\n" + css + "\n</style>")

    inline = (
        "<script>\n"
        "window.__CATALOG__ = " + esc_json(catalog) + ";\n"
        "window.__LIVE__ = " + esc_json(live) + ";\n"
        "</script>\n"
        "<script>\n" + js + "\n</script>"
    )
    html, n = re.subn(r'<script src="app\.js[^"]*"></script>', lambda m: inline, html)
    if not n:
        print("не нашёл тег app.js в index.html")
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    size = os.path.getsize(OUT) / 1048576
    print(f"готово: {OUT} ({size:.1f} МБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
