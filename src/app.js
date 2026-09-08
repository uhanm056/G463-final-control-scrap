/* G463 Prefix — aplikace: stav, agregace, RAG, záložky, import, localStorage. */
(function () {
  'use strict';
  var P = G463Parser, C = G463Charts, esc = C.esc, fmt = C.fmtNum;
  var LS_KEY = 'g463.db.v1', LS_SET = 'g463.settings.v1';
  var COL = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', s4: '#eda100', s5: '#e87ba4', s6: '#008300', s7: '#4a3aa7', s8: '#e34948', gray: '#898781' };
  var SLOTS = [COL.s1, COL.s2, COL.s3, COL.s4, COL.s5, COL.s6, COL.s7, COL.s8];
  var LINE_COL = { 1: COL.s1, 2: COL.s2, all: COL.gray }, SIDE_COL = { LH: COL.s1, RH: COL.s2 }, SRC_COL = { PREFIX: COL.s1, SKLAD: COL.s2 };
  var VAR_COL = {}; P.VARIANTS.forEach(function (v, i) { VAR_COL[v] = SLOTS[i]; }); VAR_COL['ostatní'] = COL.gray;
  var RAG = {
    red: { cls: 'rag-red', icon: '▲', label: 'zhoršení' }, green: { cls: 'rag-green', icon: '▼', label: 'zlepšení' },
    amber: { cls: 'rag-amber', icon: '●', label: 'beze změny' }, na: { cls: 'rag-na', icon: '–', label: 'bez srovnání' }
  };
  var TABS = ['Přehled', 'Finální kontrola Prefix', 'Kontrola MC', 'Posouzení', 'Scrap', 'Data & metodika'];

  var DB = emptyDb(), S = { tab: 0, period: 'week', span: 13, top: 'wo' };
  function emptyDb() { return { meta: { builtAt: null, savedAt: null }, qc: { checked: [], defects: [] }, mc: { checked: [], defects: [] }, pos: [], rework: [], scrap: [], sources: [], warnings: [] }; }

  /* ---------- období ---------- */
  function pk(r) { return S.period === 'week' ? r.w : r.d.slice(0, 7); }
  function plabel(k) { return S.period === 'week' ? k.replace(/^\d{4}-/, '') : k.slice(5, 7) + '/' + k.slice(2, 4); }
  function plabelLong(k) { return S.period === 'week' ? k.replace(/^(\d{4})-(W\d+)$/, '$2 $1') : k.slice(5, 7) + '/' + k.slice(0, 4); }
  function periodsOf() {
    var set = {}, i, arr = [].concat(DB.qc.checked, DB.mc.checked, DB.pos, DB.scrap);
    for (i = 0; i < arr.length; i++) set[pk(arr[i])] = 1;
    var keys = Object.keys(set).sort();
    return S.span && keys.length > S.span ? keys.slice(-S.span) : keys;
  }
  function lastTwo(rows) { // poslední dvě období, ve kterých má daný zdroj data
    var set = {}, i; for (i = 0; i < rows.length; i++) set[pk(rows[i])] = 1;
    var k = Object.keys(set).sort(); return { last: k[k.length - 1] || null, prev: k[k.length - 2] || null };
  }
  function sumBy(rows, keyFn, valFn, filter) {
    var out = {}, i, r;
    for (i = 0; i < rows.length; i++) { r = rows[i]; if (filter && !filter(r)) continue; var k = keyFn(r); out[k] = (out[k] || 0) + (valFn ? (valFn(r) || 0) : 1); }
    return out;
  }
  function pct(a, b) { return b ? (a / b) * 100 : null; }

  /* ---------- RAG: barva i číslo ze stejného výpočtu (W_n vs W_n-1) ---------- */
  function ragPP(last, prev, thr) {
    if (last == null || prev == null) return { status: 'na', text: '–' };
    var d = last - prev, st = d > thr ? 'red' : d < -thr ? 'green' : 'amber';
    return { status: st, text: (d > 0 ? '+' : '') + fmt(d, 1) + ' pp' };
  }
  function ragRel(last, prev, thr, zeroMin) {
    if (last == null || prev == null) return { status: 'na', text: '–' };
    if (prev === 0 && last > zeroMin) return { status: 'red', text: 'z nuly' };
    if (prev > zeroMin && last === 0) return { status: 'green', text: 'na nulu' };
    if (prev === 0) return { status: 'na', text: '–' };
    var rel = ((last - prev) / prev) * 100, st = rel > thr ? 'red' : rel < -thr ? 'green' : 'amber';
    return { status: st, text: (rel > 0 ? '+' : '') + fmt(rel, 0) + ' %' };
  }
  function kpiCard(o) {
    var r = o.rag || { status: 'na', text: '–' }, R = RAG[r.status];
    return '<div class="kpi"><div class="kt">' + esc(o.title) + '</div><div class="kv">' + esc(o.value) + '<span class="ku">' + esc(o.unit || '') + '</span></div>' +
      '<div class="kd"><span class="rag ' + R.cls + '">' + R.icon + ' ' + esc(r.text) + '</span><span class="ks">' + esc(o.sub || '') + '</span></div></div>';
  }

  /* ---------- agregace ---------- */
  function qcLineStats(line) { // per linka & období: checked, defects, dpu100, posud
    var f = function (r) { return line === 'all' || r.line === line; };
    var chk = sumBy(DB.qc.checked, pk, function (r) { return r.checked; }, f), pos = sumBy(DB.qc.checked, pk, function (r) { return r.posud; }, f);
    var def = sumBy(DB.qc.defects, pk, function (r) { return r.n; }, f), out = {}, k;
    for (k in chk) out[k] = { checked: chk[k], defects: def[k] || 0, dpu: pct(def[k] || 0, chk[k]), posud: pos[k] || 0, posudPct: pct(pos[k] || 0, chk[k]) };
    return out;
  }
  function mcStats(filter) {
    var chk = sumBy(DB.mc.checked, pk, function (r) { return r.checked; }, filter), pos = sumBy(DB.mc.checked, pk, function (r) { return r.posud; }, filter);
    var nok = sumBy(DB.mc.checked, pk, function (r) { return r.nok; }, filter), def = sumBy(DB.mc.defects, pk, function (r) { return r.n; }, filter), out = {}, k;
    for (k in chk) out[k] = { checked: chk[k], defects: def[k] || 0, dpu: pct(def[k] || 0, chk[k]), posud: pos[k] || 0, posudPct: pct(pos[k] || 0, chk[k]), nok: nok[k] || 0, nokPct: pct(nok[k] || 0, chk[k]) };
    return out;
  }
  function defectRates(defects, checkedRows, filter, period) { // {defect: rate%} za jedno období (Pareto dle posledního období)
    var chk = 0, i, cnt = {};
    for (i = 0; i < checkedRows.length; i++) if (pk(checkedRows[i]) === period && (!filter || filter(checkedRows[i]))) chk += checkedRows[i].checked;
    for (i = 0; i < defects.length; i++) if (pk(defects[i]) === period && (!filter || filter(defects[i]))) cnt[defects[i].defect] = (cnt[defects[i].defect] || 0) + defects[i].n;
    var out = Object.keys(cnt).map(function (d) { return { defect: d, n: cnt[d], rate: pct(cnt[d], chk) }; });
    out.sort(function (a, b) { return b.n - a.n; });
    return { checked: chk, items: out };
  }
  var DEFECT_COL = {};
  function defectColors() { // barva sleduje vadu, ne pořadí: top 8 dle celkového součtu (QC + MC)
    var tot = sumBy(DB.qc.defects.concat(DB.mc.defects), function (r) { return r.defect; }, function (r) { return r.n; });
    var names = Object.keys(tot).sort(function (a, b) { return tot[b] - tot[a]; });
    DEFECT_COL = {}; names.forEach(function (n, i) { DEFECT_COL[n] = SLOTS[i] || COL.gray; });
  }
  function seriesTrend(defects, checkedRows, filter, names, periods) { // % z kontrolovaných za období pro vybrané vady
    var chk = sumBy(checkedRows, pk, function (r) { return r.checked; }, filter);
    return names.map(function (name) {
      var cnt = sumBy(defects, pk, function (r) { return r.n; }, function (r) { return r.defect === name && (!filter || filter(r)); });
      return { name: name, color: DEFECT_COL[name] || COL.gray, type: 'line', values: periods.map(function (p) { return chk[p] ? pct(cnt[p] || 0, chk[p]) : null; }) };
    });
  }

  /* ---------- UI helpers ---------- */
  function panel(title, body, extra) { return '<div class="panel"><div class="ph"><span>' + title + '</span>' + (extra || '') + '</div><div class="pb">' + body + '</div></div>'; }
  function chartBox(id, height) { return '<div class="chw" data-ch="' + id + '" style="min-height:' + (height || 40) + 'px"></div>'; }
  var CHARTS = {};
  function defChart(id, fn, height) { CHARTS[id] = fn; return chartBox(id, height); }
  function drawCharts() {
    var els = document.querySelectorAll('[data-ch]'), i;
    for (i = 0; i < els.length; i++) {
      var el = els[i], fn = CHARTS[el.getAttribute('data-ch')];
      if (fn) el.innerHTML = fn(Math.max(320, el.clientWidth || 800));
    }
  }
  function table(head, rows, cls) {
    return '<div class="tw"><table class="' + (cls || '') + '"><thead><tr>' + head.map(function (h, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + (i ? esc(c) : c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function empty(msg) { return '<div class="empty">' + msg + '</div>'; }
  function nowKey() { var t = new Date(); return S.period === 'week' ? P.isoWeek(t) : P.isoDate(t).slice(0, 7); }
  function cmpLabel(lt) { return lt.last ? plabelLong(lt.last) + (lt.last === nowKey() ? ' (rozdělané)' : '') + (lt.prev ? ' vs ' + plabelLong(lt.prev) : '') : ''; }

  /* ---------- 0 · Přehled ---------- */
  function viewOverview() {
    var periods = periodsOf(), h = '', L1 = qcLineStats(1), L2 = qcLineStats(2), MC = mcStats();
    var ltQ = lastTwo(DB.qc.checked), ltM = lastTwo(DB.mc.checked), ltP = lastTwo(DB.pos.filter(function (r) { return r.src === 'PREFIX'; })), ltS = lastTwo(DB.pos.filter(function (r) { return r.src === 'SKLAD'; })), ltX = lastTwo(DB.scrap);
    var g = function (st, k, f) { return st[k] ? st[k][f] : null; };
    var cards = [];
    [[1, L1], [2, L2]].forEach(function (x) {
      cards.push(kpiCard({ title: 'L' + x[0] + ' · vad na 100 ks', value: fmt(g(x[1], ltQ.last, 'dpu'), 0), rag: ragPP(g(x[1], ltQ.last, 'dpu'), g(x[1], ltQ.prev, 'dpu'), 10), sub: cmpLabel(ltQ) }));
    });
    cards.push(kpiCard({ title: 'MC · NOK po posouzení', value: fmt(g(MC, ltM.last, 'nokPct'), 1), unit: '%', rag: ragPP(g(MC, ltM.last, 'nokPct'), g(MC, ltM.prev, 'nokPct'), 2), sub: cmpLabel(ltM) }));
    var posCnt = function (src, k) { return k ? DB.pos.filter(function (r) { return r.src === src && pk(r) === k; }).length : null; };
    cards.push(kpiCard({ title: 'Posouzení PREFIX', value: fmt(posCnt('PREFIX', ltP.last)), unit: 'ks', rag: ragRel(posCnt('PREFIX', ltP.last), posCnt('PREFIX', ltP.prev), 25, 5), sub: cmpLabel(ltP) }));
    cards.push(kpiCard({ title: 'Posouzení SKLAD', value: fmt(posCnt('SKLAD', ltS.last)), unit: 'ks', rag: ragRel(posCnt('SKLAD', ltS.last), posCnt('SKLAD', ltS.prev), 25, 5), sub: cmpLabel(ltS) }));
    var sc = function (k) { return k ? DB.scrap.filter(function (r) { return pk(r) === k && !r.excluded && !r.test; }).reduce(function (a, r) { return a + r.eur; }, 0) : null; };
    cards.push(kpiCard({ title: 'Scrap PCO001 · w/o tests', value: DB.scrap.length ? fmt(sc(ltX.last)) : '–', unit: DB.scrap.length ? 'EUR' : '', rag: DB.scrap.length ? ragRel(sc(ltX.last), sc(ltX.prev), 25, 50) : null, sub: DB.scrap.length ? cmpLabel(ltX) : 'nahraj QAD export' }));
    h += '<div class="grid6">' + cards.join('') + '</div>';
    var ser = [
      { name: 'L1 Prefix', color: LINE_COL[1], type: 'line', values: periods.map(function (p) { return L1[p] ? L1[p].dpu : null; }) },
      { name: 'L2 Prefix', color: LINE_COL[2], type: 'line', values: periods.map(function (p) { return L2[p] ? L2[p].dpu : null; }) },
      { name: 'Kontrola MC', color: COL.s3, type: 'line', values: periods.map(function (p) { return MC[p] ? MC[p].dpu : null; }) }
    ];
    h += '<div class="two">' + panel('Vad na 100 kontrolovaných ks — L1 / L2 / MC', C.legend(ser) + defChart('ov1', function (w) { return C.xyChart({ width: w, height: 280, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: ser }); }));
    var ps = [{ name: 'PREFIX', color: SRC_COL.PREFIX, values: [] }, { name: 'SKLAD', color: SRC_COL.SKLAD, values: [] }];
    var cP = sumBy(DB.pos, pk, null, function (r) { return r.src === 'PREFIX'; }), cS = sumBy(DB.pos, pk, null, function (r) { return r.src === 'SKLAD'; });
    ps[0].values = periods.map(function (p) { return cP[p] || null; }); ps[1].values = periods.map(function (p) { return cS[p] || null; });
    h += panel('Posouzení MC — ks za období', C.legend(ps) + defChart('ov2', function (w) { return C.xyChart({ width: w, height: 280, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: ps, barLabels: true }); })) + '</div>';
    var rows = [];
    [['L1 Prefix', L1, ltQ], ['L2 Prefix', L2, ltQ], ['Kontrola MC', MC, ltM]].forEach(function (x) {
      var a = x[1][x[2].last]; if (!a) return;
      rows.push([esc(x[0]), plabelLong(x[2].last), fmt(a.checked), fmt(a.defects), fmt(a.dpu, 0), fmt(a.posud), fmt(a.posudPct, 1) + ' %', a.nokPct != null ? fmt(a.nokPct, 1) + ' %' : '–']);
    });
    h += panel('Poslední období — souhrn', table(['Zdroj', 'Období', 'Kontrolováno', 'Vad celkem', 'Vad / 100 ks', 'Na posouzení', 'Posouzení %', 'NOK %'], rows));
    return h;
  }

  /* ---------- 1 · Finální kontrola Prefix (L1 a L2 vždy odděleně) ---------- */
  function viewPrefix() {
    if (!DB.qc.checked.length) return empty('Žádná data z kontrolného reportu Prefix (CZ25170). Nahraj ho v záložce <b>Data &amp; metodika</b>.');
    var periods = periodsOf(), lt = lastTwo(DB.qc.checked), h = '<div class="two">';
    [1, 2].forEach(function (line) {
      var st = qcLineStats(line), a = st[lt.last], b = st[lt.prev], f = function (r) { return r.line === line; };
      var body = '<div class="grid3">' +
        kpiCard({ title: 'Kontrolováno', value: fmt(a ? a.checked : null), unit: 'ks', rag: ragRel(a ? a.checked : null, b ? b.checked : null, 25, 5), sub: cmpLabel(lt) }) +
        kpiCard({ title: 'Vad na 100 ks', value: fmt(a ? a.dpu : null, 0), rag: ragPP(a ? a.dpu : null, b ? b.dpu : null, 10), sub: cmpLabel(lt) }) +
        kpiCard({ title: 'Na posouzení', value: fmt(a ? a.posudPct : null, 1), unit: '%', rag: ragPP(a ? a.posudPct : null, b ? b.posudPct : null, 2), sub: cmpLabel(lt) }) + '</div>';
      var dr = defectRates(DB.qc.defects, DB.qc.checked, f, lt.last), top5 = dr.items.slice(0, 5);
      body += '<h4>Top 5 vad — ' + plabelLong(lt.last) + ' <span class="muted">(% z kontrolovaných, Pareto dle posledního období)</span></h4>';
      body += defChart('pf-top-' + line, function (w) {
        return C.hbars({ width: w, rows: top5.map(function (it) { return { label: it.defect, values: [it.rate], notes: [fmt(it.n) + ' ks'] }; }), series: [{ name: 'L' + line, color: LINE_COL[line] }], fmt: function (v) { return fmt(v, 1); }, unit: ' %' });
      });
      var names = top5.map(function (it) { return it.defect; }), ser = seriesTrend(DB.qc.defects, DB.qc.checked, f, names, periods);
      body += '<h4>Trend top 5 vad <span class="muted">(% z kontrolovaných)</span></h4>' + C.legend(ser) + defChart('pf-tr-' + line, function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: ser, dec: 0, unit: ' %' }); });
      // podle varianty: v reportu Prefix je checked jen per linka, proto ks vad a podíl na vadách linky
      var byVar = sumBy(DB.qc.defects, function (r) { return r.variant; }, function (r) { return r.n; }, function (r) { return f(r) && pk(r) === lt.last; });
      var totV = 0; Object.keys(byVar).forEach(function (k) { totV += byVar[k]; });
      var vrows = P.VARIANTS.filter(function (v) { return byVar[v]; }).map(function (v) { return { label: v, values: [byVar[v]], notes: [fmt(pct(byVar[v], totV), 0) + ' %'] }; });
      body += '<h4>Vady podle varianty — ' + plabelLong(lt.last) + ' <span class="muted">(ks a podíl na vadách linky; kontrolované ks jsou v reportu jen per linka)</span></h4>';
      body += defChart('pf-var-' + line, function (w) {
        return C.hbars({ width: w, rows: vrows, series: [{ name: 'L' + line, color: LINE_COL[line] }], unit: ' ks' });
      });
      h += panel('Linka ' + line, body);
    });
    h += '</div>';
    var L1 = qcLineStats(1), L2 = qcLineStats(2);
    var vol = [{ name: 'L1', color: LINE_COL[1], values: periods.map(function (p) { return L1[p] ? L1[p].checked : null; }) }, { name: 'L2', color: LINE_COL[2], values: periods.map(function (p) { return L2[p] ? L2[p].checked : null; }) }];
    var dpu = [{ name: 'L1', color: LINE_COL[1], type: 'line', values: periods.map(function (p) { return L1[p] ? L1[p].dpu : null; }) }, { name: 'L2', color: LINE_COL[2], type: 'line', values: periods.map(function (p) { return L2[p] ? L2[p].dpu : null; }) }];
    var pos = [{ name: 'L1', color: LINE_COL[1], type: 'line', values: periods.map(function (p) { return L1[p] ? L1[p].posudPct : null; }) }, { name: 'L2', color: LINE_COL[2], type: 'line', values: periods.map(function (p) { return L2[p] ? L2[p].posudPct : null; }) }];
    h += '<div class="three">' + panel('Kontrolováno ks — L1 / L2', C.legend(vol) + defChart('pf-vol', function (w) { return C.xyChart({ width: w, height: 240, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: vol }); }))
      + panel('Vad na 100 ks — L1 / L2', C.legend(dpu) + defChart('pf-dpu', function (w) { return C.xyChart({ width: w, height: 240, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: dpu }); }))
      + panel('Na posouzení % — L1 / L2', C.legend(pos) + defChart('pf-pos', function (w) { return C.xyChart({ width: w, height: 240, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: pos, dec: 1, unit: ' %' }); })) + '</div>';
    return h;
  }

  /* ---------- 2 · Kontrola MC (CZ26027) ---------- */
  function viewMc() {
    if (!DB.mc.checked.length) return empty('Žádná data z kontrolného reportu MC (CZ26027). Nahraj ho v záložce <b>Data &amp; metodika</b>.');
    var periods = periodsOf(), lt = lastTwo(DB.mc.checked), st = mcStats(), a = st[lt.last], b = st[lt.prev], h = '';
    h += '<div class="grid4">' +
      kpiCard({ title: 'Kontrolováno', value: fmt(a ? a.checked : null), unit: 'ks', rag: ragRel(a ? a.checked : null, b ? b.checked : null, 25, 5), sub: cmpLabel(lt) }) +
      kpiCard({ title: 'Vad na 100 ks', value: fmt(a ? a.dpu : null, 0), rag: ragPP(a ? a.dpu : null, b ? b.dpu : null, 10), sub: cmpLabel(lt) }) +
      kpiCard({ title: 'Na posouzení', value: fmt(a ? a.posudPct : null, 1), unit: '%', rag: ragPP(a ? a.posudPct : null, b ? b.posudPct : null, 2), sub: cmpLabel(lt) }) +
      kpiCard({ title: 'NOK po posouzení', value: fmt(a ? a.nokPct : null, 1), unit: '%', rag: ragPP(a ? a.nokPct : null, b ? b.nokPct : null, 2), sub: cmpLabel(lt) }) + '</div>';
    var vol = [{ name: 'Kontrolováno', color: COL.s3, values: periods.map(function (p) { return st[p] ? st[p].checked : null; }) }];
    var rates = [{ name: 'Na posouzení %', color: COL.s4, type: 'line', values: periods.map(function (p) { return st[p] ? st[p].posudPct : null; }) }, { name: 'NOK %', color: COL.s8, type: 'line', values: periods.map(function (p) { return st[p] ? st[p].nokPct : null; }) }];
    h += '<div class="two">' + panel('Kontrolováno ks', defChart('mc-vol', function (w) { return C.xyChart({ width: w, height: 240, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: vol, barLabels: true }); }))
      + panel('Na posouzení % a NOK % z kontrolovaných', C.legend(rates) + defChart('mc-rates', function (w) { return C.xyChart({ width: w, height: 240, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: rates, dec: 1, unit: ' %' }); })) + '</div>';
    var dr = defectRates(DB.mc.defects, DB.mc.checked, null, lt.last), top5 = dr.items.slice(0, 5), names = top5.map(function (i) { return i.defect; });
    var ser = seriesTrend(DB.mc.defects, DB.mc.checked, null, names, periods);
    h += '<div class="two">' + panel('Top 5 vad — ' + plabelLong(lt.last) + ' <span class="muted">(% z kontrolovaných)</span>', defChart('mc-top', function (w) {
      return C.hbars({ width: w, rows: top5.map(function (it) { return { label: it.defect, values: [it.rate], notes: [fmt(it.n) + ' ks'] }; }), series: [{ name: 'MC', color: COL.s3 }], fmt: function (v) { return fmt(v, 1); }, unit: ' %' });
    })) + panel('Trend top 5 vad <span class="muted">(% z kontrolovaných)</span>', C.legend(ser) + defChart('mc-tr', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: ser, unit: ' %' }); })) + '</div>';
    // podle varianty (checked v MC reportu je per varianta)
    var rows = [], hb = [];
    P.VARIANTS.forEach(function (v) {
      var f = function (r) { return r.variant === v; }, s = mcStats(f)[lt.last]; if (!s) return;
      rows.push([esc(v), fmt(s.checked), fmt(s.defects), fmt(s.dpu, 0), fmt(s.posud), fmt(s.posudPct, 1) + ' %', fmt(s.nok), fmt(s.nokPct, 1) + ' %']);
      hb.push({ label: v, values: [s.posudPct, s.nokPct], color: VAR_COL[v] });
    });
    h += '<div class="two">' + panel('Podle varianty — ' + plabelLong(lt.last), table(['Varianta', 'Kontrolováno', 'Vad', 'Vad / 100', 'Na posouzení', 'Posouzení %', 'NOK', 'NOK %'], rows))
      + panel('Na posouzení % a NOK % podle varianty — ' + plabelLong(lt.last), C.legend([{ name: 'Na posouzení %', color: COL.s4 }, { name: 'NOK %', color: COL.s8 }]) + defChart('mc-var', function (w) {
        return C.hbars({ width: w, rows: hb, series: [{ name: 'Na posouzení %', color: COL.s4 }, { name: 'NOK %', color: COL.s8 }], fmt: function (v) { return fmt(v, 1); }, unit: ' %' });
      })) + '</div>';
    return h;
  }

  /* ---------- 3 · Posouzení (archiv) ---------- */
  function viewPos() {
    if (!DB.pos.length) return empty('Žádná data z archivu posouzení. Nahraj <b>ArchivPosouzeni_MainCarrier.xlsx</b> v záložce <b>Data &amp; metodika</b>.');
    var periods = periodsOf(), h = '', cards = '', charts = '';
    ['PREFIX', 'SKLAD'].forEach(function (src) {
      var rows = DB.pos.filter(function (r) { return r.src === src; }), lt = lastTwo(rows), byP = sumBy(rows, pk);
      cards += kpiCard({ title: 'Posouzení ' + src, value: fmt(byP[lt.last]), unit: 'ks', rag: ragRel(byP[lt.last] || 0, lt.prev ? byP[lt.prev] : null, 25, 5), sub: cmpLabel(lt) });
      var last = rows.filter(function (r) { return pk(r) === lt.last; }), byCode = sumBy(last, function (r) { return r.desc; }), total = last.length;
      var codeOf = {}; last.forEach(function (r) { codeOf[r.desc] = r.code; });
      var items = Object.keys(byCode).sort(function (a, b) { return byCode[b] - byCode[a]; }).slice(0, 8), cum = 0;
      charts += panel('Pareto kódů vad — ' + src + ' — ' + plabelLong(lt.last) + ' <span class="muted">(' + fmt(total) + ' ks)</span>', defChart('pos-par-' + src, function (w) {
        cum = 0;
        return C.hbars({ width: w, labelWidth: 230, rows: items.map(function (d) { cum += byCode[d]; return { label: codeOf[d] + ' · ' + d, values: [byCode[d]], notes: [fmt(pct(byCode[d], total), 0) + ' % · kum. ' + fmt(pct(cum, total), 0) + ' %'] }; }), series: [{ name: src, color: SRC_COL[src] }], unit: ' ks' });
      }));
    });
    h += '<div class="grid3">' + cards;
    var rw = DB.rework, ltR = lastTwo(rw), byR = sumBy(rw, pk);
    cards = kpiCard({ title: 'Sklad → rework', value: fmt(byR[ltR.last]), unit: 'ks', rag: ragRel(byR[ltR.last] || 0, ltR.prev ? byR[ltR.prev] : null, 25, 5), sub: cmpLabel(ltR) });
    h += cards + '</div>';
    var cP = sumBy(DB.pos, pk, null, function (r) { return r.src === 'PREFIX'; }), cS = sumBy(DB.pos, pk, null, function (r) { return r.src === 'SKLAD'; });
    var ps = [{ name: 'PREFIX', color: SRC_COL.PREFIX, values: periods.map(function (p) { return cP[p] || null; }) }, { name: 'SKLAD', color: SRC_COL.SKLAD, values: periods.map(function (p) { return cS[p] || null; }) }];
    var vs = P.VARIANTS.map(function (v) { var c = sumBy(DB.pos, pk, null, function (r) { return r.variant === v; }); return { name: v, color: VAR_COL[v], values: periods.map(function (p) { return c[p] || null; }) }; });
    h += '<div class="two">' + panel('Posouzení — ks za období', C.legend(ps) + defChart('pos-tr', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: ps, barLabels: true }); }))
      + panel('Posouzení podle varianty (PREFIX + SKLAD)', C.legend(vs) + defChart('pos-var', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: vs, stacked: true, barLabels: true }); })) + '</div>';
    h += '<div class="two">' + charts + '</div>';
    var ltAll = lastTwo(DB.pos), vrows = P.VARIANTS.concat(['ostatní']).map(function (v) {
      var n = function (src) { return DB.pos.filter(function (r) { return r.variant === v && r.src === src && pk(r) === ltAll.last; }).length; };
      return { label: v, values: [n('PREFIX'), n('SKLAD')] };
    }).filter(function (r) { return r.values[0] || r.values[1]; });
    var rws = P.VARIANTS.map(function (v) { var c = sumBy(rw, pk, null, function (r) { return r.variant === v; }); return { name: v, color: VAR_COL[v], values: periods.map(function (p) { return c[p] || null; }) }; });
    h += '<div class="two">' + panel('Posouzení podle varianty — ' + plabelLong(ltAll.last), C.legend([{ name: 'PREFIX', color: SRC_COL.PREFIX }, { name: 'SKLAD', color: SRC_COL.SKLAD }]) + defChart('pos-var-last', function (w) {
      return C.hbars({ width: w, rows: vrows, series: [{ name: 'PREFIX', color: SRC_COL.PREFIX }, { name: 'SKLAD', color: SRC_COL.SKLAD }], unit: ' ks' });
    })) + panel('Sklad — na rework podle varianty', C.legend(rws) + defChart('rw-var', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: rws, stacked: true, barLabels: true }); })) + '</div>';
    return h;
  }

  /* ---------- 4 · Scrap (QAD export, location PCO001) ---------- */
  function viewScrap() {
    var h = '';
    if (!DB.scrap.length) {
      return panel('Scrap PCO001 — zatím bez dat', '<p>Nahraj QAD export <b>scrap_QAD_*.xlsx</b> (list <b>Data QAD</b>) v záložce <b>Data &amp; metodika</b> nebo ho přetáhni sem.</p>' +
        '<p class="muted">Filtr: Location = ' + esc(P.SCRAP_DEFAULTS.location) + ', Transaction Type = ' + esc(P.SCRAP_DEFAULTS.txType) + ', EUR &gt; 0, deduplikace přes Transaction Number. ' +
        '<b>W/O tests</b> = Excluded? = NO a Reason ≠ 20. <b>With tests</b> = Excluded? = NO. Sloupce se hledají podle názvu hlavičky.</p>' + dropZone('scrapDrop'));
    }
    var periods = periodsOf(), lt = lastTwo(DB.scrap), inc = DB.scrap.filter(function (r) { return !r.excluded; });
    var wo = sumBy(inc, pk, function (r) { return r.eur; }, function (r) { return !r.test; }), wt = sumBy(inc, pk, function (r) { return r.eur; }), tx = sumBy(inc, pk, null, function (r) { return !r.test; });
    var tests = {}; Object.keys(wt).forEach(function (k) { tests[k] = wt[k] - (wo[k] || 0); });
    h += '<div class="grid3">' + kpiCard({ title: 'Scrap w/o tests', value: fmt(wo[lt.last] || 0), unit: 'EUR', rag: ragRel(wo[lt.last] || 0, lt.prev ? (wo[lt.prev] || 0) : null, 25, 50), sub: cmpLabel(lt) })
      + kpiCard({ title: 'Scrap with tests', value: fmt(wt[lt.last] || 0), unit: 'EUR', rag: ragRel(wt[lt.last] || 0, lt.prev ? (wt[lt.prev] || 0) : null, 25, 50), sub: cmpLabel(lt) })
      + kpiCard({ title: 'Transakce (w/o tests)', value: fmt(tx[lt.last] || 0), unit: 'ks', rag: ragRel(tx[lt.last] || 0, lt.prev ? (tx[lt.prev] || 0) : null, 25, 5), sub: cmpLabel(lt) }) + '</div>';
    var ser = [{ name: 'W/O tests', color: COL.s1, values: periods.map(function (p) { return wo[p] || null; }) }, { name: 'Testy (kód 20)', color: COL.s4, values: periods.map(function (p) { return tests[p] || null; }) }];
    var last = inc.filter(function (r) { return pk(r) === lt.last && !r.test; }), byR = sumBy(last, function (r) { return r.reason; }, function (r) { return r.eur; }), descOf = {}, cntR = sumBy(last, function (r) { return r.reason; });
    last.forEach(function (r) { descOf[r.reason] = r.desc; });
    var tot = last.reduce(function (a, r) { return a + r.eur; }, 0), reasons = Object.keys(byR).sort(function (a, b) { return byR[b] - byR[a]; }).slice(0, 8), cum = 0;
    var byI = sumBy(last, function (r) { return r.item || '(bez item)'; }, function (r) { return r.eur; }), items = Object.keys(byI).sort(function (a, b) { return byI[b] - byI[a]; }).slice(0, 8);
    h += '<div class="two">' + panel('Scrap EUR za období — w/o tests + testy', C.legend(ser) + defChart('sc-tr', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: ser, stacked: true, barLabels: true, unit: ' EUR' }); }))
      + panel('Pareto reason codes (w/o tests) — ' + plabelLong(lt.last), defChart('sc-par', function (w) {
        cum = 0;
        return C.hbars({ width: w, labelWidth: 230, rows: reasons.map(function (r) { cum += byR[r]; return { label: r + ' · ' + (descOf[r] || ''), values: [byR[r]], notes: [fmt(pct(byR[r], tot), 0) + ' % · kum. ' + fmt(pct(cum, tot), 0) + ' % · ' + fmt(cntR[r]) + ' tx'] }; }), series: [{ name: 'EUR', color: COL.s1 }], unit: ' EUR' });
      })) + '</div>';
    h += '<div class="two">' + panel('Top díly (w/o tests) — ' + plabelLong(lt.last), defChart('sc-item', function (w) {
      return C.hbars({ width: w, labelWidth: 230, rows: items.map(function (i) { return { label: i, values: [byI[i]] }; }), series: [{ name: 'EUR', color: COL.s1 }], unit: ' EUR' });
    })) + panel('Přehled období', table(['Období', 'W/O tests EUR', 'Testy EUR', 'With tests EUR', 'Transakce'], periods.slice().reverse().map(function (p) { return [esc(plabelLong(p)), fmt(wo[p] || 0), fmt(tests[p] || 0), fmt(wt[p] || 0), fmt(tx[p] || 0)]; }))) + '</div>';
    return h;
  }

  /* ---------- 5 · Data & metodika ---------- */
  function dropZone(id) {
    return '<div class="drop" data-drop="' + id + '"><div class="ic">📥</div><div class="t">Přetáhni sem soubor(y) nebo klikni</div>' +
      '<div class="s">Kontrolný report Prefix / MC (.xlsm), ArchivPosouzeni (.xlsx), QAD scrap export (.xlsx) — typ se pozná automaticky</div>' +
      '<input type="file" accept=".xlsx,.xlsm,.xls" multiple style="display:none"></div>';
  }
  function viewData() {
    var h = '';
    h += panel('Import', dropZone('mainDrop') + '<div class="btns"><button class="btn" data-act="backup">💾 Záloha (JSON)</button><label class="btn">📂 Obnovit ze zálohy<input type="file" accept=".json" data-act="restore" style="display:none"></label>' +
      '<button class="btn" data-act="reset">↺ Zpět na data ze sestavení</button><button class="btn danger" data-act="wipe">🗑 Vymazat vše</button></div>' +
      '<p class="muted">Data z importu se ukládají do paměti tohoto prohlížeče (localStorage). Každý PC / prohlížeč má vlastní kopii. Sestavení souboru: ' + esc(DB.meta.builtAt || '–') + (DB.meta.savedAt ? ' · lokální data uložena: ' + esc(DB.meta.savedAt) : '') + '</p>');
    var srcRows = DB.sources.map(function (s) { return [esc(s.file) + '<br><span class="muted">' + esc(s.sheet || '') + '</span>', s.type + (s.src ? ' ' + s.src : ''), fmt(s.records), (s.from || '–') + ' → ' + (s.to || '–'), s.importedAt || '–']; });
    h += panel('Načtené zdroje', srcRows.length ? table(['Soubor', 'Typ', 'Záznamů', 'Rozsah dat', 'Importováno'], srcRows) : empty('Nic nenačteno.'));
    var w = DB.warnings.map(function (x) { return [esc(x.msg), fmt(x.count), esc((x.samples || []).join(', '))]; });
    h += panel('Kontrola kvality dat', w.length ? table(['Zjištění', 'Počet', 'Příklady'], w) : '<p class="ok">✔ Bez nálezů.</p>');
    h += panel('Podezřelé hodnoty <span class="muted">(vad na 100 ks za den > 2,5× medián zdroje — typicky chybně zadané kontrolované ks)</span>', anomalyTable());
    h += panel('Metodika', '<div class="doc">' +
      '<p><b>Období</b>: ISO týden (Po–Ne) nebo kalendářní měsíc. „Poslední období“ = poslední období, ve kterém má daný zdroj data; rozdělaný týden je tedy částečný — u počtů ks to zohledni, poměrové ukazatele (%, vad/100 ks) srovnatelné jsou.</p>' +
      '<p><b>L1 a L2 vždy odděleně.</b> Combined slouží jen jako celkový přehled; procesní analýza je per linka.</p>' +
      '<p><b>Vad na 100 ks</b> = součet detekovaných vad ÷ kontrolované ks × 100 (jeden díl může mít víc vad, proto hodnoty přes 100). <b>Sazba vady</b> = počet dané vady ÷ kontrolované ks × 100. V reportu Prefix je počet kontrolovaných uveden jen per den a linku (ne per variantu), proto LH/RH zobrazujeme v ks.</p>' +
      '<p><b>Na posouzení %</b> = vyřazené MC na posouzení ÷ kontrolované. <b>NOK %</b> (jen MC report) = NOK po posouzení ÷ kontrolované.</p>' +
      '<p><b>Top 5 / Pareto</b> = vždy dle posledního období sestupně, ne dle celkového součtu. Barva vady je pevná (dle celkového pořadí), nemění se s filtrem.</p>' +
      '<p><b>RAG</b>: barva i číslo ze stejného výpočtu — prosté srovnání posledního období s předchozím (nikdy průměr 2 týdnů). Poměrové ukazatele: rozdíl v procentních bodech, práh ±2 pp (vad/100 ks: ±10 bodů). Počty ks a EUR: relativní změna, práh ±25 %; nulová základna zvlášť (0 → &gt;50 EUR / &gt;5 ks = červená, opačně zelená). Nižší = lepší u všech ukazatelů.</p>' +
      '<p><b>Scrap</b>: QAD export, list Data QAD, sloupce dle hlavičky. Location = PCO001, Transaction Type = ISS-SCRP, EUR &gt; 0, dedup přes Transaction Number (exporty jsou kumulativní YTD). W/O tests = Excluded? = NO a Reason ≠ 20; With tests = Excluded? = NO.</p>' +
      '<p><b>Posouzení</b>: každý vyplněný part number v archivu = 1 MC. Varianta se odvozuje z rodiny part numberu (MY0547099 = HEAT. FRT RH, MY0547078 = HEAT. FRT LH, 3448362 = FRT RH, 3448356 = FRT LH, 3449523 = RR RH, 3449518 = RR LH).</p>' +
      '<p><b>Kontrola dat</b>: text ve sloupci Linka se přeskočí (ponechá se předchozí linka), rok v budoucnosti (např. 2028) se opraví na aktuální rok, obojí se hlásí výše.</p></div>');
    return h;
  }

  function anomalyTable() {
    var out = [];
    var check = function (name, checked, defects, keyFn) {
      var chk = sumBy(checked, keyFn, function (r) { return r.checked; }), def = sumBy(defects, keyFn, function (r) { return r.n; }), keys = Object.keys(chk), vals = [];
      keys.forEach(function (k) { if (chk[k] > 0) vals.push(pct(def[k] || 0, chk[k])); });
      if (vals.length < 5) return;
      vals.sort(function (a, b) { return a - b; });
      var med = vals[Math.floor(vals.length / 2)];
      keys.forEach(function (k) {
        var v = chk[k] > 0 ? pct(def[k] || 0, chk[k]) : null;
        if (v != null && v > 2.5 * med) out.push([esc(name), esc(k), fmt(chk[k]), fmt(def[k] || 0), fmt(v, 0), fmt(med, 0)]);
      });
    };
    check('Prefix L1', DB.qc.checked.filter(function (r) { return r.line === 1; }), DB.qc.defects.filter(function (r) { return r.line === 1; }), function (r) { return r.d; });
    check('Prefix L2', DB.qc.checked.filter(function (r) { return r.line === 2; }), DB.qc.defects.filter(function (r) { return r.line === 2; }), function (r) { return r.d; });
    check('MC', DB.mc.checked, DB.mc.defects, function (r) { return r.d + ' ' + r.variant; });
    out.sort(function (a, b) { return a[1] < b[1] ? 1 : -1; });
    return out.length ? table(['Zdroj', 'Den / varianta', 'Kontrolováno', 'Vad', 'Vad / 100 ks', 'Medián zdroje'], out.slice(0, 40)) : '<p class="ok">✔ Bez nálezů.</p>';
  }

  /* ---------- render ---------- */
  var VIEWS = [viewOverview, viewPrefix, viewMc, viewPos, viewScrap, viewData];
  function render() {
    defectColors();
    CHARTS = {};
    var main = document.getElementById('main');
    try { main.innerHTML = VIEWS[S.tab](); } catch (e) { main.innerHTML = empty('Chyba při vykreslení: ' + esc(e.message)); if (window.console) console.error(e); }
    drawCharts();
    var tabs = document.querySelectorAll('.tab'), i;
    for (i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', i === S.tab);
    document.querySelectorAll('[data-period]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-period') === S.period); });
    document.querySelectorAll('[data-span]').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-span') === S.span); });
    renderHeader();
    bindDrops();
  }
  function renderHeader() {
    var b = [], f = function (rows, name) { if (!rows.length) return; var d = rows.map(function (r) { return r.d; }).sort(); b.push('<span class="hbadge">' + name + ' do ' + esc(d[d.length - 1]) + '</span>'); };
    f(DB.qc.checked, 'Prefix'); f(DB.mc.checked, 'MC'); f(DB.pos, 'Posouzení'); f(DB.scrap, 'Scrap');
    document.getElementById('hb').innerHTML = b.join('') || '<span class="hbadge">bez dat</span>';
  }

  /* ---------- import ---------- */
  function bindDrops() {
    document.querySelectorAll('[data-drop]').forEach(function (z) {
      var inp = z.querySelector('input[type=file]');
      z.onclick = function (e) { if (e.target !== inp) inp.click(); };
      inp.onchange = function () { importFiles(inp.files); inp.value = ''; };
      z.ondragover = function (e) { e.preventDefault(); z.classList.add('over'); };
      z.ondragleave = function () { z.classList.remove('over'); };
      z.ondrop = function (e) { e.preventDefault(); z.classList.remove('over'); importFiles(e.dataTransfer.files); };
    });
    document.querySelectorAll('[data-act]').forEach(function (b) {
      var act = b.getAttribute('data-act');
      if (act === 'restore') { b.onchange = function () { restore(b.files[0]); b.value = ''; }; return; }
      b.onclick = function () {
        if (act === 'backup') backup();
        else if (act === 'reset') { if (confirm('Zahodit lokálně importovaná data a vrátit se k datům ze sestavení?')) { try { localStorage.removeItem(LS_KEY); } catch (e) { } loadEmbedded(); render(); toast('Obnoveno ze sestavení'); } }
        else if (act === 'wipe') { if (confirm('Opravdu vymazat všechna data v tomto prohlížeči?')) { try { localStorage.removeItem(LS_KEY); } catch (e) { } DB = emptyDb(); render(); toast('Vymazáno'); } }
      };
    });
  }
  function importFiles(files) {
    if (!files || !files.length) return;
    if (typeof XLSX === 'undefined') { toast('Chybí knihovna XLSX (soubor není sestavený buildem)'); return; }
    var pending = files.length, ok = 0;
    Array.prototype.forEach.call(files, function (file) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: true });
          var ds = P.parseWorkbook(XLSX, wb, file.name, { today: new Date() });
          ds.forEach(function (d) { mergeDataset(d, new Date().toISOString().slice(0, 16).replace('T', ' ')); });
          ok++;
        } catch (e) { toast('❌ ' + file.name + ': ' + e.message, 8000); if (window.console) console.error(e); }
        if (--pending === 0) { save(); render(); if (ok) toast('✔ Načteno souborů: ' + ok); }
      };
      rd.readAsArrayBuffer(file);
    });
  }
  function rangeOf(rows) { var d = rows.map(function (r) { return r.d; }).sort(); return { from: d[0] || null, to: d[d.length - 1] || null }; }
  function mergeDataset(d, stamp) {
    var recs = d.records || d.defects, rg = rangeOf(recs);
    var srcKey = d.type + (d.src ? ':' + d.src : '');
    DB.sources = DB.sources.filter(function (s) { return s.key !== srcKey; });
    DB.warnings = DB.warnings.filter(function (w) { return w.srcKey !== srcKey; });
    if (d.type === 'qc' || d.type === 'mc') DB[d.type] = { checked: d.checked, defects: d.defects };           // report je kumulativní -> nahradit
    else if (d.type === 'pos') DB.pos = DB.pos.filter(function (r) { return r.src !== d.src; }).concat(d.records); // per list
    else if (d.type === 'rework') DB.rework = d.records;
    else if (d.type === 'scrap') {                                                                                 // kumulativní YTD exporty se překrývají -> dedup přes tx
      var seen = {}; DB.scrap.forEach(function (r) { seen[r.tx] = 1; });
      DB.scrap = DB.scrap.concat(d.records.filter(function (r) { return !seen[r.tx]; }));
      recs = DB.scrap; rg = rangeOf(recs);
    }
    DB.sources.push({ key: srcKey, file: d.file, sheet: d.sheet, type: d.type, src: d.src, records: recs.length, from: rg.from, to: rg.to, importedAt: stamp, stats: d.stats || null });
    (d.warnings || []).forEach(function (w) { w.srcKey = srcKey; DB.warnings.push(w); });
  }
  function save() {
    DB.meta.savedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
    try { localStorage.setItem(LS_KEY, JSON.stringify(P.pack(DB))); } catch (e) { toast('⚠ Nepodařilo se uložit do localStorage: ' + e.message, 6000); }
  }
  function backup() {
    var blob = new Blob([JSON.stringify(P.pack(DB))], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'g463_zaloha_' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
  }
  function restore(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () { try { var j = JSON.parse(rd.result); if (!j.t && !(j.qc && j.mc)) throw new Error('neplatný formát'); DB = j.t ? P.unpack(j) : j; save(); render(); toast('✔ Obnoveno ze zálohy'); } catch (e) { toast('❌ Záloha: ' + e.message, 6000); } };
    rd.readAsText(file);
  }
  function loadEmbedded() {
    DB = emptyDb();
    var E = window.G463_DATA;
    if (E) DB = E.t ? P.unpack(E) : JSON.parse(JSON.stringify(E));
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY); if (!raw) return false;
      var j = JSON.parse(raw);
      var emb = window.G463_DATA && window.G463_DATA.meta && window.G463_DATA.meta.builtAt;
      if (emb && j.meta && j.meta.savedAt && j.meta.savedAt < emb) return false; // nové sestavení je novější než lokální import
      DB = j.t ? P.unpack(j) : j; return true;
    } catch (e) { return false; }
  }
  var toastT;
  function toast(msg, ms) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, ms || 3000); }

  /* ---------- tooltip ---------- */
  function initTooltip() {
    var tt = document.getElementById('tip');
    document.addEventListener('mousemove', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!el) { tt.classList.remove('on'); return; }
      tt.textContent = el.getAttribute('data-tip'); tt.classList.add('on');
      var x = e.clientX + 14, y = e.clientY + 14;
      if (x + tt.offsetWidth > window.innerWidth - 8) x = e.clientX - tt.offsetWidth - 10;
      if (y + tt.offsetHeight > window.innerHeight - 8) y = e.clientY - tt.offsetHeight - 10;
      tt.style.left = x + 'px'; tt.style.top = y + 'px';
    });
  }

  /* ---------- start ---------- */
  function init() {
    loadEmbedded(); loadLocal();
    try { var st = JSON.parse(localStorage.getItem(LS_SET) || '{}'); if (st.period) S.period = st.period; if (st.span != null) S.span = st.span; } catch (e) { }
    var m = location.hash.match(/tab=(\d)/); if (m) S.tab = Math.min(TABS.length - 1, +m[1]);
    var tabs = document.getElementById('tabs');
    tabs.innerHTML = TABS.map(function (t, i) { return '<button class="tab" data-tab="' + i + '">' + t + '</button>'; }).join('');
    tabs.onclick = function (e) { var b = e.target.closest('[data-tab]'); if (!b) return; S.tab = +b.getAttribute('data-tab'); location.hash = 'tab=' + S.tab; render(); window.scrollTo(0, 0); };
    document.getElementById('sbar').onclick = function (e) {
      var b = e.target.closest('[data-period],[data-span]'); if (!b) return;
      if (b.hasAttribute('data-period')) S.period = b.getAttribute('data-period'); else S.span = +b.getAttribute('data-span');
      try { localStorage.setItem(LS_SET, JSON.stringify({ period: S.period, span: S.span })); } catch (e2) { }
      render();
    };
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(drawCharts, 150); });
    initTooltip();
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
