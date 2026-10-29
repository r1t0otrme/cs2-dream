#!/usr/bin/env python3
"""build.py - собирает data/catalog.json (компактная база для страницы).

Два источника:
  --sqlite <path>   база проекта cs2-prices (SQLite, там же картинки и типы)
  --feed <url|path> публичный агрегатор цен (один запрос на все предметы)

Картинки/типы берутся из уже готового catalog.json, поэтому фид только
обновляет цены и не теряет иконки:

  python tools/build.py --feed https://prices.csgotrader.app/latest/prices_v6.json
  python tools/build.py --sqlite ../cs2-prices/cs2_prices.db

Формат результата:
{
  "v": 1, "generated": "...", "source": "...", "count": 5000,
  "items": {
    "AK-47 | Redline": {
      "t": "Covert Rifle", "c": "eb4b4b", "i": "<icon hash>",
      "w": true,                        # есть варианты износа
      "p": {"n": [fn, mw, ft, ww, bs],  # обычные, $ или null
            "s": [...], "v": [...]}     # StatTrak / Souvenir
    }
  }
}
"""
import argparse
import gzip
import json
import os
import re
import sqlite3
import sys
import time
from urllib.request import Request, urlopen

WEARS = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn",
         "Battle-Scarred"]
WEAR_IDX = {w.lower(): i for i, w in enumerate(WEARS)}
WEAR_PREFIX = {"f": 0, "m": 1, "w": 2}
QUAL_KEYS = {"n": "n", "s": "s", "v": "v"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "data", "catalog.json")

RE_STAT = re.compile(r"^StatTrak\u2122?\s*", re.I)
RE_SOUV = re.compile(r"^Souvenir\s+", re.I)
RE_WEAR = re.compile(r"\(([^()]*)\)\s*$")


def split_name(name):
    """'StatTrak\u2122 AK-47 | Redline (Field-Tested)' -> base, wear, qual."""
    n = (name or "").strip()
    qual = "n"
    if RE_STAT.match(n):
        qual = "s"
        n = RE_STAT.sub("", n)
    elif RE_SOUV.match(n):
        qual = "v"
        n = RE_SOUV.sub("", n)
    n = n.strip()
    wear = None
    m = RE_WEAR.search(n)
    if m and m.group(1).strip().lower() in WEAR_IDX:
        wear = WEAR_IDX[m.group(1).strip().lower()]
        n = n[:m.start()].strip()
    return n, wear, qual


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, str):
        v = v.replace("$", "").replace(" ", "").replace("\u00a0", "")
        if "," in v and "." in v:
            v = v.replace(",", "") if v.rfind(".") > v.rfind(",") \
                else v.replace(".", "").replace(",", ".")
        elif "," in v:
            v = v.replace(",", ".")
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(x, 2) if x > 0 else None


def blank():
    return {"p": {"n": [None] * 5, "s": [None] * 5, "v": [None] * 5},
            "w": False, "t": "", "c": "", "i": ""}


def add(cat, name, price, meta=None):
    base, wear, qual = split_name(name)
    if not base:
        return
    e = cat.get(base)
    if e is None:
        e = cat[base] = blank()
    if meta:
        for k in ("t", "c", "i"):
            if meta.get(k) and not e.get(k):
                e[k] = meta[k]
    p = num(price)
    if p is None:
        return
    if wear is None:
        arr = e["p"][qual]
        if e["w"]:
            # предмет уже известен как изнашиваемый - не портим массив
            return
        arr[0] = p
    else:
        e["w"] = True
        e["p"][qual][wear] = p


# ------------------------------------------------------------------ sqlite
def from_sqlite(path, cat):
    conn = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"),
                           uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(items)")}
    want = ["name", "wear", "quality", "price_usd", "icon", "item_type",
            "color", "weapon", "skin"]
    have = [c for c in want if c in cols]
    sql = "SELECT %s FROM items" % ", ".join(have)
    n = 0
    for r in conn.execute(sql):
        name = r["name"]
        if not name:
            continue
        # склеиваем базу из weapon|skin - там нет меток StatTrak/Souvenir
        # и нет износа, зато они есть в name, поэтому парсим name целиком
        add(cat, name, r["price_usd"] if "price_usd" in have else None,
            {"t": r["item_type"] if "item_type" in have else "",
             "c": r["color"] if "color" in have else "",
             "i": r["icon"] if "icon" in have else ""})
        n += 1
    conn.close()
    return n


# -------------------------------------------------------------------- feed
def read_source(src, timeout=180):
    if os.path.exists(src):
        with open(src, "rb") as f:
            raw = f.read()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))
    req = Request(src, headers={
        "User-Agent": "cs2-dream/1.0 (+github actions)",
        "Accept": "application/json", "Accept-Encoding": "gzip"})
    with urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            try:
                raw = gzip.decompress(raw)
            except Exception:
                pass
    return json.loads(raw.decode("utf-8", "replace"))


def feed_price(entry):
    """Достаёт steam-цену из записи агрегатора (структуры бывают разные)."""
    if isinstance(entry, (int, float)):
        return entry
    if not isinstance(entry, dict):
        return None
    for key in ("steam", "steam_price", "prices"):
        block = entry.get(key)
        if isinstance(block, (int, float)):
            return block
        if isinstance(block, dict):
            for k in ("last_24h", "last_7d", "last_30d", "last_90d",
                      "price", "value", "median"):
                if block.get(k):
                    return block[k]
    for k in ("price", "steam_price", "last_24h", "last_7d", "median"):
        if entry.get(k):
            return entry[k]
    return None


def from_feed(path, cat):
    data = read_source(path)
    if isinstance(data, dict) and "items" in data \
            and isinstance(data["items"], dict):
        data = data["items"]
    if isinstance(data, dict) and "prices" in data \
            and isinstance(data["prices"], dict):
        data = data["prices"]
    n = 0
    for name, entry in data.items():
        if not isinstance(name, str) or "|" not in name and "Case" not in name \
                and "Sticker" not in name:
            continue
        add(cat, name, feed_price(entry))
        n += 1
    return n


# -------------------------------------------------------------------- main
def load_meta(path):
    """Иконки/типы из прошлого каталога - чтобы фид их не стёр."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            old = json.load(f)
        return old.get("items") or {}
    except Exception:
        return {}


def main(argv=None):
    try:  # консоль Windows любит cp1251/cp866
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", help="путь к cs2_prices.db")
    ap.add_argument("--feed", help="URL или файл с ценами всех предметов")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--keep-meta", default=None,
                    help="каталог, из которого взять иконки (по умолчанию --out)")
    a = ap.parse_args(argv)

    if not a.sqlite and not a.feed:
        ap.error("нужен --sqlite или --feed")

    out = os.path.abspath(a.out)
    cat = {}
    meta_path = a.keep_meta or out
    old = load_meta(meta_path)
    if old:
        for base, e in old.items():
            cat[base] = {"p": {"n": [None] * 5, "s": [None] * 5,
                               "v": [None] * 5},
                         "w": bool(e.get("w")), "t": e.get("t", ""),
                         "c": e.get("c", ""), "i": e.get("i", "")}
        print("иконки/типы из %s: %d" % (meta_path, len(old)))

    started = time.time()
    src = []
    if a.feed:
        cnt = from_feed(a.feed, cat)
        src.append("feed:%s (%d строк)" % (a.feed.rsplit("/", 1)[-1], cnt))
        print("фид: разобрано %d строк за %.1fs" % (cnt, time.time() - started))
    if a.sqlite:
        cnt = from_sqlite(a.sqlite, cat)
        src.append("sqlite:%s (%d строк)" % (os.path.basename(a.sqlite), cnt))
        print("sqlite: разобрано %d строк" % cnt)

    # чистим пустышки
    for base in [b for b, e in cat.items() if not any(
            x for arr in e["p"].values() for x in arr)]:
        del cat[base]

    items = {}
    for base, e in sorted(cat.items()):
        if not e["w"]:
            e["p"]["n"] = e["p"]["n"][:1]
            e["p"]["s"] = e["p"]["s"][:1]
            e["p"]["v"] = e["p"]["v"][:1]
        rec = {"p": {k: v for k, v in e["p"].items() if any(v)}}
        if e["t"]:
            rec["t"] = e["t"]
        if e["c"]:
            rec["c"] = e["c"]
        if e["i"]:
            rec["i"] = e["i"]
        if e["w"]:
            rec["w"] = True
        items[base] = rec

    doc = {"v": 1,
           "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "source": " + ".join(src),
           "count": len(items),
           "items": items}

    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out)
    size = os.path.getsize(out) / 1048576.0
    print("готово: %s - %d предметов, %.2f МБ за %.1fs"
          % (out, len(items), size, time.time() - started))
    return 0


if __name__ == "__main__":
    sys.exit(main())
