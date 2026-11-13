/* Pengiraan indikator + daftar indikator yang boleh ditambah pada chart.
 *
 * Setiap indikator ditulis sebagai "stepper": init() beri state kosong, step(state, candle)
 * proses SATU candle dan pulangkan nilainya. Dengan cara ni app boleh simpan state selepas
 * candle kedua terakhir, dan pada setiap tick harga cuma ulang satu langkah untuk candle
 * terakhir — bukan kira semula semua candle. */
window.TD = window.TD || {};
(() => {
  'use strict';

  // ---------- blok asas (state = objek biasa supaya boleh diklon) ----------
  const maInit = () => ({ n: 0, sum: 0, v: null });
  // purata bergerak eksponen; k = 2/(p+1) untuk EMA, 1/p untuk RMA (Wilder). Benih = SMA p nilai pertama.
  function expStep(s, x, p, k) {
    s.n++;
    if (s.n < p) { s.sum += x; return null; }
    if (s.n === p) { s.sum += x; s.v = s.sum / p; return s.v; }
    s.v = x * k + s.v * (1 - k);
    return s.v;
  }
  const emaStep = (s, x, p) => expStep(s, x, p, 2 / (p + 1));
  const rmaStep = (s, x, p) => expStep(s, x, p, 1 / p);

  const smaInit = () => ({ buf: [], sum: 0 });
  function smaStep(s, x, p) {
    s.buf.push(x); s.sum += x;
    if (s.buf.length > p) s.sum -= s.buf.shift();
    return s.buf.length === p ? s.sum / p : null;
  }

  const rsiInit = () => ({ n: 0, prev: null, g: 0, l: 0 });
  function rsiStep(s, x, p) {
    if (s.prev == null) { s.prev = x; return null; }
    const d = x - s.prev; s.prev = x; s.n++;
    if (s.n <= p) {
      if (d > 0) s.g += d; else s.l -= d;
      if (s.n < p) return null;
      s.g /= p; s.l /= p;
    } else {
      s.g = (s.g * (p - 1) + Math.max(d, 0)) / p;
      s.l = (s.l * (p - 1) + Math.max(-d, 0)) / p;
    }
    return s.l === 0 ? 100 : 100 - 100 / (1 + s.g / s.l);
  }

  const atrInit = () => ({ pc: null, ma: maInit() });
  function atrStep(s, c, p) {
    const tr = s.pc == null ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - s.pc), Math.abs(c.low - s.pc));
    s.pc = c.close;
    return rmaStep(s.ma, tr, p);
  }

  // klon state (nombor, array nombor, objek bersarang)
  function cloneState(s) {
    if (Array.isArray(s)) return s.slice();
    const o = {};
    for (const k in s) { const v = s[k]; o[k] = v !== null && typeof v === 'object' ? cloneState(v) : v; }
    return o;
  }

  // ---------- versi array (untuk signal engine, ATR, dll.) ----------
  const run = (vals, init, step) => { const s = init(); return vals.map(v => step(s, v)); };
  const sma = (v, p) => run(v, smaInit, (s, x) => smaStep(s, x, p));
  const ema = (v, p) => run(v, maInit, (s, x) => emaStep(s, x, p));
  const rma = (v, p) => run(v, maInit, (s, x) => rmaStep(s, x, p));
  const rsi = (v, p = 14) => run(v, rsiInit, (s, x) => rsiStep(s, x, p));
  const atr = (c, p = 14) => run(c, atrInit, (s, x) => atrStep(s, x, p));

  function heikinAshi(c) {
    const out = [];
    for (let i = 0; i < c.length; i++) {
      const x = c[i];
      const close = (x.open + x.high + x.low + x.close) / 4;
      const open = i === 0 ? (x.open + x.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
      out.push({ time: x.time, open, close, high: Math.max(x.high, open, close), low: Math.min(x.low, open, close), volume: x.volume });
    }
    return out;
  }

  /* Daftar indikator.
   * series(col)            -> [{ kind:'line'|'hist', color, width?, name?, colored? }]  (satu per garisan)
   * init(p)                -> state
   * step(s, c, p, col, o, co) -> tulis nilai setiap garisan ke o[k] (null = tiada), warna per titik ke co[k]
   * overlay = dilukis atas chart harga; selain itu dapat panel sendiri. */
  const DEFS = {
    ema: {
      name: 'EMA', desc: 'Exponential Moving Average', overlay: true,
      params: [{ k: 'period', label: 'Tempoh', def: 20 }], colors: ['#f5b301'],
      label: p => `EMA ${p.period}`,
      series: col => [{ color: col[0] }],
      init: maInit,
      step(s, c, p, col, o) { o[0] = emaStep(s, c.close, p.period); },
    },
    sma: {
      name: 'SMA', desc: 'Simple Moving Average', overlay: true,
      params: [{ k: 'period', label: 'Tempoh', def: 50 }], colors: ['#2962ff'],
      label: p => `SMA ${p.period}`,
      series: col => [{ color: col[0] }],
      init: smaInit,
      step(s, c, p, col, o) { o[0] = smaStep(s, c.close, p.period); },
    },
    bb: {
      name: 'Bollinger Bands', desc: 'Band volatiliti ± sisihan piawai', overlay: true,
      params: [{ k: 'period', label: 'Tempoh', def: 20 }, { k: 'mult', label: 'Std Dev', def: 2, step: 0.1 }],
      colors: ['#ff9800', '#2962ff', '#2962ff'],
      label: p => `BB ${p.period} ${p.mult}`,
      series: col => [{ name: 'Basis', color: col[0] }, { name: 'Atas', color: col[1] }, { name: 'Bawah', color: col[2] }],
      init: smaInit,
      step(s, c, p, col, o) {
        const m = smaStep(s, c.close, p.period);
        if (m == null) { o[0] = o[1] = o[2] = null; return; }
        let v = 0; for (const x of s.buf) v += (x - m) * (x - m);
        const sd = Math.sqrt(v / p.period);
        o[0] = m; o[1] = m + p.mult * sd; o[2] = m - p.mult * sd;
      },
    },
    vwap: {
      name: 'VWAP', desc: 'Volume Weighted Average Price (reset harian UTC)', overlay: true,
      params: [], colors: ['#e040fb'], label: () => 'VWAP',
      series: col => [{ color: col[0] }],
      init: () => ({ day: null, pv: 0, vv: 0 }),
      step(s, c, p, col, o) {
        const d = Math.floor(c.time / 86400);
        if (d !== s.day) { s.day = d; s.pv = 0; s.vv = 0; }
        const tp = (c.high + c.low + c.close) / 3;
        s.pv += tp * c.volume; s.vv += c.volume;
        o[0] = s.vv ? s.pv / s.vv : tp;
      },
    },
    st: {
      name: 'Supertrend', desc: 'Trend ikut ATR — hijau naik, merah turun', overlay: true,
      params: [{ k: 'period', label: 'ATR', def: 10 }, { k: 'mult', label: 'Faktor', def: 3, step: 0.1 }],
      colors: ['#22c55e', '#ef4444'], label: p => `Supertrend ${p.period} ${p.mult}`,
      series: col => [{ color: col[0], width: 2, colored: true }],
      init: () => ({ atr: atrInit(), fu: null, fl: null, up: true, pc: null }),
      step(s, c, p, col, o, co) {
        const pc = s.pc == null ? c.close : s.pc;
        s.pc = c.close;
        const a = atrStep(s.atr, c, p.period);
        if (a == null) { o[0] = null; return; }
        const hl2 = (c.high + c.low) / 2, bu = hl2 + p.mult * a, bl = hl2 - p.mult * a;
        s.fu = s.fu == null || bu < s.fu || pc > s.fu ? bu : s.fu;
        s.fl = s.fl == null || bl > s.fl || pc < s.fl ? bl : s.fl;
        if (s.up && c.close < s.fl) s.up = false;
        else if (!s.up && c.close > s.fu) s.up = true;
        o[0] = s.up ? s.fl : s.fu; co[0] = s.up ? col[0] : col[1];
      },
    },
    vol: {
      name: 'Volume', desc: 'Volume dagangan', overlay: true, volume: true,
      params: [], colors: ['#22c55e55', '#ef444455'], label: () => 'Vol',
      series: col => [{ kind: 'hist', color: col[0], colored: true }],
      init: () => ({}),
      step(s, c, p, col, o, co) { o[0] = c.volume; co[0] = c.close >= c.open ? col[0] : col[1]; },
    },
    rsi: {
      name: 'RSI', desc: 'Relative Strength Index', overlay: false, levels: [70, 30],
      params: [{ k: 'period', label: 'Tempoh', def: 14 }], colors: ['#a855f7'], label: p => `RSI ${p.period}`,
      series: col => [{ color: col[0] }],
      init: rsiInit,
      step(s, c, p, col, o) { o[0] = rsiStep(s, c.close, p.period); },
    },
    macd: {
      name: 'MACD', desc: 'Moving Average Convergence Divergence', overlay: false, levels: [0],
      params: [{ k: 'fast', label: 'Laju', def: 12 }, { k: 'slow', label: 'Perlahan', def: 26 }, { k: 'signal', label: 'Signal', def: 9 }],
      colors: ['#2962ff', '#ff6d00', '#26a69a', '#ef5350'], label: p => `MACD ${p.fast} ${p.slow} ${p.signal}`,
      series: col => [{ name: 'Hist', kind: 'hist', color: col[2], colored: true }, { name: 'MACD', color: col[0] }, { name: 'Signal', color: col[1] }],
      init: () => ({ f: maInit(), sl: maInit(), sg: maInit() }),
      step(s, c, p, col, o, co) {
        const f = emaStep(s.f, c.close, p.fast), sl = emaStep(s.sl, c.close, p.slow);
        const m = f != null && sl != null ? f - sl : null;
        const sg = m != null ? emaStep(s.sg, m, p.signal) : null;
        const h = sg != null ? m - sg : null;
        o[0] = h; co[0] = h >= 0 ? col[2] : col[3]; o[1] = m; o[2] = sg;
      },
    },
    stoch: {
      name: 'Stochastic', desc: 'Stochastic oscillator %K / %D', overlay: false, levels: [80, 20],
      params: [{ k: 'k', label: '%K', def: 14 }, { k: 'd', label: '%D', def: 3 }, { k: 'smooth', label: 'Smooth', def: 3 }],
      colors: ['#2962ff', '#ff6d00'], label: p => `Stoch ${p.k} ${p.d} ${p.smooth}`,
      series: col => [{ name: '%K', color: col[0] }, { name: '%D', color: col[1] }],
      init: () => ({ h: [], l: [], k: smaInit(), d: smaInit() }),
      step(s, c, p, col, o) {
        s.h.push(c.high); s.l.push(c.low);
        if (s.h.length > p.k) { s.h.shift(); s.l.shift(); }
        if (s.h.length < p.k) { o[0] = o[1] = null; return; }
        const hh = Math.max(...s.h), ll = Math.min(...s.l);
        const raw = hh === ll ? 50 : (c.close - ll) / (hh - ll) * 100;
        const k = smaStep(s.k, raw, p.smooth);
        o[0] = k; o[1] = k != null ? smaStep(s.d, k, p.d) : null;
      },
    },
    atr: {
      name: 'ATR', desc: 'Average True Range (volatiliti)', overlay: false,
      params: [{ k: 'period', label: 'Tempoh', def: 14 }], colors: ['#ef4444'], label: p => `ATR ${p.period}`,
      series: col => [{ color: col[0] }],
      init: atrInit,
      step(s, c, p, col, o) { o[0] = atrStep(s, c, p.period); },
    },
  };

  TD.ind = { sma, ema, rma, rsi, atr, heikinAshi, cloneState, DEFS };
})();
