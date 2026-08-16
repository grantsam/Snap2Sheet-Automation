# 📖 Panduan Penggunaan Snap2Sheet Automation Hub

Panduan lengkap langkah demi langkah untuk mengoperasikan Snap2Sheet, mulai dari persiapan awal, pembuatan profil proyek, pemindaian QR WhatsApp, hingga panduan pengiriman laporan oleh tim lapangan.

---

## 📑 Daftar Isi
1. [Persiapan Awal (Google Cloud)](#1-persiapan-awal-google-cloud)
2. [Menjalankan Aplikasi](#2-menjalankan-aplikasi)
3. [Membuat Profil Proyek Baru (Wizard 5 Langkah)](#3-membuat-profil-proyek-baru-wizard-5-langkah)
4. [Menghubungkan WhatsApp (Scan QR Code)](#4-menghubungkan-whatsapp-scan-qr-code)
5. [Panduan untuk Tim Lapangan (Format Pengiriman Chat)](#5-panduan-untuk-tim-lapangan-format-pengiriman-chat)
6. [Memantau Notifikasi & DevTools Console](#6-memantau-notifikasi--devtools-console)
7. [Tanya Jawab & Troubleshooting (FAQ)](#7-tanya-jawab--troubleshooting-faq)

---

## 1. Persiapan Awal (Google Cloud)

Sebelum menghubungkan Google Sheets dan Google Drive, siapkan **Client ID** dan **Client Secret** dari Google Cloud:

1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Buat proyek baru (misalnya: `Snap2Sheet-Automation`).
3. Buka menu **APIs & Services → Enabled APIs & services**, lalu klik **+ Enable APIs and Services**.
4. Cari dan aktifkan 2 API berikut:
   - **Google Drive API**
   - **Google Sheets API**
5. Buka menu **OAuth consent screen**:
   - Pilih **External** → Buat nama aplikasi (misal: `Snap2Sheet`).
   - Isi email pengembang dan simpan.
   - Pada bagian **Test Users**, tambahkan alamat email Google yang akan digunakan.
6. Buka menu **Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Desktop App** (atau Web application dengan redirect URI `http://localhost:3001/oauth2callback`).
   - Salin **Client ID** dan **Client Secret**.

---

## 2. Menjalankan Aplikasi

Di komputer/laptop Windows Anda:
1. Pastikan folder aplikasi sudah terinstall (jika baru pertama kali, jalankan `npm install`).
2. Klik ganda (double-click) file:
   ```text
   Snap2Sheet.bat
   ```
3. Jendela browser akan otomatis terbuka di alamat:
   ```text
   http://localhost:3500
   ```

---

## 3. Membuat Profil Proyek Baru (Wizard 5 Langkah)

Snap2Sheet mendukung banyak proyek sekaligus (Multi-Sheet & Multi-Drive).

1. Di Dashboard, klik tombol **New Project** di pojok kanan atas.
2. **Langkah 1 (Name):**
   - Masukkan ID/Nama Proyek (contoh: `proyek-pipa-bogor`).
   - Masukkan deskripsi singkat (opsional).
3. **Langkah 2 (Auth):**
   - Pilih **OAuth 2.0**.
   - Masukkan *Client ID* dan *Client Secret* dari Google Cloud tadi.
   - Klik tombol **Authorize**. Browser akan membuka halaman login Google. Login dan izinkan akses. Token akan otomatis terisi!
4. **Langkah 3 (Target):**
   - Tempelkan URL lengkap Google Spreadsheet Anda (ID sheet akan diekstrak otomatis).
   - Masukkan nama worksheet (misalnya `Sheet1` atau `Data`).
   - Tempelkan URL lengkap folder Google Drive tujuan upload.
5. **Langkah 4 (Route):**
   - Masukkan Nama Grup WhatsApp atau ID Grup (contoh: `120363428932565514@g.us`).
   - *(Tips: Ketik `!idgrup` di grup WhatsApp untuk mengetahui ID grup).*
6. **Langkah 5 (Test):**
   - Klik tombol **Run Diagnostics** untuk memastikan izin Google Drive & Sheets berfungsi baik.
   - Klik **Save Profile**.

---

## 4. Menghubungkan WhatsApp (Scan QR Code)

1. Buka tab **Bot Console** di sidebar kiri Dashboard.
2. Pada menu *Project Profile*, pilih proyek yang baru Anda buat.
3. Pilih mode operasi:
   - **Sync + Live (Direkomendasikan)**: Memindai laporan yang sempat terkirim saat bot mati, lalu standby realtime.
   - **Live Only**: Hanya membaca chat baru yang masuk setelah bot aktif.
4. Klik tombol hijau **Start Bot Client**.
5. Modal Popup QR Code berlatar putih tajam akan muncul di layar.
6. Di HP Anda:
   - Buka aplikasi **WhatsApp**.
   - Ketuk **Menu (⋮)** atau **Pengaturan**.
   - Pilih **Perangkat Tertaut** → **Tautkan Perangkat**.
   - Arahkan kamera HP ke QR Code di layar komputer.
7. Begitu terhubung, popup QR code otomatis tertutup sendiri dan status bot berubah menjadi hijau (**Running**).

---

## 5. Panduan untuk Tim Lapangan (Format Pengiriman Chat)

Tim lapangan cukup mengirimkan **6 foto laporan** di grup WhatsApp target dengan salah satu cara berikut:

### 🔹 Cara 1 (Kirim Album 6 Foto + Caption) — Paling Praktis
1. Petugas memilih **6 foto sekaligus** di WhatsApp.
2. Pada foto terakhir / salah satu foto, ketikkan caption nomor registrasi dan nama pelanggan:
   ```text
   1234 grant
   ```
   *(atau format kalimat: `0000 minz ( 1234 grant )` atau `1234 - grant`)*
3. Tekan **Kirim**.
4. Bot akan otomatis:
   - Mengunduh ke-6 foto.
   - Membuat folder baru di Google Drive bernama `1234_grant`.
   - Menambahkan 1 baris terstruktur di Google Sheets lengkap dengan preview foto thumbnail (`=IMAGE(...)`).

### 🔹 Cara 2 (Kirim 6 Foto Dulu, Teks Menyusul)
1. Petugas mengirim 6 foto tanpa caption.
2. Petugas mengirim 1 pesan teks di grup: `1234 grant`.
3. Bot otomatis mengambil 6 foto yang ada di buffer dan menyimpannya ke Google Sheets.

> **Urutan 6 Foto yang Disimpan:**
> - Foto 1 → Berita Acara
> - Foto 2 → Isometris
> - Foto 3 → Dokumentasi 1
> - Foto 4 → Dokumentasi 2
> - Foto 5 → Dokumentasi 3
> - Foto 6 → Dokumentasi 4

---

## 6. Memantau Notifikasi & DevTools Console

1. **Tab `Notifications`**:
   - Menampilkan feed kartu notifikasi setiap kali laporan berhasil disimpan ke Google Sheets.
   - Memiliki filter: *Semua*, *Laporan Selesai*, *Draft Masuk*, dan *Peringatan/Duplikat*.
   - Dilengkapi unread badge counter hijau di sidebar.
2. **Tab `Bot Console`**:
   - Menampilkan live streaming log teknis (DevTools console) dengan pencarian teks, tab filter (*All, Info, Warnings, Errors*), toggle *Auto-Scroll*, dan tombol *Copy Logs*.

---

## 7. Tanya Jawab & Troubleshooting (FAQ)

#### Q: Apakah bot akan mengirim spam chat/DM ke nomor teknisi atau pelanggan?
**A:** Tidak. Bot beroperasi dalam **Silent / Stealth Mode**. Semua notifikasi, laporan sukses, maupun error hanya ditampilkan di Web Dashboard tanpa membalas chat ke nomor pribadi teknisi.

#### Q: Bagaimana jika bot sempat dimatikan dan ada laporan masuk saat bot offline?
**A:** Gunakan mode **Sync + Live**. Saat dinyalakan kembali, bot otomatis menyisir mundur hingga 500 pesan terakhir di grup, mencocokkannya dengan Google Sheets, dan mengunggah laporan yang belum tercatat agar tidak ada data yang terlewat.

#### Q: Muncul error `The browser is already running` saat menekan Start Bot?
**A:** Masalah ini sudah diatasi dengan fitur *Auto Process Tree Killer*. Cukup klik tombol **Stop Bot Client** lalu klik **Start Bot Client** kembali.

#### Q: Muncul error `Header sheet tidak sesuai`?
**A:** Pastikan baris ke-1 di tab Google Sheets Anda kosong, atau memiliki 11 kolom standar berikut:
```text
No. | Tanggal | Nama Pelanggan | Alamat | Nomor Registrasi | Berita Acara | Isometris | Dokumentasi 1 | Dokumentasi 2 | Dokumentasi 3 | Dokumentasi 4
```

---

*Snap2Sheet Automation Hub — Sederhana, Cepat, dan Otomatis.*
