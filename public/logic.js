/* Lógica compartida entre el servidor y la app: cuentas, informe, PDF y validación. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VaquitaLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
/* ========== Lógica de cuentas: todo se calcula en centavos enteros ========== */
const MONEDAS = { ARS: '$', USD: 'US$', EUR: '€', BRL: 'R$', UYU: '$U', CLP: 'CLP$' };
const CATS = ['Comida', 'Bebida', 'Súper', 'Transporte', 'Alojamiento', 'Salida', 'Otros'];
const MODO_CORTO = { iguales: 'Iguales', items: 'Por ítems', montos: 'A medida', porcentajes: 'Porcentajes', partes: 'Por partes' };
const MODOS = { iguales: 'Partes iguales', items: 'Por ítems', montos: 'Montos a medida', porcentajes: 'Porcentajes', partes: 'Por partes' };

function parseMoney(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s$]/g, '').replace(/[a-z]/gi, '');
  if (!s) return null;
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) {
    const dec = c > d ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (c >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(',').join('') : s.replace(',', '.');
  } else if (d >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.split('.').join('');
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return null;
  return Math.round(parseFloat(s) * 100);
}
function parseNum(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (!s) return 0;
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : 0;
}
const toInput = c => c ? String(c / 100).replace('.', ',') : '';

/* Reparte un total entero según pesos. Los centavos sobrantes van a los restos mayores: la suma siempre da exacto. */
function allocate(total, weights) {
  const keys = Object.keys(weights).filter(k => weights[k] > 0);
  const out = {};
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  if (!sum || !total) return out;
  const fr = keys.map((k, i) => { const x = total * weights[k] / sum, f = Math.floor(x); out[k] = f; return { k, r: x - f, i }; });
  let left = total - keys.reduce((a, k) => a + out[k], 0);
  fr.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let i = 0; left > 0; i = (i + 1) % fr.length, left--) out[fr[i].k]++;
  return out;
}
const n0 = v => (typeof v === 'number' && isFinite(v) ? v : 0);

function division(g) {
  const out = {};
  const add = (m, sign) => Object.keys(m).forEach(k => { out[k] = (out[k] || 0) + sign * m[k]; });
  const part = g.participantes || [], vals = g.valores || {};
  if (g.modo === 'items') {
    const sub = {};
    (g.items || []).forEach(it => {
      const m = allocate(n0(it.precio), it.consumen || {});
      Object.keys(m).forEach(k => { sub[k] = (sub[k] || 0) + m[k]; });
    });
    add(sub, 1);
    const extra = n0(g.propina) - n0(g.descuento);
    if (extra > 0) add(allocate(extra, sub), 1);
    if (extra < 0) add(allocate(-extra, sub), -1);
  } else if (g.modo === 'montos') {
    Object.keys(vals).forEach(k => { if (vals[k]) out[k] = n0(vals[k]); });
  } else if (g.modo === 'porcentajes' || g.modo === 'partes') {
    add(allocate(n0(g.total), vals), 1);
  } else {
    const w = {}; part.forEach(p => { w[p] = 1; });
    add(allocate(n0(g.total), w), 1);
  }
  return out;
}

function compute(j, gastos, pagos) {
  const rows = {};
  const ensure = id => rows[id] || (rows[id] = { pagado: 0, consumido: 0, enviado: 0, recibido: 0, saldo: 0 });
  (j.personas || []).forEach(p => ensure(p.id));
  let total = 0;
  gastos.forEach(g => {
    total += n0(g.total);
    (g.pagadores || []).forEach(x => { ensure(x.p).pagado += n0(x.c); });
    const d = division(g);
    Object.keys(d).forEach(p => { ensure(p).consumido += d[p]; });
  });
  pagos.forEach(x => { ensure(x.de).enviado += n0(x.c); ensure(x.a).recibido += n0(x.c); });
  Object.values(rows).forEach(r => { r.saldo = r.pagado - r.consumido + r.enviado - r.recibido; });
  return { rows, total, transfers: settle(rows) };
}

/* Minimiza transferencias: primero cruza quienes coinciden justo, después mayor deudor con mayor acreedor. */
function settle(rows) {
  const deb = [], cre = [];
  Object.keys(rows).forEach(id => {
    const s = rows[id].saldo;
    if (s < 0) deb.push({ id, v: -s });
    if (s > 0) cre.push({ id, v: s });
  });
  const res = [];
  deb.forEach(d => {
    const c = cre.find(x => x.v === d.v);
    if (c) { res.push({ de: d.id, a: c.id, c: d.v }); d.v = 0; c.v = 0; }
  });
  for (;;) {
    deb.sort((a, b) => b.v - a.v); cre.sort((a, b) => b.v - a.v);
    if (!deb[0] || !cre[0] || !deb[0].v || !cre[0].v) break;
    const m = Math.min(deb[0].v, cre[0].v);
    res.push({ de: deb[0].id, a: cre[0].id, c: m });
    deb[0].v -= m; cre[0].v -= m;
  }
  return res;
}

function fmt(c, moneda) {
  c = n0(c);
  const a = Math.abs(c);
  const body = new Intl.NumberFormat('es-AR', { minimumFractionDigits: a % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(a / 100);
  return (c < 0 ? '-' : '') + (MONEDAS[moneda] || '$') + ' ' + body;
}
function fechaTxt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}
function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ========== Informe: la misma fuente para la pantalla, WhatsApp y el PDF ========== */
function report(j, gastos, pagos) {
  const names = {}; (j.personas || []).forEach(p => { names[p.id] = p.nombre; });
  const nm = id => names[id] || 'Sin nombre';
  const money = c => fmt(c, j.moneda);
  const bal = compute(j, gastos, pagos);
  const lista = gastos.map(g => {
    const d = division(g);
    const pag = (g.pagadores || []);
    const pagoTxt = pag.length === 1 ? nm(pag[0].p) : pag.map(x => nm(x.p) + ' ' + money(x.c)).join(', ');
    let reparto = MODOS[g.modo] || 'Partes iguales';
    const sub = [];
    const quien = Object.keys(d).filter(k => d[k] > 0);
    if (g.modo === 'items') {
      (g.items || []).forEach(it => {
        const c = it.consumen || {};
        const ks = Object.keys(c).filter(k => c[k] > 0);
        const distintas = ks.some(k => c[k] !== 1);
        sub.push((it.nombre || 'Ítem') + ' ' + money(it.precio) + ': ' + ks.map(k => nm(k) + (distintas ? ' x' + c[k] : '')).join(', '));
      });
      if (g.propina) sub.push('Propina ' + money(g.propina));
      if (g.descuento) sub.push('Descuento -' + money(g.descuento));
    } else if (g.modo === 'iguales') {
      reparto += quien.length === (j.personas || []).length ? ' entre todos' : ' entre ' + quien.map(nm).join(', ');
    } else {
      sub.push(quien.map(k => nm(k) + ' ' + money(d[k])).join(' · '));
    }
    return { g, d, pagoTxt, reparto, sub };
  });
  const totalPendiente = bal.transfers.reduce((a, t) => a + t.c, 0);
  return { j, gastos, pagos, nm, money, bal, lista, totalPendiente, promedio: (j.personas || []).length ? Math.round(bal.total / j.personas.length) : 0 };
}

function whatsappText(r) {
  const { j, nm, money, bal } = r;
  const alias = {}; (j.personas || []).forEach(p => { alias[p.id] = p.alias; });
  const L = ['*' + j.nombre + '*' + (j.fecha ? ' · ' + fechaTxt(j.fecha) : '') + (j.lugar ? ' · ' + j.lugar : '')];
  L.push('Total: ' + money(bal.total) + ' entre ' + j.personas.length + ' personas', '');
  L.push('*Quién le paga a quién*');
  if (!bal.transfers.length) L.push('Está todo saldado.');
  bal.transfers.forEach(t => L.push('• ' + nm(t.de) + ' le pasa ' + money(t.c) + ' a ' + nm(t.a) + (alias[t.a] ? ' (alias: ' + alias[t.a] + ')' : '')));
  L.push('', '*Quién compró qué*');
  r.lista.forEach(x => L.push('• ' + x.g.desc + ': ' + money(x.g.total) + ' (pagó ' + x.pagoTxt + ')'));
  L.push('', '*Cuánto consumió cada uno*');
  j.personas.forEach(p => L.push('• ' + p.nombre + ': ' + money(bal.rows[p.id].consumido)));
  return L.join('\n');
}

/* ========== PDF ==========
   Generador propio con las fuentes estándar del formato: no depende de ninguna descarga para funcionar. */
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const WIN = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
function winBytes(str) {
  return Array.from(String(str == null ? '' : str)).map(ch => {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) return c;
    if (c >= 160 && c <= 255) return c;
    if (WIN[ch]) return WIN[ch];
    if (c === 10 || c === 9) return 32;
    const b = ch.normalize('NFD').charCodeAt(0);
    return b >= 32 && b < 127 ? b : 63;
  });
}
function textWidth(str, size, bold) {
  const t = bold ? W_BOLD : W_REG;
  return winBytes(str).reduce((a, b) => {
    let w = 556;
    if (b >= 32 && b < 127) w = t[b - 32];
    else if (b >= 160) { const base = String.fromCharCode(b).normalize('NFD').charCodeAt(0); if (base >= 32 && base < 127) w = t[base - 32]; }
    else if (b === 0x95) w = 350; else if (b === 0x97) w = 1000; else if (b === 0x91 || b === 0x92) w = 222;
    return a + w;
  }, 0) * size / 1000;
}
function wrapText(str, maxW, size, bold) {
  const lines = []; let cur = '';
  String(str == null ? '' : str).split(/\s+/).forEach(word => {
    while (textWidth(word, size, bold) > maxW && word.length > 1) {
      if (cur) { lines.push(cur); cur = ''; }
      let n = word.length - 1;
      while (n > 1 && textWidth(word.slice(0, n), size, bold) > maxW) n--;
      lines.push(word.slice(0, n)); word = word.slice(n);
    }
    const t = cur ? cur + ' ' + word : word;
    if (textWidth(t, size, bold) <= maxW) cur = t;
    else { lines.push(cur); cur = word; }
  });
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

function buildPdf(r) {
  const { j, nm, money, bal } = r;
  const PW = 595.28, PH = 841.89, M = 42, CW = PW - 2 * M, BOTTOM = PH - 46;
  const C = { ink: [.08, .14, .11], mute: [.34, .4, .36], line: [.82, .86, .81], green: [.08, .38, .29], red: [.7, .19, .19], tint: [.93, .96, .92], white: [1, 1, 1], pink: [.97, .72, .78], spot: [.11, .46, .35] };
  const pages = []; let ops, y;
  const f = n => (Math.round(n * 100) / 100).toString();
  const col = (c, op) => c.map(f).join(' ') + ' ' + op;
  const newPage = () => { ops = []; pages.push(ops); y = M; };
  const rect = (x, yy, w, h, c) => ops.push(col(c, 'rg') + ' ' + [x, PH - yy - h, w, h].map(f).join(' ') + ' re f');
  const line = (x1, yy, x2, c) => ops.push(col(c, 'RG') + ' .6 w ' + f(x1) + ' ' + f(PH - yy) + ' m ' + f(x2) + ' ' + f(PH - yy) + ' l S');
  const ellipse = (cx, cy, rx, ry, c) => {
    const k = .5523, Y = PH - cy;
    ops.push(col(c, 'rg') + ` ${f(cx - rx)} ${f(Y)} m ${f(cx - rx)} ${f(Y + ry * k)} ${f(cx - rx * k)} ${f(Y + ry)} ${f(cx)} ${f(Y + ry)} c ${f(cx + rx * k)} ${f(Y + ry)} ${f(cx + rx)} ${f(Y + ry * k)} ${f(cx + rx)} ${f(Y)} c ${f(cx + rx)} ${f(Y - ry * k)} ${f(cx + rx * k)} ${f(Y - ry)} ${f(cx)} ${f(Y - ry)} c ${f(cx - rx * k)} ${f(Y - ry)} ${f(cx - rx)} ${f(Y - ry * k)} ${f(cx - rx)} ${f(Y)} c f`);
  };
  const text = (s, x, yy, size, o = {}) => {
    const hex = winBytes(s).map(b => b.toString(16).padStart(2, '0')).join('');
    const xx = o.right ? x - textWidth(s, size, o.bold) : x;
    ops.push(`BT /${o.bold ? 'F2' : 'F1'} ${f(size)} Tf ${col(o.color || C.ink, 'rg')} ${f(xx)} ${f(PH - yy)} Td <${hex}> Tj ET`);
  };
  const section = (title, need) => {
    if (y + 24 + (need || 44) > BOTTOM) newPage();
    y += 16;
    text(title, M, y, 12.5, { bold: true, color: C.green });
    y += 8;
  };
  const table = (cols, rows) => {
    const head = () => {
      rect(M, y, CW, 18, C.tint);
      let x = M;
      cols.forEach(c => {
        text(c.t.toUpperCase(), c.right ? x + c.w - 6 : x + 6, y + 12, 7, { bold: true, color: C.mute, right: c.right });
        x += c.w;
      });
      y += 18;
    };
    head();
    rows.forEach(row => {
      const cells = row.cells.map((v, i) => {
        const o = v && typeof v === 'object' ? v : { v };
        return { ...o, lines: wrapText(o.v, cols[i].w - 12, 9, o.bold) };
      });
      const subs = (row.sub || []).flatMap(s => wrapText(s, CW - 24, 7.8));
      const hh = Math.max(...cells.map(c => c.lines.length)) * 11.5 + subs.length * 10 + 11;
      if (y + hh > BOTTOM) { newPage(); head(); }
      let x = M;
      cells.forEach((c, i) => {
        c.lines.forEach((l, n) => text(l, cols[i].right ? x + cols[i].w - 6 : x + 6, y + 13 + n * 11.5, 9, { bold: c.bold, color: c.color, right: cols[i].right }));
        x += cols[i].w;
      });
      const base = y + 13 + Math.max(...cells.map(c => c.lines.length)) * 11.5 - 1;
      subs.forEach((s, n) => text(s, M + 14, base + n * 10, 7.8, { color: C.mute }));
      y += hh;
      line(M, y, M + CW, C.line);
    });
  };

  /* Encabezado */
  newPage();
  const bandH = 106;
  rect(0, 0, PW, bandH, C.green);
  ellipse(PW - 58, 34, 46, 30, C.spot); ellipse(PW - 142, 76, 26, 17, C.spot); ellipse(PW - 14, 94, 26, 20, C.spot); ellipse(PW - 196, 24, 15, 10, C.spot);
  text('VAQUITA  ·  RESUMEN DE JUNTADA', M, 32, 8, { bold: true, color: C.pink });
  const titleLines = wrapText(j.nombre, CW - 150, 22, true).slice(0, 2);
  titleLines.forEach((l, i) => text(l, M, 56 + i * 24, 22, { bold: true, color: C.white }));
  const meta = [fechaTxt(j.fecha), j.lugar, j.personas.length + ' personas'].filter(Boolean).join('  ·  ');
  text(wrapText(meta, CW - 120, 9.5)[0], M, bandH - 12, 9.5, { color: C.white });
  y = bandH + 26;

  /* Cifras */
  const stats = [['Total gastado', money(bal.total)], ['Promedio por persona', money(r.promedio)], ['Falta transferir', money(r.totalPendiente)]];
  stats.forEach((s, i) => {
    const x = M + i * (CW / 3);
    text(s[0].toUpperCase(), x, y, 7, { bold: true, color: C.mute });
    text(s[1], x, y + 18, 14.5, { bold: true });
  });
  y += 28;

  section('Quién le paga a quién');
  if (!bal.transfers.length) {
    y += 8; text(r.gastos.length ? 'Está todo saldado. No hace falta ninguna transferencia.' : 'Todavía no hay gastos cargados.', M, y + 6, 10); y += 14;
  } else {
    const alias = {}; j.personas.forEach(p => { alias[p.id] = p.alias; });
    table([{ t: 'Paga', w: 120 }, { t: 'Le pasa a', w: 120 }, { t: 'Alias para transferir', w: CW - 330 }, { t: 'Monto', w: 90, right: true }],
      bal.transfers.map(t => ({ cells: [{ v: nm(t.de), bold: true }, { v: nm(t.a), bold: true }, alias[t.a] || '-', { v: money(t.c), bold: true, color: C.green }] })));
  }

  section('Balance por persona');
  table([{ t: 'Persona', w: CW - 340 }, { t: 'Pagó', w: 80, right: true }, { t: 'Consumió', w: 80, right: true }, { t: 'Pagos hechos', w: 80, right: true }, { t: 'Saldo', w: 100, right: true }],
    j.personas.map(p => {
      const b = bal.rows[p.id], neto = b.enviado - b.recibido;
      return { cells: [{ v: p.nombre, bold: true }, money(b.pagado), money(b.consumido), neto ? (neto > 0 ? '+' : '') + money(neto) : '-',
        b.saldo === 0 ? { v: 'Al día', color: C.mute } : { v: (b.saldo > 0 ? 'Recibe ' : 'Debe ') + money(Math.abs(b.saldo)), bold: true, color: b.saldo > 0 ? C.green : C.red }] };
    }));

  section('Quién compró qué');
  if (!r.lista.length) { y += 8; text('Sin gastos cargados.', M, y + 6, 10); y += 14; }
  else table([{ t: 'Gasto', w: CW - 300 }, { t: 'Pagó', w: 110 }, { t: 'Cómo se dividió', w: 110 }, { t: 'Total', w: 80, right: true }],
    r.lista.map(x => ({ cells: [{ v: x.g.desc, bold: true }, x.pagoTxt, x.reparto, { v: money(x.g.total), bold: true }], sub: x.sub })));

  section('Qué le tocó a cada uno');
  table([{ t: 'Persona', w: 110 }, { t: 'Detalle', w: CW - 200 }, { t: 'Consumió', w: 90, right: true }],
    j.personas.map(p => ({ cells: [{ v: p.nombre, bold: true },
      r.lista.filter(x => x.d[p.id] > 0).map(x => x.g.desc + ' ' + money(x.d[p.id])).join('  ·  ') || 'Nada',
      { v: money(bal.rows[p.id].consumido), bold: true }] })));

  if (r.pagos.length) {
    section('Pagos ya registrados');
    table([{ t: 'Fecha', w: 80 }, { t: 'Pagó', w: 140 }, { t: 'Recibió', w: CW - 310 }, { t: 'Monto', w: 90, right: true }],
      r.pagos.map(x => ({ cells: [fechaTxt(x.fecha) || '-', nm(x.de), nm(x.a), { v: money(x.c), bold: true }] })));
  }

  pages.forEach((p, i) => {
    ops = p;
    line(M, PH - 32, M + CW, C.line);
    text('Generado con Vaquita el ' + fechaTxt(hoy()), M, PH - 20, 7.5, { color: C.mute });
    text('Página ' + (i + 1) + ' de ' + pages.length, M + CW, PH - 20, 7.5, { color: C.mute, right: true });
  });

  /* Armado del archivo: sólo ASCII, así que cada carácter es un byte */
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = pages.map(p => {
    const body = p.join('\n');
    const c = add('<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream');
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`);
  });
  objs[1] = '<< /Type /Pages /Count ' + kids.length + ' /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] >>';
  const hexTitle = winBytes(j.nombre).map(b => b.toString(16).padStart(2, '0')).join('');
  const info = add('<< /Title <' + hexTitle + '> /Producer (Vaquita) >>');
  let out = '%PDF-1.4\n';
  const off = objs.map((o, i) => { const at = out.length; out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; return at; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}


/* ========== Validación: el servidor sólo guarda lo que cierra ========== */
const RE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const esCent = v => Number.isSafeInteger(v) && v >= 0 && v <= 1e13;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function limpiarJuntada(d) {
  if (!d || typeof d !== 'object') return { error: 'Faltan los datos de la juntada.' };
  const nombre = str(d.nombre, 120);
  if (!nombre) return { error: 'Falta ponerle un nombre a la juntada.' };
  if (d.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return { error: 'La fecha no es válida.' };
  if (!MONEDAS[d.moneda] || !Object.prototype.hasOwnProperty.call(MONEDAS, d.moneda)) return { error: 'La moneda no es válida.' };
  if (!Array.isArray(d.personas) || d.personas.length < 2 || d.personas.length > 60) return { error: 'Una juntada necesita entre 2 y 60 personas.' };
  const ids = new Set(), nombres = new Set();
  const personas = [];
  for (const p of d.personas) {
    const n = str(p && p.nombre, 60);
    if (!n || !RE_ID.test(String(p.id))) return { error: 'Hay una persona sin nombre.' };
    if (ids.has(p.id) || nombres.has(n.toLowerCase())) return { error: n + ' está dos veces.' };
    ids.add(p.id); nombres.add(n.toLowerCase());
    personas.push({ id: p.id, nombre: n, alias: str(p.alias, 80) });
  }
  return { doc: { nombre, fecha: d.fecha || '', lugar: str(d.lugar, 120), moneda: d.moneda, personas, creado: n0(d.creado) || Date.now() } };
}
function limpiarGasto(d, j) {
  if (!d || typeof d !== 'object') return { error: 'Faltan los datos del gasto.' };
  const ids = new Set((j.personas || []).map(p => p.id));
  const desc = str(d.desc, 160);
  if (!desc) return { error: 'Falta contar qué fue el gasto.' };
  if (!Object.prototype.hasOwnProperty.call(MODOS, d.modo)) return { error: 'La forma de dividir no es válida.' };
  const g = { desc, cat: CATS.includes(d.cat) ? d.cat : 'Otros', modo: d.modo, total: d.total, pagadores: [], participantes: [], valores: {}, items: [], propina: 0, descuento: 0, creado: n0(d.creado) || Date.now() };
  if (!esCent(g.total) || g.total <= 0) return { error: 'El total del gasto no es válido.' };
  const conocido = k => ids.has(k);
  const valores = d.valores && typeof d.valores === 'object' ? d.valores : {};
  if (g.modo === 'iguales') {
    if (!Array.isArray(d.participantes) || !d.participantes.length || !d.participantes.every(conocido)) return { error: 'Elegí entre quiénes se divide el gasto.' };
    g.participantes = Array.from(new Set(d.participantes));
  } else if (g.modo === 'items') {
    if (!Array.isArray(d.items) || !d.items.length || d.items.length > 200) return { error: 'Agregá al menos un ítem.' };
    let sub = 0;
    for (const it of d.items) {
      const consumen = {}, c = (it && it.consumen) || {};
      for (const k of Object.keys(c)) {
        if (!conocido(k) || typeof c[k] !== 'number' || !(c[k] > 0) || c[k] > 1e4) return { error: 'Un ítem tiene una asignación que no es válida.' };
        consumen[k] = c[k];
      }
      if (!esCent(it.precio) || it.precio <= 0 || !Object.keys(consumen).length) return { error: 'Cada ítem necesita un precio y alguien que lo haya consumido.' };
      if (!RE_ID.test(String(it.id))) return { error: 'Un ítem no es válido.' };
      sub += it.precio;
      g.items.push({ id: it.id, nombre: str(it.nombre, 120), precio: it.precio, consumen });
    }
    g.propina = esCent(d.propina) ? d.propina : 0;
    g.descuento = esCent(d.descuento) ? d.descuento : 0;
    if (sub + g.propina - g.descuento !== g.total) return { error: 'El total no coincide con los ítems.' };
  } else {
    let suma = 0;
    for (const k of Object.keys(valores)) {
      const v = valores[k];
      const ok = g.modo === 'montos' ? esCent(v) && v > 0 : typeof v === 'number' && v > 0 && v <= 1e6;
      if (!conocido(k) || !ok) return { error: 'Hay un valor del reparto que no es válido.' };
      g.valores[k] = v; suma += v;
    }
    if (!suma) return { error: 'Asigná el gasto a alguien.' };
    if (g.modo === 'montos' && suma !== g.total) return { error: 'Los montos no suman el total.' };
    if (g.modo === 'porcentajes' && Math.abs(suma - 100) > .001) return { error: 'Los porcentajes tienen que sumar 100.' };
  }
  if (!Array.isArray(d.pagadores) || !d.pagadores.length) return { error: 'Falta indicar quién pagó.' };
  let pagado = 0;
  for (const x of d.pagadores) {
    if (!x || !conocido(x.p) || !esCent(x.c) || x.c <= 0) return { error: 'Falta indicar bien quién pagó.' };
    g.pagadores.push({ p: x.p, c: x.c }); pagado += x.c;
  }
  if (pagado !== g.total) return { error: 'Lo pagado no coincide con el total.' };
  const rep = Object.values(division(g)).reduce((a, b) => a + b, 0);
  if (rep !== g.total) return { error: 'El reparto no coincide con el total.' };
  return { doc: g };
}
function limpiarPago(d, j) {
  const ids = new Set((j.personas || []).map(p => p.id));
  if (!d || !ids.has(d.de) || !ids.has(d.a) || d.de === d.a) return { error: 'Elegí dos personas distintas.' };
  if (!esCent(d.c) || d.c <= 0) return { error: 'El monto del pago no es válido.' };
  return { doc: { de: d.de, a: d.a, c: d.c, fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : hoy(), creado: n0(d.creado) || Date.now() } };
}
function nombreArchivo(j) {
  const base = String(j.nombre || 'juntada').normalize('NFD').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 80) || 'juntada';
  return 'Vaquita - ' + base + (j.fecha ? ' - ' + j.fecha : '') + '.pdf';
}
return { MONEDAS, CATS, MODO_CORTO, MODOS, parseMoney, parseNum, toInput, allocate, n0, division, compute, settle, fmt, fechaTxt, hoy, uid, report, whatsappText, buildPdf, limpiarJuntada, limpiarGasto, limpiarPago, nombreArchivo };
});
