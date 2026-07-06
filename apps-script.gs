/**
 * AC Service — backend. 1 sheet per lokasi.
 * Indoor/Kondensor/Evaporator = "Before | After" (2 link);
 * Freon/Ampere/Tegangan/Drainase = nilai jadi link foto. Kolom Teknisi di kanan.
 */
var DRIVE_FOLDER = 'Foto Service AC';
var COLS = ['No', 'Lokasi/Ruangan', 'Tgl Servis', 'Merk', 'PK', 'Freon(psi)', 'Indoor',
  'Kondensor', 'Evaporator', 'Drainase', 'Ampere', 'Tegangan', 'Status', 'Tgl Berikutnya', 'Teknisi', 'Keterangan'];
var HDR_ROW = 2;
var DATA_ROW = 3;

function setup() {
  getFolder();
  return 'OK — folder Drive siap.';
}

function getFolder() {
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.ping) return json({ ok: true, msg: 'AC Service backend aktif' });
  return json({ ok: true });
}

function sheetFor(lokasi) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = lokasi || 'Maintenance';
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // (re)tulis header kalau belum ada / beda jumlah kolom (mis. kolom Teknisi baru)
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
  sh.setColumnWidth(1, 45); // kolom No sempit
}

// "Before | After" dengan tiap kata jadi link
function pairRich(links, part) {
  var items = [];
  if (links[part + '_before']) items.push(['Before', links[part + '_before']]);
  if (links[part + '_after']) items.push(['After', links[part + '_after']]);
  if (!items.length) return null;
  var text = '', runs = [];
  items.forEach(function (it, idx) {
    if (idx > 0) text += ' | ';
    var start = text.length; text += it[0];
    runs.push([start, text.length, it[1]]);
  });
  var rt = SpreadsheetApp.newRichTextValue().setText(text);
  runs.forEach(function (r) { rt.setLinkUrl(r[0], r[1], r[2]); });
  return rt.build();
}

// Teks (nilai) yang seluruhnya jadi link ke foto
function linkRich(value, url) {
  var text = String(value == null || value === '' ? 'Foto' : value);
  var rt = SpreadsheetApp.newRichTextValue().setText(text);
  if (url) rt.setLinkUrl(0, text.length, url);
  return rt.build();
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var u = body.unit || {};
    var k = u.kondisi || {};
    var lokasi = u.lokasi || 'Maintenance';

    // Simpan foto ke Drive
    var links = {}, folderUrl = '';
    var photos = body.photos || {};
    var slots = Object.keys(photos);
    if (slots.length) {
      var sub = getFolder().createFolder(
        lokasi + ' - ' + (u.ruangan || u.id || 'unit') + ' — ' + new Date().toISOString().slice(0, 10));
      folderUrl = sub.getUrl();
      slots.forEach(function (slot) {
        var b64 = String(photos[slot]).replace(/^data:image\/\w+;base64,/, '');
        var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', slot + '.jpg');
        var f = sub.createFile(blob);
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        links[slot] = f.getUrl();
      });
    }

    // Baris dasar (teks polos); link foto ditambah via rich text setelahnya
    var row = [0, u.ruangan, u.tglServis, u.merk, u.pk, u.freon,
      '', '', '', (k.drainase || ''), u.ampere, u.tegangan, u.status, u.tglBerikutnya, u.teknisi1, (u.catatan || '')];

    var sh = sheetFor(lokasi);
    var last = sh.getLastRow();
    var target = 0;
    if (last >= DATA_ROW) {
      var names = sh.getRange(DATA_ROW, 2, last - DATA_ROW + 1, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (String(names[i][0]) === String(u.ruangan)) { target = DATA_ROW + i; break; }
      }
    }
    if (!target) target = Math.max(last + 1, DATA_ROW);
    row[0] = target - DATA_ROW + 1; // No urut sesuai baris (atas = 1)
    sh.getRange(target, 1, 1, row.length).setValues([row]);

    // Overlay link foto per kolom
    var setRich = function (col, rtv) { if (rtv) sh.getRange(target, col).setRichTextValue(rtv); };
    if (links['ukur_freon']) setRich(6, linkRich(u.freon, links['ukur_freon']));
    setRich(7, pairRich(links, 'indoor'));
    setRich(8, pairRich(links, 'kondensor'));
    setRich(9, pairRich(links, 'evaporator'));
    if (links['drainase']) setRich(10, linkRich(k.drainase, links['drainase']));
    if (links['ukur_ampere']) setRich(11, linkRich(u.ampere, links['ukur_ampere']));
    if (links['ukur_tegangan']) setRich(12, linkRich(u.tegangan, links['ukur_tegangan']));

    sh.autoResizeColumns(2, COLS.length - 2); // resize kolom 2..sebelum Keterangan (skip No & Keterangan)
    sh.setColumnWidth(1, 45);                 // kolom No dikunci sempit
    sh.setColumnWidth(COLS.length, 300);      // Keterangan lebar tetap (≈3x kolom normal)

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
