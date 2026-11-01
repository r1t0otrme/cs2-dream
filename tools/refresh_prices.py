#!/usr/bin/env python3
"""refresh_prices.py - обновляет самые старые цены в data/live.json.

Запускается ботом в GitHub Actions (см. .github/workflows/prices.yml),
поэтому никому не нужен токен: база обновляется сама.

    python tools/refresh_prices.py            # ~150 самых старых, до 10 минут
    PRICE_MAX=50 python tools/refresh_prices.py

Работает адаптивно: идёт по списку самых старых, пока не кончится время
(PRICE_BUDGET), не упрётся в PRICE_MAX или пока прокси не скажет «хватит»
(429/503). В последнем случае сохранённое всё равно коммитится - прогресс
не теряется.

Цена берётся через публичный прокси r.jina.ai: Steam не отдаёт CORS,
а серверные IP Steam режет 429-ми - Jina ходит со своих адресов.
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
MAX = int(os.environ.get("PRICE_MAX", "150") or 150)
BUDGET = float(os.environ.get("PRICE_BUDGET", "600") or 600)
PAUSE = float(os.environ.get("PRICE_PAUSE", "1.0") or 1.0)
JINA = "https://r.jina.ai/"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


class Limited(Exception):
    """прокси сказал «слишком много запросов» - дальше долбить бессмысленно"""


class NoPrice(Exception):
    """страница открылась, но цены у предмета нет (снят с продажи)"""


class Transient(Exception):
    """не получилось проверить: сеть, 5xx, неожиданный ответ"""


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


def fetch(name, tries=2):
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
            # 429/503 - лимит; 451/403 - прокси блокирует адрес.
            # И то, и другое значит «сейчас проверить нельзя», а не
            # «предмета нет»: базу этим портить нельзя.
            if e.code in (429, 503):
                if k + 1 >= tries:
                    raise Limited(f"HTTP {e.code}")
                time.sleep(3 + k * 3)
                continue
            if e.code in (451, 403):
                raise Limited(f"HTTP {e.code}")
            if 500 <= e.code < 600 and k + 1 < tries:
                time.sleep(2 + k * 2)
                continue
            raise Transient(f"HTTP {e.code}")
        except Limited:
            raise
        except Exception as e:
            if k + 1 < tries:
                time.sleep(2 + k * 2)
                continue
            raise Transient(type(e).__name__)

        lo = re.search(r'"lowest_price"\s*:\s*"([^"]*)"', txt)
        md = re.search(r'"median_price"\s*:\s*"([^"]*)"', txt)
        v = parse_usd(lo.group(1)) if lo else None
        if v is None and md:
            v = parse_usd(md.group(1))
        if v is not None:
            return v
        if '"success"' in txt or "lowest_price" in txt or "median_price" in txt:
            raise NoPrice(name)
        raise Transient("не похоже на страницу Steam")
    raise Transient("не удалось")


def ts_of(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def main():
    with open(LIVE, encoding="utf-8") as f:
        doc = json.load(f)
    prices = doc.get("prices") or {}
    if not prices:
        print("база пуста - нечего обновлять")
        return 0

    # checked: когда предмет проверяли в последний раз. Нужен, чтобы цены,
    # которых нет в продаже, не занимали очередь бота каждый запуск.
    checked = doc.get("checked") or {}

    def age(name, row):
        row_ts = row[1] if isinstance(row, list) and len(row) > 1 else None
        return max(ts_of(row_ts), ts_of(checked.get(name)))

    queue = sorted(prices.keys(), key=lambda n: age(n, prices[n]))[:MAX]
    print(f"в базе: {len(prices)} | в очереди: {len(queue)} | "
          f"лимит {MAX}, бюджет {int(BUDGET)} с")
    stamp = now_iso()
    started = time.monotonic()
    changed = misses = fails = done = 0
    limited = False

    for i, name in enumerate(queue, 1):
        if time.monotonic() - started > BUDGET:
            print(f"время вышло на {i}/{len(queue)}")
            break
        try:
            p = fetch(name)
        except Limited as e:
            print(f"{i}/{len(queue)} - прокси просит паузу ({e}), останавливаюсь")
            limited = True
            break
        except NoPrice:
            done += 1
            misses += 1
            # запоминаем, что проверили: снятый с продажи предмет
            # не должен каждый раз занимать начало очереди
            checked[name] = stamp
            print(f"{i}/{len(queue)} - нет в продаже: {name}")
            time.sleep(PAUSE)
            continue
        except Transient as e:
            fails += 1
            print(f"{i}/{len(queue)} - не проверить ({e}): {name}")
            if fails >= 8:
                print("восемь промахов подряд - прокси не отвечает, останавливаюсь")
                break
            time.sleep(PAUSE)
            continue

        done += 1
        fails = 0
        row = prices.get(name)
        old = row[0] if isinstance(row, list) and row else None
        prices[name] = [p, stamp]
        checked.pop(name, None)
        if old is None or abs(float(old) - p) >= 0.005:
            changed += 1
            print(f"{i}/{len(queue)} - {name}: {old} -> {p}")
        else:
            print(f"{i}/{len(queue)} - {name}: {p} (без изменений)")

        time.sleep(PAUSE)

    if not changed:
        # время всё равно двигаем, иначе бот будет вечно долбить те же записи
        print("цены не изменились, но отметки времени обновлены")

    doc["prices"] = prices
    if checked:
        doc["checked"] = checked
    doc["generated"] = stamp
    doc["bot"] = {"run": stamp, "done": done, "changed": changed,
                  "misses": misses, "stopped": "limit" if limited else "done"}
    with open(LIVE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"готово: проверено {done}, изменено {changed}, без цены {misses}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
