/* =========================================================================
   AC Service — Sukaregang  |  MAINTENANCE module (PWA, offline-first)
   Data: IndexedDB (HP) + optional sync ke Google Sheets (Apps Script)
   ========================================================================= */

'use strict';

/* ----------------------------- Config ---------------------------------- */
const PK_OPTIONS = ['0.5', '0.75', '1', '1.5', '2', '2.5', '3', '5', '10'];
const STATUS_OPTIONS = ['OK', 'NOK'];
// Kelas background item (Daftar Ruangan & panel admin) ngikut status pill
const STATUS_BG = { ticket: 'st-rev', due: 'st-rev', done: 'st-done', prog: 'st-prog', uploading: '', todo: '' };
const APP_VERSION = 'v72'; // dinaikin tiap update biar keliatan di Pengaturan
// Akun bootstrap offline (fallback kalau backend belum diset). Akun asli di tab Users spreadsheet.
const USERS = [
  { user: 'admin', pass: 'admin123', name: 'Admin', role: 'admin' }
];
const REMIND_DAYS = 7; // jatuh tempo re-maintenance (produksi)
// MODE TES: kalau > 0, pakai MENIT (bukan hari). Balikin ke 0 buat produksi (pakai REMIND_DAYS).
const REMIND_MINUTES = 0;
// Merk AC yang umum di pasaran Indonesia (+ "Lainnya" untuk ketik manual)
const MERK_OPTIONS = ['Panasonic', 'Daikin', 'LG', 'Sharp', 'Samsung', 'Gree', 'Midea', 'Polytron',
  'Changhong', 'Aqua (Haier)', 'Haier', 'Mitsubishi Electric', 'Mitsubishi Heavy', 'Toshiba',
  'Hitachi', 'Sanyo', 'Electrolux', 'TCL', 'Denpoo', 'Modena', 'Fujitsu', 'Akari', 'York'];

// 4 Lokasi (site). Tiap site punya daftar ruangan sendiri.
const SITES = ['Cimaragas', 'Sukaregang', 'Warjam', 'Sukaati'];
const SITE_ICON = { Cimaragas: '🏢', Sukaregang: '🏭', Warjam: '🏬', Sukaati: '🏠' };

// Ruangan awal per site (seed run pertama; bebas ditambah/hapus).
const SEED_ROOMS = {
  Cimaragas: ['Konten Atas 1', 'Konten Atas 2', 'Ruang Manager Umum', 'Ruang Tengah', 'Konten Bawah',
    'Ruang Meeting', 'Ruang Aksesoris', 'Ruang Plotter', 'Ruang Manager Produksi', 'Ruang CEO', 'Mes Bawah', 'Mes Atas'],
  Sukaregang: ['Ruang Manager Produksi', 'Ruang Daffa', 'Mes Putri 1', 'Ruang Server', 'Mes Putri 2',
    'Ruang Admin', 'Ruang Server 2', 'Mes Putra 1', 'Mes Putra 2', 'Mes Putra 3', 'Mes Putra 4'],
  Warjam: [],
  Sukaati: []
};

// Definisi foto per tahap. type 'ba' = before/after (cleaning), 'single' = satu foto.
// Foto dikelompokkan per LOKASI FISIK (indoor vs outdoor) biar teknisi nggak bolak-balik.
// Tiap bagian punya before & after dalam satu layar → selesaikan satu unit baru pindah.
const INDOOR_PARTS = [
  { key: 'indoor', label: 'Indoor Unit' },
  { key: 'evaporator', label: 'Evaporator / Sirip' }
];
const OUTDOOR_PARTS = [
  { key: 'kondensor', label: 'Kondensor (Outdoor)' }
];
const DRAINASE_SLOT = { key: 'drainase', label: 'Drainase / Pembuangan' };
const NAMETAG_SLOT = { key: 'nametag', label: 'Name Tag / Nameplate Unit' };
const UKUR_SLOTS = [
  { key: 'ukur_freon', label: 'Manifold / Tekanan Freon', field: 'freon', numLabel: 'Freon (psi)', ph: 'mis. 75' },
  { key: 'ukur_ampere', label: 'Ampere (tang ampere)', field: 'ampere', numLabel: 'Ampere (A)', ph: 'mis. 3.2' },
  { key: 'ukur_tegangan', label: 'Tegangan (multimeter)', field: 'tegangan', numLabel: 'Tegangan (V)', ph: 'mis. 220' }
];

const STEPS = ['Info Unit', 'Unit Indoor', 'Unit Outdoor', 'Hasil Ukur', 'Drainase', 'Penilaian', 'Simpan'];
// Map item review (yg dicentang admin) → index step wizard, buat revisi terarah
const REVIEW_TO_STEP = { info: 0, nametag: 0, indoor: 1, evaporator: 1, kondensor: 2, freon: 3, ampere: 3, tegangan: 3, drainase: 4, status: 5 };
// Kebutuhan wajib PER-ITEM review (buat revisi terarah: cuma cek item yg dicentang admin)
const KEY_REQ = {
  info: { fields: [['merk', 'Merk']], photos: [] },
  nametag: { fields: [], photos: [['nametag', 'Foto Name Tag']] },
  indoor: { fields: [], photos: [['indoor_before', 'Foto Indoor before'], ['indoor_after', 'Foto Indoor after']] },
  evaporator: { fields: [], photos: [['evaporator_before', 'Foto Evaporator before'], ['evaporator_after', 'Foto Evaporator after']] },
  kondensor: { fields: [], photos: [['kondensor_before', 'Foto Kondensor before'], ['kondensor_after', 'Foto Kondensor after']] },
  freon: { fields: [['freon', 'Freon']], photos: [['ukur_freon', 'Foto Freon']] },
  ampere: { fields: [['ampere', 'Ampere']], photos: [['ukur_ampere', 'Foto Ampere']] },
  tegangan: { fields: [['tegangan', 'Tegangan']], photos: [['ukur_tegangan', 'Foto Tegangan']] },
  drainase: { fields: [], photos: [['drainase', 'Foto Drainase']] },
  status: { fields: [['status', 'Status']], photos: [] }
};
// Kebutuhan wajib per step (buat cek kelengkapan servis normal)
const STEP_REQ = {
  0: { fields: [['merk', 'Merk']], photos: [] },
  1: { fields: [], photos: [['indoor_before', 'Foto Indoor before'], ['indoor_after', 'Foto Indoor after'], ['evaporator_before', 'Foto Evaporator before'], ['evaporator_after', 'Foto Evaporator after']] },
  2: { fields: [], photos: [['kondensor_before', 'Foto Kondensor before'], ['kondensor_after', 'Foto Kondensor after']] },
  3: { fields: [['freon', 'Freon'], ['ampere', 'Ampere'], ['tegangan', 'Tegangan']], photos: [['ukur_freon', 'Foto Freon'], ['ukur_ampere', 'Foto Ampere'], ['ukur_tegangan', 'Foto Tegangan']] },
  4: { fields: [], photos: [['drainase', 'Foto Drainase']] },
  5: { fields: [['teknisi1', 'Teknisi']], photos: [] },
  6: { fields: [], photos: [] }
};

/* --------------------------- IndexedDB --------------------------------- */
const DB_NAME = 'ac-service-db';
const DB_VER = 1;
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('units')) db.createObjectStore('units', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos'); // key: unitId:slot
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode = 'readonly') { return _db.transaction(store, mode).objectStore(store); }
function idbGet(store, key) {
  return new Promise((res, rej) => { const r = tx(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function idbPut(store, val, key) {
  return new Promise((res, rej) => { const r = key !== undefined ? tx(store, 'readwrite').put(val, key) : tx(store, 'readwrite').put(val); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function idbDel(store, key) {
  return new Promise((res, rej) => { const r = tx(store, 'readwrite').delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}
function idbAll(store) {
  return new Promise((res, rej) => { const r = tx(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}
function idbClear(store) {
  return new Promise((res, rej) => { const r = tx(store, 'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}

// Endpoint Apps Script default (biar semua HP langsung nyambung tanpa setting manual)
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxl-A8O2z-vtYVfKOFsz2sxVKSeyhw-FYcRVqfpv6iZsZeK9tZ5FcDwYwVjndQMDL6T/exec';

/* ----------------------------- State ----------------------------------- */
const state = {
  settings: { endpoint: DEFAULT_ENDPOINT, project: 'Service Check AC' },
  units: [],
  user: '',          // nama teknisi yang login
  role: '',          // 'admin' | 'teknisi'
  currentSite: '',   // lokasi (site) yang dipilih
  current: null,     // unit sedang diedit di wizard
  step: 0,
  reviseSteps: null, // subset step (index STEPS) kalau buka dari tiket revisi; null = semua
  reviseKeys: null,  // subset item review (freon/indoor/...) yg dicentang admin; null = semua
  ticketMap: {},     // 'lokasi|ruangan' -> tiket revisi/perbaikan (dari admin)
  ticketsSeen: new Set(), // tiket yg sudah dilihat teknisi (buka Daftar Ruangan) → lonceng ilang
  notifiedTickets: new Set(), // tiket yg sudah dinotif (biar gak spam)
  uploading: new Set(), // id unit yang lagi di-upload (buat spinner)
  photoCache: {}     // slot -> dataURL (foto unit yg sedang dibuka)
};

/* --------------------------- Utilities --------------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function todayISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function addDaysISO(iso, days) { const d = iso ? new Date(iso + 'T00:00:00') : new Date(); d.setDate(d.getDate() + days); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function fmtDate(iso) { if (!iso) return '—'; const [y, m, dd] = iso.split('-'); return `${dd}/${m}/${y}`; }
function daysUntil(iso) { if (!iso) return Infinity; return Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000); }

let toastTimer = null;
function toast(msg, kind = '') {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast ' + kind; t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

/* Kompres foto -> dataURL JPEG */
function fileToCompressedDataURL(file, maxSide = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxSide) { const r = maxSide / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gagal baca gambar')); };
    img.src = url;
  });
}

/* --------------------------- Settings ---------------------------------- */
async function loadSettings() {
  const s = await idbGet('meta', 'settings');
  if (s) state.settings = Object.assign(state.settings, s);
  if (!state.settings.endpoint) state.settings.endpoint = DEFAULT_ENDPOINT; // jaga-jaga kalau kosong
}
async function saveSettings() {
  state.settings.endpoint = $('#setEndpoint').value.trim();
  state.settings.project = $('#setProject').value.trim() || 'Service Check AC';
  await idbPut('meta', state.settings, 'settings');
  toast('Pengaturan disimpan', 'ok');
}

/* ------------------------------ Data ----------------------------------- */
async function loadUnits() { state.units = (await idbAll('units')).sort((a, b) => (a.order || 0) - (b.order || 0)); }

async function seedIfNeeded() {
  const seeded = await idbGet('meta', 'seedv2');
  if (seeded) return;
  // migrasi ke struktur site+ruangan: bersihkan seed lama, isi ulang per site
  await idbClear('units'); await idbClear('photos');
  for (const site of SITES) {
    let i = 1;
    for (const room of (SEED_ROOMS[site] || [])) {
      const u = blankUnit(); u.id = uid(); u.lokasi = site; u.ruangan = room; u.order = i++;
      await idbPut('units', u);
    }
  }
  await idbPut('meta', true, 'seedv2');
}

function siteUnits(site) { return state.units.filter(u => u.lokasi === site); }

function blankUnit() {
  const site = state.currentSite || '';
  const peers = siteUnits(site);
  return {
    id: uid(), jenis: 'maintenance', order: (peers.length ? Math.max(...peers.map(u => u.order || 0)) : 0) + 1,
    lokasi: site, ruangan: '', merk: '', pk: '1',
    freon: '', ampere: '', tegangan: '',
    kondisi: { indoor: '', kondensor: '', evaporator: '', drainase: '' },
    status: 'OK', tglServis: '', tglBerikutnya: '',
    teknisi1: '', teknisi2: '', supervisor: '', catatan: '',
    photos: {}, // slot -> true
    maintainedAt: '', // ISO tanggal terakhir dikerjakan (di-stamp saat simpan)
    touched: false,   // sudah pernah dibuka/diisi (buat status "Progres")
    ticketOpen: false, // tiket servis ulang aktif (progres dikosongin)
    synced: false, updatedAt: Date.now()
  };
}

function isMaintained(u) { return !!u.maintainedAt; }
// Waktu jatuh tempo (ms epoch). Prioritas: dueAt (mode menit) → tglBerikutnya (tanggal).
function dueTime(u) {
  if (u.dueAt) return u.dueAt;
  if (u.tglBerikutnya) return new Date(u.tglBerikutnya + 'T00:00:00').getTime();
  return Infinity;
}
function isDue(u) { return isMaintained(u) && Date.now() >= dueTime(u); }
function notDueYet(u) { return Date.now() < dueTime(u); } // masih di masa tunggu
function dueUnits() { return state.units.filter(u => u.ticketOpen); } // tiket servis ulang aktif

// Kosongkan semua progres unit → jadi tiket servis ulang fresh
async function resetUnitForTicket(u) {
  for (const slot of Object.keys(u.photos || {})) { try { await idbDel('photos', u.id + ':' + slot); } catch (e) {} }
  u.photos = {};
  u.kondisi = { indoor: '', kondensor: '', evaporator: '', drainase: '' };
  u.freon = ''; u.ampere = ''; u.tegangan = '';
  u.status = 'OK'; u.catatan = ''; u.teknisi1 = '';
  u.maintainedAt = ''; u.tglServis = ''; u.tglBerikutnya = '';
  u.dueAt = 0; u.synced = false; u.touched = false;
  u.ticketOpen = true; u.updatedAt = Date.now();
  await idbPut('units', u);
  // masuk waktu re-maintenance → hapus tanda "APPROVED" di spreadsheet (best-effort)
  if (state.settings.endpoint) {
    apiPost({ action: 'unapprove', lokasi: u.lokasi, ruangan: u.ruangan }).catch(() => {});
  }
}
// User sudah lihat daftar → tiket "baru" jadi ruangan biasa (Belum) saat balik lagi
function markSiteTicketsSeen() {
  for (const u of siteUnits(state.currentSite)) {
    if (u.ticketOpen) { u.ticketOpen = false; idbPut('units', u).catch(() => {}); }
  }
}

// Unit yang sudah lewat jatuh tempo → buka tiket (kosongkan progres)
async function processTickets() {
  let changed = false;
  for (const u of state.units) {
    if (u.synced && u.maintainedAt && !u.ticketOpen && Date.now() >= dueTime(u)) {
      await resetUnitForTicket(u); changed = true;
    }
  }
  return changed;
}

// Slot foto yang wajib ada biar dianggap lengkap
function requiredPhotoSlots() {
  const s = [];
  INDOOR_PARTS.forEach(p => s.push(p.key + '_before', p.key + '_after'));
  OUTDOOR_PARTS.forEach(p => s.push(p.key + '_before', p.key + '_after'));
  UKUR_SLOTS.forEach(x => s.push(x.key));
  s.push(DRAINASE_SLOT.key);
  return s;
}
// Lengkap = semua foto + field wajib keisi
function isComplete(u) {
  if (!u.merk || !u.teknisi1) return false;
  if (u.freon === '' || u.ampere === '' || u.tegangan === '') return false;
  const p = u.photos || {};
  return requiredPhotoSlots().every(slot => p[slot]);
}
// Sudah mulai dikerjakan tapi belum lengkap → "Progres"
function isProgres(u) { return (u.touched || isMaintained(u)) && !isComplete(u); }
// Siap upload: unit revisi cukup item yg ditandai admin; selain itu wajib lengkap penuh
function unitDone(u) {
  const tk = ticketOf(u);
  if (tk && tk.tipe === 'revisi') return ticketMissing(u, tk).length === 0;
  return isComplete(u);
}

function unitProgress(u) {
  // hitung kelengkapan sederhana: info + minimal 1 foto + status
  let filled = 0, total = 3;
  if (u.lokasi && u.merk) filled++;
  if (Object.keys(u.photos || {}).length) filled++;
  if (u.freon || u.ampere || u.tegangan) filled++;
  if (u.synced) return 'synced';
  if (filled === 0) return 'todo';
  if (filled >= total) return 'done';
  return 'prog';
}

/* ----------------------------- Router ---------------------------------- */
const VIEWS = ['login', 'home', 'admin', 'review', 'sites', 'list', 'wizard', 'settings'];
function show(view, opts = {}) {
  VIEWS.forEach(v => $('#view-' + v).classList.toggle('hidden', v !== view));
  const bar = $('#topbar'); if (bar) bar.classList.toggle('hidden', view === 'login');
  const setBtn = $('#settingsBtn');
  const titles = { login: ['CoolCare', ''], home: ['CoolCare', 'Maintenance & Instalasi'], admin: ['Panel Admin', ''], review: ['Review Unit', ''], sites: ['Maintenance', ''], list: ['Daftar Ruangan', ''], wizard: ['Servis Unit', ''], settings: ['Pengaturan', ''] };
  const ttl = titles[view] || ['', ''];
  $('#viewTitle').textContent = opts.title != null ? opts.title : ttl[0];
  $('#viewSub').textContent = opts.sub != null ? opts.sub : ttl[1];
  if (setBtn) setBtn.classList.toggle('hidden', view === 'settings' || view === 'wizard' || view === 'login');
  const canBack = view === 'sites' || view === 'list' || view === 'settings';
  const back = $('#backBtn'); if (back) back.classList.toggle('hidden', !canBack);
  const tw = $('#titleWrap'); if (tw) tw.style.cursor = canBack ? 'pointer' : 'default';
  state.view = view;
  window.scrollTo(0, 0);
}

function goBack() {
  if (state.view === 'wizard') { show('list', { title: 'Daftar Ruangan', sub: '' }); renderList($('#searchInput').value); }
  else if (state.view === 'list') { markSiteTicketsSeen(); show('sites'); renderSites(); }
  else if (state.view === 'settings') { if (state.role === 'admin') { show('admin'); renderAdmin(); } else { show('home'); renderHome(); } }
  else { show('home'); renderHome(); }
}

/* ------------------------------ Home ----------------------------------- */
async function renderHome() {
  const done = state.units.filter(u => u.synced).length;
  $('#homeStat').textContent = `${state.units.length} unit terdaftar · ${done} ter-sync`;
  updateHomeBadge();
  loadTickets();
}

// Kunci unik per-tiket (biar tiket baru yg beda note/step tetap ngasih notif ulang)
function tkKey(t) { return [t.lokasi, t.ruangan, t.tipe, t.catatan, (t.steps || []).join(',')].join('|'); }
// Tandai semua tiket sebuah site sebagai "sudah dilihat" (dipanggil pas buka Daftar Ruangan)
function markSiteSeen(site) {
  let changed = false;
  Object.values(state.ticketMap || {}).forEach(t => {
    if (t.lokasi === site) { const k = tkKey(t); if (!state.ticketsSeen.has(k)) { state.ticketsSeen.add(k); changed = true; } }
  });
  if (changed) { try { localStorage.setItem('acTicketsSeen', JSON.stringify([...state.ticketsSeen])); } catch (e) {} }
  updateHomeBadge();
}

// Lonceng notif di tile MAINTENANCE = re-maintenance jatuh tempo + tiket admin yg BELUM dilihat
function updateHomeBadge() {
  const tile = document.querySelector('.tile[data-go="maintenance"]');
  if (!tile) return;
  const unseenTk = Object.values(state.ticketMap || {}).filter(t => !state.ticketsSeen.has(tkKey(t))).length;
  const n = dueUnits().length + unseenTk;
  let b = tile.querySelector('.badge-due');
  if (n) { if (!b) { b = document.createElement('span'); b.className = 'badge-due'; tile.appendChild(b); } b.textContent = `🔔 ${n}`; }
  else if (b) b.remove();
}

/* ------------------------------ Auth ----------------------------------- */
async function doLogin() {
  const u = ($('#loginUser').value || '').trim();
  const p = $('#loginPass').value || '';
  const err = $('#loginErr'); const btn = $('#loginBtn');
  if (err) err.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = 'Masuk…'; }
  let auth = null;
  if (state.settings.endpoint) {
    try {
      const res = await fetch(state.settings.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', user: u, pass: p }) });
      const out = await res.json().catch(() => ({}));
      if (out.ok) auth = { name: out.name, role: out.role };
    } catch (e) {}
  }
  if (!auth) { const m = USERS.find(x => x.user.toLowerCase() === u.toLowerCase() && x.pass === p); if (m) auth = { name: m.name, role: m.role }; }
  if (btn) { btn.disabled = false; btn.textContent = 'Masuk'; }
  if (!auth) { if (err) err.style.display = 'block'; return; }
  setAuth(auth); $('#loginPass').value = '';
  enterApp();
}
function setAuth(a) {
  state.user = a.name; state.role = a.role || 'teknisi';
  try { localStorage.setItem('acAuth', JSON.stringify(a)); } catch (e) {}
}
function enterApp() {
  if (state.role === 'admin') { show('admin'); renderAdmin(); }
  else {
    // pulihin cache tiket dulu biar pill revisi langsung kelihatan (loadTickets refresh di background)
    try { state.ticketMap = JSON.parse(localStorage.getItem('acTickets') || '{}') || {}; } catch (e) { state.ticketMap = {}; }
    try { state.ticketsSeen = new Set(JSON.parse(localStorage.getItem('acTicketsSeen') || '[]')); } catch (e) { state.ticketsSeen = new Set(); }
    show('home'); renderHome();
  }
}
function doLogout() {
  if (!confirm('Keluar dari akun?')) return;
  state.user = ''; state.role = '';
  try { localStorage.removeItem('acAuth'); } catch (e) {}
  show('login');
}

/* ------------------------------ Admin ---------------------------------- */
async function apiPost(payload) {
  if (!state.settings.endpoint) throw new Error('Endpoint belum diset (⚙️)');
  const res = await fetch(state.settings.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  const out = await res.json().catch(() => ({}));
  if (!out.ok) throw new Error(out.error || 'gagal');
  return out;
}

function renderAdmin() { loadRecords(); } // auto-muat daftar begitu panel admin dibuka

async function addNewUser() {
  const user = ($('#nuUser').value || '').trim();
  const pass = ($('#nuPass').value || '').trim();
  if (!user || !pass) { toast('Lengkapi username & password', 'bad'); return; }
  const btn = $('#addUserBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan…'; }
  try {
    await apiPost({ action: 'addUser', user, name: user, pass });
    toast('Akun teknisi dibuat ✓', 'ok');
    $('#nuUser').value = ''; $('#nuPass').value = '';
  } catch (e) { toast('Gagal: ' + e.message, 'bad'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Buat Akun'; }
}

async function loadRecords() {
  const box = $('#recordList'); const btn = $('#loadRecordsBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Memuat…'; }
  try {
    const out = await apiPost({ action: 'records' });
    const recs = out.records || [];
    if (!recs.length) { box.innerHTML = '<p class="note">Belum ada data terupload.</p>'; }
    else {
      box.innerHTML = '';
      const byLok = {};
      recs.forEach(r => { (byLok[r.lokasi] = byLok[r.lokasi] || []).push(r); });
      Object.keys(byLok).sort().forEach(lok => {
        const h = document.createElement('div'); h.className = 'sec-label';
        h.textContent = (SITE_ICON[lok] || '📍') + ' ' + lok + ' (' + byLok[lok].length + ')';
        box.appendChild(h);
        byLok[lok].sort((a, b) => (a.no || 0) - (b.no || 0)).forEach(r => {
          const el = document.createElement('div');
          // Status pill: revisi terkirim (open) → Revisi · teknisi sudah re-upload (done) → Complete · lainnya → Review
          let rp;
          if (r.revisi && r.revisi.status === 'open') rp = ['ticket', '🎫 Revisi'];
          else if (r.revisi && r.revisi.status === 'done') rp = ['done', '✓ Complete'];
          else rp = ['todo', 'Review ›'];
          el.className = 'unit ' + (STATUS_BG[rp[0]] || ''); // background item ngikut status
          el.innerHTML = `<div class="no">${esc(String(r.no || '-'))}</div>
            <div class="info"><h3>${esc(r.ruangan)}</h3>
            <p>${esc(r.merk || '—')} · ${esc(String(r.status || ''))} · ${esc(r.teknisi || '—')}</p></div>
            <span class="pill ${rp[0]}">${rp[1]}</span>`;
          el.onclick = () => openReview(r);
          box.appendChild(el);
        });
      });
    }
  } catch (e) { box.innerHTML = '<p class="note" style="color:#f9a3a3">Gagal muat: ' + esc(e.message) + '</p>'; }
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Muat Data Terupload'; }
}

/* --- Review detail per unit (admin) --- */
const REVIEW_ITEMS = [
  { key: 'info', label: 'Info Unit', val: r => `${r.merk || '—'} · ${r.pk || '—'} PK` },
  { key: 'nametag', label: 'Name Tag / Nameplate', photos: r => r.fotoNametag },
  { key: 'indoor', label: 'Indoor (before/after)', photos: r => r.indoor },
  { key: 'evaporator', label: 'Evaporator (before/after)', photos: r => r.evaporator },
  { key: 'kondensor', label: 'Kondensor (before/after)', photos: r => r.kondensor },
  { key: 'drainase', label: 'Drainase', val: r => r.drainase || '—', photos: r => r.fotoDrainase },
  { key: 'freon', label: 'Freon (psi)', val: r => r.freon || '—', photos: r => r.fotoFreon },
  { key: 'ampere', label: 'Ampere (A)', val: r => r.ampere || '—', photos: r => r.fotoAmpere },
  { key: 'tegangan', label: 'Tegangan (V)', val: r => r.tegangan || '—', photos: r => r.fotoTegangan },
  { key: 'status', label: 'Status', val: r => r.status || '—' }
];

function openReview(r) { state.reviewRec = r; show('review', { sub: r.lokasi + ' · ' + r.ruangan }); renderReview(); }

function driveId(url) {
  const m = String(url).match(/\/d\/([^/]+)/) || String(url).match(/[?&]id=([^&]+)/);
  return m ? m[1] : null;
}
function driveThumb(url) { const id = driveId(url); return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w400` : url; }
function driveBig(url) { const id = driveId(url); return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : url; }
function photoThumbs(urls) {
  if (!urls || !urls.length) return '<span class="note">— tanpa foto —</span>';
  return urls.map(u => `<img class="rev-img" loading="lazy" src="${esc(driveThumb(u))}" data-full="${esc(driveBig(u))}" onclick="openLightbox(this.dataset.full)" onerror="this.classList.add('rev-fail')">`).join('');
}
function openLightbox(src) { const lb = $('#lightbox'), im = $('#lightboxImg'); if (!lb || !im) return; im.src = src; lb.classList.remove('hidden'); }
function closeLightbox() { const lb = $('#lightbox'); if (lb) lb.classList.add('hidden'); const im = $('#lightboxImg'); if (im) im.src = ''; }

function renderReview() {
  const r = state.reviewRec; const wrap = $('#view-review');
  wrap.innerHTML = `
    <div class="card">
      <div class="kv"><span>Ruangan</span><span>${esc(r.ruangan)}</span></div>
      <div class="kv"><span>Lokasi</span><span>${esc(r.lokasi)}</span></div>
      <div class="kv"><span>Teknisi</span><span>${esc(r.teknisi || '—')}</span></div>
      <div class="kv"><span>Tgl Servis</span><span>${esc(r.tglServis || '—')}</span></div>
      <div class="kv"><span>Keterangan</span><span>${esc(r.keterangan || '—')}</span></div>
    </div>
    <p class="note" style="margin:-4px 0 10px">Centang step yang perlu revisi + isi catatannya. Nanti dikirim sekaligus.</p>
    ${REVIEW_ITEMS.map(it => {
      const sent = !!(r.revisi && r.revisi.status === 'open' && (r.revisi.steps || []).indexOf(it.key) !== -1);
      const noteTxt = sent ? ((r.revisi.notes && r.revisi.notes[it.key]) || '') : '';
      return `
      <div class="card${sent ? ' revise-on' : ''}" id="revcard_${it.key}"${sent ? ' style="background:rgba(239,68,68,.22);border-color:rgba(239,68,68,.7)"' : ''}>
        <div class="cap" style="margin-bottom:6px"><b>${esc(it.label)}</b>${it.val ? ` — ${esc(it.val(r))}` : ''}</div>
        ${it.photos ? `<div style="margin-bottom:8px">${photoThumbs(it.photos(r))}</div>` : ''}
        ${sent
          ? `<div class="rev-sent">🎫 Revisi terkirim${noteTxt ? ' — ' + esc(noteTxt) : ''}</div>`
          : `<label class="rev-check"><input type="checkbox" id="rv_${it.key}"> Perlu revisi</label>
        <input id="rvn_${it.key}" class="hidden" style="margin-top:8px" placeholder="Catatan revisi ${esc(it.label)}…">`}
      </div>`;
    }).join('')}
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <button class="btn ok" id="approveBtn">✓ Approve (Terima Hasil)</button>
      <button class="btn" id="sendRevisiBtn">📨 Kirim Revisi</button>
      <button class="btn danger" id="tiketPerbaikanBtn">🔧 Buat Tiket Perbaikan Unit</button>
      <button class="btn ghost" id="reviewBack">‹ Kembali</button>
    </div>`;
  // toggle catatan saat centang
  REVIEW_ITEMS.forEach(it => {
    const cb = $('#rv_' + it.key);
    if (cb) cb.onchange = () => {
      const n = $('#rvn_' + it.key); if (n) n.classList.toggle('hidden', !cb.checked);
      const card = $('#revcard_' + it.key);
      if (card) { // background merah pas ditandai revisi (inline style biar nggak gantung CSS cache)
        card.classList.toggle('revise-on', cb.checked);
        card.style.background = cb.checked ? 'rgba(239,68,68,.22)' : '';
        card.style.borderColor = cb.checked ? 'rgba(239,68,68,.7)' : '';
      }
    };
  });
  on('#reviewBack', 'onclick', () => { show('admin'); renderAdmin(); });
  on('#approveBtn', 'onclick', approveUnit);
  on('#sendRevisiBtn', 'onclick', sendRevisi);
  on('#tiketPerbaikanBtn', 'onclick', sendPerbaikan);
}

async function approveUnit() {
  const r = state.reviewRec;
  const btn = $('#approveBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan…'; }
  try {
    await apiPost({ action: 'approve', lokasi: r.lokasi, ruangan: r.ruangan, by: state.user });
    toast('Disetujui ✓ — hilang dari daftar', 'ok');
    show('admin'); renderAdmin();
  } catch (e) { toast('Gagal: ' + e.message, 'bad'); if (btn) { btn.disabled = false; btn.textContent = '✓ Approve (Terima Hasil)'; } }
}

async function sendRevisi() {
  const r = state.reviewRec;
  const parts = [], keys = [], notes = {};
  const prev = (r.revisi && r.revisi.status === 'open') ? r.revisi : null; // gabung sama revisi yg udah kekirim
  REVIEW_ITEMS.forEach(it => {
    const cb = $('#rv_' + it.key);
    if (cb && cb.checked) {
      const note = ($('#rvn_' + it.key).value || '').trim();
      parts.push(it.label + (note ? ': ' + note : ''));
      keys.push(it.key);
      if (note) notes[it.key] = note;
    } else if (prev && prev.steps.indexOf(it.key) !== -1) {
      // item yg udah dikirim sebelumnya (checkbox disembunyikan) → tetap ikut
      const pn = (prev.notes && prev.notes[it.key]) || '';
      parts.push(it.label + (pn ? ': ' + pn : ''));
      keys.push(it.key);
      if (pn) notes[it.key] = pn;
    }
  });
  if (!parts.length) { toast('Centang minimal 1 step yang perlu revisi', 'bad'); return; }
  const btn = $('#sendRevisiBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Mengirim…'; }
  try {
    await apiPost({ action: 'revisi', type: 'revisi', lokasi: r.lokasi, ruangan: r.ruangan, teknisi: r.teknisi || '', note: 'REVISI — ' + parts.join('; '), steps: keys.join(','), notes: JSON.stringify(notes) });
    toast('Tiket revisi terkirim ke teknisi ✓', 'ok');
    show('admin'); renderAdmin();
  } catch (e) { toast('Gagal: ' + e.message, 'bad'); if (btn) { btn.disabled = false; btn.textContent = '📨 Kirim Revisi'; } }
}

async function sendPerbaikan() {
  const r = state.reviewRec;
  const note = prompt('Tiket perbaikan unit "' + r.ruangan + '" — jelaskan masalahnya (mis. tekanan freon kurang):', '');
  if (note === null || !note.trim()) return;
  try {
    await apiPost({ action: 'revisi', type: 'perbaikan', lokasi: r.lokasi, ruangan: r.ruangan, teknisi: r.teknisi || '', note: 'PERBAIKAN — ' + note.trim() });
    toast('Tiket perbaikan dibuat ✓', 'ok');
  } catch (e) { toast('Gagal: ' + e.message, 'bad'); }
}

/* Tiket revisi di sisi teknisi (tampil di home) */
async function loadTickets() {
  if (state.role === 'admin' || !state.settings.endpoint) { state.ticketMap = {}; return; }
  let tk = [];
  try { const out = await apiPost({ action: 'tickets', teknisi: state.user }); tk = out.tickets || []; } catch (e) { return; }
  const map = {}; tk.forEach(t => { map[t.lokasi + '|' + t.ruangan] = t; });
  state.ticketMap = map;
  try { localStorage.setItem('acTickets', JSON.stringify(map)); } catch (e) {} // cache biar pill langsung tampil pas app dibuka
  // buang "seen" buat tiket yg udah nutup → kalau nanti ada tiket baru (beda note/step) lonceng nyala lagi
  const validKeys = new Set(tk.map(tkKey));
  state.ticketsSeen = new Set([...state.ticketsSeen].filter(k => validKeys.has(k)));
  try { localStorage.setItem('acTicketsSeen', JSON.stringify([...state.ticketsSeen])); } catch (e) {}
  // kalau teknisi lagi mantengin Daftar Ruangan, tiket yg baru masuk dianggap langsung dilihat
  if (state.view === 'list' && state.currentSite) markSiteSeen(state.currentSite);
  updateHomeBadge();
  notifyTickets(tk);
  if (state.view === 'list') { const q = $('#searchInput'); renderList(q ? q.value : ''); }
}
function ticketOf(u) { return state.ticketMap && state.ticketMap[u.lokasi + '|' + u.ruangan]; }

// Notifikasi HP buat tiket admin baru (mirip re-maintenance)
function notifyTickets(tk) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const fresh = tk.filter(t => !state.notifiedTickets.has(t.lokasi + '|' + t.ruangan));
  if (!fresh.length) return;
  fresh.forEach(t => state.notifiedTickets.add(t.lokasi + '|' + t.ruangan));
  const title = `🎫 ${fresh.length} tiket baru dari admin`;
  const body = fresh.slice(0, 5).map(t => '• ' + t.ruangan + ' (' + (t.tipe === 'perbaikan' ? 'Perbaikan' : 'Revisi') + ')').join('\n') + (fresh.length > 5 ? `\n…+${fresh.length - 5} lagi` : '');
  const opts = { body, tag: 'ac-admin-ticket', renotify: true, icon: './icons/icon-192.png', badge: './icons/icon-192.png' };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(r => r.showNotification(title, opts)).catch(() => { try { new Notification(title, opts); } catch (e) {} });
  else { try { new Notification(title, opts); } catch (e) {} }
}
function openTicket(t) {
  const u = state.units.find(x => x.lokasi === t.lokasi && x.ruangan === t.ruangan);
  if (!u) { toast('Ruangan ' + t.ruangan + ' belum ada di HP ini', 'bad'); return; }
  state.currentSite = t.lokasi;
  let rev = null, keys = null;
  if (t.tipe === 'revisi' && t.steps && t.steps.length) {
    keys = t.steps.slice();
    const set = new Set();
    keys.forEach(k => { const s = REVIEW_TO_STEP[k]; if (s != null) set.add(s); });
    set.add(STEPS.length - 1); // selalu sertakan Ringkasan/Simpan
    rev = Array.from(set).sort((a, b) => a - b);
  }
  openWizard(u.id, rev, keys);
}

/* ----------------------------- Update ---------------------------------- */
function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
const RELEASES_URL = 'https://github.com/zaenulilyas/ac-service/releases/latest';
async function forceUpdate() {
  if (isNativeApp()) {
    toast('Membuka halaman download APK terbaru…');
    try { window.open(RELEASES_URL, '_blank'); } catch (e) { location.href = RELEASES_URL; }
    return;
  }
  toast('Cek versi terbaru…');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { try { await r.update(); } catch (e) {} }
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    toast('Memuat versi terbaru…', 'ok');
    setTimeout(() => location.reload(), 700);
  } catch (e) { location.reload(); }
}

/* --------------------------- Notifikasi -------------------------------- */
async function enableNotif() {
  if (!('Notification' in window)) { toast('HP/browser ini nggak dukung notifikasi', 'bad'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') { toast('Notifikasi aktif ✓', 'ok'); checkDueNotify(true); }
  else toast('Izin notifikasi ditolak', 'bad');
}

function checkDueNotify(force) {
  const due = dueUnits();
  if (!due.length) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = due.slice(0, 5).map(u => '• ' + (u.lokasi || 'Unit')).join('\n') + (due.length > 5 ? `\n…+${due.length - 5} lagi` : '');
  const opts = { body, tag: 'ac-ticket', renotify: !!force, icon: './icons/icon-192.png', badge: './icons/icon-192.png' };
  const title = `🎫 ${due.length} tiket servis AC baru`;
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => { try { new Notification(title, opts); } catch (e) {} });
  } else { try { new Notification(title, opts); } catch (e) {} }
}

/* --------------------------- Site Picker ------------------------------- */
function renderSites() {
  const box = $('#siteList'); box.innerHTML = '';
  SITES.forEach(site => {
    const units = siteUnits(site);
    const due = units.filter(u => u.ticketOpen).length;
    const done = units.filter(u => isMaintained(u)).length;
    const el = document.createElement('div');
    el.className = 'unit';
    el.innerHTML = `
      <div class="no">${SITE_ICON[site] || '📍'}</div>
      <div class="info">
        <h3>${esc(site)}</h3>
        <p>${units.length} ruangan · ${done} dikerjakan${due ? ` · 🎫 ${due} tiket` : ''}</p>
      </div>
      ${due ? `<span class="pill ticket">🎫 ${due}</span>` : '<span class="pill todo">›</span>'}`;
    el.onclick = () => { state.currentSite = site; show('list', { title: 'Daftar Ruangan', sub: '' }); renderList(); markSiteSeen(site); loadTickets(); };
    box.appendChild(el);
  });
}

/* --------------------------- Unit List --------------------------------- */
function renderList(filter = '') {
  const box = $('#unitList'); box.innerHTML = '';
  const q = filter.trim().toLowerCase();

  const inSite = siteUnits(state.currentSite);
  // Sembunyikan ruangan yang sudah di-upload & belum jatuh tempo.
  // Muncul lagi otomatis pas jatuh tempo (daysUntil <= 0).
  const visible = inSite.filter(u => ticketOf(u) || !(u.synced && notDueYet(u)));

  const banner = $('#dueBanner'); if (banner) banner.className = 'banner hidden'; // tiket cukup di baris ruangan

  // sugesti autocomplete berdasarkan nama ruangan yang tampil
  const sug = $('#searchSuggest');
  if (sug) sug.innerHTML = [...new Set(visible.map(u => u.ruangan).filter(Boolean))].sort().map(r => `<option value="${esc(r)}">`).join('');

  let items = visible.filter(u => !q || (u.ruangan || '').toLowerCase().includes(q));
  // urutkan: jatuh tempo dulu, lalu sesuai nomor
  items = items.slice().sort((a, b) => (isDue(b) - isDue(a)) || (a.order || 0) - (b.order || 0));

  // empty state kontekstual
  const empty = $('#listEmpty');
  if (empty) {
    if (items.length) empty.classList.add('hidden');
    else {
      empty.classList.remove('hidden');
      empty.innerHTML = inSite.length && !q
        ? `<span class="ic">✅</span>Semua ruangan sudah di-upload.<br>Muncul lagi otomatis sebagai tiket servis ulang.`
        : q ? `<span class="ic">🔍</span>Ruangan "${esc(q)}" nggak ketemu.`
          : `<span class="ic">📋</span>Belum ada ruangan. Tap + buat nambah.`;
    }
  }

  items.forEach((u, idx) => {
    const tk = ticketOf(u);
    let pill;
    if (state.uploading.has(u.id)) pill = ['uploading', '<span class="spin"></span>Upload…'];
    else if (tk) {
      const worked = !u.synced; // ada kerjaan baru sejak tiket (belum di-upload)
      if (!worked) pill = (tk.tipe === 'perbaikan') ? ['due', '🔧 Perbaikan'] : ['ticket', '🎫 Revisi']; // tiket belum dikerjakan
      else {
        // sudah dikerjakan: revisi cek item yg ditandai; perbaikan cek unit penuh
        const done = (tk.tipe === 'revisi') ? ticketMissing(u, tk).length === 0 : isComplete(u);
        pill = done ? ['done', '✓ Selesai'] : ['prog', 'Progres'];
      }
    }
    else if (isComplete(u)) pill = ['done', '✓ Selesai'];
    else if (isProgres(u)) pill = ['prog', 'Progres'];
    else if (u.ticketOpen) pill = ['ticket', '🎫 Tiket baru'];
    else pill = ['todo', 'Belum'];
    let sub = '';
    if (tk && tk.catatan) sub = esc(tk.catatan);
    else if (isMaintained(u)) {
      const ms = dueTime(u) - Date.now();
      let rem;
      if (ms <= 0) rem = 'tiket baru';
      else if (ms < 3600000) rem = `servis ulang ${Math.ceil(ms / 60000)} mnt lagi`;
      else rem = `servis ulang ${Math.ceil(ms / 86400000)} hr lagi`;
      sub = fmtDate(u.tglServis) + ' · ' + rem;
      if (u.merk) sub = esc(u.merk) + ' · ' + sub;
    }
    const el = document.createElement('div');
    el.className = 'unit ' + (STATUS_BG[pill[0]] || ''); // background item ngikut status
    el.innerHTML = `
      <div class="no">${idx + 1}</div>
      <div class="info">
        <h3>${esc(u.ruangan || 'Ruangan baru')}</h3>
        ${sub ? `<p>${sub}</p>` : ''}
      </div>
      <span class="pill ${pill[0]}">${pill[1]}</span>`;
    el.onclick = tk ? () => openTicket(tk) : () => openWizard(u.id);
    box.appendChild(el);
  });
}

/* ----------------------------- Wizard ---------------------------------- */
async function openWizard(id, reviseSteps, reviseKeys) {
  const u = state.units.find(x => x.id === id);
  if (!u) return;
  markSiteTicketsSeen(); // buka ruangan = udah lihat daftar → tiket lain jadi Belum
  state.reviseSteps = (reviseSteps && reviseSteps.length) ? reviseSteps : null;
  state.reviseKeys = (reviseKeys && reviseKeys.length) ? reviseKeys : null;
  state.current = JSON.parse(JSON.stringify(u));
  state.step = 0;
  // load foto ke cache
  state.photoCache = {};
  for (const slot of Object.keys(u.photos || {})) {
    const d = await idbGet('photos', u.id + ':' + slot);
    if (d) state.photoCache[slot] = d;
  }
  show('wizard');
  renderWizard();
}

function activeSteps() { return (state.reviseSteps && state.reviseSteps.length) ? state.reviseSteps : STEPS.map((_, k) => k); }
// Revisi terarah: item cuma ditampilkan kalau dicentang admin (null = semua, servis normal)
function keyActive(k) { return !state.reviseKeys || state.reviseKeys.indexOf(k) !== -1; }

function renderWizard() {
  const steps = activeSteps();
  const pos = state.step;              // posisi dalam daftar step aktif
  const real = steps[pos];             // index step sebenarnya (0..6)
  const last = steps.length - 1;
  const wrap = $('#view-wizard');
  const bar = steps.map((_, k) => `<div class="s ${k < pos ? 'done' : k === pos ? 'active' : ''}"></div>`).join('');
  const revLabel = state.reviseSteps ? ' · Revisi' : '';
  wrap.innerHTML = `
    <div class="steps">${bar}</div>
    <div class="step-title">Langkah ${pos + 1}/${steps.length}${revLabel}</div>
    <div class="step">${renderStep(real)}</div>
    <div class="wizard-nav">
      ${pos > 0 ? '<button class="btn ghost" id="prevStep">‹ Sebelumnya</button>' : '<button class="btn ghost" id="prevMenu">‹ Sebelumnya</button>'}
      ${pos < last ? '<button class="btn" id="nextStep">Lanjut ›</button>' : '<button class="btn ok" id="saveUnit">💾 Simpan</button>'}
    </div>`;
  bindStep(real);
  const nx = $('#nextStep'); if (nx) nx.onclick = async () => { collectStep(real); await persistCurrent(false); state.step++; renderWizard(); };
  const pv = $('#prevStep'); if (pv) pv.onclick = async () => { collectStep(real); await persistCurrent(false); state.step--; renderWizard(); };
  const pm = $('#prevMenu'); if (pm) pm.onclick = goBack;
  const del = $('#delUnit'); if (del) del.onclick = deleteCurrentUnit;
  const sv = $('#saveUnit'); if (sv) sv.onclick = () => { collectStep(real); saveCurrentUnit(); };
}

// (Tak dipakai lagi — revisi sekarang disimpan biasa lalu di-upload via tombol Upload di Daftar Ruangan)
async function saveAndUploadRevision() {
  const miss = missingItems(state.current);
  if (miss.length) { toast('Lengkapi dulu: ' + miss.slice(0, 3).join(', '), 'bad'); return; }
  await persistCurrent(true);
  const u = state.units.find(x => x.id === state.current.id);
  const btn = $('#saveUnit'); if (btn) { btn.disabled = true; btn.textContent = 'Mengirim…'; }
  try {
    await syncUnit(u, true); // merge: jaga data step lain
    toast('Revisi terkirim ✓', 'ok');
    state.reviseSteps = null; state.reviseKeys = null;
    show('list', { title: 'Daftar Ruangan', sub: '' }); renderList(); loadTickets();
    renderHome();
  } catch (e) { toast('Gagal upload: ' + e.message, 'bad'); if (btn) { btn.disabled = false; btn.textContent = '💾 Simpan & Kirim'; } }
}

function h2(t) { return `<h2>${t}</h2>`; }

function renderStep(i) {
  const u = state.current;
  switch (i) {
    case 0: {
      const infoFields = keyActive('info') ? `
        <div class="grid2">
          <div class="field"><label>Merk</label>${merkSelectHTML(u.merk)}</div>
          <div class="field"><label>PK</label>${selectHTML('f_pk', PK_OPTIONS, u.pk)}</div>
        </div>
        <div class="field ${MERK_OPTIONS.includes(u.merk) || !u.merk ? 'hidden' : ''}" id="merkOtherWrap">
          <label>Merk lain</label><input id="f_merk_other" value="${MERK_OPTIONS.includes(u.merk) ? '' : esc(u.merk)}" placeholder="Tulis merk…">
        </div>` : '';
      return h2('📋 Info Unit') + `
      <div class="card">
        <div class="field"><label>Lokasi</label><div class="chip">${SITE_ICON[u.lokasi] || '📍'} ${esc(u.lokasi || '—')}</div></div>
        <div class="field"><label>Ruangan</label><div class="chip">🚪 ${esc(u.ruangan || '—')}</div></div>
        ${infoFields}
      </div>` + (keyActive('nametag') ? slotHTML(NAMETAG_SLOT) : '');
    }
    case 1: return h2('❄️ Unit Indoor') +
      `<p class="note" style="margin:-6px 0 14px">Kerjakan indoor sampai selesai — foto <b>sebelum</b>, cuci, lalu foto <b>sesudah</b>. Baru nanti pindah ke outdoor.</p>` +
      INDOOR_PARTS.filter(p => keyActive(p.key)).map(photoPairHTML).join('');
    case 2: return h2('🌡️ Unit Outdoor (Kondensor)') +
      `<p class="note" style="margin:-6px 0 14px">Sekarang pindah ke unit outdoor. Foto <b>sebelum</b> & <b>sesudah</b> cleaning kondensor.</p>` +
      OUTDOOR_PARTS.map(photoPairHTML).join('');
    case 3: {
      const act = UKUR_SLOTS.filter(x => keyActive(x.field));
      return h2('🔢 Hasil Ukur') +
        `<p class="note" style="margin:-6px 0 14px">Foto alat ukur dulu, baru isi angkanya di bawah.</p>` +
        act.map(slotHTML).join('') +
        `<div class="card">` + act.map(x =>
          `<div class="field"><label>${esc(x.numLabel)}</label><input type="number" inputmode="decimal" id="f_${x.field}" value="${esc(u[x.field])}" placeholder="${esc(x.ph)}"></div>`
        ).join('') + `</div>`;
    }
    case 4: return h2('💧 Drainase') +
      `<p class="note" style="margin:-6px 0 14px">Foto saluran pembuangan dulu, baru isi kondisinya.</p>` +
      slotHTML(DRAINASE_SLOT) +
      `<div class="card"><div class="field"><label>Kondisi drainase</label><input id="f_k_drainase" value="${esc(u.kondisi.drainase)}" placeholder="Lancar / tersumbat / bocor…"></div></div>`;
    case 5: return h2('✅ Penilaian') + `
      <div class="card">
        <div class="field"><label>Status</label>${selectHTML('f_status', STATUS_OPTIONS, u.status)}</div>
        <div class="field"><label>Teknisi (yang mengerjakan)</label><input id="f_teknisi1" value="${esc(u.teknisi1 || state.user)}" placeholder="Nama teknisi"></div>
        <div class="field"><label>Catatan</label><textarea id="f_catatan" placeholder="Temuan, saran, part yang perlu diganti…">${esc(u.catatan)}</textarea></div>
      </div>`;
    case 6: return h2('📄 Ringkasan') + summaryHTML();
    default: return '';
  }
}

function selectHTML(id, opts, val) {
  return `<select id="${id}">` + opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('') + `</select>`;
}

function merkSelectHTML(val) {
  const inList = MERK_OPTIONS.includes(val);
  const sel = (val && !inList) ? 'Lainnya' : val;
  const opts = ['', ...MERK_OPTIONS, 'Lainnya'];
  return `<select id="f_merk">` + opts.map(o =>
    `<option value="${esc(o)}" ${o === sel ? 'selected' : ''}>${o === '' ? '— pilih —' : esc(o)}</option>`
  ).join('') + `</select>`;
}

/* Satu bagian = foto before & after bersebelahan (dalam satu layar, per unit) */
function photoPairHTML(part) {
  return `<div class="card">
    <div class="cap" style="margin-bottom:10px"><b>${esc(part.label)}</b></div>
    <div class="ba-grid">
      <div><div class="cap"><span class="tag before">BEFORE</span></div>${photoBoxHTML(part.key + '_before')}</div>
      <div><div class="cap"><span class="tag after">AFTER</span></div>${photoBoxHTML(part.key + '_after')}</div>
    </div>
  </div>`;
}

function slotHTML(s) {
  return `<div class="photo-slot"><div class="cap"><b>${esc(s.label)}</b></div>${photoBoxHTML(s.key)}</div>`;
}

function photoBoxHTML(slot) {
  const img = state.photoCache[slot];
  if (img) return `<div class="photo-box" data-slot="${slot}"><img src="${img}"><span class="retake">🔄 Ganti</span></div>`;
  return `<div class="photo-box" data-slot="${slot}"><div><span class="ic">📷</span>Tap untuk ambil foto</div></div>`;
}

function summaryHTML() {
  const u = state.current;
  const nPhotos = Object.keys(state.photoCache).length;
  const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${esc(v || '—')}</span></div>`;
  return `<div class="card">
    ${kv('Lokasi', u.lokasi)}${kv('Ruangan', u.ruangan)}${kv('Merk / PK', (u.merk || '—') + ' · ' + u.pk + ' PK')}
    ${kv('Tgl Servis', u.tglServis)}${kv('Freon (psi)', u.freon)}
    ${kv('Ampere / Tegangan', (u.ampere || '—') + ' A · ' + (u.tegangan || '—') + ' V')}
    ${kv('Status', u.status)}${kv('Servis berikutnya', u.tglBerikutnya)}
    ${kv('Foto terkumpul', nPhotos + '/' + requiredPhotoSlots().length + ' foto')}
    ${kv('Teknisi', u.teknisi1)}
  </div>
  ${(() => {
    const miss = missingItems(u);
    return miss.length
      ? `<div class="banner">⚠️ Belum lengkap — masih kurang:<br>${miss.map(esc).join(', ')}<br><small>Lengkapi dulu biar bisa di-upload.</small></div>`
      : `<p class="note" style="color:#7ee2a4">✓ Lengkap. Tap "Simpan", lalu "⤒ Upload" di daftar ruangan.</p>`;
  })()}`;
}

// Daftar item yang masih kurang biar dianggap lengkap
function missingItems(u) {
  const m = []; const p = u.photos || {};
  const check = (req) => {
    if (!req) return;
    req.fields.forEach(f => { if (!String(u[f[0]] == null ? '' : u[f[0]]).trim()) m.push(f[1]); });
    req.photos.forEach(ph => { if (!p[ph[0]]) m.push(ph[1]); });
  };
  if (state.reviseKeys && state.reviseKeys.length) {
    // Revisi terarah → cuma cek item yang dicentang admin (freon/indoor/…)
    state.reviseKeys.forEach(k => check(KEY_REQ[k]));
  } else {
    // Servis normal → cek semua step data (0..5)
    [0, 1, 2, 3, 4, 5].forEach(s => check(STEP_REQ[s]));
  }
  return m;
}

// Cek kelengkapan REVISI (buat status pill di daftar ruangan) berdasar item yg dicentang admin
function ticketMissing(u, tk) {
  if (!tk || tk.tipe !== 'revisi' || !tk.steps || !tk.steps.length) return [];
  const m = []; const p = u.photos || {};
  tk.steps.forEach(k => {
    const req = KEY_REQ[k]; if (!req) return;
    req.fields.forEach(f => { if (!String(u[f[0]] == null ? '' : u[f[0]]).trim()) m.push(f[1]); });
    req.photos.forEach(ph => { if (!p[ph[0]]) m.push(ph[1]); });
  });
  return m;
}

/* Bind foto-box klik ke input kamera */
function bindStep(i) {
  $$('.photo-box').forEach(box => {
    box.onclick = () => triggerCapture(box.dataset.slot);
  });
  const ms = $('#f_merk');
  if (ms) ms.onchange = () => { const w = $('#merkOtherWrap'); if (w) w.classList.toggle('hidden', ms.value !== 'Lainnya'); };
}

let captureInput = null;
function triggerCapture(slot) {
  if (!captureInput) {
    captureInput = document.createElement('input');
    captureInput.type = 'file'; captureInput.accept = 'image/*'; captureInput.capture = 'environment';
    captureInput.style.display = 'none'; document.body.appendChild(captureInput);
  }
  captureInput.value = '';
  captureInput.onchange = async () => {
    const f = captureInput.files && captureInput.files[0];
    if (!f) return;
    try {
      const box = document.querySelector('.photo-box[data-slot="' + slot + '"]');
      if (box) box.innerHTML = '<div style="text-align:center"><span class="spin big"></span><div style="margin-top:8px;font-size:13px;color:var(--mut)">Memproses…</div></div>';
      const data = await fileToCompressedDataURL(f);
      collectStep(state.step); // simpan dulu isian di layar biar nggak ke-reset
      state.photoCache[slot] = data;
      state.current.photos[slot] = true;
      // simpan langsung supaya nggak hilang kalau app ketutup
      await idbPut('photos', data, state.current.id + ':' + slot);
      renderWizard();
    } catch (e) { toast('Gagal proses foto', 'bad'); }
  };
  captureInput.click();
}

/* Ambil nilai input step ke state.current */
function collectStep(i) {
  const u = state.current, g = (id) => { const el = $('#' + id); return el ? el.value : undefined; };
  const set = (id, key) => { const v = g(id); if (v !== undefined) u[key] = v; };
  switch (i) {
    case 0: { const m = g('f_merk'); if (m !== undefined) u.merk = (m === 'Lainnya') ? (g('f_merk_other') || '').trim() : m; set('f_pk', 'pk'); } break;
    case 3: set('f_freon', 'freon'); set('f_ampere', 'ampere'); set('f_tegangan', 'tegangan'); break;
    case 4: { const v = g('f_k_drainase'); if (v !== undefined) u.kondisi.drainase = v; } break;
    case 5: set('f_status', 'status'); set('f_catatan', 'catatan'); set('f_teknisi1', 'teknisi1'); break;
  }
}

async function persistCurrent(markDone) {
  const u = state.current;
  u.touched = true;
  if (markDone) {
    // Tanggal servis OTOMATIS = hari ini. Jatuh tempo: menit (mode tes) atau +REMIND_DAYS.
    u.tglServis = todayISO();
    u.maintainedAt = todayISO();
    if (REMIND_MINUTES > 0) { u.dueAt = Date.now() + REMIND_MINUTES * 60000; u.tglBerikutnya = todayISO(); }
    else { u.dueAt = 0; u.tglBerikutnya = addDaysISO(u.tglServis, REMIND_DAYS); }
    u.synced = false;
  }
  u.updatedAt = Date.now();
  await idbPut('units', u);
  const idx = state.units.findIndex(x => x.id === u.id);
  const copy = JSON.parse(JSON.stringify(u));
  if (idx >= 0) state.units[idx] = copy; else state.units.push(copy);
}

async function saveCurrentUnit() {
  await persistCurrent(true);
  state.reviseSteps = null; state.reviseKeys = null; // keluar mode revisi
  toast('Tersimpan di HP — tap ⤒ Upload buat kirim', 'ok');
  show('list', { title: 'Daftar Ruangan', sub: '' }); renderList($('#searchInput').value);
  renderHome();
}

async function deleteCurrentUnit() {
  if (!confirm('Hapus unit ini beserta fotonya?')) return;
  const u = state.current;
  for (const slot of Object.keys(u.photos || {})) await idbDel('photos', u.id + ':' + slot);
  await idbDel('units', u.id);
  state.units = state.units.filter(x => x.id !== u.id);
  toast('Unit dihapus');
  show('list', { title: 'Daftar Ruangan', sub: '' }); renderList();
  renderHome();
}

/* --------------------------- Add new unit ------------------------------ */
async function addUnit() {
  const name = (prompt('Nama ruangan baru:') || '').trim();
  if (!name) return;
  const u = blankUnit();
  u.ruangan = name;
  await idbPut('units', u);
  state.units.push(u);
  openWizard(u.id);
}

/* ------------------------------ Sync ----------------------------------- */
async function syncAll() {
  const ep = state.settings.endpoint;
  if (!ep) { toast('Isi URL Apps Script di ⚙️ dulu', 'bad'); return; }
  const site = siteUnits(state.currentSite);
  const ready = site.filter(u => !u.synced && unitDone(u));
  const incomplete = site.filter(u => !u.synced && !unitDone(u) && isProgres(u));
  if (!ready.length) {
    if (incomplete.length) {
      const names = incomplete.slice(0, 3).map(u => u.ruangan).join(', ');
      toast(`⚠️ Belum lengkap: ${names}${incomplete.length > 3 ? ` +${incomplete.length - 3}` : ''}. Lengkapi semua foto & isian dulu.`, 'bad');
    } else toast('Belum ada ruangan yang selesai buat di-upload');
    return;
  }
  toast(`Upload ${ready.length} ruangan…`);
  ready.forEach(u => state.uploading.add(u.id));
  renderList($('#searchInput').value);
  let ok = 0, fail = 0;
  for (const u of ready) {
    const t = ticketOf(u); const isRev = !!(t && t.tipe === 'revisi'); // upload revisi → merge biar data lain aman
    try { await syncUnit(u, isRev); ok++; } catch (e) { fail++; }
    state.uploading.delete(u.id);
    renderList($('#searchInput').value);
  }
  state.uploading.clear();
  renderList($('#searchInput').value); renderHome();
  if (incomplete.length) toast(`Upload ${ok} selesai. ⚠️ ${incomplete.length} ruangan masih perlu dilengkapi teknisi`, 'bad');
  else toast(`Upload selesai: ${ok} sukses${fail ? ', ' + fail + ' gagal' : ''}`, fail ? 'bad' : 'ok');
}

async function syncUnit(u, merge) {
  const photos = {};
  for (const slot of Object.keys(u.photos || {})) {
    const d = await idbGet('photos', u.id + ':' + slot);
    if (d) photos[slot] = d;
  }
  const payload = {
    project: state.settings.project,
    jenis: 'maintenance', unit: sanitizeUnit(u), photos, merge: !!merge
  };
  const res = await fetch(state.settings.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) throw new Error(out.error || 'sync gagal');
  u.synced = true; u.ticketOpen = false; u.updatedAt = Date.now();
  await idbPut('units', u);
  const idx = state.units.findIndex(x => x.id === u.id); if (idx >= 0) { state.units[idx].synced = true; state.units[idx].ticketOpen = false; }
  return out;
}

function sanitizeUnit(u) {
  const { id, order, lokasi, ruangan, merk, pk, tglServis, freon, ampere, tegangan, kondisi, status, tglBerikutnya, teknisi1, teknisi2, supervisor, catatan } = u;
  return { id, order, lokasi, ruangan, merk, pk, tglServis, freon, ampere, tegangan, kondisi, status, tglBerikutnya, teknisi1, teknisi2, supervisor, catatan };
}

async function testConnection() {
  const ep = state.settings.endpoint;
  if (!ep) { toast('URL belum diisi', 'bad'); return; }
  toast('Menguji koneksi…');
  try {
    const res = await fetch(ep + (ep.includes('?') ? '&' : '?') + 'ping=1');
    const out = await res.json().catch(() => ({}));
    toast(out.ok ? '✓ Terhubung ke Sheets' : 'Terhubung tapi respons aneh', out.ok ? 'ok' : 'bad');
  } catch (e) { toast('Gagal konek (cek URL / deploy)', 'bad'); }
}

/* --------------------------- CSV Export -------------------------------- */
function exportCSV() {
  const cols = ['No', 'Lokasi', 'Ruangan', 'Tgl Servis', 'Merk', 'PK', 'Freon(psi)', 'Indoor', 'Kondensor', 'Evaporator', 'Drainase', 'Ampere', 'Tegangan', 'Status', 'Tgl Berikutnya', 'Teknisi 1', 'Teknisi 2', 'Supervisor', 'Keterangan'];
  const rows = state.units.map(u => [
    u.order, u.lokasi, u.ruangan, u.tglServis, u.merk, u.pk, u.freon,
    u.kondisi.indoor, u.kondisi.kondensor, u.kondisi.evaporator, u.kondisi.drainase,
    u.ampere, u.tegangan, u.status, u.tglBerikutnya, u.teknisi1, u.teknisi2, u.supervisor, u.catatan
  ]);
  const csv = [cols, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ac-service-' + todayISO() + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
  toast('CSV diunduh', 'ok');
}

/* --------------------------- Settings view ----------------------------- */
async function renderSettings() {
  $('#setEndpoint').value = state.settings.endpoint || '';
  $('#setProject').value = state.settings.project || '';
  const ver = $('#appVer'); if (ver) ver.textContent = APP_VERSION;
  const cu = $('#curUser'); if (cu) cu.textContent = state.user || '—';
  const photos = await idbAll('photos');
  $('#statUnits').textContent = state.units.length;
  $('#statUnsynced').textContent = state.units.filter(u => !u.synced && (u.lokasi || u.merk)).length;
  $('#statPhotos').textContent = photos.length;
}

async function wipeAll() {
  if (!confirm('Hapus SEMUA data & foto dari HP ini? Tidak bisa dibatalkan.')) return;
  await idbClear('units'); await idbClear('photos');
  state.units = [];
  toast('Semua data dihapus');
  renderSettings(); renderHome();
}

/* ------------------------------ Wire ----------------------------------- */
function on(sel, evt, fn) { const el = $(sel); if (el) el[evt] = fn; }
function wire() {
  on('#backBtn', 'onclick', goBack);
  on('#titleWrap', 'onclick', () => { if (['sites', 'list', 'settings'].includes(state.view)) goBack(); });
  on('#settingsBtn', 'onclick', () => { show('settings'); renderSettings(); });

  $$('.tile').forEach(t => t.onclick = () => {
    const go = t.dataset.go;
    if (go === 'maintenance') { show('sites'); renderSites(); }
    else toast('Modul Instalasi segera hadir 🔧');
  });

  on('#addUnitBtn', 'onclick', addUnit);
  on('#searchInput', 'oninput', (e) => renderList(e.target.value));
  on('#syncAllBtn', 'onclick', syncAll);
  on('#exportBtn', 'onclick', exportCSV);

  on('#saveSettingsBtn', 'onclick', saveSettings);
  on('#testConnBtn', 'onclick', testConnection);
  on('#wipeBtn', 'onclick', wipeAll);
  on('#notifBtn', 'onclick', enableNotif);
  on('#updateBtn', 'onclick', forceUpdate);
  on('#loginBtn', 'onclick', doLogin);
  on('#logoutBtn', 'onclick', doLogout);
  on('#adminLogoutBtn', 'onclick', doLogout);
  on('#addUserBtn', 'onclick', addNewUser);
  on('#loadRecordsBtn', 'onclick', loadRecords);
  const lp = $('#loginPass'); if (lp) lp.onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  on('#lightboxClose', 'onclick', closeLightbox);
  const lb = $('#lightbox'); if (lb) lb.onclick = (e) => { if (e.target.id === 'lightbox') closeLightbox(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
}

/* ------------------------------ Boot ----------------------------------- */
async function boot() {
  _db = await openDB();
  await loadSettings();
  await loadUnits();
  await seedIfNeeded();
  await loadUnits();
  // Bersihin: ruangan yang ke-upload tapi belum benar-benar diservis → balikin "Belum".
  for (const u of state.units) {
    if (u.synced && !isMaintained(u)) { u.synced = false; await idbPut('units', u); }
  }
  wire();
  let saved = null;
  try { const raw = localStorage.getItem('acAuth'); if (raw) saved = JSON.parse(raw); } catch (e) { saved = null; }
  if (saved && saved.name) { state.user = saved.name; state.role = saved.role || 'teknisi'; enterApp(); }
  else { show('login'); }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  await processTickets(); // buka tiket buat unit yang lewat jatuh tempo
  setTimeout(() => checkDueNotify(false), 1500); // reminder saat app dibuka
  // auto-refresh: cek tiket baru + render ulang (penting buat mode tes menit)
  setInterval(async () => {
    const changed = await processTickets();
    loadTickets(); // refresh tiket admin (revisi/perbaikan) → pill di daftar ruangan
    if (state.view === 'list') { const q = $('#searchInput'); renderList(q ? q.value : ''); }
    else if (state.view === 'home') renderHome();
    else if (changed && state.view === 'sites') renderSites();
  }, 15000);
}
boot().catch(err => { document.body.innerHTML = '<div class="app"><p style="color:#f88">Gagal start: ' + esc(err.message) + '</p></div>'; });
