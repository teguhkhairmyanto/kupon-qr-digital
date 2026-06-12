// ==========================================================================
// CORE LOGIC ENGINE: SISI PEKERJA (WORKER APP)
// File: js/app.js
// Deskripsi: Mengelola otentikasi pekerja & enkripsi QR Code statis harian
// ==========================================================================

const { createApp, ref, reactive, nextTick } = Vue;

// 1. KONFIGURASI ENDPOINT API & ENKRIPSI (Sesuai Blueprint PRD)
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbze33PozMLxnIHjAqrdfuZtry5nCmVA0T7dYtj97srEvdxxPMV4OO5HAF9sx1mo8fWYPw/exec";
const SECRET_SALT_KEY = "SaltRahasiaKuponTraknus2026"; // Salt key wajib sinkron dengan sisi admin dan backend

createApp({
  setup() {
    // State global untuk mengontrol loader transisi API
    const isLoading = ref(false);

    // 2. STATE DATA FORM INPUT PEKERJA
    const workerForm = reactive({
      nrp: '',
      tanggal_lahir: '',
      errorMessage: ''
    });

    // 3. STATE DATA IDENTITAS PEKERJA SETELAH TEROTENTIKASI
    const workerData = reactive({
      isAuthenticated: false,
      nrp: '',
      nama: ''
    });

    /**
     * Alur Otentikasi Pekerja ke Google Apps Script API
     * Mencocokkan kombinasi NRP dan Tanggal Lahir dengan database Master_Karyawan
     */
    async function authenticateWorker() {
      // Validasi awal input data
      if (!workerForm.nrp.trim() || !workerForm.tanggal_lahir) {
        workerForm.errorMessage = "NRP dan Tanggal Lahir wajib diisi dengan lengkap!";
        return;
      }

      isLoading.value = true;
      workerForm.errorMessage = '';

      try {
        // Mengirimkan request POST dengan format text/plain guna menghindari CORS preflight block
        const response = await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          mode: 'cors',
          headers: {
            'Content-Type': 'text/plain'
          },
          body: JSON.stringify({
            action: 'authenticate_worker',
            nrp: workerForm.nrp.trim(),
            tanggal_lahir: workerForm.tanggal_lahir
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const result = await response.json();

        if (result.status === 'SUCCESS') {
          // Set state identitas pekerja jika data ditemukan valid di database
          workerData.nama = result.nama;
          workerData.nrp = result.nrp;
          workerData.isAuthenticated = true;

          // Menunggu Vue selesai memperbarui DOM untuk memunculkan container target #qrcode-canvas
          await nextTick();
          generateSecureQRCode(result.nrp);
        } else {
          // Menampilkan pesan kegagalan dari backend (NRP/Tanggal Lahir salah)
          workerForm.errorMessage = result.message || "Verifikasi gagal. Data tidak terdaftar.";
        }

      } catch (error) {
        console.error("API Connection Error:", error);
        workerForm.errorMessage = "Gagal terhubung ke server backend API. Silakan periksa koneksi internet Anda.";
      } finally {
        isLoading.value = false;
      }
    }

    /**
     * Menghasilkan Gambar QR Code Statis Terenkripsi AES
     * Mencegah manipulasi data QR oleh pekerja menggunakan generator pihak ketiga di internet
     */
    function generateSecureQRCode(plainNrp) {
      try {
        const targetElement = document.getElementById('qrcode-canvas');
        
        // Memastikan container target dibersihkan dari sisa render sebelumnya
        if (targetElement) {
          targetElement.innerHTML = '';
        } else {
          console.error("DOM Element #qrcode-canvas tidak ditemukan!");
          return;
        }

        // Enkripsi string plain text NRP menggunakan algoritma AES dengan Secret Salt Key Perusahaan
        const encryptedString = CryptoJS.AES.encrypt(plainNrp, SECRET_SALT_KEY).toString();

        // Inisialisasi generator library qrcode.js untuk mencetak kode matriks ke DOM
        new QRCode(targetElement, {
          text: encryptedString,
          width: 210,
          height: 210,
          colorDark: "#1e3a8a",  // Menggunakan warna Navy Blue perusahaan agar terlihat profesional
          colorLight: "#ffffff", // Background putih bersih untuk mempermudah auto-focus sensor kamera
          correctLevel: QRCode.CorrectLevel.H // High Error Correction Level agar tetap terbaca meski layar HP lecet
        });

      } catch (encryptError) {
        console.error("QR Code Generation Failed:", encryptError);
        workerForm.errorMessage = "Terjadi kesalahan enkripsi internal saat membuat QR Code.";
        workerData.isAuthenticated = false; // Reset paksa state ke halaman login
      }
    }

    /**
     * Menghapus Sesi Login Pekerja di Sisi Client
     * Mengembalikan tampilan aplikasi kembali ke form input awal yang bersih
     */
    function logoutWorker() {
      workerData.isAuthenticated = false;
      workerData.nama = '';
      workerData.nrp = '';
      
      // Mengosongkan form input data demi privasi keamanan pekerja berikutnya
      workerForm.nrp = '';
      workerForm.tanggal_lahir = '';
      workerForm.errorMessage = '';
    }

    // Mengekspos reactive state dan fungsi ke layout index.html
    return {
      isLoading,
      workerForm,
      workerData,
      authenticateWorker,
      logoutWorker
    };
  }
}).mount('#app');