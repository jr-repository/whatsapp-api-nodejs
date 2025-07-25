// whatsapp-api-nodejs/server.js

// 1. Muat variabel lingkungan dari file .env
// Pastikan file .env Anda tidak diunggah ke GitHub!
require('dotenv').config();

// 2. Impor library yang diperlukan
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors'); // Untuk mengizinkan permintaan dari frontend/backend lain

// 3. Inisialisasi Express app
const app = express();
const PORT = process.env.PORT || 3001; // Gunakan port dari .env atau default 3001

// Aktifkan middleware untuk parsing JSON body dan CORS
app.use(express.json()); // Untuk parsing application/json
app.use(express.urlencoded({ extended: true })); // Untuk parsing application/x-www-form-urlencoded
app.use(cors()); // Mengizinkan semua CORS (sesuaikan di produksi dengan domain spesifik jika perlu)

// Ambil nomor WhatsApp admin dari variabel lingkungan
// Pastikan nomor dalam format '628xxxxxxxxx@c.us'
const ADMIN_WHATSAPP_NUMBERS_RAW = process.env.ADMIN_WHATSAPP_NUMBERS;
const ADMIN_WHATSAPP_NUMBERS = ADMIN_WHATSAPP_NUMBERS_RAW
    ? ADMIN_WHATSAPP_NUMBERS_RAW.split(',').map(num => `${num.trim()}@c.us`)
    : [];

// Nomor pengirim (nomor superadmin)
const SENDER_WHATSAPP_NUMBER = process.env.SENDER_WHATSAPP_NUMBER;
if (!SENDER_WHATSAPP_NUMBER) {
    console.error('ERROR: SENDER_WHATSAPP_NUMBER tidak ditemukan di .env. Mohon setel.');
    process.exit(1); // Keluar jika nomor pengirim tidak disetel
}

// 4. Inisialisasi WhatsApp Client
// LocalAuth akan menyimpan sesi login di folder .wwebjs_auth.
// Ini penting agar Anda tidak perlu scan QR code setiap kali aplikasi di-deploy ulang.
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // Argumen ini penting untuk menjalankan Puppeteer (Chrome headless) di lingkungan server seperti Render
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
        headless: true // Jalankan browser tanpa GUI (mode headless)
    }
});

// 5. Event Listener untuk QR Code
// Ini akan dipicu saat client perlu dihubungkan/autentikasi ulang.
// Di Render, Anda perlu melihat log untuk mendapatkan string QR ini.
client.on('qr', qr => {
    console.log('QR RECEIVED', qr); // Log string QR
    qrcode.generate(qr, { small: true }); // Tampilkan QR di terminal (jika ada)
    console.log('SCAN QR CODE INI DENGAN WHATSAPP DI PONSEL ANDA (nomor superadmin):');
    console.log('Buka WhatsApp di ponsel Anda -> Pengaturan -> Perangkat Tertaut -> Tautkan Perangkat, lalu scan QR ini.');
});

// 6. Event Listener saat client siap
client.on('ready', () => {
    console.log('Client WhatsApp siap dan terhubung!');
    console.log(`Nomor pengirim (superadmin): ${client.info.wid.user}`);
});

// 7. Event Listener saat client terautentikasi
client.on('authenticated', () => {
    console.log('Client WhatsApp terautentikasi!');
});

// 8. Event Listener untuk error autentikasi
client.on('auth_failure', msg => {
    console.error('AUTENTIKASI GAGAL', msg);
    // Anda bisa menambahkan logika untuk mengirim notifikasi atau mencoba lagi
});

// 9. Event Listener saat client terputus
client.on('disconnected', reason => {
    console.log('Client WhatsApp terputus:', reason);
    // Coba inisialisasi ulang client setelah terputus
    console.log('Mencoba menghubungkan kembali WhatsApp Client...');
    client.initialize();
});

// 10. Inisialisasi WhatsApp Client
client.initialize();

// 11. Endpoint API Express untuk mengirim notifikasi WhatsApp
// Ini adalah endpoint yang akan dipanggil oleh backend PHP Anda
app.post('/send-whatsapp-notification', async (req, res) => {
    // Pastikan client WhatsApp sudah siap sebelum mengirim pesan
    if (!client.info) {
        console.warn('Percobaan pengiriman WhatsApp gagal: Client belum siap.');
        return res.status(503).json({ success: false, message: 'WhatsApp client belum siap. Mohon coba lagi nanti.' });
    }

    const { ticketId, subject, name, email, type, priority, description, createdAt, uploadedFiles, adminDashboardLink } = req.body;

    // Validasi input dasar
    if (!ticketId || !subject || !name || !email || !description || !adminDashboardLink) {
        console.error('Data tiket tidak lengkap untuk notifikasi WhatsApp:', req.body);
        return res.status(400).json({ success: false, message: 'Data tiket tidak lengkap untuk notifikasi WhatsApp.' });
    }

    // Bangun pesan WhatsApp
    let message = `*TIKET SUPPORT BARU DITERIMA*\n\n`;
    message += `*ID Tiket:* ${ticketId}\n`;
    message += `*Subjek:* ${subject}\n`;
    message += `*Pengirim:* ${name} (${email})\n`;
    message += `*Jenis Tiket:* ${type}\n`;
    message += `*Prioritas:* ${priority}\n`;
    message += `*Dibuat Pada:* ${createdAt}\n\n`;
    message += `*Deskripsi:*\n${description}\n\n`;

    // Tambahkan tautan file jika ada
    if (uploadedFiles && uploadedFiles.length > 0) {
        message += `*File Terlampir:*\n`;
        uploadedFiles.forEach(file => {
            // Pastikan URL file lengkap dan dapat diakses publik
            message += `- ${file.name}: ${file.url}\n`;
        });
        message += `\n`;
    }

    message += `Lihat detail tiket di Admin Dashboard: ${adminDashboardLink}\n\n`;
    message += `Mohon segera tindak lanjuti tiket ini.`;

    let allMessagesSent = true;
    let failedNumbers = [];

    // Kirim pesan ke setiap nomor admin
    for (const adminNumber of ADMIN_WHATSAPP_NUMBERS) {
        try {
            // Cek apakah nomor WhatsApp valid dan terdaftar
            const isValid = await client.isRegisteredUser(adminNumber);
            if (!isValid) {
                console.warn(`Nomor WhatsApp ${adminNumber} tidak terdaftar atau tidak valid. Melewatkan pengiriman.`);
                failedNumbers.push(adminNumber);
                allMessagesSent = false;
                continue;
            }

            await client.sendMessage(adminNumber, message);
            console.log(`Notifikasi WhatsApp berhasil dikirim ke ${adminNumber} untuk tiket ${ticketId}`);
        } catch (error) {
            console.error(`Gagal mengirim notifikasi WhatsApp ke ${adminNumber} untuk tiket ${ticketId}:`, error);
            failedNumbers.push(adminNumber);
            allMessagesSent = false;
        }
    }

    if (allMessagesSent) {
        res.status(200).json({ success: true, message: 'Notifikasi WhatsApp berhasil dikirim ke semua admin.' });
    } else {
        res.status(500).json({ success: false, message: `Gagal mengirim notifikasi WhatsApp ke beberapa admin. Nomor yang gagal: ${failedNumbers.join(', ')}` });
    }
});

// 12. Jalankan server Express
app.listen(PORT, () => {
    console.log(`Server Node.js berjalan di http://localhost:${PORT}`);
    console.log(`Endpoint untuk notifikasi WhatsApp: http://localhost:${PORT}/send-whatsapp-notification`);
    console.log('Pastikan port ini terbuka di firewall Render jika diakses dari luar.');
});

