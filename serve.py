#!/usr/bin/env python3
"""serve.py - локальный просмотр страницы (только статика, без логики).

Нужен, потому что браузер не даёт читать data/catalog.json с file://.
На GitHub эта роль не нужна - там страницу отдаёт Pages.

    python serve.py            # http://localhost:8787
    python serve.py 9000       # другой порт
"""
import http.server
import os
import socket
import sys
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        # файл с токеном отдаём только этому компьютеру, не в локальную сеть
        if self.path.split("?")[0].endswith("collect.config.json"):
            if self.client_address[0] not in ("127.0.0.1", "::1"):
                self.send_error(403, "only localhost")
                return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if " 404 " in msg or " 500 " in msg:
            print("  !", msg)


def main():
    try:  # консоль Windows бывает cp1251/cp866
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    path = sys.argv[2] if len(sys.argv) > 2 else ""
    os.chdir(ROOT)
    ip = lan_ip()
    url = "http://localhost:%d/%s" % (port, path)
    try:
        srv = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    except OSError as e:
        # сервер уже запущен — просто открываем нужную страницу
        print("порт %d занят: %s" % (port, e))
        try:
            webbrowser.open(url)
        except Exception:
            pass
        return 0
    print("\n  CS2 · инвентарь мечты")
    print("  на этом компьютере:  http://localhost:%d" % port)
    print("  с телефона (та же wi-fi):  http://%s:%d" % (ip, port))
    print("  остановить: Ctrl+C\n")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  выключено")
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
