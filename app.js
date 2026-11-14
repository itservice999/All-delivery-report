'use strict';
(() => {
const CFG = window.APP_CONFIG || {};
const BUCKET = 'delivery-images';
const IDLE_MS = 30 * 60 * 1000;
const root = document.getElementById('root');
const modals = document.getElementById('modals');
let sb = null;
const state = {
  user: null, isAdmin: false, roster: [], cases: [],
  filters: { from: '', to: '', q: '' }, view: 'list', arg: null, token: 0
};

/* ============================ helpers ============================ */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.length > 2 && k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const fixThai = s => clean(s).replace(/([ัิ-ฺ็-๎])\1+/g, '$1');
const errMsg = e => (e && (e.message || e.error_description)) || String(e);
const deep = o => JSON.parse(JSON.stringify(o));
const pad2 = n => String(n).padStart(2, '0');

function toast(msg, err) {
  const t = h('div', { class: 't' + (err ? ' err' : '') }, msg);
  document.getElementById('toast').append(t);
  setTimeout(() => t.remove(), err ? 7000 : 2800);
}

function openModal({ title, body, footer, wide, onClose }) {
  const close = () => { ov.remove(); if (onClose) onClose(); };
  const ov = h('div', { class: 'overlay' },
    h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-h' }, h('h2', null, title),
        h('button', { class: 'x', 'aria-label': 'ปิด', onClick: close }, '×')),
      h('div', { class: 'modal-b' }, body),
      footer ? h('div', { class: 'modal-f' }, footer) : null));
  modals.append(ov);
  return { close, el: ov };
}

function confirmDialog({ title, lines, okText = 'ยืนยัน', danger = false }) {
  return new Promise(res => {
    let m;
    const done = v => { res(v); m.close(); };
    m = openModal({
      title,
      body: lines.map(l => h('div', null, l)),
      footer: [
        h('button', { class: 'btn', onClick: () => done(false) }, 'ยกเลิก'),
        h('button', { class: 'btn ' + (danger ? 'warn' : 'pri'), onClick: () => done(true) }, okText)
      ],
      onClose: () => res(false)
    });
  });
}

/* ---- วันที่ (พ.ศ. แสดงเอง ไม่พึ่ง locale ของเครื่อง) ---- */
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function fmtDate(iso, full) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${d} ${(full ? TH_MONTHS : TH_SHORT)[m - 1]} ${y + 543}`;
}
function mkIso(y, m, d) {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function monthIndex(t) {
  t = t.replace(/\./g, '');
  let i = TH_MONTHS.findIndex(x => x === t);
  if (i < 0) i = TH_SHORT.findIndex(x => x.replace(/\./g, '') === t);
  return i;
}
function parseThaiDate(s) {
  s = String(s || '');
  let m = s.match(/(\d{1,2})\s*([ก-๙.]{2,})\s*(\d{4})/);
  if (m) {
    const mi = monthIndex(m[2]);
    if (mi >= 0) { let y = +m[3]; if (y > 2400) y -= 543; return mkIso(y, mi + 1, +m[1]); }
  }
  m = s.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) { let y = +m[3]; if (y > 2400) y -= 543; return mkIso(y, +m[2], +m[1]); }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return mkIso(+m[1], +m[2], +m[3]);
  return '';
}
function todayISO(offsetDays = 0) {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
// สัปดาห์ของทีม: พฤหัส–พุธ
function weekRange(back = 0) {
  const t = todayISO();
  const [y, m, d] = t.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const start = addDaysISO(t, -((dow - 4 + 7) % 7) - 7 * back);
  return [start, addDaysISO(start, 6)];
}

/* ---- รูป ---- */
async function shrinkImage(blob, maxW = 1000) {
  const bmp = await createImageBitmap(blob);
  const sc = Math.min(1, maxW / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * sc));
  c.height = Math.max(1, Math.round(bmp.height * sc));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('แปลงรูปไม่สำเร็จ')), 'image/jpeg', 0.85));
}
const blobToDataURL = b => new Promise((res, rej) => {
  const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b);
});

/* ============================ API (Supabase) ============================ */
const api = {
  async listCases({ from, to }) {
    let q = sb.from('dr_case_summary').select('*');
    if (from) q = q.gte('done_date', from);
    if (to) q = q.lte('done_date', to);
    const { data, error } = await q.order('done_date', { ascending: false }).limit(1000);
    if (error) throw error;
    return data;
  },
  async getCase(id) {
    const [c, r] = await Promise.all([
      sb.from('dr_cases').select('*').eq('id', id).single(),
      sb.from('dr_case_rows').select('*').eq('case_id', id).order('row_order')
    ]);
    if (c.error) throw c.error;
    if (r.error) throw r.error;
    return { ...c.data, rows: r.data };
  },
  async saveCase(p) {
    const { data, error } = await sb.rpc('dr_save_case', {
      p_id: p.id || null, p_brand: p.brand, p_media_name: p.media_name, p_job_no: p.job_no || '',
      p_received: p.received_date, p_done: p.done_date, p_reporter: p.reporter,
      p_image_path: p.image_path || null, p_rows: p.rows.map(cleanRow)
    });
    if (error) throw error;
    return data;
  },
  async uploadImage(blob) {
    const path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    return path;
  },
  async downloadImage(path) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error) throw error;
    return data;
  },
  async rosterList() {
    const { data, error } = await sb.from('dr_roster').select('*').order('id').limit(5000);
    if (error) throw error;
    return data;
  },
  async rosterInsert(rows) {
    const { error } = await sb.from('dr_roster').insert(rows);
    if (error) throw error;
  },
  async rosterUpdate(id, row) {
    const { error } = await sb.from('dr_roster').update(row).eq('id', id);
    if (error) throw error;
  },
  async rosterDelete(id) {
    const { error } = await sb.from('dr_roster').delete().eq('id', id);
    if (error) throw error;
  }
};
function cleanRow(r) {
  return {
    store_no: r.store_no ?? null, store_name: r.store_name || '', province: r.province || '',
    screen_count: r.screen_count ?? 1, screen_type: r.screen_type || '', device_id: r.device_id || '',
    screen_status: r.screen_status || '', success: !!r.success, fail: !!r.fail, note: r.note || ''
  };
}
async function refreshRoster() { try { state.roster = await api.rosterList(); } catch (e) { toast('โหลดรายชื่อร้านไม่สำเร็จ: ' + errMsg(e), true); } }
async function refreshCases() {
  try { state.cases = await api.listCases({}); } catch (e) { /* รายการหลักจะแจ้งเอง */ }
}
async function loadImage(path) {
  if (!path) return {};
  try { const blob = await api.downloadImage(path); return { imageBlob: blob, imgSrc: await blobToDataURL(blob) }; }
  catch (e) { return {}; }
}

/* ============================ ตารางแบบชีต ============================ */
function sameStore(a, b) {
  return a.store_no != null && a.store_no === b.store_no && a.province === b.province && a.store_name === b.store_name;
}
function groupSpans(rows) {
  const spans = []; let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && sameStore(rows[i], rows[j])) j++;
    spans.push([i, j - i]); i = j;
  }
  return spans;
}
function countRows(rows) {
  let ok = 0, bad = 0;
  for (const r of rows) { if (r.success) ok++; else if (r.fail) bad++; }
  return { ok, bad, none: rows.length - ok - bad, total: rows.length };
}

function rowsTable(rows, { editable = false, onChange, media } = {}) {
  const pairs = [];
  const starts = new Map(groupSpans(rows));
  const head1 = h('tr', null,
    ...['No.', 'Store Name', 'จำนวนจอ', 'จังหวัด', 'ประเภทจอ', 'Device ID', 'สถานะจอ'].map(t => h('th', { rowspan: 2 }, t)),
    media ? h('th', { colspan: 2 }, h('div', null, media.media_name), h('div', null, `${media.job_no || ''} (เลขงาน)`)) : null,
    h('th', { colspan: 2 }, 'สถานะการอัพสื่อ'),
    h('th', { rowspan: 2 }, 'หมายเหตุ'));
  const head2 = h('tr', null,
    media ? h('th', null, 'วันที่รับแจ้ง', h('br'), `(${fmtDate(media.received_date, true)})`) : null,
    media ? h('th', null, 'วันที่ดำเนินการเสร็จ', h('br'), `(${fmtDate(media.done_date, true)})`) : null,
    h('th', null, 'สำเร็จ'), h('th', null, 'ไม่สำเร็จ'));
  const tb = h('tbody');
  const mediaSpan = Math.min(5, rows.length);
  rows.forEach((r, i) => {
    const tr = h('tr');
    if (starts.has(i)) {
      const sp = starts.get(i);
      tr.append(h('td', { rowspan: sp }, r.store_no ?? ''), h('td', { rowspan: sp, class: 'l' }, r.store_name));
    }
    tr.append(h('td', null, r.screen_count), h('td', null, r.province), h('td', null, r.screen_type),
      h('td', null, r.device_id), h('td', { class: 'online' }, r.screen_status));
    if (media) {
      if (i === 0) tr.append(h('td', { colspan: 2, rowspan: mediaSpan, class: 'mediacell' },
        media.imgSrc ? h('img', { src: media.imgSrc, alt: 'รูปสื่อ' }) : h('span', { class: 'muted' }, '(ไม่มีรูป)')));
      else if (i >= mediaSpan) tr.append(h('td', { colspan: 2 }));
    }
    const ro = editable ? {} : { tabindex: -1, 'aria-readonly': 'true', onClick: e => e.preventDefault() };
    const cs = h('input', { type: 'checkbox', class: 'cb ok', checked: !!r.success, 'aria-label': 'สำเร็จ', ...ro });
    const cf = h('input', { type: 'checkbox', class: 'cb bad', checked: !!r.fail, 'aria-label': 'ไม่สำเร็จ', ...ro });
    pairs.push([cs, cf, r]);
    if (editable) {
      cs.addEventListener('change', () => { r.success = cs.checked; if (cs.checked) { r.fail = false; cf.checked = false; } if (onChange) onChange(); });
      cf.addEventListener('change', () => { r.fail = cf.checked; if (cf.checked) { r.success = false; cs.checked = false; } if (onChange) onChange(); });
    }
    tr.append(h('td', null, cs), h('td', null, cf));
    tr.append(h('td', { class: 'l' }, editable
      ? h('input', { type: 'text', maxlength: 500, value: r.note || '', 'aria-label': 'หมายเหตุ', onInput: e => { r.note = e.target.value; } })
      : (r.note || '')));
    tb.append(tr);
  });
  const wrap = h('div', { class: 'tablewrap' }, h('table', { class: 'sheet' }, h('thead', null, head1, head2), tb));
  wrap.refresh = () => pairs.forEach(([cs, cf, r]) => { cs.checked = !!r.success; cf.checked = !!r.fail; });
  return wrap;
}

/* ============================ Export Excel (หน้าตาเหมือนชีตเดิม) ============================ */
function sheetName(base, used) {
  let n = base.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'sheet';
  let k = 2, cand = n;
  while (used.has(cand.toLowerCase())) { const suf = ` (${k++})`; cand = n.slice(0, 31 - suf.length) + suf; }
  used.add(cand.toLowerCase());
  return cand;
}
async function buildWorkbook(items) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'รีพอร์ตส่งสื่อ';
  const used = new Set();
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  const thin = { style: 'thin', color: { argb: 'FF9E9E9E' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  for (const it of items) {
    const c = it.case, rows = it.rows;
    const rd = c.received_date;
    const ws = wb.addWorksheet(sheetName(`${rd.slice(8, 10)}-${rd.slice(5, 7)}-${rd.slice(2, 4)} ${c.media_name}`, used),
      { views: [{ state: 'frozen', ySplit: 2 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [6, 26, 10, 18, 12, 16, 12, 22, 22, 10, 10, 34].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ['No.', 'Store Name', 'จำนวนจอ', 'จังหวัด', 'ประเภทจอ', 'Device ID', 'สถานะจอ'].forEach((t, i) => {
      ws.mergeCells(1, i + 1, 2, i + 1); ws.getCell(1, i + 1).value = t;
    });
    ws.mergeCells('H1:I1'); ws.getCell('H1').value = `${c.media_name}\n${c.job_no || ''} (เลขงาน)`;
    ws.getCell('H2').value = `วันที่รับแจ้ง\n(${fmtDate(c.received_date, true)})`;
    ws.getCell('I2').value = `วันที่ดำเนินการเสร็จ\n(${fmtDate(c.done_date, true)})`;
    ws.mergeCells('J1:K1'); ws.getCell('J1').value = 'สถานะการอัพสื่อ';
    ws.getCell('J2').value = 'สำเร็จ'; ws.getCell('K2').value = 'ไม่สำเร็จ';
    ws.mergeCells('L1:L2'); ws.getCell('L1').value = 'หมายเหตุ';
    for (let r = 1; r <= 2; r++) for (let col = 1; col <= 12; col++) {
      const cell = ws.getCell(r, col);
      cell.fill = fill; cell.border = border; cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    ws.getRow(1).height = 36; ws.getRow(2).height = 40;

    const total = Math.max(rows.length, 5);
    for (let i = 0; i < total; i++) {
      const rn = 3 + i, r = rows[i];
      ws.getRow(rn).height = 26;
      const vals = r
        ? [r.store_no ?? '', r.store_name, r.screen_count, r.province, r.screen_type, r.device_id, r.screen_status, '', '', r.success ? '☑' : '☐', r.fail ? '☑' : '☐', r.note || '']
        : new Array(12).fill('');
      vals.forEach((v, k) => {
        const cell = ws.getCell(rn, k + 1);
        cell.value = v === '' ? null : v; cell.border = border;
        cell.alignment = { horizontal: k === 11 ? 'left' : 'center', vertical: 'middle', wrapText: true };
        cell.font = { size: 11 };
      });
      if (r) {
        ws.getCell(rn, 7).font = { size: 11, bold: true, italic: true, color: { argb: 'FF1E8E5A' } };
        ws.getCell(rn, 10).font = { size: 16, name: 'Segoe UI Symbol', color: { argb: 'FF1E8E5A' } };
        ws.getCell(rn, 11).font = { size: 16, name: 'Segoe UI Symbol', color: { argb: 'FFC93434' } };
      }
    }
    for (const [i, sp] of groupSpans(rows)) if (sp > 1) {
      ws.mergeCells(3 + i, 1, 3 + i + sp - 1, 1);
      ws.mergeCells(3 + i, 2, 3 + i + sp - 1, 2);
    }
    ws.mergeCells(3, 8, 7, 9);
    if (it.imageBlob) {
      try {
        const bmp = await createImageBitmap(it.imageBlob);
        const sc = Math.min(290 / bmp.width, 165 / bmp.height);
        const ext = /png/i.test(it.imageBlob.type) ? 'png' : 'jpeg';
        const id = wb.addImage({ buffer: await it.imageBlob.arrayBuffer(), extension: ext });
        ws.addImage(id, { tl: { col: 7.04, row: 2.05 }, ext: { width: Math.round(bmp.width * sc), height: Math.round(bmp.height * sc) }, editAs: 'oneCell' });
      } catch (e) { /* ไม่มีรูปก็ยังส่งออกได้ */ }
    }
  }
  return wb;
}
function safeName(s) { return String(s).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80); }
function saveBlob(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function exportItems(items, filename) {
  const wb = await buildWorkbook(items);
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

/* ============================ อ่านไฟล์ชีตเดิม (Import) ============================ */
function ctext(cell) {
  let v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(x => x.text).join('');
    if ('result' in v) v = v.result; else if ('text' in v) v = v.text;
    if (v == null) return '';
  }
  return String(v);
}
function cbool(cell) {
  let v = cell.value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  return v === true || v === 1 || (typeof v === 'string' && /^(true|yes|y|1|✓|✔|☑|x)$/i.test(v.trim()));
}
function parseSheet(wb, ws) {
  if (ws.rowCount < 3) return null;
  const warnings = [];
  const lines = ctext(ws.getCell('H1')).split(/\r?\n/).map(clean).filter(Boolean);
  let job_no = '', media = '';
  for (const ln of lines) {
    const m = ln.match(/([A-Za-z]{2,}\s*-?\s*\d+)/);
    if (m && !job_no) job_no = m[1].replace(/\s+/g, '');
    else if (!media && !/เลขงาน/.test(ln)) media = ln;
  }
  if (media && !media.includes('(')) media = clean(media.replace(/\)\s*$/, ''));
  if (!media) { media = ws.name || ''; warnings.push('ไม่พบชื่อสื่อในหัวตาราง ใช้ชื่อแท็บแทน กรุณาตรวจ'); }
  const received_date = parseThaiDate(ctext(ws.getCell('H2')));
  const done_date = parseThaiDate(ctext(ws.getCell('I2')));
  if (!received_date) warnings.push('อ่านวันที่รับแจ้งไม่ได้ กรุณากรอกเอง');
  if (!done_date) warnings.push('อ่านวันที่เสร็จไม่ได้ กรุณากรอกเอง');

  const rows = []; let prevNo = null, fixed = 0, both = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const g = c => ws.getCell(r, c);
    const store = clean(ctext(g(2))), cnt = clean(ctext(g(3))), prov = ctext(g(4)), type = clean(ctext(g(5)));
    if (!store && !cnt && !clean(prov) && !type) continue;
    const noText = clean(ctext(g(1)));
    let store_no = noText !== '' && !isNaN(+noText) ? Math.trunc(+noText) : null;
    if (store_no == null) store_no = prevNo; else prevNo = store_no;
    const province = fixThai(prov);
    if (province !== clean(prov)) fixed++;
    let success = cbool(g(10)), fail = cbool(g(11));
    if (success && fail) { both++; success = false; }
    const n = parseInt(cnt, 10);
    rows.push({
      store_no, store_name: store, screen_count: Number.isFinite(n) ? Math.min(99, Math.max(0, n)) : 1,
      province, screen_type: type || 'ไม่ระบุ', device_id: clean(ctext(g(6))), screen_status: clean(ctext(g(7))),
      success, fail, note: clean(ctext(g(12)))
    });
  }
  if (!rows.length) return null;
  if (fixed) warnings.push(`แก้ตัวสะกดซ้ำในชื่อจังหวัดให้อัตโนมัติ ${fixed} แถว (เช่น "อุดรธานีี")`);
  if (both) warnings.push(`มี ${both} แถวที่ติ๊กทั้งสำเร็จและไม่สำเร็จ ระบบถือเป็น "ไม่สำเร็จ"`);
  let blob = null;
  try {
    const imgs = ws.getImages();
    if (imgs.length) {
      const im = wb.getImage(imgs[0].imageId);
      const ext = String(im.extension || 'jpeg').replace('jpg', 'jpeg');
      blob = new Blob([im.buffer], { type: 'image/' + ext });
      if (imgs.length > 1) warnings.push(`พบรูป ${imgs.length} รูป ใช้รูปแรกเท่านั้น`);
    } else warnings.push('ไม่พบรูปสื่อในแท็บนี้');
  } catch (e) { warnings.push('อ่านรูปไม่สำเร็จ'); }
  return { name: ws.name, include: true, brand: '', media_name: media, job_no, received_date, done_date, reporter: '', rows, blob, warnings };
}
async function parseWorkbook(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 20 MB');
  if (!/\.xlsx$/i.test(file.name)) throw new Error('รองรับเฉพาะไฟล์ .xlsx (ใน Google Sheet: ไฟล์ > ดาวน์โหลด > Microsoft Excel)');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const out = [];
  for (const ws of wb.worksheets.slice(0, 60)) { const s = parseSheet(wb, ws); if (s) out.push(s); }
  return out;
}

/* ============================ ส่วนหน้าจอ ============================ */
function field(label, input) { return h('label', { class: 'f' }, label, input); }
function go(view, arg) { state.view = view; state.arg = arg ?? null; render(); }

function navBtn(label, view, extra) {
  return h('button', { class: 'btn' + (state.view === view ? ' on' : ''), onClick: () => go(view) }, label, extra);
}

function shell(content) {
  return h('div', null,
    h('header', null,
      h('h1', null, 'รีพอร์ตส่งสื่อ'),
      navBtn('รายการ', 'list'), navBtn('+ เพิ่มสื่อ', 'form'), navBtn('นำเข้าจากชีต', 'import'), navBtn('ตั้งค่าร้าน', 'roster'),
      h('span', { class: 'sp' }),
      h('span', { class: 'who' }, state.user.email + (state.isAdmin ? ' (admin)' : '')),
      h('button', { class: 'btn', onClick: logout }, 'ออกจากระบบ')),
    h('main', null, content));
}

async function render() {
  const my = ++state.token;
  if (!state.user) return renderLogin();
  const holder = h('div', null, h('p', { class: 'muted' }, 'กำลังโหลด…'));
  root.replaceChildren(shell(holder));
  try {
    const v = state.view;
    const el = v === 'detail' ? await viewDetail(state.arg)
      : v === 'form' ? await viewForm(state.arg)
      : v === 'import' ? await viewImport()
      : v === 'roster' ? await viewRoster()
      : await viewList();
    if (my !== state.token) return;
    holder.replaceChildren(el);
    window.scrollTo(0, 0);
  } catch (e) {
    if (my !== state.token) return;
    holder.replaceChildren(h('div', { class: 'note warn' }, 'เกิดข้อผิดพลาด: ' + errMsg(e)));
  }
}

/* ---------- ล็อกอิน ---------- */
function renderLogin(msg) {
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', maxlength: 200 });
  const pass = h('input', { type: 'password', required: true, autocomplete: 'current-password', maxlength: 200 });
  const err = h('div', { class: 'note warn', style: 'display:none' });
  const btn = h('button', { class: 'btn pri', type: 'submit' }, 'เข้าสู่ระบบ');
  const form = h('form', { onSubmit: async e => {
    e.preventDefault();
    btn.disabled = true; err.style.display = 'none';
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (error) {
      err.textContent = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'; err.style.display = '';
      setTimeout(() => { btn.disabled = false; }, 1500);
    }
  } }, field('อีเมล', email), field('รหัสผ่าน', pass), err, btn);
  if (msg) { err.textContent = msg; err.style.display = ''; }
  root.replaceChildren(h('div', { class: 'login card' }, h('h1', null, 'รีพอร์ตส่งสื่อ'), form));
}
async function logout() { await sb.auth.signOut(); }

/* ---------- รายการ ---------- */
async function viewList() {
  const F = state.filters;
  state.cases = await api.listCases({ from: F.from, to: F.to });
  const body = h('div');
  const q = h('input', { type: 'search', placeholder: 'ค้นหาชื่อสื่อ / ผู้แจ้ง / แบรนด์ / เลขงาน', maxlength: 100, value: F.q, onInput: e => { F.q = e.target.value; draw(); } });
  const from = h('input', { type: 'date', value: F.from, onChange: e => { F.from = e.target.value; render(); } });
  const to = h('input', { type: 'date', value: F.to, onChange: e => { F.to = e.target.value; render(); } });
  const setWeek = back => { [F.from, F.to] = weekRange(back); render(); };
  const filtered = () => {
    const t = clean(F.q).toLowerCase();
    return state.cases.filter(c => !t || [c.media_name, c.reporter, c.brand, c.job_no].some(x => clean(x).toLowerCase().includes(t)));
  };
  const exportBtn = h('button', { class: 'btn', onClick: async () => {
    const list = filtered();
    if (!list.length) return toast('ไม่มีรายการให้ส่งออก', true);
    if (list.length > 40 && !await confirmDialog({ title: 'ส่งออกจำนวนมาก', lines: [`จะส่งออก ${list.length} งาน (1 งาน = 1 แท็บ) อาจใช้เวลาสักครู่`], okText: 'ส่งออก' })) return;
    exportBtn.disabled = true; toast('กำลังสร้างไฟล์ Excel…');
    try {
      const items = [];
      for (const s of list.slice().reverse()) {
        const c = await api.getCase(s.id);
        items.push({ case: c, rows: c.rows, imageBlob: (await loadImage(c.image_path)).imageBlob });
      }
      const tag = F.from || F.to ? `${F.from || '…'}_ถึง_${F.to || '…'}` : todayISO();
      await exportItems(items, `รีพอร์ตส่งสื่อ_${tag}.xlsx`);
    } catch (e) { toast('ส่งออกไม่สำเร็จ: ' + errMsg(e), true); }
    exportBtn.disabled = false;
  } }, 'ส่งออก Excel (ตามที่กรอง)');
  function draw() {
    const list = filtered();
    body.replaceChildren(
      h('div', { class: 'count' }, `แสดง ${list.length} จาก ${state.cases.length} งาน`),
      list.length ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ...['วันที่เสร็จ', 'แบรนด์', 'ชื่อสื่อ', 'เลขงาน', 'ผู้แจ้ง', 'วันที่รับแจ้ง', 'สำเร็จ', 'ไม่สำเร็จ', 'ทั้งหมด'].map(t => h('th', null, t)))),
        h('tbody', null, list.map(c => h('tr', null,
          h('td', null, fmtDate(c.done_date)), h('td', null, c.brand),
          h('td', null, h('button', { class: 'link', onClick: () => go('detail', c.id) }, c.media_name)),
          h('td', null, c.job_no), h('td', null, c.reporter), h('td', null, fmtDate(c.received_date)),
          h('td', null, h('span', { class: 'badge' }, c.ok_rows)),
          h('td', null, c.fail_rows ? h('span', { class: 'badge bad' }, c.fail_rows) : '0'),
          h('td', null, c.total_rows))))))
        : h('p', { class: 'muted' }, 'ยังไม่มีข้อมูลในช่วงนี้'));
  }
  const el = h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row mb' },
        field('ตั้งแต่ (วันที่เสร็จ)', from), field('ถึง', to),
        h('div', { class: 'f grow' }, 'ค้นหา', q),
        h('button', { class: 'btn', onClick: () => setWeek(0) }, 'สัปดาห์นี้ (พฤ.–พ.)'),
        h('button', { class: 'btn', onClick: () => setWeek(1) }, 'สัปดาห์ก่อน'),
        h('button', { class: 'btn', onClick: () => { state.filters = { from: '', to: '', q: '' }; render(); } }, 'ล้างตัวกรอง')),
      h('div', { class: 'row' },
        h('button', { class: 'btn pri', onClick: () => go('form') }, '+ เพิ่มสื่อใหม่'),
        h('button', { class: 'btn', onClick: () => go('import') }, 'นำเข้าจากชีต'), exportBtn),
      body));
  draw();
  return el;
}

/* ---------- รายละเอียดงาน ---------- */
async function viewDetail(id) {
  const c = await api.getCase(id);
  Object.assign(c, await loadImage(c.image_path));
  const cnt = countRows(c.rows);
  const info = (k, v) => h('div', { class: 'f' }, k, h('div', { style: 'color:var(--ink);font-size:15px' }, v || '-'));
  const exportBtn = h('button', { class: 'btn', onClick: async () => {
    exportBtn.disabled = true;
    try { await exportItems([{ case: c, rows: c.rows, imageBlob: c.imageBlob }], `${safeName(c.brand)}_${safeName(c.media_name)}_${c.done_date}.xlsx`); }
    catch (e) { toast('ส่งออกไม่สำเร็จ: ' + errMsg(e), true); }
    exportBtn.disabled = false;
  } }, 'ส่งออก Excel');
  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row mb' },
        h('button', { class: 'btn', onClick: () => go('list') }, '← กลับ'), h('span', { class: 'grow' }),
        exportBtn, h('button', { class: 'btn pri', onClick: () => go('form', c) }, 'แก้ไข')),
      h('div', { class: 'fgrid' }, info('แบรนด์', c.brand), info('ชื่อสื่อ', c.media_name), info('เลขงาน', c.job_no), info('ผู้แจ้ง', c.reporter),
        info('วันที่รับแจ้ง', fmtDate(c.received_date, true)), info('วันที่เสร็จ', fmtDate(c.done_date, true)),
        info('ผลรวม', `สำเร็จ ${cnt.ok} • ไม่สำเร็จ ${cnt.bad} • ไม่ได้ติ๊ก ${cnt.none} (ทั้งหมด ${cnt.total} แถว)`),
        info('แก้ไขล่าสุด', c.updated_at ? new Date(c.updated_at).toLocaleString('th-TH-u-ca-gregory') : '-'))),
    rowsTable(c.rows, { media: c }));
}

/* ---------- ฟอร์มเพิ่ม/แก้ไข ---------- */
function allTypes(extraRows) {
  const s = [];
  for (const r of state.roster.concat(extraRows || [])) if (r.screen_type && !s.includes(r.screen_type)) s.push(r.screen_type);
  return s;
}
const toCaseRow = r => ({ store_no: r.store_no, store_name: r.store_name, province: r.province, screen_count: r.screen_count,
  screen_type: r.screen_type, device_id: r.device_id, screen_status: r.screen_status, success: true, fail: false, note: '' });

function buildRows(f) {
  const out = [];
  for (const t of allTypes(f.rows)) {
    if (!f.types.has(t)) continue;
    const have = f.rows.filter(r => r.screen_type === t);
    out.push(...(have.length ? have : state.roster.filter(r => r.screen_type === t).map(toCaseRow)));
  }
  f.rows = out;
}
function validateForm(f) {
  if (!clean(f.brand)) return 'กรุณากรอกชื่อแบรนด์';
  if (!clean(f.media_name)) return 'กรุณากรอกชื่อสื่อ';
  if (!clean(f.reporter)) return 'กรุณากรอกชื่อผู้แจ้ง';
  if (!f.received_date || !f.done_date) return 'กรุณาเลือกวันที่รับแจ้งและวันที่เสร็จ';
  if (f.done_date < f.received_date) return 'วันที่เสร็จต้องไม่ก่อนวันที่รับแจ้ง';
  if (!f.types.size) return 'กรุณาเลือกประเภทจออย่างน้อย 1 ประเภท';
  return '';
}
function keyed(rows) {
  const seen = {};
  return rows.map(r => {
    const k = [r.store_no, r.store_name, r.province, r.screen_type, r.device_id, r.screen_count].join('|');
    seen[k] = (seen[k] || 0) + 1; return [k + '#' + seen[k], r];
  });
}
function diffRows(a, b) {
  const A = new Map(keyed(a)), B = new Map(keyed(b));
  let added = 0, removed = 0, status = 0, notes = 0;
  for (const [k, r] of B) {
    const o = A.get(k);
    if (!o) { added++; continue; }
    if (!!o.success !== !!r.success || !!o.fail !== !!r.fail) status++;
    if ((o.note || '') !== (r.note || '')) notes++;
  }
  for (const k of A.keys()) if (!B.has(k)) removed++;
  return { added, removed, status, notes };
}

async function viewForm(existing) {
  if (!state.roster.length) await refreshRoster();
  const isEdit = !!existing;
  const f = isEdit
    ? { id: existing.id, brand: existing.brand, media_name: existing.media_name, job_no: existing.job_no || '',
        received_date: existing.received_date, done_date: existing.done_date, reporter: existing.reporter,
        types: new Set(existing.rows.map(r => r.screen_type)), rows: deep(existing.rows),
        image: { blob: null, src: existing.imgSrc || null } }
    : { id: null, brand: '', media_name: '', job_no: '', received_date: todayISO(), done_date: todayISO(),
        reporter: '', types: new Set(), rows: [], image: { blob: null, src: null } };
  const orig = isEdit ? { f: { ...deep({ ...f, types: [], image: null }), image: null }, rows: deep(existing.rows), hadImage: !!existing.image_path } : null;
  if (!state.cases.length) await refreshCases();
  const uniq = k => [...new Set(state.cases.map(c => clean(c[k])).filter(Boolean))];
  const bind = (key, props) => h('input', { maxlength: 200, value: f[key], onInput: e => { f[key] = e.target.value; }, ...props });

  const chipBox = h('div', { class: 'chips' });
  const drawChips = () => {
    const types = allTypes(f.rows);
    chipBox.replaceChildren(...(types.length ? types.map(t => h('button', { type: 'button', class: 'chip' + (f.types.has(t) ? ' on' : ''),
      onClick: () => { f.types.has(t) ? f.types.delete(t) : f.types.add(t); drawChips(); } },
      (f.types.has(t) ? '✓ ' : '') + t + ` (${state.roster.filter(r => r.screen_type === t).length} แถว)`))
      : [h('div', { class: 'note warn' }, 'ยังไม่มีรายชื่อร้านหลัก ไปที่ "นำเข้าจากชีต" หรือ "ตั้งค่าร้าน" เพื่อเพิ่มก่อน')]));
  };
  drawChips();

  const prev = h('div');
  const drawPrev = () => prev.replaceChildren(f.image.src ? h('img', { class: 'imgprev', src: f.image.src, alt: 'รูปสื่อ' }) : h('span', { class: 'muted' }, 'ยังไม่มีรูป'));
  drawPrev();
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onChange: async e => {
    const fl = e.target.files[0]; if (!fl) return;
    if (!/^image\//.test(fl.type) || fl.size > 15 * 1024 * 1024) { e.target.value = ''; return toast('ไฟล์ต้องเป็นรูปและไม่เกิน 15 MB', true); }
    try { f.image.blob = await shrinkImage(fl); f.image.src = await blobToDataURL(f.image.blob); drawPrev(); }
    catch (err) { toast('อ่านรูปไม่สำเร็จ', true); }
  } });

  const next = h('button', { class: 'btn pri', onClick: () => {
    const e = validateForm(f); if (e) return toast(e, true);
    buildRows(f);
    if (!f.rows.length) return toast('ประเภทจอที่เลือกยังไม่มีร้านในรายชื่อหลัก', true);
    openReview(f, orig);
  } }, 'ตรวจสอบร้านที่ติ๊กให้ →');

  return h('div', { class: 'card' },
    h('h2', { class: 'sec' }, isEdit ? 'แก้ไขสื่อ' : 'เพิ่มสื่อใหม่'),
    h('div', { class: 'fgrid' },
      field('แบรนด์ *', bind('brand', { list: 'dl-brand', placeholder: 'เช่น True' })),
      field('ชื่อสื่อ *', bind('media_name')),
      field('เลขงาน', bind('job_no', { placeholder: 'เช่น TRU000', maxlength: 50 })),
      field('ผู้แจ้ง (ชื่อคน) *', bind('reporter', { list: 'dl-rep' })),
      field('วันที่รับแจ้ง *', h('input', { type: 'date', value: f.received_date, onChange: e => { f.received_date = e.target.value; } })),
      field('วันที่เสร็จ *', h('input', { type: 'date', value: f.done_date, onChange: e => { f.done_date = e.target.value; } }))),
    h('datalist', { id: 'dl-brand' }, uniq('brand').map(v => h('option', { value: v }))),
    h('datalist', { id: 'dl-rep' }, uniq('reporter').map(v => h('option', { value: v }))),
    h('div', { class: 'f', style: 'margin-top:14px' }, 'ประเภทจอ * (เลือกได้หลายประเภท ระบบจะติ๊กร้านให้เอง)', chipBox),
    h('div', { class: 'f', style: 'margin-top:14px' }, 'รูปสื่อ (ย่อให้อัตโนมัติ)', file, prev),
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { class: 'btn', onClick: () => go(isEdit ? 'detail' : 'list', isEdit ? f.id : null) }, 'ยกเลิก'), next));
}

function openReview(f, orig) {
  const sum = h('span');
  const upd = () => { const c = countRows(f.rows); sum.textContent = `สำเร็จ ${c.ok} • ไม่สำเร็จ ${c.bad} • ไม่ติ๊ก ${c.none} / ทั้งหมด ${c.total} แถว`; };
  const tbl = rowsTable(f.rows, { editable: true, onChange: upd });
  const setAll = fn => { f.rows.forEach(fn); tbl.refresh(); upd(); };
  upd();
  let m; const saveBtn = h('button', { class: 'btn pri', onClick: () => commitForm(f, orig, m, saveBtn) }, orig ? 'บันทึกการแก้ไข' : 'บันทึก');
  m = openModal({
    title: 'ตรวจสอบอีกครั้งว่าติ๊กถูกร้านไหม', wide: true,
    body: [
      h('div', { class: 'note' }, 'ระบบติ๊ก "สำเร็จ" ให้ทุกร้านในประเภทจอที่เลือกแล้ว ถ้ามีร้านไหนไม่ถูก ติ๊กออก หรือติ๊ก "ไม่สำเร็จ" ได้เลยในตารางนี้ พร้อมใส่หมายเหตุได้'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onClick: () => setAll(r => { r.success = true; r.fail = false; }) }, 'ติ๊กสำเร็จทั้งหมด'),
        h('button', { class: 'btn sm', onClick: () => setAll(r => { r.success = false; r.fail = false; }) }, 'ล้างติ๊กทั้งหมด')),
      tbl],
    footer: [sum, h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, '← ย้อนกลับไปแก้ฟอร์ม'), saveBtn]
  });
}

async function commitForm(f, orig, modal, btn) {
  if (orig) {
    const d = diffRows(orig.rows, f.rows), lines = [];
    const labels = { brand: 'แบรนด์', media_name: 'ชื่อสื่อ', job_no: 'เลขงาน', reporter: 'ผู้แจ้ง', received_date: 'วันที่รับแจ้ง', done_date: 'วันที่เสร็จ' };
    for (const [k, lb] of Object.entries(labels)) if (clean(orig.f[k]) !== clean(f[k])) lines.push(`${lb}: "${clean(orig.f[k])}" → "${clean(f[k])}"`);
    if (d.status) lines.push(`เปลี่ยนสถานะติ๊ก ${d.status} แถว`);
    if (d.notes) lines.push(`แก้หมายเหตุ ${d.notes} แถว`);
    if (d.added) lines.push(`เพิ่มแถวใหม่ ${d.added} แถว`);
    if (d.removed) lines.push(`ลบแถวออก ${d.removed} แถว`);
    if (f.image.blob) lines.push('เปลี่ยนรูปสื่อ');
    if (!lines.length) lines.push('(ไม่พบการเปลี่ยนแปลง)');
    const ok = await confirmDialog({ title: 'ยืนยันบันทึกการแก้ไข?', lines: ['สิ่งที่จะเปลี่ยน:', ...lines.map(x => '• ' + x), 'ข้อมูลเดิมจะถูกแทนที่ ยืนยันหรือไม่?'], okText: 'ยืนยันบันทึก' });
    if (!ok) return;
  }
  btn.disabled = true;
  try {
    const image_path = f.image.blob ? await api.uploadImage(f.image.blob) : null;
    const id = await api.saveCase({ id: f.id, brand: clean(f.brand), media_name: clean(f.media_name), job_no: clean(f.job_no),
      received_date: f.received_date, done_date: f.done_date, reporter: clean(f.reporter), image_path, rows: f.rows });
    modal.close(); toast('บันทึกแล้ว'); await refreshCases(); go('detail', id);
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e), true); btn.disabled = false; }
}

/* ---------- นำเข้าจากชีต ---------- */
async function viewImport() {
  if (!state.roster.length) await refreshRoster();
  if (!state.cases.length) await refreshCases();
  const box = h('div');
  let items = [];
  const makeRoster = h('input', { type: 'checkbox', checked: state.isAdmin && !state.roster.length });
  const bulkBrand = h('input', { maxlength: 100, placeholder: 'แบรนด์ (ใช้กับทุกแท็บ)' });
  const bulkRep = h('input', { maxlength: 100, placeholder: 'ผู้แจ้ง (ใช้กับทุกแท็บ)' });

  const file = h('input', { type: 'file', accept: '.xlsx', onChange: async e => {
    const fl = e.target.files[0]; if (!fl) return;
    box.replaceChildren(h('p', { class: 'muted' }, 'กำลังอ่านไฟล์…'));
    try {
      items = await parseWorkbook(fl);
      if (!items.length) return box.replaceChildren(h('div', { class: 'note warn' }, 'ไม่พบตารางร้านในไฟล์นี้ (ต้องมีหัวตาราง 2 แถว และข้อมูลเริ่มแถวที่ 3 เหมือนชีตเดิม)'));
      for (const it of items) it.src = it.blob ? await blobToDataURL(it.blob).catch(() => null) : null;
      drawItems();
    } catch (err) { box.replaceChildren(h('div', { class: 'note warn' }, 'อ่านไฟล์ไม่สำเร็จ: ' + errMsg(err))); }
  } });

  function drawItems() {
    const cards = items.map(it => {
      const c = countRows(it.rows);
      const dup = state.cases.find(x => it.job_no && x.job_no === it.job_no && x.received_date === it.received_date);
      const inp = (k, type) => h('input', { type: type || 'text', maxlength: 200, value: it[k], onInput: e => { it[k] = e.target.value; }, onChange: e => { it[k] = e.target.value; } });
      return h('div', { class: 'card' },
        h('label', { class: 'row mb' }, h('input', { type: 'checkbox', class: 'cb ok', checked: it.include, onChange: e => { it.include = e.target.checked; } }),
          h('b', null, `แท็บ "${it.name}"`), h('span', { class: 'muted' }, `${c.total} แถว • สำเร็จ ${c.ok} • ไม่สำเร็จ ${c.bad} • ไม่ติ๊ก ${c.none}`)),
        h('div', { class: 'fgrid' },
          field('แบรนด์ *', inp('brand')), field('ชื่อสื่อ *', inp('media_name')), field('เลขงาน', inp('job_no')),
          field('ผู้แจ้ง *', inp('reporter')), field('วันที่รับแจ้ง *', inp('received_date', 'date')), field('วันที่เสร็จ *', inp('done_date', 'date'))),
        it.src ? h('img', { class: 'imgprev', src: it.src, alt: 'รูปสื่อ' }) : null,
        dup ? h('div', { class: 'note warn', style: 'margin-top:8px' }, `มีงานเลขงาน ${it.job_no} วันที่รับแจ้งเดียวกันอยู่ในระบบแล้ว (${dup.media_name}) ระวังนำเข้าซ้ำ`) : null,
        ...it.warnings.map(w => h('div', { class: 'note', style: 'margin-top:8px' }, '⚠ ' + w)));
    });
    const go1 = h('button', { class: 'btn pri', onClick: () => doImport(go1) }, 'นำเข้าที่เลือก');
    box.replaceChildren(
      h('div', { class: 'card' }, h('div', { class: 'row' },
        h('div', { class: 'f grow' }, 'กรอกครั้งเดียวใช้กับทุกแท็บ', h('div', { class: 'row' }, bulkBrand, bulkRep)),
        h('button', { class: 'btn', onClick: () => { for (const it of items) { if (bulkBrand.value.trim()) it.brand = bulkBrand.value.trim(); if (bulkRep.value.trim()) it.reporter = bulkRep.value.trim(); } drawItems(); } }, 'ใช้กับทุกแท็บ'))),
      ...cards,
      h('div', { class: 'card' },
        state.isAdmin && !state.roster.length ? h('label', { class: 'row mb' }, makeRoster, 'ใช้แถวร้านจากไฟล์นี้เป็นรายชื่อร้านหลักด้วย (รายชื่อหลักยังว่างอยู่)') : null,
        go1));
  }

  async function doImport(btn) {
    const sel = items.filter(i => i.include);
    if (!sel.length) return toast('ยังไม่ได้เลือกแท็บ', true);
    for (const it of sel) {
      const e = validateForm({ ...it, types: new Set(['x']) });
      if (e) return toast(`แท็บ "${it.name}": ${e}`, true);
    }
    const total = sel.reduce((a, i) => a + i.rows.length, 0);
    if (!await confirmDialog({ title: 'ยืนยันนำเข้า?', lines: [`นำเข้า ${sel.length} งาน รวม ${total} แถว`, makeRoster.checked ? 'และสร้างรายชื่อร้านหลักจากแท็บแรก' : '', 'ข้อมูลจะถูกบันทึกเข้าระบบจริง'].filter(Boolean), okText: 'นำเข้า' })) return;
    btn.disabled = true;
    try {
      let n = 0;
      for (const it of sel) {
        toast(`กำลังนำเข้า ${++n}/${sel.length}…`);
        const image_path = it.blob ? await api.uploadImage(await shrinkImage(it.blob)) : null;
        await api.saveCase({ id: null, brand: clean(it.brand), media_name: clean(it.media_name), job_no: clean(it.job_no),
          received_date: it.received_date, done_date: it.done_date, reporter: clean(it.reporter), image_path, rows: it.rows });
      }
      if (makeRoster.checked && state.isAdmin && !state.roster.length) {
        await api.rosterInsert(sel[0].rows.map(r => ({ store_no: r.store_no, store_name: r.store_name, province: r.province,
          screen_count: r.screen_count, screen_type: r.screen_type, device_id: r.device_id, screen_status: r.screen_status })));
        await refreshRoster();
      }
      toast(`นำเข้าสำเร็จ ${sel.length} งาน`); await refreshCases(); go('list');
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + errMsg(e), true); btn.disabled = false; }
  }

  return h('div', null,
    h('div', { class: 'card' },
      h('h2', { class: 'sec' }, 'นำเข้าจากไฟล์ชีตเดิม'),
      h('p', { class: 'muted' }, 'ใน Google Sheet กด ไฟล์ > ดาวน์โหลด > Microsoft Excel (.xlsx) แล้วเลือกไฟล์ที่นี่ 1 แท็บ = 1 งาน ระบบแสดงตัวอย่างให้ตรวจก่อนบันทึกจริง'),
      file),
    box);
}

/* ---------- ตั้งค่าร้าน ---------- */
async function viewRoster() {
  await refreshRoster();
  const body = h('div');
  const st = { type: '', q: '' };
  const q = h('input', { type: 'search', placeholder: 'ค้นหาจังหวัด / ชื่อร้าน / Device ID', maxlength: 100, onInput: e => { st.q = e.target.value; draw(); } });
  const openEdit = row => {
    const r = row ? { ...row } : { store_no: '', store_name: '', province: '', screen_count: 1, screen_type: st.type || '', device_id: '', screen_status: 'Online' };
    const mk = (k, label, type) => field(label, h('input', { type: type || 'text', maxlength: 150, value: r[k] ?? '', onInput: e => { r[k] = e.target.value; } }));
    let m;
    const save = h('button', { class: 'btn pri', onClick: async () => {
      const out = { store_no: r.store_no === '' || r.store_no == null ? null : parseInt(r.store_no, 10), store_name: clean(r.store_name), province: fixThai(r.province),
        screen_count: Math.min(99, Math.max(0, parseInt(r.screen_count, 10) || 0)), screen_type: clean(r.screen_type),
        device_id: clean(r.device_id), screen_status: clean(r.screen_status) };
      if (!out.screen_type) return toast('กรุณากรอกประเภทจอ', true);
      save.disabled = true;
      try { row ? await api.rosterUpdate(row.id, out) : await api.rosterInsert([out]); m.close(); toast('บันทึกแล้ว'); await refreshRoster(); draw(); }
      catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e), true); save.disabled = false; }
    } }, 'บันทึก');
    m = openModal({ title: row ? 'แก้ไขแถวร้าน' : 'เพิ่มแถวร้าน',
      body: h('div', { class: 'fgrid' }, mk('store_no', 'No.', 'number'), mk('store_name', 'Store Name'), mk('province', 'จังหวัด'),
        mk('screen_count', 'จำนวนจอ', 'number'), mk('screen_type', 'ประเภทจอ'), mk('device_id', 'Device ID'), mk('screen_status', 'สถานะจอ')),
      footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'ยกเลิก'), save] });
  };
  const del = async row => {
    if (!await confirmDialog({ title: 'ลบแถวนี้ออกจากรายชื่อหลัก?', lines: [`${row.province} • ${row.screen_type} • ${row.store_name || row.device_id || ''}`, 'งานที่บันทึกไปแล้วไม่ได้รับผลกระทบ'], okText: 'ลบ', danger: true })) return;
    try { await api.rosterDelete(row.id); await refreshRoster(); draw(); toast('ลบแล้ว'); } catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e), true); }
  };
  const importRoster = h('input', { type: 'file', accept: '.xlsx', onChange: async e => {
    const fl = e.target.files[0]; e.target.value = ''; if (!fl) return;
    try {
      const sheets = await parseWorkbook(fl);
      if (!sheets.length) return toast('ไม่พบตารางร้านในไฟล์', true);
      const rows = sheets[0].rows;
      if (!await confirmDialog({ title: 'เพิ่มแถวร้านจากไฟล์?', lines: [`เพิ่ม ${rows.length} แถวจากแท็บ "${sheets[0].name}" เข้ารายชื่อหลัก`, state.roster.length ? `ตอนนี้มี ${state.roster.length} แถวอยู่แล้ว แถวใหม่จะถูกเพิ่มต่อท้าย (ไม่ลบของเดิม)` : ''].filter(Boolean), okText: 'เพิ่ม' })) return;
      await api.rosterInsert(rows.map(r => ({ store_no: r.store_no, store_name: r.store_name, province: r.province, screen_count: r.screen_count,
        screen_type: r.screen_type, device_id: r.device_id, screen_status: r.screen_status })));
      toast('เพิ่มแล้ว'); await refreshRoster(); draw();
    } catch (err) { toast('นำเข้าไม่สำเร็จ: ' + errMsg(err), true); }
  } });
  function draw() {
    const t = clean(st.q).toLowerCase();
    const list = state.roster.filter(r => (!st.type || r.screen_type === st.type) &&
      (!t || [r.province, r.store_name, r.device_id].some(x => clean(x).toLowerCase().includes(t))));
    const types = allTypes();
    body.replaceChildren(
      h('div', { class: 'chips', style: 'margin-bottom:10px' },
        h('button', { class: 'chip' + (!st.type ? ' on' : ''), onClick: () => { st.type = ''; draw(); } }, `ทุกประเภท (${state.roster.length})`),
        types.map(x => h('button', { class: 'chip' + (st.type === x ? ' on' : ''), onClick: () => { st.type = x; draw(); } }, `${x} (${state.roster.filter(r => r.screen_type === x).length})`))),
      h('div', { class: 'count' }, `แสดง ${list.length} แถว`),
      list.length ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ...['No.', 'Store Name', 'จำนวนจอ', 'จังหวัด', 'ประเภทจอ', 'Device ID', 'สถานะจอ', ''].map(x => h('th', null, x)))),
        h('tbody', null, list.map(r => h('tr', null, h('td', null, r.store_no ?? ''), h('td', null, r.store_name), h('td', null, r.screen_count),
          h('td', null, r.province), h('td', null, r.screen_type), h('td', null, r.device_id), h('td', null, r.screen_status),
          h('td', null, state.isAdmin ? h('span', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => openEdit(r) }, 'แก้ไข'),
            h('button', { class: 'btn sm', onClick: () => del(r) }, 'ลบ')) : ''))))))
        : h('p', { class: 'muted' }, 'ยังไม่มีรายชื่อร้าน'));
  }
  const el = h('div', { class: 'card' },
    h('h2', { class: 'sec' }, 'รายชื่อร้านหลัก (ใช้ติ๊กให้อัตโนมัติตามประเภทจอ)'),
    state.isAdmin ? null : h('div', { class: 'note', style: 'margin-bottom:10px' }, 'ดูได้อย่างเดียว การแก้ไขต้องเป็น admin'),
    h('div', { class: 'row mb' }, h('div', { class: 'f grow' }, 'ค้นหา', q),
      state.isAdmin ? h('button', { class: 'btn pri', onClick: () => openEdit(null) }, '+ เพิ่มแถวร้าน') : null,
      state.isAdmin ? h('label', { class: 'f' }, 'เพิ่มจากไฟล์ชีต (.xlsx)', importRoster) : null),
    body);
  draw();
  return el;
}

/* ============================ เริ่มทำงาน ============================ */
let idleTimer = null, lastReset = 0;
function resetIdle() {
  const n = Date.now(); if (n - lastReset < 5000) return; lastReset = n;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => { if (state.user) { await sb.auth.signOut(); toast('ออกจากระบบอัตโนมัติ เพราะไม่ได้ใช้งานนาน'); } }, IDLE_MS);
}
['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));

async function onSession(session) {
  state.user = session ? session.user : null;
  state.isAdmin = !!(session && session.user && session.user.app_metadata && session.user.app_metadata.role === 'admin');
  if (state.user) { resetIdle(); await refreshRoster(); if (state.view === 'detail' || state.view === 'form') state.view = 'list'; }
  else { state.roster = []; state.cases = []; state.view = 'list'; state.arg = null; state.filters = { from: '', to: '', q: '' }; }
  render();
}

function start() {
  if (!CFG.SUPABASE_URL || /YOUR-/.test(CFG.SUPABASE_URL) || !CFG.SUPABASE_ANON_KEY || /YOUR-/.test(CFG.SUPABASE_ANON_KEY)) {
    root.replaceChildren(h('div', { class: 'login card' }, h('h1', null, 'ยังไม่ได้ตั้งค่า'), h('p', null, 'เปิดไฟล์ config.js แล้วใส่ SUPABASE_URL และ SUPABASE_ANON_KEY (anon public เท่านั้น)')));
    return;
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  let first = true;
  sb.auth.onAuthStateChange((ev, session) => {
    if (first) { first = false; }
    if (ev === 'TOKEN_REFRESHED') return;
    onSession(session);
  });
  sb.auth.getSession().then(({ data }) => { if (first) { first = false; onSession(data.session); } });
}
start();
})();
