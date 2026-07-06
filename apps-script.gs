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
var REVISI_COLS = ['Timestamp', 'Lokasi', 'Ruangan', 'Teknisi', 'Catatan', 'Status'];
var SKIP_SHEETS = { 'Users': 1, 'Revisi': 1, 'Maintenance': 1, 'Sheet1': 1 };

function setup() {
  getFolder(); ensureUsers(); ensureRevisi();
  return 'OK — folder Drive + tab Users (admin/admin123) + Revisi siap.';
}
function getFolder() {
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
}
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
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

/* ---------- Records review ---------- */
function apiRecords(b) {
  var out = [];
  var sheets = ss().getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s]; var name = sh.getName();
    if (SKIP_SHEETS[name]) continue;
    if (sh.getRange(HDR_ROW, 1).getValue() !== 'No') continue;
    var last = sh.getLastRow();
    if (last < DATA_ROW) continue;
    var vals = sh.getRange(DATA_ROW, 1, last - DATA_ROW + 1, COLS.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      if (!r[1]) continue; // ruangan kosong
      out.push({ lokasi: name, no: r[0], ruangan: r[1], tglServis: r[2], merk: r[3], status: r[12], teknisi: r[14] });
    }
  }
  return { ok: true, records: out };
}

/* ---------- Revisi tickets ---------- */
function apiRevisi(b) {
  var sh = ensureRevisi();
  if (!b.lokasi || !b.ruangan) return { ok: false, error: 'lokasi/ruangan kosong' };
  // Hindari dobel tiket open utk ruangan yg sama
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === b.lokasi && rows[i][2] === b.ruangan && String(rows[i][5]) === 'open') {
      sh.getRange(i + 1, 5).setValue(String(b.note || ''));   // update catatan
      sh.getRange(i + 1, 4).setValue(String(b.teknisi || rows[i][3]));
      return { ok: true, updated: true };
    }
  }
  sh.appendRow([new Date(), b.lokasi, b.ruangan, String(b.teknisi || ''), String(b.note || ''), 'open']);
  return { ok: true };
}
function apiTickets(b) {
  var sh = ensureRevisi();
  var rows = sh.getDataRange().getValues();
  var name = String(b.teknisi || '').trim().toLowerCase();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][5]) !== 'open') continue;
    if (name && String(rows[i][3]).trim().toLowerCase() !== name) continue;
    out.push({ lokasi: rows[i][1], ruangan: rows[i][2], catatan: rows[i][4] });
  }
  return { ok: true, tickets: out };
}
function closeTickets(lokasi, ruangan) {
  var sh = ensureRevisi();
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === lokasi && rows[i][2] === ruangan && String(rows[i][5]) === 'open') {
      sh.getRange(i + 1, 6).setValue('done');
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

  var row = [0, u.ruangan, u.tglServis, u.merk, u.pk, u.freon,
    '', '', '', (k.drainase || ''), u.ampere, u.tegangan, u.status, u.tglBerikutnya, u.teknisi1, (u.catatan || '')];

  var sh = sheetFor(lokasi);
  var last = sh.getLastRow();
  var target = 0;
  if (last >= DATA_ROW) {
    var names = sh.getRange(DATA_ROW, 2, last - DATA_ROW + 1, 1).getValues();
    for (var i = 0; i < names.length; i++) { if (String(names[i][0]) === String(u.ruangan)) { target = DATA_ROW + i; break; } }
  }
  if (!target) target = Math.max(last + 1, DATA_ROW);
  row[0] = target - DATA_ROW + 1;
  sh.getRange(target, 1, 1, row.length).setValues([row]);

  var setRich = function (col, rtv) { if (rtv) sh.getRange(target, col).setRichTextValue(rtv); };
  if (links['ukur_freon']) setRich(6, linkRich(u.freon, links['ukur_freon']));
  setRich(7, pairRich(links, 'indoor'));
  setRich(8, pairRich(links, 'kondensor'));
  setRich(9, pairRich(links, 'evaporator'));
  if (links['drainase']) setRich(10, linkRich(k.drainase, links['drainase']));
  if (links['ukur_ampere']) setRich(11, linkRich(u.ampere, links['ukur_ampere']));
  if (links['ukur_tegangan']) setRich(12, linkRich(u.tegangan, links['ukur_tegangan']));

  sh.autoResizeColumns(2, COLS.length - 2);
  sh.setColumnWidth(1, 45);
  sh.setColumnWidth(COLS.length, 300);

  closeTickets(lokasi, u.ruangan); // upload ulang → tutup tiket revisi
  return { ok: true };
}
