'use strict';
(() => {
const CFG = window.APP_CONFIG || {};
const BUCKET = 'delivery-images';
const IDLE_MS = 30 * 60 * 1000;
const LIMITS = { img: 1024, db: 500 };            // MB ของแผนฟรี Supabase (แก้ที่นี่ที่เดียวถ้าเปลี่ยนแผน)
const root = document.getElementById('root');
const modals = document.getElementById('modals');
let sb = null;
const state = {
  user: null, isAdmin: false,
  brands: [], brand: '', types: [], reporters: [], roster: [], cases: [], usage: null,
  filters: { from: '', to: '', q: '', type: '', tag: '' },
  view: 'list', arg: null, token: 0, setTab: 'groups', bs: null
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
const lc = s => clean(s).toLowerCase();
const uniqList = a => [...new Set(a)];
const likeEsc = s => String(s).replace(/[\\%_]/g, c => '\\' + c);

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

function confirmDialog({ title, lines, okText = 'ยืนยัน', danger = false, extra }) {
  return new Promise(res => {
    let m;
    const done = v => { res(v); m.close(); };
    m = openModal({
      title,
      body: [...lines.map(l => h('div', null, l)), extra || null],
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
function monthLabel(iso) { const [y, m] = iso.slice(0, 7).split('-').map(Number); return `${TH_MONTHS[m - 1]} ${y + 543}`; }
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
  let m = s.match(/(\d{1,2})\s*([ก-๙.]{2,})\s*(\d{2,4})/);
  if (m) {
    const mi = monthIndex(m[2]);
    if (mi >= 0) {
      let y = +m[3];
      if (m[3].length === 2) y = y >= 60 ? 2500 + y - 543 : 2000 + y;   // 26 = 2569 = 2026
      else if (y > 2400) y -= 543;
      return mkIso(y, mi + 1, +m[1]);
    }
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
function monthRange(back = 0) {
  const n = new Date(), a = new Date(n.getFullYear(), n.getMonth() - back, 1), b = new Date(n.getFullYear(), n.getMonth() - back + 1, 0);
  const f = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return [f(a), back === 0 ? todayISO() : f(b)];
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
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('แปลงรูปไม่สำเร็จ')), 'image/jpeg', 0.82));
}
const blobToDataURL = b => new Promise((res, rej) => {
  const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b);
});
function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } }

/* ============================ ข้อมูลจอ / แบรนด์ ============================ */
const curBrand = () => state.brands.find(b => b.name === state.brand) || null;
const brandTypes = () => state.types.filter(t => t.brand === state.brand).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
const typeCfg = name => state.types.find(t => t.brand === state.brand && t.name === name) || null;
const hasTags = () => !!(curBrand() && curBrand().has_tags);
const tagList = () => (curBrand() ? curBrand().tag_list : []) || [];
const shelvesOf = typeName => (typeCfg(typeName) || { shelves: [] }).shelves;

// เลือกจอจากรายชื่อหลักตามประเภทจอ / Shelf / ประเภทสาขา
// กฎ: ไม่เลือกกลุ่มไหน = ไม่กรองกลุ่มนั้น, หลายกลุ่มต้องตรงทุกกลุ่ม, ในกลุ่มเดียวกันเลือกหลายอันรวมกัน
function pickScreens(types, shelves, tags) {
  return state.roster.filter(s => {
    if (!types.has(s.screen_type)) return false;
    if (shelves.size && shelvesOf(s.screen_type).length && !shelves.has(s.shelf)) return false;
    if (tags.size && !(s.tags || []).some(t => tags.has(t))) return false;
    return true;
  });
}
const toCaseRow = s => ({ store_no: null, store_name: s.store_name, province: s.province, screen_count: s.screen_count,
  screen_type: s.screen_type, shelf: s.shelf || '', res: s.res || '', tags: [...(s.tags || [])], device_id: s.device_id,
  screen_status: s.screen_status, success: true, fail: false, note: '' });
const storeKey = r => lc(r.store_name) + '|' + lc(r.province);
// จัดเรียงให้จอของสาขาเดียวกันอยู่ติดกัน และนับเลข No. ใหม่ตามรีพอร์ตนี้ (สาขาเดียวกัน = เลขเดียวกัน)
function arrange(rows) {
  const order = [], groups = new Map();
  for (const r of rows) {
    const k = storeKey(r);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push(r);
  }
  const out = [];
  order.forEach((k, i) => groups.get(k).forEach(r => { r.store_no = i + 1; out.push(r); }));
  return out;
}
const rowKey = r => [lc(r.store_name), lc(r.province), r.screen_type, r.shelf || '', r.device_id].join('|');

/* ============================ API (Supabase) ============================ */
const api = {
  async loadConfig() {
    const [b, t, r] = await Promise.all([
      sb.from('dr_brands').select('*').order('name'),
      sb.from('dr_types').select('*').order('sort'),
      sb.from('dr_reporters').select('*').order('name')
    ]);
    for (const x of [b, t, r]) if (x.error) throw x.error;
    state.brands = b.data; state.types = t.data; state.reporters = r.data;
  },
  async rosterList(brand) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('dr_roster').select('*').eq('brand', brand).order('id').range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  },
  async listCases({ brand, from, to, field = 'done_date' }) {
    let q = sb.from('dr_case_summary').select('*').eq('brand', brand);
    if (from) q = q.gte(field, from);
    if (to) q = q.lte(field, to);
    const { data, error } = await q.order(field, { ascending: false }).limit(1000);
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
      p_received: p.received_date, p_done: p.done_date, p_reporter: p.reporter, p_image_path: p.image_path || null,
      p_types: p.types || [], p_shelves: p.shelves || [], p_tags: p.tags || [], p_rows: p.rows.map(cleanRow)
    });
    if (error) throw error;
    return data;
  },
  async deleteCases(ids) {
    const sel = await sb.from('dr_cases').select('id,image_path').in('id', ids);
    if (sel.error) throw sel.error;
    const { error } = await sb.from('dr_cases').delete().in('id', ids);
    if (error) throw error;
    const paths = sel.data.map(x => x.image_path).filter(Boolean);
    if (paths.length) { const r = await sb.storage.from(BUCKET).remove(paths); if (r.error) throw r.error; }
  },
  async markExported(ids) {
    if (!ids.length) return;
    const { error } = await sb.from('dr_exports').upsert(ids.map(id => ({ case_id: id, exported_at: new Date().toISOString() })), { onConflict: 'case_id' });
    if (error) throw error;
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
  async rosterInsert(rows) {
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await sb.from('dr_roster').insert(rows.slice(i, i + 400));
      if (error) throw error;
    }
  },
  async rosterUpdate(id, row) { const { error } = await sb.from('dr_roster').update(row).eq('id', id); if (error) throw error; },
  async rosterDelete(id) { const { error } = await sb.from('dr_roster').delete().eq('id', id); if (error) throw error; },
  async rosterTag(ids, add, remove) {
    for (let i = 0; i < ids.length; i += 500) {
      const { error } = await sb.rpc('dr_roster_tag', { p_ids: ids.slice(i, i + 500), p_add: add, p_remove: remove });
      if (error) throw error;
    }
  },
  async storeCounts(p) {
    const { data, error } = await sb.rpc('dr_store_counts', { p_brand: p.brand, p_from: p.from || null, p_to: p.to || null, p_q: p.q || '', p_types: p.types, p_shelves: p.shelves, p_tags: p.tags });
    if (error) throw error;
    return data;
  },
  async searchCases(p) {
    const { data, error } = await sb.rpc('dr_search_cases', { p_brand: p.brand, p_from: p.from || null, p_to: p.to || null, p_store: p.store || '', p_exact: !!p.exact, p_types: p.types, p_shelves: p.shelves, p_tags: p.tags });
    if (error) throw error;
    return data;
  },
  async usage() { const { data, error } = await sb.rpc('dr_usage'); if (error) throw error; return data; },
  async brandInsert(b) { const { error } = await sb.from('dr_brands').insert(b); if (error) throw error; },
  async brandUpdate(name, patch) { const { error } = await sb.from('dr_brands').update(patch).eq('name', name); if (error) throw error; },
  async typeInsert(t) { const { error } = await sb.from('dr_types').insert(t); if (error) throw error; },
  async typeUpdate(brand, name, patch) { const { error } = await sb.from('dr_types').update(patch).eq('brand', brand).eq('name', name); if (error) throw error; },
  async typeDelete(brand, name) { const { error } = await sb.from('dr_types').delete().eq('brand', brand).eq('name', name); if (error) throw error; },
  async reporterUpsert(r) { const { error } = await sb.from('dr_reporters').upsert(r, { onConflict: 'name' }); if (error) throw error; },
  async reporterDelete(name) { const { error } = await sb.from('dr_reporters').delete().eq('name', name); if (error) throw error; }
};
function cleanRow(r) {
  return {
    store_no: r.store_no ?? null, store_name: r.store_name || '', province: r.province || '',
    screen_count: r.screen_count ?? 1, screen_type: r.screen_type || '', shelf: r.shelf || '', res: r.res || '',
    tags: r.tags || [], device_id: r.device_id || '', screen_status: r.screen_status || '',
    success: !!r.success, fail: !!r.fail, note: r.note || ''
  };
}
async function refreshConfig() { try { await api.loadConfig(); } catch (e) { toast('โหลดการตั้งค่าไม่สำเร็จ: ' + errMsg(e), true); } }
async function refreshRoster() {
  try { state.roster = state.brand ? await api.rosterList(state.brand) : []; }
  catch (e) { toast('โหลดรายชื่อจอไม่สำเร็จ: ' + errMsg(e), true); }
}
async function refreshUsage() { if (!state.isAdmin) return; try { state.usage = await api.usage(); } catch (e) { /* แสดงไม่ได้ก็ไม่เป็นไร */ } }
const usagePct = () => {
  if (!state.usage) return 0;
  return Math.max(state.usage.img_bytes / 1048576 / LIMITS.img, state.usage.db_bytes / 1048576 / LIMITS.db) * 100;
};
async function loadImage(path) {
  if (!path) return {};
  try { const blob = await api.downloadImage(path); return { imageBlob: blob, imgSrc: await blobToDataURL(blob) }; }
  catch (e) { return {}; }
}

/* ============================ ตารางแบบชีต (ใช้ทั้งหน้าจอและ Export) ============================ */
function sameStore(a, b) {
  return a.store_no != null && a.store_no === b.store_no && lc(a.store_name) === lc(b.store_name);
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
// เลขสาขาเรียงใหม่ 1,2,3… (ใช้ตอน Export เฉพาะบางประเภทจอ เลขจะได้ไม่ขาด)
function renumbered(rows) {
  const map = new Map(); let n = 0;
  return rows.map(r => { const k = storeKey(r); if (!map.has(k)) map.set(k, ++n); return { ...r, store_no: map.get(k) }; });
}

/* ============================ Export Excel (หน้าตาเหมือนชีตเดิม + Shelf + Res) ============================ */
function sheetName(base, used) {
  let n = base.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'sheet';
  let k = 2, cand = n;
  while (used.has(cand.toLowerCase())) { const suf = ` (${k++})`; cand = n.slice(0, 31 - suf.length) + suf; }
  used.add(cand.toLowerCase());
  return cand;
}
const XL_HEAD = ['No.', 'Store Name', 'จำนวนจอ', 'จังหวัด', 'ประเภทจอ', 'Shelf', 'Resolution', 'Device ID', 'สถานะจอ'];
async function buildWorkbook(items) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'รีพอร์ตส่งสื่อ';
  const used = new Set();
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  const thin = { style: 'thin', color: { argb: 'FF9E9E9E' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const NC = 14;
  for (const it of items) {
    const c = it.case, rows = it.rows;
    const rd = c.received_date;
    const ws = wb.addWorksheet(sheetName(`${rd.slice(8, 10)}-${rd.slice(5, 7)}-${rd.slice(2, 4)} ${c.media_name}`, used),
      { views: [{ state: 'frozen', ySplit: 2 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    [6, 26, 9, 16, 14, 12, 12, 18, 11, 22, 22, 10, 10, 34].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    XL_HEAD.forEach((t, i) => { ws.mergeCells(1, i + 1, 2, i + 1); ws.getCell(1, i + 1).value = t; });
    const tys = uniqList(rows.map(r => clean(r.screen_type)).filter(Boolean));
    const pre = tys.length && !lc(c.media_name).startsWith(lc(tys[0]) + ' :') ? tys.join(', ') + ' : ' : '';
    ws.mergeCells('J1:K1'); ws.getCell('J1').value = pre + c.media_name + (c.job_no ? `\n(${c.job_no})` : '');
    ws.getCell('J2').value = `วันที่รับแจ้ง\n(${fmtDate(c.received_date, true)})`;
    ws.getCell('K2').value = `วันที่ดำเนินการเสร็จ\n(${fmtDate(c.done_date, true)})`;
    ws.mergeCells('L1:M1'); ws.getCell('L1').value = 'สถานะการอัพสื่อ';
    ws.getCell('L2').value = 'สำเร็จ'; ws.getCell('M2').value = 'ไม่สำเร็จ';
    ws.mergeCells('N1:N2'); ws.getCell('N1').value = 'หมายเหตุ';
    for (let r = 1; r <= 2; r++) for (let col = 1; col <= NC; col++) {
      const cell = ws.getCell(r, col);
      cell.fill = fill; cell.border = border; cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    ws.getRow(1).height = 48; ws.getRow(2).height = 40;

    const total = Math.max(rows.length, 5);
    for (let i = 0; i < total; i++) {
      const rn = 3 + i, r = rows[i];
      ws.getRow(rn).height = 26;
      const vals = r
        ? [r.store_no ?? '', r.store_name, r.screen_count, r.province, r.screen_type, r.shelf || '', r.res || '', r.device_id, r.screen_status, '', '', r.success ? '☑' : '☐', r.fail ? '☑' : '☐', r.note || '']
        : new Array(NC).fill('');
      vals.forEach((v, k) => {
        const cell = ws.getCell(rn, k + 1);
        cell.value = v === '' ? null : v; cell.border = border;
        cell.alignment = { horizontal: k === NC - 1 ? 'left' : 'center', vertical: 'middle', wrapText: true };
        cell.font = { size: 11 };
      });
      if (r) {
        ws.getCell(rn, 9).font = { size: 11, bold: true, italic: true, color: { argb: 'FF1E8E5A' } };
        ws.getCell(rn, 12).font = { size: 16, name: 'Segoe UI Symbol', color: { argb: 'FF1E8E5A' } };
        ws.getCell(rn, 13).font = { size: 16, name: 'Segoe UI Symbol', color: { argb: 'FFC93434' } };
      }
    }
    for (const [i, sp] of groupSpans(rows)) if (sp > 1) {
      ws.mergeCells(3 + i, 1, 3 + i + sp - 1, 1);
      ws.mergeCells(3 + i, 2, 3 + i + sp - 1, 2);
    }
    ws.mergeCells(3, 10, 7, 11);
    if (it.imageBlob) {
      try {
        const bmp = await createImageBitmap(it.imageBlob);
        const sc = Math.min(290 / bmp.width, 165 / bmp.height);
        const ext = /png/i.test(it.imageBlob.type) ? 'png' : 'jpeg';
        const id = wb.addImage({ buffer: await it.imageBlob.arrayBuffer(), extension: ext });
        ws.addImage(id, { tl: { col: 9.04, row: 2.05 }, ext: { width: Math.round(bmp.width * sc), height: Math.round(bmp.height * sc) }, editAs: 'oneCell' });
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
// ดึงงาน + รูปมาทำ Export (ใช้ทั้งหน้ารายการ / ค้นหาสาขา / ลบสื่อเก่า) แล้วบันทึกว่า Export แล้ว
async function exportCasesById(ids, filename, onProgress) {
  const items = []; let n = 0;
  for (const id of ids) {
    if (onProgress) onProgress(++n, ids.length);
    const c = await api.getCase(id);
    items.push({ case: c, rows: c.rows, imageBlob: (await loadImage(c.image_path)).imageBlob });
  }
  await exportItems(items, filename);
  try { await api.markExported(ids); } catch (e) { /* บันทึกสถานะไม่ได้ ไม่กระทบไฟล์ */ }
}

/* ============================ อ่านไฟล์ Excel ============================ */
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
const COLS = {
  no: /^no\.?$/i, store: /^(store\s*name|ชื่อ\s*(สาขา|ร้าน)|สาขา|ร้าน)$/i, count: /^จำนวนจอ$/, prov: /^จังหวัด$/, type: /^ประเภทจอ$/,
  shelf: /^(shelf|เชลฟ์|เชลท์|ชั้น)$/i, res: /^res(olution)?$/i, device: /^device\s*id$/i, status: /^สถานะจอ$/,
  ok: /^สำเร็จ$/, fail: /^ไม่สำเร็จ$/, note: /^หมายเหตุ$/, tags: /^(ประเภทสาขา|กรุ๊ป|group|tags?)$/i
};
// หาคอลัมน์จากหัวตาราง (ดูแถว 1–maxRow) ถ้าไม่พบจะคืน null เพื่อให้ใช้ตำแหน่งเดิม
function findCols(ws, maxRow = 4, maxCol = 24) {
  const map = {}; let last = 0;
  for (let r = 1; r <= Math.min(maxRow, ws.rowCount); r++) for (let c = 1; c <= maxCol; c++) {
    const t = clean(ctext(ws.getCell(r, c)));
    if (!t) continue;
    for (const [k, re] of Object.entries(COLS)) if (re.test(t) && map[k] == null) { map[k] = c; last = Math.max(last, r); }
  }
  return { map, last };
}
const OLD_MAP = { no: 1, store: 2, count: 3, prov: 4, type: 5, device: 6, status: 7, ok: 10, fail: 11, note: 12 };

// อ่าน 1 แท็บ -> คืนเป็นลิสต์ของสื่อ (แท็บเดียวมีได้หลายสื่อวางต่อกันในแนวนอน ใช้รายชื่อสาขาชุดเดียวกัน)
function parseSheet(wb, ws) {
  if (ws.rowCount < 3) return [];
  const det = findCols(ws, 3);
  const detected = det.map.store != null && det.map.type != null;
  const M = detected ? { ...OLD_MAP, ...det.map } : OLD_MAP;
  const start = detected ? Math.max(det.last + 1, 3) : 3;
  const T = (r, c) => clean(ctext(ws.getCell(r, c)));
  // ---- หาบล็อกสื่อ: ทุกเซลล์แถว 2 ที่เขียนว่า "วันที่รับแจ้ง" = 1 สื่อ ----
  let starts = [];
  for (let c = 1; c <= 60; c++) if (/วันที่รับแจ้ง/.test(T(2, c))) starts.push(c);
  if (!starts.length) { let mc = 0; for (let c = 1; c <= 24 && !mc; c++) if (/เลขงาน/.test(T(1, c))) mc = c; starts = [mc || 8]; }
  const multi = starts.length > 1;
  const blocks = starts.map((sc, k) => {
    const end = (starts[k + 1] || 61) - 1;
    const find = (re, from, rows) => { for (let c = from; c <= end; c++) for (const r of rows) if (re.test(T(r, c))) return c; return 0; };
    const ok = find(/^สำเร็จ$/, sc + 2, [2]) || (k === 0 ? M.ok : 0);
    const fail = find(/^ไม่สำเร็จ$/, sc + 2, [2]) || (k === 0 ? M.fail : 0);
    const note = find(/^หมายเหตุ$/, Math.max(ok, fail, sc + 1) + 1, [1, 2]) || (k === 0 ? M.note : 0);
    return { sc, end, ok, fail, note };
  });
  const dateCol = (r, sc) => parseThaiDate(ctext(ws.getCell(r, sc)));
  // ---- แถวสาขา (ใช้ร่วมกันทุกสื่อ) ----
  const base = []; let prevNo = null, fixed = 0;
  for (let r = start; r <= ws.rowCount; r++) {
    const g = c => (c ? ws.getCell(r, c) : { value: null });
    const store = clean(ctext(g(M.store))), cnt = clean(ctext(g(M.count))), prov = ctext(g(M.prov)), type = clean(ctext(g(M.type)));
    if (!store && !cnt && !clean(prov) && !type) continue;
    const noText = clean(ctext(g(M.no)));
    let store_no = noText !== '' && !isNaN(+noText) ? Math.trunc(+noText) : null;
    if (store_no == null) store_no = prevNo; else prevNo = store_no;
    const province = fixThai(prov);
    if (province !== clean(prov)) fixed++;
    const n = parseInt(cnt, 10);
    base.push({ r, row: {
      store_no, store_name: store, screen_count: Number.isFinite(n) ? Math.min(99, Math.max(0, n)) : 1,
      province, screen_type: type || 'ไม่ระบุ', shelf: clean(ctext(g(M.shelf))), res: clean(ctext(g(M.res))), tags: [],
      device_id: clean(ctext(g(M.device))), screen_status: clean(ctext(g(M.status)))
    } });
  }
  if (!base.length) return [];
  let imgs = [];
  try { imgs = ws.getImages(); } catch (e) { /* อ่านรูปไม่ได้ก็ข้าม */ }
  const out = [];
  blocks.forEach((b, k) => {
    const warnings = [];
    const lines = ctext(ws.getCell(1, b.sc)).split(/\r?\n/).map(clean).filter(Boolean);
    let job_no = '', media = '';
    const codeRe = /^\(?\s*([A-Za-z]{2,6}\s*-?\s*\d{3,}[A-Za-z0-9-]*)\s*\)?\s*(\(เลขงาน\))?$/;
    const rest = [];
    for (const ln of lines) { const m = ln.match(codeRe); if (m && !job_no) job_no = m[1].replace(/\s+/g, ''); else rest.push(ln); }
    if (!job_no) for (const ln of rest) { const m = ln.match(/([A-Za-z]{2,6}\s*-?\s*\d{3,})\s*\(เลขงาน\)/); if (m) { job_no = m[1].replace(/\s+/g, ''); break; } }
    media = rest.find(ln => !/เลขงาน/.test(ln)) || '';
    // ตัดคำนำหน้า "LED : " / "LED, Acc Wall : " เฉพาะที่เป็นชื่อประเภทจอจริง
    { const known = uniqList([...(typeof brandTypes === 'function' ? brandTypes().map(t => t.name) : []), 'LED', 'TV', 'Digital Poster', 'Acc Wall', 'VDO Wall']).map(x => lc(clean(x)));
      const pm = media.match(/^([^:：]{1,60}?)\s*[:：]\s+(.+)$/);
      if (pm && pm[1].split(/\s*[,&+/]\s*/).every(x => known.includes(lc(clean(x))))) media = clean(pm[2]); }
    if (media && !media.includes('(')) media = clean(media.replace(/\)\s*$/, ''));
    if (!media) { media = (ws.name || '') + (multi ? ` (สื่อ ${k + 1})` : ''); warnings.push('ไม่พบชื่อสื่อในหัวตาราง ใช้ชื่อแท็บแทน กรุณาตรวจ'); }
    const received_date = dateCol(2, b.sc), done_date = dateCol(2, b.sc + 1);
    if (!received_date) warnings.push('อ่านวันที่รับแจ้งไม่ได้ กรุณากรอกเอง');
    if (!done_date) warnings.push('อ่านวันที่เสร็จไม่ได้ กรุณากรอกเอง');
    let both = 0;
    const rows = base.map(({ r, row }) => {
      let success = b.ok ? cbool(ws.getCell(r, b.ok)) : false, fail = b.fail ? cbool(ws.getCell(r, b.fail)) : false;
      if (success && fail) { both++; success = false; }
      return { ...row, success, fail, note: b.note ? clean(ctext(ws.getCell(r, b.note))) : '' };
    });
    if (fixed && k === 0) warnings.push(`แก้ตัวสะกดซ้ำในชื่อจังหวัดให้อัตโนมัติ ${fixed} แถว (เช่น "อุดรธานีี")`);
    if (both) warnings.push(`มี ${both} แถวที่ติ๊กทั้งสำเร็จและไม่สำเร็จ ระบบถือเป็น "ไม่สำเร็จ"`);
    let blob = null;
    try {
      // หลายสื่อ: ใช้รูปที่วางอยู่ในช่วงคอลัมน์ของสื่อนั้น / สื่อเดียว: ใช้รูปแรก
      const mine = multi ? imgs.filter(im => { const col = Math.floor((im.range && im.range.tl && (im.range.tl.nativeCol != null ? im.range.tl.nativeCol : im.range.tl.col)) || 0) + 1; return col >= b.sc && col <= b.end; }) : imgs;
      if (mine.length) {
        const im = wb.getImage(mine[0].imageId);
        const ext = String(im.extension || 'jpeg').replace('jpg', 'jpeg');
        blob = new Blob([im.buffer], { type: 'image/' + ext });
        if (mine.length > 1) warnings.push(`พบรูป ${mine.length} รูป ใช้รูปแรกเท่านั้น`);
      } else warnings.push('ไม่พบรูปสื่อ' + (multi ? 'ของสื่อนี้' : 'ในแท็บนี้'));
    } catch (e) { warnings.push('อ่านรูปไม่สำเร็จ'); }
    out.push({ name: ws.name + (multi ? ` • สื่อ ${k + 1}` : ''), include: true, media_name: media, job_no, received_date, done_date, reporter: '', rows, blob, warnings });
  });
  return out;
}
async function loadWorkbook(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 20 MB');
  if (!/\.xlsx$/i.test(file.name)) throw new Error('รองรับเฉพาะไฟล์ .xlsx (ใน Google Sheet: ไฟล์ > ดาวน์โหลด > Microsoft Excel)');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  return wb;
}
async function parseWorkbook(file) {
  const wb = await loadWorkbook(file);
  const out = [];
  for (const ws of wb.worksheets.slice(0, 60)) out.push(...parseSheet(wb, ws));
  return out;
}

/* ---- ไฟล์รายชื่อจอ (ใช้นำเข้าเข้ากรุ๊ปจอ) ---- */
async function parseRosterFile(file) {
  const wb = await loadWorkbook(file);
  for (const ws of wb.worksheets) {
    let hr = 0;
    for (let r = 1; r <= Math.min(8, ws.rowCount) && !hr; r++)
      for (let c = 1; c <= 24; c++) if (COLS.store.test(clean(ctext(ws.getCell(r, c))))) { hr = r; break; }
    if (!hr) continue;
    const { map } = findCols(ws, hr + 1);
    const rows = [];
    for (let r = hr + 1; r <= ws.rowCount; r++) {
      const g = c => (c ? clean(ctext(ws.getCell(r, c))) : '');
      const store = g(map.store);
      if (!store || COLS.store.test(store)) continue;
      const n = parseInt(g(map.count), 10);
      rows.push({
        store_name: store, province: fixThai(g(map.prov)), device_id: g(map.device), screen_status: g(map.status),
        res: g(map.res), shelf: g(map.shelf), tagText: g(map.tags), screen_count: Number.isFinite(n) ? Math.min(99, Math.max(0, n)) : 1,
        hasShelfCol: map.shelf != null, hasTagCol: map.tags != null
      });
    }
    if (rows.length) return { sheet: ws.name, rows, cols: map };
  }
  return null;
}

/* ============================ ส่วนหน้าจอ ============================ */
function field(label, input) { return h('label', { class: 'f' }, label, input); }
function go(view, arg) { state.view = view; state.arg = arg ?? null; render(); }
function chipSet(items, set, onToggle, labelFn) {
  return h('div', { class: 'chips' }, items.map(it => h('button', { type: 'button', class: 'chip' + (set.has(it) ? ' on' : ''),
    onClick: () => { set.has(it) ? set.delete(it) : set.add(it); onToggle(); } }, (set.has(it) ? '✓ ' : '') + (labelFn ? labelFn(it) : it))));
}
async function setBrand(name) {
  state.brand = name; store('dr_brand', name);
  state.form = null; state.bs = null; state.filters = { ...state.filters, q: '', type: '', tag: '' }; state.cases = [];
  await refreshRoster(); render();
}

const NAV = [['list', 'รายการ'], ['form', '+ แจ้งสื่อ'], ['search', 'ค้นหาสาขา'], ['import', 'นำเข้าจากชีต'], ['settings', 'ตั้งค่า']];
function shell(content) {
  const dot = state.isAdmin && usagePct() >= 90 ? h('span', { class: 'dot', title: 'พื้นที่ใกล้เต็ม' }) : null;
  return h('div', null,
    h('header', null,
      h('h1', null, 'รีพอร์ตส่งสื่อ'),
      h('select', { class: 'brandsel', 'aria-label': 'แบรนด์', onChange: e => setBrand(e.target.value) },
        state.brands.map(b => h('option', { value: b.name, selected: b.name === state.brand }, b.name))),
      h('nav', { class: 'nav' }, NAV.map(([v, t]) => h('button', { class: 'btn' + (state.view === v || (v === 'list' && state.view === 'detail') ? ' on' : ''), onClick: () => go(v) }, t, v === 'settings' ? dot : null))),
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
    let el;
    if (!state.brand && v !== 'settings') {
      el = h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'ยังไม่มีแบรนด์ในระบบ'),
        h('p', { class: 'muted' }, state.isAdmin ? 'ไปที่ "ตั้งค่า" > "แบรนด์" เพื่อเพิ่มแบรนด์แรก' : 'ให้ admin เพิ่มแบรนด์ในหน้า "ตั้งค่า" ก่อน'),
        state.isAdmin ? h('button', { class: 'btn pri', onClick: () => { state.setTab = 'brand'; go('settings'); } }, 'ไปตั้งค่า') : null);
    } else {
      el = v === 'detail' ? await viewDetail(state.arg)
        : v === 'form' ? await viewForm(state.arg)
        : v === 'import' ? await viewImport()
        : v === 'search' ? await viewSearch()
        : v === 'settings' ? await viewSettings()
        : await viewList();
    }
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

/* ---------- ตารางแบบชีต ---------- */
function rowsTable(rows, { editable = false, onChange, onRemove, media } = {}) {
  const pairs = [];
  const starts = new Map(groupSpans(rows));
  const head1 = h('tr', null,
    ...XL_HEAD.map(t => h('th', { rowspan: 2 }, t)),
    media ? h('th', { colspan: 2 }, h('div', null, media.media_name), h('div', null, `${media.job_no || ''} (เลขงาน)`)) : null,
    h('th', { colspan: 2 }, 'สถานะการอัพสื่อ'),
    h('th', { rowspan: 2 }, 'หมายเหตุ'),
    editable && onRemove ? h('th', { rowspan: 2 }, '') : null);
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
    tr.append(h('td', null, r.screen_count), h('td', null, r.province), h('td', null, r.screen_type), h('td', null, r.shelf || '-'),
      h('td', null, r.res || '-'), h('td', null, r.device_id), h('td', { class: 'online' }, r.screen_status));
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
    if (editable && onRemove) tr.append(h('td', null, h('button', { class: 'x', 'aria-label': 'เอาจอนี้ออก', onClick: () => onRemove(r) }, '×')));
    tb.append(tr);
  });
  const wrap = h('div', { class: 'tablewrap' }, h('table', { class: 'sheet' }, h('thead', null, head1, head2), tb));
  wrap.refresh = () => pairs.forEach(([cs, cf, r]) => { cs.checked = !!r.success; cf.checked = !!r.fail; });
  return wrap;
}
const tagBadges = c => [...(c.types || []).map(x => h('span', { class: 'badge tag' }, x)), ...(c.tags || []).map(x => h('span', { class: 'badge tag2' }, x))];

/* ---------- รายการ ---------- */
async function viewList() {
  const F = state.filters;
  state.cases = await api.listCases({ brand: state.brand, from: F.from, to: F.to });
  const body = h('div');
  const q = h('input', { type: 'search', placeholder: 'ค้นหาชื่อสื่อ / ผู้แจ้ง / เลขงาน', maxlength: 100, value: F.q, onInput: e => { F.q = e.target.value; draw(); } });
  const from = h('input', { type: 'date', value: F.from, onChange: e => { F.from = e.target.value; render(); } });
  const to = h('input', { type: 'date', value: F.to, onChange: e => { F.to = e.target.value; render(); } });
  const setWeek = back => { [F.from, F.to] = weekRange(back); render(); };
  const filtered = () => {
    const t = lc(F.q);
    return state.cases.filter(c => (!t || [c.media_name, c.reporter, c.job_no].some(x => lc(x).includes(t)))
      && (!F.type || (c.types || []).includes(F.type)) && (!F.tag || (c.tags || []).includes(F.tag)));
  };
  const exportBtn = h('button', { class: 'btn', onClick: async () => {
    const list = filtered();
    if (!list.length) return toast('ไม่มีรายการให้ส่งออก', true);
    if (list.length > 40 && !await confirmDialog({ title: 'ส่งออกจำนวนมาก', lines: [`จะส่งออก ${list.length} งาน (1 งาน = 1 แท็บ) อาจใช้เวลาสักครู่`], okText: 'ส่งออก' })) return;
    exportBtn.disabled = true; toast('กำลังสร้างไฟล์ Excel…');
    try {
      const tag = F.from || F.to ? `${F.from || '…'}_ถึง_${F.to || '…'}` : todayISO();
      await exportCasesById(list.slice().reverse().map(x => x.id), `${safeName(state.brand)}_รีพอร์ตส่งสื่อ_${tag}.xlsx`);
    } catch (e) { toast('ส่งออกไม่สำเร็จ: ' + errMsg(e), true); }
    exportBtn.disabled = false;
  } }, 'ส่งออก Excel (ตามที่กรอง)');
  function draw() {
    const list = filtered();
    body.replaceChildren(
      h('div', { class: 'count' }, `แสดง ${list.length} จาก ${state.cases.length} งาน`),
      list.length ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ...['วันที่เสร็จ', 'ชื่อสื่อ', 'เลขงาน', 'ผู้แจ้ง', 'ประเภท', 'วันที่รับแจ้ง', 'สำเร็จ', 'ไม่สำเร็จ', 'ทั้งหมด'].map(t => h('th', null, t)))),
        h('tbody', null, list.map(c => h('tr', null,
          h('td', null, fmtDate(c.done_date)),
          h('td', null, h('button', { class: 'link', onClick: () => go('detail', c.id) }, c.media_name)),
          h('td', null, c.job_no), h('td', null, c.reporter), h('td', null, h('div', { class: 'chips sm' }, tagBadges(c))), h('td', null, fmtDate(c.received_date)),
          h('td', null, h('span', { class: 'badge' }, c.ok_rows)),
          h('td', null, c.fail_rows ? h('span', { class: 'badge bad' }, c.fail_rows) : '0'),
          h('td', null, c.total_rows))))))
        : h('p', { class: 'muted' }, 'ยังไม่มีข้อมูลในช่วงนี้'));
  }
  const chips = (items, key) => h('div', { class: 'chips', style: 'margin-top:8px' },
    h('button', { class: 'chip' + (!F[key] ? ' on' : ''), onClick: () => { F[key] = ''; render(); } }, 'ทั้งหมด'),
    items.map(x => h('button', { class: 'chip' + (F[key] === x ? ' on' : ''), onClick: () => { F[key] = x; render(); } }, x)));
  const el = h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row mb' },
        field('ตั้งแต่ (วันที่เสร็จ)', from), field('ถึง', to),
        h('div', { class: 'f grow' }, 'ค้นหา', q),
        h('button', { class: 'btn', onClick: () => setWeek(0) }, 'สัปดาห์นี้ (พฤ.–พ.)'),
        h('button', { class: 'btn', onClick: () => setWeek(1) }, 'สัปดาห์ก่อน'),
        h('button', { class: 'btn', onClick: () => { state.filters = { from: '', to: '', q: '', type: '', tag: '' }; render(); } }, 'ล้างตัวกรอง')),
      brandTypes().length ? h('div', { class: 'f' }, 'ประเภทจอ', chips(brandTypes().map(t => t.name), 'type')) : null,
      hasTags() ? h('div', { class: 'f', style: 'margin-top:8px' }, 'ประเภทสาขา', chips(tagList(), 'tag')) : null,
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn pri', onClick: () => go('form') }, '+ แจ้งสื่อใหม่'),
        h('button', { class: 'btn', onClick: () => go('import') }, 'นำเข้าจากชีต'), exportBtn),
      body));
  draw();
  return el;
}

/* ---------- Export พร้อมเลือกประเภทจอ ---------- */
function openExportDialog(c) {
  const types = uniqList(c.rows.map(r => r.screen_type));
  const sel = new Set(types);
  const chips = h('div', { class: 'chips' }), info = h('div', { class: 'count' });
  const draw = () => {
    const n = c.rows.filter(r => sel.has(r.screen_type)).length;
    info.textContent = n ? `ไฟล์ Excel จะมี ${n} แถว (หน้าตาเหมือนชีตเดิม มีรูปสื่อ ติ๊ก และคอลัมน์ Shelf / Resolution)` : 'ยังไม่ได้เลือกประเภทจอ';
    chips.replaceChildren(...types.map(t => h('button', { class: 'chip' + (sel.has(t) ? ' on' : ''), onClick: () => { sel.has(t) ? sel.delete(t) : sel.add(t); draw(); } },
      (sel.has(t) ? '✓ ' : '') + `${t} (${c.rows.filter(r => r.screen_type === t).length})`)));
  };
  draw();
  const m = openModal({ title: 'ส่งออก Excel', body: [h('div', { class: 'muted' }, 'เลือกประเภทจอที่จะใส่ในไฟล์'), chips, info],
    footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'ปิด'), h('button', { class: 'btn pri', onClick: async () => {
      if (!sel.size) return toast('กรุณาเลือกประเภทจออย่างน้อย 1 ประเภท', true);
      const full = sel.size === types.length;
      const rows = full ? c.rows : renumbered(c.rows.filter(r => sel.has(r.screen_type)));
      try {
        await exportItems([{ case: c, rows, imageBlob: c.imageBlob }], `${safeName(state.brand)}_${safeName(c.media_name)}${full ? '' : '_' + [...sel].join('+')}_${c.done_date}.xlsx`);
        if (full) await api.markExported([c.id]).catch(() => {});
        m.close();
      } catch (e) { toast('ส่งออกไม่สำเร็จ: ' + errMsg(e), true); }
    } }, 'ส่งออก')] });
}

/* ---------- รายละเอียดงาน ---------- */
async function viewDetail(id) {
  const c = await api.getCase(id);
  Object.assign(c, await loadImage(c.image_path));
  const cnt = countRows(c.rows);
  const info = (k, v) => h('div', { class: 'f' }, k, h('div', { style: 'color:var(--ink);font-size:15px' }, v || '-'));
  return h('div', null,
    h('div', { class: 'card' },
      h('div', { class: 'row mb' },
        h('button', { class: 'btn', onClick: () => go('list') }, '← กลับ'), h('span', { class: 'grow' }),
        h('button', { class: 'btn', onClick: () => openExportDialog(c) }, 'ส่งออก Excel'), h('button', { class: 'btn pri', onClick: () => go('form', c) }, 'แก้ไข')),
      h('div', { class: 'fgrid' }, info('แบรนด์', c.brand), info('ชื่อสื่อ', c.media_name), info('เลขงาน', c.job_no), info('ผู้แจ้ง', c.reporter),
        info('วันที่รับแจ้ง', fmtDate(c.received_date, true)), info('วันที่เสร็จ', fmtDate(c.done_date, true)),
        info('ผลรวม', `สำเร็จ ${cnt.ok} • ไม่สำเร็จ ${cnt.bad} • ไม่ได้ติ๊ก ${cnt.none} (ทั้งหมด ${cnt.total} แถว)`),
        info('ประเภท', h('div', { class: 'chips sm' }, tagBadges(c).length ? tagBadges(c) : '-')),
        info('แก้ไขล่าสุด', c.updated_at ? new Date(c.updated_at).toLocaleString('th-TH-u-ca-gregory') : '-'))),
    rowsTable(c.rows, { media: c }));
}

/* ---------- ฟอร์มแจ้งสื่อ / แก้ไข ---------- */
function validateForm(f) {
  if (!clean(f.media_name)) return 'กรุณากรอกชื่อสื่อ';
  if (!clean(f.reporter)) return 'กรุณากรอกชื่อผู้แจ้ง';
  if (!f.received_date || !f.done_date) return 'กรุณาเลือกวันที่รับแจ้งและวันที่เสร็จ';
  if (f.done_date < f.received_date) return 'วันที่เสร็จต้องไม่ก่อนวันที่รับแจ้ง';
  if (!f.types.size) return 'กรุณาเลือกประเภทจออย่างน้อย 1 ประเภท';
  return '';
}
const selSig = f => JSON.stringify([[...f.types].sort(), [...f.shelves].sort(), [...f.tags].sort()]);
function diffRows(a, b) {
  const A = new Map(), B = new Map();
  const put = (m, rows) => { const seen = {}; rows.forEach(r => { const k = rowKey(r); seen[k] = (seen[k] || 0) + 1; m.set(k + '#' + seen[k], r); }); };
  put(A, a); put(B, b);
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
function applyReporterDefault(f) {
  if (!hasTags() || f.tagsTouched) return false;
  const r = state.reporters.find(x => lc(x.name) === lc(f.reporter));
  if (!r) return false;
  const before = JSON.stringify([...f.tags].sort());
  f.tags = new Set((r.tags || []).filter(t => tagList().includes(t)));
  return before !== JSON.stringify([...f.tags].sort());
}
const NOTICE_SAMPLE = 'สื่อ : ตัวอย่างแคมเปญ\nผู้แจ้ง : คุณเอ\nวันที่รับแจ้ง : 11 พฤศจิกายน 26\nวันเวลาเสร็จ : 11 พฤศจิกายน 26\nเลขที่งาน : TRU000\nประเภทจอ : จอกลาง,จอซ้าย,จอขวา';
// อ่านข้อความแจ้งงานแบบ "หัวข้อ : ค่า" แล้วเติมฟอร์ม
function parseNotice(f, text) {
  const miss = []; let n = 0;
  const types = brandTypes(), allShelves = uniqList(types.flatMap(t => t.shelves));
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/); if (!m) continue;
    const k = m[1].trim(), v = m[2].trim(); if (!v) continue;
    if (/^(ชื่อ)?สื่อ$/.test(k)) { f.media_name = v; n++; }
    else if (/ผู้แจ้ง/.test(k)) { f.reporter = v; n++; applyReporterDefault(f); }
    else if (/รับแจ้ง/.test(k)) { const d = parseThaiDate(v); if (d) { f.received_date = d; n++; } else miss.push('วันที่รับแจ้ง'); }
    else if (/เสร็จ/.test(k)) { const d = parseThaiDate(v); if (d) { f.done_date = d; n++; } else miss.push('วันที่เสร็จ'); }
    else if (/เลข/.test(k)) { f.job_no = v.toUpperCase(); n++; }
    else if (/ประเภทสาขา|กรุ๊ป/.test(k) && hasTags()) {
      f.tags = new Set(); f.tagsTouched = true;
      for (const t of v.split(/[,，、/]|และ/).map(x => x.trim()).filter(Boolean)) { const hit = tagList().find(x => lc(x) === lc(t)); hit ? f.tags.add(hit) : miss.push(t); }
      n++;
    } else if (/ประเภทจอ|เชลฟ์|เชลท์|shelf|^จอ$/i.test(k)) {
      f.types = new Set(); f.shelves = new Set();
      for (const t0 of v.split(/[,，、/]|และ/).map(x => x.trim()).filter(Boolean)) {
        const t = lc(t0.replace(/^จอ\s*/, '').replace(/^shelf\s*/i, ''));
        const ty = types.find(x => lc(x.name) === lc(t0) || lc(x.name) === t);
        const sh = allShelves.find(x => lc(x) === t || lc(x) === lc(t0));
        if (ty) f.types.add(ty.name);
        else if (sh) { f.shelves.add(sh); types.filter(x => x.shelves.includes(sh)).forEach(x => f.types.add(x.name)); }
        else miss.push(t0);
      }
      n++;
    }
  }
  f.rows = null;
  toast(n ? `ดึงข้อมูล ${n} รายการใส่ฟอร์มแล้ว` + (miss.length ? ` (ไม่พบในระบบ: ${miss.join(', ')})` : '') : 'ไม่พบรูปแบบ "หัวข้อ : ค่า" ในข้อความ', !n);
}

async function viewForm(existing) {
  const isEdit = !!existing;
  let f;
  if (isEdit) {
    const typesFromRows = uniqList(existing.rows.map(r => r.screen_type));
    f = { id: existing.id, media_name: existing.media_name, job_no: existing.job_no || '', reporter: existing.reporter,
      received_date: existing.received_date, done_date: existing.done_date,
      types: new Set(existing.types && existing.types.length ? existing.types : typesFromRows), shelves: new Set(existing.shelves || []), tags: new Set(existing.tags || []),
      tagsTouched: true, rows: deep(existing.rows), rowSig: null, notice: '', image: { blob: null, src: existing.imgSrc || null } };
    f.rowSig = selSig(f);
  } else {
    if (!state.form) state.form = { id: null, media_name: '', job_no: '', reporter: '', received_date: todayISO(), done_date: todayISO(), types: new Set(), shelves: new Set(), tags: new Set(), tagsTouched: false, rows: null, rowSig: null, notice: '', image: { blob: null, src: null } };
    f = state.form;
  }
  const orig = isEdit ? { f: { ...deep({ ...f, types: [], shelves: [], tags: [], rows: [], image: null }) }, rows: deep(existing.rows), sig: f.rowSig } : null;
  if (!state.cases.length) { try { state.cases = await api.listCases({ brand: state.brand }); } catch (e) { /* ไม่มีรายชื่อแนะนำก็ไม่เป็นไร */ } }
  const box = h('div');

  function draw() {
    const typesCfg = brandTypes();
    const shelfPool = uniqList((f.types.size ? [...f.types] : typesCfg.map(t => t.name)).flatMap(t => shelvesOf(t)));
    const picked = f.types.size ? pickScreens(f.types, f.shelves, f.tags) : [];
    const again = () => draw();
    // ---- ช่องรูป: ต้องคลิกก่อนจึงวางด้วย Ctrl+V ได้ (กันวางผิดที่) ----
    const zone = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'ช่องวางรูปสื่อ' });
    const drawZone = () => zone.replaceChildren(
      h('div', null, f.image.src ? 'วางรูปใหม่เพื่อแทนที่ได้' : 'คลิกที่กรอบนี้ แล้วกด Ctrl+V เพื่อวางรูปที่แคปไว้'),
      f.image.src ? h('img', { src: f.image.src, alt: 'รูปสื่อ' }) : null);
    const setImg = async blobIn => {
      if (!blobIn || !/^image\//.test(blobIn.type)) return toast('ไฟล์ที่วางไม่ใช่รูปภาพ', true);
      if (blobIn.size > 15 * 1024 * 1024) return toast('รูปใหญ่เกิน 15 MB', true);
      try { f.image.blob = await shrinkImage(blobIn); f.image.src = await blobToDataURL(f.image.blob); drawZone(); toast('ได้รับรูปแล้ว'); }
      catch (err) { toast('อ่านรูปไม่สำเร็จ', true); }
    };
    zone.addEventListener('click', () => zone.focus());
    zone.addEventListener('paste', e => {
      e.preventDefault();
      const it = [...((e.clipboardData && e.clipboardData.items) || [])].find(i => i.type.startsWith('image/'));
      it ? setImg(it.getAsFile()) : toast('ไม่พบรูปในคลิปบอร์ด (แคปรูปก่อน แล้วกลับมาวาง)', true);
    });
    zone.addEventListener('dragover', e => e.preventDefault());
    zone.addEventListener('drop', e => { e.preventDefault(); setImg(e.dataTransfer.files[0]); });
    drawZone();
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none', onChange: e => { const inp = e.target, fl = inp.files[0]; if (fl) setImg(fl); inp.value = ''; } });

    const ta = h('textarea', { placeholder: 'วางข้อความแจ้งงานที่นี่ เช่น\nสื่อ : ...\nผู้แจ้ง : ...\nวันที่รับแจ้ง : ...\nประเภทจอ : จอกลาง,จอซ้าย', value: f.notice, onInput: e => { f.notice = e.target.value; } });
    const bind = (key, props) => h('input', { maxlength: 200, value: f[key], onInput: e => { f[key] = e.target.value; }, ...props });
    const uniqCase = k => uniqList(state.cases.map(c => clean(c[k])).filter(Boolean));

    const stores = new Set(picked.map(s => storeKey(s))).size;
    box.replaceChildren(
      isEdit ? null : h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'วางข้อความแจ้ง (ไม่ต้องพิมพ์ทีละช่อง)'), h('div', { class: 'f' }, ta),
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn pri', onClick: () => { parseNotice(f, ta.value); draw(); } }, 'ดึงข้อมูลใส่ฟอร์ม'),
          h('button', { class: 'btn', onClick: () => { f.notice = NOTICE_SAMPLE; draw(); } }, 'ใส่ข้อความตัวอย่าง'))),
      h('div', { class: 'card' }, h('h2', { class: 'sec' }, (isEdit ? 'แก้ไขสื่อ' : 'รายละเอียดสื่อ') + ` • แบรนด์ ${state.brand}`),
        h('div', { class: 'fgrid' },
          field('ชื่อสื่อ *', bind('media_name')),
          field('เลขงาน', bind('job_no', { placeholder: 'เช่น TRU000', maxlength: 50 })),
          field('ผู้แจ้ง *', bind('reporter', { list: 'dl-rep', onChange: e => { f.reporter = e.target.value; if (applyReporterDefault(f)) draw(); } })),
          field('วันที่รับแจ้ง *', h('input', { type: 'date', value: f.received_date, onChange: e => { f.received_date = e.target.value; } })),
          field('วันที่เสร็จ *', h('input', { type: 'date', value: f.done_date, onChange: e => { f.done_date = e.target.value; } }))),
        h('datalist', { id: 'dl-rep' }, uniqList([...state.reporters.map(r => r.name), ...uniqCase('reporter')]).map(v => h('option', { value: v })))),
      h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'เลือกจอที่สื่อนี้ขึ้น (ระบบติ๊กให้เอง)'),
        typesCfg.length ? [
          h('div', { class: 'lbl first' }, 'ประเภทจอ *'),
          chipSet(typesCfg.map(t => t.name), f.types, again, t => `${t} (${state.roster.filter(r => r.screen_type === t).length})`),
          shelfPool.length ? h('div', null, h('div', { class: 'lbl' }, 'Shelf (ชั้นวางสินค้า)'), chipSet(shelfPool, f.shelves, again),
            h('div', { class: 'hint' }, 'ไม่เลือก = ทุก Shelf ของประเภทจอที่เลือก')) : null,
          hasTags() ? h('div', null, h('div', { class: 'lbl' }, 'ประเภทสาขา (ติดได้หลายป้าย)'), chipSet(tagList(), f.tags, () => { f.tagsTouched = true; draw(); }),
            h('div', { class: 'hint' }, f.tagsTouched ? 'เลือกเอง ไม่เลือก = ไม่กรองด้วยป้าย' : 'เติมให้ตามผู้แจ้งถ้าตั้งไว้ แก้ได้')) : null,
          h('div', { class: 'count' }, f.types.size
            ? (isEdit && selSig(f) === orig.sig ? `รายการเดิม ${f.rows.length} แถว (ยังไม่เปลี่ยนตัวเลือก)` : (picked.length ? `จะได้ ${picked.length} จอ จาก ${stores} สาขา` : 'ไม่มีจอที่ตรงเงื่อนไขในรายชื่อหลัก'))
            : 'ยังไม่ได้เลือกประเภทจอ')
        ] : h('div', { class: 'note warn' }, 'แบรนด์นี้ยังไม่มีกรุ๊ปจอ ไปที่ "ตั้งค่า" > "กรุ๊ปจอ" เพื่อสร้างกรุ๊ปและนำเข้ารายชื่อจอก่อน')),
      h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'รูปสื่อ (ย่อให้อัตโนมัติ)'), zone,
        h('div', { class: 'hint' }, 'ต้องคลิกในกรอบก่อน แล้วกด Ctrl+V จึงจะวางรูปได้ (กันวางผิดที่) หรือกดปุ่มเลือกรูปด้านล่าง (ใช้บนมือถือ)'),
        h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm', type: 'button', onClick: () => fileIn.click() }, 'เลือกรูปจากเครื่อง'), fileIn)),
      h('div', { class: 'row', style: 'margin-top:4px' },
        h('button', { class: 'btn', onClick: () => go(isEdit ? 'detail' : 'list', isEdit ? f.id : null) }, 'ยกเลิก'),
        h('button', { class: 'btn pri', onClick: () => next() }, 'ตรวจสอบจอที่ติ๊กให้ →')));
  }
  function next() {
    const e = validateForm(f); if (e) return toast(e, true);
    const sig = selSig(f);
    if (!f.rows || f.rowSig !== sig) {
      const picked = pickScreens(f.types, f.shelves, f.tags);
      const old = new Map((f.rows || []).map(r => [rowKey(r), r]));
      f.rows = arrange(picked.map(s => { const r = toCaseRow(s); return old.get(rowKey(r)) || r; }));
      f.rowSig = sig;
    }
    if (!f.rows.length) return toast('ไม่มีจอที่ตรงเงื่อนไขในรายชื่อหลัก (ไปตั้งค่า > กรุ๊ปจอ เพื่อนำเข้ารายชื่อ)', true);
    openReview(f, orig);
  }
  draw();
  return box;
}

function openReview(f, orig) {
  const sum = h('span');
  const holder = h('div');
  const upd = () => { const c = countRows(f.rows); sum.textContent = `สำเร็จ ${c.ok} • ไม่สำเร็จ ${c.bad} • ไม่ติ๊ก ${c.none} / ทั้งหมด ${c.total} แถว ${new Set(f.rows.map(r => r.store_no)).size} สาขา`; };
  let tbl;
  const redraw = () => {
    f.rows.splice(0, f.rows.length, ...arrange(f.rows));
    tbl = rowsTable(f.rows, { editable: true, onChange: upd, onRemove: r => { f.rows.splice(f.rows.indexOf(r), 1); redraw(); } });
    holder.replaceChildren(tbl); upd();
  };
  const setAll = fn => { f.rows.forEach(fn); tbl.refresh(); upd(); };
  const found = h('div', { class: 'chips', style: 'flex-direction:column;margin-top:8px' });
  const drawFound = qv => {
    found.replaceChildren(); const q = lc(qv); if (!q) return;
    const have = new Set(f.rows.map(rowKey));
    state.roster.filter(s => !have.has(rowKey(s)) && [s.store_name, s.province, s.device_id, s.screen_type, s.shelf].some(x => lc(x).includes(q))).slice(0, 6)
      .forEach(s => found.append(h('div', { class: 'found' }, h('span', null, `${s.store_name} • ${s.screen_type}${s.shelf ? ' ' + s.shelf : ''} • ${s.device_id}`),
        h('button', { class: 'btn sm', onClick: () => { f.rows.push(toCaseRow(s)); drawFound(qv); redraw(); toast('เพิ่มจอแล้ว'); } }, '+ เพิ่ม'))));
    if (!found.children.length) found.append(h('div', { class: 'muted' }, 'ไม่พบจอที่ตรงกัน'));
  };
  const addBox = h('div', { class: 'card', style: 'margin:0' }, h('div', { class: 'f' }, 'เพิ่มจอเดี่ยว (ค้นหาสาขา / จังหวัด / Device ID)', h('input', { type: 'search', maxlength: 100, onInput: e => drawFound(e.target.value) })), found,
    state.isAdmin ? h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm', onClick: () => openAddStore(() => { toast('เพิ่มสาขาในรายชื่อหลักแล้ว ค้นหาด้านบนเพื่อเพิ่มเข้ารีพอร์ต'); }) }, '+ เพิ่มสาขาใหม่เข้ารายชื่อหลัก')) : null);
  redraw();
  let m; const saveBtn = h('button', { class: 'btn pri', onClick: () => commitForm(f, orig, m, saveBtn) }, orig ? 'บันทึกการแก้ไข' : 'บันทึก');
  m = openModal({
    title: 'ตรวจสอบอีกครั้งว่าติ๊กถูกจอไหม', wide: true,
    body: [
      h('div', { class: 'note' }, 'ระบบติ๊ก "สำเร็จ" ให้ทุกจอตามที่เลือกแล้ว ถ้าจอไหนไม่ถูก ติ๊กออก หรือติ๊ก "ไม่สำเร็จ" พร้อมหมายเหตุได้ เลขสาขานับใหม่ตามรีพอร์ตนี้ จอของสาขาเดียวกันใช้เลขเดียวกัน'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onClick: () => setAll(r => { r.success = true; r.fail = false; }) }, 'ติ๊กสำเร็จทั้งหมด'),
        h('button', { class: 'btn sm', onClick: () => setAll(r => { r.success = false; r.fail = false; }) }, 'ล้างติ๊กทั้งหมด')),
      addBox, holder],
    footer: [sum, h('span', { class: 'sp' }), h('button', { class: 'btn', onClick: () => m.close() }, '← ย้อนกลับไปแก้ฟอร์ม'), saveBtn]
  });
}

async function commitForm(f, orig, modal, btn) {
  if (!f.rows.length) return toast('ไม่มีจอในรีพอร์ต', true);
  if (orig) {
    const d = diffRows(orig.rows, f.rows), lines = [];
    const labels = { media_name: 'ชื่อสื่อ', job_no: 'เลขงาน', reporter: 'ผู้แจ้ง', received_date: 'วันที่รับแจ้ง', done_date: 'วันที่เสร็จ' };
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
    const id = await api.saveCase({ id: f.id, brand: state.brand, media_name: clean(f.media_name), job_no: clean(f.job_no),
      received_date: f.received_date, done_date: f.done_date, reporter: clean(f.reporter), image_path,
      types: [...f.types], shelves: [...f.shelves], tags: [...f.tags], rows: f.rows });
    modal.close(); toast('บันทึกแล้ว');
    if (!orig) state.form = null;
    state.cases = [];
    go('detail', id);
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e), true); btn.disabled = false; }
}

/* ---------- นำเข้าจากไฟล์ชีตเดิม ---------- */
/* จับแถวในชีตเดิมกับ "รายชื่อหลัก" (ที่ Import จากแม่แบบ) ด้วย Device ID ถ้าไม่มี Device ID ลองจับด้วยชื่อสาขาที่ไม่กำกวม
   แถวที่จับได้ จะใช้ชื่อสาขา/ประเภทจอ/Shelf/Resolution/ป้ายจากรายชื่อหลักแทนที่พิมพ์ในชีต */
const normDev = x => clean(x).toLowerCase().replace(/\s+/g, '');
const normNm = x => lc(clean(x)).replace(/[^a-z0-9฀-๿]/g, '');
function matchRoster(items) {
  const byDev = new Map(), byName = new Map(), byOld = new Map();
  for (const r of state.roster) {
    const d = normDev(r.device_id);
    if (d) { if (!byDev.has(d)) byDev.set(d, []); byDev.get(d).push(r); }
    for (const od of r.old_device_ids || []) { const o = normDev(od); if (o && o !== d) { if (!byOld.has(o)) byOld.set(o, []); byOld.get(o).push(r); } }
    const n = normNm(r.store_name); if (n) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(r); }
  }
  for (const it of items) {
    // Device ID ที่ซ้ำกันในชีตเดียวกันแต่เป็นคนละสาขา = กรอกผิด ห้ามเชื่อ ID นั้น
    const names = new Map();
    for (const row of it.rows) { const d = normDev(row.device_id); if (!d) continue; if (!names.has(d)) names.set(d, new Set()); names.get(d).add(normNm(row.store_name)); }
    const badDev = new Set([...names].filter(([, v]) => v.size > 1).map(([k]) => k));
    const st = { dev: 0, name: 0, none: [], badDev: badDev.size };
    for (const row of it.rows) {
      const dk = normDev(row.device_id), nm = normNm(row.store_name);
      let m = null, how = 'dev';
      const dc = dk && !badDev.has(dk) ? byDev.get(dk) || [] : [];
      if (dc.length === 1) m = dc[0];
      else if (dc.length > 1) { const x = dc.filter(r => normNm(r.store_name) === nm); if (x.length === 1) m = x[0]; }
      if (!m && dk && !badDev.has(dk)) { const oc = (byOld.get(dk) || []).filter((r, i, arr) => arr.indexOf(r) === i); if (oc.length === 1 && !dc.length) m = oc[0]; }
      if (!m) {
        how = 'name';
        const cand = byName.get(nm) || [];
        const same = cand.filter(x => lc(x.screen_type) === lc(row.screen_type));
        m = cand.length === 1 ? cand[0] : same.length === 1 ? same[0] : null;
      }
      if (!m) { st.none.push(row); continue; }
      how === 'dev' ? st.dev++ : st.name++;
      Object.assign(row, { store_name: m.store_name, province: m.province || row.province, screen_type: m.screen_type, shelf: m.shelf || '', res: m.res || '',
        tags: [...(m.tags || [])], device_id: m.device_id || row.device_id });
    }
    it.rows = arrange(it.rows);
    it.match = st;
  }
}

async function viewImport() {
  if (!state.cases.length) { try { state.cases = await api.listCases({ brand: state.brand }); } catch (e) { /* ข้าม */ } }
  const box = h('div');
  let items = [];
  const bulkRep = h('input', { maxlength: 100, placeholder: 'ผู้แจ้ง (ใช้กับทุกแท็บ)' });

  const file = h('input', { type: 'file', accept: '.xlsx', onChange: async e => {
    const inp = e.target, fl = inp.files[0]; if (!fl) return;
    box.replaceChildren(h('p', { class: 'muted' }, 'กำลังอ่านไฟล์…'));
    try {
      items = await parseWorkbook(fl);
      if (items.length) matchRoster(items);
      if (!items.length) return box.replaceChildren(h('div', { class: 'note warn' }, 'ไม่พบตารางจอในไฟล์นี้ (ต้องมีหัวตาราง 2 แถว และข้อมูลเริ่มแถวที่ 3 เหมือนชีตเดิม)'));
      for (const it of items) it.src = it.blob ? await blobToDataURL(it.blob).catch(() => null) : null;
      drawItems();
    } catch (err) { box.replaceChildren(h('div', { class: 'note warn' }, 'อ่านไฟล์ไม่สำเร็จ: ' + errMsg(err))); }
    finally { inp.value = ''; }
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
          field('ชื่อสื่อ *', inp('media_name')), field('เลขงาน', inp('job_no')),
          field('ผู้แจ้ง *', inp('reporter')), field('วันที่รับแจ้ง *', inp('received_date', 'date')), field('วันที่เสร็จ *', inp('done_date', 'date'))),
        it.src ? h('img', { class: 'imgprev', src: it.src, alt: 'รูปสื่อ' }) : null,
        it.match ? h('div', { class: 'note' + (it.match.none.length || it.match.badDev ? ' warn' : ''), style: 'margin-top:8px' },
          `จับกับรายชื่อหลักได้ ${it.match.dev + it.match.name} แถว (Device ID ${it.match.dev}` + (it.match.name ? ` • ชื่อสาขา ${it.match.name}` : '') + `)` +
          (it.match.badDev ? ` • Device ID ซ้ำกันคนละสาขาในชีตนี้ ${it.match.badDev} ค่า (ไม่ใช้ ID นั้นจับ ใช้ชื่อสาขาแทน)` : '') +
          (it.match.none.length ? ` • ไม่พบในรายชื่อหลัก ${it.match.none.length} แถว: ` + it.match.none.slice(0, 6).map(r => `${r.device_id || '(ไม่มี Device ID)'} ${r.store_name || ''}`.trim()).join(', ') + (it.match.none.length > 6 ? ' …' : '') : '')) : null,
        dup ? h('div', { class: 'note warn', style: 'margin-top:8px' }, `มีงานเลขงาน ${it.job_no} วันที่รับแจ้งเดียวกันอยู่ในระบบแล้ว (${dup.media_name}) ระวังนำเข้าซ้ำ`) : null,
        ...it.warnings.map(w => h('div', { class: 'note', style: 'margin-top:8px' }, '⚠ ' + w)));
    });
    const go1 = h('button', { class: 'btn pri', onClick: () => doImport(go1) }, 'นำเข้าที่เลือก');
    box.replaceChildren(
      h('div', { class: 'card' }, h('div', { class: 'row' },
        h('div', { class: 'f grow' }, `กรอกครั้งเดียวใช้กับทุกแท็บ (แบรนด์ ${state.brand})`, bulkRep),
        h('button', { class: 'btn', onClick: () => { for (const it of items) if (bulkRep.value.trim()) it.reporter = bulkRep.value.trim(); drawItems(); } }, 'ใช้กับทุกแท็บ'))),
      ...cards,
      h('div', { class: 'card' }, go1));
  }

  async function doImport(btn) {
    const sel = items.filter(i => i.include);
    if (!sel.length) return toast('ยังไม่ได้เลือกแท็บ', true);
    for (const it of sel) {
      const e = validateForm({ ...it, types: new Set(['x']) });
      if (e) return toast(`แท็บ "${it.name}": ${e}`, true);
    }
    if (!state.roster.length) return toast('ยังไม่มีรายชื่อจอหลัก ไปที่ ตั้งค่า > กรุ๊ปจอ แล้ว Import แม่แบบก่อน', true);
    const total = sel.reduce((a, i) => a + i.rows.length, 0), lost = sel.reduce((a, i) => a + (i.match ? i.match.none.length : 0), 0);
    if (!await confirmDialog({ title: 'ยืนยันนำเข้า?', lines: [`นำเข้า ${sel.length} งาน รวม ${total} แถว เข้าแบรนด์ ${state.brand}`, lost ? `มี ${lost} แถวที่ไม่พบในรายชื่อหลัก จะนำเข้าตามที่เขียนในชีต (ค้นหาสาขาอาจไม่เจอแถวเหล่านี้)` : '', 'ข้อมูลจะถูกบันทึกเข้าระบบจริง'].filter(Boolean), okText: 'นำเข้า' })) return;
    btn.disabled = true;
    try {
      let n = 0;
      for (const it of sel) {
        toast(`กำลังนำเข้า ${++n}/${sel.length}…`);
        const image_path = it.blob ? await api.uploadImage(await shrinkImage(it.blob)) : null;
        await api.saveCase({ id: null, brand: state.brand, media_name: clean(it.media_name), job_no: clean(it.job_no),
          received_date: it.received_date, done_date: it.done_date, reporter: clean(it.reporter), image_path,
          types: uniqList(it.rows.map(r => r.screen_type)), shelves: uniqList(it.rows.map(r => r.shelf).filter(Boolean)), tags: uniqList(it.rows.flatMap(r => r.tags || [])), rows: it.rows });
      }
      toast(`นำเข้าสำเร็จ ${sel.length} งาน`); state.cases = []; go('list');
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + errMsg(e), true); btn.disabled = false; }
  }

  return h('div', null,
    h('div', { class: 'card' },
      h('h2', { class: 'sec' }, `นำเข้าจากไฟล์ชีตเดิม (แบรนด์ ${state.brand})`),
      h('p', { class: 'muted' }, 'ใน Google Sheet กด ไฟล์ > ดาวน์โหลด > Microsoft Excel (.xlsx) แล้วเลือกไฟล์ที่นี่ 1 แท็บ = 1 งาน (ถ้าแท็บเดียวมีหลายสื่อวางต่อกัน ระบบแยกให้เป็นหลายงาน) ระบบจับแต่ละแถวกับ "รายชื่อหลัก" ด้วย Device ID (ต้อง Import แม่แบบรายชื่อจอก่อน) แล้วแสดงตัวอย่างให้ตรวจก่อนบันทึกจริง (ไฟล์ที่ Export จากเว็บนี้ก็นำกลับเข้ามาได้)'),
      file),
    box);
}

/* ---------- ค้นหาสาขา (สำหรับทีมทำราคา) ---------- */
async function viewSearch() {
  if (!state.bs || state.bs.brand !== state.brand) {
    state.bs = { brand: state.brand, q: '', store: null, types: new Set(), shelves: new Set(), tags: new Set(), from: '', to: '', sel: new Set() };
  }
  const bs = state.bs;
  const cfgTypes = brandTypes();
  const shelfPool = uniqList((bs.types.size ? [...bs.types] : cfgTypes.map(t => t.name)).flatMap(t => shelvesOf(t)));
  const again = () => render();
  const setRange = (a, b) => { bs.from = a; bs.to = b; render(); };
  const results = h('div');
  let seq = 0, timer = null, matchedNow = [];
  const presets = [['เดือนนี้', () => setRange(...monthRange(0))], ['เดือนที่แล้ว', () => setRange(...monthRange(1))],
    ['3 เดือนล่าสุด', () => { const [a] = monthRange(2); setRange(a, todayISO()); }], ['ทั้งหมด', () => setRange('', '')]];
  const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 250); };

  const filt = h('div', { class: 'card' },
    h('div', { class: 'f' }, 'พิมพ์ชื่อสาขา หรือ Device ID', h('input', { type: 'search', maxlength: 100, value: bs.q, placeholder: 'เช่น One Bangkok', onInput: e => { bs.q = e.target.value; bs.store = null; schedule(); } })),
    cfgTypes.length ? h('div', null, h('div', { class: 'lbl' }, 'ประเภทจอ'), chipSet(cfgTypes.map(t => t.name), bs.types, again)) : null,
    shelfPool.length ? h('div', null, h('div', { class: 'lbl' }, 'Shelf'), chipSet(shelfPool, bs.shelves, again)) : null,
    hasTags() ? h('div', null, h('div', { class: 'lbl' }, 'ประเภทสาขา'), chipSet(tagList(), bs.tags, again)) : null,
    h('div', { class: 'lbl' }, 'ช่วงวันที่รับแจ้ง'),
    h('div', { class: 'row' },
      h('input', { type: 'date', class: 'dt', value: bs.from, 'aria-label': 'จากวันที่', onChange: e => { bs.from = e.target.value; load(); } }), h('span', null, 'ถึง'),
      h('input', { type: 'date', class: 'dt', value: bs.to, 'aria-label': 'ถึงวันที่', onChange: e => { bs.to = e.target.value; load(); } })),
    h('div', { class: 'chips', style: 'margin-top:8px' }, presets.map(([l, fn]) => h('button', { class: 'chip', onClick: fn }, l))),
    h('div', { class: 'hint' }, 'ไม่เลือกอะไร = ไม่กรอง ใช้หลายตัวกรองพร้อมกันได้ ตัวเลขนับเฉพาะสื่อที่ส่งสำเร็จ'));

  const params = () => ({ brand: state.brand, from: bs.from, to: bs.to, types: [...bs.types], shelves: [...bs.shelves], tags: [...bs.tags] });
  async function load() {
    const my = ++seq;
    results.replaceChildren(h('p', { class: 'muted' }, 'กำลังค้นหา…'));
    try {
      const q = clean(bs.q);
      const [stores, hits, cases] = await Promise.all([
        q && bs.store == null ? api.storeCounts({ ...params(), q: likeEsc(q) }) : Promise.resolve([]),
        api.searchCases({ ...params(), store: bs.store != null ? bs.store : likeEsc(q), exact: bs.store != null }),
        api.listCases({ brand: state.brand, from: bs.from, to: bs.to, field: 'received_date' })
      ]);
      if (my !== seq) return;
      const hit = new Map(hits.map(x => [x.case_id, x.hit]));
      matchedNow = cases.filter(c => hit.has(c.id)).map(c => ({ c, hit: hit.get(c.id) }));
      const vis = new Set(matchedNow.map(m => m.c.id)); [...bs.sel].forEach(id => { if (!vis.has(id)) bs.sel.delete(id); });
      draw(stores);
    } catch (e) { if (my === seq) results.replaceChildren(h('div', { class: 'note warn' }, 'ค้นหาไม่สำเร็จ: ' + errMsg(e))); }
  }

  function draw(stores) {
    const q = clean(bs.q);
    const storeCard = bs.store != null
      ? h('div', { class: 'card row' }, h('b', null, 'สาขา: ' + bs.store), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onClick: () => { bs.store = null; bs.q = ''; render(); } }, 'ล้างสาขา'))
      : q ? h('div', { class: 'card' }, h('h2', { class: 'sec' }, `สาขาที่พบ ${stores.length}`),
          stores.length ? stores.map(s => h('button', { class: 'found', onClick: () => { bs.store = s.store_name; bs.q = s.store_name; render(); } },
            h('span', null, h('b', null, s.store_name), h('span', { class: 'hint' }, '  ' + (s.province || ''))), h('span', { class: 'badge' + (s.n ? '' : ' zero') }, `สื่อ ${s.n} งาน`)))
            : h('div', { class: 'muted' }, 'ไม่พบสาขาที่ตรงกับคำค้น'),
          stores.length >= 60 ? h('div', { class: 'hint' }, 'แสดง 60 สาขาแรก พิมพ์ชื่อให้ตรงขึ้นเพื่อกรอง') : null) : null;
    const m = matchedNow;
    const allOn = m.length > 0 && m.every(x => bs.sel.has(x.c.id));
    const list = h('div'); let lastKey = '';
    m.forEach(({ c, hit }) => {
      const key = c.received_date.slice(0, 7);
      if (key !== lastKey) { lastKey = key; list.append(h('div', { class: 'mh' }, monthLabel(c.received_date))); }
      list.append(h('div', { class: 'mrow' },
        h('input', { type: 'checkbox', class: 'cb ok', checked: bs.sel.has(c.id), 'aria-label': 'เลือกสื่อ ' + c.media_name, onChange: e => { e.target.checked ? bs.sel.add(c.id) : bs.sel.delete(c.id); draw(stores); } }),
        h('div', { style: 'flex:1;min-width:0' },
          h('button', { class: 'tt', onClick: () => go('detail', c.id) }, c.media_name),
          h('div', { class: 'hint' }, `${c.job_no || '-'} • ${c.reporter} • รับแจ้ง ${fmtDate(c.received_date)}`),
          h('div', { class: 'row', style: 'margin-top:4px' }, h('span', { class: 'badge' }, `สำเร็จตามตัวกรอง ${hit} จอ`), h('span', { class: 'hint' }, `ทั้งรีพอร์ต ${c.total_rows} จอ`),
            c.exported_at ? h('span', { class: 'badge tag' }, 'Export แล้ว') : null))));
    });
    const expBtn = h('button', { class: 'btn pri', disabled: bs.sel.size === 0, onClick: async () => {
      const ids = m.filter(x => bs.sel.has(x.c.id)).map(x => x.c.id).reverse();
      expBtn.disabled = true; toast(`กำลังสร้างไฟล์ ${ids.length} ชีต…`);
      try {
        const tag = [bs.store || clean(bs.q), ...bs.types].filter(Boolean).join('_');
        await exportCasesById(ids, `${safeName(state.brand)}_${safeName(tag || 'รีพอร์ต')}_${todayISO()}.xlsx`);
        state.cases = []; load();
      } catch (e) { toast('ส่งออกไม่สำเร็จ: ' + errMsg(e), true); expBtn.disabled = false; }
    } }, `Export Excel (${bs.sel.size} สื่อ)`);
    results.replaceChildren(storeCard,
      h('div', { class: 'card' }, h('div', { class: 'row' },
        h('input', { type: 'checkbox', class: 'cb ok', checked: allOn, 'aria-label': 'เลือกทั้งหมด', onChange: e => { m.forEach(x => e.target.checked ? bs.sel.add(x.c.id) : bs.sel.delete(x.c.id)); draw(stores); } }),
        h('b', null, `พบ ${m.length} สื่อ`), h('span', { class: 'hint' }, 'นับเฉพาะที่ส่งสำเร็จ'), h('span', { class: 'sp' }), expBtn),
        h('div', { class: 'hint', style: 'margin-top:6px' }, 'ไฟล์ Export 1 สื่อ = 1 ชีต แต่ละชีตเป็นตารางเต็มของสื่อนั้น (ทุกสาขา ทั้งสำเร็จและไม่สำเร็จ)')),
      m.length ? list : h('div', { class: 'card muted' }, 'ไม่พบสื่อที่ตรงกับตัวกรอง ลองล้างตัวกรองหรือขยายช่วงวันที่'));
  }
  load();
  return h('div', null, filt, results);
}

/* ============================ ตั้งค่า ============================ */
const SETTING_TABS = [['groups', 'กรุ๊ปจอ', false], ['roster', 'รายชื่อจอ', false], ['brand', 'แบรนด์ / ผู้แจ้ง', true], ['space', 'พื้นที่ / ลบสื่อเก่า', true]];
const adminOnlyNote = () => h('div', { class: 'note' }, 'ดูได้อย่างเดียว การเพิ่ม/แก้/ลบต้องเป็น admin');

async function viewSettings() {
  if (!SETTING_TABS.some(([k, , adm]) => k === state.setTab && (!adm || state.isAdmin))) state.setTab = 'groups';
  if (state.isAdmin && state.setTab === 'space') await refreshUsage();
  const t = state.setTab;
  const body = t === 'groups' ? sectionGroups() : t === 'roster' ? sectionRoster() : t === 'brand' ? sectionBrand() : await sectionSpace();
  return h('div', null,
    h('div', { class: 'chips', style: 'margin-bottom:12px' }, SETTING_TABS.filter(([, , adm]) => !adm || state.isAdmin).map(([k, l]) =>
      h('button', { class: 'chip' + (t === k ? ' on' : ''), onClick: () => { state.setTab = k; render(); } }, l))),
    body);
}

/* ---------- กรุ๊ปจอ ---------- */
function sectionGroups() {
  const B = curBrand();
  const types = brandTypes();
  const cards = types.map(t => {
    const rows = state.roster.filter(r => r.screen_type === t.name);
    const shelfIn = h('input', { placeholder: 'เพิ่ม Shelf เช่น Sheep', maxlength: 50 });
    const resIn = h('input', { value: t.default_res, placeholder: 'Resolution ตั้งต้น', maxlength: 30, style: 'width:130px', 'aria-label': 'Resolution ตั้งต้น' });
    return h('div', { class: 'card' },
      h('div', { class: 'row mb' }, h('h2', { class: 'sec', style: 'margin:0' }, t.name), h('span', { class: 'badge tag' }, `${rows.length} จอ • ${new Set(rows.map(storeKey)).size} สาขา`), h('span', { class: 'sp' }),
        state.isAdmin ? h('button', { class: 'btn sm pri', onClick: () => openImportGroup(t) }, 'Import ไฟล์') : null,
        state.isAdmin && !rows.length ? h('button', { class: 'btn sm', onClick: async () => {
          if (!await confirmDialog({ title: `ลบกรุ๊ป "${t.name}"?`, lines: ['กรุ๊ปนี้ยังไม่มีจอ ลบได้'], okText: 'ลบ', danger: true })) return;
          try { await api.typeDelete(state.brand, t.name); await refreshConfig(); render(); } catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e), true); }
        } }, 'ลบกรุ๊ป') : null),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Resolution ตั้งต้นของกรุ๊ป (ใช้เมื่อไฟล์ไม่ระบุ Resolution ของจอ):'),
        state.isAdmin ? resIn : h('b', null, t.default_res || '-'),
        state.isAdmin ? h('button', { class: 'btn sm', onClick: async () => { try { await api.typeUpdate(state.brand, t.name, { default_res: clean(resIn.value) }); await refreshConfig(); toast('บันทึก Resolution แล้ว'); render(); } catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e), true); } } }, 'บันทึก') : null),
      h('div', { class: 'lbl' }, 'Shelf ในกรุ๊ปนี้'),
      t.shelves.length ? h('div', { class: 'chips' }, t.shelves.map(s => h('span', { class: 'badge tag big' }, s, state.isAdmin ? h('button', { class: 'x sm', 'aria-label': 'ลบ Shelf ' + s, onClick: async () => {
        if (!await confirmDialog({ title: `เอา Shelf "${s}" ออกจากรายการ?`, lines: ['จอที่มีค่า Shelf นี้อยู่แล้วไม่ถูกลบ แค่ไม่แสดงเป็นตัวเลือก'], okText: 'เอาออก' })) return;
        try { await api.typeUpdate(state.brand, t.name, { shelves: t.shelves.filter(x => x !== s) }); await refreshConfig(); render(); } catch (e) { toast('ไม่สำเร็จ: ' + errMsg(e), true); }
      } }, '×') : null))) : h('div', { class: 'muted' }, 'ไม่มี Shelf (กรุ๊ปนี้ไม่แยก Shelf)'),
      state.isAdmin ? h('div', { class: 'row', style: 'margin-top:8px' }, shelfIn, h('button', { class: 'btn sm', onClick: async () => {
        const v = clean(shelfIn.value); if (!v) return; if (t.shelves.includes(v)) return toast('มี Shelf นี้แล้ว', true);
        try { await api.typeUpdate(state.brand, t.name, { shelves: [...t.shelves, v] }); await refreshConfig(); toast(`เพิ่ม Shelf "${v}" แล้ว`); render(); } catch (e) { toast('ไม่สำเร็จ: ' + errMsg(e), true); }
      } }, '+ เพิ่ม Shelf')) : null);
  });
  return h('div', null,
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'sec', style: 'margin:0' }, `กรุ๊ปจอของแบรนด์ ${B ? B.name : ''}`), h('span', { class: 'sp' }),
      state.isAdmin ? h('button', { class: 'btn pri', onClick: openCreateGroup }, '+ สร้างกรุ๊ปจอ') : null),
      h('p', { class: 'muted' }, 'สร้างกรุ๊ปตามประเภทจอ (เช่น LED, Acc Wall) แล้วกด "Import ไฟล์" เข้ากรุ๊ปนั้น ระบบใส่ประเภทจอให้ทุกแถวเอง'),
      state.isAdmin ? null : adminOnlyNote()),
    ...(cards.length ? cards : [h('div', { class: 'card muted' }, 'ยังไม่มีกรุ๊ปจอ')]));
}

function openCreateGroup() {
  const name = h('input', { placeholder: 'เช่น LED', list: 'dl-types', maxlength: 50 }), res = h('input', { placeholder: 'เช่น 1920x1080 (ไม่ใส่ก็ได้)', maxlength: 30 });
  const m = openModal({ title: 'สร้างกรุ๊ปจอ',
    body: [field('ชื่อประเภทจอ', name), h('datalist', { id: 'dl-types' }, ['LED', 'Digital Poster', 'Acc Wall', 'VDO Wall', 'TV'].filter(x => !typeCfg(x)).map(x => h('option', { value: x }))),
      field('Resolution ตั้งต้น', res), h('div', { class: 'hint' }, 'สร้างแล้วกด "Import ไฟล์" ในกรุ๊ปนั้นต่อได้เลย')],
    footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'ปิด'), h('button', { class: 'btn pri', onClick: async () => {
      const v = clean(name.value); if (!v) return toast('กรุณาใส่ชื่อประเภทจอ', true); if (typeCfg(v)) return toast('มีกรุ๊ปนี้อยู่แล้ว', true);
      try { await api.typeInsert({ brand: state.brand, name: v, default_res: clean(res.value), shelves: [], sort: brandTypes().length }); await refreshConfig(); m.close(); toast(`สร้างกรุ๊ป "${v}" แล้ว`); render(); }
      catch (e) { toast('สร้างไม่สำเร็จ: ' + errMsg(e), true); } } }, 'สร้างกรุ๊ป')] });
}

/* ---------- Import ไฟล์รายชื่อจอเข้ากรุ๊ป ---------- */
function openImportGroup(t) {
  const hasShelfBase = t.shelves.length > 0 || ['Acc Wall', 'Digital Poster'].includes(t.name);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let items = [], fileHasShelf = false, warn = [];
  const ta = h('textarea', { placeholder: 'หรือวางชื่อสาขาที่นี่ 1 บรรทัดต่อ 1 จอ' + (hasShelfBase ? ' เช่น\nOne Bangkok จอซ้าย' : ''), maxlength: 60000 });
  const out = h('div'), sum = h('span', { class: 'sp' });
  const hasShelf = () => hasShelfBase || fileHasShelf;
  let dupIds = new Set();   // Device ID ที่ซ้ำกันในไฟล์ (คนละจอใช้ ID เดียวกัน) -> ห้ามใช้ ID นี้จับว่าเป็นจอเดิม
  const dn = x => clean(x).toLowerCase().replace(/\s+/g, '');
  const findExisting = it => state.roster.find(r => r.screen_type === t.name && (it.device_id && !dupIds.has(dn(it.device_id)) ? dn(r.device_id) === dn(it.device_id) : (lc(r.store_name) === lc(it.store_name) && (r.shelf || '') === (it.shelf || ''))));
  const build = rows => {
    warn = [];
    items = rows.map(r => {
      let store = r.store_name, shelf = clean(r.shelf), choice = '', guess = '';
      if (hasShelf()) {
        if (!shelf) {
          for (const sh of [...t.shelves].sort((a, b) => b.length - a.length)) { const re = new RegExp('\\s+(จอ\\s*)?(shelf\\s*)?' + esc(sh) + '$', 'i'); if (re.test(store)) { store = store.replace(re, '').trim(); shelf = sh; break; } }
          if (!shelf) { const mm = store.match(/^(.*?)\s+(?:จอ\s*)?([^\s]+)$/); if (mm) { guess = mm[2]; store = mm[1]; } }
        }
        if (shelf) { const hit = t.shelves.find(x => lc(x) === lc(shelf)); if (hit) choice = hit; else { choice = 'new'; guess = shelf; } }
      }
      const tags = [];
      if (r.tagText && hasTags()) for (const x of r.tagText.split(/[,，、/;]|และ/).map(clean).filter(Boolean)) { const hit = tagList().find(y => lc(y) === lc(x)); hit ? tags.push(hit) : warn.push(`ไม่รู้จักประเภทสาขา "${x}"`); }
      return { raw: r.store_name, store_name: store, province: r.province || '', device_id: r.device_id || '', status: r.screen_status || '', res: r.res || '', count: r.screen_count || 1,
        tagText: r.tagText || '', tags, shelf: choice === 'new' ? '' : shelf ? (t.shelves.find(x => lc(x) === lc(shelf)) || shelf) : '', choice, guess };
    });
    { const seen = new Map(); dupIds = new Set();
      items.forEach(it => { const d = dn(it.device_id); if (d) seen.set(d, (seen.get(d) || 0) + 1); });
      seen.forEach((n, d) => { if (n > 1) dupIds.add(d); });
      if (dupIds.size) warn.push(`Device ID ซ้ำกันในไฟล์ ${dupIds.size} ค่า (${[...dupIds].slice(0, 5).join(', ')}${dupIds.size > 5 ? ' …' : ''}) กรุณาแก้ในไฟล์ให้ไม่ซ้ำ ระบบจะไม่ใช้ ID เหล่านี้จับจอเดิม จะใช้ชื่อสาขา+Shelf แทน`); }
    drawOut();
  };
  const resolved = it => !hasShelf() || (it.choice && it.choice !== '');
  const finalShelf = it => it.choice === 'new' ? it.guess : (it.choice === 'skip' ? '' : it.choice);
  const drawOut = () => {
    const act = items.filter(it => resolved(it) && it.choice !== 'skip');
    const exist = act.filter(it => findExisting({ ...it, shelf: finalShelf(it) })).length;
    const need = items.filter(it => !resolved(it)).length, skip = items.filter(it => it.choice === 'skip').length;
    sum.textContent = items.length ? `เพิ่มใหม่ ${act.length - exist} • อัปเดตทับ ${exist} • ต้องเลือก Shelf ${need} • ข้าม ${skip}` : '';
    out.replaceChildren(
      warn.length ? h('div', { class: 'note warn' }, uniqList(warn).join(' • ')) : null,
      ...items.slice(0, 300).map(it => {
        const isUpd = !!findExisting({ ...it, shelf: finalShelf(it) });
        return h('div', { class: 'rv' },
          h('div', { class: 'nm' }, h('b', null, it.store_name), h('div', { class: 'hint' }, [it.province, it.device_id, it.res && 'Resolution ' + it.res, it.tags.join('+')].filter(Boolean).join(' • ') || it.raw)),
          h('span', { class: 'badge' + (isUpd ? ' tag' : '') }, isUpd ? 'อัปเดต' : 'ใหม่'),
          hasShelf() ? h('select', { 'aria-label': 'Shelf', onChange: e => { it.choice = e.target.value; drawOut(); } },
            [['', '-- เลือก Shelf --'], ...t.shelves.map(s => [s, 'Shelf ' + s]), ...(it.guess ? [['new', `สร้าง Shelf ใหม่: ${it.guess}`]] : []), ['skip', 'ข้ามแถวนี้']].map(([v, l]) => h('option', { value: v, selected: it.choice === v }, l))) : null);
      }), items.length > 300 ? h('div', { class: 'hint' }, `แสดง 300 แถวแรกจาก ${items.length} (ทุกแถวถูกนำเข้า)`) : null);
  };
  const file = h('input', { type: 'file', accept: '.xlsx', onChange: async e => {
    const inp = e.target, fl = inp.files[0]; if (!fl) return;
    out.replaceChildren(h('p', { class: 'muted' }, 'กำลังอ่านไฟล์…'));
    try {
      const r = await parseRosterFile(fl);
      if (!r) return out.replaceChildren(h('div', { class: 'note warn' }, 'ไม่พบหัวตารางที่มีคอลัมน์ Store Name (หรือ ชื่อสาขา) ในไฟล์นี้'));
      fileHasShelf = r.rows.some(x => x.hasShelfCol);
      out.dataset.sheet = r.sheet; build(r.rows);
      toast(`อ่านแท็บ "${r.sheet}" ได้ ${r.rows.length} แถว`);
    } catch (err) { out.replaceChildren(h('div', { class: 'note warn' }, 'อ่านไฟล์ไม่สำเร็จ: ' + errMsg(err))); }
    finally { inp.value = ''; }
  } });
  const doImport = async btn => {
    const act = items.filter(it => resolved(it) && it.choice !== 'skip');
    if (!act.length) return toast('ไม่มีแถวที่พร้อมนำเข้า', true);
    if (items.some(it => !resolved(it)) && !await confirmDialog({ title: 'ยังมีแถวที่ไม่ได้เลือก Shelf', lines: [`${items.filter(it => !resolved(it)).length} แถวจะถูกข้าม`], okText: 'นำเข้าที่เหลือ' })) return;
    btn.disabled = true;
    try {
      const newShelves = uniqList(act.filter(it => it.choice === 'new').map(it => it.guess));
      if (newShelves.length) await api.typeUpdate(state.brand, t.name, { shelves: uniqList([...t.shelves, ...newShelves]) });
      const ins = [], upd = [];
      for (const it of act) {
        const shelf = finalShelf(it) || '';
        const ex = findExisting({ ...it, shelf });
        if (ex) {
          const p = { shelf };
          if (it.province) p.province = it.province; if (it.status) p.screen_status = it.status; if (it.res) p.res = it.res;
          if (it.tagText) p.tags = it.tags; if (it.device_id) p.device_id = it.device_id;
          upd.push([ex.id, p]);
        } else ins.push({ brand: state.brand, store_no: null, store_name: it.store_name, province: it.province, screen_count: it.count, screen_type: t.name, shelf,
          res: it.res || t.default_res || '', tags: it.tags, device_id: it.device_id, screen_status: it.status || 'Online' });
      }
      await api.rosterInsert(ins);
      for (let i = 0; i < upd.length; i += 10) await Promise.all(upd.slice(i, i + 10).map(([id, p]) => api.rosterUpdate(id, p)));
      await refreshConfig(); await refreshRoster();
      m.close(); toast(`เพิ่มใหม่ ${ins.length} • อัปเดตทับ ${upd.length}`); render();
    } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + errMsg(e), true); btn.disabled = false; }
  };
  let m; const goBtn = h('button', { class: 'btn pri', onClick: () => doImport(goBtn) }, 'นำเข้า');
  m = openModal({ title: `Import เข้ากรุ๊ป ${t.name}`, wide: true,
    body: [h('div', { class: 'note' }, 'ใช้ไฟล์ .xlsx ตามตารางตัวอย่าง (หัวตาราง: Store Name, จังหวัด, Device ID, สถานะจอ, Resolution, Shelf, ประเภทสาขา ไม่ต้องมีครบทุกคอลัมน์) ' +
        (hasShelfBase ? 'กรุ๊ปนี้ใส่ "ชื่อสาขา + Shelf" ในช่องเดียวได้ เช่น "One Bangkok จอซ้าย" ระบบแยกให้ ' : '') + 'ถ้าจอเดิมมีอยู่แล้ว (Device ID เดียวกัน) จะอัปเดตทับ ไม่เพิ่มซ้ำ'),
      h('div', { class: 'row' }, field('เลือกไฟล์ Excel', file)),
      h('div', { class: 'f' }, ta), h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => {
        const lines = ta.value.split(/\r?\n/).map(clean).filter(Boolean);
        if (!lines.length) return toast('ยังไม่มีข้อความให้ตรวจ', true);
        fileHasShelf = false; build(lines.map(l => ({ store_name: l, province: '', device_id: '', screen_status: '', res: '', shelf: '', tagText: '', screen_count: 1 })));
      } }, 'ตรวจสอบข้อความที่วาง')), out],
    footer: [sum, h('button', { class: 'btn', onClick: () => m.close() }, 'ปิด'), goBtn] });
}

/* ---------- รายชื่อจอ ---------- */
function sectionRoster() {
  const R = state.rs || (state.rs = { brand: state.brand, type: '', tag: '', q: '', sel: new Set(), limit: 200 });
  if (R.brand !== state.brand) Object.assign(R, { brand: state.brand, type: '', tag: '', q: '', sel: new Set(), limit: 200 });
  const body = h('div');
  const q = h('input', { type: 'search', placeholder: 'ค้นหาสาขา / จังหวัด / Device ID', maxlength: 100, value: R.q, onInput: e => { R.q = e.target.value; R.limit = 200; draw(); } });
  const filtered = () => {
    const t = lc(R.q);
    return state.roster.filter(r => (!R.type || r.screen_type === R.type) && (!R.tag || (r.tags || []).includes(R.tag)) &&
      (!t || [r.store_name, r.province, r.device_id, r.shelf, ...(r.old_device_ids || [])].some(x => lc(x).includes(t))));
  };
  const tagSel = h('select', { 'aria-label': 'เลือกป้าย' }, tagList().map(x => h('option', { value: x }, x)));
  const applyTag = async mode => {
    const ids = [...R.sel]; if (!ids.length) return toast('ยังไม่ได้เลือกจอ', true);
    const tg = tagSel.value; if (!tg) return;
    if (ids.length > 30 && !await confirmDialog({ title: mode === 'add' ? 'ติดป้าย?' : 'เอาป้ายออก?', lines: [`${mode === 'add' ? 'ติดป้าย' : 'เอาป้าย'} "${tg}" ${mode === 'add' ? 'ให้' : 'ออกจาก'} ${ids.length} จอ`], okText: 'ยืนยัน' })) return;
    try { await api.rosterTag(ids, mode === 'add' ? [tg] : [], mode === 'add' ? [] : [tg]); await refreshRoster(); toast(`${mode === 'add' ? 'ติดป้าย' : 'เอาป้ายออก'} "${tg}" ${ids.length} จอแล้ว`); draw(); }
    catch (e) { toast('ไม่สำเร็จ: ' + errMsg(e), true); }
  };
  function draw() {
    const list = filtered(), shown = list.slice(0, R.limit);
    { const vis = new Set(list.map(r => r.id)); [...R.sel].forEach(id => { if (!vis.has(id)) R.sel.delete(id); }); } // เลือกได้เฉพาะจอที่เห็น กันติดป้ายโดนจอที่ซ่อนอยู่
    const allOn = list.length > 0 && list.every(r => R.sel.has(r.id));
    const types = brandTypes();
    body.replaceChildren(
      h('div', { class: 'chips', style: 'margin-bottom:8px' },
        h('button', { class: 'chip' + (!R.type ? ' on' : ''), onClick: () => { R.type = ''; R.limit = 200; draw(); } }, `ทุกประเภท (${state.roster.length})`),
        types.map(x => h('button', { class: 'chip' + (R.type === x.name ? ' on' : ''), onClick: () => { R.type = x.name; R.limit = 200; draw(); } }, `${x.name} (${state.roster.filter(r => r.screen_type === x.name).length})`))),
      hasTags() ? h('div', { class: 'chips', style: 'margin-bottom:8px' }, h('span', { class: 'muted' }, 'ป้าย:'),
        h('button', { class: 'chip' + (!R.tag ? ' on' : ''), onClick: () => { R.tag = ''; draw(); } }, 'ทั้งหมด'),
        tagList().map(x => h('button', { class: 'chip' + (R.tag === x ? ' on' : ''), onClick: () => { R.tag = x; draw(); } }, `${x} (${state.roster.filter(r => (r.tags || []).includes(x)).length})`))) : null,
      state.isAdmin && hasTags() ? h('div', { class: 'row bulk' },
        h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'cb ok', checked: allOn, onChange: e => { list.forEach(r => e.target.checked ? R.sel.add(r.id) : R.sel.delete(r.id)); draw(); } }), `เลือกทั้งหมดที่กรองอยู่ (${list.length})`),
        h('span', { class: 'muted' }, `เลือกแล้ว ${R.sel.size}`), tagSel,
        h('button', { class: 'btn sm', onClick: () => applyTag('add') }, 'ติดป้าย'), h('button', { class: 'btn sm', onClick: () => applyTag('remove') }, 'เอาป้ายออก')) : null,
      h('div', { class: 'count' }, `แสดง ${shown.length} จาก ${list.length} จอ`),
      list.length ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, ...[state.isAdmin && hasTags() ? '' : null, 'Store Name', 'จังหวัด', 'ประเภทจอ', 'Shelf', 'Resolution', 'ประเภทสาขา', 'Device ID', 'สถานะ', ''].filter(x => x !== null).map(x => h('th', null, x)))),
        h('tbody', null, shown.map(r => h('tr', null,
          state.isAdmin && hasTags() ? h('td', null, h('input', { type: 'checkbox', class: 'cb ok', checked: R.sel.has(r.id), 'aria-label': 'เลือก', onChange: e => { e.target.checked ? R.sel.add(r.id) : R.sel.delete(r.id); } })) : null,
          h('td', { class: 'l' }, r.store_name), h('td', null, r.province), h('td', null, r.screen_type), h('td', null, r.shelf || '-'), h('td', null, r.res || '-'),
          h('td', null, h('div', { class: 'chips sm' }, (r.tags || []).map(x => h('span', { class: 'badge tag2' }, x)))), h('td', null, r.device_id), h('td', null, r.screen_status),
          h('td', null, state.isAdmin ? h('span', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => openEditScreen(r, draw) }, 'แก้ไข'),
            h('button', { class: 'btn sm', onClick: () => delScreen(r, draw) }, 'ลบ')) : '')))))) : h('p', { class: 'muted' }, 'ยังไม่มีรายชื่อจอ ไปที่แท็บ "กรุ๊ปจอ" เพื่อ Import'),
      list.length > shown.length ? h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onClick: () => { R.limit += 300; draw(); } }, `แสดงเพิ่ม (เหลือ ${list.length - shown.length})`)) : null);
  }
  const el = h('div', { class: 'card' },
    h('div', { class: 'row mb' }, h('h2', { class: 'sec', style: 'margin:0' }, 'รายชื่อจอหลัก (ใช้ติ๊กให้อัตโนมัติ)'), h('span', { class: 'sp' }),
      state.isAdmin ? h('button', { class: 'btn pri', onClick: () => openAddStore(() => { draw(); }) }, '+ เพิ่มสาขา') : null),
    state.isAdmin ? null : adminOnlyNote(),
    h('div', { class: 'f', style: 'margin:8px 0' }, 'ค้นหา', q), body);
  draw();
  return el;
}
async function delScreen(r, redraw) {
  if (!await confirmDialog({ title: 'ลบจอนี้ออกจากรายชื่อหลัก?', lines: [`${r.store_name} • ${r.screen_type}${r.shelf ? ' ' + r.shelf : ''} • ${r.device_id || ''}`, 'งานที่บันทึกไปแล้วไม่ได้รับผลกระทบ'], okText: 'ลบ', danger: true })) return;
  try { await api.rosterDelete(r.id); await refreshRoster(); redraw(); toast('ลบแล้ว'); } catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e), true); }
}
function openEditScreen(row, redraw) {
  const r = { ...row, tags: new Set(row.tags || []), old_device_ids: [...(row.old_device_ids || [])] };
  const types = brandTypes();
  const mk = (k, label, type, props) => field(label, h('input', { type: type || 'text', maxlength: 150, value: r[k] ?? '', onInput: e => { r[k] = e.target.value; }, ...(props || {}) }));
  const typeSel = h('select', { onChange: e => { r.screen_type = e.target.value; } }, types.map(t => h('option', { value: t.name, selected: t.name === r.screen_type }, t.name)));
  let m;
  const save = h('button', { class: 'btn pri', onClick: async () => {
    const out = { store_name: clean(r.store_name), province: fixThai(r.province), screen_count: Math.min(99, Math.max(0, parseInt(r.screen_count, 10) || 1)), screen_type: r.screen_type,
      shelf: clean(r.shelf), res: clean(r.res), tags: [...r.tags], device_id: clean(r.device_id), screen_status: clean(r.screen_status) };
    if (!out.store_name) return toast('กรุณากรอกชื่อสาขา', true);
    // เปลี่ยน Device ID (เปลี่ยนกล่อง) -> เก็บ ID เดิมไว้เป็น "Device ID เก่า" ให้ชีตเก่ายังจับจอนี้ได้
    const dn = x => clean(x).toLowerCase().replace(/\s+/g, '');
    let olds = r.old_device_ids.filter(x => dn(x) !== dn(out.device_id));
    if (clean(row.device_id) && dn(row.device_id) !== dn(out.device_id) && !olds.some(x => dn(x) === dn(row.device_id))) olds.push(clean(row.device_id));
    out.old_device_ids = olds;
    save.disabled = true;
    try { await api.rosterUpdate(row.id, out); m.close(); toast('บันทึกแล้ว'); await refreshRoster(); redraw(); } catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e), true); save.disabled = false; }
  } }, 'บันทึก');
  const tagBox = h('div'), oldBox = h('div');
  const drawTags = () => tagBox.replaceChildren(hasTags() ? h('div', null, h('div', { class: 'lbl first' }, 'ประเภทสาขา'), chipSet(tagList(), r.tags, drawTags)) : null);
  const drawOld = () => oldBox.replaceChildren(h('div', { class: 'lbl' }, 'Device ID เก่า (ใช้จับชีตเก่าที่ยังใช้ ID เดิม)'),
    r.old_device_ids.length ? h('div', { class: 'chips sm' }, r.old_device_ids.map((x, i) => h('span', { class: 'badge tag2 big' }, x, h('button', { class: 'x sm', 'aria-label': 'ลบ Device ID เก่า ' + x, onClick: () => { r.old_device_ids.splice(i, 1); drawOld(); } }, '×'))))
      : h('div', { class: 'hint' }, 'ยังไม่มี  เมื่อแก้ช่อง Device ID ด้านบน ระบบจะเก็บค่าเดิมมาไว้ตรงนี้ให้เอง'));
  drawTags(); drawOld();
  m = openModal({ title: 'แก้ไขจอ', body: [h('div', { class: 'fgrid' }, mk('store_name', 'Store Name'), mk('province', 'จังหวัด'), field('ประเภทจอ', typeSel),
      mk('shelf', 'Shelf', 'text', { list: 'dl-shelf' }), mk('res', 'Resolution'), mk('device_id', 'Device ID'), mk('screen_status', 'สถานะจอ'), mk('screen_count', 'จำนวนจอ', 'number')),
      h('datalist', { id: 'dl-shelf' }, uniqList(types.flatMap(t => t.shelves)).map(s => h('option', { value: s }))), tagBox, oldBox],
    footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'ยกเลิก'), save] });
}

// เพิ่มสาขา 1 สาขา หลายจอในฟอร์มเดียว
function openAddStore(onDone) {
  const types = brandTypes();
  if (!types.length) return toast('ยังไม่มีกรุ๊ปจอ สร้างกรุ๊ปในแท็บ "กรุ๊ปจอ" ก่อน', true);
  const st = { name: '', province: '' };
  const screens = [{ type: types[0].name, shelf: '', res: '', device: '', tags: new Set() }];
  const list = h('div');
  const draw = () => list.replaceChildren(...screens.map((s, i) => {
    const cfg = typeCfg(s.type);
    return h('div', { class: 'sc' },
      h('div', { class: 'row' }, h('b', null, `จอที่ ${i + 1}`), h('span', { class: 'sp' }), screens.length > 1 ? h('button', { class: 'x', 'aria-label': 'ลบจอนี้', onClick: () => { screens.splice(i, 1); draw(); } }, '×') : null),
      h('div', { class: 'fgrid' },
        field('ประเภทจอ', h('select', { onChange: e => { s.type = e.target.value; s.shelf = ''; draw(); } }, types.map(t => h('option', { value: t.name, selected: t.name === s.type }, t.name)))),
        field('Shelf', h('input', { value: s.shelf, maxlength: 50, list: 'dl-s' + i, onInput: e => { s.shelf = e.target.value; } })),
        field('Resolution', h('input', { value: s.res, maxlength: 30, placeholder: cfg && cfg.default_res ? 'ตั้งต้น ' + cfg.default_res : 'เช่น 1920x1080', onInput: e => { s.res = e.target.value; } })),
        field('Device ID', h('input', { value: s.device, maxlength: 100, onInput: e => { s.device = e.target.value; } }))),
      h('datalist', { id: 'dl-s' + i }, (cfg ? cfg.shelves : []).map(x => h('option', { value: x }))),
      hasTags() ? h('div', null, h('div', { class: 'lbl' }, 'ประเภทสาขา'), chipSet(tagList(), s.tags, draw)) : null);
  }));
  draw();
  let m;
  const save = h('button', { class: 'btn pri', onClick: async () => {
    const name = clean(st.name); if (!name) return toast('กรุณากรอกชื่อสาขา', true);
    save.disabled = true;
    try {
      const addShelf = new Map();
      for (const s of screens) { const sh = clean(s.shelf); const cfg = typeCfg(s.type); if (sh && cfg && !cfg.shelves.some(x => lc(x) === lc(sh))) addShelf.set(s.type, uniqList([...(addShelf.get(s.type) || cfg.shelves), sh])); }
      for (const [tn, shelves] of addShelf) await api.typeUpdate(state.brand, tn, { shelves });
      await api.rosterInsert(screens.map(s => ({ brand: state.brand, store_no: null, store_name: name, province: fixThai(st.province), screen_count: 1, screen_type: s.type, shelf: clean(s.shelf),
        res: clean(s.res) || (typeCfg(s.type) || {}).default_res || '', tags: [...s.tags], device_id: clean(s.device), screen_status: 'Online' })));
      await refreshConfig(); await refreshRoster(); m.close(); toast(`เพิ่มสาขา "${name}" ${screens.length} จอแล้ว`); if (onDone) onDone();
    } catch (e) { toast('บันทึกไม่สำเร็จ: ' + errMsg(e), true); save.disabled = false; }
  } }, 'บันทึกสาขา');
  m = openModal({ title: 'เพิ่มสาขา', wide: true,
    body: [h('div', { class: 'fgrid' }, field('ชื่อสาขา *', h('input', { maxlength: 150, onInput: e => { st.name = e.target.value; } })), field('จังหวัด', h('input', { maxlength: 100, onInput: e => { st.province = e.target.value; } }))),
      list, h('div', null, h('button', { class: 'btn sm', onClick: () => { screens.push({ type: types[0].name, shelf: '', res: '', device: '', tags: new Set() }); draw(); } }, '+ เพิ่มจอในสาขานี้'))],
    footer: [h('button', { class: 'btn', onClick: () => m.close() }, 'ยกเลิก'), save] });
}

/* ---------- แบรนด์ / ผู้แจ้ง ---------- */
function sectionBrand() {
  const B = curBrand();
  const nm = h('input', { maxlength: 100, placeholder: 'ชื่อแบรนด์ เช่น Dior' });
  const hasT = h('input', { type: 'checkbox', class: 'cb ok' });
  const tagTxt = h('input', { placeholder: 'ประเภทสาขา คั่นด้วยเครื่องหมายจุลภาค เช่น WW, Branding', maxlength: 200 });
  const newTag = h('input', { placeholder: 'เพิ่มประเภทสาขา', maxlength: 30 });
  const rn = h('input', { placeholder: 'ชื่อผู้แจ้ง เช่น คุณเอ', maxlength: 100 });
  const rtags = new Set();
  const rtagBox = h('div');
  const drawRt = () => rtagBox.replaceChildren(hasTags() ? chipSet(tagList(), rtags, drawRt) : h('span', { class: 'muted' }, 'แบรนด์นี้ไม่มีประเภทสาขา'));
  drawRt();
  const fail = e => toast('ไม่สำเร็จ: ' + errMsg(e), true);
  return h('div', null,
    h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'เพิ่มแบรนด์ใหม่'),
      h('div', { class: 'fgrid' }, field('ชื่อแบรนด์', nm), h('label', { class: 'row', style: 'align-self:end' }, hasT, 'แบรนด์นี้มีประเภทสาขา (เช่น WW / Branding)'), field('ประเภทสาขา (ถ้ามี)', tagTxt)),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn pri', onClick: async () => {
        const name = clean(nm.value); if (!name) return toast('กรุณาใส่ชื่อแบรนด์', true); if (state.brands.some(b => lc(b.name) === lc(name))) return toast('มีแบรนด์นี้แล้ว', true);
        try { await api.brandInsert({ name, has_tags: hasT.checked, tag_list: hasT.checked ? uniqList(tagTxt.value.split(/[,，]/).map(clean).filter(Boolean)) : [] }); await refreshConfig(); toast(`เพิ่มแบรนด์ "${name}" แล้ว`); await setBrand(name); } catch (e) { fail(e); }
      } }, 'เพิ่มแบรนด์'), h('span', { class: 'hint' }, 'เพิ่มแล้วจะสลับไปแบรนด์นั้นให้ ต่อด้วยสร้างกรุ๊ปจอและ Import รายชื่อจอ'))),
    B ? h('div', { class: 'card' }, h('h2', { class: 'sec' }, `ประเภทสาขาของแบรนด์ ${B.name}`),
      h('label', { class: 'row mb' }, h('input', { type: 'checkbox', class: 'cb ok', checked: B.has_tags, onChange: async e => { try { await api.brandUpdate(B.name, { has_tags: e.target.checked }); await refreshConfig(); render(); } catch (er) { fail(er); } } }), 'แบรนด์นี้มีประเภทสาขา'),
      B.has_tags ? [h('div', { class: 'chips' }, (B.tag_list || []).map(t => h('span', { class: 'badge tag big' }, t, h('button', { class: 'x sm', 'aria-label': 'เอาป้าย ' + t + ' ออก', onClick: async () => {
          if (!await confirmDialog({ title: `เอาประเภทสาขา "${t}" ออกจากรายการ?`, lines: ['จอที่ติดป้ายนี้อยู่แล้วไม่ถูกลบป้าย แค่ไม่แสดงเป็นตัวเลือก'], okText: 'เอาออก' })) return;
          try { await api.brandUpdate(B.name, { tag_list: B.tag_list.filter(x => x !== t) }); await refreshConfig(); render(); } catch (er) { fail(er); } } }, '×')))),
        h('div', { class: 'row', style: 'margin-top:8px' }, newTag, h('button', { class: 'btn sm', onClick: async () => {
          const v = clean(newTag.value); if (!v) return; if (B.tag_list.some(x => lc(x) === lc(v))) return toast('มีประเภทสาขานี้แล้ว', true);
          try { await api.brandUpdate(B.name, { tag_list: [...B.tag_list, v] }); await refreshConfig(); toast(`เพิ่ม "${v}" แล้ว`); render(); } catch (er) { fail(er); } } }, '+ เพิ่ม'))] : h('div', { class: 'muted' }, 'ไม่มีประเภทสาขา ช่องเลือกประเภทสาขาจะไม่แสดงในแบรนด์นี้')) : null,
    h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'ผู้แจ้ง และประเภทสาขาตั้งต้น'),
      h('p', { class: 'muted' }, 'พิมพ์ชื่อผู้แจ้งในฟอร์มแล้วระบบเติมประเภทสาขาตั้งต้นให้ (ใช้ร่วมทุกแบรนด์ แก้ในฟอร์มได้)'),
      state.reporters.length ? h('div', { class: 'tablewrap', style: 'margin-bottom:10px' }, h('table', null, h('thead', null, h('tr', null, ...['ผู้แจ้ง', 'ประเภทสาขาตั้งต้น', ''].map(x => h('th', null, x)))),
        h('tbody', null, state.reporters.map(r => h('tr', null, h('td', { class: 'l' }, r.name), h('td', null, h('div', { class: 'chips sm' }, (r.tags || []).map(x => h('span', { class: 'badge tag2' }, x)))),
          h('td', null, h('span', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => { rn.value = r.name; rtags.clear(); (r.tags || []).forEach(x => rtags.add(x)); drawRt(); rn.focus(); } }, 'แก้ไข'),
            h('button', { class: 'btn sm', onClick: async () => { try { await api.reporterDelete(r.name); await refreshConfig(); render(); } catch (er) { fail(er); } } }, 'ลบ')))))))) : h('p', { class: 'muted' }, 'ยังไม่มีผู้แจ้งตั้งต้น'),
      h('div', { class: 'row' }, h('div', { class: 'f grow' }, 'ชื่อผู้แจ้ง', rn), h('div', { class: 'f grow' }, 'ประเภทสาขาตั้งต้น (ของแบรนด์ที่เลือกอยู่)', rtagBox),
        h('button', { class: 'btn pri', onClick: async () => {
          const name = clean(rn.value); if (!name) return toast('กรุณาใส่ชื่อผู้แจ้ง', true);
          const old = state.reporters.find(x => lc(x.name) === lc(name));
          const tags = uniqList([...(old ? old.tags.filter(t => !tagList().includes(t)) : []), ...rtags]);
          try { await api.reporterUpsert({ name: old ? old.name : name, tags }); await refreshConfig(); toast('บันทึกแล้ว'); render(); } catch (er) { fail(er); } } }, 'บันทึกผู้แจ้ง'))));
}

/* ---------- พื้นที่ใช้งาน / ลบสื่อเก่า ---------- */
async function sectionSpace() {
  const u = state.usage;
  const bar = (label, usedMB, lim) => {
    const p = usedMB / lim * 100, cls = p >= 90 ? 'red' : p >= 70 ? 'yel' : 'grn';
    return h('div', { style: 'margin-bottom:12px' },
      h('div', { class: 'row' }, h('b', null, label), h('span', { class: 'sp' }), h('span', { class: 'hint' }, `${Math.round(usedMB)} MB จาก ${lim} MB (${Math.round(p)}%)`)),
      h('div', { class: 'bar' }, h('i', { class: cls, style: `width:${Math.min(100, p)}%` })),
      p >= 70 ? h('div', { class: p >= 90 ? 'warnline' : 'hint' }, p >= 90 ? 'ใกล้เต็มมาก ควร Export แล้วลบสื่อเก่าตอนนี้' : 'เริ่มเยอะแล้ว วางแผน Export แล้วลบสื่อเก่า') : null);
  };
  let cases = [];
  try { cases = (await api.listCases({ brand: state.brand, field: 'received_date' })).slice().reverse(); } catch (e) { /* แสดงรายการว่าง */ }
  const D = state.delSel || (state.delSel = new Set()), before = h('input', { type: 'date', class: 'dt', value: state.delBefore || '', 'aria-label': 'ก่อนวันที่', onChange: e => { state.delBefore = e.target.value; } });
  for (const id of [...D]) if (!cases.some(c => c.id === id)) D.delete(id);
  const confirmDelete = () => {
    const chosen = cases.filter(c => D.has(c.id)), un = chosen.filter(c => !c.exported_at);
    let c;
    const expBtn = h('button', { class: 'btn sm', onClick: async () => {
      expBtn.disabled = true; toast(`กำลังสร้างไฟล์ ${chosen.length} ชีต…`);
      try { await exportCasesById(chosen.map(x => x.id), `${safeName(state.brand)}_สำรองก่อนลบ_${todayISO()}.xlsx`); c.close(); render(); }
      catch (e) { toast('ส่งออกไม่สำเร็จ: ' + errMsg(e), true); expBtn.disabled = false; }
    } }, 'Export ก่อนลบ');
    c = openModal({ title: 'ลบสื่อที่เลือก?',
      body: [h('div', null, `จะลบ ${chosen.length} สื่อ พร้อมรูปและข้อมูลทั้งหมด ลบแล้วกู้คืนไม่ได้`),
        un.length ? h('div', { class: 'warnbox' }, `มี ${un.length} สื่อที่ยังไม่ได้ Export`, h('div', { style: 'margin-top:6px' }, expBtn)) : h('div', { class: 'muted' }, 'ทุกสื่อที่เลือก Export แล้ว')],
      footer: [h('button', { class: 'btn', onClick: () => c.close() }, 'ยกเลิก'), h('button', { class: 'btn warn', onClick: async () => {
        try { await api.deleteCases(chosen.map(x => x.id)); D.clear(); state.cases = []; c.close(); toast(`ลบแล้ว ${chosen.length} สื่อ`); await refreshUsage(); render(); }
        catch (e) { toast('ลบไม่สำเร็จ: ' + errMsg(e), true); }
      } }, 'ลบถาวร')] });
  };
  return h('div', null,
    h('div', { class: 'card' }, h('h2', { class: 'sec' }, 'พื้นที่ใช้งาน (ทั้งโปรเจกต์)'),
      u ? [bar('รูปสื่อ', u.img_bytes / 1048576, LIMITS.img), bar('ฐานข้อมูล', u.db_bytes / 1048576, LIMITS.db),
        h('div', { class: 'hint' }, 'ตัวเลขนี้เป็นตัวเตือนล่วงหน้า (เพดานตามแผนฟรี) ตัวเลขจริงดูที่ Supabase > Usage จุดแดงที่เมนู "ตั้งค่า" ขึ้นเมื่อเกิน 90%')] : h('p', { class: 'muted' }, 'อ่านพื้นที่ใช้งานไม่ได้ (ต้องรัน setup_v2.sql แล้ว)')),
    h('div', { class: 'card' }, h('h2', { class: 'sec' }, `ลบสื่อเก่า • แบรนด์ ${state.brand}`),
      h('p', { class: 'muted' }, 'Export เก็บไว้แล้วค่อยลบ ลบแล้วกู้คืนไม่ได้ ระบบไม่มีแบ็กอัปอัตโนมัติ'),
      cases.length ? [h('div', { class: 'row' }, h('span', { class: 'muted' }, 'เลือกสื่อที่รับแจ้งก่อนวันที่'), before,
          h('button', { class: 'btn sm', onClick: () => { D.clear(); cases.filter(x => state.delBefore && x.received_date < state.delBefore).forEach(x => D.add(x.id)); render(); } }, 'เลือกให้')),
        h('div', { style: 'margin-top:10px' }, cases.map(x => h('div', { class: 'mrow' },
          h('input', { type: 'checkbox', class: 'cb ok', checked: D.has(x.id), 'aria-label': 'เลือกลบ ' + x.media_name, onChange: e => { e.target.checked ? D.add(x.id) : D.delete(x.id); render(); } }),
          h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'font-weight:600' }, x.media_name), h('div', { class: 'hint' }, `รับแจ้ง ${fmtDate(x.received_date)} • ${x.total_rows} แถว`)),
          x.exported_at ? h('span', { class: 'badge tag' }, 'Export แล้ว') : h('span', { class: 'badge warn' }, 'ยังไม่ Export')))),
        h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn warn', disabled: D.size === 0, onClick: confirmDelete }, `ลบที่เลือก (${D.size})`))]
        : h('div', { class: 'muted' }, 'ไม่มีสื่อให้ลบ')));
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
  if (state.user) {
    resetIdle();
    await refreshConfig();
    const saved = store('dr_brand');
    state.brand = state.brands.some(b => b.name === saved) ? saved : (state.brands[0] ? state.brands[0].name : '');
    await refreshRoster();
    await refreshUsage();
    if (state.view === 'detail' || state.view === 'form') state.view = 'list';
  } else {
    Object.assign(state, { brands: [], types: [], reporters: [], roster: [], cases: [], usage: null, brand: '', view: 'list', arg: null, form: null, bs: null, rs: null,
      filters: { from: '', to: '', q: '', type: '', tag: '' } });
  }
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
    if (ev === 'TOKEN_REFRESHED' || ev === 'USER_UPDATED') return;
    // supabase ส่ง SIGNED_IN ซ้ำทุกครั้งที่หน้าต่างได้โฟกัสกลับ (เช่น ปิดหน้าต่างเลือกไฟล์) ถ้าเป็นผู้ใช้คนเดิมให้เมิน ไม่งั้นฟอร์มที่กรอกค้างไว้จะถูกรีเซ็ต
    if (state.user && session && session.user && session.user.id === state.user.id) return;
    first = false;
    onSession(session);
  });
  sb.auth.getSession().then(({ data }) => { if (first) { first = false; onSession(data.session); } });
}
start();
})();
