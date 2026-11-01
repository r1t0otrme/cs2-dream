'use strict';
/* CS2 · инвентарь мечты — вся логика на клиенте (статическая страница) */

/* ------------------------------------------------------------------ константы */
const WEARS = [
  {code: 'FN', en: 'Factory New',    ru: 'Прямо с завода',        color: '#4ecb71'},
  {code: 'MW', en: 'Minimal Wear',   ru: 'Немного поношенное',     color: '#8fd14f'},
  {code: 'FT', en: 'Field-Tested',   ru: 'После полевых',          color: '#ffcc33'},
  {code: 'WW', en: 'Well-Worn',      ru: 'Поношенное',             color: '#ff9f43'},
  {code: 'BS', en: 'Battle-Scarred', ru: 'Закалённое в боях',      color: '#ef5350'}
];
const QUALS = [
  {k: 'n', label: 'Обычный',   short: 'N'},
  {k: 's', label: 'StatTrak™', short: 'ST'},
  {k: 'v', label: 'Souvenir',  short: 'SV'}
];
const CURS = {
  usd: {sym: '$', code: 'USD', name: 'доллары'},
  rub: {sym: '₽', code: 'RUB', name: 'рубли'},
  kzt: {sym: '₸', code: 'KZT', name: 'тенге'}
};
const ORD_COLOR = {1: '#3ecf6b', 2: '#ffcc33'};
const CATS = [
  {k: 'all', label: 'все'},
  {k: 'rifle', label: 'винтовки'},
  {k: 'pistol', label: 'пистолеты'},
  {k: 'smg', label: 'пп'},
  {k: 'heavy', label: 'тяжёлое'},
  {k: 'knife', label: 'ножи'},
  {k: 'gloves', label: 'перчатки'},
  {k: 'case', label: 'кейсы'},
  {k: 'sticker', label: 'наклейки'},
  {k: 'other', label: 'другое'}
];
const QL_WORDS = {st: 's', stattrak: 's', 'stattrak™': 's', statrek: 's', stattrakk: 's',
  статтрек: 's', статтрак: 's', статтракер: 's', sv: 'v', souvenir: 'v',
  сувенир: 'v', сувенирный: 'v', сувенирная: 'v'};
const WEAR_WORDS = {fn: 0, factory: 0, new: 0, mw: 1, minimal: 1, ft: 2, field: 2,
  tested: 2, ww: 3, well: 3, worn: 3, bs: 4, battle: 4, scarred: 4};
const LS_KEY = 'cs2dream.v3';
const IMG = h => 'https://community.cloudflare.steamstatic.com/economy/image/' + h + '/360fx360f';
const MARKET_URL = n => 'https://steamcommunity.com/market/listings/730/' + encodeURIComponent(n);

/* ------------------------------------------------------------------ состояние */
const defaults = () => ({
  tab: 'now',
  cur: 'usd',
  rate: {rub: 92, kzt: 520},
  sort: 'price-desc',
  ordFilter: 0,
  proxy: '',
  autoLive: true,
  topUp: true,
  help: 5,
  ghToken: '',
  shareAuto: true,
  live: {},
  items: {now: [], dream: []}
});
let S = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!raw) return defaults();
    const d = defaults();
    return {
      tab: raw.tab === 'dream' ? 'dream' : 'now',
      cur: CURS[raw.cur] ? raw.cur : 'usd',
      rate: Object.assign(d.rate, raw.rate || {}),
      sort: raw.sort || d.sort,
      ordFilter: raw.ordFilter || 0,
      proxy: typeof raw.proxy === 'string' ? raw.proxy : '',
      autoLive: raw.autoLive !== false,
      topUp: raw.topUp !== false,
      help: isFinite(+raw.help) ? Math.max(0, Math.min(200, +raw.help)) : 5,
      ghToken: typeof raw.ghToken === 'string' ? raw.ghToken : '',
      shareAuto: raw.shareAuto !== false,
      live: (raw.live && typeof raw.live === 'object') ? raw.live : {},
      items: {now: raw.items?.now || [], dream: raw.items?.dream || []}
    };
  } catch (e) { return defaults(); }
})();
let CAT = null, IDX = [];

/* ------------------------------------------------------------------ утилиты */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), 1900);
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
}

/* ---------- деньги ---------- */
function money(usd) {
  if (usd == null || !isFinite(usd)) return '—';
  if (S.cur === 'usd') {
    return usd >= 1000 ? '$' + usd.toLocaleString('ru-RU', {maximumFractionDigits: 0})
                       : '$' + usd.toFixed(2);
  }
  const r = S.rate[S.cur] || 1;
  const v = Math.round(usd * r);
  return v.toLocaleString('ru-RU').replace(/\u00A0|\u202F/g, ' ') + ' ' + CURS[S.cur].sym;
}
function toDisp(usd) {
  const r = S.cur === 'usd' ? 1 : (S.rate[S.cur] || 1);
  return usd == null ? '' : Math.round(usd * r);
}
function fromDisp(v) {
  const r = S.cur === 'usd' ? 1 : (S.rate[S.cur] || 1);
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n / r : 0;
}

/* "$1,234.56" / "128,24" -> число. Нужно для цен из текстовых прокси. */
function parseUsd(s) {
  if (s == null) return null;
  const t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  const dec = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
  let ip, fr;
  if (dec < 0) {
    ip = t; fr = '';
  } else {
    ip = t.slice(0, dec).replace(/[.,]/g, '');
    fr = t.slice(dec + 1);
  }
  if (fr.length > 2) { ip = t.replace(/[.,]/g, ''); fr = ''; }
  const v = parseFloat(ip + (fr ? '.' + fr : ''));
  return isFinite(v) ? v : null;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* сигнал «отвались через N мс» — чтобы сеть не могла подвесить очередь */
function deadline(ms) {
  try { return AbortSignal.timeout(ms); }
  catch (e) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }
}

/* ---------- нормализация поиска (рус/англ + транслит) ---------- */
const TR = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
  н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',
  ь:'',э:'e',ю:'yu',я:'ya'};
const RU_EN = {
  'нож':'knife','ножи':'knife','ножа':'knife','перчатки':'gloves','перчатка':'gloves','перчаток':'gloves',
  'керамбит':'karambit','керамбита':'karambit','бабочка':'butterfly','бабочку':'butterfly',
  'штык':'bayonet','талон':'talon','коготь':'talon','когти':'talon',
  'охотник':'huntsman','палач':'huntsman','скелет':'skeleton','боуи':'bowie','медведь':'bowie',
  'стилет':'stiletto','кинжал':'daggers','тени':'shadow','гвозди':'talon',
  'ак':'ak','ак47':'ak 47','калаш':'ak','калашников':'ak','эмка':'m4','м4':'m4','м4а4':'m4a4',
  'авп':'awp','дигл':'desert eagle','юсп':'usp','глок':'glock','феймас':'famas',
  'галил':'galil','скаут':'ssg','сг':'ssg','мп9':'mp9','мп7':'mp7','пустынный':'desert',
  'орёл':'eagle','орел':'eagle','револьвер':'revolver',
  'дракон':'dragon','лор':'lore','гидр':'hydro','гидропоника':'hydro','азимов':'asiimov',
  'азимова':'asiimov','гипербист':'hyper beast','гиперзверь':'hyper beast',
  'неонуар':'neo noir','нео-нуар':'neo noir','редлайн':'redline','красная':'red','линия':'line',
  'доплер':'doppler','фейд':'fade','мрамор':'marble','тигр':'tiger','ультрафиолет':'ultraviolet',
  'империя':'empire','кровавая':'blood','паутина':'web','сафари':'safari','шторм':'storm',
  'буря':'storm','камуфляж':'camo','камуфляжный':'camo','поляр':'polar','ками':'camo',
  'кейс':'case','кейсы':'case','наклейка':'sticker','наклейки':'sticker','стикер':'sticker',
  'музыка':'music','музыкальный':'music','набор':'kit','граффити':'graffiti','значок':'pin',
  'брелок':'charm','брелки':'charm','агент':'agent','персонаж':'agent',
  'прямо':'factory','завода':'new','поношенное':'worn','полевых':'field',
  'закалённое':'battle','закаленное':'battle','боях':'scarred','немного':'minimal',
  'золото':'gold','золотой':'gold','золотая':'gold','золотые':'gold','алмаз':'diamond',
  'агат':'agate','градиент':'fade','пропуск':'pass','медаль':'medal','монета':'coin',
  'коллекция':'collection','сувенир':'souvenir','статтрек':'stattrak','статтрак':'stattrak',
  'чёрный':'black','черный':'black','красный':'red','синий':'blue'
};
function translit(s) {
  return s.replace(/[а-я]+/g, w => Array.from(w).map(c => (c in TR ? TR[c] : c)).join(''));
}
function cleanup(s) {
  return s
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function norm(s) {
  s = String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/штык-нож/g, 'bayonet');
  s = s.replace(/[а-я]+/g, w => RU_EN[w] || translit(w));
  return cleanup(s);
}
function normPlain(s) {
  s = String(s || '').toLowerCase().replace(/ё/g, 'е');
  return cleanup(translit(s));
}
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i; let best = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}

/* ------------------------------------------------------------------ каталог */
function catOf(base, c) {
  const t = (c.t || '').toLowerCase();
  const n = base.toLowerCase();
  if (n.startsWith('★') || /knife|bayonet|karambit|daggers/.test(t)) {
    return /glove/.test(t + n) ? 'gloves' : 'knife';
  }
  if (/glove/.test(t)) return 'gloves';
  if (/rifle|sniper|machinegun|machine gun/.test(t)) return 'rifle';
  if (/smg|submachine/.test(t)) return 'smg';
  if (/shotgun|machinegun/.test(t)) return 'heavy';
  if (/pistol/.test(t)) return 'pistol';
  if (/case|container|package|capsule|\bkey\b/.test(t)) return 'case';
  if (/sticker|patch|graffiti|charm|music kit|pin|agent|collectible|tool/.test(t)) return 'sticker';
  return 'other';
}
function buildIndex() {
  IDX = [];
  for (const base of Object.keys(CAT.items)) {
    const c = CAT.items[base];
    IDX.push({
      base, c,
      toks: norm(base).split(' ').filter(Boolean),
      min: minPrice(c),
      cat: catOf(base, c),
      q: {n: qualHas(c, 'n'), s: qualHas(c, 's'), v: qualHas(c, 'v')}
    });
  }
}
function minPrice(c) {
  let m = Infinity;
  for (const q of ['n', 's', 'v']) {
    const arr = c.p && c.p[q]; if (!arr) continue;
    for (const v of arr) if (v != null && v < m) m = v;
  }
  return m === Infinity ? null : m;
}
function priceOf(c, q, w) {
  if (!c || !c.p) return null;
  const arr = c.p[q];
  if (!arr) return null;
  const v = arr[w || 0];
  return v == null ? null : v;
}
function qualHas(c, q) {
  const arr = c.p && c.p[q];
  return !!(arr && arr.some(v => v != null));
}
function itemPrice(it) {
  const c = CAT && CAT.items[it.base];
  let catP = null;
  if (c) {
    catP = priceOf(c, it.q, it.w);
    if (catP != null) { it.snap = catP; it.ts = CAT.generated; }
  }
  // живая цена с ТП свежее снимка каталога - берём её
  const live = liveGet(hashName(it));
  if (live != null) return live;
  return catP != null ? catP : (it.snap == null ? null : it.snap);
}
function hashName(it) {
  const qp = it.q === 's' ? 'StatTrak™ ' : it.q === 'v' ? 'Souvenir ' : '';
  const w = it.w == null ? '' : ' (' + WEARS[it.w].en + ')';
  return qp + it.base + w;
}

/* ---------- живые цены ----------
   Основной путь без настройки: публичный прокси r.jina.ai читает priceoverview Steam.
   Он отдаёт CORS-заголовок, поэтому работает прямо из браузера телефона.
   Необязательный ускоритель: worker/worker.js или tools/price_proxy.py —
   API одинаковый: POST {names:[...]} -> {items:{name:{price}}}. */
function proxyBase() { return String(S.proxy || '').trim().replace(/\/+$/, ''); }

const JINA = 'https://r.jina.ai/';
const JINA_MAX = 18;        // запас от лимита 20 запросов
const JINA_WIN = 60000;     // в минуту
let jinaHits = [];
async function jinaSlot() {
  for (;;) {
    const now = Date.now();
    jinaHits = jinaHits.filter(t => now - t < JINA_WIN);
    if (jinaHits.length < JINA_MAX) { jinaHits.push(now); return; }
    await sleep(jinaHits[0] + JINA_WIN - now + 200);
  }
}
function steamPriceUrl(name) {
  // двойное кодирование: r.jina.ai один раз раскодирует URL, иначе "&" в имени
  // (например "Dreams & Nightmares Case") рвёт строку запроса и Steam отвечает без цены
  return 'https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=' +
    encodeURIComponent(encodeURIComponent(name));
}
async function jinaOnce(name) {
  await jinaSlot();
  // без таймаута зависший запрос держал бы весь фоновый долив
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 20000);
  let r;
  try {
    r = await fetch(JINA + steamPriceUrl(name), {cache: 'no-store', signal: ctl.signal});
  } finally { clearTimeout(tm); }
  if (r.status === 429 || r.status === 503) { const e = new Error('лимит'); e.retry = true; throw e; }
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.retry = r.status >= 500; throw e; }
  const txt = await r.text();
  const lo = /"lowest_price"\s*:\s*"([^"]*)"/.exec(txt);
  const md = /"median_price"\s*:\s*"([^"]*)"/.exec(txt);
  const v = lo ? parseUsd(lo[1]) : (md ? parseUsd(md[1]) : null);
  return v;
}
async function jinaOne(name) {
  for (let k = 0; ; k++) {
    try {
      return await jinaOnce(name);
    } catch (e) {
      if (k >= 2 || (!e.retry && !/fetch|network|Failed/i.test(e.message))) throw e;
      await sleep(1500 + k * 2000);
    }
  }
}
async function jinaBulk(items, onProgress) {
  const names = [...new Set(items.map(hashName))];
  const out = {};
  const queue = names.map((_, i) => i);
  let done = 0, bad = 0;
  const worker = async () => {
    for (;;) {
      const i = queue.shift();
      if (i == null) return;
      try {
        const p = await jinaOne(names[i]);
        if (p != null) out[names[i]] = {price: p};
      } catch (e) { bad++; }
      done++;
      if (onProgress) onProgress(done, names.length, bad);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}
/* живые цены хранятся по market_hash_name: { "AK-47 | Redline (Field-Tested)": [31.55, "iso"] } */
function liveGet(name) {
  const row = S.live && S.live[name];
  if (!row || row[0] == null) return null;
  const t = Date.parse(row[1]);
  if (!isFinite(t)) return null;
  const g = CAT && CAT.generated ? Date.parse(CAT.generated) : 0;
  return isFinite(g) && g > t ? null : row[0];
}
function liveTs(name) {
  const row = S.live && S.live[name];
  return row ? row[1] : null;
}
function liveSet(name, price) {
  if (!S.live) S.live = {};
  S.live[name] = [price, new Date().toISOString()];
}
function isLive(it) { return liveGet(hashName(it)) != null; }

/* готовая база цен из репозитория: её наполняет collect.html */
let lastLiveLoad = 0;
function mergeLiveDoc(d) {
  const prices = (d && d.prices) || {};
  let n = 0;
  for (const name of Object.keys(prices)) {
    const row = prices[name];
    if (!Array.isArray(row) || row[0] == null) continue;
    const cur = S.live[name];
    if (!cur || String(row[1]) > String(cur[1])) { S.live[name] = [row[0], row[1]]; n++; }
  }
  return n;
}
async function loadLive() {
  lastLiveLoad = Date.now();
  // в офлайн-сборке база вшита в файл
  let n = window.__LIVE__ ? mergeLiveDoc(window.__LIVE__) : 0;
  const urls = [
    'https://raw.githubusercontent.com/r1t0otrme/cs2-dream/main/data/live.json?t=' + Date.now(),
    'data/live.json?t=' + Date.now()
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, {cache: 'no-store'});
      if (!r.ok) continue;
      n += mergeLiveDoc(await r.json());
      break;
    } catch (e) { /* пробуем следующий источник */ }
  }
  if (n) save();
  return n;
}
async function liveBulk(items, onProgress) {
  const base = proxyBase();
  const names = [...new Set(items.map(hashName))];
  if (!base) {
    const map = await jinaBulk(items, onProgress);
    if (!Object.keys(map).length) throw new Error('Steam не отдал цены — попробуй ещё раз через минуту');
    return map;
  }
  const r = await fetch(base + '/bulk', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({names, cur: 1}),
    signal: deadline(60000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (!d || !d.items) throw new Error('плохой ответ сборщика');
  return d.items;
}
function applyLive(items, map) {
  let n = 0;
  for (const it of items) {
    const name = hashName(it);
    const row = map[name];
    if (row && row.price != null) {
      liveSet(name, row.price);
      it.live = row.price;
      it.liveTs = S.live[name][1];
      n++;
    }
  }
  return n;
}
async function refreshLive(quiet) {
  const list = tabItems();
  if (!list.length) { if (!quiet) toast('нечего обновлять'); return; }
  const btn = $('[data-live]');
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  if (!quiet) toast('обновляю цены: ' + list.length + '…');
  try {
    const map = await liveBulk(list, (d, n) => {
      if (n > 3) toast('цены: ' + d + ' из ' + n + '…');
    });
    const cnt = applyLive(list, map);
    save(); render();
    toast(cnt ? 'цены обновлены: ' + cnt : 'лотов не нашлось');
    return cnt;
  } catch (e) {
    if (!quiet) toast('ошибка: ' + e.message);
    return 0;
  } finally {
    const b = $('[data-live]');
    if (b) { b.disabled = false; b.classList.remove('busy'); }
  }
}
function staleLive(items, ms) {
  const now = Date.now();
  return items.filter(it => {
    const name = hashName(it);
    if (liveGet(name) == null) return true;
    const t = Date.parse(liveTs(name) || '');
    return !isFinite(t) || now - t > ms;
  });
}
async function autoLive() {
  if (S.autoLive === false) return;
  const list = staleLive(tabItems(), 6 * 3600e3);
  if (!list.length) return;
  const btn = $('[data-live]');
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  toast('обновляю цены: ' + list.length + '…');
  try {
    const map = await liveBulk(list, (d, n) => {
      if (n > 3) toast('цены: ' + d + ' из ' + n + '…');
    });
    const cnt = applyLive(list, map);
    if (cnt) { save(); render(); toast('цены обновлены: ' + cnt); }
  } catch (e) {
    /* тихо: снимок каталога остаётся на месте */
  } finally {
    const b = $('[data-live]');
    if (b) { b.disabled = false; b.classList.remove('busy'); }
  }
}
const LIVE_BUSY = new Set();
async function refreshOne(id, quiet) {
  const it = findItem(id);
  if (!it) return false;
  const name = hashName(it);
  if (LIVE_BUSY.has(name)) return false;
  LIVE_BUSY.add(name);
  if (!quiet) toast('запрашиваю цену…');
  try {
    const map = await liveBulk([it]);
    const row = map[name];
    if (row && row.price != null) {
      liveSet(name, row.price);
      it.live = row.price;
      it.liveTs = S.live[name][1];
      save(); render();
      if (currentItemId === id) openItem(id);
      if (!quiet) toast('цена обновлена');
      return true;
    }
    if (!quiet) toast('на ТП нет лотов');
    return false;
  } catch (e) {
    if (!quiet) toast('ошибка: ' + e.message);
    return false;
  } finally {
    LIVE_BUSY.delete(name);
  }
}
/* догрузить живые цены на все износы/качества открытого скина */
async function refreshWears(baseId) {
  const it = findItem(baseId);
  if (!it) return;
  const c = CAT.items[it.base];
  if (!c) return;
  const list = [];
  if (c.w) {
    for (const q of ['n', 's', 'v']) {
      if (!qualHas(c, q)) continue;
      WEARS.forEach((w, i) => {
        list.push({base: it.base, q, w: i});
      });
    }
  } else {
    for (const q of ['n', 's', 'v']) {
      if (qualHas(c, q)) list.push({base: it.base, q, w: null});
    }
  }
  const names = [...new Set(list.map(hashName))];
  toast('цены по износам: ' + names.length + ' запросов…');
  try {
    const map = await liveBulk(list, (d, n) => {
      if (n > 3) toast('износы: ' + d + ' из ' + n + '…');
    });
    let n = 0;
    for (const [name, row] of Object.entries(map)) {
      if (row && row.price != null) { liveSet(name, row.price); n++; }
    }
    save(); render();
    if (currentItemId === baseId) openItem(baseId);
    toast(n ? 'обновлено износов: ' + n : 'лотов не нашлось');
  } catch (e) {
    toast('ошибка: ' + e.message);
  }
}

/* ---------- фоновый долив цен ----------
   Человек платит запросами только за то, что нужно ему:
   1) своё — предметы из обеих вкладок, у которых цена старше 6 часов;
      дорогие первыми (сильнее всего влияют на проценты);
   2) общее — маленькая квота самых старых цен (по умолчанию 5 за сеанс,
      ставится 0). Это не прогон каталога: 13 925 предметов не качает никто.
   Темп держит jinaSlot (18 в минуту), поэтому фон не ловит 429 и не мешает. */
const LIVE_TTL = 6 * 3600e3;
const TOPUP = {running: false, duty: 0, done: 0, total: 0, bad: new Set(), fails: 0};

function myNames() {
  const s = new Set();
  for (const k of ['now', 'dream']) for (const it of S.items[k]) s.add(hashName(it));
  return s;
}

function ownStale() {
  const act = tabItems();
  const other = S.tab === 'now' ? S.items.dream : S.items.now;
  const seen = new Set(), out = [];
  for (const it of [...act, ...other]) {
    const name = hashName(it);
    if (seen.has(name) || TOPUP.bad.has(name)) continue;
    seen.add(name);
    const ts = Date.parse(liveTs(name) || '');
    if (liveGet(name) != null && isFinite(ts) && Date.now() - ts <= LIVE_TTL) continue;
    out.push({name, price: itemPrice(it) || 0});
  }
  return out.sort((a, b) => b.price - a.price);
}

/* самые старые записи базы, которых нет в списках человека */
function oldestStale(n) {
  const mine = myNames(), now = Date.now(), rows = [];
  for (const [name, row] of Object.entries(S.live || {})) {
    if (mine.has(name) || TOPUP.bad.has(name)) continue;
    const t = Date.parse(row && row[1]);
    if (!isFinite(t) || now - t <= LIVE_TTL) continue;
    rows.push({name, t});
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.slice(0, n).map(r => r.name);
}

function topUpProgress() {
  const own = ownStale().length;
  const left = Math.max(0, (S.help | 0) - TOPUP.duty);
  TOPUP.total = TOPUP.done + own + (left ? oldestStale(left).length : 0);
}

/* цена одного имени: через сборщик, если задан, иначе через прокси */
async function priceOne(name) {
  const base = proxyBase();
  if (!base) return await jinaOne(name);
  const r = await fetch(base + '/bulk', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({names: [name], cur: 1}),
    signal: deadline(25000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const row = d && d.items && d.items[name];
  return row && row.price != null ? row.price : null;
}

/* ---------- общая база ----------
   Бесплатные «хранилища без регистрации» к 2026 либо умерли, либо режут
   запросы: kvdb требует email, jsonblob/extendsclass/paste.rs не отвечают,
   ntfy и MQTT публичные брокеры недоступны. Зато GitHub уже есть, отдаёт
   CORS и хранит data/live.json. Поэтому обмен идёт через репозиторий:
   кто обновил цены и вписал свой токен — вливает их в базу, остальные
   получают их при следующем открытии. Токен остаётся в этом браузере. */
const REPO = 'r1t0otrme/cs2-dream';
const BRANCH = 'main';
const SHARE_KEY = 'cs2dream.share';

function sharePending() {
  try { return JSON.parse(localStorage.getItem(SHARE_KEY) || '[]'); } catch (e) { return []; }
}
/* очередь на отправку: копим всё, что обновили */
function sharePush(name, price) {
  try {
    const q = sharePending();
    q.push([name, price, Date.now()]);
    localStorage.setItem(SHARE_KEY, JSON.stringify(q.slice(-500)));
  } catch (e) { /* переполнение — не страшно */ }
}
function shareClear(upto) {
  try {
    localStorage.setItem(SHARE_KEY, JSON.stringify(sharePending().filter(r => (r[2] || 0) > upto)));
  } catch (e) {}
}
function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function unb64utf8(s) {
  const bin = atob(String(s || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function downloadPack(prices) {
  const blob = new Blob([JSON.stringify({generated: new Date().toISOString(), prices}, null, 0)],
    {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'live.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

let shareBusy = false;
async function flushShare(quiet) {
  if (shareBusy) return false;
  const q = sharePending();
  if (!q.length) {
    if (!quiet) toast('нечем делиться — сначала обнови цены');
    return false;
  }
  const fresh = {};
  for (const row of q) {
    const name = row[0], price = +row[1], ts = +row[2] || Date.now();
    if (!name || !(price > 0) || !isFinite(price) || price > 1e6) continue;
    const iso = new Date(ts).toISOString();
    if (!fresh[name] || fresh[name][1] < iso) fresh[name] = [price, iso];
  }
  const names = Object.keys(fresh);
  if (!names.length) { if (!quiet) toast('нечего отправлять'); return false; }

  const token = String(S.ghToken || '').trim();
  if (!token) {
    downloadPack(fresh);
    if (!quiet) toast('токена нет — скачал live.json, положи его в data/');
    return false;
  }

  const cutoff = Date.now();
  shareBusy = true;
  if (!quiet) toast('отправляю в общую базу: ' + names.length + '…');
  try {
    const url = 'https://api.github.com/repos/' + REPO + '/contents/data/live.json';
    const auth = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json'};
    let sha = null, prices = {};
    const g = await fetch(url + '?ref=' + BRANCH, {headers: auth, cache: 'no-store'});
    if (g.ok) {
      const d = await g.json();
      sha = d.sha;
      try { prices = (JSON.parse(unb64utf8(d.content)) || {}).prices || {}; } catch (e) { prices = {}; }
    } else if (g.status !== 404) {
      throw new Error(g.status === 401 || g.status === 403 ? 'токен не подходит' : 'HTTP ' + g.status);
    }
    let added = 0;
    for (const n of names) {
      const cur = prices[n];
      if (!cur || String(fresh[n][1]) > String(cur[1])) { prices[n] = fresh[n]; added++; }
    }
    if (!added) {
      shareClear(cutoff);
      if (!quiet) toast('в базе уже свежее — отправлять нечего');
      return true;
    }
    const doc = {generated: new Date().toISOString(), prices};
    const body = {
      message: 'цены: +' + added + ' (в базе ' + Object.keys(prices).length + ')',
      content: b64utf8(JSON.stringify(doc)),
      branch: BRANCH
    };
    if (sha) body.sha = sha;
    const w = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({'Content-Type': 'application/json'}, auth),
      body: JSON.stringify(body)
    });
    if (!w.ok) throw new Error(w.status === 409 ? 'кто-то успел раньше — попробуй ещё раз' : 'HTTP ' + w.status);
    shareClear(cutoff);
    if (!quiet) toast('в общей базе: +' + added + ' цен');
    setTimeout(() => loadLive().then(n => { if (n) render(); }), 2000);
    return true;
  } catch (e) {
    if (!quiet) toast('общая база: ' + e.message);
    return false;
  } finally {
    shareBusy = false;
  }
}

/* тихая отправка после долива: не чаще раза в 10 минут */
function shareAuto() {
  if (!S.shareAuto || !String(S.ghToken || '').trim()) return;
  if (!sharePending().length) return;
  const last = +localStorage.getItem('cs2dream.shareAt') || 0;
  if (Date.now() - last < 20 * 60e3) return;
  localStorage.setItem('cs2dream.shareAt', String(Date.now()));
  flushShare(true);
}

async function topUpRun() {
  if (TOPUP.running) return;
  if (S.topUp === false && S.autoLive === false) return;
  if (document.visibilityState === 'hidden') return;
  TOPUP.running = true;
  TOPUP.bad.clear();
  TOPUP.fails = 0;
  TOPUP.done = 0;
  let changed = false;
  try {
    for (;;) {
      if (document.visibilityState === 'hidden') break;
      let name = ownStale()[0]?.name || null;
      let duty = false;
      if (!name && S.topUp !== false && (S.help | 0) > TOPUP.duty) {
        name = oldestStale(1)[0] || null;
        duty = !!name;
      }
      if (!name) break;
      if (LIVE_BUSY.has(name)) { TOPUP.bad.add(name); continue; }
      topUpProgress();
      renderBars();
      LIVE_BUSY.add(name);
      let price = null;
      try { price = await priceOne(name); }
      catch (e) { /* сеть или лимит — попробуем позже */ }
      LIVE_BUSY.delete(name);
      if (price == null) {
        TOPUP.bad.add(name);
        if (++TOPUP.fails >= 6) break;
        continue;
      }
      TOPUP.fails = 0;
      liveSet(name, price);
      if (duty) TOPUP.duty++;
      TOPUP.done++;
      changed = true;
      sharePush(name, price);
    }
  } finally {
    TOPUP.running = false;
    if (changed) { save(); render(); shareAuto(); }
    else { TOPUP.done = 0; TOPUP.total = 0; renderBars(); }
  }
}

/* при открытии: долив по приоритетам; если он выключен — прежний массовый путь */
function startPrices() {
  if (S.topUp !== false) return topUpRun();
  if (S.autoLive !== false) return autoLive();
}

function parseQuery(raw) {
  const toks = String(raw || '').toLowerCase().replace(/ё/g, 'е')
    .split(/[^0-9a-zа-яё★]+/).filter(Boolean);
  const f = {ql: null, wear: null, rest: []};
  for (const t of toks) {
    if (QL_WORDS[t]) { f.ql = QL_WORDS[t]; continue; }
    if (t in WEAR_WORDS) { f.wear = WEAR_WORDS[t]; continue; }
    f.rest.push(t);
  }
  return f;
}
function search(raw, limit, opt) {
  opt = opt || {};
  const f = parseQuery(raw);
  const ql = opt.ql || f.ql || null;
  const wear = opt.wear != null ? opt.wear : f.wear;
  const cat = opt.cat || 'all';
  const text = f.rest.join(' ');
  const o = {limit: limit || 60, ql, wear, cat};
  const tries = [];
  const a = norm(text);
  const b = normPlain(text);
  if (a) tries.push(a);
  if (b && b !== a) tries.push(b);
  if (!text) tries.push('');
  for (const qs of tries) {
    const res = searchTokens(qs, o);
    if (res.length) return res;
  }
  return [];
}
function searchTokens(qs, o) {
  const qt = qs.split(' ').filter(Boolean);
  const out = [];
  for (const e of IDX) {
    if (o.cat && o.cat !== 'all' && e.cat !== o.cat) continue;
    if (o.ql && !e.q[o.ql]) continue;
    if (o.wear != null) {
      const arr = e.c.p && e.c.p[o.ql || 'n'];
      if (!arr || arr[o.wear] == null) continue;
    }
    if (!qt.length) { out.push({sc: e.min || 0, e}); continue; }
    let sc = 0, ok = true;
    for (let qi = 0; qi < qt.length; qi++) {
      const t = qt[qi];
      let best = 0;
      for (const n of e.toks) {
        if (n === t) { best = 4; break; }
        if (n.startsWith(t)) { if (best < 3) best = 3; continue; }
        if (t.length > 2 && n.includes(t)) { if (best < 2) best = 2; continue; }
        if (n.length >= 3 && t.length > n.length && t.startsWith(n) && best < 2) best = 2;
        if (t.length >= 4 && Math.abs(n.length - t.length) <= 1 && lev(n, t, 1) <= 1 && best < 1.5) best = 1.5;
      }
      if (!best) { ok = false; break; }
      // первое слово запроса обычно оружие - совпадение с ним важнее
      if (qi === 0 && e.toks[0] && e.toks[0].startsWith(t)) best += 1;
      sc += best;
    }
    if (!ok) continue;
    if (norm(e.base).startsWith(norm(qs))) sc += 2;
    out.push({sc, e});
  }
  out.sort((a, b) => b.sc - a.sc ||
    (b.e.min || 0) - (a.e.min || 0) ||
    a.e.base.length - b.e.base.length);
  return out.slice(0, o.limit || 60).map(x => x.e);
}

/* ------------------------------------------------------------------ подсчёты */
function tabItems() { return S.items[S.tab]; }
function sumOf(list) {
  let s = 0;
  for (const it of list) s += itemPrice(it) || 0;
  return s;
}
/* мечта - это и есть цель.
   «Сейчас»: инвентарь / вся мечта.
   «Мечта»: тот же инвентарь, но / на 1-й порядок (зелёная)
            и / на 1+2 порядок (жёлтая, поэтому всегда меньше). */
function totals() {
  const now = sumOf(S.items.now);
  const dreamAll = sumOf(S.items.dream);
  let t1 = 0, t2 = 0;
  for (const it of S.items.dream) {
    if (it.order === 1) t1 += itemPrice(it) || 0;
    else if (it.order === 2) t2 += itemPrice(it) || 0;
  }
  return {now, dreamAll, t1, t2, tAll: t1 + t2};
}
function pct(sum, goal) { return goal > 0 ? sum / goal * 100 : 0; }

/* ------------------------------------------------------------------ отрисовка */
function renderBars() {
  const t = totals();
  let h;
  if (S.tab === 'now') {
    h = barHTML('now', '#e6b23c', 'инвентарь / мечта', t.now, t.dreamAll, 'добавь мечту');
  } else {
    h = barHTML('d1', ORD_COLOR[1], 'до 1-го порядка', t.now, t.t1, 'нет предметов 1-го порядка') +
        barHTML('d2', ORD_COLOR[2], 'до 1 + 2 порядка', t.now, t.tAll, 'нет порядка у предметов');
  }
  $('#bars').innerHTML = h + toolsHTML();
}
function barHTML(k, color, label, sum, goal, hint) {
  const p = pct(sum, goal);
  const w = goal > 0 ? clamp(p, 0, 100) : 0;
  const done = goal > 0 && sum >= goal;
  const right = goal > 0
    ? `<span class="sum mono">${money(sum)}</span><span class="goal mono">/ ${money(goal)}</span><b class="pct mono">${p.toFixed(1)}%</b>`
    : `<span class="sum mono">${money(sum)}</span><span class="goal mono">${hint}</span>`;
  return `<div class="bar ${done ? 'done' : ''}" data-k="${k}">
    <div class="bhead">
      <div class="blabel"><span class="dot" style="background:${color}"></span><b>${label}</b></div>
      <div class="bval">${right}</div>
    </div>
    <div class="track"><div class="fill" style="width:${w}%"></div></div>
  </div>`;
}
function toolsHTML() {
  const sorts = [['price-desc', 'цена ↓'], ['price-asc', 'цена ↑'], ['name', 'название']];
  if (S.tab === 'dream') sorts.unshift(['ord', 'порядок']);
  let h = `<div class="tools"><div class="seg tiny">${sorts.map(([k, l]) =>
    `<button data-sort="${k}" class="${S.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (S.tab === 'dream') {
    h += `<div class="seg tiny">${[0, 1, 2].map(n =>
      `<button data-ord="${n}" class="${S.ordFilter === n ? 'on' : ''}">${n ? n + '-й' : 'все'}</button>`).join('')}</div>`;
  }
  const busy = TOPUP.running && TOPUP.total;
  h += `<button class="livebtn ${busy ? 'busy' : ''}" data-live title="обновить цены с ТП">${
    busy ? '⟳ ' + TOPUP.done + '/' + TOPUP.total : '⟳ цены'}</button>`;
  return h + '</div>';
}

function cardHTML(it) {
  const c = (CAT && CAT.items[it.base]) || {};
  const p = itemPrice(it);
  const w = it.w == null ? null : WEARS[it.w];
  const color = c.c ? '#' + c.c : '#4b69ff';
  return `<div class="card" data-id="${it.id}" style="--c:${color}33" role="button" tabindex="0">
    <div class="thumb">
      ${it.icon ? `<img loading="lazy" src="${IMG(it.icon)}" alt="">` : '<div class="noimg">◈</div>'}
      ${w ? `<span class="wp" style="color:${w.color}">${w.code}</span>` : ''}
      ${S.tab === 'dream' && it.order ? `<span class="ord" style="color:${ORD_COLOR[it.order]}">${it.order}</span>` : ''}
    </div>
    <div class="cbody">
      <div class="cname">${esc(it.base)}</div>
      <div class="cprice mono ${p == null ? 'none' : ''}">${p == null ? 'нет цены' : money(p)}${isLive(it) ? '<i class="livedot" title="живая цена с ТП"></i>' : ''}</div>
    </div>
  </div>`;
}

function render() {
  renderBars();
  let list = tabItems().slice();
  if (S.tab === 'dream' && S.ordFilter) list = list.filter(x => x.order === S.ordFilter);
  const pd = (a, b) => (itemPrice(b) || 0) - (itemPrice(a) || 0);
  const pa = (a, b) => (itemPrice(a) || 0) - (itemPrice(b) || 0);
  if (S.sort === 'price-asc') list.sort(pa);
  else if (S.sort === 'name') list.sort((a, b) => a.base.localeCompare(b.base, 'ru'));
  else if (S.sort === 'ord') list.sort((a, b) => (a.order || 9) - (b.order || 9) || pd(a, b));
  else list.sort(pd);

  let h = '';
  if (!list.length) {
    h = `<div class="empty"><b>${S.ordFilter ? 'ничего нет в этом порядке' : (S.tab === 'now' ? 'Инвентарь пуст' : 'Список мечты пуст')}</b>
      нажми «+», чтобы добавить скин</div>`;
  }
  h += list.map(cardHTML).join('');
  h += `<div class="card add" data-add role="button" tabindex="0">
          <span class="plus">+</span><span class="txt">добавить скин</span>
        </div>`;
  $('#grid').innerHTML = h;
  $('#btnCur').textContent = CURS[S.cur].sym;
  $$('.tab').forEach(b => b.classList.toggle('is-on', b.dataset.tab === S.tab));
  renderFoot();
}
function renderFoot() {
  const t = totals();
  const gen = CAT ? new Date(CAT.generated) : null;
  const gs = gen && !isNaN(gen) ? gen.toLocaleDateString('ru-RU') : '—';
  $('#catInfo').innerHTML =
    `сейчас <b class="mono">${money(t.now)}</b> · мечта <b class="mono">${money(t.dreamAll)}</b>` +
    `<br>база: ${CAT ? CAT.count.toLocaleString('ru-RU') : 0} предметов · цены на ${gs}`;
}

/* ------------------------------------------------------------------ шторка */
const wrap = $('#sheetWrap'), sheet = $('#sheet');
let sheetToken = 0;
function openSheet(html) {
  sheetToken++;
  sheet.innerHTML = html;
  wrap.hidden = false;
  sheet.scrollTop = 0;
  requestAnimationFrame(() => wrap.classList.add('open'));
}
function closeSheet() {
  wrap.classList.remove('open');
  const my = ++sheetToken;
  setTimeout(() => {
    if (my === sheetToken && !wrap.classList.contains('open')) {
      wrap.hidden = true; sheet.innerHTML = '';
    }
  }, 240);
}
wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !wrap.hidden) closeSheet(); });

/* ------------------------------------------------------------------ добавление */
let add = {q: '', sel: null, ql: 'n', w: 0, order: 0, editId: null};

function openAdd() {
  add = {q: '', sel: null, ql: 'n', w: null, order: S.tab === 'dream' ? 1 : 0, editId: null, cat: 'all'};
  step1();
}
function catChipsHTML() {
  return CATS.map(c => `<button class="cat ${add.cat === c.k ? 'on' : ''}" data-cat="${c.k}">${c.label}</button>`).join('');
}
function step1() {
  openSheet(`
    <div class="sheet-head">
      <div class="tt"><b>Добавить скин</b><span>название на русском или английском</span></div>
      <button class="x" data-close>✕</button>
    </div>
    <div class="searchbar">
      <input id="q" placeholder="ак редлайн, awp азимов, керамбит доплер…" autocomplete="off"
             spellcheck="false" enterkeyhint="search" value="${esc(add.q)}">
      <span class="ic">🔍</span>
    </div>
    <div class="catrow" id="catrow">${catChipsHTML()}</div>
    <div class="res" id="res">${resultsHTML()}</div>
  `);
  const inp = $('#q');
  if (inp) {
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    inp.addEventListener('input', debounce(e => {
      add.q = e.target.value;
      $('#res').innerHTML = resultsHTML();
    }, 130));
  }
}
function resultsHTML() {
  const q = add.q.trim();
  const cat = add.cat || 'all';
  if (!q && cat === 'all') {
    return `<div class="hintline">начни вводить название — покажу картинки и цены.<br>
      можно фильтровать прямо в запросе: «awp ft», «кейс», «нож stattrak», «souvenir»</div>`;
  }
  if (!CAT) return `<div class="hintline">база ещё не загружена</div>`;
  const res = search(q, 60, {cat});
  if (!res.length) {
    return `<div class="hintline">ничего не нашлось. попробуй иначе: «redline», «редлайн», «awp», «карамбит»</div>`;
  }
  return `<div class="hintline">найдено: ${res.length}${q ? ' · «' + esc(q) + '»' : ''}</div>` +
    res.map(e => {
      const c = e.c;
      return `<button class="row" data-base="${esc(e.base)}">
        ${c.i ? `<img loading="lazy" src="${IMG(c.i)}" alt="">` : '<span class="ph">◈</span>'}
        <span class="rm">
          <span class="rn">${esc(e.base)}</span>
          <span class="rs">${esc(c.t || 'предмет')}${c.w ? '' : ' · без износа'}</span>
        </span>
        <span class="rp mono ${e.min == null ? 'none' : ''}">${e.min == null ? '—' : money(e.min)}</span>
      </button>`;
    }).join('');
}

function firstWear(c, q) {
  if (!c.w) return 0;
  let best = -1, bp = Infinity;
  for (let i = 0; i < WEARS.length; i++) {
    const p = priceOf(c, q, i);
    if (p != null && p < bp) { bp = p; best = i; }
  }
  return best >= 0 ? best : 0;
}
function step2() {
  const base = add.sel, c = CAT.items[base];
  const has = QUALS.filter(q => qualHas(c, q.k)).map(q => q.k);
  if (!has.includes(add.ql)) add.ql = has[0] || 'n';
  if (add.w == null) add.w = firstWear(c, add.ql);
  const wears = !!c.w;
  const price = wears ? priceOf(c, add.ql, add.w) : priceOf(c, add.ql, 0);
  openSheet(`
    <div class="sheet-head">
      <button class="x" data-back>‹</button>
      <div class="tt"><b>${esc(base)}</b><span>${esc(c.t || 'предмет')}</span></div>
      <button class="x" data-close>✕</button>
    </div>
    <div class="preview" style="--c:${c.c ? '#' + c.c : '#4b69ff'}33">
      ${c.i ? `<img src="${IMG(c.i)}" alt="">` : '<span class="noimg">◈</span>'}
    </div>
    ${qualSegHTML(has)}
    ${wears ? wearListHTML(c) : singleHTML(c)}
    ${S.tab === 'dream' ? orderSegHTML() : ''}
    <button class="primary" data-do-add>${add.editId ? 'Сохранить' : 'Добавить'}${price != null ? ' · ' + money(price) : ''}</button>
  `);
}
function qualSegHTML(has) {
  const opts = [
    {k: 's', label: 'StatTrak™', color: '#cf6a32'},
    {k: 'v', label: 'Souvenir', color: '#e8c15a'}
  ];
  return `<div class="qpills">
    ${opts.map(o => `<button class="qpill ${add.ql === o.k ? 'on' : ''}" data-q="${o.k}"
      style="--qc:${o.color}" ${has.includes(o.k) ? '' : 'disabled title="у этого предмета нет такого качества"'}>
      <span class="qdot"></span>${o.label}
    </button>`).join('')}
    <span class="qhint">${add.ql === 'n' ? 'обычный' : 'нажми ещё раз — вернуть обычный'}</span>
  </div>`;
}
function wearListHTML(c) {
  return `<div class="wearlist">${WEARS.map((w, i) => {
    const p = priceOf(c, add.ql, i);
    return `<button class="wear ${add.w === i ? 'on' : ''}" data-w="${i}" style="color:${w.color}">
      <span class="d" style="background:${w.color}"></span>
      <span class="nm">${w.en}<i>${w.ru}</i></span>
      <span class="pr mono ${p == null ? 'no' : ''}">${p == null ? 'нет лотов' : money(p)}</span>
    </button>`;
  }).join('')}</div>`;
}
function singleHTML(c) {
  const p = priceOf(c, add.ql, 0);
  return `<div class="wearlist"><div class="wear on" style="color:#4b69ff">
    <span class="d" style="background:#4b69ff"></span>
    <span class="nm">Один вариант<i>у предмета нет износа</i></span>
    <span class="pr mono ${p == null ? 'no' : ''}">${p == null ? 'нет лотов' : money(p)}</span>
  </div></div>`;
}
function orderSegHTML() {
  return `<div class="seg small">
    <button data-order="0" class="${add.order === 0 ? 'on' : ''}">без порядка</button>
    <button data-order="1" class="${add.order === 1 ? 'on' : ''}" style="color:${ORD_COLOR[1]}">1-й порядок</button>
    <button data-order="2" class="${add.order === 2 ? 'on' : ''}" style="color:${ORD_COLOR[2]}">2-й порядок</button>
  </div>`;
}

function doAdd() {
  const c = CAT.items[add.sel];
  const wears = !!c.w;
  if (add.editId) {
    const it = findItem(add.editId);
    if (it) { it.q = add.ql; it.w = wears ? add.w : null; it.order = add.order; }
  } else {
    S.items[S.tab].push({
      id: uid(), base: add.sel, q: add.ql, w: wears ? add.w : null,
      order: S.tab === 'dream' ? add.order : 0,
      icon: c.i || '', snap: wears ? priceOf(c, add.ql, add.w) : priceOf(c, add.ql, 0),
      ts: CAT.generated
    });
  }
  save(); closeSheet(); render();
  toast(add.editId ? 'сохранено' : 'добавлено');
}

/* ------------------------------------------------------------------ предмет */
function findItem(id) {
  for (const t of ['now', 'dream']) {
    const it = S.items[t].find(x => x.id === id);
    if (it) return it;
  }
  return null;
}
let currentItemId = null;
function openItem(id) {
  const it = findItem(id);
  if (!it) return;
  currentItemId = id;
  const c = CAT.items[it.base] || {};
  const p = itemPrice(it);
  const w = it.w == null ? null : WEARS[it.w];
  const live = S.tab === 'dream' || S.items.dream.includes(it);
  openSheet(`
    <div class="sheet-head">
      <div class="tt"><b>${esc(it.base)}</b>
        <span>${esc(c.t || 'предмет')}${w ? ' · ' + w.en + ' · ' + w.ru : ''}${it.q !== 'n' ? ' · ' + QUALS.find(q => q.k === it.q).label : ''}</span></div>
      <button class="x" data-close>✕</button>
    </div>
    <div class="preview" style="--c:${c.c ? '#' + c.c : '#4b69ff'}33">
      ${c.i ? `<img src="${IMG(c.i)}" alt="">` : '<span class="noimg">◈</span>'}
    </div>
    <div class="pricebig"><b class="mono">${p == null ? '—' : money(p)}</b>
      <span>${p == null ? 'нет цен' : (isLive(it) ? 'живая цена' : 'на ТП Steam')}</span></div>
    ${S.items.dream.includes(it) ? `<div class="seg small" data-order-seg>
      <button data-set-order="0" class="${!it.order ? 'on' : ''}">без порядка</button>
      <button data-set-order="1" class="${it.order === 1 ? 'on' : ''}" style="color:${ORD_COLOR[1]}">1-й</button>
      <button data-set-order="2" class="${it.order === 2 ? 'on' : ''}" style="color:${ORD_COLOR[2]}">2-й</button>
    </div>` : ''}
    ${priceTableHTML(c, it)}
    ${c.w ? `<div class="ptable-foot">
      <span>${liveWears(c, it) ? 'зелёная точка — живая цена ТП' : 'цены из снимка каталога'}</span>
      <button class="livebtn" data-live-all="${it.id}">⟳ все износы</button>
    </div>` : ''}
    <div class="btnrow">
      <button data-live-one="${it.id}">⟳ Обновить цену</button>
      <button data-edit="${it.id}">Изменить качество</button>
      <button data-market="${esc(hashName(it))}">Открыть на ТП</button>
      <button class="danger" data-del="${it.id}">Удалить</button>
    </div>
  `);
  // цену текущего варианта подтягиваем сами, если она старая
  if (!isLive(it)) setTimeout(() => refreshOne(id, true), 250);
}
function liveWears(c, it) {
  if (!c.w) return false;
  for (const q of ['n', 's', 'v']) {
    if (!qualHas(c, q)) continue;
    for (let i = 0; i < 5; i++) if (liveGet(hashName({base: it.base, q, w: i})) != null) return true;
  }
  return false;
}
function priceTableHTML(c, it) {
  if (!c.w) return '';
  const cols = QUALS.filter(q => qualHas(c, q.k));
  if (!cols.length) return '';
  const rows = WEARS.map((w, i) => {
    const cells = cols.map(q => {
      const name = hashName({base: it.base, q: q.k, w: i});
      const lv = liveGet(name);
      const v = lv != null ? lv : priceOf(c, q.k, i);
      const on = it.w === i && it.q === q.k;
      const cls = [v == null ? 'na' : '', lv != null ? 'lv' : '', on ? 'cur' : ''].filter(Boolean).join(' ');
      return `<td class="${cls}">${v == null ? '—' : money(v)}${lv != null ? '<i class="livedot"></i>' : ''}</td>`;
    }).join('');
    return `<tr><td>${w.code}</td>${cells}</tr>`;
  }).join('');
  return `<table class="ptable">
    <thead><tr><th></th>${cols.map(q => `<th>${q.short}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ------------------------------------------------------------------ настройки */
function openSettings() {
  const pending = sharePending().length;
  openSheet(`
    <div class="sheet-head">
      <div class="tt"><b>Настройки</b><span>валюты и данные</span></div>
      <button class="x" data-close>✕</button>
    </div>
    <div class="seg">
      ${Object.keys(CURS).map(k => `<button data-cur="${k}" class="${S.cur === k ? 'on' : ''}">${CURS[k].sym} ${CURS[k].code}</button>`).join('')}
    </div>
    <div class="setrow"><div class="sl">1 $ в рублях<i>курс для пересчёта</i></div>
      <input type="number" inputmode="decimal" data-rate="rub" value="${S.rate.rub}"></div>
    <div class="setrow"><div class="sl">1 $ в тенге<i>курс для пересчёта</i></div>
      <input type="number" inputmode="decimal" data-rate="kzt" value="${S.rate.kzt}"></div>
    <div class="setrow"><div class="sl">Сборщик цен<i>необязательно · для скорости и батча</i></div>
      <input type="url" data-proxy value="${esc(S.proxy)}" placeholder="пусто = Steam через прокси"></div>
    <div class="btnrow">
      <button data-act="test-proxy">Проверить сборщик</button>
    </div>
    <label class="setrow" style="cursor:pointer">
      <div class="sl">Обновлять цены при открытии<i>автоматически, если старше 6 часов</i></div>
      <input type="checkbox" data-autolive ${S.autoLive === false ? '' : 'checked'}>
    </label>
    <label class="setrow" style="cursor:pointer">
      <div class="sl">Фоновый долив<i>сначала твои скины, потом немного старых</i></div>
      <input type="checkbox" data-topup ${S.topUp === false ? '' : 'checked'}>
    </label>
    <div class="setrow"><div class="sl">Сколько старых цен обновлять за сеанс<i>0 — только свои, 5 — по умолчанию</i></div>
      <input type="number" min="0" max="200" step="1" inputmode="numeric" data-help value="${S.help}"></div>
    <div class="setrow"><div class="sl">Токен GitHub<i>для общей базы · остаётся в этом браузере</i></div>
      <input type="password" data-ghtoken value="${esc(S.ghToken)}" placeholder="github_pat_… (необязательно)" autocomplete="off" spellcheck="false"></div>
    <label class="setrow" style="cursor:pointer">
      <div class="sl">Отдавать свои цены в базу<i>тихо, не чаще раза в 20 минут</i></div>
      <input type="checkbox" data-shareauto ${S.shareAuto === false ? '' : 'checked'}>
    </label>
    <div class="btnrow">
      <button data-act="share-now">В общую базу${pending ? ' (' + pending + ')' : ''}</button>
    </div>
    <div class="btnrow" style="margin-top:14px">
      <button data-act="collect">⟳ Сборщик цен</button>
      <button data-act="export">Экспорт</button>
      <button data-act="import">Импорт</button>
    </div>
    <div class="btnrow">
      <button data-act="clear-now">Очистить «Сейчас»</button>
      <button data-act="clear-dream">Очистить «Мечту»</button>
    </div>
    <div id="io" style="margin-top:12px"></div>
    <div class="notice">
      Цель — это список «Мечта»: процент в «Сейчас» = сколько уже собрано от
      суммы мечты.<br>
      База: <b>${CAT ? CAT.count.toLocaleString('ru-RU') : 0}</b> предметов,
      снимок ${CAT ? new Date(CAT.generated).toLocaleString('ru-RU') : '—'}.<br>
      Источник: ${esc(CAT ? CAT.source : '—')}. Обновляется на GitHub раз в сутки.<br>
      Живые цены: Steam через публичный прокси, до 20 запросов в минуту.
      Обновляются <b>только твои скины</b> (обе вкладки) и ещё ${S.help | 0} самых
      старых цен за сеанс — весь каталог не качается никогда.
      Сборщик в поле выше не обязателен — он лишь снимает лимит и ускоряет.<br>
      Общая база: обновлённые цены уходят в <b>data/live.json</b>, если вписан
      токен (право Contents: write на этот репозиторий). Все остальные читают
      их при открытии — это и есть «все для всех».
    </div>
  `);
}

/* ------------------------------------------------------------------ экспорт/импорт */
function exportData() {
  const txt = JSON.stringify({v: 2, cur: S.cur, rate: S.rate, proxy: S.proxy, items: S.items}, null, 1);
  const box = $('#io');
  box.innerHTML = `<div class="setrow"><div class="sl">скопируй или сохрани файл</div></div>
    <textarea class="settxt" readonly>${esc(txt)}</textarea>
    <div class="btnrow"><button data-act="download">Скачать .json</button>
    <button data-act="copy">Копировать</button></div>`;
  box.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
function importData() {
  const box = $('#io');
  box.innerHTML = `<textarea class="settxt" id="imp" placeholder="вставь сюда json из экспорта"></textarea>
    <div class="btnrow"><button data-act="do-import">Загрузить</button></div>`;
  box.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
function applyImport() {
  try {
    const d = JSON.parse($('#imp').value);
    if (!d || !d.items) throw new Error('нет items');
    S.items = {now: d.items.now || [], dream: d.items.dream || []};
    if (d.cur && CURS[d.cur]) S.cur = d.cur;
    if (d.rate) S.rate = Object.assign(S.rate, d.rate);
    if (d.proxy !== undefined) S.proxy = String(d.proxy || '');
    save(); render(); closeSheet(); toast('импортировано');
  } catch (e) { toast('не получилось: ' + e.message); }
}

/* ------------------------------------------------------------------ события */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  S.tab = b.dataset.tab; save(); render();
});
$('#btnCur').addEventListener('click', () => {
  const ks = Object.keys(CURS);
  S.cur = ks[(ks.indexOf(S.cur) + 1) % ks.length];
  save(); render();
});
$('#btnMenu').addEventListener('click', openSettings);

$('#grid').addEventListener('click', e => {
  if (e.target.closest('[data-add]')) return openAdd();
  const card = e.target.closest('.card[data-id]');
  if (card) openItem(card.dataset.id);
});
$('#grid').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  card.hasAttribute('data-add') ? openAdd() : openItem(card.dataset.id);
});
$('#bars').addEventListener('click', e => {
  const s = e.target.closest('[data-sort]');
  if (s) { S.sort = s.dataset.sort; save(); render(); return; }
  const o = e.target.closest('[data-ord]');
  if (o) { S.ordFilter = +o.dataset.ord; save(); render(); return; }
  if (e.target.closest('[data-live]')) { refreshLive(); }
});

/* шторка: делегирование */
sheet.addEventListener('click', e => {
  const t = e.target;
  const row = t.closest('[data-base]');
  if (row) { add.sel = row.dataset.base; add.w = null; step2(); return; }
  if (t.closest('[data-back]')) { step1(); return; }

  const cc = t.closest('[data-cat]');
  if (cc) {
    add.cat = cc.dataset.cat;
    const cr = $('#catrow'); if (cr) cr.innerHTML = catChipsHTML();
    const rs = $('#res'); if (rs) rs.innerHTML = resultsHTML();
    return;
  }

  const q = t.closest('[data-q]');
  if (q && !q.disabled) {
    const c = CAT.items[add.sel];
    if (add.ql === q.dataset.q) {
      // повторное нажатие выключает -> обычный
      add.ql = qualHas(c, 'n') ? 'n' : (QUALS.find(x => qualHas(c, x.k)) || QUALS[0]).k;
    } else {
      add.ql = q.dataset.q;
    }
    // если у выбранного износа нет цены в новом качестве - берём самый дешёвый
    if (priceOf(c, add.ql, add.w) == null) add.w = firstWear(c, add.ql);
    step2(); return;
  }

  const w = t.closest('[data-w]');
  if (w) { add.w = +w.dataset.w; step2(); return; }

  const o = t.closest('[data-order]');
  if (o) { add.order = +o.dataset.order; step2(); return; }

  if (t.closest('[data-do-add]')) { doAdd(); return; }

  const so = t.closest('[data-set-order]');
  if (so && currentItemId) {
    const it = findItem(currentItemId);
    if (it) { it.order = +so.dataset.setOrder; save(); openItem(it.id); render(); }
    return;
  }
  const ed = t.closest('[data-edit]');
  if (ed) {
    const it = findItem(ed.dataset.edit);
    if (it) {
      add = {q: '', sel: it.base, ql: it.q, w: it.w == null ? 0 : it.w, order: it.order || 0, editId: it.id};
      step2();
    }
    return;
  }
  const mk = t.closest('[data-market]');
  if (mk) { window.open(MARKET_URL(mk.dataset.market), '_blank', 'noopener'); return; }

  const lo = t.closest('[data-live-one]');
  if (lo) { refreshOne(lo.dataset.liveOne); return; }

  const la = t.closest('[data-live-all]');
  if (la) { refreshWears(la.dataset.liveAll); return; }

  const dl = t.closest('[data-del]');
  if (dl) {
    const id = dl.dataset.del;
    for (const k of ['now', 'dream']) {
      const i = S.items[k].findIndex(x => x.id === id);
      if (i >= 0) S.items[k].splice(i, 1);
    }
    save(); closeSheet(); render(); toast('удалено');
    return;
  }

  const cur = t.closest('[data-cur]');
  if (cur) { S.cur = cur.dataset.cur; save(); render(); openSettings(); return; }

  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'collect') {
      window.open('collect.html', '_blank', 'noopener');
      return;
    }
    if (a === 'share-now') { flushShare(false); return; }
    if (a === 'export') return exportData();
    if (a === 'import') return importData();
    if (a === 'do-import') return applyImport();
    if (a === 'copy') {
      const ta = $('#io .settxt');
      navigator.clipboard?.writeText(ta.value).then(() => toast('скопировано'), () => toast('не вышло скопировать'));
      return;
    }
    if (a === 'download') {
      const ta = $('#io .settxt');
      const blob = new Blob([ta.value], {type: 'application/json'});
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = 'cs2-dream.json'; a2.click();
      setTimeout(() => URL.revokeObjectURL(a2.href), 3000);
      return;
    }
    if (a === 'test-proxy') {
      const base = proxyBase();
      if (!base) {
        toast('проверяю Steam через прокси…');
        jinaOne('Dreams & Nightmares Case')
          .then(p => toast(p != null ? 'работает: кейс $' + p.toFixed(2) : 'ответ без цены, попробуй позже'))
          .catch(e => toast('не отвечает: ' + e.message));
        return;
      }
      toast('проверяю сборщик…');
      fetch(base + '/', {cache: 'no-store'})
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
        .then(d => toast(d && d.ok ? 'сборщик на связи' : 'странный ответ'))
        .catch(e => toast('не отвечает: ' + e.message));
      return;
    }
    if (a === 'clear-now' && confirm('Очистить инвентарь «Сейчас»?')) {
      S.items.now = []; save(); render(); closeSheet(); toast('очищено'); return;
    }
    if (a === 'clear-dream' && confirm('Очистить «Мечту»?')) {
      S.items.dream = []; save(); render(); closeSheet(); toast('очищено'); return;
    }
  }
});

sheet.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.rate) {
    const v = parseFloat(t.value);
    if (isFinite(v) && v > 0) { S.rate[t.dataset.rate] = v; save(); render(); }
  }
  if (t.dataset.proxy !== undefined) {
    S.proxy = t.value.trim().replace(/\/+$/, '');
    save(); render();
  }
  if (t.dataset.autolive !== undefined) {
    S.autoLive = !!t.checked;
    save();
  }
  if (t.dataset.topup !== undefined) {
    S.topUp = !!t.checked;
    save();
    if (S.topUp) topUpRun();
  }
  if (t.dataset.help !== undefined) {
    const v = parseInt(t.value, 10);
    S.help = isFinite(v) ? Math.max(0, Math.min(200, v)) : 5;
    save();
    if (S.topUp) topUpRun();
  }
  if (t.dataset.ghtoken !== undefined) {
    S.ghToken = t.value.trim();
    save();
    toast(S.ghToken ? 'токен сохранён в этом браузере' : 'токен убран');
  }
  if (t.dataset.shareauto !== undefined) {
    S.shareAuto = !!t.checked;
    save();
  }
});

/* ------------------------------------------------------------------ запуск */
function setBoot(p, msg) {
  const bar = $('#bootBar'); if (bar) bar.style.width = clamp(p, 4, 100) + '%';
  if (msg) { const m = $('#bootMsg'); if (m) m.textContent = msg; }
}
function failBoot(title, sub) {
  setBoot(100);
  $('#boot').innerHTML = `<div class="boot-in"><div class="boot-logo">◈</div>
    <div class="boot-t">${esc(title)}</div><div class="boot-s">${sub}</div>
    <div class="boot-s" style="margin-top:14px;line-height:1.7">
      если открыл файл напрямую — запусти <b>start.bat</b><br>или открой страницу на GitHub Pages</div></div>`;
}

async function boot() {
  try {
    if (window.__CATALOG__) {
      // офлайн-сборка: база уже внутри html
      setBoot(90, 'читаю встроенную базу…');
      CAT = window.__CATALOG__;
      buildIndex();
      setBoot(100);
    } else {
      const res = await fetch('data/catalog.json', {cache: 'no-store'});
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = +(res.headers.get('content-length') || 0);
      let buf = '';
      if (res.body && total) {
        const rd = res.body.getReader(), dec = new TextDecoder();
        let got = 0;
        for (;;) {
          const {done, value} = await rd.read();
          if (done) break;
          got += value.length;
          buf += dec.decode(value, {stream: true});
          setBoot(8 + 84 * got / total, 'загружаю базу цен… ' + (got / 1048576).toFixed(1) + ' МБ');
        }
        buf += dec.decode();
      } else {
        setBoot(40, 'загружаю базу цен…');
        buf = await res.text();
      }
      setBoot(94, 'разбираю…');
      CAT = JSON.parse(buf);
      buildIndex();
      setBoot(100);
    }
  } catch (e) {
    failBoot('не удалось загрузить базу', esc(e.message));
    return;
  }
  S.items.dream = S.items.dream || [];
  S.items.now = S.items.now || [];
  render();
  $('#boot').classList.add('off');
  setTimeout(() => { const b = $('#boot'); if (b) b.remove(); }, 500);
  loadLive().then(n => {
    if (n) { render(); toast('цены из базы: ' + n); }
    setTimeout(() => { startPrices(); }, 400);
  });

  // вернулся на вкладку — подхватываю новое из базы и продолжаю долив
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastLiveLoad > 3 * 60e3) {
      const n = await loadLive();
      if (n) { render(); toast('цены из базы: ' + n); }
    }
    startPrices();
  });
}

boot();
