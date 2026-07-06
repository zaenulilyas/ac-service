/* =========================================================================
   AC Service — Sukaregang  |  MAINTENANCE module (PWA, offline-first)
   Data: IndexedDB (HP) + optional sync ke Google Sheets (Apps Script)
   ========================================================================= */

'use strict';

/* ----------------------------- Config ---------------------------------- */
const PK_OPTIONS = ['0.5', '0.75', '1', '1.5', '2', '2.5', '3', '5', '10'];
const STATUS_OPTIONS = ['OK', 'NOK'];
const APP_VERSION = 'v35'; // dinaikin tiap update biar keliatan di Pengaturan
const REMIND_DAYS = 7; // jatuh tempo re-maintenance: 7 hari setelah servis
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
  { key: 'ukur_freon', label: 'Manifold / Tekanan Freon' },
  { key: 'ukur_ampere', label: 'Ampere (tang ampere)' },
  { key: 'ukur_tegangan', label: 'Tegangan (multimeter)' }
];

const STEPS = ['Info Unit', 'Unit Indoor', 'Unit Outdoor', 'Hasil Ukur', 'Drainase', 'Penilaian', 'Simpan'];

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

/* ----------------------------- State ----------------------------------- */
const state = {
  settings: { endpoint: '', project: 'Service Check AC' },
  units: [],
  currentSite: '',   // lokasi (site) yang dipilih
  current: null,     // unit sedang diedit di wizard
  step: 0,
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
    synced: false, updatedAt: Date.now()
  };
}

function isMaintained(u) { return !!u.maintainedAt; }
function isDue(u) { return isMaintained(u) && daysUntil(u.tglBerikutnya) <= 0; }
function dueUnits() { return state.units.filter(isDue); }

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
const VIEWS = ['home', 'sites', 'list', 'wizard', 'settings'];
function show(view, opts = {}) {
  VIEWS.forEach(v => $('#view-' + v).classList.toggle('hidden', v !== view));
  const setBtn = $('#settingsBtn');
  const titles = { home: ['AC Service', 'Maintenance & Instalasi'], sites: ['Maintenance', ''], list: ['Daftar Ruangan', ''], wizard: ['Servis Unit', ''], settings: ['Pengaturan', ''] };
  $('#viewTitle').textContent = opts.title != null ? opts.title : titles[view][0];
  $('#viewSub').textContent = opts.sub != null ? opts.sub : titles[view][1];
  if (setBtn) setBtn.classList.toggle('hidden', view === 'settings' || view === 'wizard');
  const back = $('#backBtn'); if (back) back.classList.toggle('hidden', view === 'home' || view === 'wizard');
  const tw = $('#titleWrap'); if (tw) tw.style.cursor = view === 'home' ? 'default' : 'pointer';
  state.view = view;
  window.scrollTo(0, 0);
}

function goBack() {
  if (state.view === 'wizard') { show('list', { title: 'Daftar Ruangan', sub: '' }); renderList($('#searchInput').value); }
  else if (state.view === 'list') { show('sites'); renderSites(); }
  else if (state.view === 'settings') { show('home'); renderHome(); }
  else { show('home'); renderHome(); }
}

/* ------------------------------ Home ----------------------------------- */
async function renderHome() {
  const done = state.units.filter(u => u.synced).length;
  const due = dueUnits().length;
  $('#homeStat').textContent = `${state.units.length} unit terdaftar · ${done} ter-sync` + (due ? ` · 🔔 ${due} jatuh tempo` : '');
  // badge di tile MAINTENANCE
  const tile = document.querySelector('.tile[data-go="maintenance"]');
  if (tile) {
    let b = tile.querySelector('.badge-due');
    if (due) { if (!b) { b = document.createElement('span'); b.className = 'badge-due'; tile.appendChild(b); } b.textContent = `🔔 ${due}`; }
    else if (b) b.remove();
  }
}

/* ----------------------------- Update ---------------------------------- */
async function forceUpdate() {
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
  const opts = { body, tag: 'ac-due', renotify: !!force, icon: './icons/icon-192.png', badge: './icons/icon-192.png' };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(`🔔 ${due.length} AC jatuh tempo maintenance`, opts)).catch(() => { try { new Notification(`🔔 ${due.length} AC jatuh tempo`, opts); } catch (e) {} });
  } else { try { new Notification(`🔔 ${due.length} AC jatuh tempo`, opts); } catch (e) {} }
}

/* --------------------------- Site Picker ------------------------------- */
function renderSites() {
  const box = $('#siteList'); box.innerHTML = '';
  SITES.forEach(site => {
    const units = siteUnits(site);
    const due = units.filter(isDue).length;
    const done = units.filter(u => isMaintained(u)).length;
    const el = document.createElement('div');
    el.className = 'unit';
    el.innerHTML = `
      <div class="no">${SITE_ICON[site] || '📍'}</div>
      <div class="info">
        <h3>${esc(site)}</h3>
        <p>${units.length} ruangan · ${done} dikerjakan${due ? ` · 🔔 ${due} jatuh tempo` : ''}</p>
      </div>
      ${due ? `<span class="pill due">🔔 ${due}</span>` : '<span class="pill todo">›</span>'}`;
    el.onclick = () => { state.currentSite = site; show('list', { title: 'Daftar Ruangan', sub: '' }); renderList(); };
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
  const visible = inSite.filter(u => !(u.synced && daysUntil(u.tglBerikutnya) > 0));

  // banner jatuh tempo (per lokasi)
  const due = visible.filter(isDue);
  const banner = $('#dueBanner');
  if (banner) {
    if (due.length) { banner.classList.remove('hidden'); banner.textContent = `🔔 ${due.length} ruangan jatuh tempo re-maintenance`; }
    else banner.classList.add('hidden');
  }

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
        ? `<span class="ic">✅</span>Semua ruangan sudah di-upload.<br>Muncul lagi otomatis pas jatuh tempo servis.`
        : q ? `<span class="ic">🔍</span>Ruangan "${esc(q)}" nggak ketemu.`
          : `<span class="ic">📋</span>Belum ada ruangan. Tap + buat nambah.`;
    }
  }

  items.forEach((u, idx) => {
    let pill;
    if (state.uploading.has(u.id)) pill = ['uploading', '<span class="spin"></span>Upload…'];
    else if (isDue(u)) pill = ['due', '🔔 Jatuh tempo'];
    else if (isComplete(u)) pill = ['done', '✓ Selesai'];
    else if (isProgres(u)) pill = ['prog', 'Progres'];
    else pill = ['todo', 'Belum'];
    let sub = '';
    if (isMaintained(u)) {
      const d = daysUntil(u.tglBerikutnya);
      sub = fmtDate(u.tglServis) + (d <= 0 ? ` · telat ${-d} hr` : ` · ulang ${d} hr lagi`);
      if (u.merk) sub = esc(u.merk) + ' · ' + sub;
    }
    const el = document.createElement('div');
    el.className = 'unit';
    el.innerHTML = `
      <div class="no">${idx + 1}</div>
      <div class="info">
        <h3>${esc(u.ruangan || 'Ruangan baru')}</h3>
        ${sub ? `<p>${sub}</p>` : ''}
      </div>
      <span class="pill ${pill[0]}">${pill[1]}</span>`;
    el.onclick = () => openWizard(u.id);
    box.appendChild(el);
  });
}

/* ----------------------------- Wizard ---------------------------------- */
async function openWizard(id) {
  const u = state.units.find(x => x.id === id);
  if (!u) return;
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

function renderWizard() {
  const u = state.current, i = state.step;
  const wrap = $('#view-wizard');
  const bar = STEPS.map((_, k) => `<div class="s ${k < i ? 'done' : k === i ? 'active' : ''}"></div>`).join('');
  wrap.innerHTML = `
    <div class="steps">${bar}</div>
    <div class="step-title">Langkah ${i + 1}/${STEPS.length}</div>
    <div class="step">${renderStep(i)}</div>
    <div class="wizard-nav">
      ${i > 0 ? '<button class="btn ghost" id="prevStep">‹ Sebelumnya</button>' : '<button class="btn ghost" id="prevMenu">‹ Sebelumnya</button>'}
      ${i < STEPS.length - 1 ? '<button class="btn" id="nextStep">Lanjut ›</button>' : '<button class="btn ok" id="saveUnit">💾 Simpan</button>'}
    </div>`;
  bindStep(i);
  // nav
  const nx = $('#nextStep'); if (nx) nx.onclick = async () => { collectStep(i); await persistCurrent(false); state.step++; renderWizard(); };
  const pv = $('#prevStep'); if (pv) pv.onclick = async () => { collectStep(i); await persistCurrent(false); state.step--; renderWizard(); };
  const pm = $('#prevMenu'); if (pm) pm.onclick = goBack;
  const del = $('#delUnit'); if (del) del.onclick = deleteCurrentUnit;
  const sv = $('#saveUnit'); if (sv) sv.onclick = () => { collectStep(i); saveCurrentUnit(); };
}

function h2(t) { return `<h2>${t}</h2>`; }

function renderStep(i) {
  const u = state.current;
  switch (i) {
    case 0: return h2('📋 Info Unit') + `
      <div class="card">
        <div class="field"><label>Lokasi</label><div class="chip">${SITE_ICON[u.lokasi] || '📍'} ${esc(u.lokasi || '—')}</div></div>
        <div class="field"><label>Ruangan</label><div class="chip">🚪 ${esc(u.ruangan || '—')}</div></div>
        <div class="grid2">
          <div class="field"><label>Merk</label>${merkSelectHTML(u.merk)}</div>
          <div class="field"><label>PK</label>${selectHTML('f_pk', PK_OPTIONS, u.pk)}</div>
        </div>
        <div class="field ${MERK_OPTIONS.includes(u.merk) || !u.merk ? 'hidden' : ''}" id="merkOtherWrap">
          <label>Merk lain</label><input id="f_merk_other" value="${MERK_OPTIONS.includes(u.merk) ? '' : esc(u.merk)}" placeholder="Tulis merk…">
        </div>
      </div>` + slotHTML(NAMETAG_SLOT);
    case 1: return h2('❄️ Unit Indoor') +
      `<p class="note" style="margin:-6px 0 14px">Kerjakan indoor sampai selesai — foto <b>sebelum</b>, cuci, lalu foto <b>sesudah</b>. Baru nanti pindah ke outdoor.</p>` +
      INDOOR_PARTS.map(photoPairHTML).join('');
    case 2: return h2('🌡️ Unit Outdoor (Kondensor)') +
      `<p class="note" style="margin:-6px 0 14px">Sekarang pindah ke unit outdoor. Foto <b>sebelum</b> & <b>sesudah</b> cleaning kondensor.</p>` +
      OUTDOOR_PARTS.map(photoPairHTML).join('');
    case 3: return h2('🔢 Hasil Ukur') +
      `<p class="note" style="margin:-6px 0 14px">Foto alat ukur dulu, baru isi angkanya di bawah.</p>` +
      UKUR_SLOTS.map(slotHTML).join('') + `
      <div class="card">
        <div class="grid2">
          <div class="field"><label>Freon (psi)</label><input type="number" inputmode="decimal" id="f_freon" value="${esc(u.freon)}" placeholder="mis. 75"></div>
          <div class="field"><label>Ampere (A)</label><input type="number" inputmode="decimal" id="f_ampere" value="${esc(u.ampere)}" placeholder="mis. 3.2"></div>
        </div>
        <div class="field"><label>Tegangan (V)</label><input type="number" inputmode="decimal" id="f_tegangan" value="${esc(u.tegangan)}" placeholder="mis. 220"></div>
      </div>`;
    case 4: return h2('💧 Drainase') +
      `<p class="note" style="margin:-6px 0 14px">Foto saluran pembuangan dulu, baru isi kondisinya.</p>` +
      slotHTML(DRAINASE_SLOT) +
      `<div class="card"><div class="field"><label>Kondisi drainase</label><input id="f_k_drainase" value="${esc(u.kondisi.drainase)}" placeholder="Lancar / tersumbat / bocor…"></div></div>`;
    case 5: return h2('✅ Penilaian') + `
      <div class="card">
        <div class="field"><label>Status</label>${selectHTML('f_status', STATUS_OPTIONS, u.status)}</div>
        <div class="field"><label>Teknisi (yang mengerjakan)</label><input id="f_teknisi1" value="${esc(u.teknisi1)}" placeholder="Nama teknisi"></div>
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
  const m = [];
  if (!u.merk) m.push('Merk');
  if (u.freon === '') m.push('Freon');
  if (u.ampere === '') m.push('Ampere');
  if (u.tegangan === '') m.push('Tegangan');
  if (!u.teknisi1) m.push('Teknisi');
  const p = u.photos || {};
  const labels = {
    indoor_before: 'Foto Indoor before', indoor_after: 'Foto Indoor after',
    evaporator_before: 'Foto Evaporator before', evaporator_after: 'Foto Evaporator after',
    kondensor_before: 'Foto Kondensor before', kondensor_after: 'Foto Kondensor after',
    ukur_freon: 'Foto Freon', ukur_ampere: 'Foto Ampere', ukur_tegangan: 'Foto Tegangan',
    drainase: 'Foto Drainase'
  };
  requiredPhotoSlots().forEach(s => { if (!p[s]) m.push(labels[s] || s); });
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
    // Tanggal servis OTOMATIS = hari ini. Berikutnya = +REMIND_DAYS.
    u.tglServis = todayISO();
    u.maintainedAt = todayISO();
    u.tglBerikutnya = addDaysISO(u.tglServis, REMIND_DAYS);
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
  toast('Tersimpan di HP', 'ok');
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
  const ready = site.filter(u => !u.synced && isComplete(u));
  const incomplete = site.filter(u => !u.synced && isProgres(u));
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
    try { await syncUnit(u); ok++; } catch (e) { fail++; }
    state.uploading.delete(u.id);
    renderList($('#searchInput').value);
  }
  state.uploading.clear();
  renderList($('#searchInput').value); renderHome();
  if (incomplete.length) toast(`Upload ${ok} selesai. ⚠️ ${incomplete.length} ruangan masih perlu dilengkapi teknisi`, 'bad');
  else toast(`Upload selesai: ${ok} sukses${fail ? ', ' + fail + ' gagal' : ''}`, fail ? 'bad' : 'ok');
}

async function syncUnit(u) {
  const photos = {};
  for (const slot of Object.keys(u.photos || {})) {
    const d = await idbGet('photos', u.id + ':' + slot);
    if (d) photos[slot] = d;
  }
  const payload = {
    project: state.settings.project,
    jenis: 'maintenance', unit: sanitizeUnit(u), photos
  };
  const res = await fetch(state.settings.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) throw new Error(out.error || 'sync gagal');
  u.synced = true; u.updatedAt = Date.now();
  await idbPut('units', u);
  const idx = state.units.findIndex(x => x.id === u.id); if (idx >= 0) state.units[idx].synced = true;
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
  on('#titleWrap', 'onclick', () => { if (state.view !== 'home') goBack(); });
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
  show('home'); renderHome();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  setTimeout(() => checkDueNotify(false), 1500); // reminder jatuh tempo saat app dibuka
}
boot().catch(err => { document.body.innerHTML = '<div class="app"><p style="color:#f88">Gagal start: ' + esc(err.message) + '</p></div>'; });
