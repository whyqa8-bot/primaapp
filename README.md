# Prima Carts - Aplikasi Android WebView

Aplikasi Android yang menampilkan https://primacarts.com/ dengan bar navigasi
bawah (Kembali, Maju, Beranda, Muat ulang), pull-to-refresh, indikator loading,
dan dukungan upload file.

## Cara build APK otomatis di GitHub

1. Buat repository baru di GitHub (kosong).
2. Upload / push seluruh isi folder ini ke branch `main`.
3. Buka tab **Actions**. Workflow **Build Android APK** akan berjalan otomatis.
4. Setelah selesai (sekitar 3-6 menit), buka run tersebut dan unduh
   artifact **PrimaCarts-APK** (berisi `PrimaCarts-debug.apk` dan
   `PrimaCarts-release.apk`).

Build ulang manual: Actions > Build Android APK > **Run workflow**.

Untuk membuat halaman Release dengan APK terlampir, buat tag, misalnya:

    git tag v1.0
    git push origin v1.0

## Mengubah URL / nama aplikasi

- URL: `homeUrl` dan `allowedHost` di
  `app/src/main/java/com/primacarts/app/MainActivity.kt`
- Nama aplikasi: `app/src/main/res/values/strings.xml`
- Package name: `applicationId` di `app/build.gradle`

## Catatan

APK release ditandatangani dengan kunci debug supaya langsung bisa
di-install. Untuk Google Play Store, gunakan keystore sendiri.
