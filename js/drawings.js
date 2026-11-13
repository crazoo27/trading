/* Drawing tools: trendline, ray, horizontal/vertical line, rectangle, fibonacci,
 * long/short position, measure, text. Dilukis sebagai series primitive supaya bergerak
 * bersama chart semasa pan/zoom. Titik disimpan sebagai {t: masa UTC (saat), p: harga}. */
window.TD = window.TD || {};
TD.createDrawings = function (ctx) {
  'use strict';

  const TWO_POINT = new Set(['trend', 'ray', 'rect', 'fib', 'measure']);
  const FIB = [
    [0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'],
    [0.618, '#089981'], [0.786, '#00bcd4'], [1, '#787b86'], [1.618, '#2962ff'],
  ];

  let series = null, requestUpdate = () => {};
  let items = [];
  let tool = 'cursor';
  let selectedId = null;
  let creating = null, createStart = null;
  let drag = null;
  let hidden = false, magnet = false;
  let undoStack = [];
  let pointerType = 'mouse';
  let blockCompat = false;

  // ---------- koordinat ----------
  const ts = () => ctx.chart.timeScale();
  function timeToLogical(t) {
    const c = ctx.getCandles(), n = c.length, sec = ctx.getSec();
    if (!n) return null;
    if (t <= c[0].time) return (t - c[0].time) / sec;
    if (t >= c[n - 1].time) return n - 1 + (t - c[n - 1].time) / sec;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m].time <= t) lo = m; else hi = m; }
    return lo + (t - c[lo].time) / (c[hi].time - c[lo].time);
  }
  function logicalToTime(l) {
    const c = ctx.getCandles(), n = c.length, sec = ctx.getSec();
    if (!n) return null;
    if (l <= 0) return c[0].time + l * sec;
    if (l >= n - 1) return c[n - 1].time + (l - (n - 1)) * sec;
    const i = Math.floor(l), f = l - i;
    return c[i].time + f * (c[i + 1].time - c[i].time);
  }
  const X = (t) => { const l = timeToLogical(t); return l == null ? null : ts().logicalToCoordinate(l); };
  const Y = (p) => series ? series.priceToCoordinate(p) : null;

  function fromPos(pos) {
    if (!series) return null;
    const l = ts().coordinateToLogical(pos.x);
    if (l == null) return null;
    const li = Math.round(l);
    let p = series.coordinateToPrice(pos.y);
    if (p == null) return null;
    const c = ctx.getCandles()[li];
    if (magnet && c) {
      let best = p, bd = Infinity;
      for (const v of [c.open, c.high, c.low, c.close]) { const d = Math.abs(Y(v) - pos.y); if (d < bd) { bd = d; best = v; } }
      p = best;
    }
    return { t: logicalToTime(li), p };
  }

  // ---------- primitive ----------
  const primitive = {
    attached(param) { requestUpdate = param.requestUpdate; },
    detached() { requestUpdate = () => {}; },
    updateAllViews() {},
    paneViews() {
      return [{
        zOrder: () => 'top',
        renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => render(context, mediaSize)) }),
      }];
    },
    priceAxisViews() {
      const views = [];
      if (!hidden) {
        for (const d of all()) {
          if (d.type === 'hline') views.push(axisView(d.pts[0].p, d.color));
          if ((d.type === 'long' || d.type === 'short') && d.id === selectedId) {
            views.push(axisView(d.tp, '#089981'), axisView(d.sl, '#f23645'), axisView(d.pts[0].p, '#787b86'));
          }
        }
      }
      const cd = ctx.countdown && ctx.countdown();
      if (cd) views.push({ coordinate: () => (Y(cd.price) ?? -100) + 19, text: () => cd.text, textColor: () => '#fff', backColor: () => cd.color });
      return views;
    },
  };
  const axisView = (price, color) => ({ coordinate: () => Y(price) ?? -100, text: () => ctx.fmt(price), textColor: () => '#fff', backColor: () => color });

  function attach(s) {
    series = s;
    s.attachPrimitive(primitive);
  }

  const all = () => creating ? [...items, creating] : items;

  // ---------- render ----------
  let paneW = 0;
  function render(g, size) {
    paneW = size.width;
    if (hidden || !series) return;
    g.save();
    g.lineCap = 'round';
    for (const d of all()) {
      try { drawOne(g, d, size, d.id === selectedId || d === creating); } catch { /* titik di luar skala */ }
    }
    g.restore();
  }

  function line(g, x1, y1, x2, y2, color, w = 1.5, dash) {
    g.beginPath(); g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []);
    g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
  }
  function handle(g, x, y, color) {
    g.beginPath(); g.arc(x, y, pointerType === 'touch' ? 6 : 4.5, 0, Math.PI * 2);
    g.fillStyle = '#0b0e14'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = color; g.stroke();
  }
  function label(g, text, x, y, bg, fg = '#fff', align = 'center') {
    g.font = '11px -apple-system, Segoe UI, Roboto, sans-serif';
    const lines = String(text).split('\n');
    const w = Math.max(...lines.map(l => g.measureText(l).width)) + 12, h = lines.length * 15 + 6;
    let x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    // pastikan label kekal dalam kawasan chart (penting di skrin phone yang sempit)
    if (paneW) x0 = Math.max(4, Math.min(paneW - w - 4, x0));
    const y0 = y - h / 2;
    g.fillStyle = bg; roundRect(g, x0, y0, w, h, 4); g.fill();
    g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'left';
    lines.forEach((l, i) => g.fillText(l, x0 + 6, y0 + 3 + 7.5 + i * 15));
    return { x: x0, y: y0, w, h };
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  const alpha = (hex, a) => {
    const h = hex.replace('#', '').slice(0, 6);
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  };

  function geom(d) {
    return d.pts.map(pt => ({ x: X(pt.t), y: Y(pt.p) }));
  }

  function drawOne(g, d, size, sel) {
    const P = geom(d);
    const c = d.color || '#2962ff';
    switch (d.type) {
      case 'trend': {
        line(g, P[0].x, P[0].y, P[1].x, P[1].y, c, 2);
        if (sel) { handle(g, P[0].x, P[0].y, c); handle(g, P[1].x, P[1].y, c); }
        break;
      }
      case 'ray': {
        const dx = P[1].x - P[0].x, dy = P[1].y - P[0].y;
        const k = dx === 0 && dy === 0 ? 0 : 5000 / Math.hypot(dx, dy);
        line(g, P[0].x, P[0].y, P[0].x + dx * k, P[0].y + dy * k, c, 2);
        if (sel) { handle(g, P[0].x, P[0].y, c); handle(g, P[1].x, P[1].y, c); }
        break;
      }
      case 'hline': {
        line(g, 0, P[0].y, size.width, P[0].y, c, 1.5);
        if (sel) handle(g, size.width / 2, P[0].y, c);
        break;
      }
      case 'vline': {
        line(g, P[0].x, 0, P[0].x, size.height, c, 1.5);
        if (sel) handle(g, P[0].x, size.height / 2, c);
        break;
      }
      case 'rect': {
        const x = Math.min(P[0].x, P[1].x), y = Math.min(P[0].y, P[1].y), w = Math.abs(P[1].x - P[0].x), h = Math.abs(P[1].y - P[0].y);
        g.fillStyle = alpha(c, 0.15); g.fillRect(x, y, w, h);
        g.strokeStyle = c; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
        if (sel) { handle(g, P[0].x, P[0].y, c); handle(g, P[1].x, P[1].y, c); }
        break;
      }
      case 'fib': {
        const x1 = Math.min(P[0].x, P[1].x), x2 = Math.max(P[0].x, P[1].x);
        const A = d.pts[0].p, B = d.pts[1].p;
        let prevY = null;
        for (const [lvl, col] of FIB) {
          const price = B + (A - B) * lvl, y = Y(price);
          if (y == null) continue;
          if (prevY != null) { g.fillStyle = alpha(col, 0.08); g.fillRect(x1, Math.min(prevY, y), x2 - x1, Math.abs(y - prevY)); }
          line(g, x1, y, x2, y, col, 1);
          g.font = '11px sans-serif'; g.fillStyle = col; g.textAlign = 'right'; g.textBaseline = 'middle';
          g.fillText(`${lvl} (${ctx.fmt(price)})`, x1 - 4, y);
          prevY = y;
        }
        line(g, P[0].x, P[0].y, P[1].x, P[1].y, '#787b86', 1, [4, 4]);
        if (sel) { handle(g, P[0].x, P[0].y, c); handle(g, P[1].x, P[1].y, c); }
        break;
      }
      case 'long': case 'short': {
        drawPosition(g, d, P, sel);
        break;
      }
      case 'measure': {
        const up = d.pts[1].p >= d.pts[0].p;
        const col = up ? '#2962ff' : '#f23645';
        const x = Math.min(P[0].x, P[1].x), y = Math.min(P[0].y, P[1].y), w = Math.abs(P[1].x - P[0].x), h = Math.abs(P[1].y - P[0].y);
        g.fillStyle = alpha(col, 0.15); g.fillRect(x, y, w, h);
        const mx = (P[0].x + P[1].x) / 2;
        line(g, mx, P[0].y, mx, P[1].y, col, 1.5);
        line(g, P[0].x, (P[0].y + P[1].y) / 2, P[1].x, (P[0].y + P[1].y) / 2, col, 1, [3, 3]);
        const dp = d.pts[1].p - d.pts[0].p, pct = dp / d.pts[0].p * 100;
        const bars = Math.round(timeToLogical(d.pts[1].t) - timeToLogical(d.pts[0].t));
        const secs = Math.abs(d.pts[1].t - d.pts[0].t);
        const dur = secs >= 86400 ? (secs / 86400).toFixed(1) + 'h' : secs >= 3600 ? (secs / 3600).toFixed(1) + 'j' : Math.round(secs / 60) + 'm';
        label(g, `${dp >= 0 ? '+' : ''}${ctx.fmt(dp)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)\n${bars} bar, ${dur}`, mx, up ? y - 22 : y + h + 22, col);
        break;
      }
      case 'text': {
        const b = label(g, d.text || 'Teks', P[0].x, P[0].y, alpha(c, 0.9), '#fff', 'left');
        d._box = b;
        if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2); }
        break;
      }
    }
    if (d.alertOn) alertMark(g, d, P, size);
  }

  // tanda 🔔 untuk lukisan yang ada alert; trend line disambung ke kanan (paras yang akan trigger alert)
  function alertMark(g, d, P, size) {
    let x, y;
    if (d.type === 'hline') { x = size.width - 16; y = P[0].y; }
    else if (d.type === 'rect') { x = Math.max(P[0].x, P[1].x); y = Math.min(P[0].y, P[1].y); }
    else {
      const right = P[0].x <= P[1].x ? P[1] : P[0], left = right === P[1] ? P[0] : P[1];
      if (d.type === 'trend' && right.x < size.width) {
        const k = (right.y - left.y) / ((right.x - left.x) || 1);
        line(g, right.x, right.y, size.width, right.y + k * (size.width - right.x), d.color || '#2962ff', 1, [5, 4]);
      }
      x = Math.min(right.x, size.width - 16); y = right.y;
    }
    g.font = '14px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText('🔔', x, y - 4);
  }

  function drawPosition(g, d, P, sel) {
    const x0 = Math.min(P[0].x, P[1].x), x1 = Math.max(P[0].x, P[1].x), w = Math.max(x1 - x0, 1);
    const yE = P[0].y, yT = Y(d.tp), yS = Y(d.sl);
    g.fillStyle = 'rgba(8,153,129,0.22)'; g.fillRect(x0, Math.min(yE, yT), w, Math.abs(yT - yE));
    g.fillStyle = 'rgba(242,54,69,0.22)'; g.fillRect(x0, Math.min(yE, yS), w, Math.abs(yS - yE));
    line(g, x0, yE, x1, yE, '#9598a1', 1);
    const entry = d.pts[0].p, risk = Math.abs(entry - d.sl), reward = Math.abs(d.tp - entry);
    const rr = risk ? reward / risk : 0;
    const { balance, riskPct } = ctx.getRisk();
    const riskUsd = balance * riskPct / 100, qty = risk ? riskUsd / risk : 0;
    const pct = (v) => (Math.abs(v - entry) / entry * 100).toFixed(2) + '%';
    const mx = (x0 + x1) / 2;
    const up = d.type === 'long';
    // label di luar kotak supaya tak bertindih dengan label tengah walaupun kotak kecil
    const yTl = up ? Math.min(yT, yE - 20) - 12 : Math.max(yT, yE + 20) + 12;
    const ySl = up ? Math.max(yS, yE + 20) + 12 : Math.min(yS, yE - 20) - 12;
    if (sel || w > 140) {
      label(g, `Target: ${ctx.fmt(d.tp)} (${pct(d.tp)})  +${ctx.money(rr * riskUsd)}`, mx, yTl, '#089981');
      label(g, `Stop: ${ctx.fmt(d.sl)} (${pct(d.sl)})  -${ctx.money(riskUsd)}`, mx, ySl, '#f23645');
    }
    label(g, `${up ? 'Long' : 'Short'} · R:R ${rr.toFixed(2)} · Qty ${qty < 1 ? qty.toFixed(5) : qty.toFixed(2)}`, mx, yE, 'rgba(30,34,45,0.92)');
    if (sel) {
      handle(g, x0, yE, '#9598a1'); handle(g, x0, yT, '#089981'); handle(g, x0, yS, '#f23645'); handle(g, x1, yE, '#9598a1');
    }
  }

  // ---------- hit test ----------
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function hitOne(d, x, y, size) {
    const R = pointerType === 'touch' ? 14 : 8, L = pointerType === 'touch' ? 10 : 6;
    const P = geom(d);
    const near = (p) => p.x != null && p.y != null && Math.hypot(x - p.x, y - p.y) <= R;
    const inBox = (a, b) => x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y);
    switch (d.type) {
      case 'trend': case 'ray': case 'rect': case 'fib': case 'measure':
        if (near(P[0])) return 'p0';
        if (near(P[1])) return 'p1';
        if (d.type === 'trend' && distSeg(x, y, P[0].x, P[0].y, P[1].x, P[1].y) <= L) return 'body';
        if (d.type === 'ray') {
          const dx = P[1].x - P[0].x, dy = P[1].y - P[0].y, k = 5000 / (Math.hypot(dx, dy) || 1);
          if (distSeg(x, y, P[0].x, P[0].y, P[0].x + dx * k, P[0].y + dy * k) <= L) return 'body';
        }
        if ((d.type === 'rect' || d.type === 'fib' || d.type === 'measure') && inBox(P[0], P[1])) return 'body';
        return null;
      case 'hline': return Math.abs(y - P[0].y) <= L ? 'body' : null;
      case 'vline': return Math.abs(x - P[0].x) <= L ? 'body' : null;
      case 'text': { const b = d._box; return b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h ? 'body' : null; }
      case 'long': case 'short': {
        const x0 = Math.min(P[0].x, P[1].x), x1 = Math.max(P[0].x, P[1].x);
        const yT = Y(d.tp), yS = Y(d.sl), yE = P[0].y;
        if (near({ x: x0, y: yT })) return 'tp';
        if (near({ x: x0, y: yS })) return 'sl';
        if (near({ x: x1, y: yE })) return 'edge';
        if (near({ x: x0, y: yE })) return 'entry';
        if (x >= x0 && x <= x1 && y >= Math.min(yT, yS) && y <= Math.max(yT, yS)) return 'body';
        return null;
      }
    }
    return null;
  }
  function hitTest(pos, size) {
    if (hidden) return null;
    // yang dipilih dahulu, kemudian yang terkini di atas
    const order = [...items].reverse().sort((a, b) => (b.id === selectedId) - (a.id === selectedId));
    for (const d of order) { const part = hitOne(d, pos.x, pos.y, size); if (part) return { d, part }; }
    return null;
  }

  // ---------- interaksi ----------
  const host = ctx.host;
  function localPos(e) {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function inMainPane(pos) {
    const ps = ctx.chart.paneSize(0);
    return pos.x >= 0 && pos.x <= ts().width() && pos.y >= 0 && pos.y <= ps.height;
  }
  function intercept(e) {
    e.stopPropagation(); e.preventDefault(); blockCompat = true;
  }
  const snapshot = () => JSON.stringify(items.map(strip));
  const strip = (d) => { const { _box, ...rest } = d; return rest; };
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 50) undoStack.shift(); }
  const commit = () => { ctx.onChange(items.map(strip)); requestUpdate(); };

  function newDrawing(type, pt) {
    const d = { id: Math.random().toString(36).slice(2, 10), type, pts: [{ ...pt }, { ...pt }], color: ctx.defaultColor(type) };
    if (type === 'long' || type === 'short') {
      const a = ctx.getAtr() || pt.p * 0.01;
      const s = type === 'long' ? 1 : -1;
      d.sl = pt.p - s * 1.5 * a; d.tp = pt.p + s * 3 * a;
      d.pts[1] = { t: pt.t + 25 * ctx.getSec(), p: pt.p };
    }
    if (type === 'text') { d.text = (window.prompt('Teks:', '') || '').trim(); if (!d.text) return null; }
    return d;
  }

  function finalize(d) {
    pushUndo();
    items.push(d); creating = null; createStart = null;
    selectedId = d.id;
    setTool('cursor');
    commit(); ctx.onSelect(d);
  }

  function onDown(e) {
    pointerType = e.pointerType || 'mouse';
    if (e.button && e.button !== 0) return;
    const pos = localPos(e);
    if (!inMainPane(pos)) return;
    const size = ctx.chart.paneSize(0);

    if (tool !== 'cursor') {
      intercept(e);
      const pt = fromPos(pos); if (!pt) return;
      if (!creating) {
        const d = newDrawing(tool, pt); if (!d) { setTool('cursor'); return; }
        if (TWO_POINT.has(tool)) { creating = d; createStart = pos; requestUpdate(); }
        else finalize(d);
      } else {
        creating.pts[1] = pt; finalize(creating);
      }
      return;
    }

    const h = hitTest(pos, size);
    if (h) {
      intercept(e);
      selectedId = h.d.id; ctx.onSelect(h.d);
      pushUndo();
      const l0 = ts().coordinateToLogical(pos.x), p0 = series.coordinateToPrice(pos.y);
      drag = { d: h.d, part: h.part, l0, p0, orig: JSON.parse(JSON.stringify(strip(h.d))), moved: false };
      requestUpdate();
    } else if (selectedId) {
      selectedId = null; ctx.onSelect(null); requestUpdate();
    }
  }

  function onMove(e) {
    if (!creating && !drag) {
      if (tool === 'cursor' && e.pointerType !== 'touch') {
        const pos = localPos(e);
        const h = inMainPane(pos) && hitTest(pos);
        host.style.cursor = h ? (h.part === 'body' ? 'move' : 'pointer') : '';
      }
      return;
    }
    const pos = localPos(e);
    if (creating) {
      const pt = fromPos(pos); if (pt) { creating.pts[1] = pt; requestUpdate(); }
      return;
    }
    const { d, part, orig } = drag;
    const pt = fromPos(pos); if (!pt) return;
    drag.moved = true;
    const l = ts().coordinateToLogical(pos.x), p = series.coordinateToPrice(pos.y);
    const dl = Math.round(l - drag.l0), dp = p - drag.p0;
    const shift = (q) => ({ t: logicalToTime(Math.round(timeToLogical(q.t)) + dl), p: q.p + dp });
    if (part === 'body') {
      if (d.type === 'hline') d.pts[0].p = orig.pts[0].p + dp;
      else if (d.type === 'vline') d.pts[0].t = shift(orig.pts[0]).t;
      else {
        d.pts = orig.pts.map(shift);
        if (d.tp != null) { d.tp = orig.tp + dp; d.sl = orig.sl + dp; }
      }
    } else if (part === 'p0') d.pts[0] = pt;
    else if (part === 'p1') d.pts[1] = pt;
    else if (part === 'entry') d.pts[0] = { t: pt.t, p: pt.p };
    else if (part === 'edge') d.pts[1] = { t: pt.t, p: d.pts[0].p };
    else if (part === 'tp') d.tp = pt.p;
    else if (part === 'sl') d.sl = pt.p;
    ctx.onSelect(d);
    requestUpdate();
  }

  function onUp(e) {
    setTimeout(() => { blockCompat = false; }, 60);
    if (creating && createStart) {
      const pos = localPos(e);
      if (Math.hypot(pos.x - createStart.x, pos.y - createStart.y) > 8) {
        const pt = fromPos(pos); if (pt) creating.pts[1] = pt;
        finalize(creating);
      }
      return;
    }
    if (drag) {
      if (!drag.moved) undoStack.pop();
      drag = null; commit();
    }
  }

  host.addEventListener('pointerdown', onDown, true);
  for (const ev of ['mousedown', 'touchstart']) {
    host.addEventListener(ev, (e) => { if (blockCompat) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } }, { capture: true, passive: false });
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  function setTool(t) {
    tool = t; creating = null; createStart = null;
    host.classList.toggle('drawing', t !== 'cursor');
    ctx.onTool(t);
    requestUpdate();
  }

  return {
    attach,
    setTool, getTool: () => tool,
    load(list) { items = (list || []).map(d => ({ ...d })); undoStack = []; selectedId = null; creating = null; ctx.onSelect(null); requestUpdate(); },
    selected: () => items.find(d => d.id === selectedId) || null,
    list: () => items,
    // ubah lukisan tanpa undo/pilihan (cth bila alert garisan dah trigger)
    patch(id, p) { const d = items.find(x => x.id === id); if (!d) return; Object.assign(d, p); commit(); if (d.id === selectedId) ctx.onSelect(d); },
    update(patch) { const d = items.find(x => x.id === selectedId); if (!d) return; pushUndo(); Object.assign(d, patch); commit(); ctx.onSelect(d); },
    removeSelected() { if (!selectedId) return; pushUndo(); items = items.filter(d => d.id !== selectedId); selectedId = null; ctx.onSelect(null); commit(); },
    clearAll() { if (!items.length) return; pushUndo(); items = []; selectedId = null; ctx.onSelect(null); commit(); },
    undo() { const s = undoStack.pop(); if (s == null) return; items = JSON.parse(s); selectedId = null; ctx.onSelect(null); commit(); },
    cancel() { if (creating) { creating = null; requestUpdate(); } if (tool !== 'cursor') setTool('cursor'); else if (selectedId) { selectedId = null; ctx.onSelect(null); requestUpdate(); } },
    setHidden(b) { hidden = b; requestUpdate(); },
    setMagnet(b) { magnet = b; },
    redraw: () => requestUpdate(),
    screenBox(d) {
      const P = geom(d).filter(p => p.x != null && p.y != null);
      if (d.tp != null) { P.push({ x: P[0].x, y: Y(d.tp) }, { x: P[0].x, y: Y(d.sl) }); }
      if (!P.length) return null;
      return { x: Math.min(...P.map(p => p.x)), y: Math.min(...P.map(p => p.y)), x2: Math.max(...P.map(p => p.x)), y2: Math.max(...P.map(p => p.y)) };
    },
  };
};
