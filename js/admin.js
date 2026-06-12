// ==========================================================================
// CORE LOGIC ENGINE: SISI ADMIN (ADMIN SCANNER APP)
// File: js/admin.js
// Deskripsi: Mengelola scan QR, dekripsi, validasi anti-double claim, & audio
// ==========================================================================

const { createApp, ref, reactive, nextTick } = Vue;

// 1. KONFIGURASI UTAMA ENGINE (Wajib sinkron dengan backend & sisi pekerja)
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbze33PozMLxnIHjAqrdfuZtry5nCmVA0T7dYtj97srEvdxxPMV4OO5HAF9sx1mo8fWYPw/exec";
const SECRET_SALT_KEY = "SaltRahasiaKuponTraknus2026"; // Salt key untuk membedah data QR Code
const ADMIN_STATIC_PASSWORD = "PasswordAdminStatis123"; // Password login admin lapangan

createApp({
  setup() {
    // Tab routing state untuk mengontrol pergantian view login -> scanner
    const currentTab = ref('admin_login');

    // 2. STATE OTENTIKASI FORM ADMIN
    const adminAuth = reactive({
      passwordInput: '',
      isAuthenticated: false,
      errorMessage: ''
    });

    // 3. STATE FEEDBACK VISUAL OVERLAY FULLSCREEN (Requirement AC-03 & Bab 4)
    const adminFeedback = reactive({
      visible: false,
      status: '', // Diisi 'SUCCESS' atau 'REJECTED'
      message: ''
    });

    // Instance penampung objek library html5-qrcode
    let html5QrcodeScanner = null;

    /**
     * UTILITY AUDIO BEEP GENERATOR (Web Audio API)
     * Menghasilkan frekuensi suara secara mandiri langsung via hardware browser
     */
    function playBeepSound(type) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        
        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        if (type === 'success') {
          // High Beep Sound: Frekuensi tinggi, durasi pendek (Klaim Berhasil)
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(1300, ctx.currentTime); 
          gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
          oscillator.start(ctx.currentTime);
          oscillator.stop(ctx.currentTime + 0.15); 
        } else if (type === 'fail') {
          // Low/Long Beep Sound: Frekuensi rendah/kasar, durasi panjang (Gagal/Sudah Klaim)
          oscillator.type = 'sawtooth';
          oscillator.frequency.setValueAtTime(280, ctx.currentTime); 
          gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
          oscillator.start(ctx.currentTime);
          oscillator.stop(ctx.currentTime + 0.60); 
        }
      } catch (audioError) {
        console.error("Browser memblokir autostart audio kontekstual:", audioError);
      }
    }

    /**
     * Proses Validasi Login Sisi Admin Lapangan
     */
    function loginAdmin() {
      adminAuth.errorMessage = '';
      
      if (adminAuth.passwordInput === ADMIN_STATIC_PASSWORD) {
        adminAuth.isAuthenticated = true;
        
        // Memaksa Vue merender elemen viewfinder sebelum kamera diaktifkan
        nextTick(() => {
          initiateCameraScanner();
        });
      } else {
        adminAuth.errorMessage = "Akses Ditolak! Password Admin yang Anda masukkan salah.";
      }
    }

    /**
     * Inisialisasi & Mengaktifkan Tracker Kamera Smartphone
     */
    function initiateCameraScanner() {
      html5QrcodeScanner = new Html5Qrcode("scanner-viewfinder");
      
      const scannerConfig = { 
        fps: 20, // Frame per second tinggi agar pemindaian responsif tanpa lag (AC-02)
        qrbox: { width: 230, height: 230 },
        aspectRatio: 1.0
      };

      // Membuka kamera belakang (facingMode: environment) secara default
      html5QrcodeScanner.start(
        { facingMode: "environment" }, 
        scannerConfig,
        onQrCodeScannedSuccessfully,
        onQrCodeScanError
      ).catch((err) => {
        console.error("Gagal memperoleh hak akses kamera:", err);
        alert("Sistem gagal mengakses modul kamera. Pastikan browser berjalan di protokol HTTPS.");
      });
    }

    /**
     * Callback Event ketika Kamera Mendeteksi Adanya QR Code
     */
    async function onQrCodeScannedSuccessfully(decodedText) {
      // Hentikan proses scanning sementara agar tidak terjadi double request beruntun (Race Condition)
      if (html5QrcodeScanner) {
        html5QrcodeScanner.pause(true);
      }

      try {
        // 1. Dekripsi data QR Code menggunakan CryptoJS AES
        const decryptedBytes = CryptoJS.AES.decrypt(decodedText, SECRET_SALT_KEY);
        const extractedPlainNrp = decryptedBytes.toString(CryptoJS.enc.Utf8);

        // Proteksi awal jika isi QR Code adalah string palsu / acak non-karyawan
        if (!extractedPlainNrp || extractedPlainNrp.trim() === "") {
          renderAdminFeedbackOverlay("REJECTED", "QR CODE PALSU / TIDAK DIKENAL!");
          return;
        }

        // 2. Kirim data klaim ke Google Apps Script Backend
        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'claim_coupon',
            nrp: extractedPlainNrp.trim(),
            admin_password: ADMIN_STATIC_PASSWORD
          })
        });

        if (!response.ok) {
          throw new Error("Koneksi API gagal.");
        }

        const apiResult = await response.json();

        // 3. Tampilkan Visual Feedback & Mainkan Audio Beep sesuai Respon API
        if (apiResult.status === 'SUCCESS') {
          renderAdminFeedbackOverlay("SUCCESS", `BERHASIL KLAIM!\n\n${apiResult.nama}\n(NRP: ${extractedPlainNrp})`);
        } else {
          renderAdminFeedbackOverlay("REJECTED", apiResult.message || "KLAIM DITOLAK");
        }

      } catch (error) {
        console.error("Validation Error:", error);
        renderAdminFeedbackOverlay("REJECTED", "GAGAL MERESPON API SERVER\nPERIKSA INTERNET");
      }
    }

    function onQrCodeScanError(scanError) {
      // Verbose rendah: dikosongkan agar konsol log tidak penuh/lag saat kamera tracking nyala
    }

    /**
     * Menampilkan Tampilan Layar Penuh (Overlay) Sukses/Gagal & Auto-Reset Kamera
     */
    function renderAdminFeedbackOverlay(status, message) {
      adminFeedback.status = status;
      adminFeedback.message = message;
      adminFeedback.visible = true;

      // Jalankan trigger bunyi notifikasi hardware
      if (status === 'SUCCESS') {
        playBeepSound('success');
      } else {
        playBeepSound('fail');
      }

      // MEKANISME AUTO-RESET 2.5 DETIK (Requirement PRD Bab 4 Poin B.7)
      setTimeout(() => {
        adminFeedback.visible = false;
        adminFeedback.status = '';
        adminFeedback.message = '';
        
        // Hidupkan kembali sensor bidik kamera secara otomatis tanpa interaksi tombol
        if (html5QrcodeScanner && adminAuth.isAuthenticated) {
          html5QrcodeScanner.resume();
        }
      }, 2500);
    }

    /**
     * Mematikan Aliran Kamera Scanner secara Aman
     */
    function shutdownCameraScanner() {
      if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
        html5QrcodeScanner.stop().then(() => {
          html5QrcodeScanner = null;
        }).catch(err => console.error("Gagal melepas hardware kamera tracker:", err));
      }
    }

    /**
     * Keluar dari Mode Admin Lapangan
     */
    function logoutAdmin() {
      shutdownCameraScanner();
      adminAuth.isAuthenticated = false;
      adminAuth.passwordInput = '';
      adminAuth.errorMessage = '';
    }

    return {
      adminAuth,
      adminFeedback,
      loginAdmin,
      logoutAdmin
    };
  }
}).mount('#app');