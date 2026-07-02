/**
 * stock.js — Stok Takibi Modülü
 * IndexedDB tabanlı, çok dönemli stok listesi yönetimi
 */

(function () {
    'use strict';

    const STOCK_PASSWORD = '581534';
    const DB_NAME = 'StokDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'periods';

    // ── State ──────────────────────────────────────────────────────────────────
    const stockState = {
        authorized: sessionStorage.getItem('stockAuthorized') === 'true',
        periodNames: [],          // list of period keys in DB
        activePeriod: null,
        allRows: [],              // full rows of active period (loaded from DB)
        filteredRows: [],
        searchQuery: '',
        filterStatus: 'all',
        sortBy: 'stokAdi',
        sortOrder: 'asc',
        currentPage: 1,
        itemsPerPage: 100,
        pendingFile: null,
        pendingPeriodName: null,
        db: null                  // IDBDatabase instance
    };

    // ── Column Map (0-indexed from Excel row array) ────────────────────────────
    const COL = {
        stokKodu: 0, stokAdi: 1, grubu: 3, araGrubu: 4, altGrubu: 5,
        birimi: 6, miktarDevir: 7, miktarGiren: 8, miktarCikan: 9,
        miktarKalan: 10, birimFiyat: 11, envTutar: 12, envTutarKdv: 13,
        aktif: 14, ozelKod1: 15, ozelKod2: 16, ozelKod3: 17,
        markasi: 18, modeli: 19, bilgKodu: 20
    };

    const $ = (id) => document.getElementById(id);

    // ── IndexedDB Setup ────────────────────────────────────────────────────────
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'period' });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    function dbSave(period, rows) {
        return new Promise((resolve, reject) => {
            const tx = stockState.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put({ period, rows });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    function dbLoad(period) {
        return new Promise((resolve, reject) => {
            const tx = stockState.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(period);
            req.onsuccess = (e) => resolve(e.target.result ? e.target.result.rows : []);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    function dbListPeriods() {
        return new Promise((resolve, reject) => {
            const tx = stockState.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAllKeys();
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    function dbDelete(period) {
        return new Promise((resolve, reject) => {
            const tx = stockState.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete(period);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    async function init() {
        try {
            stockState.db = await openDB();
            stockState.periodNames = sortPeriodsChronologically(await dbListPeriods());

            // Seed database from preloadedStockData if empty
            if (stockState.periodNames.length === 0 && typeof preloadedStockData !== 'undefined' && preloadedStockData) {
                console.log("Seeding stock database from preloaded stock data...");
                for (const [periodName, rows] of Object.entries(preloadedStockData)) {
                    await dbSave(periodName, rows);
                }
                stockState.periodNames = sortPeriodsChronologically(await dbListPeriods());
            }

            // Restore last active period
            const lastPeriod = sessionStorage.getItem('stockActivePeriod');
            if (lastPeriod && stockState.periodNames.includes(lastPeriod)) {
                stockState.activePeriod = lastPeriod;
            } else if (stockState.periodNames.length > 0) {
                stockState.activePeriod = stockState.periodNames[stockState.periodNames.length - 1];
            }

            refreshPeriodSelect();
            bindEvents();

            if (stockState.activePeriod) {
                const btnDelete = $('btn-stock-delete');
                if (btnDelete) btnDelete.style.display = 'inline-flex';
                await loadAndRender(stockState.activePeriod);
            }
        } catch (err) {
            console.error('Stok modülü başlatma hatası:', err);
        }
    }

    async function loadAndRender(period) {
        stockState.allRows = await dbLoad(period);
        stockState.currentPage = 1;
        applyStockFilters();
        await renderStockTrendChart();
    }

    // ── Event Bindings ─────────────────────────────────────────────────────────
    function bindEvents() {
        const btnUpload = $('btn-stock-upload');
        if (btnUpload) btnUpload.addEventListener('click', openModal);

        const btnClose = $('btn-close-stock-modal');
        if (btnClose) btnClose.addEventListener('click', closeModal);

        const backdrop = $('stock-modal-backdrop');
        if (backdrop) backdrop.addEventListener('click', closeModal);

        const btnPwSubmit = $('btn-stock-pw-submit');
        if (btnPwSubmit) btnPwSubmit.addEventListener('click', handlePasswordSubmit);

        const pwInput = $('stock-pw-input');
        if (pwInput) pwInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handlePasswordSubmit();
        });

        setupDropZone();

        const btnConfirm = $('btn-stock-period-confirm');
        if (btnConfirm) btnConfirm.addEventListener('click', processAndSave);

        const periodSelect = $('stock-period-select');
        const btnDelete = $('btn-stock-delete');
        if (periodSelect) periodSelect.addEventListener('change', async (e) => {
            stockState.activePeriod = e.target.value || null;
            stockState.currentPage = 1;
            if (stockState.activePeriod) {
                if (btnDelete) btnDelete.style.display = 'inline-flex';
                sessionStorage.setItem('stockActivePeriod', stockState.activePeriod);
                await loadAndRender(stockState.activePeriod);
            } else {
                if (btnDelete) btnDelete.style.display = 'none';
                stockState.allRows = [];
                applyStockFilters();
            }
        });

        if (btnDelete) btnDelete.addEventListener('click', async () => {
            const period = stockState.activePeriod;
            if (!period) return;
            
            if (confirm(`"${period}" dönemine ait tüm stok verilerini silmek istediğinize emin misiniz?`)) {
                try {
                    await dbDelete(period);
                    
                    stockState.periodNames = stockState.periodNames.filter(p => p !== period);
                    showNotification(`🗑️ "${period}" silindi`);
                    
                    if (stockState.periodNames.length > 0) {
                        stockState.activePeriod = stockState.periodNames[stockState.periodNames.length - 1];
                        sessionStorage.setItem('stockActivePeriod', stockState.activePeriod);
                        if (periodSelect) periodSelect.value = stockState.activePeriod;
                        await loadAndRender(stockState.activePeriod);
                    } else {
                        stockState.activePeriod = null;
                        sessionStorage.removeItem('stockActivePeriod');
                        if (periodSelect) periodSelect.value = '';
                        if (btnDelete) btnDelete.style.display = 'none';
                        stockState.allRows = [];
                        applyStockFilters();
                    }
                    
                    refreshPeriodSelect();
                } catch (err) {
                    console.error('Dönem silme hatası:', err);
                    alert('Hata oluştu: ' + err.message);
                }
            }
        });

        const searchInput = $('stock-search');
        if (searchInput) searchInput.addEventListener('input', (e) => {
            stockState.searchQuery = e.target.value.toLowerCase().trim();
            stockState.currentPage = 1;
            applyStockFilters();
        });

        const filterStatus = $('stock-filter-status');
        if (filterStatus) filterStatus.addEventListener('change', (e) => {
            stockState.filterStatus = e.target.value;
            stockState.currentPage = 1;
            applyStockFilters();
        });

        const btnExport = $('btn-stock-export');
        if (btnExport) btnExport.addEventListener('click', exportStockCSV);

        const tableHeader = $('stock-table-header');
        if (tableHeader) tableHeader.addEventListener('click', (e) => {
            const th = e.target.closest('th.sortable');
            if (!th) return;
            const col = th.dataset.sort;
            if (stockState.sortBy === col) {
                stockState.sortOrder = stockState.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                stockState.sortBy = col;
                stockState.sortOrder = 'asc';
            }
            applyStockFilters();
        });
    }

    function setupDropZone() {
        const dropZone = $('stock-drop-zone');
        const fileInput = $('stock-file-input');
        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) handleFileSelect(file);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) handleFileSelect(e.target.files[0]);
        });
    }

    // ── Modal ──────────────────────────────────────────────────────────────────
    function openModal() {
        const modal = $('stock-upload-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        stockState.authorized ? showUploadStep() : showPasswordStep();
    }

    function closeModal() {
        const modal = $('stock-upload-modal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
        stockState.pendingFile = null;
        stockState.pendingPeriodName = null;
        const info = $('stock-upload-info');
        if (info) { info.style.display = 'none'; info.innerHTML = ''; }
        const btn = $('btn-stock-period-confirm');
        if (btn) { btn.disabled = true; btn.textContent = 'Yükle'; }
        resetDropZone();
    }

    function resetDropZone() {
        const dz = $('stock-drop-zone');
        if (!dz) return;
        dz.innerHTML = `
            <svg stroke="currentColor" fill="none" stroke-width="1.5" viewBox="0 0 24 24" height="2.5em" width="2.5em" xmlns="http://www.w3.org/2000/svg" style="color:#f59e0b;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            <span>Excel dosyasını buraya sürükleyin veya <strong>tıklayın</strong></span>
            <input type="file" id="stock-file-input" accept=".xlsx,.xls,.csv" style="display:none;">
        `;
        setupDropZone();
    }

    function showPasswordStep() {
        const pw = $('stock-modal-pw-step');
        const up = $('stock-modal-upload-step');
        if (pw) pw.style.display = 'block';
        if (up) up.style.display = 'none';
        const inp = $('stock-pw-input');
        if (inp) { inp.value = ''; inp.focus(); }
        const err = $('stock-pw-error');
        if (err) err.style.display = 'none';
    }

    function showUploadStep() {
        const pw = $('stock-modal-pw-step');
        const up = $('stock-modal-upload-step');
        if (pw) pw.style.display = 'none';
        if (up) up.style.display = 'block';
    }

    function handlePasswordSubmit() {
        const input = $('stock-pw-input');
        const err = $('stock-pw-error');
        if (!input) return;
        if (input.value.trim() === STOCK_PASSWORD) {
            stockState.authorized = true;
            sessionStorage.setItem('stockAuthorized', 'true');
            if (err) err.style.display = 'none';
            showUploadStep();
        } else {
            if (err) { err.textContent = 'Hatalı şifre!'; err.style.display = 'block'; }
            input.value = '';
            input.focus();
        }
    }

    // ── File Handling ──────────────────────────────────────────────────────────
    function handleFileSelect(file) {
        stockState.pendingFile = file;
        stockState.pendingPeriodName = detectPeriodName(file.name.replace(/\.[^.]+$/, ''));

        const info = $('stock-upload-info');
        if (info) {
            info.style.display = 'block';
            info.innerHTML = `
                <strong>✓ Dosya seçildi:</strong> ${file.name}<br>
                <strong>Dönem:</strong> ${stockState.pendingPeriodName} &nbsp;|&nbsp;
                <strong>Boyut:</strong> ${(file.size / 1024 / 1024).toFixed(2)} MB
            `;
        }

        const btn = $('btn-stock-period-confirm');
        if (btn) btn.disabled = false;

        // Update drop zone
        const dz = $('stock-drop-zone');
        if (dz) {
            dz.innerHTML = `
                <svg stroke="currentColor" fill="none" stroke-width="1.5" viewBox="0 0 24 24" height="2.5em" width="2.5em" style="color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span style="color:#10b981;"><strong>${file.name}</strong> hazır</span>
                <input type="file" id="stock-file-input" accept=".xlsx,.xls,.csv" style="display:none;">
            `;
            setupDropZone();
        }
    }

    function detectPeriodName(filename) {
        const months = {
            'ocak':'Ocak','january':'Ocak','jan':'Ocak',
            'subat':'Şubat','şubat':'Şubat','february':'Şubat','feb':'Şubat',
            'mart':'Mart','march':'Mart','mar':'Mart',
            'nisan':'Nisan','april':'Nisan','apr':'Nisan',
            'mayis':'Mayıs','mayıs':'Mayıs','may':'Mayıs',
            'haziran':'Haziran','june':'Haziran','jun':'Haziran',
            'temmuz':'Temmuz','july':'Temmuz','jul':'Temmuz',
            'agustos':'Ağustos','ağustos':'Ağustos','august':'Ağustos','aug':'Ağustos',
            'eylul':'Eylül','eylül':'Eylül','september':'Eylül','sep':'Eylül',
            'ekim':'Ekim','october':'Ekim','oct':'Ekim',
            'kasim':'Kasım','kasım':'Kasım','november':'Kasım','nov':'Kasım',
            'aralik':'Aralık','aralık':'Aralık','december':'Aralık','dec':'Aralık'
        };
        const lower = filename.toLowerCase();
        const yearMatch = lower.match(/20\d{2}/);
        const year = yearMatch ? yearMatch[0] : '2026';
        for (const [key, val] of Object.entries(months)) {
            if (lower.includes(key)) return `${val} ${year}`;
        }
        return filename;
    }

    // ── Excel Processing ───────────────────────────────────────────────────────
    async function processAndSave() {
        const file = stockState.pendingFile;
        if (!file) return;

        const btn = $('btn-stock-period-confirm');
        const info = $('stock-upload-info');

        if (btn) { btn.disabled = true; btn.textContent = '⏳ İşleniyor...'; }
        if (info) info.innerHTML = `<span style="color:#f59e0b;">⏳ Excel okunuyor, lütfen bekleyin...</span>`;

        try {
            const parsedRows = await parseExcel(file);
            const periodName = stockState.pendingPeriodName || 'Bilinmeyen Dönem';

            if (info) info.innerHTML = `<span style="color:#f59e0b;">💾 Veritabanına kaydediliyor (${parsedRows.length.toLocaleString('tr-TR')} kayıt)...</span>`;

            await dbSave(periodName, parsedRows);

            // Update state
            if (!stockState.periodNames.includes(periodName)) {
                stockState.periodNames.push(periodName);
                stockState.periodNames = sortPeriodsChronologically(stockState.periodNames);
            }
            stockState.activePeriod = periodName;
            sessionStorage.setItem('stockActivePeriod', periodName);

            refreshPeriodSelect();
            await loadAndRender(periodName);
            closeModal();
            showNotification(`✅ "${periodName}" yüklendi — ${parsedRows.length.toLocaleString('tr-TR')} kayıt`);

        } catch (err) {
            console.error('İşleme hatası:', err);
            if (info) info.innerHTML = `<span style="color:#f87171;">❌ Hata: ${err.message}</span>`;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Yükle'; }
        }
    }

    function parseExcel(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const wb = XLSX.read(data, { type: 'array', codepage: 1254 });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

                    if (rawRows.length < 2) throw new Error('Dosya boş görünüyor.');

                    const rows = rawRows.slice(1)
                        .filter(r => r && r[COL.stokKodu] != null)
                        .map(r => ({
                            stokKodu:   String(r[COL.stokKodu]  || '').trim(),
                            stokAdi:    String(r[COL.stokAdi]   || '').trim(),
                            grubu:      String(r[COL.grubu]     || '').trim(),
                            araGrubu:   String(r[COL.araGrubu]  || '').trim(),
                            birimi:     String(r[COL.birimi]    || 'ADET').trim(),
                            miktarDevir:  toNum(r[COL.miktarDevir]),
                            miktarGiren:  toNum(r[COL.miktarGiren]),
                            miktarCikan:  toNum(r[COL.miktarCikan]),
                            miktarKalan:  toNum(r[COL.miktarKalan]),
                            birimFiyat:   toNum(r[COL.birimFiyat]),
                            envTutar:     toNum(r[COL.envTutar]),
                            envTutarKdv:  toNum(r[COL.envTutarKdv]),
                            aktif:    String(r[COL.aktif]    || '').trim(),
                            markasi:  String(r[COL.markasi]  || '').trim(),
                            modeli:   String(r[COL.modeli]   || '').trim(),
                            ozelKod2: String(r[COL.ozelKod2] || '').trim(),
                            ozelKod3: String(r[COL.ozelKod3] || '').trim()
                        }));

                    resolve(rows);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Dosya okunamadı.'));
            reader.readAsArrayBuffer(file);
        });
    }

    function toNum(v) {
        if (v == null || v === '') return 0;
        return parseFloat(String(v).replace(',', '.')) || 0;
    }

    // ── Period Select ──────────────────────────────────────────────────────────
    function refreshPeriodSelect() {
        const select = $('stock-period-select');
        if (!select) return;
        select.innerHTML = '<option value="">Dönem Seç...</option>';
        stockState.periodNames.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            if (p === stockState.activePeriod) opt.selected = true;
            select.appendChild(opt);
        });
    }

    // ── Filter & Sort ──────────────────────────────────────────────────────────
    function applyStockFilters() {
        let rows = [...stockState.allRows];

        if (stockState.searchQuery) {
            rows = rows.filter(r =>
                r.stokKodu.toLowerCase().includes(stockState.searchQuery) ||
                r.stokAdi.toLowerCase().includes(stockState.searchQuery) ||
                r.grubu.toLowerCase().includes(stockState.searchQuery)
            );
        }

        if (stockState.filterStatus === 'instock') {
            rows = rows.filter(r => r.miktarKalan > 0);
        } else if (stockState.filterStatus === 'zero') {
            rows = rows.filter(r => r.miktarKalan <= 0);
        }

        // Sort
        const key = stockState.sortBy;
        const dir = stockState.sortOrder === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            const va = a[key], vb = b[key];
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va || '').localeCompare(String(vb || ''), 'tr') * dir;
        });

        stockState.filteredRows = rows;
        renderStockSummary();
        renderStockTable();
    }

    // ── Summary Cards ──────────────────────────────────────────────────────────
    function renderStockSummary() {
        const all = stockState.allRows;
        const empty = $('stock-empty-state');
        const tableWrap = $('stock-table-wrap');
        const controls = $('stock-controls');
        const analystSection = $('stock-analyst-section');

        if (!all || all.length === 0) {
            if (empty) empty.style.display = 'flex';
            if (tableWrap) tableWrap.style.display = 'none';
            if (controls) controls.style.display = 'none';
            if (analystSection) analystSection.style.display = 'none';
            ['stock-stat-total','stock-stat-instock','stock-stat-zero','stock-stat-value']
                .forEach(id => { const el = $(id); if (el) el.textContent = '—'; });
            return;
        }

        if (empty) empty.style.display = 'none';
        if (tableWrap) tableWrap.style.display = 'block';
        if (controls) controls.style.display = 'flex';
        if (analystSection) {
            analystSection.style.display = 'grid';
            renderStockAnalystSection();
        }

        const inStock  = all.filter(r => r.miktarKalan > 0).length;
        const zeroStock = all.filter(r => r.miktarKalan <= 0).length;
        const totalVal = all.reduce((s, r) => s + r.envTutar, 0);

        animateCount($('stock-stat-total'), all.length);
        animateCount($('stock-stat-instock'), inStock);
        animateCount($('stock-stat-zero'), zeroStock);

        const valEl = $('stock-stat-value');
        if (valEl) valEl.textContent = totalVal.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
    }

    function renderStockAnalystSection() {
        const all = stockState.allRows;
        const section = $('stock-analyst-section');
        if (!section || !all || all.length === 0) return;

        let totalDevir = 0, totalGiren = 0, totalCikan = 0, totalKalan = 0;
        let inactiveCount = 0, inactiveVal = 0;

        // Group sales aggregation
        const groupSales = {};

        all.forEach(r => {
            totalDevir += r.miktarDevir;
            totalGiren += r.miktarGiren;
            totalCikan += r.miktarCikan;
            totalKalan += r.miktarKalan;

            const g = r.grubu || 'DİĞER';
            groupSales[g] = (groupSales[g] || 0) + r.miktarCikan;

            if (r.miktarDevir > 0 && r.miktarGiren === 0 && r.miktarCikan === 0) {
                inactiveCount++;
                inactiveVal += r.envTutar;
            }
        });

        // Find leader sales group
        let leaderGroup = '—';
        let leaderGroupSales = 0;
        for (const [g, sales] of Object.entries(groupSales)) {
            if (sales > leaderGroupSales) {
                leaderGroup = g;
                leaderGroupSales = sales;
            }
        }

        const topSold = [...all]
            .filter(r => r.miktarCikan > 0)
            .sort((a, b) => b.miktarCikan - a.miktarCikan)
            .slice(0, 5);

        const maxCikan = topSold.length > 0 ? topSold[0].miktarCikan : 1;

        const criticalStock = [...all]
            .filter(r => r.miktarKalan > 0 && r.miktarKalan <= 5 && r.miktarCikan > 0)
            .sort((a, b) => a.miktarKalan - b.miktarKalan)
            .slice(0, 5);

        // Top inactive products (both giren == 0 and cikan == 0) sorted by envTutar
        const topInactive = [...all]
            .filter(r => r.miktarDevir > 0 && r.miktarGiren === 0 && r.miktarCikan === 0)
            .sort((a, b) => b.envTutar - a.envTutar)
            .slice(0, 5);

        const inactivePct = all.length > 0 ? ((inactiveCount / all.length) * 100).toFixed(1) : 0;

        const card1HTML = `
            <div class="analyst-card">
                <div class="analyst-card-header">
                    <div class="analyst-card-icon" style="color: #3b82f6;">
                        <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" height="1.2em" width="1.2em" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                    </div>
                    <span class="analyst-card-title">Stok Hareket Hacimleri</span>
                </div>
                <div class="analyst-list" style="justify-content: center; height: 100%; gap: 0.85rem;">
                    <div class="analyst-metric-row">
                        <span>Toplam Başlangıç (Devir):</span>
                        <strong>${fmt(totalDevir)} ADET</strong>
                    </div>
                    <div class="analyst-metric-row">
                        <span>Toplam Giriş Miktarı:</span>
                        <strong style="color: #10b981;">+${fmt(totalGiren)} ADET</strong>
                    </div>
                    <div class="analyst-metric-row">
                        <span>Toplam Çıkış (Satış):</span>
                        <strong style="color: #f87171;">-${fmt(totalCikan)} ADET</strong>
                    </div>
                    <div class="analyst-metric-row">
                        <span>Toplam Kalan Stok:</span>
                        <strong style="color: #f59e0b;">${fmt(totalKalan)} ADET</strong>
                    </div>
                    <div class="analyst-metric-row" style="border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.5rem; font-size: 0.82rem;">
                        <span>En Çok Satan Grup:</span>
                        <span class="analyst-item-badge info" title="${escHtml(leaderGroup)}" style="max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block;">
                            ${escHtml(leaderGroup)} (${fmt(leaderGroupSales)} Satış)
                        </span>
                    </div>
                </div>
            </div>
        `;

        const card2HTML = `
            <div class="analyst-card">
                <div class="analyst-card-header">
                    <div class="analyst-card-icon" style="color: #10b981;">
                        <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" height="1.2em" width="1.2em" xmlns="http://www.w3.org/2000/svg"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                    </div>
                    <span class="analyst-card-title">Aylık En Çok Satılanlar</span>
                </div>
                <div class="analyst-list">
                    ${topSold.length === 0 
                        ? '<div style="color:var(--text-muted);text-align:center;padding:2rem 0;">Satış hareketi bulunmuyor.</div>'
                        : topSold.map(r => {
                            const pct = Math.max(5, Math.round((r.miktarCikan / maxCikan) * 100));
                            return `
                                <div class="analyst-item">
                                    <div class="analyst-item-meta">
                                        <span class="analyst-item-name" title="${escHtml(r.stokKodu)} - ${escHtml(r.stokAdi)}">${escHtml(r.stokKodu)} - ${escHtml(r.stokAdi)}</span>
                                        <span class="analyst-item-val">${fmt(r.miktarCikan)} ${r.birimi}</span>
                                    </div>
                                    <div class="analyst-progress-bg">
                                        <div class="analyst-progress-fill green" style="width: ${pct}%;"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                </div>
            </div>
        `;

        const card3HTML = `
            <div class="analyst-card">
                <div class="analyst-card-header">
                    <div class="analyst-card-icon" style="color: #ef4444;">
                        <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" height="1.2em" width="1.2em" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"></path></svg>
                    </div>
                    <span class="analyst-card-title">Kritik & Azalan Stoklar</span>
                </div>
                <div class="analyst-list">
                    ${criticalStock.length === 0 
                        ? '<div style="color:#10b981;text-align:center;padding:2.5rem 0;font-size:0.85rem;">✓ Kritik seviyede ürün bulunmuyor.</div>'
                        : criticalStock.map(r => {
                            const pct = Math.max(5, Math.round((r.miktarKalan / 5) * 100));
                            return `
                                <div class="analyst-item">
                                    <div class="analyst-item-meta">
                                        <span class="analyst-item-name" title="${escHtml(r.stokKodu)} - ${escHtml(r.stokAdi)}">${escHtml(r.stokKodu)} - ${escHtml(r.stokAdi)}</span>
                                        <span class="analyst-item-badge warning">Kalan: ${fmt(r.miktarKalan)}</span>
                                    </div>
                                    <div class="analyst-progress-bg">
                                        <div class="analyst-progress-fill red" style="width: ${pct}%;"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                </div>
            </div>
        `;

        const card4HTML = `
            <div class="analyst-card">
                <div class="analyst-card-header">
                    <div class="analyst-card-icon" style="color: #f59e0b;">
                        <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" height="1.2em" width="1.2em" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
                    </div>
                    <span class="analyst-card-title">Hareketsiz (Atıl) Stok Detayı</span>
                </div>
                <div class="analyst-list" style="gap: 0.65rem;">
                    <div style="font-size: 0.76rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 2px;">En Değerli Hareketsizler</div>
                    ${topInactive.length === 0 
                        ? '<div style="color:#10b981;text-align:center;padding:1.5rem 0;font-size:0.8rem;">Hareket görmeyen ürün bulunmuyor.</div>'
                        : topInactive.map(r => `
                            <div class="analyst-item" style="gap:2px;">
                                <div class="analyst-item-meta" style="font-size: 0.78rem;">
                                    <span class="analyst-item-name" style="max-width: 140px;" title="${escHtml(r.stokKodu)} - ${escHtml(r.stokAdi)}">${escHtml(r.stokKodu)} - ${escHtml(r.stokAdi)}</span>
                                    <span style="font-weight: 600; color: #ef4444;">${fmtPrice(r.envTutar)}</span>
                                </div>
                                <div style="font-size:0.7rem; color:var(--text-muted);">Miktar: ${fmt(r.miktarKalan)} ${r.birimi}</div>
                            </div>
                        `).join('')}
                    
                    <div style="border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.4rem; display: flex; flex-direction: column; gap: 3px;">
                        <div class="analyst-metric-row" style="font-size:0.78rem;">
                            <span>Atıl Stok Oranı / Kalem:</span>
                            <span class="analyst-item-badge warning">%${inactivePct} (${inactiveCount} Kalem)</span>
                        </div>
                        <div class="analyst-metric-row" style="font-size:0.78rem;">
                            <span>Atıl Stok Bağlı Sermaye:</span>
                            <strong style="color: #ef4444;">${fmtPrice(inactiveVal)}</strong>
                        </div>
                    </div>
                </div>
            </div>
        `;

        section.innerHTML = card1HTML + card2HTML + card3HTML + card4HTML;
    }

    // ── Table Render ───────────────────────────────────────────────────────────
    function renderStockTable() {
        const header = $('stock-table-header');
        const tbody  = $('stock-table-body');
        if (!header || !tbody) return;

        const cols = [
            { key: 'stokKodu',    label: 'Stok Kodu' },
            { key: 'stokAdi',     label: 'Stok Adı' },
            { key: 'grubu',       label: 'Grubu' },
            { key: 'birimi',      label: 'Birim' },
            { key: 'miktarDevir', label: 'Devir' },
            { key: 'miktarGiren', label: 'Giren' },
            { key: 'miktarCikan', label: 'Çıkan' },
            { key: 'miktarKalan', label: 'Kalan' },
            { key: 'birimFiyat',  label: 'Son Alış Fiyatı ⓘ', tooltip: 'Envanter birim fiyatı = son alış fiyatı' },
            { key: 'envTutar',    label: 'Envanter Tutarı' },
        ];

        const ind = (k) => stockState.sortBy === k
            ? `<span class="sort-indicator">${stockState.sortOrder === 'asc' ? '▲' : '▼'}</span>`
            : `<span class="sort-indicator" style="opacity:0.3">▲</span>`;

        header.innerHTML = cols.map(c =>
            `<th class="sortable" data-sort="${c.key}" ${c.tooltip ? `title="${c.tooltip}"` : ''}>${c.label} ${ind(c.key)}</th>`
        ).join('');

        // Pagination
        const total   = stockState.filteredRows.length;
        const maxPage = Math.max(1, Math.ceil(total / stockState.itemsPerPage));
        if (stockState.currentPage > maxPage) stockState.currentPage = maxPage;

        const start    = (stockState.currentPage - 1) * stockState.itemsPerPage;
        const pageRows = stockState.filteredRows.slice(start, start + stockState.itemsPerPage);

        tbody.innerHTML = '';

        if (pageRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;padding:2.5rem;color:var(--text-muted);">Sonuç bulunamadı</td></tr>`;
        } else {
            const frag = document.createDocumentFragment();
            pageRows.forEach(row => {
                const tr = document.createElement('tr');
                const qCls = row.miktarKalan > 0 ? 'stock-ok' : 'stock-zero';
                tr.innerHTML = `
                    <td><span class="stock-code">${row.stokKodu}</span></td>
                    <td class="stock-name-cell" title="${escHtml(row.stokAdi)}">${escHtml(row.stokAdi)}</td>
                    <td><span class="stock-group-badge" title="${escHtml(row.grubu)}">${escHtml(row.grubu) || '—'}</span></td>
                    <td style="color:var(--text-muted);">${row.birimi}</td>
                    <td style="text-align:right;">${fmt(row.miktarDevir)}</td>
                    <td style="text-align:right;color:#10b981;">${fmt(row.miktarGiren)}</td>
                    <td style="text-align:right;color:#f87171;">${fmt(row.miktarCikan)}</td>
                    <td style="text-align:right;"><span class="stock-qty ${qCls}">${fmt(row.miktarKalan)}</span></td>
                    <td class="price-cell" style="text-align:right;color:var(--text-muted);">${fmtPrice(row.birimFiyat)}</td>
                    <td class="price-cell" style="text-align:right;font-weight:600;color:#f59e0b;">${fmtPrice(row.envTutar)}</td>
                `;
                frag.appendChild(tr);
            });
            tbody.appendChild(frag);
        }

        ensurePagination(total, maxPage);
    }

    function ensurePagination(total, maxPage) {
        let pag = $('stock-pagination');
        if (!pag) {
            const wrap = $('stock-table-wrap');
            if (!wrap) return;
            pag = document.createElement('div');
            pag.id = 'stock-pagination';
            pag.className = 'pagination';
            pag.innerHTML = `
                <button id="stock-prev-btn">Önceki</button>
                <span id="stock-page-info"></span>
                <button id="stock-next-btn">Sonraki</button>
            `;
            wrap.appendChild(pag);

            $('stock-prev-btn').addEventListener('click', () => {
                if (stockState.currentPage > 1) { stockState.currentPage--; renderStockTable(); }
            });
            $('stock-next-btn').addEventListener('click', () => {
                if (stockState.currentPage < Math.ceil(stockState.filteredRows.length / stockState.itemsPerPage)) {
                    stockState.currentPage++; renderStockTable();
                }
            });
        }

        const info = $('stock-page-info');
        if (info) info.textContent = `Sayfa ${stockState.currentPage} / ${maxPage}  (${total.toLocaleString('tr-TR')} kayıt)`;
        const prev = $('stock-prev-btn');
        const next = $('stock-next-btn');
        if (prev) prev.disabled = stockState.currentPage === 1;
        if (next) next.disabled = stockState.currentPage >= maxPage;
    }

    // ── Export ─────────────────────────────────────────────────────────────────
    function exportStockCSV() {
        if (!stockState.filteredRows.length) return;
        const headers = ['Stok Kodu','Stok Adı','Grubu','Birim','Devir','Giren','Çıkan','Kalan','Son Alış Fiyatı','Envanter Tutarı','Envanter Tutarı KDVli'];
        const lines = stockState.filteredRows.map(r => [
            r.stokKodu, r.stokAdi, r.grubu, r.birimi,
            r.miktarDevir, r.miktarGiren, r.miktarCikan, r.miktarKalan,
            r.birimFiyat.toFixed(2), r.envTutar.toFixed(2), r.envTutarKdv.toFixed(2)
        ]);
        const csv = [headers, ...lines].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Stok_${stockState.activePeriod || 'Export'}_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    function fmt(n) { return n === 0 ? '0' : n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }); }
    function fmtPrice(n) { return (!n || n === 0) ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'; }
    function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function animateCount(el, target) {
        if (!el) return;
        const start = performance.now();
        const from = parseInt(el.textContent.replace(/\D/g,'')) || 0;
        (function step(now) {
            const p = Math.min((now - start) / 600, 1);
            const e = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(from + (target - from) * e).toLocaleString('tr-TR');
            if (p < 1) requestAnimationFrame(step);
        })(start);
    }

    function showNotification(msg) {
        const n = document.createElement('div');
        n.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:#151828;border:1px solid #10b981;color:#10b981;padding:12px 20px;border-radius:10px;font-size:0.9rem;box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:slideInRight 0.35s cubic-bezier(0.16,1,0.3,1);max-width:420px;';
        n.textContent = msg;
        document.body.appendChild(n);
        setTimeout(() => { n.style.cssText += 'opacity:0;transition:opacity 0.4s;'; setTimeout(() => n.remove(), 400); }, 4500);
    }

    function sortPeriodsChronologically(periods) {
        const months = {
            'Ocak': 1, 'Şubat': 2, 'Mart': 3, 'Nisan': 4, 'Mayıs': 5, 'Haziran': 6,
            'Temmuz': 7, 'Ağustos': 8, 'Eylül': 9, 'Ekim': 10, 'Kasım': 11, 'Aralık': 12
        };
        return [...periods].sort((a, b) => {
            const partsA = String(a).split(' ');
            const partsB = String(b).split(' ');
            const monthA = months[partsA[0]] || 99;
            const monthB = months[partsB[0]] || 99;
            const yearA = parseInt(partsA[1]) || 0;
            const yearB = parseInt(partsB[1]) || 0;

            if (yearA !== yearB) return yearA - yearB;
            return monthA - monthB;
        });
    }

    async function renderStockTrendChart() {
        const trendCard = $('stock-trend-card');
        if (!trendCard) return;

        if (stockState.periodNames.length === 0) {
            trendCard.style.display = 'none';
            return;
        }
        trendCard.style.display = 'block';

        const trendData = [];
        for (const period of stockState.periodNames) {
            const rows = await dbLoad(period);
            const totalQty = rows.reduce((s, r) => s + r.miktarKalan, 0);
            const totalVal = rows.reduce((s, r) => s + r.envTutar, 0);
            const totalCikan = rows.reduce((s, r) => s + r.miktarCikan, 0);
            const totalGiren = rows.reduce((s, r) => s + r.miktarGiren, 0);
            trendData.push({
                period,
                totalQty,
                totalVal,
                totalCikan,
                totalGiren
            });
        }

        const ctx = $('chart-stock-trend').getContext('2d');
        
        if (window.stockTrendChartInstance) {
            window.stockTrendChartInstance.destroy();
        }

        const labels = trendData.map(d => d.period);
        const qtyData = trendData.map(d => d.totalQty);
        const valData = trendData.map(d => d.totalVal);

        window.stockTrendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Kalan Stok (Adet)',
                        data: qtyData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.05)',
                        borderWidth: 3,
                        pointBackgroundColor: '#3b82f6',
                        tension: 0.35,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Stok Değeri (TL)',
                        data: valData,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.05)',
                        borderWidth: 3,
                        pointBackgroundColor: '#f59e0b',
                        tension: 0.35,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#f1f5f9' }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Miktar (Adet)',
                            color: '#3b82f6'
                        },
                        grid: { color: '#2e364f' },
                        ticks: { color: '#94a3b8' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Değer (TL)',
                            color: '#f59e0b'
                        },
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: '#94a3b8',
                            callback: (val) => val.toLocaleString('tr-TR') + ' ₺'
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    // ── Boot ───────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);

})();
