/**
 * CS2 Dream — сборщик цен Steam для Cloudflare Workers (бесплатный план).
 *
 * Зачем: браузер не может напрямую ходить на Steam (нет CORS), а телефон
 * должен получать свежие цены без своего сервера. Этот Worker — ровно тот
 * посредник: 10–50 запросов вместо 19 000.
 *
 * API (совпадает с tools/price_proxy.py):
 *   GET  /price?name=<market_hash_name>&cur=1
 *   POST /bulk   {"names": ["...","..."], "cur": 1}
 *
 * Деплой: см. worker/README.md. Переменная SHARED_KEY необязательна —
 * если задать, запросы должны идти с ?key=<значение>.
 */

const STEAM = 'https://steamcommunity.com/market/priceoverview/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
const MAX_BATCH = 40;   // лимит подзапросов на бесплатном плане — 50
const CONCURRENCY = 4;

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** "$1,234.56" / "33,00€" / "1 234,56 pуб." -> число */
function money(s) {
  if (!s) return null;
  const t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  const dec = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  let intPart, frac;
  if (dec < 0) { intPart = t; frac = ''; }
  else {
    intPart = t.slice(0, dec).replace(/[.,]/g, '');
    frac = t.slice(dec + 1);
  }
  if (frac.length > 2) { intPart = t.replace(/[.,]/g, ''); frac = ''; }
  const v = parseFloat(intPart + (frac ? '.' + frac : ''));
  return Number.isFinite(v) ? v : null;
}

async function fetchPrice(name, cur = 1) {
  const url = STEAM + '?appid=730&currency=' + cur +
              '&market_hash_name=' + encodeURIComponent(name);
  let last = 'fail';
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try {
      r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          // ВАЖНО: без Accept-Language — Steam отвечает на него 429
          'Referer': 'https://steamcommunity.com/market/'
        },
        cf: { cacheTtl: 1800, cacheEverything: true }
      });
    } catch (e) {
      last = 'network';
      await sleep(300);
      continue;
    }
    if (r.status === 429) {
      last = '429';
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (!r.ok) return { price: null, error: 'http ' + r.status };
    let d;
    try { d = await r.json(); } catch (e) {
      return { price: null, error: 'json' };
    }
    if (!d || !d.success) return { price: null, error: 'no listings' };
    return {
      price: money(d.lowest_price || d.median_price),
      median: money(d.median_price),
      volume: d.volume || null
    };
  }
  return { price: null, error: last };
}

/** ограниченная параллельность: 4 запроса к Steam за раз */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(runners);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (env && env.SHARED_KEY && url.searchParams.get('key') !== env.SHARED_KEY) {
      return json({ ok: false, error: 'bad key' }, 403);
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        ok: true,
        service: 'cs2 price proxy',
        endpoints: ['GET /price?name=<hash>&cur=1', 'POST /bulk {"names":[...]}']
      });
    }

    if (url.pathname === '/price' && request.method === 'GET') {
      const name = (url.searchParams.get('name') || '').trim();
      if (!name) return json({ ok: false, error: 'name required' }, 400);
      const cur = parseInt(url.searchParams.get('cur') || '1', 10) || 1;
      const res = await fetchPrice(name, cur);
      return json({ ok: res.price != null, name, ts: nowIso(), ...res });
    }

    if (url.pathname === '/bulk' && request.method === 'POST') {
      let payload;
      try { payload = await request.json(); } catch (e) {
        return json({ ok: false, error: 'bad json' }, 400);
      }
      const names = [...new Set((payload && payload.names || [])
        .map(x => String(x || '').trim()).filter(Boolean))].slice(0, MAX_BATCH);
      if (!names.length) return json({ ok: false, error: 'names required' }, 400);
      const cur = parseInt(payload.cur || 1, 10) || 1;

      const rows = await pool(names, CONCURRENCY, n => fetchPrice(n, cur));
      const items = {};
      names.forEach((n, i) => { items[n] = rows[i]; });
      return json({ ok: true, cur, count: names.length, ts: nowIso(), items });
    }

    return json({ ok: false, error: 'not found' }, 404);
  }
};
