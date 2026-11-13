/* TradeDesk — platform charting real-time + setup builder + pemantau setup.
 * Data: Binance spot (REST untuk sejarah, WebSocket untuk live). Fallback ke mod demo kalau tak dapat sambung. */
(() => {
  'use strict';

  const LC = window.LightweightCharts;
  const I = TD.ind;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- storage ----------
  const LS_KEY = 'tradedesk.v2';
  const store = {
    load() {
      try { return JSON.parse(localStorage.getItem(LS_KEY)) || JSON.parse(localStorage.getItem('tradedesk.v1')) || {}; } catch { return {}; }
    },
    save(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* storage disekat */ } },
  };
  const saved = store.load();

  const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'];
  const INTERVAL_SEC = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400, '1w': 604800 };
  const TZ_SHIFT = -new Date().getTimezoneOffset() * 60;
  const CHART_TYPES = { candles: 'Candle', hollow: 'Candle kosong', bars: 'Bar', heikin: 'Heikin Ashi', line: 'Garisan', area: 'Kawasan' };
  const UP = '#089981', DN = '#f23645';
  const TOOL_TIPS = {
    trend: 'Trend line: tap titik pertama, kemudian titik kedua',
    ray: 'Ray: tap titik mula, kemudian arah garisan',
    hline: 'Garisan mendatar: tap pada paras harga (support/resistance)',
    vline: 'Garisan menegak: tap pada masa yang dikehendaki',
    rect: 'Zon: tap satu bucu, kemudian bucu bertentangan',
    fib: 'Fibonacci: tap swing pertama, kemudian swing kedua',
    long: 'Long: tap pada paras harga ENTRY (beli)',
    short: 'Short: tap pada paras harga ENTRY (jual)',
    measure: 'Ukur: tap titik mula, kemudian titik akhir',
    text: 'Teks: tap tempat untuk letak nota',
  };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const mkInd = (type, params, colors) => ({ id: uid(), type, params: { ...Object.fromEntries(I.DEFS[type].params.map(p => [p.k, p.def])), ...params }, colors: colors || [...I.DEFS[type].colors], visible: true });

  const S = {
    symbol: saved.symbol || 'BTCUSDT',
    interval: saved.interval || '15m',
    chartType: saved.chartType || 'candles',
    watch: saved.watch || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'PAXGUSDT', 'DOGEUSDT'],
    indicators: saved.indicators || [mkInd('vol'), mkInd('ema', { period: 20 }, ['#f5b301']), mkInd('ema', { period: 50 }, ['#2962ff']), mkInd('ema', { period: 200 }, ['#a855f7']), mkInd('rsi')],
    drawings: saved.drawings || {},
    balance: saved.balance ?? 1000,
    riskPct: saved.riskPct ?? 1,
    sound: saved.sound ?? true,
    autoSignal: saved.autoSignal ?? true,
    showSignals: saved.showSignals ?? (saved.show ? saved.show.signals : true),
    // mod demo yang dihidupkan secara auto (sebab gagal sambung) tidak dikekalkan: cuba live semula setiap kali buka
    demo: saved.demoManual ? !!saved.demo : false,
    demoManual: saved.demoManual ?? false,
    ccy: saved.ccy || 'USD',
    fx: saved.fx || 4.2,
    spotOnly: saved.spotOnly ?? false,
    legendOpen: saved.legendOpen ?? (window.innerWidth > 860),
    source: saved.source || null,
    magnet: saved.magnet ?? false,
    hideDrawings: false,
    priceMode: saved.priceMode || 0,
    sideTab: saved.sideTab || 'watch',
    sideCollapsed: saved.sideCollapsed ?? false,
    setups: saved.setups || [],
    alerts: saved.alerts || [],
    log: saved.log || [],
    candles: [],
    tickers: {},
    precision: 2,
    pick: null,
    draft: { dir: 'long', type: 'limit', entry: null, sl: null, tp1: null, tp2: null, be: true, note: '' },
    lastSignalTime: 0,
  };

  const persist = () => store.save({
    symbol: S.symbol, interval: S.interval, chartType: S.chartType, watch: S.watch, indicators: S.indicators, drawings: S.drawings,
    balance: S.balance, riskPct: S.riskPct, sound: S.sound, autoSignal: S.autoSignal, showSignals: S.showSignals, demo: S.demo, demoManual: S.demoManual, source: S.source, ccy: S.ccy, fx: S.fx, spotOnly: S.spotOnly, legendOpen: S.legendOpen,
    magnet: S.magnet, priceMode: S.priceMode, sideTab: S.sideTab, sideCollapsed: S.sideCollapsed,
    setups: S.setups, alerts: S.alerts, log: S.log.slice(0, 100),
  });

  // ---------- helpers ----------
  const decimalsFor = (p) => p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.01 ? 5 : p >= 0.0001 ? 7 : 8;
  const fmt = (v, d = S.precision) => (v == null || !isFinite(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  // nilai wang disimpan dalam USD; dipaparkan dalam USD atau RM ikut tetapan
  const ccyFactor = () => S.ccy === 'MYR' ? S.fx : 1;
  const ccySym = () => S.ccy === 'MYR' ? 'RM' : '$';
  const fmtUsd = (v) => {
    if (v == null || !isFinite(v)) return '—';
    const x = v * ccyFactor();
    return (x < 0 ? '-' : '') + ccySym() + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtR = (r) => (r == null || !isFinite(r)) ? '—' : (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
  const fmtBig = (v) => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(2);
  const fmtInd = (v) => v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e5 ? fmtBig(v) : fmt(v, Math.abs(v) < 1 ? 4 : Math.min(S.precision, 2) + (Math.abs(v) < 100 ? 0 : 0));
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const priceOf = (sym) => sym === S.symbol && S.candles.length ? S.candles[S.candles.length - 1].close : S.tickers[sym]?.price;
  const decOf = (sym) => decimalsFor(priceOf(sym) || 1);
  const tShift = (t) => t + TZ_SHIFT;
  const roundP = (v) => +(+v).toFixed(S.precision);
  const QUOTES = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL', 'JPY'];
  const splitSym = (s) => { const q = QUOTES.find(q => s.endsWith(q) && s.length > q.length); return q ? [s.slice(0, -q.length), q] : [s, '']; };

  // ---------- chart ----------
  const chartHost = $('#chart');
  const chart = LC.createChart(chartHost, {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: '#0b0e14' }, textColor: '#787b86', fontSize: 11,
      panes: { separatorColor: '#2a2e39', separatorHoverColor: 'rgba(41,98,255,.4)', enableResize: true },
    },
    grid: { vertLines: { color: '#161a25' }, horzLines: { color: '#161a25' } },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 10 },
    crosshair: {
      mode: LC.CrosshairMode.Normal,
      vertLine: { color: '#787b86', labelBackgroundColor: '#363a45' },
      horzLine: { color: '#787b86', labelBackgroundColor: '#363a45' },
    },
  });

  let mainSeries = null, markersApi = null, priceLines = [];
  let indRT = [];
  let hoverIdx = null;

  const drawings = TD.createDrawings({
    chart, host: chartHost,
    getCandles: () => S.candles,
    getSec: () => INTERVAL_SEC[S.interval],
    fmt: (p) => fmt(p),
    getRisk: () => ({ balance: S.balance, riskPct: S.riskPct }),
    money: (v) => fmtUsd(v),
    getAtr: () => { const a = I.atr(S.candles, 14); return a[a.length - 1]; },
    defaultColor: (t) => ({ hline: '#f5b301', rect: '#9c27b0', text: '#2962ff' }[t] || '#2962ff'),
    onChange: (list) => { S.drawings[S.symbol] = list; persist(); renderAlerts(); },
    onSelect: (d) => renderSelBar(d),
    onTool: (t) => {
      $$('#drawbar [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
      if (S.pick) return; // banner sedang dipakai oleh pilihan harga setup
      const tip = TOOL_TIPS[t];
      $('#pickBanner').textContent = tip ? tip + ' · Esc/✕ batal' : '';
      $('#pickBanner').classList.toggle('hidden', !tip);
    },
    countdown: () => {
      const n = S.candles.length; if (!n || !mainSeries) return null;
      const c = S.candles[n - 1], sec = INTERVAL_SEC[S.interval];
      let left = Math.max(0, c.time + sec - Math.floor(Date.now() / 1000));
      if (left > sec) return null;
      const h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
      const pad = (x) => String(x).padStart(2, '0');
      const lastBar = S.chartType === 'heikin' ? null : c;
      return { price: c.close, text: (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s), color: (lastBar ? lastBar.close >= lastBar.open : true) ? UP : DN };
    },
  });
  drawings.setMagnet(S.magnet);

  function priceFormat() { return { type: 'price', precision: S.precision, minMove: Math.pow(10, -S.precision) }; }

  function createMain() {
    const pf = priceFormat();
    const t = S.chartType;
    if (t === 'line') mainSeries = chart.addSeries(LC.LineSeries, { color: '#2962ff', lineWidth: 2, priceFormat: pf }, 0);
    else if (t === 'area') mainSeries = chart.addSeries(LC.AreaSeries, { lineColor: '#2962ff', topColor: 'rgba(41,98,255,.35)', bottomColor: 'rgba(41,98,255,0)', lineWidth: 2, priceFormat: pf }, 0);
    else if (t === 'bars') mainSeries = chart.addSeries(LC.BarSeries, { upColor: UP, downColor: DN, thinBars: false, priceFormat: pf }, 0);
    else if (t === 'hollow') mainSeries = chart.addSeries(LC.CandlestickSeries, { upColor: 'rgba(0,0,0,0)', downColor: DN, borderVisible: true, borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN, priceFormat: pf }, 0);
    else mainSeries = chart.addSeries(LC.CandlestickSeries, { upColor: UP, downColor: DN, borderVisible: false, wickUpColor: UP, wickDownColor: DN, priceFormat: pf }, 0);
    mainSeries.priceScale().applyOptions({ mode: S.priceMode, autoScale: true });
    markersApi = LC.createSeriesMarkers(mainSeries, []);
    drawings.attach(mainSeries);
    priceLines = [];
  }

  function buildIndicators() {
    let paneIdx = 1;
    for (const inst of S.indicators) {
      const def = I.DEFS[inst.type]; if (!def) continue;
      const pane = def.overlay ? 0 : paneIdx++;
      const outs = def.outs(S.candles, inst.params, inst.colors);
      const series = outs.map(o => {
        const common = { priceLineVisible: false, visible: inst.visible !== false, crosshairMarkerVisible: false };
        if (o.kind === 'hist') {
          return chart.addSeries(LC.HistogramSeries, {
            ...common, color: o.color, lastValueVisible: false,
            priceScaleId: def.volume ? 'vol' : 'right', priceFormat: def.volume ? { type: 'volume' } : { type: 'price', precision: 4, minMove: 0.0001 },
          }, pane);
        }
        return chart.addSeries(LC.LineSeries, {
          ...common, color: o.color, lineWidth: o.width || 1, lastValueVisible: !def.overlay,
          priceFormat: def.overlay ? priceFormat() : { type: 'price', precision: 2, minMove: 0.01 },
        }, pane);
      });
      if (def.volume) series[0].priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      if (def.levels) for (const lv of def.levels) series[series.length - 1].createPriceLine({ price: lv, color: 'rgba(120,123,134,.5)', lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
      indRT.push({ inst, def, series, pane, outs });
    }
    while (chart.panes().length > paneIdx) chart.removePane(chart.panes().length - 1);
    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 4 : 1));
    buildLegend();
  }

  function rebuildChart() {
    for (const r of indRT) r.series.forEach(s => chart.removeSeries(s));
    indRT = [];
    if (mainSeries) chart.removeSeries(mainSeries);
    mainSeries = null;
    createMain();
    buildIndicators();
    renderAll();
    drawLines();
  }

  function rebuildIndicators() {
    for (const r of indRT) r.series.forEach(s => chart.removeSeries(s));
    indRT = [];
    buildIndicators();
    for (const r of indRT) setIndData(r, true);
    updateLegend();
    persist();
  }

  const bar = (c) => ({ time: tShift(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
  function mainBars() {
    const src = S.chartType === 'heikin' ? I.heikinAshi(S.candles) : S.candles;
    if (S.chartType === 'line' || S.chartType === 'area') return src.map(c => ({ time: tShift(c.time), value: c.close }));
    return src.map(bar);
  }

  function setIndData(r, full) {
    const outs = r.def.outs(S.candles, r.inst.params, r.inst.colors);
    r.outs = outs;
    const n = S.candles.length;
    outs.forEach((o, k) => {
      const s = r.series[k];
      const pt = (i) => o.data[i] == null ? { time: tShift(S.candles[i].time) } : { time: tShift(S.candles[i].time), value: o.data[i], ...(o.colors ? { color: o.colors[i] } : {}) };
      if (full) s.setData(S.candles.map((_, i) => pt(i)));
      else if (n) s.update(pt(n - 1));
    });
  }

  function renderAll() {
    if (!S.candles.length || !mainSeries) return;
    mainSeries.setData(mainBars());
    for (const r of indRT) setIndData(r, true);
    renderMarkers();
    updateLegend(); updateHeader();
    drawings.redraw();
  }

  function renderLast() {
    const n = S.candles.length; if (!n) return;
    const bars = S.chartType === 'heikin' ? mainBars() : null;
    const c = S.candles[n - 1];
    mainSeries.update(bars ? bars[n - 1] : (S.chartType === 'line' || S.chartType === 'area') ? { time: tShift(c.time), value: c.close } : bar(c));
    for (const r of indRT) setIndData(r, false);
    scheduleLegend(); updateHeader();
  }

  // ---------- signal engine (EMA20/50 + EMA200 + RSI14) ----------
  function signalsFor(c) {
    const cl = c.map(x => x.close);
    return { e20: I.ema(cl, 20), e50: I.ema(cl, 50), e200: I.ema(cl, 200), rsi: I.rsi(cl, 14) };
  }
  function signalAt(sig, i) {
    const { e20, e50, e200, rsi } = sig, c = S.candles[i], out = [];
    if (i < 1 || !c) return out;
    if (e20[i - 1] != null && e50[i - 1] != null && e200[i] != null) {
      if (e20[i - 1] <= e50[i - 1] && e20[i] > e50[i] && c.close > e200[i]) out.push({ side: 'long', text: 'EMA20 potong atas EMA50 (atas EMA200)' });
      if (e20[i - 1] >= e50[i - 1] && e20[i] < e50[i] && c.close < e200[i]) out.push({ side: 'short', text: 'EMA20 potong bawah EMA50 (bawah EMA200)' });
    }
    if (rsi[i - 1] != null && rsi[i] != null) {
      if (rsi[i - 1] < 30 && rsi[i] >= 30) out.push({ side: 'long', text: 'RSI keluar oversold' });
      if (rsi[i - 1] > 70 && rsi[i] <= 70) out.push({ side: 'short', text: 'RSI keluar overbought' });
    }
    return out;
  }
  function renderMarkers() {
    if (!markersApi) return;
    if (!S.showSignals) { markersApi.setMarkers([]); return; }
    const sig = signalsFor(S.candles), m = [];
    for (let i = 1; i < S.candles.length - 1; i++) {
      for (const s of signalAt(sig, i)) {
        m.push({
          time: tShift(S.candles[i].time), position: s.side === 'long' ? 'belowBar' : 'aboveBar',
          color: s.side === 'long' ? UP : DN, shape: s.side === 'long' ? 'arrowUp' : 'arrowDown',
          text: s.text.startsWith('RSI') ? 'RSI' : 'EMA',
        });
      }
    }
    markersApi.setMarkers(m);
  }

  // ---------- legend ----------
  function indRow(r) {
    const off = r.inst.visible === false;
    return `<div class="lg-row ${off ? 'off' : ''}" data-ind="${r.inst.id}">
      <span class="nm">${esc(r.def.label(r.inst.params))}</span><span class="vals" data-v="${r.inst.id}"></span>
      <span class="acts"><button data-a="vis" title="Tunjuk/sorok">${off ? '◌' : '◉'}</button><button data-a="set" title="Tetapan">⚙</button><button data-a="rm" title="Buang">✕</button></span></div>`;
  }
  function buildLegend() {
    $('#legend').innerHTML =
      `<div class="main"><span class="title">${esc(S.symbol)} · ${S.interval} · ${sourceLabel()}</span>` +
      `<button class="lg-toggle" id="lgToggle" title="Tunjuk/sorok indikator">${S.legendOpen ? '▴' : '▾'}</button>` +
      `<span class="ohlc" id="lgOhlc"></span></div>` +
      `<div class="lg-inds ${S.legendOpen ? '' : 'hidden'}">${indRT.filter(r => r.def.overlay).map(indRow).join('')}</div>`;
    $('#paneLegends').innerHTML = indRT.filter(r => !r.def.overlay).map(r => `<div class="pane-legend" data-pane="${r.pane}">${indRow(r)}</div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(positionPaneLegends));
  }
  function positionPaneLegends() {
    let top = 0;
    chart.panes().forEach((p, i) => {
      const el = $(`.pane-legend[data-pane="${i}"]`);
      if (el) el.style.top = (top + 4) + 'px';
      top += p.getHeight() + 1;
    });
  }
  let legendPending = false;
  function scheduleLegend() { if (legendPending) return; legendPending = true; requestAnimationFrame(() => { legendPending = false; updateLegend(); }); }
  function updateLegend() {
    const n = S.candles.length; if (!n) return;
    const i = hoverIdx != null ? Math.max(0, Math.min(n - 1, hoverIdx)) : n - 1;
    const c = S.chartType === 'heikin' ? I.heikinAshi(S.candles.slice(Math.max(0, i - 50), i + 1)).pop() : S.candles[i];
    const prev = S.candles[i - 1];
    const col = c.close >= c.open ? 'pos' : 'neg';
    const ch = prev ? c.close - prev.close : 0, chp = prev ? ch / prev.close * 100 : 0;
    const el = $('#lgOhlc');
    if (el) el.innerHTML = `<span class="hl">O<b class="${col}">${fmt(c.open)}</b> H<b class="${col}">${fmt(c.high)}</b> L<b class="${col}">${fmt(c.low)}</b> </span>C<b class="${col}">${fmt(c.close)}</b> <b class="${ch >= 0 ? 'pos' : 'neg'}">${ch >= 0 ? '+' : ''}${fmt(ch)} (${chp >= 0 ? '+' : ''}${chp.toFixed(2)}%)</b>`;
    for (const r of indRT) {
      const v = $(`[data-v="${r.inst.id}"]`); if (!v || !r.outs) continue;
      v.innerHTML = r.outs.map(o => `<span style="color:${(o.colors ? o.colors[i] : o.color).slice(0, 7)}">${r.def.volume ? fmtBig(o.data[i] || 0) : fmtInd(o.data[i])}</span>`).join(' ');
    }
  }
  chart.subscribeCrosshairMove(p => {
    hoverIdx = p && p.point && p.logical != null ? Math.round(p.logical) : null;
    scheduleLegend();
  });
  function onLegendClick(e) {
    if (e.target.closest('#lgToggle')) { S.legendOpen = !S.legendOpen; persist(); buildLegend(); updateLegend(); return; }
    const btn = e.target.closest('button[data-a]'); if (!btn) return;
    const id = btn.closest('[data-ind]').dataset.ind;
    const inst = S.indicators.find(x => x.id === id); if (!inst) return;
    if (btn.dataset.a === 'rm') { S.indicators = S.indicators.filter(x => x !== inst); rebuildIndicators(); }
    else if (btn.dataset.a === 'vis') { inst.visible = inst.visible === false; rebuildIndicators(); }
    else if (btn.dataset.a === 'set') openIndSettings(inst);
  }
  $('#legend').addEventListener('click', onLegendClick);
  $('#paneLegends').addEventListener('click', onLegendClick);
  $('#legend').addEventListener('touchstart', e => { const r = e.target.closest('.lg-row'); $$('.lg-row.touch').forEach(x => x !== r && x.classList.remove('touch')); r && r.classList.add('touch'); }, { passive: true });

  // ---------- selection toolbar (drawing yang dipilih) ----------
  const SWATCH = ['#2962ff', '#f5b301', '#089981', '#f23645', '#9c27b0', '#d1d4dc'];
  function renderSelBar(d) {
    const el = $('#selBar');
    if (!d) { el.classList.add('hidden'); return; }
    const box = drawings.screenBox(d);
    if (!box) { el.classList.add('hidden'); return; }
    const pos = d.type === 'long' || d.type === 'short';
    let html = '';
    if (!pos && d.type !== 'measure') html += SWATCH.map(c => `<span class="sw ${d.color === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('');
    if (pos) html += `<button class="b go" data-b="track">▶ Pantau setup</button>${S.spotOnly ? '' : '<button class="b" data-b="flip" title="Tukar long/short">⇅</button>'}`;
    if (d.type === 'text') html += `<button class="b" data-b="edit">✎</button>`;
    if (ALERTABLE[d.type]) html += `<button class="b ${d.alertOn ? 'on' : ''}" data-b="alert" title="Alert bila harga sentuh">${d.alertOn ? '🔕 Matikan' : '🔔 Alert'}</button>`;
    html += `<button class="b" data-b="del" title="Padam (Del)"><svg><use href="#i-trash"/></svg></button>`;
    el.innerHTML = html;
    el.classList.remove('hidden');
    const area = $('.chart-area').getBoundingClientRect();
    const w = el.offsetWidth || 200;
    el.style.left = Math.max(8, Math.min(area.width - w - 70, box.x)) + 'px';
    el.style.top = Math.max(40, box.y - (pos ? 66 : 48)) + 'px';
  }
  $('#selBar').addEventListener('click', e => {
    const d = drawings.selected(); if (!d) return;
    const sw = e.target.closest('[data-c]'); if (sw) { drawings.update({ color: sw.dataset.c }); return; }
    const b = e.target.closest('[data-b]'); if (!b) return;
    if (b.dataset.b === 'del') drawings.removeSelected();
    if (b.dataset.b === 'edit') { const t = prompt('Teks:', d.text); if (t != null && t.trim()) drawings.update({ text: t.trim() }); }
    if (b.dataset.b === 'flip') {
      const e0 = d.pts[0].p;
      drawings.update({ type: d.type === 'long' ? 'short' : 'long', tp: 2 * e0 - d.tp, sl: 2 * e0 - d.sl });
    }
    if (b.dataset.b === 'track') positionToSetup(d);
    if (b.dataset.b === 'alert') {
      const on = !d.alertOn;
      delete lineSide[d.id];
      drawings.update({ alertOn: on });
      restartTickers();
      if (on) toast('Alert garisan aktif', d.type === 'rect'
        ? 'Kau akan dapat notifikasi bila harga MASUK zon ni (sekali sahaja).'
        : 'Kau akan dapat notifikasi bila harga SENTUH atau PECAH garisan ni (sekali sahaja).', 'good');
    }
  });
  function positionToSetup(d) {
    S.draft = { ...S.draft, dir: d.type, type: 'limit', entry: roundP(d.pts[0].p), sl: roundP(d.sl), tp1: roundP(d.tp), tp2: null, note: S.draft.note || `${d.type === 'long' ? 'Long' : 'Short'} position tool` };
    syncDraftInputs(); drawLines(); renderCalc(); switchTab('setup', true);
    toast('Setup dari position tool', 'Semak nilai di panel Setup, kemudian tekan "Simpan & pantau".', 'info');
  }

  // ---------- price lines (setup, alert, draft) ----------
  function drawLines() {
    if (!mainSeries) return;
    priceLines.forEach(l => { try { mainSeries.removePriceLine(l); } catch {} });
    priceLines = [];
    const add = (price, color, title, style = 0, width = 1) => {
      if (price == null || !isFinite(price)) return;
      priceLines.push(mainSeries.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: true }));
    };
    const d = S.draft;
    add(d.entry, '#d1d4dc', 'ENTRY (draf)', 2);
    add(d.sl, DN, 'SL (draf)', 2);
    add(d.tp1, UP, 'TP1 (draf)', 2);
    add(d.tp2, UP, 'TP2 (draf)', 2);
    for (const s of S.setups) {
      if (s.symbol !== S.symbol || !isOpen(s)) continue;
      const tag = (s.dir === 'long' ? 'L' : 'S') + ' ';
      add(s.entry, '#2962ff', tag + 'Entry', 0, 2);
      add(s.sl, DN, tag + (s.sl === s.entry ? 'SL (BE)' : 'SL'));
      if (!s.tp1Hit) add(s.tp1, UP, tag + 'TP1');
      add(s.tp2, UP, tag + 'TP2');
    }
    for (const a of S.alerts) if (a.symbol === S.symbol) add(a.price, '#f5b301', '🔔', 1);
  }

  // klik chart untuk pilih harga (setup builder / alert)
  chart.subscribeClick(p => {
    if (!S.pick || !p.point || !mainSeries) return;
    const price = mainSeries.coordinateToPrice(p.point.y);
    if (price == null) return;
    const v = roundP(price);
    if (S.pick === 'alert') $('#fAlert').value = v;
    else { S.draft[S.pick] = v; syncDraftInputs(); }
    setPick(null); drawLines(); renderCalc();
  });
  function setPick(k) {
    if (k) drawings.setTool('cursor');
    S.pick = k;
    $$('.pick[data-pick]').forEach(b => b.classList.toggle('active', b.dataset.pick === k));
    const names = { entry: 'Entry', sl: 'Stop Loss', tp1: 'TP1', tp2: 'TP2', alert: 'Alert' };
    $('#pickBanner').textContent = k ? `Tap pada chart untuk set ${names[k]} · Esc/✕ batal` : '';
    $('#pickBanner').classList.toggle('hidden', !k);
  }
  // tekan banner = batal tool / pilihan harga (berguna di phone yang tiada kekunci Esc)
  $('#pickBanner').addEventListener('click', () => { setPick(null); drawings.cancel(); });

  // ---------- data feed ----------
  let feed = null, klineClose = null, tickClose = null, demoTimer = null, feedGen = 0;
  const setConn = (ok) => { $('#connDot').className = 'dot ' + (ok ? 'ok' : 'bad'); };
  const sourceLabel = () => S.demo ? 'Demo' : feed ? feed.label : '…';

  async function loadSymbol() {
    const gen = ++feedGen;
    closeKline();
    $('#symName').textContent = S.symbol;
    drawings.load(S.drawings[S.symbol]);
    buildLegend();
    if (S.demo) { startDemo(gen); return; }
    try {
      const r = await TD.feeds.history(S.symbol, S.interval, S.source, (label) => {
        if (gen === feedGen && $('#lgOhlc')) $('#lgOhlc').textContent = `Menyambung ke ${label}…`;
      });
      if (gen !== feedGen) return;
      const changed = !feed || feed.id !== r.feed.id;
      feed = r.feed; S.source = feed.id; persist();
      S.candles = r.candles;
      buildLegend(); afterLoad(); openKline(gen);
      if (changed) { allSymbols = null; restartTickers(true); }
    } catch (e) {
      if (gen !== feedGen) return;
      if (e.notFound) {
        toast('Pair tak dijumpai', `${S.symbol} tiada di sumber data yang boleh dicapai.`, 'bad');
        if (S.symbol !== 'BTCUSDT') { S.symbol = 'BTCUSDT'; persist(); renderWatch(); loadSymbol(); }
        return;
      }
      toast('Tak dapat sambung ke sumber data', 'Binance, OKX dan Coinbase semua gagal. Tukar ke mod demo. Semak internet, kemudian matikan mod demo di Tetapan.', 'bad');
      S.demo = true; $('#sDemo').checked = true; setModeBadge(); persist();
      buildLegend(); startDemo(gen); restartTickers(true);
    }
  }
  function afterLoad() {
    applyPrecision();
    S.lastSignalTime = S.candles.length ? S.candles[S.candles.length - 1].time : 0;
    renderAll(); drawLines();
    chart.timeScale().setVisibleLogicalRange({ from: S.candles.length - 150, to: S.candles.length + 10 });
    renderSymDetail();
  }

  function applyPrecision() {
    const last = S.candles[S.candles.length - 1];
    S.precision = decimalsFor(last ? last.close : 1);
    mainSeries.applyOptions({ priceFormat: priceFormat() });
    for (const r of indRT) if (r.def.overlay && !r.def.volume) r.series.forEach(s => s.applyOptions({ priceFormat: priceFormat() }));
  }

  function openKline(gen) {
    klineClose = feed.openKline(S.symbol, S.interval, {
      onOpen: () => setConn(true),
      onCandle: (c, closed) => { if (gen === feedGen) onKline(c, closed); },
      lastCandle: () => S.candles[S.candles.length - 1],
      onClose: () => {
        if (gen !== feedGen) return;
        setConn(false);
        setTimeout(() => { if (gen === feedGen) resync(gen); }, 2000);
      },
    });
  }
  // lepas putus sambungan: tarik balik candle yang terlepas, kemudian sambung semula
  async function resync(gen) {
    try {
      const c = await feed.history(S.symbol, S.interval);
      if (gen !== feedGen) return;
      S.candles = c; renderAll(); drawLines();
    } catch { /* cuba lagi */ }
    if (gen === feedGen) openKline(gen);
  }
  function closeKline() {
    if (klineClose) { const f = klineClose; klineClose = null; f(); }
    clearInterval(demoTimer); demoTimer = null;
  }

  function onKline(c, closed) {
    const n = S.candles.length, last = S.candles[n - 1];
    // julat harga SEJAK update sebelumnya sahaja (elak trigger palsu dari ekstrem lama)
    let hi = c.close, lo = c.close;
    if (last && c.time === last.time) {
      hi = c.high > last.high ? c.high : Math.max(last.close, c.close);
      lo = c.low < last.low ? c.low : Math.min(last.close, c.close);
      S.candles[n - 1] = c;
    } else if (!last || c.time > last.time) {
      if (last && last.time !== S.lastSignalTime) onCandleClosed(n - 1);
      hi = c.high; lo = c.low;
      S.candles.push(c); if (S.candles.length > 2000) S.candles.shift();
    } else return;
    renderLast();
    S.tickers[S.symbol] = { ...(S.tickers[S.symbol] || {}), price: c.close };
    onPrice(S.symbol, c.close, hi, lo);
    if (closed) onCandleClosed(S.candles.length - 1);
  }

  function onCandleClosed(i) {
    const c = S.candles[i];
    if (!c || c.time === S.lastSignalTime) return;
    S.lastSignalTime = c.time;
    renderMarkers();
    if (!S.autoSignal) return;
    for (const s of signalAt(signalsFor(S.candles), i)) {
      const spotSell = s.side === 'short' && S.spotOnly;
      notify(`Signal ${s.side === 'long' ? 'BUY' : 'SELL'} · ${S.symbol} ${S.interval}`,
        `${s.text} @ ${fmt(c.close)}${spotSell ? ' — akaun spot: jangan beli dulu, atau pertimbang ambil untung' : ''}`,
        s.side === 'long' ? 'good' : 'bad',
        spotSell ? null : { label: 'Buat setup', fn: () => suggestSetup(s.side) });
    }
  }

  function tickerSymbols() {
    const set = new Set(S.watch);
    S.setups.filter(isOpen).forEach(s => set.add(s.symbol));
    S.alerts.forEach(a => set.add(a.symbol));
    for (const [sym, list] of Object.entries(S.drawings)) if ((list || []).some(d => d.alertOn)) set.add(sym);
    set.add(S.symbol);
    return [...set];
  }
  let tickKey = '';
  function restartTickers(force) {
    const syms = tickerSymbols();
    const key = (S.demo ? 'demo' : feed ? feed.id : '-') + ':' + syms.join(',');
    if (!force && key === tickKey) return;
    tickKey = key;
    if (tickClose) { const f = tickClose; tickClose = null; f(); }
    if (S.demo || !feed) return;
    tickClose = feed.openTickers(syms, {
      onTick: (sym, t) => {
        S.tickers[sym] = t;
        if (sym !== S.symbol) onPrice(sym, t.price, t.price, t.price);
        scheduleUi();
      },
      onClose: () => { tickClose = null; setTimeout(() => restartTickers(true), 3000); },
    });
  }

  // ---------- demo feed ----------
  const DEMO_BASE = { BTCUSDT: 97000, ETHUSDT: 3400, SOLUSDT: 210, BNBUSDT: 640, XRPUSDT: 2.3, PAXGUSDT: 2650, DOGEUSDT: 0.38, ADAUSDT: 0.95, LINKUSDT: 22, AVAXUSDT: 45 };
  const demoPx = {};
  const demoStep = (p, vol) => p * (1 + (Math.random() - 0.5) * vol);
  function startDemo(gen) {
    setConn(true); setModeBadge();
    const sec = INTERVAL_SEC[S.interval];
    const base = demoPx[S.symbol] || DEMO_BASE[S.symbol] || 100;
    const now = Math.floor(Date.now() / 1000);
    let t = Math.floor(now / sec) * sec - 999 * sec;
    // random walk yang ditarik balik ke paras asas (supaya harga kekal realistik)
    const subVol = Math.min(0.04, 0.0015 * Math.sqrt(sec / 60)) / 2.4;
    let p = base;
    S.candles = [];
    for (let i = 0; i < 1000; i++, t += sec) {
      const target = base * (1 + 0.06 * Math.sin(i / 90) + 0.03 * Math.sin(i / 23));
      const o = p; let h = o, l = o;
      for (let j = 0; j < 6; j++) { p = demoStep(p, subVol * 2) + (target - p) * 0.01; h = Math.max(h, p); l = Math.min(l, p); }
      S.candles.push({ time: t, open: o, high: h, low: l, close: p, volume: (Math.random() * 80 + 20) * (1 + Math.abs(p - o) / o * 200) });
    }
    demoPx[S.symbol] = p;
    S.tickers[S.symbol] = { price: p, open: S.candles[Math.max(0, 1000 - Math.round(86400 / sec))].open };
    afterLoad();
    demoTimer = setInterval(() => {
      if (gen !== feedGen) return;
      for (const sym of tickerSymbols()) {
        if (sym === S.symbol) continue;
        const prev = demoPx[sym] || DEMO_BASE[sym] || 100;
        const np = demoStep(prev, 0.0015);
        demoPx[sym] = np;
        const o = S.tickers[sym]?.open || prev;
        S.tickers[sym] = { price: np, open: o, high: Math.max(S.tickers[sym]?.high || np, np), low: Math.min(S.tickers[sym]?.low || np, np) };
        onPrice(sym, np, np, np);
      }
      const last = S.candles[S.candles.length - 1];
      const bucket = Math.floor(Date.now() / 1000 / sec) * sec;
      const np = demoStep(last.close, 0.0015);
      demoPx[S.symbol] = np;
      if (bucket > last.time) {
        onKline({ ...last }, true);
        onKline({ time: bucket, open: last.close, high: Math.max(last.close, np), low: Math.min(last.close, np), close: np, volume: 1 }, false);
      } else {
        onKline({ ...last, high: Math.max(last.high, np), low: Math.min(last.low, np), close: np, volume: last.volume + Math.random() * 3 }, false);
      }
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

  // ---------- alert pada garisan / zon ----------
  const ALERTABLE = { hline: 'Garisan mendatar', trend: 'Trend line', ray: 'Ray', rect: 'Zon' };
  const lineSide = {}; // id lukisan -> kedudukan harga terakhir (1 atas, -1 bawah, 0 dalam zon)
  // harga garisan pada masa t (garisan dianggap lurus ikut masa; trend line disambung ke kanan)
  function linePriceAt(d, t) {
    if (d.type === 'hline') return d.pts[0].p;
    const [a, b] = d.pts;
    if (a.t === b.t) return null;
    if (t < Math.min(a.t, b.t)) return null;
    return a.p + (b.p - a.p) * (t - a.t) / (b.t - a.t);
  }
  function drawingsOf(sym) { return sym === S.symbol ? drawings.list() : (S.drawings[sym] || []); }
  function patchDrawing(sym, id, p) {
    if (sym === S.symbol) drawings.patch(id, p);
    else { const d = (S.drawings[sym] || []).find(x => x.id === id); if (d) { Object.assign(d, p); persist(); } }
  }
  function checkLineAlerts(sym, price, hi, lo) {
    const now = Date.now() / 1000;
    const fired = [];
    for (const d of drawingsOf(sym)) {
      if (!d.alertOn) continue;
      const dec = decOf(sym);
      if (d.type === 'rect') {
        const top = Math.max(d.pts[0].p, d.pts[1].p), bot = Math.min(d.pts[0].p, d.pts[1].p);
        const side = price > top ? 1 : price < bot ? -1 : 0;
        const prev = lineSide[d.id]; lineSide[d.id] = side;
        const entered = lo <= top && hi >= bot && (prev == null ? side === 0 : prev !== 0);
        if (!entered) continue;
        fired.push([d, `🔔 Harga masuk zon · ${sym}`, `Zon ${fmt(bot, dec)} – ${fmt(top, dec)}, harga sekarang ${fmt(price, dec)}${prev === 1 ? ' (turun dari atas)' : prev === -1 ? ' (naik dari bawah)' : ''}`]);
        continue;
      }
      const L = linePriceAt(d, now); if (L == null) continue;
      const side = price >= L ? 1 : -1;
      const prev = lineSide[d.id]; lineSide[d.id] = side;
      const crossed = prev != null && prev !== side;
      if (!crossed && !(lo <= L && hi >= L)) continue;
      const how = crossed ? (side > 0 ? 'pecah ke ATAS' : 'pecah ke BAWAH') : 'sentuh garisan';
      fired.push([d, `🔔 ${ALERTABLE[d.type]} · ${sym}`, `Harga ${how} pada ${fmt(L, dec)} (sekarang ${fmt(price, dec)})`]);
    }
    // alert sekali sahaja: matikan selepas trigger supaya tak spam
    for (const [d, title, body] of fired) {
      patchDrawing(sym, d.id, { alertOn: false, alertHitAt: Date.now() });
      notify(title, body, 'info', sym !== S.symbol ? { label: 'Buka chart', fn: () => goSymbol(sym) } : null);
    }
    if (fired.length) { renderAlerts(); restartTickers(); }
  }

  function onPrice(sym, price, hi = price, lo = price) {
    checkLineAlerts(sym, price, hi, lo);
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
    const entry = d.type === 'market' ? priceOf(S.symbol) : d.entry;
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
    $$('.field[data-f]').forEach(f => f.classList.toggle('err', bad.has(f.dataset.f) && S.draft[f.dataset.f] != null));
    const riskUsd = S.balance * S.riskPct / 100;
    let html = '';
    if (entry != null && d.sl != null && !bad.has('sl')) {
      const rpu = Math.abs(entry - d.sl), qty = riskUsd / rpu, notional = qty * entry, lev = notional / S.balance;
      const r1 = d.tp1 != null ? Math.abs(d.tp1 - entry) / rpu : null;
      const r2 = d.tp2 != null ? Math.abs(d.tp2 - entry) / rpu : null;
      html += `<span class="k">Risiko (${S.riskPct}% modal)</span><span class="v neg">${fmtUsd(riskUsd)}</span>`;
      html += `<span class="k">Jarak SL</span><span class="v">${fmt(rpu)} (${(rpu / entry * 100).toFixed(2)}%)</span>`;
      html += `<span class="k">Saiz posisi</span><span class="v big">${qty.toLocaleString('en-US', { maximumFractionDigits: qty < 1 ? 5 : 2 })} ${splitSym(S.symbol)[0]}</span>`;
      html += `<span class="k">Nilai posisi</span><span class="v">${fmtUsd(notional)}${lev > 1 ? ` <span class="neg">(${lev.toFixed(1)}x)</span>` : ''}</span>`;
      if (r1 != null && !bad.has('tp1')) html += `<span class="k">TP1 → R:R</span><span class="v pos">1 : ${r1.toFixed(2)} (${fmtUsd(r1 * riskUsd)})</span>`;
      if (r2 != null && !bad.has('tp2')) html += `<span class="k">TP2 → R:R</span><span class="v pos">1 : ${r2.toFixed(2)} (${fmtUsd(r2 * riskUsd)})</span>`;
      if (r1 != null && r1 < 1 && !bad.has('tp1')) html += `<span class="warn">R:R bawah 1:1 — untung kecil dari risiko. Fikir dua kali.</span>`;
      if (d.type === 'market') html += `<span class="k">Entry (market)</span><span class="v">${fmt(entry)}</span>`;
    } else {
      html += `<span class="k">Modal</span><span class="v">${fmtUsd(S.balance)}</span><span class="k">Risiko / trade</span><span class="v">${fmtUsd(riskUsd)}</span>`;
    }
    if (d.entry != null || d.sl != null || d.tp1 != null) for (const e of errs) html += `<span class="warn">• ${esc(e)}</span>`;
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
      status: d.type === 'market' ? 'active' : 'pending', trigger: entry <= px ? 'below' : 'above',
    };
    if (s.status === 'active') s.filledAt = Date.now();
    S.setups.unshift(s);
    S.draft = { ...S.draft, entry: null, sl: null, tp1: null, tp2: null, note: '' };
    persist(); syncDraftInputs(); drawLines(); renderCalc(); renderOpen(); restartTickers();
    toast('Setup disimpan', `${s.dir.toUpperCase()} ${s.symbol} — ${s.status === 'active' ? 'aktif sekarang' : 'menunggu harga ' + fmt(entry)}.`, 'good');
    switchTab('open', true);
  }
  function suggestSetup(side) {
    const n = S.candles.length; if (n < 30) return;
    const c = S.candles[n - 1], sig = signalsFor(S.candles), i = n - 1;
    if (!side) side = sig.e200[i] != null ? (c.close >= sig.e200[i] ? 'long' : 'short') : (sig.e20[i] >= sig.e50[i] ? 'long' : 'short');
    if (side === 'short' && S.spotOnly) {
      toast('Trend sedang turun', 'Akaun spot tak boleh short. Lebih selamat tunggu harga naik balik atas EMA50/EMA200 sebelum beli.', 'bad');
      return;
    }
    const at = I.atr(S.candles, 14), a = at[at.length - 1];
    const entry = c.close, L = side === 'long';
    const sl = L ? entry - 1.5 * a : entry + 1.5 * a, risk = Math.abs(entry - sl);
    S.draft = {
      ...S.draft, dir: side, type: 'limit', entry: roundP(entry), sl: roundP(sl),
      tp1: roundP(L ? entry + 1.5 * risk : entry - 1.5 * risk), tp2: roundP(L ? entry + 3 * risk : entry - 3 * risk),
      note: `Auto: ${L ? 'trend naik' : 'trend turun'} (EMA200), SL 1.5×ATR, TP 1.5R / 3R`,
    };
    syncDraftInputs(); drawLines(); renderCalc(); switchTab('setup', true);
    toast('Setup dicadangkan', 'Semak & ubah ikut struktur chart (support/resistance) sebelum simpan.', 'info');
  }

  // ---------- UI renders ----------
  let uiPending = false;
  function scheduleUi() {
    if (uiPending) return; uiPending = true;
    requestAnimationFrame(() => { uiPending = false; renderWatchPrices(); renderOpenLive(); renderSymDetail(); });
  }
  function setModeBadge() { $('#modeBadge').textContent = S.demo ? 'DEMO' : 'LIVE'; $('#modeBadge').classList.toggle('demo', S.demo); }

  function updateHeader() {
    const n = S.candles.length; if (!n) return;
    const px = S.candles[n - 1].close;
    document.title = `${S.symbol} ${fmt(px)} · TradeDesk`;
    if (S.draft.type === 'market') renderCalc();
  }

  function renderIntervals() {
    $('#intervals').innerHTML = INTERVALS.map(i => `<button data-i="${i}" class="${i === S.interval ? 'on' : ''}">${i}</button>`).join('');
  }
  function renderTypeMenu() {
    $('#typeMenu').innerHTML = Object.entries(CHART_TYPES).map(([k, v]) => `<button data-t="${k}" class="${k === S.chartType ? 'on' : ''}">${v}</button>`).join('');
    $('#typeName').textContent = CHART_TYPES[S.chartType];
  }

  function renderWatch() {
    $('#watchlist').innerHTML = S.watch.map(s => {
      const [b, q] = splitSym(s);
      return `<div class="wl-row ${s === S.symbol ? 'on' : ''}" data-s="${esc(s)}"><b>${esc(b)}<span class="muted">${esc(q)}</span></b><span data-p="${esc(s)}">—</span><span data-c="${esc(s)}"></span><button class="x" data-rm="${esc(s)}" title="Buang">✕</button></div>`;
    }).join('');
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
  function renderSymDetail() {
    const t = S.tickers[S.symbol]; const px = priceOf(S.symbol);
    if (px == null) return;
    const ch = t?.open ? (px - t.open) / t.open * 100 : null;
    $('#symDetail').innerHTML =
      `<div class="big">${fmt(px)} <span class="${ch >= 0 ? 'pos' : 'neg'}" style="font-size:14px">${ch != null ? (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%' : ''}</span></div>` +
      `<span>Simbol</span><b>${esc(S.symbol)}</b>` +
      (t?.high ? `<span>Tinggi 24j</span><b>${fmt(t.high)}</b><span>Rendah 24j</span><b>${fmt(t.low)}</b>` : '') +
      (t?.qvol ? `<span>Vol 24j</span><b>${fmtBig(t.qvol)} ${esc(splitSym(S.symbol)[1])}</b>` : '');
  }

  function setupCard(s, closed) {
    const d = decimalsFor(s.entry);
    const statusTxt = {
      pending: 'Tunggu entry', active: 'AKTIF',
      closed: { tp: 'Profit', sl: 'Loss', be: 'Breakeven', manual: 'Tutup manual' }[s.outcome],
      cancelled: { invalid: 'Batal (SL dulu)', missed: 'Terlepas', cancel: 'Dibatalkan' }[s.outcome],
    }[s.status];
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
    $('#openCount').classList.toggle('hidden', !open.length);
    $('#openList').innerHTML = open.length ? open.map(s => setupCard(s, false)).join('') : '<div class="empty">Tiada setup dipantau.<br>Buat satu di tab Setup, atau guna tool Long/Short position.</div>';
    renderOpenLive();
  }
  function renderOpenLive() {
    for (const s of S.setups) {
      if (!isOpen(s)) continue;
      const el = $(`[data-live="${s.id}"]`); if (!el) continue;
      const px = priceOf(s.symbol), d = decimalsFor(s.entry);
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
    const priceCards = S.alerts.map(a => `<div class="card"><div class="hd"><b data-go="${esc(a.symbol)}">${esc(a.symbol)}</b><span>${a.dir === 'up' ? '↑ naik ke' : '↓ turun ke'} <b>${fmt(a.price, decimalsFor(a.price))}</b> <button class="btn small ghost" data-rmalert="${a.id}">✕</button></span></div></div>`);
    const lineCards = Object.keys(S.drawings).flatMap(sym => drawingsOf(sym).filter(d => d.alertOn).map(d =>
      `<div class="card"><div class="hd"><b data-go="${esc(sym)}">${esc(sym)}</b><span>🔔 ${ALERTABLE[d.type]} <button class="btn small ghost" data-rmline="${esc(sym)}|${d.id}">✕</button></span></div></div>`));
    $('#alertList').innerHTML = priceCards.concat(lineCards).join('') ||
      '<div class="empty">Tiada alert.<br>Taip harga di atas, atau lukis garisan / zon pada chart, pilih, dan tekan 🔔 Alert.</div>';
    $('#logList').innerHTML = S.log.slice(0, 40).map(l => `<div class="card"><time>${new Date(l.t).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}</time><b>${esc(l.title)}</b> — ${esc(l.body)}</div>`).join('') || '<div class="empty">Belum ada notifikasi.</div>';
  }
  function renderJournal() {
    const done = S.setups.filter(s => !isOpen(s));
    const traded = done.filter(s => s.status === 'closed');
    const wins = traded.filter(s => s.r > 0.01).length;
    const totalR = traded.reduce((a, s) => a + (s.r || 0), 0);
    const totalPnl = traded.reduce((a, s) => a + (s.pnl || 0), 0);
    $('#stats').innerHTML = [
      ['Trade', traded.length], ['Win rate', traded.length ? Math.round(wins / traded.length * 100) + '%' : '—'], ['Purata', fmtR(traded.length ? totalR / traded.length : 0)],
      ['Jumlah R', fmtR(totalR)], ['P/L', fmtUsd(totalPnl)], ['Batal', done.length - traded.length],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    $('#journalList').innerHTML = done.length ? done.slice(0, 100).map(s => setupCard(s, true)).join('') : '<div class="empty">Jurnal kosong. Setup yang selesai akan masuk sini.</div>';
  }
  function switchTab(t, forceOpen) {
    if (t === S.sideTab && !forceOpen && !S.sideCollapsed) S.sideCollapsed = true;
    else { S.sideTab = t; S.sideCollapsed = false; }
    $('#side').classList.toggle('collapsed', S.sideCollapsed);
    $$('#rail button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.sideTab && !S.sideCollapsed));
    $$('.tab-body').forEach(b => b.classList.toggle('hidden', b.dataset.body !== S.sideTab));
    persist();
  }

  // ---------- notifikasi ----------
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
    toast(title, body, type, action); beep(type);
    S.log.unshift({ t: Date.now(), title, body }); S.log = S.log.slice(0, 100);
    persist(); renderAlerts();
    try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body }); } catch {}
  }

  // ---------- symbol search ----------
  let allSymbols = null, symQuote = 'USDT', symHl = 0;
  async function loadSymbols() {
    if (allSymbols) return;
    if (S.demo) { allSymbols = Object.entries(DEMO_BASE).map(([s, p]) => ({ s, p })); return; }
    try { if (!feed) throw new Error('tiada sumber'); allSymbols = await feed.symbols(); }
    catch { allSymbols = S.watch.map(s => ({ s, p: S.tickers[s]?.price })); }
  }
  function openModal(id) { $$('.modal').forEach(m => m.classList.add('hidden')); $(id).classList.remove('hidden'); }
  function closeModals() { $$('.modal').forEach(m => m.classList.add('hidden')); }
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); }));

  async function openSymbolSearch(initial = '') {
    openModal('#symModal');
    const q = $('#symQuery'); q.value = initial; q.focus();
    $('#symResults').innerHTML = '<div class="empty">Memuatkan…</div>';
    await loadSymbols(); renderSymResults();
  }
  function symMatches() {
    const q = $('#symQuery').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    let list = (allSymbols || []).filter(x => !symQuote || splitSym(x.s)[1] === symQuote);
    if (q) {
      list = list.filter(x => x.s.includes(q));
      list.sort((a, b) => (b.s.startsWith(q) - a.s.startsWith(q)) || (a.s.length - b.s.length));
    } else {
      const pri = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'PAXG', 'LINK', 'AVAX', 'SUI', 'TON'];
      list.sort((a, b) => ((pri.indexOf(splitSym(a.s)[0]) + 1 || 99) - (pri.indexOf(splitSym(b.s)[0]) + 1 || 99)));
    }
    return list.slice(0, 80);
  }
  function renderSymResults() {
    const list = symMatches(); symHl = 0;
    $('#symResults').innerHTML = list.length ? list.map((x, i) => {
      const [b, q] = splitSym(x.s);
      return `<div class="res ${i === 0 ? 'hl' : ''}" data-sym="${esc(x.s)}"><b>${esc(b)}<span class="muted">/${esc(q)}</span></b><span class="d">Binance spot</span><span>${x.p ? fmt(x.p, decimalsFor(x.p)) : ''}</span>${S.watch.includes(x.s) ? '<span class="muted">★</span>' : `<button class="add" data-addw="${esc(x.s)}" title="Tambah ke watchlist">＋</button>`}</div>`;
    }).join('') : '<div class="empty">Tiada padanan.</div>';
  }
  $('#symQuery').addEventListener('input', renderSymResults);
  $('#symQuery').addEventListener('keydown', e => {
    const rows = $$('#symResults .res');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); rows[symHl]?.classList.remove('hl');
      symHl = Math.max(0, Math.min(rows.length - 1, symHl + (e.key === 'ArrowDown' ? 1 : -1)));
      rows[symHl]?.classList.add('hl'); rows[symHl]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const r = rows[symHl];
      if (r) { closeModals(); goSymbol(r.dataset.sym); }
      else { const s = $('#symQuery').value.trim().toUpperCase(); if (s) { closeModals(); goSymbol(s); } }
    }
  });
  $('#quoteSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    symQuote = b.dataset.q; $$('#quoteSeg button').forEach(x => x.classList.toggle('on', x === b)); renderSymResults(); $('#symQuery').focus();
  });
  $('#symResults').addEventListener('click', e => {
    const add = e.target.closest('[data-addw]');
    if (add) { e.stopPropagation(); addWatch(add.dataset.addw); renderSymResults(); return; }
    const r = e.target.closest('[data-sym]'); if (r) { closeModals(); goSymbol(r.dataset.sym); }
  });

  // ---------- indicator dialog ----------
  function openIndicators() {
    openModal('#indModal'); $('#indQuery').value = ''; renderIndResults(); $('#indQuery').focus();
  }
  function renderIndResults() {
    const q = $('#indQuery').value.trim().toLowerCase();
    $('#indResults').innerHTML = Object.entries(I.DEFS)
      .filter(([k, d]) => !q || d.name.toLowerCase().includes(q) || d.desc.toLowerCase().includes(q) || k.includes(q))
      .map(([k, d]) => `<div class="res" data-ind-add="${k}"><b>${esc(d.name)}</b><span class="d">${esc(d.desc)}</span><span class="muted">${d.overlay ? 'atas chart' : 'panel'}</span></div>`).join('');
  }
  $('#indQuery').addEventListener('input', renderIndResults);
  $('#indResults').addEventListener('click', e => {
    const r = e.target.closest('[data-ind-add]'); if (!r) return;
    S.indicators.push(mkInd(r.dataset.indAdd));
    rebuildIndicators();
    toast('Indikator ditambah', I.DEFS[r.dataset.indAdd].name, 'info');
  });
  let editingInd = null;
  function openIndSettings(inst) {
    editingInd = inst;
    const def = I.DEFS[inst.type];
    $('#indSetTitle').textContent = def.name;
    $('#indSetBody').innerHTML =
      def.params.map(p => `<div class="field"><label>${esc(p.label)}</label><input type="number" step="${p.step || 1}" data-pk="${p.k}" value="${inst.params[p.k]}"></div>`).join('') +
      inst.colors.map((c, i) => `<div class="field"><label>Warna ${inst.colors.length > 1 ? i + 1 : ''}</label><input type="color" data-ci="${i}" value="${c.slice(0, 7)}"></div>`).join('');
    openModal('#indSetModal');
  }
  $('#indSetSave').onclick = () => {
    if (!editingInd) return;
    $$('#indSetBody [data-pk]').forEach(inp => { const v = num(inp.value); if (v != null && v > 0) editingInd.params[inp.dataset.pk] = v; });
    $$('#indSetBody [data-ci]').forEach(inp => { const i = +inp.dataset.ci; editingInd.colors[i] = inp.value + editingInd.colors[i].slice(7); });
    closeModals(); rebuildIndicators();
  };

  // ---------- events ----------
  $('#intervals').addEventListener('click', e => {
    const i = e.target.dataset.i; if (!i || i === S.interval) return;
    S.interval = i; persist(); renderIntervals(); loadSymbol();
  });
  $('#btnType').onclick = (e) => { e.stopPropagation(); $('#typeMenu').classList.toggle('hidden'); };
  $('#typeMenu').addEventListener('click', e => {
    const t = e.target.dataset.t; if (!t) return;
    S.chartType = t; persist(); renderTypeMenu(); $('#typeMenu').classList.add('hidden'); rebuildChart();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.dd')) $('#typeMenu').classList.add('hidden'); });
  $('#btnSymbol').onclick = () => openSymbolSearch();
  $('#btnInd').onclick = openIndicators;
  $('#btnSignals').onclick = () => { S.showSignals = !S.showSignals; $('#btnSignals').classList.toggle('on', S.showSignals); persist(); renderMarkers(); };
  $('#btnAlertQuick').onclick = () => { switchTab('alerts', true); const px = priceOf(S.symbol); if (px) $('#fAlert').value = roundP(px); $('#fAlert').focus(); };
  $('#btnUndo').onclick = () => drawings.undo();
  $('#btnShot').onclick = () => {
    const cv = chart.takeScreenshot(true);
    cv.toBlob(b => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(b);
      a.download = `${S.symbol}_${S.interval}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };
  $('#btnFull').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); };

  $('#drawbar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) { setPick(null); drawings.setTool(drawings.getTool() === b.dataset.tool ? 'cursor' : b.dataset.tool); }
  });
  $('#btnMagnet').onclick = () => { S.magnet = !S.magnet; drawings.setMagnet(S.magnet); $('#btnMagnet').classList.toggle('on', S.magnet); persist(); };
  $('#btnHide').onclick = () => { S.hideDrawings = !S.hideDrawings; drawings.setHidden(S.hideDrawings); $('#btnHide').classList.toggle('on', S.hideDrawings); };
  $('#btnClearDraw').onclick = () => { if (confirm('Padam semua lukisan untuk ' + S.symbol + '?')) drawings.clearAll(); };

  function setScaleMode(m) {
    S.priceMode = S.priceMode === m ? 0 : m;
    mainSeries.priceScale().applyOptions({ mode: S.priceMode });
    $('#btnScalePct').classList.toggle('on', S.priceMode === 2);
    $('#btnScaleLog').classList.toggle('on', S.priceMode === 1);
    persist(); drawings.redraw();
  }
  $('#btnScalePct').onclick = () => setScaleMode(2);
  $('#btnScaleLog').onclick = () => setScaleMode(1);
  $('#btnScaleAuto').onclick = () => { mainSeries.priceScale().applyOptions({ autoScale: true }); chart.timeScale().scrollToRealTime(); };
  $('#btnRealtime').onclick = () => chart.timeScale().scrollToRealTime();
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    $('#btnRealtime').classList.toggle('hidden', chart.timeScale().scrollPosition() > -2);
    const d = drawings.selected(); if (d) renderSelBar(d);
  });

  function goSymbol(sym) {
    sym = sym.toUpperCase();
    if (sym === S.symbol) return;
    S.symbol = sym; persist(); renderWatch(); setPick(null);
    S.draft = { ...S.draft, entry: null, sl: null, tp1: null, tp2: null };
    syncDraftInputs(); renderCalc(); loadSymbol(); restartTickers();
  }
  function addWatch(s) { if (!S.watch.includes(s)) { S.watch.push(s); persist(); renderWatch(); restartTickers(); } }
  $('#btnAddWatch').onclick = () => { if (S.watch.includes(S.symbol)) openSymbolSearch(); else addWatch(S.symbol); };
  $('#watchlist').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); S.watch = S.watch.filter(s => s !== rm.dataset.rm); persist(); renderWatch(); restartTickers(); return; }
    const w = e.target.closest('.wl-row'); if (w) goSymbol(w.dataset.s);
  });

  $('#rail').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
  $('#btnSuggest').onclick = () => suggestSetup();
  $('#dirSeg').addEventListener('click', e => { const d = e.target.dataset.dir; if (d) { S.draft.dir = d; syncDraftInputs(); renderCalc(); } });
  $('#typeSeg').addEventListener('click', e => {
    const t = e.target.dataset.type; if (!t) return;
    S.draft.type = t;
    if (t === 'market' && priceOf(S.symbol) != null) S.draft.entry = roundP(priceOf(S.symbol));
    syncDraftInputs(); drawLines(); renderCalc();
  });
  [['#fEntry', 'entry'], ['#fSl', 'sl'], ['#fTp1', 'tp1'], ['#fTp2', 'tp2']].forEach(([sel, k]) => {
    $(sel).addEventListener('input', e => { S.draft[k] = num(e.target.value); drawLines(); renderCalc(); });
  });
  $('#fBE').onchange = e => { S.draft.be = e.target.checked; };
  $('#fNote').oninput = e => { S.draft.note = e.target.value; };
  $$('.pick[data-pick]').forEach(b => b.onclick = () => setPick(S.pick === b.dataset.pick ? null : b.dataset.pick));
  $('#btnNow').onclick = () => { if (priceOf(S.symbol) == null) return; S.draft.entry = roundP(priceOf(S.symbol)); syncDraftInputs(); drawLines(); renderCalc(); };
  $('#btnSave').onclick = saveDraft;
  $('#btnClear').onclick = () => { S.draft = { ...S.draft, entry: null, sl: null, tp1: null, tp2: null, note: '' }; syncDraftInputs(); drawLines(); renderCalc(); };

  document.body.addEventListener('click', e => {
    const go = e.target.closest('[data-go]'); if (go) { goSymbol(go.dataset.go); return; }
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      const s = S.setups.find(x => x.id === actBtn.closest('.card').dataset.id); if (!s) return;
      if (actBtn.dataset.act === 'close') {
        const px = priceOf(s.symbol); if (px == null) return;
        closeSetup(s, px, 'manual');
        notify(`Setup ditutup · ${s.symbol}`, `Manual @ ${fmt(px, decOf(s.symbol))} (${fmtR(s.r)} / ${fmtUsd(s.pnl)})`, s.r >= 0 ? 'good' : 'bad');
      } else if (actBtn.dataset.act === 'cancel') {
        if (s.status === 'active') S.setups = S.setups.filter(x => x !== s); else closeSetup(s, null, 'cancel');
      }
      persist(); drawLines(); renderOpen(); renderJournal(); restartTickers();
    }
    const rma = e.target.closest('[data-rmalert]');
    if (rma) { S.alerts = S.alerts.filter(a => a.id !== rma.dataset.rmalert); persist(); renderAlerts(); drawLines(); restartTickers(); }
    const rml = e.target.closest('[data-rmline]');
    if (rml) { const [sym, id] = rml.dataset.rmline.split('|'); patchDrawing(sym, id, { alertOn: false }); renderAlerts(); restartTickers(); }
  });

  $('#btnAddAlert').onclick = () => {
    const p = num($('#fAlert').value), px = priceOf(S.symbol);
    if (p == null || px == null) return;
    S.alerts.push({ id: uid(), symbol: S.symbol, price: p, dir: p >= px ? 'up' : 'down' });
    $('#fAlert').value = '';
    persist(); renderAlerts(); drawLines(); restartTickers();
    toast('Alert ditambah', `${S.symbol} ${p >= px ? '↑' : '↓'} ${fmt(p)}`, 'info');
  };
  $('#btnClearJournal').onclick = () => { if (confirm('Padam semua rekod jurnal?')) { S.setups = S.setups.filter(isOpen); persist(); renderJournal(); } };

  // tetapan
  // ---- mata wang paparan (RM / USD) ----
  function renderCcy() {
    $('#sCcy').value = S.ccy;
    $('#sFx').value = S.fx;
    $('#fxRow').classList.toggle('hidden', S.ccy !== 'MYR');
    $('#lblBalance').textContent = `Modal (${S.ccy === 'MYR' ? 'RM' : 'USD'})`;
    $('#sBalance').value = +(S.balance * ccyFactor()).toFixed(2);
  }
  function refreshMoney() { renderCalc(); renderOpen(); renderJournal(); drawings.redraw(); }
  async function updateFx() {
    // kadar USD→MYR live (Coinbase). Kalau gagal, guna kadar tersimpan / yang ditaip sendiri.
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
      const j = await (await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', { signal: ctl.signal })).json();
      clearTimeout(t);
      const r = +j?.data?.rates?.MYR;
      if (r > 1 && r < 20) { S.fx = +r.toFixed(4); persist(); renderCcy(); refreshMoney(); $('#fxNote').textContent = 'Kadar live dikemas kini ' + new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' }); }
    } catch { $('#fxNote').textContent = 'Tak dapat kadar live — guna kadar di atas (boleh ubah sendiri).'; }
  }
  $('#sCcy').onchange = e => { S.ccy = e.target.value; persist(); renderCcy(); refreshMoney(); if (S.ccy === 'MYR') updateFx(); };
  $('#sFx').oninput = e => { const v = num(e.target.value); if (v > 1 && v < 20) { S.fx = v; persist(); $('#sBalance').value = +(S.balance * ccyFactor()).toFixed(2); refreshMoney(); } };

  // ---- mod akaun spot (beli sahaja) ----
  function applySpot() {
    $('#sSpot').checked = S.spotOnly;
    $$('[data-tool="short"]').forEach(b => b.classList.toggle('hidden', S.spotOnly));
    $('#dirSeg [data-dir="short"]').classList.toggle('hidden', S.spotOnly);
    if (S.spotOnly && S.draft.dir === 'short') { S.draft.dir = 'long'; syncDraftInputs(); renderCalc(); }
  }
  $('#sSpot').onchange = e => { S.spotOnly = e.target.checked; persist(); applySpot(); };

  renderCcy(); applySpot();
  if (S.ccy === 'MYR') updateFx();
  $('#sRisk').value = S.riskPct;
  $('#sSound').checked = S.sound; $('#sAutoSignal').checked = S.autoSignal; $('#sDemo').checked = S.demo;
  $('#sBalance').oninput = e => { const v = num(e.target.value); if (v > 0) { S.balance = v / ccyFactor(); persist(); renderCalc(); drawings.redraw(); } };
  $('#sRisk').oninput = e => { const v = num(e.target.value); if (v > 0 && v <= 100) { S.riskPct = v; persist(); renderCalc(); drawings.redraw(); } };
  $('#sSound').onchange = e => { S.sound = e.target.checked; persist(); if (S.sound) beep('info'); };
  $('#sAutoSignal').onchange = e => { S.autoSignal = e.target.checked; persist(); };
  $('#sDemo').onchange = e => { S.demo = e.target.checked; S.demoManual = S.demo; persist(); setModeBadge(); S.tickers = {}; allSymbols = null; restartTickers(true); loadSymbol(); };
  $('#btnNotif').onclick = async () => {
    if (!('Notification' in window)) { toast('Tak disokong', 'Browser ni tak sokong notifikasi.', 'bad'); return; }
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Notifikasi aktif' : 'Notifikasi ditolak', p === 'granted' ? 'Notifikasi masuk walaupun tab di belakang.' : 'Benarkan dalam tetapan browser.', p === 'granted' ? 'good' : 'bad');
  };

  // keyboard
  document.addEventListener('keydown', e => {
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape') { closeModals(); setPick(null); drawings.cancel(); return; }
    if (inInput) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); drawings.undo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (drawings.selected()) { e.preventDefault(); drawings.removeSelected(); } return; }
    if (e.altKey) {
      const map = { t: 'trend', h: 'hline', v: 'vline', f: 'fib', r: 'rect', l: 'long', s: 'short' };
      const t = map[e.key.toLowerCase()]; if (t) { e.preventDefault(); drawings.setTool(t); }
      return;
    }
    if (!e.ctrlKey && !e.metaKey && /^[a-zA-Z0-9]$/.test(e.key) && $('#symModal').classList.contains('hidden') && $('#indModal').classList.contains('hidden')) {
      e.preventDefault(); openSymbolSearch(e.key);
    }
  });

  // jam + countdown candle
  setInterval(() => {
    const d = new Date(), off = -d.getTimezoneOffset() / 60;
    $('#clock').textContent = d.toLocaleTimeString('en-GB') + ` (UTC${off >= 0 ? '+' : ''}${off})`;
    drawings.redraw();
  }, 1000);
  new ResizeObserver(() => { positionPaneLegends(); const d = drawings.selected(); if (d) renderSelBar(d); }).observe(chartHost);
  chartHost.addEventListener('pointerup', () => setTimeout(positionPaneLegends, 0));

  // ---------- boot ----------
  setModeBadge();
  $('#btnSignals').classList.toggle('on', S.showSignals);
  $('#btnMagnet').classList.toggle('on', S.magnet);
  $('#btnScalePct').classList.toggle('on', S.priceMode === 2);
  $('#btnScaleLog').classList.toggle('on', S.priceMode === 1);
  renderIntervals(); renderTypeMenu(); renderWatch(); syncDraftInputs(); renderCalc(); renderOpen(); renderAlerts(); renderJournal();
  switchTab(S.sideTab, !S.sideCollapsed);
  if (S.sideCollapsed) { S.sideCollapsed = false; switchTab(S.sideTab); }
  createMain(); buildIndicators();
  loadSymbol(); restartTickers(true);

  window.TradeDesk = { S, chart, drawings, onPrice, suggestSetup, get mainSeries() { return mainSeries; } };
})();
