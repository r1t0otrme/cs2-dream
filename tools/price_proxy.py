#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Локальный сборщик цен Steam.

Отдаёт ровно тот же API, что и worker/worker.js (облачная версия для телефона),
поэтому страницу можно отлаживать локально, а потом просто поменять адрес:

    GET  /price?name=AK-47%20%7C%20Redline%20(Field-Tested)&cur=1
    POST /bulk   {"names": ["...", "..."], "cur": 1}

Цены берутся с Steam Community Market. Один запрос на предмет, кэш 30 минут,
не больше 4 параллельных запросов, чтобы не получить 429.

Запуск:  python tools/price_proxy.py            (http://127.0.0.1:8788)
         python tools/price_proxy.py 8788 --host 0.0.0.0   (доступно с телефона в той же Wi-Fi)
"""
import argparse
import json
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STEAM = "https://steamcommunity.com/market/priceoverview/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
TTL = 1800          # сколько секунд держим цену в кэше
MAX_BATCH = 40      # больше не пускаем: у Worker-а лимит на подзапросы
WORKERS = 4         # одновременно к Steam

_cache = {}
_lock = threading.Lock()
CURL = shutil.which("curl")

# Steam отдаёт 429 на TLS-отпечаток Python. curl проходит, поэтому по умолчанию
# ходим через него, а urllib остаётся запасным вариантом (если curl нет в системе).
CURL_ARGS = ["-sS", "--max-time", "15", "--compressed",
             "-H", "User-Agent: " + UA,
             "-H", "Accept: application/json, text/plain, */*",
             "-H", "Referer: https://steamcommunity.com/market/",
             "-w", "\n%{http_code}"]


def money(s):
    """'$1,234.56' / '33,00€' / '1 234,56 pуб.' -> float"""
    if not s:
        return None
    t = "".join(ch for ch in str(s) if ch.isdigit() or ch in ".,")
    if not t:
        return None
    dec = max(t.rfind("."), t.rfind(","))
    if dec < 0:
        intpart, frac = t, ""
    else:
        intpart = t[:dec].replace(".", "").replace(",", "")
        frac = t[dec + 1:]
    if len(frac) > 2:
        intpart, frac = t.replace(".", "").replace(",", ""), ""
    try:
        return float(intpart + ("." + frac if frac else ""))
    except ValueError:
        return None


def _get(url):
    """-> (status, body). Сначала curl, потом urllib."""
    if CURL:
        try:
            p = subprocess.run([CURL] + CURL_ARGS + [url],
                               capture_output=True, timeout=30)
        except Exception:                                       # noqa: BLE001
            return 0, ""
        out = p.stdout.decode("utf-8", "replace")
        body, _, code = out.rpartition("\n")
        try:
            return int(code.strip()), body
        except ValueError:
            return 0, out
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://steamcommunity.com/market/",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception:                                           # noqa: BLE001
        return 0, ""


def fetch_price(name, cur=1):
    key = (name, cur)
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < TTL:
            return dict(hit[1], cached=True)

    url = STEAM + "?" + urllib.parse.urlencode(
        {"appid": 730, "currency": cur, "market_hash_name": name})

    last = "fail"
    for attempt in range(3):
        status, text = _get(url)
        if status == 429:
            last = "429"
            time.sleep(1.0 + attempt)
            continue
        if status != 200:
            last = "http %s" % status
            time.sleep(0.4)
            continue
        try:
            data = json.loads(text)
        except ValueError:
            last = "json"
            time.sleep(0.4)
            continue
        if not data.get("success"):
            out = {"price": None, "median": None}
        else:
            out = {
                "price": money(data.get("lowest_price") or data.get("median_price")),
                "median": money(data.get("median_price")),
                "volume": data.get("volume"),
            }
        with _lock:
            _cache[key] = (time.time(), out)
        return dict(out, cached=False)
    return {"price": None, "error": last}


class Handler(BaseHTTPRequestHandler):
    server_version = "cs2price/1.0"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):                                       # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):                                           # noqa: N802
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path in ("/", "/health"):
            return self._json({"ok": True, "service": "cs2 price proxy",
                               "endpoints": ["/price?name=", "/bulk"]})
        if u.path == "/price":
            name = (q.get("name") or [""])[0].strip()
            if not name:
                return self._json({"ok": False, "error": "name required"}, 400)
            cur = int((q.get("cur") or ["1"])[0])
            res = fetch_price(name, cur)
            return self._json({"ok": res.get("price") is not None, "name": name,
                               "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                               **res})
        return self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):                                          # noqa: N802
        u = urllib.parse.urlparse(self.path)
        if u.path != "/bulk":
            return self._json({"ok": False, "error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(n).decode("utf-8-sig") or "{}")
        except Exception:                                       # noqa: BLE001
            return self._json({"ok": False, "error": "bad json"}, 400)

        names = [str(x).strip() for x in (payload.get("names") or []) if str(x).strip()]
        names = list(dict.fromkeys(names))[:MAX_BATCH]
        if not names:
            return self._json({"ok": False, "error": "names required"}, 400)
        cur = int(payload.get("cur") or 1)

        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            rows = list(ex.map(lambda nm: (nm, fetch_price(nm, cur)), names))

        items = {nm: r for nm, r in rows}
        return self._json({"ok": True, "cur": cur, "count": len(items),
                           "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                           "items": items})

    def log_message(self, fmt, *args):                          # тихий лог
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", type=int, default=8788)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:                                           # noqa: BLE001
        pass

    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print("сборщик цен: http://%s:%d  (Ctrl+C — стоп)" % (a.host, a.port))
    print("пример: http://%s:%d/price?name=AK-47%%20%%7C%%20Redline%%20(Field-Tested)" % (a.host, a.port))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nостановлен")


if __name__ == "__main__":
    main()
