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
  // tol: beza harga yang dianggap "sama paras" (cth 0.25 ATR). Double top / double bottom = julat, bukan LH/LL.
  function structure(piv, price, tol = 0) {
    const hs = piv.filter(p => p.type === 'H'), ls = piv.filter(p => p.type === 'L');
    if (hs.length < 2 || ls.length < 2) return { trend: 'julat', label: 'Belum cukup swing untuk baca struktur' };
    const h1 = hs[hs.length - 2], h2 = hs[hs.length - 1], l1 = ls[ls.length - 2], l2 = ls[ls.length - 1];
    const hh = h2.price > h1.price + tol, lh = h2.price < h1.price - tol;
    const hl = l2.price > l1.price + tol, ll = l2.price < l1.price - tol;
    const equal = !hh && !lh && !hl && !ll;
    let trend, label;
    if (hh && hl) { trend = 'naik'; label = 'Higher High + Higher Low'; }
    else if (lh && ll) { trend = 'turun'; label = 'Lower High + Lower Low'; }
    else if (equal) { trend = 'julat'; label = 'High & low sama paras (double top + double bottom): julat'; }
    else if (hh && ll) { trend = 'julat'; label = 'High makin tinggi tapi low makin rendah (meluas)'; }
    else if (lh && hl) { trend = 'julat'; label = 'High makin rendah tapi low makin tinggi (menyempit)'; }
    else { trend = 'julat'; label = (hh ? 'Higher High' : lh ? 'Lower High' : 'High sama paras') + ' + ' + (hl ? 'Higher Low' : ll ? 'Lower Low' : 'low sama paras') + ': belum jelas'; }
    // break of structure: harga dah tembus swing terakhir?
    let bos = null;
    if (price > h2.price) bos = 'atas';
    else if (price < l2.price) bos = 'bawah';
    return { trend, label, lastH: h2, lastL: l2, bos, equal };
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
    const st = structure(piv, px, (a[last] || 0) * 0.25); // beza < 0.25 ATR = paras sama
    let score = 0;
    if (e200[last] != null) score += px > e200[last] ? 1 : -1;
    if (e50[last] != null && e200[last] != null) score += e50[last] > e200[last] ? 1 : -1;
    else if (e50[last] != null) score += px > e50[last] ? 1 : -1;
    if (st.trend === 'naik') score++; else if (st.trend === 'turun') score--;
    // Efficiency ratio (Kaufman): 1 = bergerak lurus, 0 = berombak ke sana sini
    const k = Math.min(20, last);
    let path = 0;
    for (let i = last - k + 1; i <= last; i++) path += Math.abs(cl[i] - cl[i - 1]);
    const er = path ? Math.abs(cl[last] - cl[last - k]) / path : 0;
    // Julat dikenal pasti melalui STRUKTUR: swing high & low tak membentuk HH/HL atau LH/LL, dan pergerakan
    // berombak. Dalam keadaan ni, harga di bawah EMA cuma bermaksud harga di dasar julat, bukan trend turun.
    const ranging = st.trend === 'julat' && (st.equal || er < 0.3);
    const dir = ranging ? 'neutral' : score >= 2 ? 'naik' : score <= -2 ? 'turun' : 'neutral';
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

  // ---------- pengesahan candle (price action) di zon ----------
  // Dikira pada candle terakhir YANG DAH TUTUP (c mesti candle tertutup sahaja).
  function confirmation(c, dir, zone, atr, st) {
    const k = c.length - 1, b = c[k], p = c[k - 1];
    if (!b || !p || !zone) return null;
    const range = b.high - b.low || 1e-12, body = Math.abs(b.close - b.open);
    const found = [];
    if (dir === 'long') {
      const near = b.low <= zone.hi + 0.2 * atr;
      const wick = Math.min(b.open, b.close) - b.low;
      if (near && wick >= 2 * body && wick >= 0.5 * range && b.close >= b.low + 0.6 * range) found.push('pin bar bullish');
      if (near && p.close < p.open && b.close > b.open && b.close >= p.open && b.open <= p.close) found.push('bullish engulfing');
      if (st && st.lastL && b.low < st.lastL.price && b.close > st.lastL.price) found.push('sapu likuiditi bawah swing low');
    } else {
      const near = b.high >= zone.lo - 0.2 * atr;
      const wick = b.high - Math.max(b.open, b.close);
      if (near && wick >= 2 * body && wick >= 0.5 * range && b.close <= b.high - 0.6 * range) found.push('pin bar bearish');
      if (near && p.close > p.open && b.close < b.open && b.close <= p.open && b.open >= p.close) found.push('bearish engulfing');
      if (st && st.lastH && b.high > st.lastH.price && b.close < st.lastH.price) found.push('sapu likuiditi atas swing high');
    }
    return found.length ? found : null;
  }

  // ---------- pelan dagangan ----------
  // c   : candle yang DAH TUTUP sahaja (supaya live & backtest guna peraturan yang sama)
  // htf : [{ tf, info }] untuk timeframe lebih besar (boleh kosong)
  // opts: { livePx, feePct, spotOnly, requireConfirm, btcDir }
  function plan(c, htf, opts = {}) {
    const info = trendInfo(c);
    if (!info) return { verdict: 'TUNGGU', reasons: ['Data belum cukup (perlu sekurang-kurangnya 60 candle).'], checks: [], extras: [] };
    const z = zones(c, info.piv, info.atr);
    const votes = htf.filter(h => h.info).map(h => h.info.dir);
    const up = votes.filter(d => d === 'naik').length, dn = votes.filter(d => d === 'turun').length;
    const htfBias = !votes.length ? 'neutral' : up > dn && up >= votes.length / 2 ? 'naik' : dn > up && dn >= votes.length / 2 ? 'turun' : 'neutral';
    const bias = htfBias !== 'neutral' ? htfBias : info.dir;
    const conflict = htfBias !== 'neutral' && info.dir !== 'neutral' && htfBias !== info.dir;
    const px = opts.livePx ?? info.px;
    const res = { info, zones: z, htfBias, bias, conflict, px, reasons: [], checks: [], extras: [], mode: 'trend' };
    const add = (ok, text) => res.checks.push({ ok: !!ok, text });

    if (bias === 'neutral') return rangePlan(res, c, add, opts);

    const L = bias === 'naik', atr = info.atr;
    res.dir = L ? 'long' : 'short';
    // Zon masuk: zon S/R di belakang harga (support untuk long, resistance untuk short).
    // Kalau tiada, guna EMA50 sebagai "support/resistance dinamik".
    let zone = z.inside[0] || (L ? z.below[0] : z.above[0]);
    let dynamic = false;
    if (!zone && info.e50 != null) { zone = { lo: info.e50 - atr * 0.3, hi: info.e50 + atr * 0.3, touches: 0, name: 'EMA50' }; dynamic = true; }
    if (!zone) { res.verdict = 'TUNGGU'; res.reasons.push('Tiada zon masuk yang jelas.'); return res; }
    res.zone = zone;
    res.entry = L ? Math.min(px, zone.hi) : Math.max(px, zone.lo);
    const slBuf = opts.slBuf ?? 0.5; // penimbal SL di sebalik zon, dalam ATR
    let sl = L ? zone.lo - atr * slBuf : zone.hi + atr * slBuf;
    if (Math.abs(res.entry - sl) < atr * 0.6) sl = L ? res.entry - atr * 0.6 : res.entry + atr * 0.6; // SL terlalu rapat mudah kena "noise"
    res.sl = sl;
    const risk0 = Math.abs(res.entry - sl);
    const targets = (L ? z.above : z.below).map(t => L ? t.lo : t.hi).filter(t => L ? t > res.entry + risk0 * 0.8 : t < res.entry - risk0 * 0.8);
    res.tp1 = targets[0] != null ? targets[0] : (L ? res.entry + 2 * risk0 : res.entry - 2 * risk0);
    res.tp2 = targets[1] != null ? targets[1] : (L ? res.entry + 3 * risk0 : res.entry - 3 * risk0);
    res.tpFromZone = targets[0] != null;

    add(htfBias === bias, htf.length ? `Trend TF besar (${htf.map(h => h.tf).join(', ')}) sama arah` : 'Trend TF besar sama arah (tiada data TF besar)');
    add(info.st.trend === bias, `Struktur TF semasa ${L ? 'naik (HH + HL)' : 'turun (LH + LL)'}`);
    add(!dynamic && zone.touches >= 2, `Entry di zon S/R kukuh (${dynamic ? 'tiada, guna EMA50' : zone.touches + ' sentuhan'})`);
    add(L ? info.rsi < 70 : info.rsi > 30, `RSI tak melampau ke arah entry (${info.rsi.toFixed(0)})`);
    add(info.er >= 0.2, `Pasaran bergerak kemas, bukan berombak (ER ${info.er.toFixed(2)})`);
    add(info.volRatio >= 0.6 && info.volRatio <= 1.8, `Volatiliti normal (ATR ${info.volRatio.toFixed(2)}× purata)`);
    if (conflict) res.reasons.push(`TF besar ${htfBias} tapi TF semasa ${info.dir}. Bila bercanggah, peluang menang jatuh.`);
    return finalize(res, c, opts);
  }

  // ---------- setup julat (pasaran mendatar): beli di bawah julat, jual di atas ----------
  function rangePlan(res, c, add, opts) {
    const { info, zones: z, px } = res, atr = info.atr;
    res.mode = 'julat';
    let sup = z.below[0], resi = z.above[0];
    const ins = z.inside[0];
    if (ins) { // harga dalam satu zon: zon tu jadi sempadan di sebelah yang lebih jauh dari zon bertentangan
      const dUp = resi ? resi.lo - ins.hi : -1, dDn = sup ? ins.lo - sup.hi : -1;
      if (dUp >= dDn) sup = { ...ins, kind: 'S', name: 'Bawah julat' }; else resi = { ...ins, kind: 'R', name: 'Atas julat' };
    }
    if (!sup || !resi) { res.verdict = 'TUNGGU'; res.reasons.push('Tiada arah jelas dan tiada julat yang jelas. Trader berpengalaman duduk tepi dalam keadaan ni.'); return res; }
    const lo = sup.hi, hi = resi.lo, width = hi - lo;
    if (width < 3 * atr) { res.verdict = 'TUNGGU'; res.reasons.push(`Pasaran berjulat tapi julat terlalu sempit (${(width / atr).toFixed(1)} ATR). Tiada ruang untung selepas yuran.`); return res; }
    const pos = (px - lo) / width; // 0 = dasar julat, 1 = bumbung julat
    res.range = { lo: sup.lo, hi: resi.hi, pos };
    if (pos > 0.33 && pos < 0.67) {
      res.verdict = 'TUNGGU';
      res.reasons.push(`Pasaran berjulat, tapi harga di tengah julat (${Math.round(pos * 100)}%). Tunggu harga sampai hujung julat: beli dekat ${sup.hi.toPrecision(6)}, jual dekat ${resi.lo.toPrecision(6)}.`);
      return res;
    }
    const L = pos <= 0.33;
    res.dir = L ? 'long' : 'short';
    res.bias = L ? 'naik' : 'turun';
    const zone = L ? sup : resi;
    res.zone = zone;
    res.entry = L ? Math.min(px, zone.hi) : Math.max(px, zone.lo);
    res.sl = L ? zone.lo - atr * (opts.slBuf ?? 0.5) : zone.hi + atr * (opts.slBuf ?? 0.5);
    if (Math.abs(res.entry - res.sl) < atr * 0.6) res.sl = L ? res.entry - atr * 0.6 : res.entry + atr * 0.6;
    res.tp1 = L ? resi.lo - 0.2 * atr : sup.hi + 0.2 * atr; // ambil untung sebelum sempadan bertentangan
    res.tp2 = L ? resi.hi : sup.lo;
    res.tpFromZone = true;
    add(info.st.equal || info.er < 0.3, info.st.equal ? 'Julat jelas: high & low terakhir sama paras' : `Pasaran berombak, bukan bertrend (ER ${info.er.toFixed(2)})`);
    add(sup.touches >= 2 && resi.touches >= 2, `Dasar & bumbung julat kukuh (${sup.touches}× dan ${resi.touches}× sentuhan)`);
    add(L ? pos <= 0.2 : pos >= 0.8, `Harga betul-betul di hujung julat (${Math.round(pos * 100)}%)`);
    add(L ? info.rsi < 45 : info.rsi > 55, `RSI menyokong lantunan (${info.rsi.toFixed(0)})`);
    add(!info.st.bos, 'Tiada break of structure baru (julat masih utuh)');
    add(info.volRatio >= 0.6 && info.volRatio <= 1.8, `Volatiliti normal (ATR ${info.volRatio.toFixed(2)}× purata)`);
    return finalize(res, c, opts);
  }

  // ---------- langkah akhir yang sama untuk setup trend & julat ----------
  function finalize(res, c, opts) {
    const { info } = res, L = res.dir === 'long', atr = info.atr;
    // pengesahan candle: kalau mod pengesahan, masuk pada harga semasa selepas candle penolakan tutup
    const conf = confirmation(c, res.dir, res.zone, atr, info.st);
    res.confirm = conf;
    if (opts.requireConfirm && conf) { res.entry = res.px; res.market = true; }
    res.risk = L ? res.entry - res.sl : res.sl - res.entry;
    if (!(res.risk > 0)) { res.verdict = 'TUNGGU'; res.reasons.push('Harga dah melepasi stop loss pelan ni. Setup terbatal.'); return res; }
    res.rr = Math.abs(res.tp1 - res.entry) / res.risk;
    if (L ? res.tp1 <= res.entry : res.tp1 >= res.entry) { res.verdict = 'TUNGGU'; res.reasons.push('Harga dah sampai sasaran. Terlambat untuk masuk.'); return res; }
    // kos yuran (masuk + keluar) dalam unit R: SL rapat + yuran tinggi = untung dimakan yuran
    res.feeR = opts.feePct ? (opts.feePct / 100) * (res.entry + res.tp1) / res.risk : 0;
    res.checks.splice(3, 0, { ok: res.rr >= 2, text: `R:R ke TP1 sekurang-kurangnya 1:2 (sekarang 1:${res.rr.toFixed(2)})` });

    let pass = res.checks.filter(x => x.ok).length;
    const div = info.div || {};
    if (L ? div.bull : div.bear) { res.extras.push({ ok: true, text: `Divergence RSI ${L ? 'bullish' : 'bearish'}: momentum menyokong arah ni (+1)` }); pass++; }
    if (L ? div.bear : div.bull) { res.extras.push({ ok: false, text: `Divergence RSI ${L ? 'bearish' : 'bullish'} melawan arah: momentum melemah (−1)` }); pass--; }
    if (conf) { res.extras.push({ ok: true, text: `Pengesahan candle: ${conf.join(', ')} (+1)` }); pass++; }
    if (opts.btcDir && opts.btcDir !== 'neutral') {
      const against = L ? opts.btcDir === 'turun' : opts.btcDir === 'naik';
      if (against) { res.extras.push({ ok: false, text: `BTC sedang ${opts.btcDir}: kebanyakan altcoin ikut arah BTC (−1)` }); pass--; }
      else res.extras.push({ ok: true, info: true, text: `BTC sedang ${opts.btcDir}, sehaluan dengan setup ni` });
    }
    if (info.relVol != null) res.extras.push({ ok: info.relVol >= 1, info: true, text: `Volume candle terakhir ${info.relVol.toFixed(1)}× purata${info.relVol >= 1.5 ? ': penyertaan kuat' : info.relVol < 0.7 ? ': lemah, pergerakan kurang disokong' : ''}` });
    pass = Math.max(0, Math.min(7, pass));
    res.score = pass;
    res.grade = pass >= 6 ? 'A' : pass >= 4 ? 'B' : 'C';

    if (res.rr < (opts.minRR ?? 1.5)) res.reasons.push(`R:R cuma 1:${res.rr.toFixed(2)}: ${res.mode === 'julat' ? 'julat' : 'zon seterusnya'} terlalu dekat. Untung tak berbaloi dengan risiko.`);
    if (res.grade === 'C') res.reasons.push(`Cuma ${pass}/7 faktor selari. Terlalu sedikit untuk ambil risiko.`);
    if (opts.minGrade === 'A' && res.grade === 'B') res.reasons.push('Tetapan dioptimum untuk pair/TF ni: ambil gred A sahaja. Setup gred B dilangkau.');
    if (!L && opts.spotOnly) res.reasons.push(res.mode === 'julat' ? 'Harga di bumbung julat (peluang jual), tapi akaun spot tak boleh short.' : 'Bias turun, tapi akaun spot tak boleh short. Duduk tepi atau tunggu trend berubah.');
    if (res.feeR > 0.25) res.reasons.push(`Yuran ${opts.feePct}% makan ${res.feeR.toFixed(2)}R untuk SL serapat ni. Guna timeframe lebih besar (SL lebih jauh) supaya yuran jadi kecil.`);

    const dist = Math.abs(res.px - res.entry) / atr;
    if (res.reasons.length) res.verdict = 'TUNGGU';
    else if (opts.requireConfirm && !conf) {
      res.verdict = 'TUNGGU'; res.waitConfirm = true;
      res.reasons.push(dist > 0.5
        ? `Setup ${res.grade} terbentuk, tapi harga ${dist.toFixed(1)} ATR dari zon. Tunggu harga sampai zon DAN candle penolakan tutup.`
        : 'Harga di zon. Tunggu candle penolakan (pin bar / engulfing / sapu likuiditi) TUTUP dulu sebelum masuk.');
    }
    else if (!res.market && dist > 0.5) { res.verdict = 'PASANG LIMIT'; res.reasons.push(`Harga sekarang ${dist.toFixed(1)} ATR dari zon masuk. Jangan kejar: pasang order limit di entry dan biar harga datang.`); }
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
  // Pengurusan (o.manage):
  //   'split' (default, sama macam setup dalam app): 50% keluar di TP1, SL dialih ke entry, baki di TP2 / breakeven
  //   'tp1'   : keluar penuh di TP1
  // o.requireConfirm: masuk hanya selepas candle penolakan tutup, pada harga BUKA candle seterusnya.
  // o.btcData + o.btcSec: candle BTC (TF besar) untuk penapis BTC, dikira dengan peraturan "dah tutup" yang sama.
  // SL dikira dulu kalau SL & TP kena dalam candle sama. Yuran ditolak pada setiap transaksi.
  // Dipecah kepada dua langkah:
  //   1) precomputeSignals: jalankan plan() pada SETIAP candle (hanya data setakat candle tu). Keputusan plan()
  //      tak bergantung pada posisi terbuka, jadi boleh dikira sekali dan diguna semula.
  //   2) simulate: jalankan pengurusan order/posisi atas isyarat tu. Sangat laju, jadi banyak cara
  //      pengurusan boleh diuji atas isyarat yang sama (untuk pengoptimum walk-forward).
  const BT_WIN = 600;
  async function precomputeSignals(c, curSec, htfSecs, o = {}) {
    const fee = (o.feePct ?? 0.1) / 100, allowShort = o.allowShort !== false;
    const n = c.length, start = Math.min(n, 260);
    const mkSeries = (sec, given) => ({ sec, agg: given && given.length >= 60 ? given : aggregate(c, sec), k: -1, info: null });
    const aggs = htfSecs.map((sec, j) => mkSeries(sec, o.htfData && o.htfData[j]));
    const btc = o.btcData && o.btcData.length >= 60 ? { sec: o.btcSec, agg: o.btcData, k: -1, info: null } : null;
    // maklumat trend siri `h` setakat candle yang dah tutup sebelum masa tClose
    const closedInfo = (h, tClose) => {
      let k = h.k;
      while (k + 1 < h.agg.length && h.agg[k + 1].time + h.sec <= tClose) k++;
      if (k !== h.k) { h.k = k; h.info = k >= 59 ? trendInfo(h.agg.slice(Math.max(0, k - BT_WIN + 1), k + 1)) : null; }
      return h.info;
    };
    const sigs = new Array(n).fill(null);
    for (let i = start; i < n - 1; i++) {
      const tClose = c[i].time + curSec;
      const htf = aggs.map(h => ({ tf: String(h.sec), info: closedInfo(h, tClose) }));
      const btcInfo = btc ? closedInfo(btc, tClose) : null;
      const p = plan(c.slice(Math.max(0, i - BT_WIN + 1), i + 1), htf, {
        spotOnly: !allowShort, feePct: fee * 100, requireConfirm: o.requireConfirm, btcDir: btcInfo ? btcInfo.dir : null,
        slBuf: o.slBuf, minRR: o.minRR,
      });
      if (p.verdict !== 'TUNGGU' && (p.grade === 'A' || p.grade === 'B')) {
        sigs[i] = { dir: p.dir, entry: p.entry, sl: p.sl, tp: p.tp1, tp2: p.tp2, grade: p.grade, mode: p.mode, confirm: !!p.confirm, market: !!p.market, atr: p.info.atr, er: p.info.er, vr: p.info.volRatio };
      }
      if (o.yieldEvery && i % o.yieldEvery === 0) {
        await new Promise(r => setTimeout(r, 0));
        if (o.onProgress) o.onProgress((i - start) / Math.max(1, n - start));
        if (o.cancelled && o.cancelled()) return null;
      }
    }
    return { sigs, start, fee };
  }

  // Pengurusan (o.manage):
  //   'split' : 50% keluar di TP1, SL dialih ke entry, baki di TP2 / breakeven (sama macam setup dalam app)
  //   'trail' : 50% keluar di TP1, baki diikut dengan trailing stop 1.5 ATR dari harga tertinggi (long)
  //   'tp1'   : keluar penuh di TP1
  // [from, to): hanya isyarat dalam julat index ni yang diambil (untuk pecahan in-sample / out-of-sample).
  function simulate(c, pre, o = {}) {
    const n = c.length, fee = pre.fee, minGrade = o.minGrade || 'B', EXP = o.expiry || 12;
    const manage = o.manage || 'split', from = Math.max(pre.start, o.from ?? 0), to = Math.min(n, o.to ?? n);
    const gradeOk = (g) => g === 'A' || (minGrade === 'B' && g === 'B');
    const trades = [];
    let pos = null, pend = null, signals = 0, missed = 0, expired = 0, evals = 0;
    const R = (px) => (pos.dir === 'long' ? px - pos.entry : pos.entry - px) / pos.risk;
    const close = (exit, i, why) => {
      const half = pos.half;
      const gross = half ? 0.5 * pos.r1 + 0.5 * R(exit) : R(exit);
      const cost = fee * (pos.entry + (half ? 0.5 * pos.tp + 0.5 * exit : exit)) / pos.risk;
      trades.push({ dir: pos.dir, grade: pos.grade, mode: pos.mode, confirm: pos.confirm, er: pos.er, vr: pos.vr, entryTime: pos.time, exitTime: c[i].time,
        entry: pos.entry, exit, r: gross - cost, cost, why: half && why === 'sl' ? (pos.trailed ? 'trail' : 'be') : why });
      pos = null;
    };
    const open = (entry, i) => {
      const L = pend.dir === 'long';
      const risk = L ? entry - pend.sl : pend.sl - entry;
      // harga buka dah melepasi SL atau TP: batal
      if (!(risk > 0) || (L ? entry >= pend.tp : entry <= pend.tp)) { missed++; pend = null; return; }
      pos = { ...pend, entry, risk, time: c[i].time, half: false }; pend = null;
    };
    for (let i = from; i < n; i++) {
      const b = c[i];
      // hardEnd: data mulai `to` tak boleh disentuh langsung (in-sample walk-forward):
      // tutup posisi pada harga TUTUP candle terakhir SEBELUM garis pemisah
      if (o.hardEnd && i >= to) { if (pos) close(c[to - 1].close, to - 1, 'end'); pend = null; break; }
      let limitFill = false;
      if (!pos && pend) {
        const L = pend.dir === 'long';
        if (pend.market) open(b.open, i);
        else if (L ? b.low <= pend.entry : b.high >= pend.entry) { open(pend.entry, i); limitFill = true; }
        else if (L ? b.high >= pend.tp : b.low <= pend.tp) { missed++; pend = null; }
        else if (i - pend.at >= EXP) { expired++; pend = null; }
      }
      if (pos) {
        const L = pos.dir === 'long';
        if (L ? b.low <= pos.sl : b.high >= pos.sl) close(pos.sl, i, 'sl');
        // limit terisi dalam candle ni: tak tahu sama ada TP berlaku sebelum atau selepas isian, jadi TP tak dikira (pesimis)
        else if (limitFill) { /* tunggu candle seterusnya */ }
        else if (!pos.half && (L ? b.high >= pos.tp : b.low <= pos.tp)) {
          if (manage === 'trail') { pos.half = true; pos.r1 = R(pos.tp); pos.sl = pos.entry; pos.ext = L ? b.high : b.low; }
          else if (manage === 'split' && pos.tp2 != null) { pos.half = true; pos.r1 = R(pos.tp); pos.sl = pos.entry; }
          else close(pos.tp, i, 'tp');
        } else if (pos.half && manage === 'split' && (L ? b.high >= pos.tp2 : b.low <= pos.tp2)) close(pos.tp2, i, 'tp2');
        else if (pos.half && manage === 'trail') {
          // SL candle ni dah disemak di atas; kemas kini trailing untuk candle SETERUSNYA (tiada intai)
          pos.ext = L ? Math.max(pos.ext, b.high) : Math.min(pos.ext, b.low);
          const t = L ? pos.ext - 1.5 * pos.atr : pos.ext + 1.5 * pos.atr;
          if (L ? t > pos.sl : t < pos.sl) { pos.sl = t; pos.trailed = true; }
        }
      }
      if (!pos && !pend && i < to && i < n - 1) {
        evals++;
        const s = pre.sigs[i];
        if (s && gradeOk(s.grade)) { signals++; pend = { ...s, at: i }; }
      }
      if (!pos && !pend && i >= to) break;
    }
    // prestasi ikut kumpulan (gred & jenis setup): jawab "bila analisis cakap gred A, berapa kerap ia betul?"
    const groups = {};
    for (const [key, f] of [['A', t => t.grade === 'A'], ['B', t => t.grade === 'B'], ['trend', t => t.mode === 'trend'], ['julat', t => t.mode === 'julat']]) {
      const g = stats(trades.filter(f));
      groups[key] = { n: g.n, winRate: g.winRate, expectancy: g.expectancy, totalR: g.totalR };
    }
    return { trades, ...stats(trades), groups, open: pos || pend ? 1 : 0, evals, signals, missed, expired,
      from: c[from]?.time, to: c[Math.min(n, to) - 1]?.time, feePct: fee * 100, strat: 'plan', minGrade, manage,
      buyHoldPct: n > from ? (c[Math.min(n, to) - 1].close / c[from].close - 1) * 100 : 0 };
  }

  async function backtestPlan(c, curSec, htfSecs, o = {}) {
    const pre = await precomputeSignals(c, curSec, htfSecs, o);
    if (!pre) return null;
    return { ...simulate(c, pre, o), requireConfirm: !!o.requireConfirm };
  }

  // ---------- pengoptimum WALK-FORWARD ----------
  // Cari tetapan terbaik guna 70% data awal (in-sample), kemudian uji pada 30% terakhir (out-of-sample)
  // yang tak pernah dilihat semasa carian. Tetapan cuma DITERIMA kalau ia bertahan pada data baru tu.
  const OPT_SIG = []; for (const slBuf of [0.3, 0.5, 0.8]) for (const minRR of [1.5, 2]) for (const requireConfirm of [false, true]) OPT_SIG.push({ slBuf, minRR, requireConfirm });
  const OPT_SIM = []; for (const manage of ['split', 'trail', 'tp1']) for (const minGrade of ['B', 'A']) OPT_SIM.push({ manage, minGrade });
  // Walk-forward BERGANDA (anchored, 3 lipatan): latih pada [awal → 55%], uji 55–70%; latih [awal → 70%], uji 70–85%;
  // latih [awal → 85%], uji 85–100%. Setiap lipatan memilih tetapannya sendiri hanya dari data latihan.
  // Gabungan semua bahagian ujian = prestasi SEBENAR proses pengoptimuman pada data yang tak pernah dilihat.
  // Tetapan yang dicadang untuk masa depan = pilihan lipatan terakhir (dilatih dengan data paling baru).
  const FOLDS = [[0.55, 0.70], [0.70, 0.85], [0.85, 1.00]];
  async function optimize(c, curSec, htfSecs, o = {}) {
    const n = c.length, start = Math.min(n, 260);
    const at = (f) => Math.floor(start + (n - start) * f);
    const rows = [];
    for (let k = 0; k < OPT_SIG.length; k++) {
      const sg = OPT_SIG[k];
      const pre = await precomputeSignals(c, curSec, htfSecs, { ...o, ...sg,
        onProgress: (f) => o.onProgress && o.onProgress((k + f) / OPT_SIG.length) });
      if (!pre) return null;
      for (const sm of OPT_SIM) {
        rows.push({ ...sg, ...sm,
          folds: FOLDS.map(([a, b]) => ({
            train: simulate(c, pre, { ...sm, to: at(a), hardEnd: true }),
            test: simulate(c, pre, { ...sm, from: at(a), to: at(b), hardEnd: b < 1 }),
          })) });
      }
    }
    const isDefault = (r) => r.slBuf === 0.5 && r.minRR === 1.5 && r.requireConfirm === !!o.defaultConfirm && r.manage === 'split' && r.minGrade === 'B';
    const def = rows.find(isDefault);
    // skor latihan: purata R × √n (macam t-stat), supaya sampel kecil yang "bernasib baik" tak menang
    const score = (s) => s.expectancy * Math.sqrt(s.n);
    const pickFor = (f) => {
      const el = rows.filter(r => { const s = r.folds[f].train; return s.n >= 12 && s.expectancy > 0 && s.firstHalfR > 0 && s.secondHalfR > 0; });
      el.sort((a, b) => score(b.folds[f].train) - score(a.folds[f].train));
      return el;
    };
    const foldRes = FOLDS.map(([a, b], f) => {
      const el = pickFor(f), pick = el[0] || null;
      return { from: c[at(a)]?.time, to: c[Math.min(n - 1, at(b) - 1)]?.time, pick, test: pick ? pick.folds[f].test : null, def: def ? def.folds[f].test : null };
    });
    // gabungan trade bahagian ujian (pilihan setiap lipatan) lawan tetapan asal pada bahagian yang sama
    const wfTrades = foldRes.flatMap(x => x.test ? x.test.trades : []);
    const defTrades = foldRes.flatMap(x => x.def ? x.def.trades : []);
    const wf = { ...stats(wfTrades), trades: wfTrades, ci: confidence(wfTrades) };
    const dflt = { ...stats(defTrades), trades: defTrades };
    const lastEl = pickFor(FOLDS.length - 1);
    const best = lastEl[0] || null; // dilatih dengan data sehingga 85%
    const foldsPositive = foldRes.filter(x => x.test && x.test.n && x.test.totalR > 0).length;
    let verdict = 'none';
    if (best) verdict = wf.n >= 10 && wf.expectancy > 0 && foldsPositive >= 2 && wf.expectancy >= (dflt.n ? dflt.expectancy : 0) ? 'accept' : 'reject';
    return { rows, def, best, verdict, folds: foldRes, wf, dflt, foldsPositive, top: lastEl.slice(0, 5), tested: rows.length,
      isFrom: c[start]?.time, oosTo: c[n - 1]?.time };
  }

  // ---------- julat keyakinan 95% ----------
  // Bootstrap: ambil semula trade secara rawak (dengan pengembalian) ribuan kali; julat purata R yang terhasil
  // menjawab "kalau sejarah berulang dengan nasib berbeza, purata sebenar kemungkinan di antara X dan Y".
  // Win rate guna selang Wilson (tepat walaupun sampel kecil).
  function confidence(trades, runs = 2000, seed = 4242) {
    const rs = trades.map(t => t.r), n = rs.length;
    if (n < 5) return null;
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const means = new Array(runs);
    for (let k = 0; k < runs; k++) { let sum = 0; for (let j = 0; j < n; j++) sum += rs[Math.floor(rnd() * n)]; means[k] = sum / n; }
    means.sort((a, b) => a - b);
    const w = rs.filter(r => r > 0).length / n, z = 1.96, den = 1 + z * z / n;
    const mid = (w + z * z / (2 * n)) / den, half = z * Math.sqrt(w * (1 - w) / n + z * z / (4 * n * n)) / den;
    return { expLo: means[Math.floor(0.025 * runs)], expHi: means[Math.floor(0.975 * runs)], winLo: (mid - half) * 100, winHi: (mid + half) * 100,
      pPositive: means.filter(m => m > 0).length / runs };
  }

  // ---------- prestasi ikut keadaan pasaran semasa masuk ----------
  const REGIMES = [
    ['Trend kuat (ER ≥ 0.35)', t => t.er >= 0.35], ['Trend sederhana', t => t.er >= 0.2 && t.er < 0.35], ['Berombak (ER < 0.2)', t => t.er < 0.2],
    ['Volatiliti rendah (< 0.8×)', t => t.vr < 0.8], ['Volatiliti normal', t => t.vr >= 0.8 && t.vr <= 1.3], ['Volatiliti tinggi (> 1.3×)', t => t.vr > 1.3],
  ];
  function regimeStats(trades) {
    return REGIMES.map(([name, f]) => { const s = stats(trades.filter(t => t.er != null && f(t))); return { name, n: s.n, winRate: s.winRate, expectancy: s.expectancy }; });
  }
  // keadaan pasaran SEKARANG (ikut info trendInfo) → nama baris yang sepadan
  function regimeNow(info) {
    const t = { er: info.er, vr: info.volRatio };
    return REGIMES.filter(([, f]) => f(t)).map(([name]) => name);
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
    // ujian paling ketat: adakah julat keyakinan 95% purata R masih di atas sifar?
    const ci = bt.ci || confidence(bt.trades || []);
    if (ci && ci.expLo <= 0) return { level: 'warn', text: `Untung pada kedua-dua separuh tempoh, tapi julat keyakinan 95% purata R ialah ${ci.expLo.toFixed(2)}R hingga +${ci.expHi.toFixed(2)}R: masih merangkumi rugi. Edge belum terbukti secara statistik; perlu lebih banyak trade.` };
    return { level: 'good', text: `Edge disokong statistik: julat keyakinan 95% purata R ialah +${ci ? ci.expLo.toFixed(2) : '?'}R hingga +${ci ? ci.expHi.toFixed(2) : '?'}R (di atas sifar), untung pada kedua-dua separuh tempoh, profit factor ${bt.profitFactor.toFixed(2)}. Langkah seterusnya: forward test di akaun demo sekurang-kurangnya 30 trade sebelum duit sebenar.` };
  }

  TD.ana = { pivots, structure, zones, divergence, confirmation, trendInfo, plan, aggregate, backtest, backtestPlan, precomputeSignals, simulate, optimize, confidence, regimeStats, regimeNow, monteCarlo, stats, judge, STRATS };
})();
