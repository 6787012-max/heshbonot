// עזרי ממשק. אין innerHTML: כל טקסט נכנס דרך textContent (הגנת XSS).
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'selected') el.selected = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (s, r = document) => r.querySelector(s);

export function toast(msg, kind = 'ok') {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind, text: msg });
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 8000 : 3500);
}

export function modal(title, body, actions = []) {
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('h3', { text: title }), h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-actions' }, actions.map((a) => h('button', { class: 'btn ' + (a.class || ''), onclick: () => a.onclick(close), text: a.text }))));
  back.append(box);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return close;
}
export function confirmBox(title, text) {
  return new Promise((res) => {
    const c = modal(title, h('p', { text }), [
      { text: 'ביטול', onclick: (cl) => { cl(); res(false); } },
      { text: 'אישור', class: 'primary', onclick: (cl) => { cl(); res(true); } },
    ]);
  });
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'lbl', text: label }), input, hint ? h('span', { class: 'hint', text: hint }) : null);
}
export function select(opts, value, attrs = {}) {
  const s = h('select', attrs);
  for (const [v, t] of opts) s.append(h('option', { value: v, text: t, selected: String(v) === String(value) }));
  return s;
}
export function table(cols, rows, opts = {}) {
  const t = h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.num ? 'num' : '', text: c.label })))),
    h('tbody', null, rows.length ? rows.map((r) => h('tr', { class: opts.rowClass ? opts.rowClass(r) : '', onclick: opts.onRow ? () => opts.onRow(r) : null },
      cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : r[c.key] ?? '')))) :
      h('tr', null, h('td', { colspan: cols.length, class: 'empty', text: opts.empty || 'אין נתונים להצגה' }))));
  return h('div', { class: 'tbl-wrap' }, t);
}

export function downloadBlob(name, data, type) {
  const blob = new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function csvEscape(v) {
  const s = String(v ?? '');
  const safe = /^[=+\-@]/.test(s) && isNaN(Number(s)) ? "'" + s : s;   // מניעת הזרקת נוסחאות באקסל
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}
export function toCSV(headers, rows) {
  return '﻿' + [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
}

export function topbar(title, ...actions) {
  return h('div', { class: 'topbar' },
    h('button', { class: 'btn burger no-print', 'aria-label': 'תפריט', text: '☰', onclick: () => document.querySelector('#side').classList.toggle('open') }),
    h('h1', { text: title }), ...actions);
}

