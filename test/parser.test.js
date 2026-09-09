/* Testy parseru: reálné soubory z data/ + regresní test na bug „text ve sloupci Linka“. Spuštění: node test/parser.test.js */
'use strict';
var path = require('path'), fs = require('fs'), assert = require('assert');
var XLSX = require(path.join(__dirname, '../vendor/xlsx.full.min.js'));
var P = require(path.join(__dirname, '../src/parser.js'));
var today = new Date(2026, 8, 8), fails = 0;
function t(name, fn) { try { fn(); console.log('✔ ' + name); } catch (e) { fails++; console.log('✘ ' + name + ': ' + e.message); } }

t('text ve sloupci Linka nespadne a ponechá předchozí linku', function () {
  var H = ['Dátum kontroly / Date of control', 'Week', 'Linka ', 'Variant / Version', 'Časový prehľad', 'Celkový počet hodín', 'VYROBENÝCH', 'VYKONANÝCH kontrol', 'Right first time', 'Chyba / Defect', 'detekovaných vad', 'POSÚDENIE', 'Celkový počet OK'];
  var rows = [['Kontrolný report'], [], [], [], [], H,
    [new Date(2026, 0, 5), 2, 1, 'FRT RH', '6:00 - 23:00', 34.5, null, 85, 0, 'Vzduch', 23, null, 59],
    [new Date(2026, 0, 6), 2, '6:00 - 14:00', 'FRT RH', null, null, null, 90, 0, 'Vzduch', 5, null, 59],
    [new Date(2028, 7, 24), 2, 2, 'RR LH', null, null, null, 10, 0, 'Šitie', '3', null, 5]];
  var r = P.parseControlReport(rows, { today: today });
  assert.strictEqual(r.kind, 'qc');
  assert.deepStrictEqual(r.defects.map(function (x) { return [x.d, x.line, x.n]; }), [['2026-01-05', 1, 23], ['2026-01-06', 1, 5], ['2026-08-24', 2, 3]]);
  assert.ok(r.warnings.some(function (w) { return /Linka je text/.test(w.msg); }));
  assert.ok(r.warnings.some(function (w) { return /budoucnosti/.test(w.msg); }));
});
t('MC report bez sloupce Linka -> kind mc, NOK/posouzení', function () {
  var H = ['Dátum kontroly', 'Variant / Version', 'Časový prehľad', 'Celkový počet hodín', 'Celkový počet skontrolovaných', 'Chyba / Defect', 'Celkový počet zachytených vad', 'Posúdenie', 'Celkový počet NOK (po posúdenie)', 'Celkový počet OK'];
  var rows = [[], [], [], [], [], H, [new Date(2026, 0, 31), 'FRT LH', '6:00 - 14:00', 24, 86, 'Vzduch', 16, 9, 9, 77], [null, null, null, null, null, 'Laminácia (vraský)', 21]];
  var r = P.parseControlReport(rows, { today: today });
  assert.strictEqual(r.kind, 'mc'); assert.strictEqual(r.checked[0].nok, 9); assert.strictEqual(r.defects.length, 2); assert.strictEqual(r.defects[1].variant, 'FRT LH');
});
t('QAD scrap: mapování podle hlavičky, filtr PCO001/ISS-SCRP, dedup, EUR>0', function () {
  var H = ['Transaction Number', 'Transaction Type', 'Date', 'Location', 'Reason', 'Description reason', 'Group 2', 'Excluded?', 'EUR'];
  var rows = [H, [1, 'ISS-SCRP', new Date(2026, 7, 3), 'PCO001', '12', 'Vzduch', 'G463', 'NO', 10], [1, 'ISS-SCRP', new Date(2026, 7, 3), 'PCO001', '12', 'Vzduch', 'G463', 'NO', 10],
    [2, 'ISS-SCRP', new Date(2026, 7, 3), 'PCO002', '12', 'x', 'G1', 'NO', 10], [3, 'RCT-WO', new Date(2026, 7, 3), 'PCO001', '12', 'x', 'G1', 'NO', 10],
    [4, 'ISS-SCRP', new Date(2026, 7, 4), 'PCO001', '20', 'Test', 'G463', 'NO', 5], [5, 'ISS-SCRP', new Date(2026, 7, 4), 'PCO001', '12', 'Vzduch', 'G463', 'NO', -3], [6, 'ISS-SCRP', new Date(2026, 7, 4), 'PCO001', 'LAB', 'Lab', 'G463', 'YES', 7]];
  var r = P.parseScrap(rows, { today: today });
  assert.strictEqual(r.records.length, 3); assert.strictEqual(r.stats.dup, 1); assert.strictEqual(r.stats.nonpos, 1);
  assert.ok(r.records[1].test && !r.records[1].excluded); assert.ok(r.records[2].excluded);
  assert.throws(function () { P.parseScrap([['Transaction Number', 'Date']], {}); }, /chybí sloupce/);
});
t('pack/unpack je bezeztrátový (w, side se dopočítají)', function () {
  var db = { meta: { builtAt: 'x' }, sources: [], warnings: [], qc: { checked: [{ d: '2026-01-05', w: '2026-W02', line: 1, variant: 'FRT RH', side: 'RH', checked: 85 }], defects: [] }, mc: { checked: [], defects: [] }, pos: [], rework: [], scrap: [] };
  var back = P.unpack(JSON.parse(JSON.stringify(P.pack(db))));
  assert.deepStrictEqual(back.qc.checked, db.qc.checked);
});
if (fs.existsSync(path.join(__dirname, '../data'))) {
  fs.readdirSync(path.join(__dirname, '../data')).filter(function (f) { return /\.xls[xm]?$/i.test(f); }).forEach(function (f) {
    t('reálný soubor ' + f, function () {
      var wb = XLSX.read(fs.readFileSync(path.join(__dirname, '../data', f)), { cellDates: true });
      var ds = P.parseWorkbook(XLSX, wb, f, { today: today });
      ds.forEach(function (d) { var n = (d.records || d.defects).length; assert.ok(n > 0, d.type + ' bez záznamů'); console.log('    ' + d.type + (d.src ? ':' + d.src : '') + ' ' + n + ' záznamů'); });
    });
  });
}
console.log(fails ? fails + ' test(ů) selhalo' : 'Vše OK');
process.exit(fails ? 1 : 0);
