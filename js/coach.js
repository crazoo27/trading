/* Coach: analisis ke atas TRADER (pelaksanaan), bukan pasaran.
 * Kebanyakan akaun hilang duit bukan sebab analisis salah, tapi sebab pelaksanaan:
 * saiz risiko berubah-ubah, tutup untung terlalu awal, masuk walaupun sistem cakap tunggu,
 * dan lompat-lompat timeframe. Modul ni ukur semua tu dari jurnal. Semua fungsi tulen (tiada DOM). */
window.TD = window.TD || {};
(() => {
  'use strict';

  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // ---------- dari mana trade ni datang? ----------
  // 'sistem' : analisis cakap SETUP / PASANG LIMIT gred A atau B, dan nilai tak diubah
  // 'diubah' : datang dari pelan analisis, tapi entry/SL/TP diubah sendiri
  // 'tunggu' : analisis cakap TUNGGU (atau gred C), tapi tetap masuk
  // 'luar'   : tiada analisis langsung (masuk ikut rasa / tool chart)
  function classify(s) {
    let verdict = s.src && s.src.verdict, grade = s.src && s.src.grade;
    if (!verdict && s.note) { // setup lama: baca dari nota
      const m = /Analisis auto: (SETUP|PASANG LIMIT|TUNGGU)(?:, gred ([ABC]))?/.exec(s.note);
      if (m) { verdict = m[1]; grade = m[2]; }
    }
    if (!verdict) return 'luar';
    if (verdict === 'TUNGGU' || grade === 'C') return 'tunggu';
    if (s.src && s.src.edited) return 'diubah';
    return 'sistem';
  }
  const CLASS_TXT = { sistem: 'Ikut sistem', diubah: 'Pelan diubah sendiri', tunggu: 'Masuk walaupun TUNGGU', luar: 'Tanpa analisis' };

  // ---------- statistik kumpulan ----------
  function groupStats(trades, keyFn) {
    const g = new Map();
    for (const t of trades) { const k = keyFn(t); if (!g.has(k)) g.set(k, []); g.get(k).push(t); }
    return [...g.entries()].map(([key, arr]) => {
      const n = arr.length, wins = arr.filter(t => t.r > 0.01).length, sumR = arr.reduce((a, t) => a + t.r, 0);
      return { key, n, winRate: n ? wins / n * 100 : 0, expectancy: n ? sumR / n : 0, totalR: sumR, pnl: arr.reduce((a, t) => a + (t.pnl || 0), 0) };
    }).sort((a, b) => b.n - a.n);
  }

  // ---------- konsistensi saiz risiko ----------
  // Kalau risiko berubah-ubah, jumlah R boleh positif tapi duit tetap rugi (menang kecil, kalah besar).
  function riskReport(trades) {
    const rs = trades.map(t => t.riskUsd).filter(x => x > 0);
    if (!rs.length) return null;
    const med = median(rs);
    const off = trades.filter(t => t.riskUsd > 0 && Math.abs(t.riskUsd / med - 1) > 0.25);
    const totalR = trades.reduce((a, t) => a + (t.r || 0), 0);
    const pnl = trades.reduce((a, t) => a + (t.pnl || 0), 0);
    const win = trades.filter(t => t.r > 0.01), loss = trades.filter(t => t.r < -0.01);
    const avg = (a) => a.length ? a.reduce((x, t) => x + t.riskUsd, 0) / a.length : null;
    return { median: med, min: Math.min(...rs), max: Math.max(...rs), off, pnl, totalR, pnlIfConstant: totalR * med,
      avgRiskWin: avg(win), avgRiskLoss: avg(loss), consistent: off.length === 0 };
  }

  // ---------- "apa jadi kalau ikut pelan?" untuk trade yang ditutup manual ----------
  // Ulang tayang candle SELEPAS masa tutup dengan peraturan pengurusan yang sama macam setup live
  // (SL dikira dulu dalam setiap candle; selepas TP1, separuh baki ikut BE / TP2 / trailing).
  function replayPlan(s, candles, sec) {
    const L = s.dir === 'long', risk = Math.abs(s.entry - s.origSl);
    if (!(risk > 0) || !candles || !candles.length) return null;
    const R = (px) => (L ? px - s.entry : s.entry - px) / risk;
    const st = { tp1Hit: !!s.tp1Hit, sl: s.sl, ext: s.ext };
    const final = (px) => st.tp1Hit && (s.tp2 || s.trail) ? 0.5 * R(s.tp1) + 0.5 * R(px) : R(px);
    const after = candles.filter(c => c.time * 1000 >= s.closedAt);
    for (const b of after) {
      if (L ? b.low <= st.sl : b.high >= st.sl) {
        const be = st.tp1Hit && Math.abs(st.sl - s.entry) < 1e-9;
        return { r: final(st.sl), status: be ? 'be' : st.tp1Hit && s.trail ? 'trail' : 'sl', at: b.time };
      }
      if (!st.tp1Hit && (L ? b.high >= s.tp1 : b.low <= s.tp1)) {
        if (s.tp2 || s.trail) { st.tp1Hit = true; if (s.be || s.trail) st.sl = s.entry; st.ext = L ? b.high : b.low; continue; }
        return { r: R(s.tp1), status: 'tp', at: b.time };
      }
      if (st.tp1Hit && s.tp2 && (L ? b.high >= s.tp2 : b.low <= s.tp2)) return { r: final(s.tp2), status: 'tp2', at: b.time };
      if (st.tp1Hit && s.trail) {
        st.ext = L ? Math.max(st.ext ?? b.high, b.high) : Math.min(st.ext ?? b.low, b.low);
        const t = L ? st.ext - s.trail : st.ext + s.trail;
        if (L ? t > st.sl : t < st.sl) st.sl = t;
      }
    }
    // belum selesai: nilai pada harga terakhir
    const last = after.length ? after[after.length - 1] : null;
    return last ? { r: final(last.close), status: 'open', at: last.time } : null;
  }

  // ---------- skor disiplin (0–100) ----------
  function discipline(trades) {
    const n = trades.length;
    if (!n) return null;
    const share = (f) => trades.filter(f).length / n;
    const rr = riskReport(trades);
    const tfs = groupStats(trades, t => t.interval);
    const parts = [
      { key: 'sistem', name: 'Ikut sistem', max: 30, share: share(t => classify(t) === 'sistem'),
        tip: 'Masuk HANYA bila analisis cakap SETUP atau PASANG LIMIT (gred A/B), dan jangan ubah entry/SL/TP.' },
      { key: 'risiko', name: 'Risiko sekata', max: 25, share: rr ? 1 - rr.off.length / n : 1,
        tip: `Guna risiko yang SAMA setiap trade (contohnya 1% modal). Jangan ubah Modal / Risk % ikut rasa yakin.` },
      { key: 'tutup', name: 'Biar pelan yang tutup', max: 25, share: share(t => t.outcome !== 'manual'),
        tip: 'Jangan tutup manual. Biar SL, TP atau breakeven yang tutup trade: pelan ada sebab.' },
      { key: 'tf', name: 'Satu timeframe', max: 20, share: tfs.length ? tfs[0].n / n : 1,
        tip: `Pilih SATU timeframe (contohnya 4h) supaya rekod boleh dinilai. Sekarang: ${tfs.map(x => x.key + ' ×' + x.n).join(', ')}.` },
    ];
    for (const p of parts) p.score = Math.round(p.max * p.share);
    const score = parts.reduce((a, p) => a + p.score, 0);
    const worst = [...parts].sort((a, b) => (a.score / a.max) - (b.score / b.max))[0];
    return { score, parts, tip: worst.share < 1 ? worst.tip : null, n };
  }

  TD.coach = { classify, CLASS_TXT, groupStats, riskReport, replayPlan, discipline, median };
})();
