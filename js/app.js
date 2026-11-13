/* TradeDesk — chart real-time + setup builder + pemantau setup.
 * Data: Binance spot (REST untuk sejarah, WebSocket untuk live). Fallback ke mod demo kalau tak dapat sambung.
 */
(() => {
  'use strict';

  const LC = window.LightweightCharts;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- storage ----------
  const LS_KEY = 'tradedesk.v1';
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } },
    save(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* storage disekat */ } },
  };
  const saved = store.load();

  const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
  const INTERVAL_SEC = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
  const REST_BASES = ['https://api.binance.com', 'https://data-api.binance.vision'];
  const WS_BASES = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];
  const TZ_SHIFT = -new Date().getTimezoneOffset() * 60; // papar masa tempatan

  const S = {
    symbol: saved.symbol || 'BTCUSDT',
    interval: saved.interval || '15m',
    watch: saved.watch || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'PAXGUSDT'],
    balance: saved.balance ?? 1000,
    riskPct: saved.riskPct ?? 1,
    sound: saved.sound ?? true,
    autoSignal: saved.autoSignal ?? true,
    demo: saved.demo ?? false,
    show: saved.show || { ema: true, rsi: true, signals: true },
    setups: saved.setups || [],
    alerts: saved.alerts || [],
    log: saved.log || [],
    candles: [],
    tickers: {},          // sym -> { price, open }
    precision: 2,
    pick: null,
    draft: { dir: 'long', type: 'limit', entry: null, sl: null, tp1: null, tp2: null, be: true, note: '' },
    lastSignalTime: 0,
  };

  const persist = () => store.save({
    symbol: S.symbol, interval: S.interval, watch: S.watch, balance: S.balance, riskPct: S.riskPct,
    sound: S.sound, autoSignal: S.autoSignal, demo: S.demo, show: S.show,
    setups: S.setups, alerts: S.alerts, log: S.log.slice(0, 100),
  });

  // ---------- helpers ----------
  const decimalsFor = (p) => p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.01 ? 5 : 7;
  const fmt = (v, d = S.precision) => (v == null || !isFinite(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtUsd = (v) => (v == null || !isFinite(v)) ? '—' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtR = (r) => (r == null || !isFinite(r)) ? '—' : (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const priceOf = (sym) => sym === S.symbol && S.candles.length ? S.candles[S.candles.length - 1].close : S.tickers[sym]?.price;
  const decOf = (sym) => decimalsFor(priceOf(sym) || 1);

  // ---------- indicators ----------
  function ema(vals, p) {
    const out = new Array(vals.length).fill(null);
    if (vals.length < p) return out;
    let sum = 0;
    for (let i = 0; i < p; i++) sum += vals[i];
    let prev = sum / p; out[p - 1] = prev;
    const k = 2 / (p + 1);
    for (let i = p; i < vals.length; i++) { prev = vals[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }
  function rsi(vals, p = 14) {
    const out = new Array(vals.length).fill(null);
    if (vals.length <= p) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = vals[i] - vals[i - 1]; d > 0 ? g += d : l -= d; }
    g /= p; l /= p;
    out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = p + 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      g = (g * (p - 1) + Math.max(d, 0)) / p;
      l = (l * (p - 1) + Math.max(-d, 0)) / p;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function atr(c, p = 14) {
    if (c.length <= p) return null;
    let a = 0;
    for (let i = 1; i <= p; i++) a += trueRange(c, i);
    a /= p;
    for (let i = p + 1; i < c.length; i++) a = (a * (p - 1) + trueRange(c, i)) / p;
    return a;
  }
  const trueRange = (c, i) => Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));

  let IND = { e20: [], e50: [], e200: [], rsi: [] };
  function computeIndicators() {
    const closes = S.candles.map(c => c.close);
    IND = { e20: ema(closes, 20), e50: ema(closes, 50), e200: ema(closes, 200), rsi: rsi(closes, 14) };
  }

  // Signal pada candle index i (candle yang dah tutup)
  function signalAt(i) {
    const { e20, e50, e200, rsi: r } = IND;
    const c = S.candles[i];
    const out = [];
    if (i < 1 || !c) return out;
    if (e20[i - 1] != null && e50[i - 1] != null && e200[i] != null) {
      if (e20[i - 1] <= e50[i - 1] && e20[i] > e50[i] && c.close > e200[i]) out.push({ side: 'long', text: 'EMA cross ↑ (atas EMA200)' });
      if (e20[i - 1] >= e50[i - 1] && e20[i] < e50[i] && c.close < e200[i]) out.push({ side: 'short', text: 'EMA cross ↓ (bawah EMA200)' });
    }
    if (r[i - 1] != null && r[i] != null) {
      if (r[i - 1] < 30 && r[i] >= 30) out.push({ side: 'long', text: 'RSI keluar oversold' });
      if (r[i - 1] > 70 && r[i] <= 70) out.push({ side: 'short', text: 'RSI keluar overbought' });
    }
    return out;
  }

  // ---------- charts ----------
  const chartOpts = {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#0b0e14' }, textColor: '#7d8699', fontSize: 11 },
    grid: { vertLines: { color: '#151b27' }, horzLines: { color: '#151b27' } },
    rightPriceScale: { borderColor: '#242c3d' },
    timeScale: { borderColor: '#242c3d', timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: { mode: LC.CrosshairMode.Normal },
  };
  const chart = LC.createChart($('#mainChart'), chartOpts);
  const candleSeries = chart.addCandlestickSeries({
    upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444',
  });
  const volSeries = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const lineOpt = (color) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const e20S = chart.addLineSeries(lineOpt('#f5b301'));
  const e50S = chart.addLineSeries(lineOpt('#3b82f6'));
  const e200S = chart.addLineSeries({ ...lineOpt('#a855f7'), lineWidth: 2 });

  const rsiChart = LC.createChart($('#rsiChart'), { ...chartOpts, timeScale: { ...chartOpts.timeScale, visible: false } });
  const rsiS = rsiChart.addLineSeries({ color: '#a855f7', lineWidth: 1, priceLineVisible: false });
  rsiS.createPriceLine({ price: 70, color: '#ef444466', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
  rsiS.createPriceLine({ price: 30, color: '#22c55e66', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
  rsiChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

  // sync timescale
  let syncing = false;
  const sync = (a, b) => a.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (syncing || !r) return; syncing = true; b.timeScale().setVisibleLogicalRange(r); syncing = false;
  });
  sync(chart, rsiChart); sync(rsiChart, chart);

  const tShift = (t) => t + TZ_SHIFT;
  const lineData = (arr) => S.candles.map((c, i) => arr[i] == null ? { time: tShift(c.time) } : { time: tShift(c.time), value: arr[i] });
  const volBar = (c) => ({ time: tShift(c.time), value: c.volume, color: c.close >= c.open ? '#22c55e40' : '#ef444440' });
  const bar = (c) => ({ time: tShift(c.time), open: c.open, high: c.high, low: c.low, close: c.close });

  function renderAll() {
    computeIndicators();
    candleSeries.setData(S.candles.map(bar));
    volSeries.setData(S.candles.map(volBar));
    e20S.setData(S.show.ema ? lineData(IND.e20) : []);
    e50S.setData(S.show.ema ? lineData(IND.e50) : []);
    e200S.setData(S.show.ema ? lineData(IND.e200) : []);
    rsiS.setData(lineData(IND.rsi));
    renderMarkers();
    updateHeader();
  }

  function renderLast() {
    const n = S.candles.length; if (!n) return;
    computeIndicators();
    const c = S.candles[n - 1], t = tShift(c.time);
    candleSeries.update(bar(c));
    volSeries.update(volBar(c));
    if (S.show.ema) {
      if (IND.e20[n - 1] != null) e20S.update({ time: t, value: IND.e20[n - 1] });
      if (IND.e50[n - 1] != null) e50S.update({ time: t, value: IND.e50[n - 1] });
      if (IND.e200[n - 1] != null) e200S.update({ time: t, value: IND.e200[n - 1] });
    }
    if (IND.rsi[n - 1] != null) rsiS.update({ time: t, value: IND.rsi[n - 1] });
    updateHeader();
  }

  function renderMarkers() {
    if (!S.show.signals) { candleSeries.setMarkers([]); return; }
    const m = [];
    for (let i = 1; i < S.candles.length - 1; i++) {
      for (const s of signalAt(i)) {
        m.push({
          time: tShift(S.candles[i].time),
          position: s.side === 'long' ? 'belowBar' : 'aboveBar',
          color: s.side === 'long' ? '#22c55e' : '#ef4444',
          shape: s.side === 'long' ? 'arrowUp' : 'arrowDown',
          text: s.text.startsWith('RSI') ? 'RSI' : 'EMA',
        });
      }
    }
    candleSeries.setMarkers(m);
  }

  // legend
  chart.subscribeCrosshairMove(p => {
    const n = S.candles.length; if (!n) return;
    let i = n - 1;
    if (p && p.time != null) { const idx = S.candles.findIndex(c => tShift(c.time) === p.time); if (idx >= 0) i = idx; }
    const c = S.candles[i];
    const col = c.close >= c.open ? 'pos' : 'neg';
    $('#legend').innerHTML =
      `O <b class="${col}">${fmt(c.open)}</b> H <b class="${col}">${fmt(c.high)}</b> L <b class="${col}">${fmt(c.low)}</b> C <b class="${col}">${fmt(c.close)}</b>` +
      (S.show.ema ? `<br><span style="color:#f5b301">EMA20 ${fmt(IND.e20[i])}</span> · <span style="color:#3b82f6">EMA50 ${fmt(IND.e50[i])}</span> · <span style="color:#a855f7">EMA200 ${fmt(IND.e200[i])}</span>` : '') +
      (IND.rsi[i] != null ? ` · RSI ${IND.rsi[i].toFixed(1)}` : '');
  });

  // ---------- price lines (setup, alert, draft) ----------
  let priceLines = [];
  function drawLines() {
    priceLines.forEach(l => candleSeries.removePriceLine(l));
    priceLines = [];
    const add = (price, color, title, style = 0, width = 1) => {
      if (price == null || !isFinite(price)) return;
      priceLines.push(candleSeries.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: true }));
    };
    const d = S.draft;
    add(d.entry, '#d6dbe6', 'ENTRY (draf)', 2);
    add(d.sl, '#ef4444', 'SL (draf)', 2);
    add(d.tp1, '#22c55e', 'TP1 (draf)', 2);
    add(d.tp2, '#22c55e', 'TP2 (draf)', 2);
    for (const s of S.setups) {
      if (s.symbol !== S.symbol || !isOpen(s)) continue;
      const tag = (s.dir === 'long' ? 'L' : 'S') + ' ';
      add(s.entry, '#3b82f6', tag + 'Entry', 0, 2);
      add(s.sl, '#ef4444', tag + (s.sl === s.entry ? 'SL (BE)' : 'SL'), 0, 1);
      if (!s.tp1Hit) add(s.tp1, '#22c55e', tag + 'TP1');
      add(s.tp2, '#22c55e', tag + 'TP2');
    }
    for (const a of S.alerts) if (a.symbol === S.symbol) add(a.price, '#f5b301', '🔔 ' + (a.dir === 'up' ? '↑' : '↓'), 1);
  }

  // klik chart untuk pilih harga
  chart.subscribeClick(p => {
    if (!S.pick || !p.point) return;
    const price = candleSeries.coordinateToPrice(p.point.y);
    if (price == null) return;
    const v = +price.toFixed(S.precision);
    if (S.pick === 'alert') $('#fAlert').value = v;
    else { S.draft[S.pick] = v; syncDraftInputs(); }
    setPick(null);
    drawLines(); renderCalc();
  });

  function setPick(k) {
    S.pick = k;
    $$('.pick[data-pick]').forEach(b => b.classList.toggle('active', b.dataset.pick === k));
    const names = { entry: 'Entry', sl: 'Stop Loss', tp1: 'TP1', tp2: 'TP2', alert: 'Alert' };
    $('#pickBanner').textContent = k ? `Klik pada chart untuk set ${names[k]} (Esc batal)` : '';
    $('#pickBanner').classList.toggle('hidden', !k);
    $('#mainChart').style.cursor = k ? 'crosshair' : '';
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setPick(null); });

  // ---------- data feed ----------
  let klineWs = null, tickWs = null, demoTimer = null, wsBaseIdx = 0, feedGen = 0;
  const setConn = (ok) => { $('#connDot').className = 'dot ' + (ok ? 'ok' : 'bad'); };

  async function fetchJson(path) {
    let lastErr;
    for (const base of REST_BASES) {
      try {
        const r = await fetch(base + path);
        if (r.ok) return await r.json();
        lastErr = new Error('HTTP ' + r.status);
        if (r.status === 400) throw lastErr; // simbol salah: tak perlu cuba base lain
      } catch (e) { lastErr = e; if (String(e.message).includes('400')) break; }
    }
    throw lastErr;
  }

  const parseKline = (k) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });

  async function loadSymbol() {
    const gen = ++feedGen;
    closeKline();
    S.candles = [];
    $('#symName').textContent = S.symbol;
    if (S.demo) { startDemo(gen); return; }
    try {
      const raw = await fetchJson(`/api/v3/klines?symbol=${S.symbol}&interval=${S.interval}&limit=500`);
      if (gen !== feedGen) return;
      S.candles = raw.map(parseKline);
      applyPrecision();
      renderAll(); drawLines();
      chart.timeScale().scrollToRealTime();
      openKline(gen);
    } catch (e) {
      if (gen !== feedGen) return;
      if (String(e.message).includes('400')) {
        toast('Pair tak dijumpai', `${S.symbol} tiada di Binance spot.`, 'bad');
        S.watch = S.watch.filter(s => s !== S.symbol);
        S.symbol = S.watch[0] || 'BTCUSDT'; persist(); renderWatch(); loadSymbol();
        return;
      }
      toast('Tak dapat sambung ke Binance', 'Tukar ke mod demo (data simulasi). Boleh tukar balik di ⚙.', 'bad');
      S.demo = true; $('#sDemo').checked = true; persist();
      startDemo(gen); restartTickers();
    }
  }

  function applyPrecision() {
    const last = S.candles[S.candles.length - 1];
    S.precision = decimalsFor(last ? last.close : 1);
    candleSeries.applyOptions({ priceFormat: { type: 'price', precision: S.precision, minMove: Math.pow(10, -S.precision) } });
  }

  function openKline(gen) {
    const url = `${WS_BASES[wsBaseIdx]}/ws/${S.symbol.toLowerCase()}@kline_${S.interval}`;
    const ws = new WebSocket(url);
    klineWs = ws;
    ws.onopen = () => setConn(true);
    ws.onmessage = (ev) => {
      const k = JSON.parse(ev.data).k; if (!k) return;
      onKline({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }, k.x);
    };
    ws.onclose = () => {
      if (klineWs !== ws || gen !== feedGen) return;
      setConn(false);
      wsBaseIdx = (wsBaseIdx + 1) % WS_BASES.length;
      setTimeout(() => { if (gen === feedGen) resync(gen); }, 2000);
    };
    ws.onerror = () => ws.close();
  }
  // lepas putus sambungan: tarik balik candle yang terlepas, kemudian sambung semula
  async function resync(gen) {
    try {
      const raw = await fetchJson(`/api/v3/klines?symbol=${S.symbol}&interval=${S.interval}&limit=500`);
      if (gen !== feedGen) return;
      S.candles = raw.map(parseKline); renderAll(); drawLines();
    } catch { /* cuba lagi pada sambungan seterusnya */ }
    if (gen === feedGen) openKline(gen);
  }
  function closeKline() {
    if (klineWs) { const w = klineWs; klineWs = null; w.onclose = null; try { w.close(); } catch {} }
    clearInterval(demoTimer); demoTimer = null;
  }

  function onKline(c, closed) {
    const n = S.candles.length;
    const last = S.candles[n - 1];
    // julat harga yang berlaku SEJAK update sebelumnya sahaja (elak trigger palsu dari ekstrem lama dalam candle)
    let hi = c.close, lo = c.close;
    if (last && c.time === last.time) {
      hi = c.high > last.high ? c.high : Math.max(last.close, c.close);
      lo = c.low < last.low ? c.low : Math.min(last.close, c.close);
      S.candles[n - 1] = c;
    } else if (!last || c.time > last.time) {
      hi = c.high; lo = c.low;
      S.candles.push(c); if (S.candles.length > 1500) S.candles.shift();
    } else return;
    renderLast();
    S.tickers[S.symbol] = { ...(S.tickers[S.symbol] || {}), price: c.close };
    onPrice(S.symbol, c.close, hi, lo);
    if (closed) onCandleClosed();
  }

  function onCandleClosed() {
    const i = S.candles.length - 1;
    const c = S.candles[i];
    if (c.time === S.lastSignalTime) return;
    S.lastSignalTime = c.time;
    renderMarkers();
    if (!S.autoSignal) return;
    for (const s of signalAt(i)) {
      notify(`Signal ${s.side === 'long' ? 'BUY' : 'SELL'} · ${S.symbol} ${S.interval}`, `${s.text} @ ${fmt(c.close)}`, s.side === 'long' ? 'good' : 'bad',
        { label: 'Buat setup', fn: () => suggestSetup(s.side) });
    }
  }

  // tickers untuk semua pair yang dipantau (watchlist + setup + alert)
  function tickerSymbols() {
    const set = new Set(S.watch);
    S.setups.filter(isOpen).forEach(s => set.add(s.symbol));
    S.alerts.forEach(a => set.add(a.symbol));
    return [...set];
  }
  let tickKey = '';
  function restartTickers(force) {
    const syms = tickerSymbols();
    const key = (S.demo ? 'demo:' : '') + syms.join(',');
    if (!force && key === tickKey && (tickWs || S.demo)) return;
    tickKey = key;
    if (tickWs) { const w = tickWs; tickWs = null; w.onclose = null; try { w.close(); } catch {} }
    if (S.demo) return; // demo feed mengemaskini tickers sendiri
    const streams = syms.map(s => s.toLowerCase() + '@miniTicker').join('/');
    const ws = new WebSocket(`${WS_BASES[wsBaseIdx]}/stream?streams=${streams}`);
    tickWs = ws;
    ws.onmessage = (ev) => {
      const d = JSON.parse(ev.data).data; if (!d) return;
      const price = +d.c;
      S.tickers[d.s] = { price, open: +d.o };
      if (d.s !== S.symbol) onPrice(d.s, price, price, price);
      scheduleUi();
    };
    ws.onclose = () => { if (tickWs === ws) { tickWs = null; setTimeout(() => restartTickers(true), 3000); } };
    ws.onerror = () => ws.close();
  }

  // ---------- demo feed ----------
  const DEMO_BASE = { BTCUSDT: 97000, ETHUSDT: 3400, SOLUSDT: 210, BNBUSDT: 640, XRPUSDT: 2.3, PAXGUSDT: 2650, DOGEUSDT: 0.38 };
  const demoPx = {};
  function demoStep(p, vol) { return p * (1 + (Math.random() - 0.5) * vol); }
  function startDemo(gen) {
    setConn(true);
    $('#modeBadge').textContent = 'DEMO'; $('#modeBadge').classList.add('demo');
    const sec = INTERVAL_SEC[S.interval];
    const base = demoPx[S.symbol] || DEMO_BASE[S.symbol] || 100;
    const now = Math.floor(Date.now() / 1000);
    let t = Math.floor(now / sec) * sec - 499 * sec;
    let p = base * 0.9;
    const vol = 0.004 * Math.sqrt(sec / 60);
    S.candles = [];
    for (let i = 0; i < 500; i++, t += sec) {
      const o = p; let h = o, l = o;
      for (let j = 0; j < 6; j++) { p = demoStep(p, vol); h = Math.max(h, p); l = Math.min(l, p); }
      S.candles.push({ time: t, open: o, high: h, low: l, close: p, volume: Math.random() * 100 + 10 });
    }
    demoPx[S.symbol] = p;
    applyPrecision(); renderAll(); drawLines(); chart.timeScale().scrollToRealTime();
    demoTimer = setInterval(() => {
      if (gen !== feedGen) return;
      // pair lain
      for (const sym of tickerSymbols()) {
        if (sym === S.symbol) continue;
        const prev = demoPx[sym] || DEMO_BASE[sym] || 100;
        const np = demoStep(prev, 0.0015);
        demoPx[sym] = np;
        S.tickers[sym] = { price: np, open: S.tickers[sym]?.open || prev };
        onPrice(sym, np, np, np);
      }
      // pair semasa
      const last = S.candles[S.candles.length - 1];
      const nowS = Math.floor(Date.now() / 1000);
      const bucket = Math.floor(nowS / sec) * sec;
      const np = demoStep(last.close, 0.0015);
      demoPx[S.symbol] = np;
      if (bucket > last.time) {
        onKline({ ...last }, true);
        onKline({ time: bucket, open: last.close, high: Math.max(last.close, np), low: Math.min(last.close, np), close: np, volume: 1 }, false);
      } else {
        onKline({ ...last, high: Math.max(last.high, np), low: Math.min(last.low, np), close: np, volume: last.volume + Math.random() * 3 }, false);
      }
      if (!S.tickers[S.symbol].open) S.tickers[S.symbol].open = S.candles[Math.max(0, S.candles.length - 96)].open;
      scheduleUi();
    }, 700);
  }

  // ---------- setup engine ----------
  const isOpen = (s) => s.status === 'pending' || s.status === 'active';
  const riskPerUnit = (s) => Math.abs(s.entry - s.origSl);
  const rAt = (s, px) => (s.dir === 'long' ? px - s.entry : s.entry - px) / riskPerUnit(s);
  function liveR(s, px) {
    if (s.status !== 'active' || px == null) return null;
    const r = rAt(s, px);
    return s.tp1Hit && s.tp2 ? 0.5 * rAt(s, s.tp1) + 0.5 * r : r;
  }

  // dipanggil setiap kali harga berubah untuk satu simbol
  function onPrice(sym, price, hi = price, lo = price) {
    let changed = false;
    for (const s of S.setups) {
      if (s.symbol !== sym || !isOpen(s)) continue;
      const long = s.dir === 'long';
      const hitBelow = (lvl) => lo <= lvl || price <= lvl;
      const hitAbove = (lvl) => hi >= lvl || price >= lvl;
      const slHit = () => long ? hitBelow(s.sl) : hitAbove(s.sl);
      const tpHit = (lvl) => long ? hitAbove(lvl) : hitBelow(lvl);

      if (s.status === 'pending') {
        const trig = s.trigger === 'below' ? hitBelow(s.entry) : hitAbove(s.entry);
        if (trig) {
          s.status = 'active'; s.filledAt = Date.now(); changed = true;
          notify(`✅ Entry kena · ${sym}`, `${s.dir.toUpperCase()} @ ${fmt(s.entry, decOf(sym))} — setup sekarang aktif.`, 'info');
        } else if (slHit()) {
          closeSetup(s, null, 'invalid'); changed = true;
          notify(`⚠ Setup batal · ${sym}`, `Harga sentuh SL sebelum entry. Setup tak sah lagi.`, 'bad');
          continue;
        } else if (tpHit(s.tp1)) {
          closeSetup(s, null, 'missed'); changed = true;
          notify(`Setup terlepas · ${sym}`, `Harga sampai TP1 tanpa kena entry.`, 'info');
          continue;
        }
        if (s.status !== 'active') continue;
      }

      // active
      if (slHit()) {
        const be = s.tp1Hit && s.sl === s.entry;
        closeSetup(s, s.sl, be ? 'be' : 'sl'); changed = true;
        notify(be ? `Breakeven · ${sym}` : `❌ Stop loss kena · ${sym}`, `${s.dir.toUpperCase()} ditutup @ ${fmt(s.sl, decOf(sym))} (${fmtR(s.r)} / ${fmtUsd(s.pnl)})`, be ? 'info' : 'bad');
        continue;
      }
      if (!s.tp1Hit && tpHit(s.tp1)) {
        if (s.tp2) {
          s.tp1Hit = true; changed = true;
          if (s.be) s.sl = s.entry;
          notify(`🎯 TP1 kena · ${sym}`, `50% ditutup @ ${fmt(s.tp1, decOf(sym))} (+${rAt(s, s.tp1).toFixed(2)}R).${s.be ? ' SL dialih ke breakeven.' : ''}`, 'good');
        } else {
          closeSetup(s, s.tp1, 'tp'); changed = true;
          notify(`🎯 Take profit · ${sym}`, `Ditutup @ ${fmt(s.tp1, decOf(sym))} (${fmtR(s.r)} / ${fmtUsd(s.pnl)})`, 'good');
          continue;
        }
      }
      if (s.tp1Hit && s.tp2 && tpHit(s.tp2)) {
        closeSetup(s, s.tp2, 'tp'); changed = true;
        notify(`🏆 TP2 kena · ${sym}`, `Setup selesai (${fmtR(s.r)} / ${fmtUsd(s.pnl)})`, 'good');
      }
    }
    for (const a of [...S.alerts]) {
      if (a.symbol !== sym) continue;
      if ((a.dir === 'up' && (hi >= a.price || price >= a.price)) || (a.dir === 'down' && (lo <= a.price || price <= a.price))) {
        S.alerts = S.alerts.filter(x => x !== a); changed = true;
        notify(`🔔 Alert ${sym}`, `Harga ${a.dir === 'up' ? 'naik ke' : 'turun ke'} ${fmt(a.price, decOf(sym))}`, 'info');
      }
    }
    if (changed) { persist(); drawLines(); renderOpen(); renderAlerts(); renderJournal(); restartTickers(); }
    scheduleUi();
  }

  function closeSetup(s, exitPx, outcome) {
    s.status = (outcome === 'invalid' || outcome === 'missed' || outcome === 'cancel') ? 'cancelled' : 'closed';
    s.outcome = outcome; s.closedAt = Date.now();
    if (exitPx != null) {
      s.exit = exitPx;
      s.r = s.tp1Hit && s.tp2 ? 0.5 * rAt(s, s.tp1) + 0.5 * rAt(s, exitPx) : rAt(s, exitPx);
      s.pnl = s.r * s.riskUsd;
    }
  }

  // ---------- setup builder ----------
  function syncDraftInputs() {
    const d = S.draft;
    $('#fEntry').value = d.entry ?? ''; $('#fSl').value = d.sl ?? '';
    $('#fTp1').value = d.tp1 ?? ''; $('#fTp2').value = d.tp2 ?? '';
    $('#fBE').checked = d.be; $('#fNote').value = d.note;
    $$('#dirSeg button').forEach(b => b.classList.toggle('on', b.dataset.dir === d.dir));
    $$('#typeSeg button').forEach(b => b.classList.toggle('on', b.dataset.type === d.type));
  }

  function validateDraft() {
    const d = S.draft, errs = [], bad = new Set();
    const px = priceOf(S.symbol);
    const entry = d.type === 'market' ? px : d.entry;
    if (entry == null) { errs.push('Masukkan harga entry.'); bad.add('entry'); }
    if (d.sl == null) { errs.push('Stop loss wajib — jangan trade tanpa SL.'); bad.add('sl'); }
    if (d.tp1 == null) { errs.push('Masukkan TP1.'); bad.add('tp1'); }
    if (entry != null && d.sl != null && d.tp1 != null) {
      const L = d.dir === 'long';
      if (L ? d.sl >= entry : d.sl <= entry) { errs.push(L ? 'Untuk LONG, SL mesti bawah entry.' : 'Untuk SHORT, SL mesti atas entry.'); bad.add('sl'); }
      if (L ? d.tp1 <= entry : d.tp1 >= entry) { errs.push(L ? 'Untuk LONG, TP mesti atas entry.' : 'Untuk SHORT, TP mesti bawah entry.'); bad.add('tp1'); }
      if (d.tp2 != null && (L ? d.tp2 <= d.tp1 : d.tp2 >= d.tp1)) { errs.push('TP2 mesti lebih jauh dari TP1.'); bad.add('tp2'); }
    }
    return { entry, errs, bad };
  }

  function renderCalc() {
    const d = S.draft;
    const { entry, errs, bad } = validateDraft();
    $$('.field[data-f]').forEach(f => f.classList.toggle('err', bad.has(f.dataset.f) && (S.draft[f.dataset.f] != null || f.dataset.f === 'sl')));
    const riskUsd = S.balance * S.riskPct / 100;
    let html = '';
    if (entry != null && d.sl != null && !bad.has('sl')) {
      const rpu = Math.abs(entry - d.sl);
      const qty = riskUsd / rpu;
      const notional = qty * entry;
      const lev = notional / S.balance;
      const r1 = d.tp1 != null ? Math.abs(d.tp1 - entry) / rpu : null;
      const r2 = d.tp2 != null ? Math.abs(d.tp2 - entry) / rpu : null;
      html += `<span class="k">Risiko (${S.riskPct}% modal)</span><span class="v neg">${fmtUsd(riskUsd)}</span>`;
      html += `<span class="k">Jarak SL</span><span class="v">${fmt(rpu)} (${(rpu / entry * 100).toFixed(2)}%)</span>`;
      html += `<span class="k">Saiz posisi</span><span class="v big">${qty.toLocaleString('en-US', { maximumFractionDigits: qty < 1 ? 5 : 2 })} ${S.symbol.replace(/USDT$|USDC$|BUSD$/, '')}</span>`;
      html += `<span class="k">Nilai posisi</span><span class="v">${fmtUsd(notional)}${lev > 1 ? ` <span class="neg">(${lev.toFixed(1)}x leverage)</span>` : ''}</span>`;
      if (r1 != null && !bad.has('tp1')) html += `<span class="k">TP1 → R:R</span><span class="v pos">1 : ${r1.toFixed(2)} (${fmtUsd(r1 * riskUsd)})</span>`;
      if (r2 != null && !bad.has('tp2')) html += `<span class="k">TP2 → R:R</span><span class="v pos">1 : ${r2.toFixed(2)} (${fmtUsd(r2 * riskUsd)})</span>`;
      if (r1 != null && r1 < 1 && !bad.has('tp1')) html += `<span class="warn">R:R bawah 1:1 — untung kecil dari risiko. Fikir dua kali.</span>`;
      if (d.type === 'market') html += `<span class="k">Entry (market)</span><span class="v">${fmt(entry)}</span>`;
    } else {
      html += `<span class="k">Modal</span><span class="v">${fmtUsd(S.balance)}</span><span class="k">Risiko / trade</span><span class="v">${fmtUsd(riskUsd)}</span>`;
    }
    for (const e of errs) if (!(e.startsWith('Masukkan') || e.startsWith('Stop loss wajib')) || d.entry != null || d.sl != null) html += `<span class="warn">• ${esc(e)}</span>`;
    $('#calc').innerHTML = html;
    $('#btnSave').disabled = errs.length > 0;
  }

  function saveDraft() {
    const d = S.draft;
    const { entry, errs } = validateDraft();
    if (errs.length) return;
    const px = priceOf(S.symbol);
    const s = {
      id: uid(), symbol: S.symbol, interval: S.interval, dir: d.dir, entry, sl: d.sl, origSl: d.sl, tp1: d.tp1, tp2: d.tp2,
      be: d.be, note: d.note, riskUsd: S.balance * S.riskPct / 100, createdAt: Date.now(),
      status: d.type === 'market' ? 'active' : 'pending',
      trigger: entry <= px ? 'below' : 'above',
    };
    if (s.status === 'active') s.filledAt = Date.now();
    S.setups.unshift(s);
    S.draft = { ...S.draft, entry: null, sl: null, tp1: null, tp2: null, note: '' };
    persist(); syncDraftInputs(); drawLines(); renderCalc(); renderOpen(); restartTickers();
    toast('Setup disimpan', `${s.dir.toUpperCase()} ${s.symbol} — ${s.status === 'active' ? 'aktif sekarang' : 'menunggu harga ' + fmt(entry)}.`, 'good');
    switchTab('open');
  }

  // Cadang setup automatik guna ATR
  function suggestSetup(side) {
    const n = S.candles.length; if (n < 30) return;
    const i = n - 1, c = S.candles[i];
    if (!side) side = IND.e200[i] != null ? (c.close >= IND.e200[i] ? 'long' : 'short') : (IND.e20[i] >= IND.e50[i] ? 'long' : 'short');
    const a = atr(S.candles, 14);
    const entry = c.close;
    const L = side === 'long';
    const sl = L ? entry - 1.5 * a : entry + 1.5 * a;
    const risk = Math.abs(entry - sl);
    const r = (x) => +x.toFixed(S.precision);
    S.draft = { ...S.draft, dir: side, type: 'limit', entry: r(entry), sl: r(sl), tp1: r(L ? entry + 1.5 * risk : entry - 1.5 * risk), tp2: r(L ? entry + 3 * risk : entry - 3 * risk),
      note: `Auto: ${side === 'long' ? 'trend naik' : 'trend turun'} (EMA200), SL 1.5×ATR, TP 1.5R / 3R` };
    syncDraftInputs(); drawLines(); renderCalc(); switchTab('setup');
    toast('Setup dicadangkan', 'Semak dulu & ubah ikut struktur chart (support/resistance) sebelum simpan.', 'info');
  }

  // ---------- UI renders ----------
  let uiPending = false;
  function scheduleUi() {
    if (uiPending) return; uiPending = true;
    requestAnimationFrame(() => { uiPending = false; renderWatchPrices(); renderOpenLive(); });
  }

  function updateHeader() {
    const n = S.candles.length; if (!n) return;
    const px = S.candles[n - 1].close;
    const t = S.tickers[S.symbol];
    const open = t?.open ?? S.candles[Math.max(0, n - 96)].open;
    const ch = (px - open) / open * 100;
    $('#lastPrice').textContent = fmt(px);
    $('#lastChange').textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '% 24j';
    $('#lastChange').className = 'chg ' + (ch >= 0 ? 'pos' : 'neg');
    document.title = `${fmt(px)} ${S.symbol} · TradeDesk`;
    if (S.draft.type === 'market') renderCalc();
  }

  function renderIntervals() {
    $('#intervals').innerHTML = INTERVALS.map(i => `<button data-i="${i}" class="${i === S.interval ? 'on' : ''}">${i}</button>`).join('');
  }

  function renderWatch() {
    $('#watchlist').innerHTML = S.watch.map(s =>
      `<div class="wl ${s === S.symbol ? 'on' : ''}" data-s="${esc(s)}"><b>${esc(s.replace(/USDT$/, ''))}</b><span data-p="${esc(s)}">—</span><span data-c="${esc(s)}"></span>${S.watch.length > 1 ? `<span class="x" data-rm="${esc(s)}" title="Buang">✕</span>` : ''}</div>`
    ).join('');
    renderWatchPrices();
  }
  function renderWatchPrices() {
    for (const s of S.watch) {
      const t = S.tickers[s]; const pEl = $(`[data-p="${s}"]`); const cEl = $(`[data-c="${s}"]`);
      if (!t || !pEl) continue;
      pEl.textContent = fmt(t.price, decimalsFor(t.price));
      if (t.open) { const ch = (t.price - t.open) / t.open * 100; cEl.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'; cEl.className = ch >= 0 ? 'pos' : 'neg'; }
    }
  }

  function setupCard(s, closed) {
    const d = decimalsFor(s.entry);
    const statusTxt = { pending: 'Tunggu entry', active: 'AKTIF', closed: { tp: 'Profit', sl: 'Loss', be: 'Breakeven', manual: 'Tutup manual' }[s.outcome], cancelled: { invalid: 'Batal (SL dulu)', missed: 'Terlepas', cancel: 'Dibatalkan' }[s.outcome] }[s.status];
    const date = new Date(s.closedAt || s.createdAt).toLocaleString('ms-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<div class="card" data-id="${s.id}">
      <div class="hd"><b data-go="${esc(s.symbol)}">${esc(s.symbol)} <span class="muted">${esc(s.interval)}</span></b>
        <span><span class="tag ${s.dir}">${s.dir.toUpperCase()}</span> <span class="tag ${s.status}">${statusTxt}${s.tp1Hit && s.status === 'active' ? ' · TP1 ✓' : ''}</span></span></div>
      <div class="grid"><div>Entry<b>${fmt(s.entry, d)}</b></div><div>SL<b class="neg">${fmt(s.sl, d)}</b></div><div>TP1<b class="pos">${fmt(s.tp1, d)}</b></div><div>TP2<b class="pos">${s.tp2 ? fmt(s.tp2, d) : '—'}</b></div></div>
      ${closed ? (s.r != null ? `<div class="pnl ${s.r >= 0 ? 'pos' : 'neg'}">${fmtR(s.r)} · ${fmtUsd(s.pnl)} <span class="muted">${date}</span></div>` : `<div class="muted" style="margin-top:6px">${date}</div>`)
        : `<div class="pnl" data-live="${s.id}"></div>`}
      ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
      ${!closed ? `<div class="acts">${s.status === 'active' ? `<button class="btn small" data-act="close">Tutup sekarang</button>` : ''}<button class="btn small ghost" data-act="cancel">${s.status === 'active' ? 'Buang' : 'Batal'}</button></div>` : ''}
    </div>`;
  }

  function renderOpen() {
    const open = S.setups.filter(isOpen);
    $('#openCount').textContent = open.length;
    $('#openList').innerHTML = open.length ? open.map(s => setupCard(s, false)).join('') : '<div class="empty">Tiada setup dipantau.<br>Buat satu di tab Setup.</div>';
    renderOpenLive();
  }
  function renderOpenLive() {
    for (const s of S.setups) {
      if (!isOpen(s)) continue;
      const el = $(`[data-live="${s.id}"]`); if (!el) continue;
      const px = priceOf(s.symbol);
      const d = decimalsFor(s.entry);
      if (s.status === 'pending') {
        const dist = px != null ? Math.abs(px - s.entry) / px * 100 : null;
        el.innerHTML = `<span class="muted">Harga ${fmt(px, d)} · ${dist != null ? dist.toFixed(2) + '% ke entry' : ''}</span>`;
      } else {
        const r = liveR(s, px);
        el.className = 'pnl ' + (r >= 0 ? 'pos' : 'neg');
        el.textContent = `${fmtR(r)} · ${fmtUsd(r * s.riskUsd)}  @ ${fmt(px, d)}`;
      }
    }
  }

  function renderAlerts() {
    $('#alertList').innerHTML = S.alerts.length ? S.alerts.map(a => `<div class="card"><div class="hd"><b data-go="${esc(a.symbol)}">${esc(a.symbol)}</b><span>${a.dir === 'up' ? '↑ naik ke' : '↓ turun ke'} <b>${fmt(a.price, decimalsFor(a.price))}</b> <button class="btn small ghost" data-rmalert="${a.id}">✕</button></span></div></div>`).join('')
      : '<div class="empty">Tiada alert harga.</div>';
    $('#logList').innerHTML = S.log.slice(0, 40).map(l => `<div class="card"><time>${new Date(l.t).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}</time><b>${esc(l.title)}</b> — ${esc(l.body)}</div>`).join('') || '<div class="empty">Belum ada notifikasi.</div>';
  }

  function renderJournal() {
    const done = S.setups.filter(s => !isOpen(s));
    const traded = done.filter(s => s.status === 'closed');
    const wins = traded.filter(s => s.r > 0.01).length;
    const totalR = traded.reduce((a, s) => a + (s.r || 0), 0);
    const totalPnl = traded.reduce((a, s) => a + (s.pnl || 0), 0);
    const avgR = traded.length ? totalR / traded.length : 0;
    $('#stats').innerHTML = [
      ['Trade', traded.length], ['Win rate', traded.length ? Math.round(wins / traded.length * 100) + '%' : '—'], ['Purata', fmtR(avgR)],
      ['Jumlah R', fmtR(totalR)], ['P/L', fmtUsd(totalPnl)], ['Batal/terlepas', done.length - traded.length],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    $('#journalList').innerHTML = done.length ? done.slice(0, 100).map(s => setupCard(s, true)).join('') : '<div class="empty">Jurnal kosong. Setup yang selesai akan masuk sini.</div>';
  }

  function switchTab(t) {
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('.tab-body').forEach(b => b.classList.toggle('hidden', b.dataset.body !== t));
  }

  // ---------- notifications ----------
  let audioCtx = null;
  function beep(type) {
    if (!S.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const freqs = type === 'good' ? [660, 880] : type === 'bad' ? [440, 330] : [740];
      freqs.forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.15;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        o.start(t); o.stop(t + 0.15);
      });
    } catch {}
  }
  function toast(title, body, type = 'info', action) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
    if (action) {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = action.label;
      b.onclick = () => { action.fn(); el.remove(); }; el.appendChild(document.createElement('br')); el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), action ? 15000 : 6000);
  }
  function notify(title, body, type, action) {
    toast(title, body, type, action);
    beep(type);
    S.log.unshift({ t: Date.now(), title, body });
    S.log = S.log.slice(0, 100);
    persist(); renderAlerts();
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body });
    } catch {}
  }

  // ---------- events ----------
  $('#intervals').addEventListener('click', e => {
    const i = e.target.dataset.i; if (!i || i === S.interval) return;
    S.interval = i; persist(); renderIntervals(); loadSymbol();
  });
  function goSymbol(sym) {
    if (sym === S.symbol) return;
    S.symbol = sym; persist(); renderWatch(); setPick(null);
    S.draft = { ...S.draft, entry: null, sl: null, tp1: null, tp2: null };
    syncDraftInputs(); renderCalc(); loadSymbol();
  }
  $('#watchlist').addEventListener('click', e => {
    const rm = e.target.dataset.rm;
    if (rm) { e.stopPropagation(); S.watch = S.watch.filter(s => s !== rm); persist(); if (rm === S.symbol) goSymbol(S.watch[0]); renderWatch(); restartTickers(); return; }
    const w = e.target.closest('.wl'); if (w) goSymbol(w.dataset.s);
  });
  $$('.chart-tools [data-toggle]').forEach(b => {
    b.classList.toggle('on', !!S.show[b.dataset.toggle]);
    b.onclick = () => {
      const k = b.dataset.toggle; S.show[k] = !S.show[k]; b.classList.toggle('on', S.show[k]); persist();
      if (k === 'rsi') $('#rsiChart').classList.toggle('hidden', !S.show.rsi);
      renderAll();
    };
  });
  $('#rsiChart').classList.toggle('hidden', !S.show.rsi);
  $('#btnSuggest').onclick = () => suggestSetup();

  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
  $('#dirSeg').addEventListener('click', e => { const d = e.target.dataset.dir; if (d) { S.draft.dir = d; syncDraftInputs(); renderCalc(); } });
  $('#typeSeg').addEventListener('click', e => {
    const t = e.target.dataset.type; if (!t) return;
    S.draft.type = t;
    if (t === 'market') S.draft.entry = +priceOf(S.symbol).toFixed(S.precision);
    syncDraftInputs(); drawLines(); renderCalc();
  });
  [['#fEntry', 'entry'], ['#fSl', 'sl'], ['#fTp1', 'tp1'], ['#fTp2', 'tp2']].forEach(([sel, k]) => {
    $(sel).addEventListener('input', e => { S.draft[k] = num(e.target.value); drawLines(); renderCalc(); });
  });
  $('#fBE').onchange = e => { S.draft.be = e.target.checked; };
  $('#fNote').oninput = e => { S.draft.note = e.target.value; };
  $$('.pick[data-pick]').forEach(b => b.onclick = () => setPick(S.pick === b.dataset.pick ? null : b.dataset.pick));
  $('#btnNow').onclick = () => { S.draft.entry = +priceOf(S.symbol).toFixed(S.precision); syncDraftInputs(); drawLines(); renderCalc(); };
  $('#btnSave').onclick = saveDraft;
  $('#btnClear').onclick = () => { S.draft = { ...S.draft, entry: null, sl: null, tp1: null, tp2: null, note: '' }; syncDraftInputs(); drawLines(); renderCalc(); };

  document.body.addEventListener('click', e => {
    const go = e.target.closest('[data-go]'); if (go) { goSymbol(go.dataset.go); return; }
    const act = e.target.dataset.act;
    if (act) {
      const s = S.setups.find(x => x.id === e.target.closest('.card').dataset.id); if (!s) return;
      if (act === 'close') {
        const px = priceOf(s.symbol);
        if (px == null) return;
        closeSetup(s, px, 'manual');
        notify(`Setup ditutup · ${s.symbol}`, `Manual @ ${fmt(px, decOf(s.symbol))} (${fmtR(s.r)} / ${fmtUsd(s.pnl)})`, s.r >= 0 ? 'good' : 'bad');
      } else if (act === 'cancel') {
        if (s.status === 'active') S.setups = S.setups.filter(x => x !== s);
        else closeSetup(s, null, 'cancel');
      }
      persist(); drawLines(); renderOpen(); renderJournal(); restartTickers();
    }
    const rma = e.target.dataset.rmalert;
    if (rma) { S.alerts = S.alerts.filter(a => a.id !== rma); persist(); renderAlerts(); drawLines(); restartTickers(); }
  });

  $('#btnAddAlert').onclick = () => {
    const p = num($('#fAlert').value); const px = priceOf(S.symbol);
    if (p == null || px == null) return;
    S.alerts.push({ id: uid(), symbol: S.symbol, price: p, dir: p >= px ? 'up' : 'down' });
    $('#fAlert').value = '';
    persist(); renderAlerts(); drawLines(); restartTickers();
    toast('Alert ditambah', `${S.symbol} ${p >= px ? '↑' : '↓'} ${fmt(p)}`, 'info');
  };
  $('#btnClearJournal').onclick = () => {
    if (!confirm('Padam semua rekod jurnal?')) return;
    S.setups = S.setups.filter(isOpen); persist(); renderJournal();
  };

  // settings
  $('#sBalance').value = S.balance; $('#sRisk').value = S.riskPct;
  $('#sSound').checked = S.sound; $('#sAutoSignal').checked = S.autoSignal; $('#sDemo').checked = S.demo;
  $('#sBalance').oninput = e => { const v = num(e.target.value); if (v > 0) { S.balance = v; persist(); renderCalc(); } };
  $('#sRisk').oninput = e => { const v = num(e.target.value); if (v > 0 && v <= 100) { S.riskPct = v; persist(); renderCalc(); } };
  $('#sSound').onchange = e => { S.sound = e.target.checked; persist(); if (S.sound) beep('info'); };
  $('#sAutoSignal').onchange = e => { S.autoSignal = e.target.checked; persist(); };
  $('#sDemo').onchange = e => {
    S.demo = e.target.checked; persist();
    $('#modeBadge').textContent = S.demo ? 'DEMO' : 'LIVE'; $('#modeBadge').classList.toggle('demo', S.demo);
    S.tickers = {}; restartTickers(true); loadSymbol();
  };
  $('#btnNotif').onclick = async () => {
    if (!('Notification' in window)) { toast('Tak disokong', 'Browser ni tak sokong notifikasi.', 'bad'); return; }
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Notifikasi aktif' : 'Notifikasi ditolak', p === 'granted' ? 'Anda akan dapat notifikasi walaupun tab di belakang.' : 'Benarkan dalam tetapan browser.', p === 'granted' ? 'good' : 'bad');
  };
  $('#btnAddSym').onclick = () => {
    const s = $('#sAddSym').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return;
    if (!S.watch.includes(s)) S.watch.push(s);
    $('#sAddSym').value = ''; persist(); renderWatch(); restartTickers(); goSymbol(s);
  };

  // ---------- boot ----------
  $('#modeBadge').textContent = S.demo ? 'DEMO' : 'LIVE'; $('#modeBadge').classList.toggle('demo', S.demo);
  renderIntervals(); renderWatch(); syncDraftInputs(); renderCalc(); renderOpen(); renderAlerts(); renderJournal();
  loadSymbol(); restartTickers(true);

  // expose untuk debug
  window.TradeDesk = { S, onPrice, suggestSetup };
})();
