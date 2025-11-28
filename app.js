/* app.js
 - IndexedDB store: dataMasterEmway
 - On load: try fetch('./master.csv'), cache it, parse & import to IndexedDB
 - Lookup by CODE (key) else by ARTICLE (index search)
 - Alerts, loader, neumorphic UI
*/

(() => {
  const DB_NAME = 'lookup-db';
  const DB_VERSION = 1;
  const STORE_NAME = 'dataMasterEmway';
  const CACHE_NAME = 'emway-cache';
  const MASTER_PATH = './master.csv'; // ensure master.csv exists at repo root

  // UI elements
  const loaderPanel = el('#loaderPanel');
  const loaderText = el('#loaderText');
  const appPanel = el('#appPanel');
  const inputCode = el('#inputCode');
  const btnFinish = el('#btnFinish');
  const alerts = el('#alerts');

  const resCode = el('#resCode');
  const resArticle = el('#resArticle');
  const resDesc = el('#resDesc');
  const resPrice = el('#resPrice');
  const resDept = el('#resDept');

  let db;

  // --- helpers ---
  function el(sel){ return document.querySelector(sel) }
  function show(node){ node.classList.remove('hidden') }
  function hide(node){ node.classList.add('hidden') }

  function showAlert(type='info', text='') {
    const a = document.createElement('div');
    a.className = `alert ${type}`;
    a.innerHTML = `<div>${text}</div><div class="close">&times;</div>`;
    alerts.appendChild(a);
    a.querySelector('.close').addEventListener('click', () => {
      a.remove();
    });
    // auto remove after 5s
    setTimeout(()=>a.remove(), 5000);
  }

  // Simple CSV parser (handles quoted fields with commas)
  function parseCSV(text){
    const rows = [];
    let cur = '', inQuotes=false, row=[];
    for (let i=0;i<text.length;i++){
      const ch = text[i];
      const nxt = text[i+1];
      if (ch === '"' ) {
        if (inQuotes && nxt === '"'){ cur += '"'; i++; continue; }
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        row.push(cur); cur=''; continue;
      }
      if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (cur !== '' || row.length>0) { row.push(cur); rows.push(row); row=[]; cur=''; }
        // handle \r\n
        if (ch === '\r' && nxt === '\n') i++;
        continue;
      }
      cur += ch;
    }
    if (cur !== '' || row.length>0){ row.push(cur); rows.push(row); }
    return rows;
  }

  // IndexedDB open/create
  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = ev => {
        const idb = ev.target.result;
        if (!idb.objectStoreNames.contains(STORE_NAME)) {
          const store = idb.createObjectStore(STORE_NAME, { keyPath: 'code' });
          store.createIndex('article_idx', 'article_lower', { unique:false });
        }
      };
      req.onsuccess = ev => { db = ev.target.result; resolve(db); };
      req.onerror = ev => reject(ev.target.error);
    });
  }

  // Put many items into store (transaction)
  function importToIndexedDB(records){
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let count = 0;
      for (const r of records){
        // r expected: {code, article, description, price, department}
        const toPut = {
          code: r.code,
          article: r.article,
          description: r.description,
          price: r.price,
          department: r.department,
          article_lower: (r.article || '').toLowerCase()
        };
        store.put(toPut);
        count++;
      }
      tx.oncomplete = () => resolve(count);
      tx.onerror = ev => reject(ev.target.error);
    });
  }

  // Lookup by code
  function lookupByCode(code){
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(code);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Lookup by article (contains)
  function lookupByArticle(term){
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index('article_idx');
      const results = [];
      const lower = term.toLowerCase();
      // iterate all and filter includes (for simplicity, but index helps)
      idx.openCursor().onsuccess = function(e){
        const cursor = e.target.result;
        if (!cursor) { resolve(results); return; }
        if (cursor.key && cursor.key.includes(lower)) {
          results.push(cursor.value);
        }
        cursor.continue();
      };
      idx.openCursor().onerror = e => reject(e.target.error);
    });
  }

  // fetch master.csv, with cache fallback
  async function fetchMasterCsv() {
    loaderText.textContent = 'Mencari master.csv di cache...';
    // try cache first
    try {
      const cache = await caches.open(CACHE_NAME);
      const cachedResp = await cache.match(MASTER_PATH);
      if (cachedResp) {
        loaderText.textContent = 'Memuat master.csv dari cache...';
        const txt = await cachedResp.text();
        return {source:'cache', text:txt};
      }
    } catch (e) {
      // ignore cache errors
      console.warn('cache check failed', e);
    }

    loaderText.textContent = 'Mencoba mendownload master.csv dari server...';
    // fetch from network
    try {
      const resp = await fetch(MASTER_PATH, {cache: 'no-store'});
      if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
      const txt = await resp.text();
      // put into cache
      try {
        const cache = await caches.open(CACHE_NAME);
        cache.put(MASTER_PATH, new Response(txt));
      } catch(e){
        console.warn('cache put failed', e);
      }
      return {source:'network', text:txt};
    } catch (e) {
      throw new Error('Tidak dapat mengakses master.csv: ' + e.message);
    }
  }

  // Process CSV text into record objects
  function csvToRecords(text){
    const rows = parseCSV(text);
    if (!rows || rows.length === 0) return [];
    // assume first row is header - find columns for code/article/description/price/department
    const header = rows[0].map(h => (h || '').trim().toLowerCase());
    const mapIndex = {};
    header.forEach((h,i) => {
      if (h.includes('code') || h.includes('kode')) mapIndex.code = i;
      if (h.includes('article')) mapIndex.article = i;
      if (h.includes('desc') || h.includes('description')) mapIndex.description = i;
      if (h.includes('price') || h.includes('harga')) mapIndex.price = i;
      if (h.includes('dept') || h.includes('department') || h.includes('bagian')) mapIndex.department = i;
    });
    const recs = [];
    for (let i=1;i<rows.length;i++){
      const r = rows[i];
      if (!r || r.length === 0) continue;
      const code = (r[mapIndex.code] || '').trim();
      if (!code) continue; // skip rows w/o code
      recs.push({
        code,
        article: (r[mapIndex.article] || '').trim(),
        description: (r[mapIndex.description] || '').trim(),
        price: (r[mapIndex.price] || '').trim(),
        department: (r[mapIndex.department] || '').trim()
      });
    }
    return recs;
  }

  // UI populate result fields
  function populateResult(item){
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

  // Initialize app flow
  async function init(){
    show(loaderPanel);
    hide(appPanel);

    try {
      await openDB();
    } catch (e) {
      showAlert('error', 'Gagal membuka database: ' + e.message);
      console.error(e);
      loaderText.textContent = 'Gagal membuka database.';
      return;
    }

    // Try to fetch master.csv and import
    try {
      const res = await fetchMasterCsv();
      loaderText.textContent = `Memproses master.csv (${res.source})...`;

      const records = csvToRecords(res.text);
      if (records.length === 0) {
        showAlert('info', 'master.csv ditemukan tapi kosong atau format header tidak dikenali.');
        loaderText.textContent = 'Tidak ada data untuk diimpor.';
      } else {
        // import
        loaderText.textContent = `Mengimpor ${records.length} baris ke IndexedDB...`;
        const count = await importToIndexedDB(records);
        showAlert('success', `Impor selesai: ${count} item disimpan.`);
        loaderText.textContent = 'Impor selesai.';
      }
    } catch (e) {
      // fallback: if can't fetch, but DB might already have data
      showAlert('error', 'Gagal impor master.csv: ' + e.message);
      loaderText.textContent = 'Menunggu data lokal...';
    } finally {
      // hide loader and show app
      setTimeout(()=>{ hide(loaderPanel); show(appPanel); inputCode.focus(); }, 600);
    }
  }

  // event handlers
  inputCode.addEventListener('keydown', async (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const val = inputCode.value.trim();
      if (!val) { showAlert('error', 'Kode harus di isi'); inputCode.focus(); return; }
      // try lookup by code (case-insensitive)
      // our keyPath uses code as-is; to support case-insensitive, try several variants:
      const tried = [val, val.toUpperCase(), val.toLowerCase()];
      let found = null;
      for (const t of tried){
        try {
          found = await lookupByCode(t);
        } catch(e) { console.warn(e) }
        if (found) break;
      }
      if (found) {
        populateResult(found);
        showAlert('success', `Ditemukan by Code: ${found.code}`);
      } else {
        // fallback by article contains
        try {
          const byArticle = await lookupByArticle(val);
          if (byArticle && byArticle.length > 0) {
            populateResult(byArticle[0]);
            showAlert('info', `Tidak ketemu Code. Menampilkan hasil by Article (${byArticle.length} cocok).`);
          } else {
            populateResult(null);
            showAlert('error', 'Tidak ditemukan data untuk input tersebut.');
          }
        } catch (e) {
          populateResult(null);
          showAlert('error', 'Gagal mencari by Article: ' + e.message);
        }
      }
    }
  });

  btnFinish.addEventListener('click', (ev) => {
    ev.preventDefault();
    // validate input not empty? user asked: if code empty show harus di isi
    if (!inputCode.value.trim()) {
      showAlert('error', 'Kode harus di isi');
      inputCode.focus();
      return;
    }
    // reset fields
    inputCode.value = '';
    populateResult(null);
    inputCode.focus();
    showAlert('success', 'Reset berhasil. Siap input berikutnya.');
  });

  // Start
  document.addEventListener('DOMContentLoaded', init);
})();