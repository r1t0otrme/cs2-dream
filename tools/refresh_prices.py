#!/usr/bin/env python3
"""refresh_prices.py - обновляет самые старые цены в data/live.json.

Запускается ботом в GitHub Actions (см. .github/workflows/prices.yml),
поэтому никому не нужен токен: база обновляется сама.

    python tools/refresh_prices.py            # 20 самых старых
    PRICE_LIMIT=50 python tools/refresh_prices.py

Цена берётся через публичный прокси r.jina.ai (Steam не отдаёт CORS,
а серверные IP Steam режет 429-ми - Jina ходит со своих адресов).
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.path.join(ROOT, "data", "live.json")
LIMIT = int(os.environ.get("PRICE_LIMIT", "20") or 20)
JINA = "https://r.jina.ai/"
PAUSE = float(os.environ.get("PRICE_PAUSE", "1.2") or 1.2)

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def steam_url(name):
    # двойное кодирование: r.jina.ai раскодирует URL один раз,
    # иначе "&" в имени рвёт строку запроса
    return ("https://steamcommunity.com/market/priceoverview/?appid=730&currency=1"
            "&market_hash_name=" + urllib.parse.quote(urllib.parse.quote(name, safe=""), safe=""))


def parse_usd(s):
    m = re.sub(r"[^\d.,]", "", str(s or ""))
    if not m:
        return None
    if "," in m and "." in m:
        m = m.replace(",", "")
    elif "," in m:
        # "$1,23" - запятая как разделитель дробной части
        m = m.replace(",", ".")
    try:
        v = float(m)
    except ValueError:
        return None
    return v if 0.01 <= v <= 1_000_000 else None


def fetch(name, tries=3):
    url = JINA + steam_url(name)
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "cs2-dream-bot/1.0",
                "Accept": "text/plain, */*",
            })
            with urllib.request.urlopen(req, timeout=40) as r:
                txt = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(3 + k * 3)
                continue
            print("  HTTP", e.code, name)
            return None
        except Exception as e:
            print("  сеть:", type(e).__name__, name)
            time.sleep(2 + k * 2)
            continue

        lo = re.search(r'"lowest_price"\s*:\s*"([^"]*)"', txt)
        md = re.search(r'"median_price"\s*:\s*"([^"]*)"', txt)
        v = parse_usd(lo.group(1)) if lo else None
        if v is None and md:
            v = parse_usd(md.group(1))
        if v is not None:
            return v
        return None
    return None


def main():
    with open(LIVE, encoding="utf-8") as f:
        doc = json.load(f)
    prices = doc.get("prices") or {}
    if not prices:
        print("база пуста — нечего обновлять")
        return 0

    def ts(row):
        try:
            return datetime.fromisoformat(str(row[1]).replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    oldest = sorted(prices.items(), key=lambda kv: ts(kv[1]))[:LIMIT]
    print("в базе:", len(prices), "| обновляю:", len(oldest))
    stamp = now_iso()
    changed = 0
    fails = 0
    for i, (name, row) in enumerate(oldest, 1):
        p = fetch(name)
        if p is None:
            fails += 1
            print(f"{i}/{len(oldest)} — нет цены: {name}")
            if fails >= 5:
                print("пять промахов подряд — похоже, прокси режет, останавливаюсь")
                break
        else:
            fails = 0
            old = row[0] if isinstance(row, list) and row else None
            prices[name] = [p, stamp]
            if old is None or abs(float(old) - p) >= 0.005:
                changed += 1
                print(f"{i}/{len(oldest)} — {name}: {old} -> {p}")
            else:
                print(f"{i}/{len(oldest)} — {name}: {p} (без изменений)")
        time.sleep(PAUSE)

    if not changed:
        # время всё равно двигаем, иначе бот будет вечно долбить те же записи
        print("цены не изменились, но отметка времени обновлена")
    doc["prices"] = prices
    doc["generated"] = stamp
    with open(LIVE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print("готово: изменено", changed, "| всего", len(prices))
    return 0


if __name__ == "__main__":
    sys.exit(main())
