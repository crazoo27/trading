/* Sumber data harga. Semua sumber guna format simbol gaya Binance (cth BTCUSDT) di dalam app.
 * App cuba ikut turutan dan guna sumber pertama yang berjaya — penting sebab sesetengah
 * exchange disekat di negara tertentu (cth Binance di Malaysia). */
window.TD = window.TD || {};
(() => {
  'use strict';

  const QUOTES = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL', 'JPY'];
  const split = (s) => { const q = QUOTES.find(q => s.endsWith(q) && s.length > q.length); return q ? [s.slice(0, -q.length), q] : [s, '']; };
  const SEC = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400, '1w': 604800 };

  const notFound = () => { const e = new Error('Pair tiada'); e.notFound = true; return e; };

  async function getJson(url, ms = 7000) {
    // had masa: network yang menyekat selalunya buat request tergantung, bukan gagal terus
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  // WebSocket dengan had masa sambungan + ping. Pulangkan fungsi untuk tutup.
  // stallMs: kalau tiada sebarang mesej selama tempoh ni, anggap sambungan dah mati dan tutup (app akan sambung semula).
  // Phone yang dikunci selalunya tinggalkan soket "terbuka" tapi senyap — tanpa ni chart boleh beku tanpa disedari.
  function socket(url, { onOpen, onMessage, onClose, ping, stallMs }) {
    let closedByUs = false, pingT = null, stallT = null, lastMsg = Date.now(), done = false;
    const s = new WebSocket(url);
    const cleanup = () => { clearTimeout(connectT); clearInterval(pingT); clearInterval(stallT); };
    const fail = () => { if (done) return; done = true; cleanup(); try { s.close(); } catch {} if (!closedByUs) onClose && onClose(); };
    const connectT = setTimeout(() => { if (s.readyState !== 1) fail(); }, 10000);
    s.onopen = () => {
      clearTimeout(connectT);
      lastMsg = Date.now();
      onOpen && onOpen(s);
      if (ping) pingT = setInterval(() => { try { s.send(ping); } catch {} }, 20000);
      if (stallMs) stallT = setInterval(() => { if (Date.now() - lastMsg > stallMs) fail(); }, 5000);
    };
    s.onmessage = (ev) => { lastMsg = Date.now(); try { onMessage(ev.data, s); } catch { /* mesej rosak diabaikan */ } };
    s.onclose = fail;
    s.onerror = fail;
    return () => { closedByUs = true; done = true; cleanup(); try { s.close(); } catch {} };
  }

  // minggu bermula Isnin (00:00 UTC), sama macam Binance/OKX
  const bucketOf = (t, sec) => sec === 604800 ? Math.floor((t - 345600) / sec) * sec + 345600 : Math.floor(t / sec) * sec;

  // ---------- Binance ----------
  const binance = {
    id: 'binance', label: 'Binance',
    rest: ['https://api.binance.com', 'https://data-api.binance.vision'],
    wss: ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'],
    idx: 0,
    async get(path) {
      let last;
      for (let k = 0; k < this.rest.length; k++) {
        const i = (this.idx + k) % this.rest.length;
        try { const j = await getJson(this.rest[i] + path); this.idx = i; return j; }
        catch (e) { last = e; if (e.status === 400) throw notFound(); }
      }
      throw last;
    },
    async history(sym, iv) {
      const raw = await this.get(`/api/v3/klines?symbol=${sym}&interval=${iv}&limit=1000`);
      return raw.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    },
    async symbols() {
      return (await this.get('/api/v3/ticker/price')).map(x => ({ s: x.symbol, p: +x.price })).filter(x => x.p > 0);
    },
    openKline(sym, iv, h) {
      return socket(`${this.wss[this.idx]}/ws/${sym.toLowerCase()}@kline_${iv}`, {
        onOpen: () => h.onOpen && h.onOpen(), onClose: h.onClose,
        onMessage: (d) => {
          const k = JSON.parse(d).k; if (!k) return;
          h.onCandle({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }, k.x);
        },
      });
    },
    openTickers(syms, h) {
      return socket(`${this.wss[this.idx]}/stream?streams=${syms.map(s => s.toLowerCase() + '@miniTicker').join('/')}`, {
        onClose: h.onClose,
        onMessage: (d) => {
          const x = JSON.parse(d).data; if (!x) return;
          h.onTick(x.s, { price: +x.c, open: +x.o, high: +x.h, low: +x.l, qvol: +x.q });
        },
      });
    },
  };

  // ---------- OKX ----------
  const OKX_BAR = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '1d': '1Dutc', '1w': '1Wutc' };
  const okxInst = (s) => { const [b, q] = split(s); return q ? `${b}-${q}` : s; };
  const okxSym = (id) => id.replace('-', '');
  const okxRow = (r) => ({ time: Math.floor(+r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] });
  const okx = {
    id: 'okx', label: 'OKX',
    async get(path) {
      const j = await getJson('https://www.okx.com' + path);
      if (j.code !== '0') { if (j.code === '51001') throw notFound(); throw new Error(`OKX ${j.code} ${j.msg}`); }
      return j.data;
    },
    // 4 halaman (300 candle setiap satu) diminta SERENTAK: masa muat = satu permintaan, bukan empat berturut-turut.
    // Sempadan halaman dikira dari masa sekarang, bertindih 3 candle supaya tiada lompang; pendua dibuang.
    async history(sym, iv) {
      const inst = okxInst(sym), bar = OKX_BAR[iv], sec = SEC[iv];
      const T = bucketOf(Math.floor(Date.now() / 1000), sec);
      const url = (k) => `/api/v5/market/candles?instId=${inst}&bar=${bar}&limit=300` + (k ? `&after=${(T - (300 * k - 3) * sec) * 1000}` : '');
      const pages = await Promise.all([0, 1, 2, 3].map(k => this.get(url(k)).catch(e => { if (k === 0) throw e; return []; })));
      const byTime = new Map();
      for (const d of pages) for (const r of d) byTime.set(r[0], r);
      if (!byTime.size) throw notFound();
      return [...byTime.values()].map(okxRow).sort((a, b) => a.time - b.time);
    },
    async symbols() {
      return (await this.get('/api/v5/market/tickers?instType=SPOT')).map(x => ({ s: okxSym(x.instId), p: +x.last })).filter(x => x.p > 0);
    },
    openKline(sym, iv, h) {
      return socket('wss://ws.okx.com:8443/ws/v5/business', {
        ping: 'ping', stallMs: 45000, onClose: h.onClose,
        onOpen: (s) => { s.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'candle' + OKX_BAR[iv], instId: okxInst(sym) }] })); h.onOpen && h.onOpen(); },
        onMessage: (d) => {
          if (d === 'pong') return;
          const j = JSON.parse(d); if (!j.data) return;
          for (const r of j.data.slice().reverse()) h.onCandle(okxRow(r), r[8] === '1');
        },
      });
    },
    openTickers(syms, h) {
      return socket('wss://ws.okx.com:8443/ws/v5/public', {
        ping: 'ping', stallMs: 45000, onClose: h.onClose,
        onOpen: (s) => s.send(JSON.stringify({ op: 'subscribe', args: syms.map(x => ({ channel: 'tickers', instId: okxInst(x) })) })),
        onMessage: (d) => {
          if (d === 'pong') return;
          const j = JSON.parse(d); if (!j.data) return;
          for (const x of j.data) h.onTick(okxSym(x.instId), { price: +x.last, open: +x.open24h, high: +x.high24h, low: +x.low24h, qvol: +x.volCcy24h });
        },
      });
    },
  };

  // ---------- Coinbase (pair USDT/USDC dipetakan ke USD) ----------
  const CB_G = [86400, 21600, 3600, 900, 300, 60];
  const STABLE = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD'];
  const cbProd = (s) => { const [b, q] = split(s); return `${b}-${STABLE.includes(q) ? 'USD' : q}`; };
  const cbSym = (id) => { const [b, q] = id.split('-'); return b + (q === 'USD' ? 'USDT' : q); };
  function aggregate(rows, sec) {
    const out = [];
    for (const r of rows) {
      const b = bucketOf(r.time, sec), last = out[out.length - 1];
      if (last && last.time === b) { last.high = Math.max(last.high, r.high); last.low = Math.min(last.low, r.low); last.close = r.close; last.volume += r.volume; }
      else out.push({ ...r, time: b });
    }
    return out;
  }
  const coinbase = {
    id: 'coinbase', label: 'Coinbase',
    base: 'https://api.exchange.coinbase.com',
    _products: null,
    async products() {
      if (!this._products) {
        const list = await getJson(this.base + '/products');
        this._products = list.filter(p => p.status === 'online' && ['USD', 'USDT', 'USDC', 'BTC', 'ETH', 'EUR'].includes(p.quote_currency));
      }
      return this._products;
    },
    async history(sym, iv) {
      const sec = SEC[iv], g = CB_G.find(x => x <= sec && sec % x === 0);
      const prod = cbProd(sym);
      const pages = Math.min(4, Math.max(1, Math.ceil(600 * sec / g / 300)));
      const now = Math.floor(Date.now() / 1000);
      // semua halaman diminta serentak (julat masa setiap halaman memang dah diketahui)
      const got = await Promise.all(Array.from({ length: pages }, (_, p) => {
        const end = now - p * 300 * g, start = end - 300 * g;
        return getJson(`${this.base}/products/${prod}/candles?granularity=${g}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`)
          .catch(e => {
            if (e.status === 404 || e.status === 400) throw notFound();
            if (p === 0) throw e;
            return [];
          });
      }));
      let rows = [].concat(...got);
      if (!rows.length) throw notFound();
      rows = rows.map(r => ({ time: r[0], low: r[1], high: r[2], open: r[3], close: r[4], volume: r[5] })).sort((a, b) => a.time - b.time);
      rows = rows.filter((r, i) => i === 0 || r.time !== rows[i - 1].time);
      return g === sec ? rows : aggregate(rows, sec);
    },
    async symbols() {
      return (await this.products()).map(p => ({ s: cbSym(p.id) }));
    },
    // Coinbase tiada stream candle: bina candle sendiri daripada setiap ticker
    openKline(sym, iv, h) {
      const sec = SEC[iv];
      let cur = null;
      return socket('wss://ws-feed.exchange.coinbase.com', {
        onClose: h.onClose, stallMs: 30000,
        // 'heartbeat' hantar satu mesej sesaat, jadi pair yang sunyi pun tak disalah anggap sebagai sambungan mati
        onOpen: (s) => { s.send(JSON.stringify({ type: 'subscribe', product_ids: [cbProd(sym)], channels: ['ticker', 'heartbeat'] })); h.onOpen && h.onOpen(); },
        onMessage: (d) => {
          const m = JSON.parse(d); if (m.type !== 'ticker') return;
          const px = +m.price, t = Math.floor(new Date(m.time).getTime() / 1000), b = bucketOf(t, sec);
          if (!cur || b > cur.time) {
            if (cur) h.onCandle({ ...cur }, true);
            const last = h.lastCandle && h.lastCandle();
            cur = last && last.time === b ? { ...last } : { time: b, open: px, high: px, low: px, close: px, volume: 0 };
          }
          cur.high = Math.max(cur.high, px); cur.low = Math.min(cur.low, px); cur.close = px; cur.volume += +m.last_size || 0;
          h.onCandle({ ...cur }, false);
        },
      });
    },
    openTickers(syms, h) {
      let close = null, stopped = false;
      // langgan produk yang wujud sahaja — produk tak sah buat Coinbase putuskan sambungan
      this.products().then(list => {
        if (stopped) return;
        const ok = new Set(list.map(p => p.id));
        const ids = [...new Set(syms.map(cbProd))].filter(id => ok.has(id));
        if (!ids.length) return;
        close = socket('wss://ws-feed.exchange.coinbase.com', {
          onClose: h.onClose, stallMs: 30000,
          onOpen: (s) => s.send(JSON.stringify({ type: 'subscribe', product_ids: ids, channels: ['ticker', 'heartbeat'] })),
          onMessage: (d) => {
            const m = JSON.parse(d); if (m.type !== 'ticker') return;
            const price = +m.price;
            h.onTick(cbSym(m.product_id), { price, open: +m.open_24h, high: +m.high_24h, low: +m.low_24h, qvol: +m.volume_24h * price });
          },
        });
      }).catch(() => { if (!stopped) h.onClose && h.onClose(); });
      return () => { stopped = true; close && close(); };
    },
  };

  const ALL = [binance, okx, coinbase];

  TD.feeds = {
    ALL,
    byId: (id) => ALL.find(f => f.id === id),
    // Cuba sumber yang berjaya sebelum ni dulu. Kalau gagal, cuba semua yang lain SERENTAK
    // dan ambil yang paling cepat berjaya (supaya tak tunggu sumber yang disekat timeout satu-satu).
    async history(sym, iv, preferredId, onTry) {
      const pref = ALL.find(f => f.id === preferredId);
      let nf = 0;
      if (pref) {
        onTry && onTry(pref.label);
        try { const candles = await pref.history(sym, iv); if (candles.length) return { feed: pref, candles }; }
        catch (e) { if (e.notFound) nf++; }
      }
      const others = ALL.filter(f => f !== pref);
      onTry && onTry(others.map(f => f.label).join(' / '));
      return new Promise((resolve, reject) => {
        let pending = others.length, last;
        for (const f of others) {
          f.history(sym, iv)
            .then(candles => { if (!candles.length) throw notFound(); resolve({ feed: f, candles }); })
            .catch(e => {
              last = e; if (e.notFound) nf++;
              if (--pending === 0) { const err = new Error(last ? last.message : 'Semua sumber gagal'); err.notFound = nf > 0; reject(err); }
            });
        }
      });
    },
  };
})();
