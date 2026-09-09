/* G463 Prefix — SVG grafy bez knihoven (na TV bez GPU akcelerace Canvas nespolehlivý).
 * Všechny funkce vrací string s <svg>. Jedna osa Y, tenké značky, hairline grid.
 */
var G463Charts = (function () {
  'use strict';
  var INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' };
  var MONO = 'Consolas, "Courier New", monospace', SANS = 'Arial, Helvetica, sans-serif';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function fmtNum(v, dec) {
    if (v == null || isNaN(v)) return '–';
    return Number(v).toLocaleString('cs-CZ', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }
  function niceTicks(max, n) {
    if (!(max > 0)) max = 1;
    n = n || 5;
    var raw = max / n, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), norm = raw / mag, step;
    step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var out = [], v = 0;
    while (v < max - 1e-9) { out.push(v); v += step; }
    out.push(v);
    return out;
  }
  function tip(s) { return ' data-tip="' + esc(s) + '"'; }

  /* Sloupce (skupinově / stackované) a čáry nad kategoriální osou X, jedna osa Y. */
  function xyChart(o) {
    var W = o.width || 800, H = o.height || 260, padL = 56, padR = 20, padT = 14, padB = 36;
    if (o.mini) { padL = 6; padR = 44; padT = 8; padB = 18; }
    if (o.allLabels && (o.labels || []).length && ((o.width || 800) - padL - padR) / o.labels.length < 46) padB = 58;
    var labels = o.labels || [], n = labels.length, series = o.series || [];
    var bars = series.filter(function (s) { return s.type !== 'line'; }), lines = series.filter(function (s) { return s.type === 'line'; });
    var fmt = o.fmt || function (v) { return fmtNum(v, o.dec || 0); };
    var max = 0, i, j;
    for (j = 0; j < series.length; j++) for (i = 0; i < n; i++) { var v = series[j].values[i]; if (v != null && v > max && (series[j].type === 'line' || !o.stacked)) max = v; }
    if (o.stacked) for (i = 0; i < n; i++) { var st = 0; for (j = 0; j < bars.length; j++) st += bars[j].values[i] || 0; if (st > max) max = st; }
    if (o.yMax != null && o.yMax > max) max = o.yMax;
    var ticks = niceTicks(max, 5), top = ticks[ticks.length - 1];
    var w = W - padL - padR, h = H - padT - padB;
    var y = function (v) { return padT + h - (v / top) * h; };
    var slot = n ? w / n : w, xc = function (i) { return padL + slot * (i + 0.5); };
    var s = '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" font-family="' + SANS + '">';
    // grid + osa Y
    for (i = 0; i < ticks.length; i++) {
      if (o.mini && ticks[i] !== 0) continue;
      s += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(ticks[i]).toFixed(1) + '" y2="' + y(ticks[i]).toFixed(1) + '" stroke="' + (ticks[i] === 0 ? INK.axis : INK.grid) + '" stroke-width="1"/>';
      if (!o.mini) s += '<text x="' + (padL - 8) + '" y="' + (y(ticks[i]) + 4).toFixed(1) + '" text-anchor="end" font-size="12" font-family="' + MONO + '" fill="' + INK.muted + '">' + esc(fmt(ticks[i])) + '</text>';
    }
    // popisky X (řídce, aby se nepřekrývaly)
    var every = o.allLabels ? 1 : Math.max(1, Math.ceil(n / Math.floor(w / 56))), rot = o.allLabels && slot < 46;
    for (i = 0; i < n; i++) if (o.mini ? (i === 0 || i === n - 1) : (n - 1 - i) % every === 0) {
      var lx = xc(i).toFixed(1), ly = H - padB + (o.mini ? 13 : 18);
      if (rot) s += '<text transform="translate(' + lx + ' ' + (H - padB + 6) + ') rotate(-45)" text-anchor="end" font-size="11" fill="' + INK.secondary + '">' + esc(labels[i]) + '</text>';
      else s += '<text x="' + lx + '" y="' + ly + '" text-anchor="' + (o.mini ? (i === 0 ? 'start' : 'end') : 'middle') + '" font-size="' + (o.mini ? 10 : (slot < 60 ? 11 : 12)) + '" fill="' + INK.secondary + '">' + esc(labels[i]) + '</text>';
    }
    // sloupce
    if (bars.length) {
      var groupW = Math.min(slot * 0.72, 64), nb = o.stacked ? 1 : bars.length, bw = groupW / nb;
      for (i = 0; i < n; i++) {
        var acc = 0;
        for (j = 0; j < bars.length; j++) {
          var val = bars[j].values[i]; if (val == null || val === 0) continue;
          var x0 = o.stacked ? xc(i) - groupW / 2 : xc(i) - groupW / 2 + j * bw;
          var y1 = o.stacked ? y(acc + val) : y(val), y0 = o.stacked ? y(acc) : y(0);
          var hh = Math.max(0, y0 - y1 - (o.stacked && acc > 0 ? 2 : 0));
          s += '<rect x="' + (x0 + 1).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="' + (o.stacked ? 0 : 3) + '" fill="' + bars[j].color + '"' + tip((o.tipLabels || labels)[i] + ' · ' + bars[j].name + ': ' + fmt(val) + (o.unit || '')) + '/>';
          acc += val;
        }
        if (o.barLabels && n <= 40) {
          var tot = o.stacked ? acc : Math.max.apply(null, bars.map(function (b) { return b.values[i] || 0; }));
          if (tot > 0) s += '<text x="' + xc(i).toFixed(1) + '" y="' + (y(tot) - 5).toFixed(1) + '" text-anchor="middle" font-size="' + (n > 16 ? 10 : 11) + '" font-family="' + MONO + '" fill="' + INK.secondary + '">' + esc(o.barLabelFn ? o.barLabelFn(i, tot) : fmt(tot)) + '</text>';
        }
      }
    }
    // čáry
    for (j = 0; j < lines.length; j++) {
      var L = lines[j], pts = [], k;
      for (i = 0; i < n; i++) if (L.values[i] != null) pts.push([xc(i), y(L.values[i]), i]);
      if (!pts.length) continue;
      var d = '';
      for (k = 0; k < pts.length; k++) d += (k ? 'L' : 'M') + pts[k][0].toFixed(1) + ' ' + pts[k][1].toFixed(1);
      s += '<path d="' + d + '" fill="none" stroke="' + L.color + '" stroke-width="2"' + (L.dashed ? ' stroke-dasharray="6 4"' : '') + ' stroke-linejoin="round"/>';
      for (k = 0; k < pts.length; k++) {
        s += '<circle cx="' + pts[k][0].toFixed(1) + '" cy="' + pts[k][1].toFixed(1) + '" r="4" fill="' + L.color + '" stroke="' + INK.surface + '" stroke-width="2"/>';
        s += '<circle cx="' + pts[k][0].toFixed(1) + '" cy="' + pts[k][1].toFixed(1) + '" r="12" fill="transparent"' + tip((o.tipLabels || labels)[pts[k][2]] + ' · ' + L.name + ': ' + fmt(L.values[pts[k][2]]) + (o.unit || '')) + '/>';
      }
      // přímý popisek posledního bodu
      var last = pts[pts.length - 1];
      s += '<text x="' + (last[0] + 8).toFixed(1) + '" y="' + (last[1] + 4).toFixed(1) + '" font-size="12" font-family="' + MONO + '" fill="' + INK.primary + '">' + esc(fmt(L.values[last[2]])) + '</text>';
    }
    return s + '</svg>';
  }

  /* Vodorovné sloupce: řádky s 1–2 sériemi, hodnota přímo u konce sloupce. */
  function hbars(o) {
    var rows = o.rows || [], series = o.series || [{ name: '', color: '#2a78d6' }], ns = series.length;
    var W = o.width || 600, labW = o.labelWidth || 190, valW = o.valueWidth || 150, rowH = o.rowH || (ns > 1 ? 44 : 30), padT = 6;
    var H = padT + rows.length * rowH + 6, w = W - labW - valW - 12;
    var fmt = o.fmt || function (v) { return fmtNum(v, o.dec || 0); };
    var max = o.max || 0, i, j;
    for (i = 0; i < rows.length; i++) for (j = 0; j < ns; j++) if ((rows[i].values[j] || 0) > max) max = rows[i].values[j];
    if (!(max > 0)) max = 1;
    var bh = (rowH - 8) / ns;
    var s = '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" font-family="' + SANS + '">';
    for (i = 0; i < rows.length; i++) {
      var y0 = padT + i * rowH;
      s += '<text x="' + (labW - 8) + '" y="' + (y0 + rowH / 2 + 4).toFixed(1) + '" text-anchor="end" font-size="13" fill="' + INK.primary + '">' + esc(rows[i].label) + '</text>';
      for (j = 0; j < ns; j++) {
        var v = rows[i].values[j] || 0, bw = (v / max) * w, yy = y0 + 4 + j * bh;
        s += '<rect x="' + labW + '" y="' + yy.toFixed(1) + '" width="' + Math.max(0, bw).toFixed(1) + '" height="' + Math.max(1, bh - 2).toFixed(1) + '" rx="3" fill="' + series[j].color + '"' + tip(rows[i].label + (series[j].name ? ' · ' + series[j].name : '') + ': ' + fmt(v) + (o.unit || '') + (rows[i].tips && rows[i].tips[j] ? ' (' + rows[i].tips[j] + ')' : '')) + '/>';
        s += '<text x="' + (labW + Math.max(0, bw) + 6).toFixed(1) + '" y="' + (yy + bh / 2 + 3).toFixed(1) + '" font-size="12" font-family="' + MONO + '" fill="' + INK.primary + '">' + esc(fmt(v) + (o.unit || '')) + (rows[i].notes && rows[i].notes[j] ? '<tspan fill="' + INK.muted + '"> ' + esc(rows[i].notes[j]) + '</tspan>' : '') + '</text>';
      }
      s += '<line x1="' + labW + '" x2="' + (W - 4) + '" y1="' + (y0 + rowH).toFixed(1) + '" y2="' + (y0 + rowH).toFixed(1) + '" stroke="' + INK.grid + '"/>';
    }
    return s + '</svg>';
  }

  function legend(series) {
    return '<div class="legend">' + series.map(function (s) {
      return '<span><i class="sw" style="background:' + s.color + (s.type === 'line' ? ';height:3px;border-radius:2px' : '') + '"></i>' + esc(s.name) + '</span>';
    }).join('') + '</div>';
  }

  return { xyChart: xyChart, hbars: hbars, legend: legend, fmtNum: fmtNum, esc: esc, INK: INK };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = G463Charts;
