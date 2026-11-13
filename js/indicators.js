/* Pengiraan indikator + daftar indikator yang boleh ditambah pada chart. */
window.TD = window.TD || {};
(() => {
  'use strict';

  const nulls = (n) => new Array(n).fill(null);

  // jalankan fn pada bahagian array yang bukan null, kemudian letak balik pada index asal
  function onValid(arr, fn) {
    const start = arr.findIndex(v => v != null);
    const out = nulls(arr.length);
    if (start < 0) return out;
    const res = fn(arr.slice(start));
    for (let i = 0; i < res.length; i++) out[start + i] = res[i];
    return out;
  }

  function sma(v, p) {
    const out = nulls(v.length); let sum = 0;
    for (let i = 0; i < v.length; i++) {
      sum += v[i]; if (i >= p) sum -= v[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  }
  function ema(v, p) {
    const out = nulls(v.length);
    if (v.length < p) return out;
    let prev = 0; for (let i = 0; i < p; i++) prev += v[i];
    prev /= p; out[p - 1] = prev;
    const k = 2 / (p + 1);
    for (let i = p; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }
  function rma(v, p) {
    const out = nulls(v.length);
    if (v.length < p) return out;
    let prev = 0; for (let i = 0; i < p; i++) prev += v[i];
    prev /= p; out[p - 1] = prev;
    for (let i = p; i < v.length; i++) { prev = (prev * (p - 1) + v[i]) / p; out[i] = prev; }
    return out;
  }
  function stdev(v, p) {
    const out = nulls(v.length);
    for (let i = p - 1; i < v.length; i++) {
      let m = 0; for (let j = i - p + 1; j <= i; j++) m += v[j]; m /= p;
      let s = 0; for (let j = i - p + 1; j <= i; j++) s += (v[j] - m) ** 2;
      out[i] = Math.sqrt(s / p);
    }
    return out;
  }
  function rsi(v, p = 14) {
    const out = nulls(v.length);
    if (v.length <= p) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = v[i] - v[i - 1]; d > 0 ? g += d : l -= d; }
    g /= p; l /= p;
    out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = p + 1; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      g = (g * (p - 1) + Math.max(d, 0)) / p;
      l = (l * (p - 1) + Math.max(-d, 0)) / p;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function trueRanges(c) {
    return c.map((x, i) => i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)));
  }
  const atr = (c, p = 14) => rma(trueRanges(c), p);

  function macd(v, fast, slow, sig) {
    const f = ema(v, fast), s = ema(v, slow);
    const m = v.map((_, i) => f[i] != null && s[i] != null ? f[i] - s[i] : null);
    const signal = onValid(m, a => ema(a, sig));
    const hist = m.map((x, i) => x != null && signal[i] != null ? x - signal[i] : null);
    return { m, signal, hist };
  }
  function stoch(c, kp, dp, smooth) {
    const raw = nulls(c.length);
    for (let i = kp - 1; i < c.length; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - kp + 1; j <= i; j++) { hh = Math.max(hh, c[j].high); ll = Math.min(ll, c[j].low); }
      raw[i] = hh === ll ? 50 : (c[i].close - ll) / (hh - ll) * 100;
    }
    const k = onValid(raw, a => sma(a, smooth));
    const d = onValid(k, a => sma(a, dp));
    return { k, d };
  }
  function vwap(c) {
    const out = nulls(c.length); let pv = 0, vv = 0, day = null;
    for (let i = 0; i < c.length; i++) {
      const d = Math.floor(c[i].time / 86400);
      if (d !== day) { day = d; pv = 0; vv = 0; }
      const tp = (c[i].high + c[i].low + c[i].close) / 3;
      pv += tp * c[i].volume; vv += c[i].volume;
      out[i] = vv ? pv / vv : tp;
    }
    return out;
  }
  function supertrend(c, p, mult) {
    const a = atr(c, p);
    const line = nulls(c.length), up = nulls(c.length);
    let fu = null, fl = null, trendUp = true;
    for (let i = 0; i < c.length; i++) {
      if (a[i] == null) continue;
      const hl2 = (c[i].high + c[i].low) / 2;
      const bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
      const pc = i > 0 ? c[i - 1].close : c[i].close;
      fu = fu == null || bu < fu || pc > fu ? bu : fu;
      fl = fl == null || bl > fl || pc < fl ? bl : fl;
      if (trendUp && c[i].close < fl) trendUp = false;
      else if (!trendUp && c[i].close > fu) trendUp = true;
      line[i] = trendUp ? fl : fu; up[i] = trendUp;
    }
    return { line, up };
  }
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

  const closes = (c) => c.map(x => x.close);

  /* Daftar indikator.
   * outs(c, p, colors) -> [{ data:[], kind:'line'|'hist', color, colors?:[] (warna per titik), name }]
   * overlay = dilukis atas chart harga; selain itu dapat panel sendiri. */
  const DEFS = {
    ema: {
      name: 'EMA', desc: 'Exponential Moving Average', overlay: true,
      params: [{ k: 'period', label: 'Tempoh', def: 20 }], colors: ['#f5b301'],
      label: p => `EMA ${p.period}`,
      outs: (c, p, col) => [{ data: ema(closes(c), p.period), color: col[0] }],
    },
    sma: {
      name: 'SMA', desc: 'Simple Moving Average', overlay: true,
      params: [{ k: 'period', label: 'Tempoh', def: 50 }], colors: ['#2962ff'],
      label: p => `SMA ${p.period}`,
      outs: (c, p, col) => [{ data: sma(closes(c), p.period), color: col[0] }],
    },
    bb: {
      name: 'Bollinger Bands', desc: 'Band volatiliti ± sisihan piawai', overlay: true,
      params: [{ k: 'period', label: 'Tempoh', def: 20 }, { k: 'mult', label: 'Std Dev', def: 2, step: 0.1 }],
      colors: ['#ff9800', '#2962ff', '#2962ff'],
      label: p => `BB ${p.period} ${p.mult}`,
      outs: (c, p, col) => {
        const v = closes(c), b = sma(v, p.period), s = stdev(v, p.period);
        return [
          { name: 'Basis', data: b, color: col[0] },
          { name: 'Atas', data: b.map((x, i) => x == null ? null : x + p.mult * s[i]), color: col[1] },
          { name: 'Bawah', data: b.map((x, i) => x == null ? null : x - p.mult * s[i]), color: col[2] },
        ];
      },
    },
    vwap: {
      name: 'VWAP', desc: 'Volume Weighted Average Price (reset harian UTC)', overlay: true,
      params: [], colors: ['#e040fb'], label: () => 'VWAP',
      outs: (c, p, col) => [{ data: vwap(c), color: col[0] }],
    },
    st: {
      name: 'Supertrend', desc: 'Trend ikut ATR — hijau naik, merah turun', overlay: true,
      params: [{ k: 'period', label: 'ATR', def: 10 }, { k: 'mult', label: 'Faktor', def: 3, step: 0.1 }],
      colors: ['#22c55e', '#ef4444'], label: p => `Supertrend ${p.period} ${p.mult}`,
      outs: (c, p, col) => { const s = supertrend(c, p.period, p.mult); return [{ data: s.line, colors: s.up.map(u => u ? col[0] : col[1]), color: col[0], width: 2 }]; },
    },
    vol: {
      name: 'Volume', desc: 'Volume dagangan', overlay: true, volume: true,
      params: [], colors: ['#22c55e55', '#ef444455'], label: () => 'Vol',
      outs: (c, p, col) => [{ kind: 'hist', data: c.map(x => x.volume), colors: c.map(x => x.close >= x.open ? col[0] : col[1]), color: col[0] }],
    },
    rsi: {
      name: 'RSI', desc: 'Relative Strength Index', overlay: false, levels: [70, 30],
      params: [{ k: 'period', label: 'Tempoh', def: 14 }], colors: ['#a855f7'], label: p => `RSI ${p.period}`,
      outs: (c, p, col) => [{ data: rsi(closes(c), p.period), color: col[0] }],
    },
    macd: {
      name: 'MACD', desc: 'Moving Average Convergence Divergence', overlay: false, levels: [0],
      params: [{ k: 'fast', label: 'Laju', def: 12 }, { k: 'slow', label: 'Perlahan', def: 26 }, { k: 'signal', label: 'Signal', def: 9 }],
      colors: ['#2962ff', '#ff6d00', '#26a69a', '#ef5350'], label: p => `MACD ${p.fast} ${p.slow} ${p.signal}`,
      outs: (c, p, col) => {
        const r = macd(closes(c), p.fast, p.slow, p.signal);
        return [
          { name: 'Hist', kind: 'hist', data: r.hist, colors: r.hist.map(h => h >= 0 ? col[2] : col[3]), color: col[2] },
          { name: 'MACD', data: r.m, color: col[0] },
          { name: 'Signal', data: r.signal, color: col[1] },
        ];
      },
    },
    stoch: {
      name: 'Stochastic', desc: 'Stochastic oscillator %K / %D', overlay: false, levels: [80, 20],
      params: [{ k: 'k', label: '%K', def: 14 }, { k: 'd', label: '%D', def: 3 }, { k: 'smooth', label: 'Smooth', def: 3 }],
      colors: ['#2962ff', '#ff6d00'], label: p => `Stoch ${p.k} ${p.d} ${p.smooth}`,
      outs: (c, p, col) => { const r = stoch(c, p.k, p.d, p.smooth); return [{ name: '%K', data: r.k, color: col[0] }, { name: '%D', data: r.d, color: col[1] }]; },
    },
    atr: {
      name: 'ATR', desc: 'Average True Range (volatiliti)', overlay: false,
      params: [{ k: 'period', label: 'Tempoh', def: 14 }], colors: ['#ef4444'], label: p => `ATR ${p.period}`,
      outs: (c, p, col) => [{ data: atr(c, p.period), color: col[0] }],
    },
  };

  TD.ind = { sma, ema, rma, rsi, atr, macd, stoch, vwap, supertrend, heikinAshi, DEFS };
})();
