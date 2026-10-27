# Prima Carts - Aplikasi Android (WebView + Peta OpenStreetMap)

Aplikasi Android dengan layanan penumpang dan kurir ala ojek online.
Tampilan utamanya adalah web app yang ada di dalam aplikasi
(`app/src/main/assets/web/`), dibungkus WebView dengan bar navigasi bawah.

## Fitur (mode demo)

- Peta OpenStreetMap (Leaflet), otomatis memakai lokasi GPS HP
  (kota mana pun). Bila GPS mati, peta dibuka di Jakarta.
- Cari alamat (Nominatim) atau ketuk peta / geser pin untuk memilih titik.
- Rute, jarak, dan waktu tempuh (OSRM).
- Tab **Penumpang**: Prima Bike, Prima Car, Prima Car XL.
- Tab **Kurir**: Prima Send Motor, Prima Send Mobil (jenis barang,
  nama dan HP penerima, catatan).
- Estimasi tarif per layanan, konfirmasi pesanan, simulasi pencarian driver,
  dan riwayat pesanan (tersimpan di HP).

Catatan: ini **prototipe**. Belum ada server, driver sungguhan, maupun
pembayaran. Tarif ada di `SERVICES` pada `assets/web/app.js`.

## Cara build APK otomatis di GitHub

1. Upload seluruh isi folder ini ke repository GitHub (branch `main`).
   Pastikan folder `.github/workflows/` (pakai titik) ikut ter-upload.
2. Buka tab **Actions**. Workflow **Build Android APK** jalan otomatis
   (atau klik **Run workflow**).
3. Setelah hijau, unduh artifact **PrimaCarts-APK** (klik angka pada
   kolom Artifacts di bagian atas halaman run). Isinya
   `PrimaCarts-debug.apk` dan `PrimaCarts-release.apk`.

Untuk halaman Release dengan APK terlampir, buat tag `v2.0`.

## Mengubah isi

- Tampilan dan logika: `app/src/main/assets/web/` (`index.html`,
  `style.css`, `app.js`)
- Nama aplikasi: `app/src/main/res/values/strings.xml`
- Package name dan versi: `app/build.gradle`

## Catatan layanan peta gratis

Server publik OpenStreetMap (tile), Nominatim (cari alamat), dan OSRM
(rute) hanya untuk pemakaian ringan/demo. Untuk aplikasi dengan banyak
pengguna, gunakan penyedia berbayar atau host sendiri. Leaflet dimuat dari
CDN, jadi aplikasi butuh internet.

APK release ditandatangani dengan kunci debug supaya langsung bisa
di-install. Untuk Google Play Store, gunakan keystore sendiri.
