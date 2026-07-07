/**
 * AC Service — backend (multi-user). 1 sheet per lokasi + tab Users + tab Revisi.
 * Aksi via body.action: service(default upload) | login | addUser | records | revisi | tickets
 */
var DRIVE_FOLDER = 'Foto Service AC';
var COLS = ['No', 'Lokasi/Ruangan', 'Tgl Servis', 'Merk', 'PK', 'Freon(psi)', 'Indoor',
  'Kondensor', 'Evaporator', 'Drainase', 'Ampere', 'Tegangan', 'Status', 'Tgl Berikutnya', 'Teknisi', 'Keterangan'];
var HDR_ROW = 2;
var DATA_ROW = 3;
var USERS_SHEET = 'Users';
var USERS_COLS = ['Username', 'Password', 'Nama', 'Role'];
var REVISI_SHEET = 'Revisi';
var REVISI_COLS = ['Timestamp', 'Lokasi', 'Ruangan', 'Teknisi', 'Tipe', 'Catatan', 'Status', 'Steps', 'Notes'];
var FOTO_SHEET = 'FotoLinks';
var APPROVED_SHEET = 'Approved';
var SKIP_SHEETS = { 'Users': 1, 'Revisi': 1, 'Maintenance': 1, 'Sheet1': 1, 'FotoLinks': 1, 'Approved': 1 };

function setup() {
  getFolder(); ensureUsers(); ensureRevisi();
  return 'OK — folder Drive + tab Users (admin/admin123) + Revisi siap.';
}
function getFolder() {
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
}
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

// Simpan semua link foto per ruangan ke tabel FotoLinks (biar review baca-nya pasti)
function saveFotoLinks(lokasi, ruangan, links) {
  var sh = ss().getSheetByName(FOTO_SHEET);
  if (!sh) { sh = ss().insertSheet(FOTO_SHEET); sh.appendRow(['Lokasi', 'Ruangan', 'Links']); }
  var json = JSON.stringify(links || {});
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === lokasi && rows[i][1] === ruangan) { sh.getRange(i + 1, 3).setValue(json); return; }
  }
  sh.appendRow([lokasi, ruangan, json]);
}
// Approve: unit yang udah diterima admin → hilang dari daftar review
function ensureApproved() {
  var sh = ss().getSheetByName(APPROVED_SHEET);
  if (!sh) { sh = ss().insertSheet(APPROVED_SHEET); sh.appendRow(['Lokasi', 'Ruangan', 'Status', 'By', 'Waktu']); }
  return sh;
}
function setApproval(lokasi, ruangan, status, by) {
  var sh = ensureApproved(); var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === lokasi && rows[i][1] === ruangan) {
      sh.getRange(i + 1, 3).setValue(status); sh.getRange(i + 1, 4).setValue(by || ''); sh.getRange(i + 1, 5).setValue(new Date()); return;
    }
  }
  sh.appendRow([lokasi, ruangan, status, by || '', new Date()]);
}
function clearApproval(lokasi, ruangan) {
  var sh = ss().getSheetByName(APPROVED_SHEET); if (!sh) return;
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) { if (rows[i][0] === lokasi && rows[i][1] === ruangan) { sh.getRange(i + 1, 3).setValue(''); return; } }
}
function approvedSet() {
  var s = {}; var sh = ss().getSheetByName(APPROVED_SHEET); if (!sh) return s;
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) { if (String(rows[i][2]) === 'approved') s[rows[i][0] + '|' + rows[i][1]] = 1; }
  return s;
}
function apiApprove(b) {
  if (!b.lokasi || !b.ruangan) return { ok: false, error: 'lokasi/ruangan kosong' };
  setApproval(b.lokasi, b.ruangan, 'approved', b.by || '');
  return { ok: true };
}

function mergeObj(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
function loadFotoMap() {
  var map = {};
  var sh = ss().getSheetByName(FOTO_SHEET);
  if (!sh) return map;
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    try { map[rows[i][0] + '|' + rows[i][1]] = JSON.parse(rows[i][2] || '{}'); } catch (e) {}
  }
  return map;
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function ensureUsers() {
  var sh = ss().getSheetByName(USERS_SHEET);
  if (!sh) { sh = ss().insertSheet(USERS_SHEET); sh.appendRow(USERS_COLS); sh.appendRow(['admin', 'admin123', 'Admin', 'admin']); }
  return sh;
}
function ensureRevisi() {
  var sh = ss().getSheetByName(REVISI_SHEET);
  if (!sh) { sh = ss().insertSheet(REVISI_SHEET); sh.appendRow(REVISI_COLS); }
  return sh;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.ping) return json({ ok: true, msg: 'AC Service backend aktif' });
  return json({ ok: true });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || 'service';
    if (action === 'login') return json(apiLogin(body));
    if (action === 'addUser') return json(apiAddUser(body));
    if (action === 'records') return json(apiRecords(body));
    if (action === 'revisi') return json(apiRevisi(body));
    if (action === 'tickets') return json(apiTickets(body));
    if (action === 'approve') return json(apiApprove(body));
    return json(apiService(body));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* ---------- Auth & users ---------- */
function apiLogin(b) {
  var sh = ensureUsers();
  var rows = sh.getDataRange().getValues();
  var u = String(b.user || '').trim().toLowerCase();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === u && String(rows[i][1]) === String(b.pass)) {
      return { ok: true, name: rows[i][2] || rows[i][0], role: rows[i][3] || 'teknisi' };
    }
  }
  return { ok: false, error: 'Username / password salah' };
}
function apiAddUser(b) {
  var sh = ensureUsers();
  var u = String(b.user || '').trim();
  if (!u || !b.pass || !b.name) return { ok: false, error: 'Lengkapi username, nama, password' };
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === u.toLowerCase()) return { ok: false, error: 'Username sudah dipakai' };
  }
  sh.appendRow([u, String(b.pass), String(b.name), b.role === 'admin' ? 'admin' : 'teknisi']);
  return { ok: true };
}

/* ---------- Records review (detail + link foto) ---------- */
// Status tiket revisi terakhir per ruangan (buat pill panel admin: Review/Revisi/Complete)
function revisiStatusMap() {
  var sh = ensureRevisi();
  var rows = sh.getDataRange().getValues();
  var m = {};
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][1]) continue;
    var stepStr = String(rows[i][7] || '');
    var notesObj = {};
    try { notesObj = JSON.parse(String(rows[i][8] || '{}')) || {}; } catch (e) { notesObj = {}; }
    m[rows[i][1] + '|' + rows[i][2]] = {
      tipe: String(rows[i][4]), status: String(rows[i][6]),
      steps: stepStr ? stepStr.split(',') : [], notes: notesObj, catatan: String(rows[i][5] || '')
    }; // baris terakhir = paling baru
  }
  return m;
}

function apiRecords(b) {
  var out = [];
  var fotoMap = loadFotoMap();
  var appr = approvedSet();
  var revMap = revisiStatusMap();
  var sheets = ss().getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s]; var name = sh.getName();
    if (SKIP_SHEETS[name]) continue;
    if (sh.getRange(HDR_ROW, 1).getValue() !== 'No') continue;
    var last = sh.getLastRow();
    if (last < DATA_ROW) continue;
    var n = last - DATA_ROW + 1;
    var rng = sh.getRange(DATA_ROW, 1, n, COLS.length);
    var vals = rng.getValues();
    var rich = rng.getRichTextValues();
    var formulas = rng.getFormulas();
    for (var i = 0; i < n; i++) {
      var r = vals[i];
      if (!r[1]) continue;
      if (appr[name + '|' + r[1]]) continue; // sudah di-approve → sembunyikan
      var linksOf = function (col0) {
        var urls = [];
        var rt = rich[i][col0];
        if (rt) {
          var whole = rt.getLinkUrl();               // sel yg seluruhnya 1 link (mis. angka Freon)
          if (whole) urls.push(whole);
          else { var runs = rt.getRuns(); for (var j = 0; j < runs.length; j++) { var u = runs[j].getLinkUrl(); if (u) urls.push(u); } }
        }
        if (!urls.length) {                          // fallback: formula =HYPERLINK("url",...)
          var f = formulas[i][col0];
          if (f) { var re = /HYPERLINK\("([^"]+)"/gi, m; while ((m = re.exec(f))) urls.push(m[1]); }
        }
        return urls;
      };
      var L = fotoMap[name + '|' + r[1]] || {};
      var jl = function (keys, fb) { var o = []; for (var x = 0; x < keys.length; x++) { if (L[keys[x]]) o.push(L[keys[x]]); } return o.length ? o : (fb || []); };
      out.push({
        lokasi: name, no: r[0], ruangan: r[1], tglServis: r[2], merk: r[3], pk: r[4],
        freon: r[5], indoor: jl(['indoor_before', 'indoor_after'], linksOf(6)),
        kondensor: jl(['kondensor_before', 'kondensor_after'], linksOf(7)),
        evaporator: jl(['evaporator_before', 'evaporator_after'], linksOf(8)),
        drainase: r[9], ampere: r[10], tegangan: r[11], status: r[12], teknisi: r[14], keterangan: r[15],
        fotoFreon: jl(['ukur_freon'], linksOf(5)), fotoDrainase: jl(['drainase'], linksOf(9)),
        fotoAmpere: jl(['ukur_ampere'], linksOf(10)), fotoTegangan: jl(['ukur_tegangan'], linksOf(11)),
        fotoNametag: jl(['nametag'], []),
        revisi: revMap[name + '|' + r[1]] || null // {tipe,status} tiket revisi terakhir
      });
    }
  }
  return { ok: true, records: out };
}

/* ---------- Revisi tickets ---------- */
// Kolom Revisi (1-based): 1 TS, 2 Lokasi, 3 Ruangan, 4 Teknisi, 5 Tipe, 6 Catatan, 7 Status
function apiRevisi(b) {
  var sh = ensureRevisi();
  if (!b.lokasi || !b.ruangan) return { ok: false, error: 'lokasi/ruangan kosong' };
  var tipe = (b.type === 'perbaikan') ? 'perbaikan' : 'revisi';
  var steps = String(b.steps || '');
  var notes = String(b.notes || '');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === b.lokasi && rows[i][2] === b.ruangan && rows[i][4] === tipe && String(rows[i][6]) === 'open') {
      sh.getRange(i + 1, 6).setValue(String(b.note || ''));
      sh.getRange(i + 1, 4).setValue(String(b.teknisi || rows[i][3]));
      sh.getRange(i + 1, 8).setValue(steps);
      sh.getRange(i + 1, 9).setValue(notes);
      return { ok: true, updated: true };
    }
  }
  sh.appendRow([new Date(), b.lokasi, b.ruangan, String(b.teknisi || ''), tipe, String(b.note || ''), 'open', steps, notes]);
  return { ok: true };
}
function apiTickets(b) {
  var sh = ensureRevisi();
  var rows = sh.getDataRange().getValues();
  var name = String(b.teknisi || '').trim().toLowerCase();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][6]) !== 'open') continue;
    if (name && String(rows[i][3]).trim().toLowerCase() !== name) continue;
    var stepStr = String(rows[i][7] || '');
    out.push({ lokasi: rows[i][1], ruangan: rows[i][2], tipe: rows[i][4], catatan: rows[i][5], steps: stepStr ? stepStr.split(',') : [] });
  }
  return { ok: true, tickets: out };
}
function closeTickets(lokasi, ruangan) {
  var sh = ensureRevisi();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === lokasi && rows[i][2] === ruangan && String(rows[i][6]) === 'open') {
      sh.getRange(i + 1, 7).setValue('done');
    }
  }
}

/* ---------- Service upload (default) ---------- */
function sheetFor(lokasi) {
  var name = lokasi || 'Maintenance';
  var sh = ss().getSheetByName(name);
  if (!sh) sh = ss().insertSheet(name);
  if (sh.getRange(HDR_ROW, 1).getValue() !== 'No' ||
    sh.getRange(HDR_ROW, COLS.length).getValue() !== COLS[COLS.length - 1]) initSheet(sh, name);
  return sh;
}
function initSheet(sh, lokasi) {
  sh.getRange(1, 1, 1, COLS.length).breakApart().merge()
    .setValue('Service Check Air Conditioner ' + lokasi)
    .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center');
  sh.getRange(HDR_ROW, 1, 1, COLS.length).setValues([COLS])
    .setBackground('#FFD966').setFontWeight('bold').setHorizontalAlignment('center');
  sh.setFrozenRows(HDR_ROW);
  sh.setColumnWidth(1, 45);
}
function pairRich(links, part) {
  var items = [];
  if (links[part + '_before']) items.push(['Before', links[part + '_before']]);
  if (links[part + '_after']) items.push(['After', links[part + '_after']]);
  if (!items.length) return null;
  var text = '', runs = [];
  items.forEach(function (it, idx) { if (idx > 0) text += ' | '; var st = text.length; text += it[0]; runs.push([st, text.length, it[1]]); });
  var rt = SpreadsheetApp.newRichTextValue().setText(text);
  runs.forEach(function (r) { rt.setLinkUrl(r[0], r[1], r[2]); });
  return rt.build();
}
function linkRich(value, url) {
  var text = String(value == null || value === '' ? 'Foto' : value);
  var rt = SpreadsheetApp.newRichTextValue().setText(text);
  if (url) rt.setLinkUrl(0, text.length, url);
  return rt.build();
}
function apiService(body) {
  var u = body.unit || {};
  var k = u.kondisi || {};
  var lokasi = u.lokasi || 'Maintenance';

  var links = {}, folderUrl = '';
  var photos = body.photos || {};
  var slots = Object.keys(photos);
  if (slots.length) {
    var sub = getFolder().createFolder(lokasi + ' - ' + (u.ruangan || u.id || 'unit') + ' — ' + new Date().toISOString().slice(0, 10));
    folderUrl = sub.getUrl();
    slots.forEach(function (slot) {
      var b64 = String(photos[slot]).replace(/^data:image\/\w+;base64,/, '');
      var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', slot + '.jpg');
      var f = sub.createFile(blob);
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      links[slot] = f.getUrl();
    });
  }

  var sh = sheetFor(lokasi);
  var last = sh.getLastRow();
  var target = 0;
  if (last >= DATA_ROW) {
    var names = sh.getRange(DATA_ROW, 2, last - DATA_ROW + 1, 1).getValues();
    for (var i = 0; i < names.length; i++) { if (String(names[i][0]) === String(u.ruangan)) { target = DATA_ROW + i; break; } }
  }
  var exists = !!target;
  if (!target) target = Math.max(last + 1, DATA_ROW);

  // MERGE (revisi): gabung link foto lama + baru, pertahankan nilai lama kalau baru kosong
  var mergedLinks = (body.merge && exists) ? mergeObj((loadFotoMap()[lokasi + '|' + u.ruangan]) || {}, links) : links;
  var old = (body.merge && exists) ? sh.getRange(target, 1, 1, COLS.length).getValues()[0] : [];
  var pick = function (val, idx) {
    if (body.merge && exists) { return String(val == null ? '' : val).trim() !== '' ? val : old[idx]; }
    return val;
  };

  var row = [target - DATA_ROW + 1, u.ruangan, pick(u.tglServis, 2), pick(u.merk, 3), pick(u.pk, 4),
    pick(u.freon, 5), '', '', '', pick((k.drainase || ''), 9), pick(u.ampere, 10), pick(u.tegangan, 11),
    pick(u.status, 12), pick(u.tglBerikutnya, 13), pick(u.teknisi1, 14), pick((u.catatan || ''), 15)];
  sh.getRange(target, 1, 1, row.length).setValues([row]);

  var L = mergedLinks;
  var setRich = function (col, rtv) { if (rtv) sh.getRange(target, col).setRichTextValue(rtv); };
  if (L['ukur_freon']) setRich(6, linkRich(row[5], L['ukur_freon']));
  setRich(7, pairRich(L, 'indoor'));
  setRich(8, pairRich(L, 'kondensor'));
  setRich(9, pairRich(L, 'evaporator'));
  if (L['drainase']) setRich(10, linkRich(row[9], L['drainase']));
  if (L['ukur_ampere']) setRich(11, linkRich(row[10], L['ukur_ampere']));
  if (L['ukur_tegangan']) setRich(12, linkRich(row[11], L['ukur_tegangan']));

  sh.autoResizeColumns(2, COLS.length - 2);
  sh.setColumnWidth(1, 45);
  sh.setColumnWidth(COLS.length, 300);

  saveFotoLinks(lokasi, u.ruangan, mergedLinks); // simpan link foto (sudah merge)
  clearApproval(lokasi, u.ruangan); // upload baru → balik lagi buat di-review
  closeTickets(lokasi, u.ruangan); // upload ulang → tutup tiket revisi
  return { ok: true };
}
