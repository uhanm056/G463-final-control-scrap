#!/usr/bin/env node
/* Z plného QAD exportu (20 MB, celý závod) vytáhne jen řádky pro danou location do malého XLSX,
 * který jde commitnout do data/ a zapéct buildem. List i hlavičky zůstávají stejné, parser ho čte beze změny.
 * Použití: node tools/scrap-extract.js <scrap_QAD_*.xlsx> [PCO001] [data/scrap_QAD_PCO001.xlsx] */
'use strict';
var fs = require('fs'), path = require('path');
var XLSX = require(path.join(__dirname, '../vendor/xlsx.full.min.js'));
var src = process.argv[2], loc = (process.argv[3] || 'PCO001').toUpperCase(), out = process.argv[4] || path.join(__dirname, '../data/scrap_QAD_' + loc + '.xlsx');
if (!src) { console.error('Použití: node tools/scrap-extract.js <export.xlsx> [location] [výstup.xlsx]'); process.exit(1); }
var wb = XLSX.read(fs.readFileSync(src), { cellDates: true }), ws = wb.Sheets['Data QAD'];
if (!ws) { console.error('Chybí list "Data QAD"'); process.exit(1); }
var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }), H = rows[0];
var li = H.map(function (h) { return String(h || '').trim().toLowerCase(); }).indexOf('location');
if (li < 0) { console.error('Chybí sloupec Location'); process.exit(1); }
var iso = function (v) { return v instanceof Date ? (isNaN(v) ? null : v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2)) : v; };
var keep = [H].concat(rows.slice(1).filter(function (r) { return String(r[li] || '').trim().toUpperCase() === loc; }).map(function (r) { return r.map(iso); }));
var nb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(nb, XLSX.utils.aoa_to_sheet(keep), 'Data QAD');
fs.writeFileSync(out, XLSX.write(nb, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log(loc + ': ' + (keep.length - 1) + ' řádků z ' + (rows.length - 1) + ' → ' + path.relative(process.cwd(), out) + ' (' + (fs.statSync(out).size / 1024).toFixed(0) + ' kB)');
