/* Enjin analisis gaya trader berpengalaman + backtester.
 *
 * Prinsip:
 *  - Ikut trend timeframe besar; masuk di zon support/resistance, bukan di tengah-tengah pergerakan.
 *  - Setiap setup mesti ada titik "salah" yang jelas (SL) dan ganjaran yang berbaloi (R:R).
 *  - "Tiada setup, tunggu" ialah jawapan yang sah — dan selalunya jawapan yang betul.
 *  - Strategi diuji pada data lama (dengan yuran) sebelum dipercayai.
 * Semua fungsi di sini tulen (tiada DOM), supaya boleh diuji. */
window.TD = window.TD || {};
(() => {
  'use strict';
  const I = TD.ind;

  // ---------- swing high / swing low (fractal) ----------
  // Candle i ialah swing high kalau high-nya tertinggi dalam L candle kiri & kanan.
  // L candle terakhir belum boleh disahkan, jadi tak dikira.
  function pivots(c, L = 3) {
    const out = [];
    for (let i = L; i < c.length - L; i++) {
      let isH = true, isL = true;
      for (let j = i - L; j <= i + L && (isH || isL); j++) {
        if (j === i) continue;
        if (c[j].high > c[i].high || (j > i && c[j].high === c[i].high)) isH = false;
        if (c[j].low < c[i].low || (j > i && c[j].low === c[i].low)) isL = false;
      }
      if (isH) out.push({ i, type: 'H', price: c[i].high });
      if (isL) out.push({ i, type: 'L', price: c[i].low });
    }
    return out;
  }

  // ---------- struktur pasaran ----------
  function structure(piv, price) {
    const hs = piv.filter(p => p.type === 'H'), ls = piv.filter(p => p.type === 'L');
    if (hs.length < 2 || ls.length < 2) return { trend: 'julat', label: 'Belum cukup swing untuk baca struktur' };
    const h1 = hs[hs.length - 2], h2 = hs[hs.length - 1], l1 = ls[ls.length - 2], l2 = ls[ls.length - 1];
    const hh = h2.price > h1.price, hl = l2.price > l1.price;
    let trend, label;
    if (hh && hl) { trend = 'naik'; label = 'Higher High + Higher Low'; }
    else if (!hh && !hl) { trend = 'turun'; label = 'Lower High + Lower Low'; }
    else { trend = 'julat'; label = hh ? 'High makin tinggi tapi low makin rendah (meluas)' : 'High makin rendah tapi low makin tinggi (menyempit)'; }
    // break of structure: harga dah tembus swing terakhir?
    let bos = null;
    if (price > h2.price) bos = 'atas';
    else if (price < l2.price) bos = 'bawah';
    return { trend, label, lastH: h2, lastL: l2, bos };
  }

  // ---------- zon support / resistance ----------
  // Swing yang harganya berdekatan (dalam ~0.5 ATR) dikumpul jadi satu zon. Lebih banyak sentuhan = zon lebih kuat.
  function zones(c, piv, atr, maxEach = 3) {
    const n = c.length, price = c[n - 1].close;
    const tol = Math.max(atr * 0.5, price * 0.0015);
    const pts = piv.slice(-80).map(p => ({ p: p.price, i: p.i })).sort((a, b) => a.p - b.p);
    const cl = [];
    for (const x of pts) {
      const z = cl[cl.length - 1];
      if (z && x.p - z.hi <= tol) { z.hi = Math.max(z.hi, x.p); z.lo = Math.min(z.lo, x.p); z.n++; z.last = Math.max(z.last, x.i); }
      else cl.push({ lo: x.p, hi: x.p, n: 1, last: x.i });
    }
    const zs = cl.map(z => {
      // zon sempit sangat dilebarkan sikit supaya realistik (harga jarang kena paras tepat)
      const pad = Math.max(0, tol * 0.6 - (z.hi - z.lo)) / 2;
      return { lo: z.lo - pad, hi: z.hi + pad, touches: z.n, age: n - 1 - z.last };
    });
    const above = zs.filter(z => z.lo > price).sort((a, b) => a.lo - b.lo).slice(0, maxEach).map((z, k) => ({ ...z, kind: 'R', name: 'R' + (k + 1) }));
    const below = zs.filter(z => z.hi < price).sort((a, b) => b.hi - a.hi).slice(0, maxEach).map((z, k) => ({ ...z, kind: 'S', name: 'S' + (k + 1) }));
    const inside = zs.filter(z => z.lo <= price && z.hi >= price).map(z => ({ ...z, kind: 'X', name: 'Zon semasa' }));
    return { above, below, inside, tol };
  }

  // ---------- divergence RSI ----------
  // Bullish: harga buat low lebih rendah, tapi RSI buat low lebih tinggi (tekanan jual makin lemah).
  // Bearish: harga buat high lebih tinggi, tapi RSI buat high lebih rendah (tekanan beli makin lemah).
  function divergence(piv, rsiArr, n, lookback = 60) {
    const lim = n - 1 - lookback;
    const lows = piv.filter(p => p.type === 'L' && p.i >= lim), highs = piv.filter(p => p.type === 'H' && p.i >= lim);
    let bull = null, bear = null;
    if (lows.length >= 2) {
      const a = lows[lows.length - 2], b = lows[lows.length - 1];
      if (b.price < a.price && rsiArr[a.i] != null && rsiArr[b.i] != null && rsiArr[b.i] > rsiArr[a.i] + 2) bull = { a, b };
    }
    if (highs.length >= 2) {
      const a = highs[highs.length - 2], b = highs[highs.length - 1];
      if (b.price > a.price && rsiArr[a.i] != null && rsiArr[b.i] != null && rsiArr[b.i] < rsiArr[a.i] - 2) bear = { a, b };
    }
    return { bull, bear };
  }

  // ---------- gambaran trend satu timeframe ----------
  function trendInfo(c) {
    const n = c.length, last = n - 1;
    if (n < 60) return null;
    const cl = c.map(x => x.close);
    const e20 = I.ema(cl, 20), e50 = I.ema(cl, 50), e200 = I.ema(cl, 200), r = I.rsi(cl, 14), a = I.atr(c, 14);
    const px = cl[last];
    const piv = pivots(c, 3);
    const st = structure(piv, px);
    let score = 0;
    if (e200[last] != null) score += px > e200[last] ? 1 : -1;
    if (e50[last] != null && e200[last] != null) score += e50[last] > e200[last] ? 1 : -1;
    else if (e50[last] != null) score += px > e50[last] ? 1 : -1;
    if (st.trend === 'naik') score++; else if (st.trend === 'turun') score--;
    const dir = score >= 2 ? 'naik' : score <= -2 ? 'turun' : 'neutral';
    // Efficiency ratio (Kaufman): 1 = bergerak lurus, 0 = berombak ke sana sini
    const k = Math.min(20, last);
    let path = 0;
    for (let i = last - k + 1; i <= last; i++) path += Math.abs(cl[i] - cl[i - 1]);
    const er = path ? Math.abs(cl[last] - cl[last - k]) / path : 0;
    let atrAvg = 0, m = 0;
    for (let i = Math.max(0, n - 100); i < n; i++) if (a[i] != null) { atrAvg += a[i]; m++; }
    atrAvg = m ? atrAvg / m : a[last];
    // volume relatif candle terakhir yang DAH tutup berbanding purata 20 candle sebelumnya
    let relVol = null;
    if (n > 22) { let s = 0; for (let i = n - 22; i < n - 2; i++) s += c[i].volume; relVol = s ? c[n - 2].volume / (s / 20) : null; }
    return {
      dir, score, px, e20: e20[last], e50: e50[last], e200: e200[last], rsi: r[last],
      atr: a[last], atrPct: a[last] / px * 100, er, volRatio: a[last] / atrAvg, st, piv,
      div: divergence(piv, r, n), relVol,
    };
  }

  // ---------- pelan dagangan ----------
  // htf: [{ tf, info }] untuk timeframe lebih besar (boleh kosong)
  function plan(c, htf, opts = {}) {
    const info = trendInfo(c);
    if (!info) return { verdict: 'TUNGGU', reasons: ['Data belum cukup (perlu sekurang-kurangnya 60 candle).'], checks: [] };
    const z = zones(c, info.piv, info.atr);
    const votes = htf.filter(h => h.info).map(h => h.info.dir);
    const up = votes.filter(d => d === 'naik').length, dn = votes.filter(d => d === 'turun').length;
    const htfBias = !votes.length ? 'neutral' : up > dn && up >= votes.length / 2 ? 'naik' : dn > up && dn >= votes.length / 2 ? 'turun' : 'neutral';
    const bias = htfBias !== 'neutral' ? htfBias : info.dir;
    const conflict = htfBias !== 'neutral' && info.dir !== 'neutral' && htfBias !== info.dir;
    const res = { info, zones: z, htfBias, bias, conflict, reasons: [], checks: [] };

    if (bias === 'neutral') {
      res.verdict = 'TUNGGU';
      res.reasons.push('Tiada arah jelas: pasaran berjulat atau sedang bertukar. Dalam keadaan ni trader berpengalaman biasanya duduk tepi.');
      return res;
    }
    const L = bias === 'naik';
    const dirName = L ? 'long' : 'short';
    res.dir = dirName;
    const px = info.px, atr = info.atr;

    // Zon masuk: zon S/R di belakang harga (support untuk long, resistance untuk short).
    // Kalau tiada, guna EMA50 sebagai "support/resistance dinamik".
    let zone = z.inside[0] || (L ? z.below[0] : z.above[0]);
    let dynamic = false;
    if (!zone && info.e50 != null) { zone = { lo: info.e50 - atr * 0.3, hi: info.e50 + atr * 0.3, touches: 0, name: 'EMA50' }; dynamic = true; }
    if (!zone) { res.verdict = 'TUNGGU'; res.reasons.push('Tiada zon masuk yang jelas.'); return res; }
    res.zone = zone;

    const entry = L ? Math.min(px, zone.hi) : Math.max(px, zone.lo);
    let sl = L ? zone.lo - atr * 0.5 : zone.hi + atr * 0.5;
    if (Math.abs(entry - sl) < atr * 0.6) sl = L ? entry - atr * 0.6 : entry + atr * 0.6; // SL terlalu rapat mudah kena "noise"
    const risk = Math.abs(entry - sl);
    const targets = (L ? z.above : z.below).map(t => L ? t.lo : t.hi).filter(t => L ? t > entry + risk * 0.8 : t < entry - risk * 0.8);
    const tp1 = targets[0] != null ? targets[0] : (L ? entry + 2 * risk : entry - 2 * risk);
    const tp2 = targets[1] != null ? targets[1] : (L ? entry + 3 * risk : entry - 3 * risk);
    const rr = Math.abs(tp1 - entry) / risk;
    // kos yuran (masuk + keluar) dalam unit R: SL rapat + yuran tinggi = untung dimakan yuran
    const feeR = opts.feePct ? (opts.feePct / 100) * (entry + tp1) / risk : 0;
    Object.assign(res, { entry, sl, tp1, tp2, rr, risk, feeR, tpFromZone: targets[0] != null });

    const htfOk = htfBias === bias;
    const add = (ok, text) => res.checks.push({ ok: !!ok, text });
    add(htfOk, htf.length ? `Trend TF besar (${htf.map(h => h.tf).join(', ')}) sama arah` : 'Trend TF besar sama arah (tiada data TF besar)');
    add(info.st.trend === bias, `Struktur TF semasa ${L ? 'naik (HH + HL)' : 'turun (LH + LL)'}`);
    add(!dynamic && zone.touches >= 2, `Entry di zon S/R kukuh (${dynamic ? 'tiada, guna EMA50' : zone.touches + ' sentuhan'})`);
    add(rr >= 2, `R:R ke TP1 sekurang-kurangnya 1:2 (sekarang 1:${rr.toFixed(2)})`);
    add(L ? info.rsi < 70 : info.rsi > 30, `RSI tak melampau ke arah entry (${info.rsi.toFixed(0)})`);
    add(info.er >= 0.2, `Pasaran bergerak kemas, bukan berombak (ER ${info.er.toFixed(2)})`);
    add(info.volRatio >= 0.6 && info.volRatio <= 1.8, `Volatiliti normal (ATR ${info.volRatio.toFixed(2)}× purata)`);
    let pass = res.checks.filter(x => x.ok).length;
    // faktor tambahan: divergence menolak/menambah satu mata; volume sebagai maklumat
    res.extras = [];
    const div = info.div || {};
    if (L ? div.bull : div.bear) { res.extras.push({ ok: true, text: `Divergence RSI ${L ? 'bullish' : 'bearish'}: momentum menyokong arah ni (+1)` }); pass++; }
    if (L ? div.bear : div.bull) { res.extras.push({ ok: false, text: `Divergence RSI ${L ? 'bearish' : 'bullish'} melawan arah: momentum melemah (−1)` }); pass--; }
    if (info.relVol != null) res.extras.push({ ok: info.relVol >= 1, info: true, text: `Volume candle terakhir ${info.relVol.toFixed(1)}× purata${info.relVol >= 1.5 ? ': penyertaan kuat' : info.relVol < 0.7 ? ': lemah, pergerakan kurang disokong' : ''}` });
    pass = Math.max(0, Math.min(7, pass));
    res.score = pass;
    res.grade = pass >= 6 ? 'A' : pass >= 4 ? 'B' : 'C';

    if (conflict) res.reasons.push(`TF besar ${htfBias} tapi TF semasa ${info.dir}. Bila bercanggah, peluang menang jatuh.`);
    if (rr < 1.5) res.reasons.push(`R:R cuma 1:${rr.toFixed(2)}: resistance/support seterusnya terlalu dekat. Untung tak berbaloi dengan risiko.`);
    if (res.grade === 'C') res.reasons.push(`Cuma ${pass}/7 faktor selari. Terlalu sedikit untuk ambil risiko.`);
    if (!L && opts.spotOnly) res.reasons.push('Bias turun, tapi akaun spot tak boleh short. Duduk tepi atau tunggu trend berubah.');
    if (feeR > 0.25) res.reasons.push(`Yuran ${opts.feePct}% makan ${feeR.toFixed(2)}R untuk SL serapat ni. Guna timeframe lebih besar (SL lebih jauh) supaya yuran jadi kecil.`);

    const dist = Math.abs(px - entry) / atr;
    if (res.reasons.length) res.verdict = 'TUNGGU';
    else if (dist > 0.5) { res.verdict = 'PASANG LIMIT'; res.reasons.push(`Harga sekarang ${dist.toFixed(1)} ATR dari zon masuk. Jangan kejar: pasang order limit di entry dan biar harga datang.`); }
    else res.verdict = 'SETUP';
    return res;
  }

  // ---------- gabung candle ke timeframe lebih besar (sandaran bila tiada data TF besar) ----------
  const bucketOf = (t, sec) => sec === 604800 ? Math.floor((t - 345600) / sec) * sec + 345600 : Math.floor(t / sec) * sec;
  function aggregate(c, sec) {
    const out = [];
    for (const x of c) {
      const b = bucketOf(x.time, sec), last = out[out.length - 1];
      if (last && last.time === b) { last.high = Math.max(last.high, x.high); last.low = Math.min(last.low, x.low); last.close = x.close; last.volume += x.volume; }
      else out.push({ time: b, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume });
    }
    return out;
  }

  // ---------- backtester ----------
  // Peraturan: signal dikira bila candle TUTUP, masuk pada harga BUKA candle seterusnya.
  // Kalau SL dan TP kena dalam candle yang sama, anggap SL dulu (andaian paling pesimis).
  // Yuran dikenakan pada masuk dan keluar.
  const STRATS = {
    pullback: 'Pullback ke EMA20 ikut trend',
    breakout: 'Breakout 20 candle ikut trend',
    rsi: 'RSI pullback ikut trend',
    cross: 'EMA 20/50 cross',
  };
  function backtest(c, strat, o = {}) {
    const rr = o.rr || 2, slAtr = o.slAtr || 1.5, fee = (o.feePct ?? 0.1) / 100, allowShort = o.allowShort !== false;
    const n = c.length, cl = c.map(x => x.close);
    const e20 = I.ema(cl, 20), e50 = I.ema(cl, 50), e200 = I.ema(cl, 200), a = I.atr(c, 14), r = I.rsi(cl, 14);
    const signal = (i) => {
      if (e200[i] == null || a[i] == null || i < 21) return null;
      const up = c[i].close > e200[i] && e50[i] > e200[i], dn = c[i].close < e200[i] && e50[i] < e200[i];
      const b = c[i];
      if (strat === 'pullback') {
        if (up && b.low <= e20[i] && b.close > e20[i] && b.close > b.open) return 'long';
        if (dn && b.high >= e20[i] && b.close < e20[i] && b.close < b.open) return 'short';
      } else if (strat === 'breakout') {
        let hh = -Infinity, ll = Infinity;
        for (let j = i - 20; j < i; j++) { hh = Math.max(hh, c[j].high); ll = Math.min(ll, c[j].low); }
        if (up && b.close > hh) return 'long';
        if (dn && b.close < ll) return 'short';
      } else if (strat === 'rsi') {
        if (up && r[i - 1] < 40 && r[i] >= 40) return 'long';
        if (dn && r[i - 1] > 60 && r[i] <= 60) return 'short';
      } else if (strat === 'cross') {
        if (e20[i - 1] <= e50[i - 1] && e20[i] > e50[i] && b.close > e200[i]) return 'long';
        if (e20[i - 1] >= e50[i - 1] && e20[i] < e50[i] && b.close < e200[i]) return 'short';
      }
      return null;
    };
    const trades = [];
    let pos = null;
    const close = (exit, i, why) => {
      const gross = (pos.dir === 'long' ? exit - pos.entry : pos.entry - exit) / pos.risk;
      const cost = fee * (pos.entry + exit) / pos.risk;
      trades.push({ dir: pos.dir, entryTime: pos.time, exitTime: c[i].time, entry: pos.entry, exit, r: gross - cost, cost, why, bars: i - pos.i + 1 });
      pos = null;
    };
    for (let i = 0; i < n; i++) {
      if (pos) {
        const b = c[i];
        const hitSL = pos.dir === 'long' ? b.low <= pos.sl : b.high >= pos.sl;
        const hitTP = pos.dir === 'long' ? b.high >= pos.tp : b.low <= pos.tp;
        if (hitSL) close(pos.sl, i, 'sl');
        else if (hitTP) close(pos.tp, i, 'tp');
      }
      if (!pos && i < n - 1) {
        const s = signal(i);
        if (s && (s === 'long' || allowShort)) {
          const entry = c[i + 1].open, risk = slAtr * a[i];
          pos = { dir: s, entry, risk, i: i + 1, time: c[i + 1].time,
            sl: s === 'long' ? entry - risk : entry + risk, tp: s === 'long' ? entry + rr * risk : entry - rr * risk };
        }
      }
    }
    return { trades, open: pos ? 1 : 0, ...stats(trades), buyHoldPct: n > 201 ? (c[n - 1].close / c[201].close - 1) * 100 : 0, from: c[0]?.time, to: c[n - 1]?.time, strat, rr, slAtr, feePct: fee * 100 };
  }
  function stats(trades) {
    const n = trades.length;
    let eq = 0, peak = 0, maxDD = 0, streak = 0, maxStreak = 0, gw = 0, gl = 0, wins = 0;
    const curve = [0];
    for (const t of trades) {
      eq += t.r; curve.push(eq);
      peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq);
      if (t.r > 0) { wins++; gw += t.r; streak = 0; } else { gl -= t.r; streak++; maxStreak = Math.max(maxStreak, streak); }
    }
    const half = Math.floor(n / 2);
    const sumR = (arr) => arr.reduce((s, t) => s + t.r, 0);
    return {
      n, wins, winRate: n ? wins / n * 100 : 0, totalR: eq, expectancy: n ? eq / n : 0,
      avgWin: wins ? gw / wins : 0, avgLoss: n - wins ? gl / (n - wins) : 0,
      profitFactor: gl ? gw / gl : (gw ? Infinity : 0), maxDD, maxLoseStreak: maxStreak, curve,
      firstHalfR: sumR(trades.slice(0, half)), secondHalfR: sumR(trades.slice(half)),
      avgCost: n ? trades.reduce((s, t) => s + (t.cost || 0), 0) / n : 0,
    };
  }
  // ---------- backtest ENJIN ANALISIS itu sendiri (ulang tayang candle demi candle) ----------
  // Pada setiap candle tanpa posisi, jalankan plan() hanya dengan data yang wujud SETAKAT candle tu
  // (TF besar pun hanya candle yang dah tutup). Kalau keputusan SETUP / PASANG LIMIT dengan gred cukup,
  // pasang order limit di entry; tamat tempoh selepas `expiry` candle, batal kalau harga sampai TP dulu.
  // Keluar di SL atau TP1. SL dikira dulu kalau kedua-dua kena dalam candle sama. Yuran ditolak.
  async function backtestPlan(c, curSec, htfSecs, o = {}) {
    const fee = (o.feePct ?? 0.1) / 100, minGrade = o.minGrade || 'B', allowShort = o.allowShort !== false;
    const WIN = 600, EXP = o.expiry || 12, n = c.length, start = Math.min(n, 260);
    const gradeOk = (g) => g === 'A' || (minGrade === 'B' && g === 'B');
    const aggs = htfSecs.map((sec, j) => {
      const given = o.htfData && o.htfData[j];
      return { sec, agg: given && given.length >= 60 ? given : aggregate(c, sec), k: -1, info: null };
    });
    const trades = [];
    let pos = null, pend = null, evals = 0, signals = 0, missed = 0, expired = 0;
    const close = (exit, i, why) => {
      const gross = (pos.dir === 'long' ? exit - pos.entry : pos.entry - exit) / pos.risk;
      const cost = fee * (pos.entry + exit) / pos.risk;
      trades.push({ dir: pos.dir, grade: pos.grade, entryTime: pos.time, exitTime: c[i].time, entry: pos.entry, exit, r: gross - cost, cost, why });
      pos = null;
    };
    for (let i = start; i < n; i++) {
      const b = c[i];
      if (pos) {
        const hitSL = pos.dir === 'long' ? b.low <= pos.sl : b.high >= pos.sl;
        const hitTP = pos.dir === 'long' ? b.high >= pos.tp : b.low <= pos.tp;
        if (hitSL) close(pos.sl, i, 'sl'); else if (hitTP) close(pos.tp, i, 'tp');
      } else if (pend) {
        const L = pend.dir === 'long';
        if (L ? b.low <= pend.entry : b.high >= pend.entry) {
          pos = { ...pend, time: b.time }; pend = null;
          if (L ? b.low <= pos.sl : b.high >= pos.sl) close(pos.sl, i, 'sl'); // masuk & kena SL dalam candle sama
        } else if (L ? b.high >= pend.tp : b.low <= pend.tp) { missed++; pend = null; }
        else if (i - pend.at >= EXP) { expired++; pend = null; }
      }
      if (!pos && !pend && i < n - 1) {
        evals++;
        const tClose = b.time + curSec;
        const htf = [];
        for (const h of aggs) {
          let k = h.k;
          while (k + 1 < h.agg.length && h.agg[k + 1].time + h.sec <= tClose) k++;
          if (k !== h.k) { h.k = k; h.info = k >= 59 ? trendInfo(h.agg.slice(Math.max(0, k - WIN + 1), k + 1)) : null; }
          htf.push({ tf: String(h.sec), info: h.info });
        }
        const p = plan(c.slice(Math.max(0, i - WIN + 1), i + 1), htf, { spotOnly: !allowShort, feePct: fee * 100 });
        if (p.verdict !== 'TUNGGU' && gradeOk(p.grade)) {
          signals++;
          pend = { dir: p.dir, entry: p.entry, sl: p.sl, tp: p.tp1, risk: p.risk, at: i, grade: p.grade };
        }
      }
      if (o.yieldEvery && i % o.yieldEvery === 0) {
        await new Promise(r => setTimeout(r, 0));
        if (o.onProgress) o.onProgress((i - start) / Math.max(1, n - start));
        if (o.cancelled && o.cancelled()) return null;
      }
    }
    return { trades, ...stats(trades), open: pos || pend ? 1 : 0, evals, signals, missed, expired,
      from: c[start]?.time, to: c[n - 1]?.time, feePct: fee * 100, strat: 'plan', minGrade,
      buyHoldPct: n > start ? (c[n - 1].close / c[start].close - 1) * 100 : 0 };
  }

  // ---------- Monte Carlo: susun semula hasil trade secara rawak ribuan kali ----------
  // Urutan menang/kalah sebenar akan berbeza dari sejarah. Ini tunjuk julat drawdown yang munasabah.
  function monteCarlo(rs, runs = 2000, seed = 12345) {
    if (!rs || rs.length < 5) return null;
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const dds = [], finals = [];
    let streak95 = [];
    for (let k = 0; k < runs; k++) {
      let eq = 0, pk = 0, dd = 0, st = 0, mx = 0;
      for (let j = 0; j < rs.length; j++) {
        const r = rs[Math.floor(rnd() * rs.length)];
        eq += r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq);
        if (r <= 0) { st++; mx = Math.max(mx, st); } else st = 0;
      }
      dds.push(dd); finals.push(eq); streak95.push(mx);
    }
    const num = (a, b) => a - b;
    dds.sort(num); finals.sort(num); streak95.sort(num);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    return { runs, n: rs.length, dd50: q(dds, 0.5), dd95: q(dds, 0.95), final5: q(finals, 0.05), final50: q(finals, 0.5), final95: q(finals, 0.95),
      probLoss: finals.filter(x => x < 0).length / runs, streak95: q(streak95, 0.95) };
  }

  // Tafsiran jujur keputusan backtest
  function judge(bt) {
    if (bt.n && bt.avgCost > 0.5) return { level: 'bad', text: `Yuran sahaja makan ${bt.avgCost.toFixed(2)}R setiap trade: SL terlalu rapat berbanding yuran pada timeframe ni. Guna timeframe lebih besar (1h/4h) atau exchange yang yurannya lebih rendah.` };
    if (bt.n < 30) return { level: 'warn', text: `Cuma ${bt.n} trade. Sampel terlalu kecil untuk dipercayai: anggap sebagai petunjuk awal sahaja (boleh jadi kebetulan). Kumpul sekurang-kurangnya 30 trade, contohnya forward test di akaun demo, sebelum percaya.` };
    if (bt.expectancy <= 0) return { level: 'bad', text: `Purata ${bt.expectancy.toFixed(2)}R setiap trade selepas yuran. Strategi ni RUGI pada data ni. Jangan guna dengan duit sebenar.` };
    if (bt.firstHalfR <= 0 || bt.secondHalfR <= 0) return { level: 'warn', text: 'Untung keseluruhan, tapi cuma pada separuh tempoh. Tak konsisten: kemungkinan nasib atau keadaan pasaran tertentu sahaja.' };
    if (bt.profitFactor < 1.2) return { level: 'warn', text: `Untung tipis (profit factor ${bt.profitFactor.toFixed(2)}). Sedikit perubahan yuran atau slippage boleh jadikan rugi.` };
    return { level: 'good', text: `Ada tanda edge: untung pada kedua-dua separuh tempoh, profit factor ${bt.profitFactor.toFixed(2)}. Langkah seterusnya: forward test di akaun demo sekurang-kurangnya 30 trade sebelum duit sebenar.` };
  }

  TD.ana = { pivots, structure, zones, divergence, trendInfo, plan, aggregate, backtest, backtestPlan, monteCarlo, stats, judge, STRATS };
})();
