/* G463 Prefix — parser zdrojových souborů.
 * Jeden kód pro build (Node + SheetJS) i import v prohlížeči (SheetJS inline).
 * Vstup: listy jako pole řádků (SheetJS sheet_to_json({header:1, cellDates:true})).
 * Výstup: normalizované záznamy + seznam varování (kvalita dat).
 */
var G463Parser = (function () {
  'use strict';

  var VARIANTS = ['FRT LH', 'FRT RH', 'RR LH', 'RR RH', 'HEAT. FRT LH', 'HEAT. FRT RH'];
  // rodina part numberu -> varianta (dle hlavičky listu "Sklad - na rework")
  var PN_FAMILY = {
    MY0547099: 'HEAT. FRT RH', MY0547078: 'HEAT. FRT LH',
    '3448362': 'FRT RH', '3448356': 'FRT LH',
    '3449523': 'RR RH', '3449518': 'RR LH'
  };
  var REWORK_COL = { 'FR HEAT': 'HEAT. FRT RH', 'FL HEAT': 'HEAT. FRT LH', FR: 'FRT RH', FL: 'FRT LH', RR: 'RR RH', RL: 'RR LH' };
  // sjednocení popisů vad v archivu posouzení (list SKLAD má nekonzistentní hlavičky)
  var POS_ALIAS = {
    'spatny prefix spaceru': 'Špatný prefix spaceru (otlak, mimo pozici)',
    'lepidlo pod kuzi': 'Lepidlo pod kůží',
    'ohn2+d3': 'OHN2'
  };
  var SCRAP_DEFAULTS = { location: 'PCO001', txType: 'ISS-SCRP', testReason: '20' };

  /* ---------- pomocné ---------- */
  function str(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y = t.getUTCFullYear();
    var w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return y + '-W' + pad(w);
  }
  function excelSerialToDate(n) { // 1900 date system
    var ms = Math.round((n - 25569) * 86400000);
    var u = new Date(ms);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  function toDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) return excelSerialToDate(v);
    var s = str(v), m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1]);
    return null;
  }
  function Warnings() { this.items = {}; }
  Warnings.prototype.add = function (key, msg, sample) {
    var it = this.items[key] || (this.items[key] = { key: key, msg: msg, count: 0, samples: [] });
    it.count++;
    if (sample != null && it.samples.length < 5 && it.samples.indexOf(sample) < 0) it.samples.push(sample);
  };
  Warnings.prototype.list = function () { var k, out = []; for (k in this.items) out.push(this.items[k]); return out; };

  // Datum: překlepy roku (2028 místo 2026) opravíme na aktuální rok a nahlásíme; nesmysly zahodíme.
  function sanitizeDate(d, warn, ctx, today) {
    if (!d) return null;
    var ty = today.getFullYear();
    if (d.getFullYear() > ty) {
      var fixed = new Date(ty, d.getMonth(), d.getDate());
      if (fixed - today < 8 * 86400000) {
        warn.add('date-fix-' + ctx, ctx + ': datum s rokem v budoucnosti opraveno na aktuální rok', isoDate(d) + ' → ' + isoDate(fixed));
        return fixed;
      }
      warn.add('date-drop-' + ctx, ctx + ': řádek s nesmyslným datem vynechán', isoDate(d));
      return null;
    }
    if (d.getFullYear() < 2024) { warn.add('date-drop-' + ctx, ctx + ': řádek s nesmyslným datem vynechán', isoDate(d)); return null; }
    return d;
  }
  function normVariant(v) {
    var s = str(v).toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ');
    var i;
    for (i = 0; i < VARIANTS.length; i++) if (VARIANTS[i].replace(/\./g, '') === s) return VARIANTS[i];
    return s || null;
  }
  function sideOf(variant) { return /LH$/.test(variant || '') ? 'LH' : /RH$/.test(variant || '') ? 'RH' : ''; }
  function normDefect(v) { var s = str(v); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = str(v).replace(',', '.');
    return s !== '' && !isNaN(s) ? parseFloat(s) : null;
  }
  function findHeader(rows, pred, maxScan) {
    var r, c;
    for (r = 0; r < Math.min(rows.length, maxScan || 15); r++) {
      var row = rows[r] || [];
      for (c = 0; c < row.length; c++) if (pred(str(row[c]), c, row)) return r;
    }
    return -1;
  }
  function colIndex(headerRow, patterns) { // první sloupec, jehož hlavička odpovídá regexu
    var c, i;
    for (i = 0; i < patterns.length; i++)
      for (c = 0; c < headerRow.length; c++)
        if (patterns[i].test(str(headerRow[c]))) return c;
    return -1;
  }
  function pnVariant(pn) {
    var fam = str(pn).split('-')[0].replace(/^M(?=\d)/i, '');
    return PN_FAMILY[fam] || null;
  }

  /* ---------- Kontrolný report (CZ25170 Prefix s linkou, CZ26027 MC bez linky) ---------- */
  function parseControlReport(rows, opts) {
    opts = opts || {};
    var warn = new Warnings(), today = opts.today || new Date();
    var hr = findHeader(rows, function (s) { return /^D[áa]tum kontroly/i.test(s); });
    if (hr < 0) throw new Error('Kontrolný report: nenalezena hlavička "Dátum kontroly"');
    var H = rows[hr];
    var C = {
      date: 0,
      line: colIndex(H, [/^Linka/i]),
      variant: colIndex(H, [/^Variant/i]),
      shift: colIndex(H, [/asov[ýy] preh/i]),
      hours: colIndex(H, [/po[čc]et hod[íi]n/i]),
      produced: colIndex(H, [/VYROBEN/i]),
      checked: colIndex(H, [/VYKONAN/i, /skontrolovan/i, /Total amount checked/i]),
      rft: colIndex(H, [/Right first time/i]),
      defect: colIndex(H, [/^Chyba/i]),
      count: colIndex(H, [/detekovan/i, /zachyten/i]),
      posud: colIndex(H, [/POS[ÚU]DEN/i]),
      nok: colIndex(H, [/po[čc]et NOK/i]),
      ok: colIndex(H, [/po[čc]et OK/i])
    };
    ['variant', 'checked', 'defect', 'count'].forEach(function (k) {
      if (C[k] < 0) throw new Error('Kontrolný report: chybí sloupec ' + k);
    });
    var kind = C.line >= 0 ? 'qc' : 'mc';
    var ctx = kind === 'qc' ? 'Prefix report' : 'MC report';
    var cur = { d: null, line: null, variant: null }, checked = [], defects = [], r, row, v;
    var get = function (k) { return C[k] >= 0 ? row[C[k]] : null; };
    for (r = hr + 1; r < rows.length; r++) {
      row = rows[r] || [];
      var rawDate = row[C.date], rawDefect = get('defect');
      if (rawDate == null && rawDefect == null && get('checked') == null) continue;
      if (rawDate != null) {
        var d = toDate(rawDate);
        if (!d) { warn.add('date-bad-' + ctx, ctx + ': nečitelné datum, řádek přeskočen', str(rawDate)); cur.d = null; continue; }
        cur.d = sanitizeDate(d, warn, ctx, today);
      }
      // OTEVŘENÝ BUG (CLAUDE.md): ve sloupci linka bývá text ("6:00 - 14:00") -> guard před přetypováním
      if (C.line >= 0 && (v = row[C.line]) != null) {
        if (typeof v === 'number') cur.line = Math.round(v);
        else if (/^\s*\d+\s*$/.test(String(v))) cur.line = parseInt(v, 10);
        else warn.add('line-text', ctx + ': ve sloupci Linka je text místo čísla, ponechána předchozí linka', str(v) + ' (řádek ' + (r + 1) + ')');
      }
      if ((v = get('variant')) != null) cur.variant = normVariant(v);
      if (!cur.d) continue;
      var base = { d: isoDate(cur.d), w: isoWeek(cur.d), line: cur.line, variant: cur.variant, side: sideOf(cur.variant) };
      if ((v = get('checked')) != null && num(v) != null) {
        checked.push(Object.assign({}, base, {
          checked: num(v), produced: num(get('produced')), rft: num(get('rft')), posud: num(get('posud')),
          nok: num(get('nok')), ok: num(get('ok')), hours: num(get('hours')), shift: str(get('shift')) || null
        }));
      }
      if (rawDefect != null && str(rawDefect)) {
        var n = num(get('count'));
        if (n == null) { warn.add('count-bad', ctx + ': nečíselný počet vad, bráno jako 0', str(get('count'))); n = 0; }
        defects.push(Object.assign({}, base, { defect: normDefect(rawDefect), n: n }));
      }
    }
    return { kind: kind, checked: checked, defects: defects, warnings: warn.list() };
  }

  /* ---------- Archiv posouzení (listy "Posouzení PREFIX" / "Posouzení SKLAD") ---------- */
  function parsePosouzeni(rows, src, opts) {
    opts = opts || {};
    var warn = new Warnings(), today = opts.today || new Date();
    var hr = findHeader(rows, function (s, c) { return c === 0 && /^K[óo]d vady/i.test(s); });
    if (hr < 0) throw new Error('Posouzení ' + src + ': nenalezena hlavička "Kód vady"');
    var codes = rows[hr], descs = rows[hr + 1] || [];
    var cols = [], c;
    for (c = 1; c < codes.length; c++) {
      var code = str(codes[c]), desc = str(descs[c]);
      if (!code || /^_/.test(code) || !desc || /^M[ěe]s[íi]c$/i.test(desc) || /^Rok$/i.test(desc)) continue;
      var key = POS_ALIAS[desc.toLowerCase()] || desc;
      cols.push({ c: c, code: POS_ALIAS[code.toLowerCase()] || code, desc: key });
    }
    var out = [], r;
    for (r = hr + 2; r < rows.length; r++) {
      var row = rows[r] || [], d = toDate(row[0]);
      if (!d) continue;
      d = sanitizeDate(d, warn, 'Posouzení ' + src, today);
      if (!d) continue;
      cols.forEach(function (col) {
        var pn = str(row[col.c]);
        if (!pn) return;
        var variant = pnVariant(pn);
        if (!variant) warn.add('pn-unknown', 'Posouzení: neznámá rodina part numberu, varianta = "ostatní"', pn);
        out.push({ d: isoDate(d), w: isoWeek(d), src: src, code: col.code, desc: col.desc, pn: pn, variant: variant || 'ostatní', side: sideOf(variant) });
      });
    }
    return { records: out, warnings: warn.list() };
  }

  /* ---------- Sklad - na rework ---------- */
  function parseRework(rows, opts) {
    opts = opts || {};
    var warn = new Warnings(), today = opts.today || new Date();
    var H = rows[0] || [], cols = [], c, r;
    for (c = 1; c < H.length; c++) { var v = REWORK_COL[str(H[c]).toUpperCase()]; if (v) cols.push({ c: c, variant: v }); }
    if (!cols.length) throw new Error('Sklad - na rework: nenalezeny sloupce variant');
    var out = [];
    for (r = 1; r < rows.length; r++) {
      var row = rows[r] || [], d = toDate(row[0]);
      if (!d) continue;
      d = sanitizeDate(d, warn, 'Sklad-rework', today);
      if (!d) continue;
      cols.forEach(function (col) {
        var pn = str(row[col.c]);
        if (pn) out.push({ d: isoDate(d), w: isoWeek(d), variant: col.variant, side: sideOf(col.variant), pn: pn });
      });
    }
    return { records: out, warnings: warn.list() };
  }

  /* ---------- QAD scrap export (list "Data QAD") — mapování VŽDY podle hlavičky ---------- */
  function parseScrap(rows, opts) {
    opts = Object.assign({}, SCRAP_DEFAULTS, opts || {});
    var warn = new Warnings(), today = opts.today || new Date();
    var hr = findHeader(rows, function (s) { return /^Transaction Number$/i.test(s); }, 5);
    if (hr < 0) throw new Error('Data QAD: nenalezena hlavička "Transaction Number"');
    var H = rows[hr], idx = {}, c;
    for (c = 0; c < H.length; c++) { var h = str(H[c]).toLowerCase(); if (h && idx[h] == null) idx[h] = c; }
    var need = { tx: 'transaction number', type: 'transaction type', date: 'date', loc: 'location', reason: 'reason', eur: 'eur', excl: 'excluded?' };
    var missing = [], k, C = {};
    for (k in need) { if (idx[need[k]] == null) missing.push(need[k]); else C[k] = idx[need[k]]; }
    if (missing.length) throw new Error('Data QAD: chybí sloupce: ' + missing.join(', '));
    C.desc = idx['description reason'] != null ? idx['description reason'] : idx['reason code description'];
    C.group = idx['group 2']; C.qty = idx['quantity change']; C.item = idx['item number'] != null ? idx['item number'] : idx['item'];
    var out = [], seen = {}, stats = { rows: 0, dup: 0, nonpos: 0, otherLoc: 0, otherType: 0 }, r;
    for (r = hr + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      if (row[C.tx] == null) continue;
      stats.rows++;
      if (str(row[C.loc]).toUpperCase() !== opts.location.toUpperCase()) { stats.otherLoc++; continue; }
      if (str(row[C.type]).toUpperCase() !== opts.txType.toUpperCase()) { stats.otherType++; continue; }
      var tx = str(row[C.tx]);
      if (seen[tx]) { stats.dup++; continue; }
      seen[tx] = 1;
      var eur = num(row[C.eur]);
      if (eur == null || eur <= 0) { stats.nonpos++; continue; }
      var d = toDate(row[C.date]);
      if (!d) { warn.add('scrap-date', 'Data QAD: nečitelné datum', str(row[C.date])); continue; }
      d = sanitizeDate(d, warn, 'Data QAD', today);
      if (!d) continue;
      var reason = str(row[C.reason]);
      out.push({
        tx: tx, d: isoDate(d), w: isoWeek(d), reason: reason,
        desc: C.desc != null ? str(row[C.desc]) : reason,
        group: C.group != null ? str(row[C.group]) : '',
        item: C.item != null ? str(row[C.item]) : '',
        excluded: /^y/i.test(str(row[C.excl])) || /^ano/i.test(str(row[C.excl])),
        test: reason === opts.testReason,
        eur: eur, qty: C.qty != null ? num(row[C.qty]) : null
      });
    }
    return { records: out, stats: stats, warnings: warn.list() };
  }

  /* ---------- automatická detekce typu souboru ---------- */
  function sheetRows(XLSX, ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }); }
  function parseWorkbook(XLSX, wb, fileName, opts) {
    var out = [], name, i;
    for (i = 0; i < wb.SheetNames.length; i++) {
      name = wb.SheetNames[i];
      var ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) continue;
      var m;
      if (/^Data QAD$/i.test(name)) {
        var s = parseScrap(sheetRows(XLSX, ws), opts && opts.scrap);
        out.push({ type: 'scrap', file: fileName, sheet: name, records: s.records, stats: s.stats, warnings: s.warnings });
      } else if ((m = name.match(/^Posouzen[íi]\s+(PREFIX|SKLAD)/i))) {
        var p = parsePosouzeni(sheetRows(XLSX, ws), m[1].toUpperCase(), opts);
        out.push({ type: 'pos', src: m[1].toUpperCase(), file: fileName, sheet: name, records: p.records, warnings: p.warnings });
      } else if (/^Sklad\s*-\s*na rework/i.test(name)) {
        var rw = parseRework(sheetRows(XLSX, ws), opts);
        out.push({ type: 'rework', file: fileName, sheet: name, records: rw.records, warnings: rw.warnings });
      } else if (/^Report$/i.test(name)) {
        var rows = sheetRows(XLSX, ws);
        if (findHeader(rows, function (s) { return /^D[áa]tum kontroly/i.test(s); }) < 0) continue;
        var cr = parseControlReport(rows, opts);
        out.push({ type: cr.kind, file: fileName, sheet: name, checked: cr.checked, defects: cr.defects, warnings: cr.warnings });
      }
    }
    if (!out.length) throw new Error(fileName + ': nerozpoznán žádný známý list (Report / Posouzení PREFIX|SKLAD / Sklad - na rework / Data QAD)');
    return out;
  }

  /* ---------- kompaktní formát pro vložení do HTML a localStorage (sloupce + řádky, w/side se dopočítají) ---------- */
  var TABLES = { qcChecked: ['qc', 'checked'], qcDefects: ['qc', 'defects'], mcChecked: ['mc', 'checked'], mcDefects: ['mc', 'defects'], pos: ['pos'], rework: ['rework'], scrap: ['scrap'] };
  function getT(db, path) { return path.length === 2 ? db[path[0]][path[1]] : db[path[0]]; }
  function setT(db, path, v) { if (path.length === 2) db[path[0]][path[1]] = v; else db[path[0]] = v; }
  function pack(db) {
    var out = { v: 1, meta: db.meta, sources: db.sources, warnings: db.warnings, t: {} }, k;
    for (k in TABLES) {
      var rows = getT(db, TABLES[k]) || [], cols = {}, i, c;
      for (i = 0; i < rows.length; i++) for (c in rows[i]) if (c !== 'w' && c !== 'side') cols[c] = 1;
      cols = Object.keys(cols);
      out.t[k] = { c: cols, r: rows.map(function (r) { return cols.map(function (c) { return r[c] === undefined ? null : r[c]; }); }) };
    }
    return out;
  }
  function unpack(pk) {
    var db = { meta: pk.meta || {}, sources: pk.sources || [], warnings: pk.warnings || [], qc: { checked: [], defects: [] }, mc: { checked: [], defects: [] }, pos: [], rework: [], scrap: [] }, k;
    for (k in TABLES) {
      var t = pk.t && pk.t[k]; if (!t) continue;
      setT(db, TABLES[k], t.r.map(function (row) {
        var o = {}, i; for (i = 0; i < t.c.length; i++) o[t.c[i]] = row[i];
        if (o.d) o.w = isoWeek(toDate(o.d));
        if ('variant' in o) o.side = sideOf(o.variant);
        return o;
      }));
    }
    return db;
  }

  return {
    pack: pack, unpack: unpack,
    VARIANTS: VARIANTS, PN_FAMILY: PN_FAMILY, SCRAP_DEFAULTS: SCRAP_DEFAULTS,
    isoDate: isoDate, isoWeek: isoWeek, toDate: toDate, sideOf: sideOf, normVariant: normVariant,
    parseControlReport: parseControlReport, parsePosouzeni: parsePosouzeni, parseRework: parseRework,
    parseScrap: parseScrap, parseWorkbook: parseWorkbook
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = G463Parser;
