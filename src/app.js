/* G463 Prefix — aplikace: stav, agregace, RAG, záložky, import, localStorage. */
(function () {
  'use strict';
  var P = G463Parser, C = G463Charts, esc = C.esc, fmt = C.fmtNum;
  var LS_KEY = 'g463.db.v1', LS_SET = 'g463.settings.v1';
  var COL = { s1: '#2E6DA4', s2: '#E8A020', s3: '#27AE60', s4: '#8E44AD', s5: '#16A085', s6: '#E67E22', s7: '#7F8C8D', s8: '#C2185B', gray: '#95A5A6', red: '#C0392B' }; // červená jen pro stav a scrap
  var SLOTS = [COL.s1, COL.s2, COL.s3, COL.s4, COL.s5, COL.s6, COL.s7, COL.s8];
  var LINE_COL = { 1: COL.s1, 2: COL.s2, all: COL.gray }, SIDE_COL = { LH: COL.s1, RH: COL.s2 }, SRC_COL = { PREFIX: COL.s1, SKLAD: COL.s2 }, RAGC = { red: 'r', green: 'g', amber: 'a', na: 'n' };
  var VAR_COL = {}; P.VARIANTS.forEach(function (v, i) { VAR_COL[v] = SLOTS[i]; }); VAR_COL['ostatní'] = COL.gray;
  var RAG = {
    red: { cls: 'rag-red', icon: '▲', label: 'zhoršení' }, green: { cls: 'rag-green', icon: '▼', label: 'zlepšení' },
    amber: { cls: 'rag-amber', icon: '●', label: 'beze změny' }, na: { cls: 'rag-na', icon: '–', label: 'bez srovnání' }
  };
  var TABS = ['🏠 Domů', '📥 Data & metodika'];
  var DETAILS = { prefix: '🔍 Finální kontrola Prefix', mc: '📦 200% kontrola sklad', pos: '🧪 Quality posouzení', scrap: '💸 Scrap PCO001' };

  var DB = emptyDb(), S = { tab: 0, period: 'week', span: 13, top: 'wo', day: null, tv: false, posScope: 'last', detail: null };
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
    var kc = { red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)', na: 'var(--mid)' }[r.status];
    return '<div class="kpi" style="--kc:' + kc + '"><div class="kt">' + esc(o.title) + '</div><div class="kv ' + RAGC[r.status] + '">' + esc(o.value) + '<span class="ku">' + esc(o.unit || '') + '</span></div>' +
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


  /* ---------- 0 · Domů: rozcestník z dlaždic — jedno číslo, semafor, kontext, mini trend; klik = detail ---------- */
  function daysOf(rows) { var set = {}, i; for (i = 0; i < rows.length; i++) set[rows[i].d] = 1; return Object.keys(set).sort(); }
  function pickDay(days) { // S.day = konkrétní den, jinak poslední den s daty daného zdroje
    if (!days.length) return { day: null, prev: null };
    var day = S.day ? (days.indexOf(S.day) >= 0 ? S.day : null) : days[days.length - 1];
    var i = day ? days.indexOf(day) : -1;
    return { day: day, prev: i > 0 ? days[i - 1] : null };
  }
  function dlabel(d) { return d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' : '–'; }
  function dowLabel(d) { var t = P.toDate(d); return t ? ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'][t.getDay()] + ' ' + dlabel(d) : '–'; }
  function last10(days, day) { var i = days.indexOf(day); return i < 0 ? [] : days.slice(Math.max(0, i - 9), i + 1); }
  function ctrlStats(checkedRows, defectRows, filter, d) {
    var f = function (r) { return r.d === d && (!filter || filter(r)); }, c = 0, pos = 0, nok = 0, def = 0, cnt = {}, i, r, hasNok = false;
    for (i = 0; i < checkedRows.length; i++) { r = checkedRows[i]; if (!f(r)) continue; c += r.checked; pos += r.posud || 0; if (r.nok != null) { hasNok = true; nok += r.nok; } }
    for (i = 0; i < defectRows.length; i++) { r = defectRows[i]; if (!f(r)) continue; def += r.n; cnt[r.defect] = (cnt[r.defect] || 0) + r.n; }
    if (!c && !def) return null;
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 3).map(function (k) { return { defect: k, n: cnt[k], rate: pct(cnt[k], c) }; });
    return { checked: c, defects: def, dpu: pct(def, c), posud: pos, posudPct: pct(pos, c), nok: hasNok ? nok : null, nokPct: hasNok ? pct(nok, c) : null, top: top };
  }
  var isSupplier = function (code) { return /^KR/.test(code || ''); }; // Kragujevac = dodavatel kůže (KRSK, KRSS, KRSW)
  // Dlaždice: {id, title, color, detail, day, empty, label, value, unit, rag, prev | pair:[{label,value,unit,rag,prev,color}], note, spark:{labels, series:[{name,color,type,values}], stacked, dec, unit}}
  function tile(o) {
    var h = '<a class="tile' + (S.detail === o.detail ? ' on' : '') + '" href="#tab=0&d=' + o.detail + '" data-detail="' + o.detail + '" style="--tc:' + (o.color || COL.gray) + '">';
    h += '<div class="tile-h"><span>' + esc(o.title) + '</span><span class="tile-d">' + (o.day ? dowLabel(o.day) : '') + '</span></div>';
    if (o.empty) return h + '<div class="tile-empty">' + o.empty + '</div><div class="tile-go">Detail ›</div></a>';
    var one = function (m, small) {
      var R = m.rag ? RAG[m.rag.status] : null;
      return '<div class="tile-l">' + esc(m.label) + '</div><div class="tile-main"><div class="tile-v' + (small ? ' sm' : '') + ' ' + RAGC[m.rag ? m.rag.status : 'na'] + '">' + esc(m.value) + '<span class="ku">' + esc(m.unit || '') + '</span></div>' +
        (R ? '<span class="rag ' + R.cls + '">' + R.icon + ' ' + esc(m.rag.text) + '</span>' + (m.prev ? '<span class="ks">vs ' + dlabel(m.prev) + '</span>' : '') : '') + '</div>';
    };
    if (o.pair) h += '<div class="tpair">' + o.pair.map(function (m) { return '<div class="tpair-c" style="border-left-color:' + (m.color || o.color) + '">' + one(m, true) + '</div>'; }).join('') + '</div>';
    else h += one(o);
    if (o.note) h += '<div class="tile-note">' + o.note + '</div>';
    if (o.spark && o.spark.labels.length > 1) h += defChart(o.id + '-sp', function (w) {
      return C.xyChart({ width: w, height: S.tv ? 150 : 72, mini: true, labels: o.spark.labels.map(dlabel), series: o.spark.series, stacked: !!o.spark.stacked, dec: o.spark.dec || 0, unit: o.spark.unit || '' });
    }, S.tv ? 150 : 72);
    return h + '<div class="tile-go">' + (S.detail === o.detail ? 'Detail níže ▾' : 'Detail ›') + '</div></a>';
  }
  function viewHome() {
    var tiles = [], allDays = daysOf([].concat(DB.qc.checked, DB.mc.checked, DB.pos, DB.rework, DB.scrap));
    if (!allDays.length) return empty('Žádná data. Nahraj soubory v záložce <b>Data &amp; metodika</b>.');
    var cur = S.day || allDays[allDays.length - 1];
    var noData = function (rows, what) { return rows.length ? 'bez dat k ' + dlabel(cur) : 'bez dat · ' + what; };
    // 1 · Finální kontrola Prefix (CZ25170): L1 a L2 vedle sebe, vždy odděleně
    (function () {
      var st = {}, days = daysOf(DB.qc.checked), pd = pickDay(days), sp = last10(days, pd.day);
      [1, 2].forEach(function (line) {
        var f = function (r) { return r.line === line; }, d = daysOf(DB.qc.checked.filter(f)), p = pickDay(d);
        st[line] = { pd: p, a: p.day ? ctrlStats(DB.qc.checked, DB.qc.defects, f, p.day) : null, b: p.prev ? ctrlStats(DB.qc.checked, DB.qc.defects, f, p.prev) : null, f: f };
      });
      var any = st[1].a || st[2].a;
      tiles.push(tile({ id: 'h-prefix', detail: 'prefix', title: 'Finální kontrola Prefix', color: COL.s1, day: pd.day, empty: any ? null : noData(DB.qc.checked, 'report CZ25170'),
        pair: [1, 2].map(function (line) { var x = st[line]; return { label: 'L' + line + ' · vad na 100 ks', value: x.a ? fmt(x.a.dpu, 0) : '–', rag: x.a ? ragPP(x.a.dpu, x.b ? x.b.dpu : null, 10) : null, prev: x.pd.prev, color: LINE_COL[line] }; }),
        note: [1, 2].map(function (line) { var x = st[line]; return x.a ? 'L' + line + ': <b class="num">' + fmt(x.a.checked) + ' ks</b>, posouzení <b class="num">' + fmt(x.a.posudPct, 1) + ' %</b>, nejčastěji ' + esc(x.a.top[0] ? x.a.top[0].defect : '–') : 'L' + line + ': bez dat'; }).join('<br>'),
        spark: { labels: sp, series: [1, 2].map(function (line) { return { name: 'L' + line, color: LINE_COL[line], type: 'line', values: sp.map(function (d) { var x = ctrlStats(DB.qc.checked, DB.qc.defects, st[line].f, d); return x ? x.dpu : null; }) }; }) } }));
    })();
    // 2 · 200% kontrola sklad (CZ26027)
    (function () {
      var days = daysOf(DB.mc.checked), pd = pickDay(days), a = pd.day ? ctrlStats(DB.mc.checked, DB.mc.defects, null, pd.day) : null, b = pd.prev ? ctrlStats(DB.mc.checked, DB.mc.defects, null, pd.prev) : null, sp = last10(days, pd.day);
      tiles.push(tile({ id: 'h-mc', detail: 'mc', title: '200% kontrola sklad', color: COL.s3, day: pd.day, prev: pd.prev, empty: a ? null : noData(DB.mc.checked, 'report CZ26027'),
        label: 'NOK po posouzení', value: a ? fmt(a.nokPct, 1) : '', unit: '%', rag: a ? ragPP(a.nokPct, b ? b.nokPct : null, 2) : null,
        note: a ? 'kontrolováno <b class="num">' + fmt(a.checked) + ' ks</b> · na posouzení <b class="num">' + fmt(a.posudPct, 1) + ' %</b> · NOK <b class="num">' + fmt(a.nok) + ' ks</b> · nejčastěji ' + esc(a.top[0] ? a.top[0].defect : '–') : '',
        spark: { labels: sp, series: [{ name: 'NOK %', color: COL.s3, type: 'line', values: sp.map(function (d) { var x = ctrlStats(DB.mc.checked, DB.mc.defects, null, d); return x ? x.nokPct : null; }) }], dec: 1, unit: ' %' } }));
    })();
    // 3 · Quality posouzení (archiv): PREFIX a SKLAD vedle sebe
    (function () {
      var X = {}, days = daysOf(DB.pos), pd = pickDay(days), sp = last10(days, pd.day), cntAll = {};
      ['PREFIX', 'SKLAD'].forEach(function (src) {
        var rows = DB.pos.filter(function (r) { return r.src === src; }), d = daysOf(rows), p = pickDay(d), cnt = sumBy(rows, function (r) { return r.d; });
        var today = p.day ? rows.filter(function (r) { return r.d === p.day; }) : [], s10 = last10(d, p.day), pa = paretoOf(today), sup = today.filter(function (r) { return isSupplier(r.code); }).length;
        X[src] = { pd: p, cnt: cnt, n: today.length, avg: s10.length ? s10.reduce(function (a, dd) { return a + cnt[dd]; }, 0) / s10.length : null, top: pa.items[0], supPct: pct(sup, today.length), rows: rows };
        cntAll[src] = cnt;
      });
      var any = X.PREFIX.pd.day || X.SKLAD.pd.day;
      tiles.push(tile({ id: 'h-pos', detail: 'pos', title: 'Quality posouzení', color: COL.s7, day: pd.day, empty: any ? null : noData(DB.pos, 'ArchivPosouzeni'),
        pair: ['PREFIX', 'SKLAD'].map(function (src) { var x = X[src]; return { label: src + ' · MC na posouzení', value: x.pd.day ? fmt(x.n) : '–', unit: 'ks', rag: x.pd.day ? ragRel(x.n, x.pd.prev ? x.cnt[x.pd.prev] : null, 25, 5) : null, prev: x.pd.prev, color: SRC_COL[src] }; }),
        note: ['PREFIX', 'SKLAD'].map(function (src) { var x = X[src]; return x.pd.day ? src + ': Ø 10 dnů <b class="num">' + fmt(x.avg, 0) + '</b>, dodavatel <b class="num">' + fmt(x.supPct, 0) + ' %</b>, nejčastěji ' + esc(x.top ? x.top.code + ' ' + x.top.desc : '–') : src + ': bez dat'; }).join('<br>'),
        spark: { labels: sp, stacked: true, series: ['PREFIX', 'SKLAD'].map(function (src) { return { name: src, color: SRC_COL[src], type: 'bar', values: sp.map(function (d) { return cntAll[src][d] || 0; }) }; }) } }));
    })();
    // 4 · Scrap PCO001 (QAD)
    (function () {
      var inc = DB.scrap.filter(function (r) { return !r.excluded; }), days = daysOf(inc), pd = pickDay(days), sp = last10(days, pd.day);
      var eurD = function (d) { return inc.filter(function (r) { return r.d === d && !r.test; }).reduce(function (a, r) { return a + r.eur; }, 0); };
      var today = pd.day ? inc.filter(function (r) { return r.d === pd.day && !r.test; }) : [], byR = sumBy(today, function (r) { return r.reason; }, function (r) { return r.eur; }), topR = Object.keys(byR).sort(function (a, b) { return byR[b] - byR[a]; })[0], descOf = {}; today.forEach(function (r) { descOf[r.reason] = r.desc; });
      tiles.push(tile({ id: 'h-sc', detail: 'scrap', title: 'Scrap PCO001', color: COL.red, day: pd.day, prev: pd.prev, empty: pd.day ? null : (inc.length ? 'bez dat k ' + dlabel(cur) : 'bez dat · QAD export'),
        label: 'Scrap w/o tests', value: fmt(eurD(pd.day)), unit: 'EUR', rag: pd.day ? ragRel(eurD(pd.day), pd.prev ? eurD(pd.prev) : null, 25, 50) : null,
        note: pd.day ? '<b class="num">' + fmt(today.length) + '</b> transakcí · nejvíc ' + esc(topR ? topR + ' ' + (descOf[topR] || '') : '–') + ' <b class="num">' + fmt(byR[topR] || 0) + ' EUR</b>' : '',
        spark: { labels: sp, series: [{ name: 'EUR w/o tests', color: COL.red, type: 'bar', values: sp.map(eurD) }] } }));
    })();
    var h = banner(tiles) + '<div class="tiles">' + tiles.join('') + '</div>';
    if (S.detail && DETAIL_VIEWS[S.detail]) {
      h += '<div class="detail" id="detail"><div class="detail-h"><span>Detail · ' + esc(DETAILS[S.detail]) + '</span><span class="muted">období: ' + (S.period === 'week' ? 'týden' : 'měsíc') + ' · přepínač nahoře</span><button class="btn" data-detail-close="1">✕ zavřít</button></div>' + DETAIL_VIEWS[S.detail]() + '</div>';
    }
    return h;
  }
  function banner(tiles) { // stav dne ze semaforů dlaždic (jen ukazatele se srovnáním)
    var html = tiles.join(''), red = (html.match(/rag-red/g) || []).length, green = (html.match(/rag-green/g) || []).length, amber = (html.match(/rag-amber/g) || []).length, tot = red + green + amber;
    if (!tot) return '';
    var cls = red ? 'bad' : amber && !green ? 'warn' : 'ok', ic = red ? '⛔' : cls === 'warn' ? '⚠️' : '✅';
    var hd = red ? 'Zhoršení u ' + red + ' z ' + tot + ' ukazatelů' : cls === 'warn' ? 'Beze změny' : 'Zlepšení nebo beze změny';
    var tx = 'Srovnání posledního dne s daty proti předchozímu dni pro každý zdroj zvlášť. ' + (red ? 'Červené hodnoty v dlaždicích jsou zhoršení, klik na dlaždici otevře detail.' : 'Nic se nezhoršilo, detaily jsou pod dlaždicemi.');
    return '<div class="banner ' + cls + '"><div class="st-i">' + ic + '</div><div class="st-t"><h2>' + hd + '</h2><p>' + tx + '</p></div><div class="st-n"><div class="big">' + fmt(green) + ' / ' + fmt(amber) + ' / ' + fmt(red) + '</div><div class="l">zlepšení / beze změny / zhoršení</div></div></div>';
  }
  function homeBar() { // ovládání dne pro Domů (nahrazuje filtr období v horní liště)
    var allDays = daysOf([].concat(DB.qc.checked, DB.mc.checked, DB.pos, DB.rework, DB.scrap)); if (!allDays.length) return '';
    var cur = S.day || allDays[allDays.length - 1], ci = allDays.indexOf(cur);
    return '<span>Den:</span><span class="seg"><button data-day="' + esc(ci > 0 ? allDays[ci - 1] : '') + '"' + (ci > 0 ? '' : ' disabled') + '>◀</button><button data-day="' + esc(ci < allDays.length - 1 ? allDays[ci + 1] : '') + '"' + (ci < allDays.length - 1 ? '' : ' disabled') + '>▶</button></span>' +
      '<input type="date" class="inp" id="dayPick" value="' + esc(cur) + '" min="' + allDays[0] + '" max="' + allDays[allDays.length - 1] + '">' +
      '<button class="btn' + (S.day ? '' : ' on') + '" data-day="latest">poslední den s daty</button>' +
      '<span class="muted">' + (S.day ? 'zdroj bez dat k tomuto dni ukáže „bez dat“' : 'každá dlaždice ukazuje poslední den, ke kterému má daný zdroj data · klik na dlaždici otevře detail pod ní') + '</span>' +
      '<a class="btn tvlink" href="#tab=0&tv" title="Bez lišt, hodiny, obnovení každých 15 min">📺 TV režim</a>';
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
    if (!DB.mc.checked.length) return empty('Žádná data z reportu 200% kontroly skladu (CZ26027). Nahraj ho v záložce <b>Data &amp; metodika</b>.');
    var periods = periodsOf(), lt = lastTwo(DB.mc.checked), st = mcStats(), a = st[lt.last], b = st[lt.prev], h = '';
    h += '<div class="grid4">' +
      kpiCard({ title: 'Kontrolováno', value: fmt(a ? a.checked : null), unit: 'ks', rag: ragRel(a ? a.checked : null, b ? b.checked : null, 25, 5), sub: cmpLabel(lt) }) +
      kpiCard({ title: 'Vad na 100 ks', value: fmt(a ? a.dpu : null, 0), rag: ragPP(a ? a.dpu : null, b ? b.dpu : null, 10), sub: cmpLabel(lt) }) +
      kpiCard({ title: 'Na posouzení', value: fmt(a ? a.posudPct : null, 1), unit: '%', rag: ragPP(a ? a.posudPct : null, b ? b.posudPct : null, 2), sub: cmpLabel(lt) }) +
      kpiCard({ title: 'NOK po posouzení', value: fmt(a ? a.nokPct : null, 1), unit: '%', rag: ragPP(a ? a.nokPct : null, b ? b.nokPct : null, 2), sub: cmpLabel(lt) }) + '</div>';
    var vol = [{ name: 'Kontrolováno', color: COL.s3, values: periods.map(function (p) { return st[p] ? st[p].checked : null; }) }];
    var rates = [{ name: 'Na posouzení %', color: COL.s2, type: 'line', values: periods.map(function (p) { return st[p] ? st[p].posudPct : null; }) }, { name: 'NOK %', color: COL.red, type: 'line', values: periods.map(function (p) { return st[p] ? st[p].nokPct : null; }) }];
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
      + panel('Na posouzení % a NOK % podle varianty — ' + plabelLong(lt.last), C.legend([{ name: 'Na posouzení %', color: COL.s2 }, { name: 'NOK %', color: COL.red }]) + defChart('mc-var', function (w) {
        return C.hbars({ width: w, rows: hb, series: [{ name: 'Na posouzení %', color: COL.s2 }, { name: 'NOK %', color: COL.red }], fmt: function (v) { return fmt(v, 1); }, unit: ' %' });
      })) + '</div>';
    return h;
  }

  /* ---------- 3 · Posouzení (archiv) — vzor: listy "Pareto PREFIX" / "Pareto SKLAD" ---------- */
  function posScopeRows(rows) { // S.posScope: 'last' = poslední období zdroje, 'all' = vše, jinak klíč období
    if (S.posScope === 'all') return { rows: rows, label: 'vše (' + (rows.length ? rows.map(function (r) { return r.d; }).sort()[0] + ' → ' + rows.map(function (r) { return r.d; }).sort().pop() : '–') + ')', key: null, prevKey: null };
    var lt = lastTwo(rows), key = S.posScope === 'last' ? lt.last : S.posScope;
    var keys = Object.keys(sumBy(rows, pk)).sort(), i = keys.indexOf(key), prevKey = i > 0 ? keys[i - 1] : null;
    return { rows: rows.filter(function (r) { return pk(r) === key; }), label: key ? plabelLong(key) + (key === nowKey() ? ' (rozdělané)' : '') : '–', key: key, prevKey: prevKey, prevRows: prevKey ? rows.filter(function (r) { return pk(r) === prevKey; }) : [] };
  }
  function paretoOf(rows) { // {items:[{code,desc,n,share,cum}], total}
    var byC = sumBy(rows, function (r) { return r.desc; }), codeOf = {}; rows.forEach(function (r) { codeOf[r.desc] = r.code; });
    var total = rows.length, cum = 0;
    var items = Object.keys(byC).sort(function (a, b) { return byC[b] - byC[a] || a.localeCompare(b); }).map(function (d) { cum += byC[d]; return { code: codeOf[d], desc: d, n: byC[d], share: pct(byC[d], total), cum: pct(cum, total) }; });
    return { items: items, total: total };
  }
  function paretoPanel(src) {
    var rows = DB.pos.filter(function (r) { return r.src === src; }), sc = posScopeRows(rows), pa = paretoOf(sc.rows);
    var prev = sc.prevRows ? sumBy(sc.prevRows, function (r) { return r.desc; }) : null;
    var chartH = 300, top = pa.items.slice(0, 20), rest = pa.items.slice(20), restN = rest.reduce(function (a, x) { return a + x.n; }, 0);
    var labels = top.map(function (x) { return x.code; }).concat(restN ? ['ost.'] : []);
    var shares = top.map(function (x) { return x.share; }).concat(restN ? [pct(restN, pa.total)] : []);
    var cums = top.map(function (x) { return x.cum; }).concat(restN ? [100] : []), counts = top.map(function (x) { return x.n; }).concat(restN ? [restN] : []);
    var series = [{ name: 'Podíl %', color: SRC_COL[src], values: shares }, { name: 'Kumulativní %', color: COL.gray, type: 'line', values: cums }];
    var body = C.legend(series) + (pa.total ? defChart('pos-pareto-' + src, function (w) {
      return C.xyChart({ width: w, height: chartH, labels: labels, tipLabels: top.map(function (x) { return x.code + ' · ' + x.desc; }).concat(restN ? ['ostatní (' + rest.length + ' kódů)'] : []), series: series, yMax: 100, dec: 0, unit: ' %', barLabels: true, allLabels: true, barLabelFn: function (i) { return fmt(counts[i]); } });
    }, chartH) : empty('Bez záznamů v tomto období.'));
    var n80 = 0; pa.items.forEach(function (x, i) { if (x.cum <= 80.0001 || (i > 0 && pa.items[i - 1].cum < 80)) n80 = i + 1; });
    var trs = pa.items.map(function (x, i) {
      var pn = prev ? (prev[x.desc] || 0) : null, d = pn != null ? x.n - pn : null;
      return '<tr' + (i < n80 ? ' class="hl"' : '') + '><td class="num">' + (i + 1) + '</td><td><b>' + esc(x.code) + '</b></td><td>' + esc(x.desc) + '</td><td class="num">' + fmt(x.n) + '</td><td class="num">' + fmt(x.share, 1) + ' %</td><td class="num">' + fmt(x.cum, 1) + ' %</td>' +
        (prev ? '<td class="num">' + fmt(pn) + '</td><td class="num">' + (d > 0 ? '+' : '') + fmt(d) + '</td>' : '') + '</tr>';
    }).join('');
    body += '<div class="tw"><table class="pareto"><thead><tr><th class="num">#</th><th>Kód</th><th>Popis vady</th><th class="num">Počet MC</th><th class="num">% podíl</th><th class="num">Kum. %</th>' + (prev ? '<th class="num">Předchozí (' + esc(plabelLong(sc.prevKey)) + ')</th><th class="num">Změna</th>' : '') + '</tr></thead><tbody>' + trs +
      '<tr class="tot"><td></td><td colspan="2">CELKEM · ' + fmt(pa.items.length) + ' kódů, zvýrazněno = 80 % (' + fmt(n80) + ' kódů)</td><td class="num">' + fmt(pa.total) + '</td><td class="num">100 %</td><td></td>' + (prev ? '<td class="num">' + fmt(sc.prevRows.length) + '</td><td class="num">' + (pa.total - sc.prevRows.length > 0 ? '+' : '') + fmt(pa.total - sc.prevRows.length) + '</td>' : '') + '</tr></tbody></table></div>';
    return panel('Pareto kódů vad — ' + src + ' — ' + esc(sc.label) + ' <span class="muted">(' + fmt(pa.total) + ' MC)</span>', body);
  }
  function viewPos() {
    if (!DB.pos.length) return empty('Žádná data z archivu posouzení. Nahraj <b>ArchivPosouzeni_MainCarrier.xlsx</b> v záložce <b>Data &amp; metodika</b>.');
    var periods = periodsOf(), h = '', cards = '';
    ['PREFIX', 'SKLAD'].forEach(function (src) {
      var rows = DB.pos.filter(function (r) { return r.src === src; }), lt = lastTwo(rows), byP = sumBy(rows, pk);
      cards += kpiCard({ title: 'Posouzení ' + src, value: fmt(byP[lt.last]), unit: 'ks', rag: ragRel(byP[lt.last] || 0, lt.prev ? byP[lt.prev] : null, 25, 5), sub: cmpLabel(lt) });
    });
    var rw = DB.rework, ltR = lastTwo(rw), byR = sumBy(rw, pk);
    cards += kpiCard({ title: 'Sklad → rework', value: fmt(byR[ltR.last]), unit: 'ks', rag: ragRel(byR[ltR.last] || 0, ltR.prev ? byR[ltR.prev] : null, 25, 5), sub: cmpLabel(ltR) });
    h += '<div class="grid3">' + cards + '</div>';
    // filtr období pro Pareto — jako "Filtrovat dle měsíce / roku" v Excelu
    var allKeys = Object.keys(sumBy(DB.pos, pk)).sort().reverse();
    h += '<div class="daynav"><span>Pareto za:</span><select class="inp" id="posScope"><option value="last"' + (S.posScope === 'last' ? ' selected' : '') + '>poslední období zdroje</option><option value="all"' + (S.posScope === 'all' ? ' selected' : '') + '>vše</option>' +
      allKeys.map(function (k) { return '<option value="' + esc(k) + '"' + (S.posScope === k ? ' selected' : '') + '>' + esc(plabelLong(k)) + '</option>'; }).join('') + '</select>' +
      '<span class="muted">Přepínač Týden / Měsíc nahoře určuje, jaká období jsou v nabídce. Pořadí kódů = Pareto dle vybraného období, ne dle celkového součtu.</span></div>';
    h += '<div class="two">' + paretoPanel('PREFIX') + paretoPanel('SKLAD') + '</div>';
    var cP = sumBy(DB.pos, pk, null, function (r) { return r.src === 'PREFIX'; }), cS = sumBy(DB.pos, pk, null, function (r) { return r.src === 'SKLAD'; });
    var ps = [{ name: 'PREFIX', color: SRC_COL.PREFIX, values: periods.map(function (p) { return cP[p] || null; }) }, { name: 'SKLAD', color: SRC_COL.SKLAD, values: periods.map(function (p) { return cS[p] || null; }) }];
    var vs = P.VARIANTS.map(function (v) { var c = sumBy(DB.pos, pk, null, function (r) { return r.variant === v; }); return { name: v, color: VAR_COL[v], values: periods.map(function (p) { return c[p] || null; }) }; });
    h += '<div class="two">' + panel('Posouzení — ks za období', C.legend(ps) + defChart('pos-tr', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: ps, barLabels: true }); }))
      + panel('Posouzení podle varianty (PREFIX + SKLAD)', C.legend(vs) + defChart('pos-var', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: vs, stacked: true, barLabels: true }); })) + '</div>';
    // trend top 5 kódů (dle vybraného období) za všechna období
    var scAll = posScopeRows(DB.pos), top5 = paretoOf(scAll.rows).items.slice(0, 5), codeCol = {}; top5.forEach(function (x, i) { codeCol[x.desc] = SLOTS[i]; });
    var tser = top5.map(function (x) { var c = sumBy(DB.pos, pk, null, function (r) { return r.desc === x.desc; }); return { name: x.code + ' · ' + x.desc, color: codeCol[x.desc], type: 'line', values: periods.map(function (p) { return c[p] || 0; }) }; });
    var ltAll = lastTwo(DB.pos), vrows = P.VARIANTS.concat(['ostatní']).map(function (v) {
      var n = function (src) { return DB.pos.filter(function (r) { return r.variant === v && r.src === src && pk(r) === ltAll.last; }).length; };
      return { label: v, values: [n('PREFIX'), n('SKLAD')] };
    }).filter(function (r) { return r.values[0] || r.values[1]; });
    h += '<div class="two">' + panel('Trend top 5 kódů (PREFIX + SKLAD, ks za období)', C.legend(tser) + defChart('pos-top-tr', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: tser }); }))
      + panel('Posouzení podle varianty — ' + plabelLong(ltAll.last), C.legend([{ name: 'PREFIX', color: SRC_COL.PREFIX }, { name: 'SKLAD', color: SRC_COL.SKLAD }]) + defChart('pos-var-last', function (w) {
        return C.hbars({ width: w, rows: vrows, series: [{ name: 'PREFIX', color: SRC_COL.PREFIX }, { name: 'SKLAD', color: SRC_COL.SKLAD }], unit: ' ks' });
      })) + '</div>';
    var rws = P.VARIANTS.map(function (v) { var c = sumBy(rw, pk, null, function (r) { return r.variant === v; }); return { name: v, color: VAR_COL[v], values: periods.map(function (p) { return c[p] || null; }) }; });
    h += panel('Sklad — na rework podle varianty', C.legend(rws) + defChart('rw-var', function (w) { return C.xyChart({ width: w, height: 240, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: rws, stacked: true, barLabels: true }); }));
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
    var srcS = DB.sources.filter(function (x) { return x.type === 'scrap' && x.stats; }).pop();
    if (srcS) h += '<p class="muted" style="margin:-6px 0 14px">Export: ' + esc(srcS.file) + ' · řádků celkem ' + fmt(srcS.stats.rows) + ' · jiná location ' + fmt(srcS.stats.otherLoc) + ' · duplicity ' + fmt(srcS.stats.dup) + ' · EUR ≤ 0 vyřazeno ' + fmt(srcS.stats.nonpos) + ' · rozsah ' + esc(srcS.from) + ' → ' + esc(srcS.to) + '</p>';
    var ser = [{ name: 'W/O tests', color: COL.s1, values: periods.map(function (p) { return wo[p] || null; }) }, { name: 'Testy (kód 20)', color: COL.s2, values: periods.map(function (p) { return tests[p] || null; }) }];
    var last = inc.filter(function (r) { return pk(r) === lt.last && !r.test; }), byR = sumBy(last, function (r) { return r.reason; }, function (r) { return r.eur; }), descOf = {}, cntR = sumBy(last, function (r) { return r.reason; });
    last.forEach(function (r) { descOf[r.reason] = r.desc; });
    var tot = last.reduce(function (a, r) { return a + r.eur; }, 0), reasons = Object.keys(byR).sort(function (a, b) { return byR[b] - byR[a]; }).slice(0, 8), cum = 0;
    var byI = sumBy(last, function (r) { return r.item || '(bez item)'; }, function (r) { return r.eur; }), items = Object.keys(byI).sort(function (a, b) { return byI[b] - byI[a]; }).slice(0, 8);
    h += '<div class="two">' + panel('Scrap EUR za období — w/o tests + testy', C.legend(ser) + defChart('sc-tr', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: ser, stacked: true, barLabels: true, unit: ' EUR' }); }))
      + panel('Pareto reason codes (w/o tests) — ' + plabelLong(lt.last), defChart('sc-par', function (w) {
        cum = 0;
        return C.hbars({ width: w, labelWidth: 230, rows: reasons.map(function (r) { cum += byR[r]; return { label: r + ' · ' + (descOf[r] || ''), values: [byR[r]], notes: [fmt(pct(byR[r], tot), 0) + ' % · kum. ' + fmt(pct(cum, tot), 0) + ' % · ' + fmt(cntR[r]) + ' tx'] }; }), series: [{ name: 'EUR', color: COL.s1 }], unit: ' EUR' });
      })) + '</div>';
    var byV = sumBy(last, function (r) { return r.variant; }, function (r) { return r.eur; }), qtyV = sumBy(last, function (r) { return r.variant; }, function (r) { return Math.abs(r.qty || 0); });
    var vrows = P.VARIANTS.concat(['ostatní']).filter(function (v) { return byV[v]; }).map(function (v) { return { label: v, values: [byV[v]], notes: [fmt(pct(byV[v], tot), 0) + ' % · ' + fmt(qtyV[v]) + ' ks'] }; });
    var vs = P.VARIANTS.concat(['ostatní']).map(function (v) { var c = sumBy(inc, pk, function (r) { return r.eur; }, function (r) { return r.variant === v && !r.test; }); return { name: v, color: VAR_COL[v], values: periods.map(function (p) { return c[p] || null; }) }; }).filter(function (sr) { return sr.values.some(function (x) { return x; }); });
    h += '<div class="two">' + panel('Scrap podle varianty (w/o tests) — ' + plabelLong(lt.last), defChart('sc-var', function (w) {
      return C.hbars({ width: w, rows: vrows, series: [{ name: 'EUR', color: COL.s1 }], unit: ' EUR' });
    })) + panel('Scrap EUR podle varianty za období (w/o tests)', C.legend(vs) + defChart('sc-var-tr', function (w) { return C.xyChart({ width: w, height: 260, labels: periods.map(plabel), tipLabels: periods.map(plabelLong), series: vs, stacked: true, barLabels: true, unit: ' EUR' }); })) + '</div>';
    // propojení posouzení -> scrap: stejné kódy vad (SPF, SSP2, PMEP, NRW, ...)
    var posLast = DB.pos.filter(function (r) { return pk(r) === lt.last; }), posByCode = sumBy(posLast, function (r) { return r.code; }), scrapCnt = sumBy(last, function (r) { return r.reason; });
    var codes = {}; Object.keys(posByCode).forEach(function (c) { codes[c] = 1; }); Object.keys(byR).forEach(function (c) { codes[c] = 1; });
    var linkRows = Object.keys(codes).map(function (c) { return { code: c, pos: posByCode[c] || 0, n: scrapCnt[c] || 0, eur: byR[c] || 0, desc: descOf[c] || '' }; }).sort(function (a, b) { return (b.eur - a.eur) || (b.pos - a.pos); }).slice(0, 15);
    if (!DB.pos.length) linkRows = [];
    h += '<div class="two">' + panel('Top díly (w/o tests) — ' + plabelLong(lt.last), defChart('sc-item', function (w) {
      return C.hbars({ width: w, labelWidth: 230, rows: items.map(function (i) { return { label: i, values: [byI[i]] }; }), series: [{ name: 'EUR', color: COL.s1 }], unit: ' EUR' });
    })) + panel('Posouzení → scrap podle kódu — ' + plabelLong(lt.last) + ' <span class="muted">(stejné kódy vad; posouzení = PREFIX + SKLAD)</span>', linkRows.length ? table(['Kód', 'Popis', 'Na posouzení (MC)', 'Scrap transakce', 'Scrap EUR'], linkRows.map(function (r) { return [esc(r.code), r.desc, fmt(r.pos), fmt(r.n), fmt(r.eur)]; })) : empty('Bez dat posouzení.')) + '</div>';
    var exc = sumBy(DB.scrap, pk, function (r) { return r.eur; }, function (r) { return r.excluded; });
    h += panel('Přehled období <span class="muted">(Vyloučeno = Excluded? = YES: LAB, technologický scrap, PPAP… — do QLR nejde)</span>', table(['Období', 'W/O tests EUR', 'Testy (kód 20) EUR', 'With tests EUR', 'Vyloučeno EUR', 'Transakce'], periods.slice().reverse().map(function (p) { return [esc(plabelLong(p)), fmt(wo[p] || 0), fmt(tests[p] || 0), fmt(wt[p] || 0), fmt(exc[p] || 0), fmt(tx[p] || 0)]; })));
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
  var VIEWS = [viewHome, viewData], DETAIL_VIEWS = { prefix: viewPrefix, mc: viewMc, pos: viewPos, scrap: viewScrap };
  function render() {
    defectColors();
    CHARTS = {};
    var main = document.getElementById('main');
    try { main.innerHTML = VIEWS[S.tab](); } catch (e) { main.innerHTML = empty('Chyba při vykreslení: ' + esc(e.message)); if (window.console) console.error(e); }
    drawCharts();
    var tabs = document.querySelectorAll('.tab'), i;
    for (i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', i === S.tab);
    var sb = document.getElementById('sbar'), pf = document.getElementById('periodBar'), hb2 = document.getElementById('homeBar');
    if (pf) pf.style.display = (S.tab === 0 && S.detail) ? '' : 'none'; if (hb2) { hb2.style.display = S.tab === 0 ? '' : 'none'; hb2.innerHTML = S.tab === 0 ? homeBar() : ''; }
    if (sb) sb.style.display = S.tab === 1 ? 'none' : '';
    document.querySelectorAll('[data-period]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-period') === S.period); });
    document.querySelectorAll('[data-span]').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-span') === S.span); });
    renderHeader();
    bindDrops();
    document.querySelectorAll('[data-day]').forEach(function (b) { b.onclick = function () { var v = b.getAttribute('data-day'); if (!v) return; S.day = v === 'latest' ? null : v; render(); }; });
    document.querySelectorAll('[data-detail]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var d = a.getAttribute('data-detail'); S.detail = S.detail === d ? null : d; location.hash = 'tab=0' + (S.detail ? '&d=' + S.detail : ''); render(); var el = document.getElementById('detail'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
    document.querySelectorAll('[data-detail-close]').forEach(function (b) { b.onclick = function () { S.detail = null; location.hash = 'tab=0'; render(); window.scrollTo(0, 0); }; });
    var dp = document.getElementById('dayPick'); if (dp) dp.onchange = function () { S.day = dp.value || null; render(); };
    var psc = document.getElementById('posScope'); if (psc) psc.onchange = function () { S.posScope = psc.value; render(); };
    document.querySelectorAll('[data-postile]').forEach(function (b) { b.onclick = function () { S.posTile = b.getAttribute('data-postile'); try { localStorage.setItem(LS_SET, JSON.stringify({ period: S.period, span: S.span })); } catch (e) { } render(); }; });
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
    if (S.tab === 6) S.tab = 1; // starý odkaz na Data & metodika
    var mp = location.hash.match(/pos=([\w-]+)/); if (mp) S.posScope = mp[1];
    var md = location.hash.match(/d=(prefix|mc|pos|scrap)/); if (md) S.detail = md[1];
    S.tv = /(^|[#&])tv(=1)?($|&)/.test(location.hash);
    if (S.tv) { // TV režim: bez lišt, hodiny, obnovení každých 15 min (nová data z GitHub Pages / OneDrive)
      document.body.classList.add('tv');
      var clk = document.getElementById('clock'), tick = function () { var t = new Date(); clk.textContent = dowLabel(P.isoDate(t)) + ' ' + t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes(); };
      tick(); setInterval(tick, 15000); setTimeout(function () { location.reload(); }, 15 * 60000);
    }
    var tabs = document.getElementById('tabs');
    tabs.innerHTML = TABS.map(function (t, i) { return '<button class="tab" data-tab="' + i + '">' + t + '</button>'; }).join('');
    tabs.onclick = function (e) { var b = e.target.closest('[data-tab]'); if (!b) return; S.tab = +b.getAttribute('data-tab'); location.hash = 'tab=' + S.tab; render(); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', function () { if (S.tv !== /(^|[#&])tv(=1)?($|&)/.test(location.hash)) location.reload(); });
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
