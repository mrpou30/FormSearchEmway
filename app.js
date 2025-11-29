/* app.js — searchEmway
   Full clean (tanpa ubah perilaku), all logic in one IIFE.
*/

(() => {

  // ============================
  //  CONSTANTS & GLOBAL REFS
  // ============================
  const DB_NAME = 'lookup-db';
  const DB_VERSION = 1;
  const STORE_NAME = 'dataMasterEmway';
  const CACHE_NAME = 'emway-cache';
  const MASTER_PATH = './master.csv';

  const el = sel => document.querySelector(sel);
  const show = node => node.classList.remove('hidden');
  const hide = node => node.classList.add('hidden');

  // UI Elements
  const loaderPanel = el('#loaderPanel');
  const loaderText = el('#loaderText');
  const appPanel = el('#appPanel');
  const alerts = el('#alerts');

  const inputCode = el('#inputCode');
  const btnFinish = el('#btnFinish');
  const btnShareWA = el('#btnShareWA');
  const lookupLoading = el('#lookupLoading');

  const resCode = el('#resCode');
  const resArticle = el('#resArticle');
  const resDesc = el('#resDesc');
  const resPrice = el('#resPrice');
  const resDept = el('#resDept');

  let db = null;
  let lookupBusy = false;


  // ============================
  //  UI HELPERS
  // ============================
  function showAlert(type = 'info', text = '') {
    const box = document.createElement('div');
    box.className = `alert ${type}`;
    box.innerHTML = `<div>${text}</div><div class="close">&times;</div>`;
    alerts.appendChild(box);
    box.querySelector('.close').addEventListener('click', () => box.remove());
    setTimeout(() => box.remove(), 2000);
  }

  function populateResult(item) {
    if (!item) {
      resCode.value = '';
      resArticle.value = '';
      resDesc.value = '';
      resPrice.value = '';
      resDept.value = '';
      return;
    }
    resCode.value = item.code || '';
    resArticle.value = item.article || '';
    resDesc.value = item.description || '';
    resPrice.value = item.price || '';
    resDept.value = item.department || '';
  }


  // ============================
  //  CSV PARSER
  // ============================
  function parseCSV(text) {
    const rows = [];
    let cur = '', inQuotes = false, row = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const nxt = text[i + 1];

      if (ch === '"') {
        if (inQuotes && nxt === '"') { cur += '"'; i++; continue; }
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        row.push(cur); cur = '';
        continue;
      }
      if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
        row = []; cur = '';
        if (ch === '\r' && nxt === '\n') i++;
        continue;
      }
      cur += ch;
    }
    if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
    return rows;
  }

  function csvToRecords(text) {
    const rows = parseCSV(text);
    if (!rows || !rows.length) return [];

    const header = rows[0].map(h => (h || '').trim().toLowerCase());
    const map = {};

    header.forEach((h, i) => {
      if (h.includes('code') || h.includes('kode')) map.code = i;
      if (h.includes('article') || h.includes('artikel')) map.article = i;
      if (h.includes('desc') || h.includes('description') || h.includes('deskripsi')) map.description = i;
      if (h.includes('price') || h.includes('harga')) map.price = i;
      if (h.includes('department') || h.includes('bagian')) map.department = i;
    });

    const list = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const code = (r[map.code] || '').trim();
      if (!code) continue;

      list.push({
        code,
        article: (r[map.article] || '').trim(),
        description: (r[map.description] || '').trim(),
        price: (r[map.price] || '').trim(),
        department: (r[map.department] || '').trim()
      });
    }
    return list;
  }


  // ============================
  //  INDEXEDDB
  // ============================
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(STORE_NAME)) {
          const store = idb.createObjectStore(STORE_NAME, { keyPath: 'code' });
          store.createIndex('article_idx', 'article_lower', { unique: false });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  function importToIndexedDB(records) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const st = tx.objectStore(STORE_NAME);
      let count = 0;
      for (const r of records) {
        st.put({
          code: r.code,
          article: r.article,
          description: r.description,
          price: r.price,
          department: r.department,
          article_lower: (r.article || '').toLowerCase()
        });
        count++;
      }
      tx.oncomplete = () => resolve(count);
      tx.onerror = e => reject(e.target.error);
    });
  }

  function lookupByCode(code) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const st = tx.objectStore(STORE_NAME);
      const req = st.get(code);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function lookupByArticle(term) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const st = tx.objectStore(STORE_NAME);
      const idx = st.index('article_idx');

      const results = [];
      const lower = term.toLowerCase();

      idx.openCursor().onsuccess = e => {
        const cur = e.target.result;
        if (!cur) return resolve(results);
        if (cur.key && cur.key.includes(lower)) results.push(cur.value);
        cur.continue();
      };
    });
  }


  // ============================
  //  FETCH MASTER CSV
  // ============================
  async function fetchMasterCsv() {
    loaderText.textContent = 'Mencari master.csv di cache...';

    // try cache
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(MASTER_PATH);
      if (cached) {
        loaderText.textContent = 'Memuat master.csv dari cache...';
        return { source: 'cache', text: await cached.text() };
      }
    } catch { }

    // try network
    loaderText.textContent = 'Mencoba mendownload master.csv dari server...';
    const resp = await fetch(MASTER_PATH, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const txt = await resp.text();
    try {
      const cache = await caches.open(CACHE_NAME);
      cache.put(MASTER_PATH, new Response(txt));
    } catch { }

    return { source: 'network', text: txt };
  }


  // ============================
  //  LOOKUP ACTION
  // ============================
  async function doLookup(value) {

    lookupBusy = true;
    show(lookupLoading);
    inputCode.disabled = true;

    const attempts = [value, value.toUpperCase(), value.toLowerCase()];
    let found = null;

    for (const t of attempts) {
      try {
        found = await lookupByCode(t);
      } catch { }
      if (found) break;
    }

    if (found) {
      populateResult(found);
      showAlert('success', 'Ditemukan!!\n Article disalin');
      navigator.clipboard.writeText(found.article || "");
      return finishLookup();
    }

    // fallback by article
    const list = await lookupByArticle(value);
    if (list && list.length > 0) {
      populateResult(list[0]);
      showAlert('success', 'Ditemukan!!\n Article disalin');
      navigator.clipboard.writeText(list[0].article || "");
      return finishLookup();
    }

    populateResult(null);
    showAlert('error', 'Tidak ditemukan data untuk input tersebut.');
    finishLookup();
  }

  function finishLookup() {
    lookupBusy = false;
    hide(lookupLoading);
    inputCode.disabled = false;
    inputCode.focus();
  }


  // ============================
  //  EVENT HANDLERS
  // ============================
  inputCode.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;

    if (lookupBusy) return e.preventDefault();

    e.preventDefault();
    const val = inputCode.value.trim();
    if (!val) {
      showAlert('error', 'Kode harus di isi');
      inputCode.focus();
      return;
    }

    doLookup(val);
  });

  btnFinish.addEventListener('click', e => {
    e.preventDefault();
    if (!inputCode.value.trim()) {
      showAlert('error', 'Kode harus di isi');
      inputCode.focus();
      return;
    }
    inputCode.value = '';
    populateResult(null);
    inputCode.focus();
    showAlert('success', 'Reset berhasil. Siap input berikutnya.');
  });

  // Delete key = reset
  document.addEventListener('keydown', e => {
    if (e.key !== 'Delete') return;
    if (!inputCode.value.trim()) {
      showAlert('error', 'Kode harus di isi');
      inputCode.focus();
      return;
    }
    inputCode.value = '';
    populateResult(null);
    inputCode.focus();
    showAlert('success', 'Reset berhasil (Delete). Siap input berikutnya.');
  });

  // Share WA
  btnShareWA.addEventListener('click', () => {
    const article = resArticle.value.trim();
    const desc = resDesc.value.trim();
    const code = resCode.value.trim();

    if (!article || !code) {
      showAlert('error', 'Belum ada data untuk dibagikan.');
      return;
    }

    const msg = encodeURIComponent(`${article} - ${desc} - ${code}`);
    const wa = `https://wa.me/?text=${msg}`;
    window.open(wa, '_blank');
    showAlert('info', 'Membuka WhatsApp...');
  });
  
  //Reset
  const btnRefresh = el('#btnRefresh');

btnRefresh.addEventListener('click', async () => {
  const ok = confirm("Yakin ingin me-refresh master?\n\nIni akan menghapus semua data lama dan mengunduh master.csv terbaru.");
  if (!ok) return;

  showAlert('info', 'Menghapus data lama...');

  // Hapus IndexedDB
  await new Promise(resolve => {
    const req = indexedDB.deleteDatabase('lookup-db');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

  // Hapus cache
  try {
    await caches.delete('emway-cache');
  } catch (e) {
    console.warn('Gagal hapus cache:', e);
  }

  showAlert('success', 'Master dibersihkan. Memuat ulang...');

  setTimeout(() => {
    location.reload();
  }, 600);
});


  // ============================
  //  INIT FLOW
  // ============================
  async function init() {
    show(loaderPanel);
    hide(appPanel);

    try {
      await openDB();
    } catch (e) {
      showAlert('error', 'Gagal membuka database: ' + e.message);
      loaderText.textContent = 'Gagal membuka database.';
      return;
    }

    try {
      const res = await fetchMasterCsv();
      loaderText.textContent = `Memproses master.csv (${res.source})...`;

      const recs = csvToRecords(res.text);

      if (!recs.length) {
        showAlert('info', 'master.csv kosong atau header tidak dikenali.');
        loaderText.textContent = 'Tidak ada data untuk diimpor.';
      } else {
        loaderText.textContent = `Mengimpor ${recs.length} baris...`;
        const c = await importToIndexedDB(recs);
        showAlert('success', `Impor selesai: ${c} item disimpan.`);
      }
    } catch (e) {
      showAlert('error', 'Gagal impor master.csv: ' + e.message);
      loaderText.textContent = 'Menunggu data lokal...';
    } finally {
      setTimeout(() => {
        hide(loaderPanel);
        show(appPanel);
        inputCode.focus();
      }, 600);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();