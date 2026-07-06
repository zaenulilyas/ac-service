# AC Service — Sukaregang (PWA)

Aplikasi web (PWA) untuk **maintenance AC split**. Teknisi dipandu langkah demi langkah:
foto **before/after** cleaning (indoor, kondensor, evaporator), foto drainase, foto hasil ukur
(freon, ampere, tegangan), lalu penilaian & TTD. Data tersimpan **offline di HP** dan bisa
**sync ke Google Sheets** + foto ke Google Drive.

> Home punya 2 menu: **MAINTENANCE** (aktif) & **INSTALASI** (coming soon).

## Jalankan (test cepat)

Perlu di-serve lewat HTTP (bukan `file://`) supaya kamera + service worker jalan.

```bash
cd ac-maintenance-app
python3 -m http.server 8080
# buka http://<ip-komputer>:8080 di browser HP (satu WiFi), atau http://localhost:8080 di desktop
```

Di HP: buka URL → menu browser → **"Tambah ke Layar Utama"** → jadi kayak app.
Kamera muncul saat tap kotak foto (butuh izin kamera + HTTPS/localhost).

> Untuk akses dari HP dengan HTTPS (biar kamera pasti jalan di Android), bisa lewat tunnel
> (cloudflared) seperti setup ScreenMicMonitor — tinggal arahkan ke port 8080.

## Sambung ke Google Sheets

1. Buat Spreadsheet baru.
2. Extensions → Apps Script → tempel `apps-script.gs`.
3. Deploy sebagai **Web app** (Execute as: Me, Who has access: **Anyone**), salin URL `/exec`.
4. Jalankan `setup()` sekali (bikin header sheet + folder Drive).
5. Di app: ⚙️ → tempel URL + nama proyek → **Simpan** → **Tes Koneksi**.
6. Di daftar ruangan tap **⇪ Sync** untuk kirim.

Tanpa endpoint pun app tetap jalan penuh (offline); tinggal **⬇︎ CSV** untuk export.

## Struktur

| File | Fungsi |
|---|---|
| `index.html` | Kerangka UI + 4 view (home, list, wizard, settings) |
| `styles.css` | Tema gelap, mobile-first |
| `app.js` | Logika: IndexedDB, wizard foto, sync, CSV |
| `sw.js` | Service worker (offline cache) |
| `manifest.webmanifest` | Metadata PWA (installable) |
| `apps-script.gs` | Backend Google Sheets + Drive |

## Catatan teknis

- Foto dikompres ke JPEG max 1280px (~q0.7) sebelum disimpan → hemat storage & kuota sync.
- Penyimpanan: **IndexedDB** (`units`, `photos`, `meta`). Foto disimpan terpisah dari data unit
  supaya daftar tetap ringan.
- Seed 11 lokasi dari PDF di run pertama; unit bebas ditambah/hapus (dinamis).
- Kolom CSV & Sheet mengikuti template PDF asli (No, Lokasi, Tgl, Merk, PK, Freon, Indoor,
  Kondensor, Evaporator, Drainase, Ampere, Tegangan, Status, Tgl Berikutnya, Teknisi, Supervisor).

## Next (kalau sudah fix)

- Modul **INSTALASI** (form pemasangan unit baru).
- Bungkus jadi **APK** (WebView / Capacitor / TWA).
- Ikon PWA (`icons/icon-192.png`, `icon-512.png`) — sekarang placeholder.
