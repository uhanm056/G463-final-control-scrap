#!/usr/bin/env node
/* Sestaví jeden self-contained HTML (docs/index.html): styly, SheetJS, parser, grafy, aplikace + data z data/*.xls*.
 * Použití: node build.js [--out docs/index.html] [--no-data]
 * Bez npm install — SheetJS je ve vendor/ (stejný soubor jde inline do HTML, shopfloor síť blokuje CDN). */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = __dirname, args = process.argv.slice(2);
var out = path.resolve(ROOT, args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : 'docs/index.html');
var XLSX = require(path.join(ROOT, 'vendor/xlsx.full.min.js'));
var P = require(path.join(ROOT, 'src/parser.js'));
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

var DB = { meta: { builtAt: new Date().toISOString().slice(0, 16).replace('T', ' '), savedAt: null }, qc: { checked: [], defects: [] }, mc: { checked: [], defects: [] }, pos: [], rework: [], scrap: [], sources: [], warnings: [] };
function rangeOf(rows) { var d = rows.map(function (r) { return r.d; }).sort(); return { from: d[0] || null, to: d[d.length - 1] || null }; }
if (args.indexOf('--no-data') < 0 && fs.existsSync(path.join(ROOT, 'data'))) {
  fs.readdirSync(path.join(ROOT, 'data')).filter(function (f) { return /\.xls[xm]?$/i.test(f) && !/^~\$/.test(f); }).sort().forEach(function (f) {
    var wb = XLSX.read(fs.readFileSync(path.join(ROOT, 'data', f)), { cellDates: true });
    var ds = P.parseWorkbook(XLSX, wb, f, { today: new Date() });
    ds.forEach(function (d) {
      var recs = d.records || d.defects, key = d.type + (d.src ? ':' + d.src : ''), rg;
      if (d.type === 'qc' || d.type === 'mc') DB[d.type] = { checked: d.checked, defects: d.defects };
      else if (d.type === 'pos') DB.pos = DB.pos.filter(function (r) { return r.src !== d.src; }).concat(d.records);
      else if (d.type === 'rework') DB.rework = d.records;
      else if (d.type === 'scrap') { var seen = {}; DB.scrap.forEach(function (r) { seen[r.tx] = 1; }); DB.scrap = DB.scrap.concat(d.records.filter(function (r) { return !seen[r.tx]; })); recs = DB.scrap; }
      rg = rangeOf(recs);
      DB.sources.push({ key: key, file: f, sheet: d.sheet, type: d.type, src: d.src, records: recs.length, from: rg.from, to: rg.to, importedAt: DB.meta.builtAt + ' (build)', stats: d.stats || null });
      d.warnings.forEach(function (w) { w.srcKey = key; DB.warnings.push(w); });
      console.log('  ' + f + ' → ' + key + ': ' + recs.length + ' záznamů (' + rg.from + ' → ' + rg.to + ')' + (d.warnings.length ? ', varování: ' + d.warnings.map(function (w) { return w.count + '× ' + w.msg; }).join('; ') : ''));
    });
  });
}
var json = JSON.stringify(P.pack(DB)).replace(/<\//g, '<\\/');
var html = read('src/template.html')
  .replace('/*STYLES*/', function () { return read('src/styles.css'); })
  .replace('<!--VENDOR-->', function () { return '<script>/* SheetJS 0.18.5 (Apache-2.0) — inline, shopfloor síť blokuje CDN */\n' + read('vendor/xlsx.full.min.js') + '\n</script>'; })
  .replace('<!--DATA-->', function () { return '<script>window.G463_DATA = ' + json + ';</script>'; })
  .replace('/*PARSER*/', function () { return read('src/parser.js'); })
  .replace('/*CHARTS*/', function () { return read('src/charts.js'); })
  .replace('/*APP*/', function () { return read('src/app.js'); });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('OK → ' + path.relative(ROOT, out) + ' (' + (html.length / 1024 / 1024).toFixed(2) + ' MB, data ' + (json.length / 1024).toFixed(0) + ' kB)');
