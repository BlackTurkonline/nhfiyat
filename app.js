document.addEventListener('DOMContentLoaded', () => {
    // Parse compressed dataset
    let parsedData = [];
    if (typeof dashboardData !== 'undefined' && dashboardData) {
        const monthsList = dashboardData.months || [];
        const itemsList = dashboardData.items || [];
        parsedData = itemsList.map(item => {
            const partNo = item[0];
            const partName = item[1];
            const pricesArr = item[2] || [];
            
            const pricesObj = {};
            monthsList.forEach((m, idx) => {
                pricesObj[m] = pricesArr[idx] || 0;
            });
            
            const validPrices = pricesArr.filter(p => p > 0);
            const hasChanged = new Set(validPrices).size > 1;
            const isNew = pricesArr[0] === 0;
            const isRemoved = pricesArr[pricesArr.length - 1] === 0;
            
            let pctIncrease = 0;
            const len = pricesArr.length;
            if (len > 1) {
                const currentPrice = pricesArr[len - 1];
                const prevPrice = pricesArr[len - 2];
                if (prevPrice > 0 && currentPrice > 0) {
                    pctIncrease = ((currentPrice - prevPrice) / prevPrice) * 100;
                }
            }
            
            return {
                partNo: partNo,
                partName: partName,
                prices: pricesObj,
                hasChanged: hasChanged,
                pctIncrease: pctIncrease,
                isNew: isNew,
                isRemoved: isRemoved
            };
        });
    }

    // State
    const state = {
        data: parsedData,
        filteredData: [],
        view: 'all', // all, changed, extremes, analytics, upload
        extremesMode: 'charts',
        currentPage: 1,
        itemsPerPage: 100,
        searchQuery: '',
        extremeThreshold: 10, // default 10%
        uploadAuthorized: sessionStorage.getItem('uploadAuthorized') === 'true',
        sortBy: 'partNo', // default sort column
        sortOrder: 'asc', // asc or desc
        // Advanced filters
        filters: {
            minPrice: null,
            maxPrice: null,
            minChange: null,
            maxChange: null,
            statusUp: true,
            statusDown: true,
            statusSame: true,
            statusNew: true,
            statusRemoved: true
        },
        selectedParts: new Set(), // holds part numbers
        analyticsIndexFilter: 'all', // all or servisim
        stockView: 'stock', // just a flag
        monthlyChanges: {}
    };

    // Initialize
    state.filteredData = [...state.data];
    calculateMonthlyChanges();
    updateStats();
    renderView();


    // DOM Elements
    const navBtns = document.querySelectorAll('.nav-btn');
    const searchInput = document.getElementById('search-input');
    const thresholdSelect = document.getElementById('extreme-threshold');
    const searchBarContainer = document.querySelector('.search-bar'); // To inject instant feature

    // Event Listeners
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            navBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            state.view = e.currentTarget.dataset.view;
            state.currentPage = 1;

            if (state.view === 'extremes') {
                document.getElementById('extreme-controls').style.display = 'flex';
            } else {
                document.getElementById('extreme-controls').style.display = 'none';
            }

            applyFilters();
        });
    });

    thresholdSelect.addEventListener('change', (e) => {
        state.extremeThreshold = parseFloat(e.target.value);
        if (state.view === 'extremes') {
            applyFilters();
        }
    });

    document.getElementById('btn-chart-view').addEventListener('click', (e) => {
        state.extremesMode = 'charts';
        document.getElementById('btn-chart-view').classList.add('active');
        document.getElementById('btn-list-view').classList.remove('active');
        renderView();
    });

    document.getElementById('btn-list-view').addEventListener('click', (e) => {
        state.extremesMode = 'list';
        document.getElementById('btn-list-view').classList.add('active');
        document.getElementById('btn-chart-view').classList.remove('active');
        renderView();
    });

    document.getElementById('btn-export-excel').addEventListener('click', () => {
        exportToCSV();
    });

    searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        state.currentPage = 1;
        applyFilters();
        checkInstantFeature();
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            renderTable();
        }
    });

    document.getElementById('next-btn').addEventListener('click', () => {
        const maxPage = Math.ceil(state.filteredData.length / state.itemsPerPage);
        if (state.currentPage < maxPage) {
            state.currentPage++;
            renderTable();
        }
    });

    // Core Functions
    function calculateMonthlyChanges() {
        if (state.data.length === 0) return;
        const months = Object.keys(state.data[0].prices);
        
        for (let i = 1; i < months.length; i++) {
            const prevMonth = months[i-1];
            const currentMonth = months[i];
            
            let sumPrev = 0;
            let sumCurr = 0;
            let count = 0;
            
            state.data.forEach(item => {
                const pPrev = item.prices[prevMonth] || 0;
                const pCurr = item.prices[currentMonth] || 0;
                if (pPrev > 0 && pCurr > 0) {
                    sumPrev += pPrev;
                    sumCurr += pCurr;
                    count++;
                }
            });
            
            if (sumPrev > 0 && count > 0) {
                state.monthlyChanges[currentMonth] = ((sumCurr - sumPrev) / sumPrev) * 100;
            } else {
                state.monthlyChanges[currentMonth] = 0;
            }
        }
    }

    function updateStats() {
        // Main stats
        document.getElementById('stats-total').textContent = state.data.length.toLocaleString('tr-TR');
        const changedCount = state.data.filter(d => d.hasChanged).length;
        document.getElementById('stats-changed').textContent = changedCount.toLocaleString('tr-TR');

        // Servisim (SM) stats
        const smParts = state.data.filter(d => d.partNo && d.partNo.toUpperCase().startsWith('SM'));
        const smTotal = smParts.length;
        const smChanged = smParts.filter(d => d.hasChanged && d.pctIncrease > 0 && !d.isNew && !d.isRemoved).length;
        const smDecreased = smParts.filter(d => d.pctIncrease < 0 && !d.isNew && !d.isRemoved).length;

        const totalEl = document.getElementById('sm-stat-total');
        const changedEl = document.getElementById('sm-stat-changed');
        const decreasedEl = document.getElementById('sm-stat-decreased');

        if (totalEl) totalEl.textContent = smTotal.toLocaleString('tr-TR');
        if (changedEl) changedEl.textContent = smChanged.toLocaleString('tr-TR');
        if (decreasedEl) decreasedEl.textContent = smDecreased.toLocaleString('tr-TR');
    }

    function applyFilters() {
        let filtered = state.data;

        // Apply View Filter
        if (state.view === 'changed') {
            filtered = filtered.filter(d => d.hasChanged && !d.isNew && !d.isRemoved);
        } else if (state.view === 'extremes') {
            filtered = filtered.filter(d => d.pctIncrease > state.extremeThreshold && !d.isNew && !d.isRemoved);
        } else if (state.view === 'new') {
            filtered = filtered.filter(d => d.isNew);
        } else if (state.view === 'decreased') {
            filtered = filtered.filter(d => d.pctIncrease < 0 && !d.isNew && !d.isRemoved);
        } else if (state.view === 'removed') {
            filtered = filtered.filter(d => d.isRemoved);
        } else if (state.view === 'servisim') {
            filtered = filtered.filter(d => d.partNo && d.partNo.toUpperCase().startsWith('SM'));
        }

        // Apply Search Filter
        if (state.searchQuery) {
            filtered = filtered.filter(d => 
                (d.partNo && d.partNo.toLowerCase().includes(state.searchQuery)) ||
                (d.partName && d.partName.toLowerCase().includes(state.searchQuery))
            );
        }

        // Apply Advanced Filters
        if (state.filters.minPrice !== null && state.filters.minPrice !== undefined) {
            filtered = filtered.filter(d => {
                const prices = Object.values(d.prices).filter(p => p > 0);
                const currentPrice = prices[prices.length - 1] || 0;
                return currentPrice >= state.filters.minPrice;
            });
        }
        if (state.filters.maxPrice !== null && state.filters.maxPrice !== undefined) {
            filtered = filtered.filter(d => {
                const prices = Object.values(d.prices).filter(p => p > 0);
                const currentPrice = prices[prices.length - 1] || 0;
                return currentPrice <= state.filters.maxPrice;
            });
        }
        if (state.filters.minChange !== null && state.filters.minChange !== undefined) {
            filtered = filtered.filter(d => d.pctIncrease >= state.filters.minChange);
        }
        if (state.filters.maxChange !== null && state.filters.maxChange !== undefined) {
            filtered = filtered.filter(d => d.pctIncrease <= state.filters.maxChange);
        }
        
        // Status checks
        filtered = filtered.filter(d => {
            if (d.isNew && !state.filters.statusNew) return false;
            if (d.isRemoved && !state.filters.statusRemoved) return false;
            if (!d.isNew && !d.isRemoved) {
                if (d.pctIncrease > 0 && !state.filters.statusUp) return false;
                if (d.pctIncrease < 0 && !state.filters.statusDown) return false;
                if (d.pctIncrease === 0 && !state.filters.statusSame) return false;
            }
            return true;
        });

        // Sorting Logic
        if (state.sortBy) {
            filtered.sort((a, b) => {
                let valA, valB;
                if (state.sortBy === 'partNo') {
                    valA = String(a.partNo || '');
                    valB = String(b.partNo || '');
                    return state.sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                } else if (state.sortBy === 'partName') {
                    valA = String(a.partName || '');
                    valB = String(b.partName || '');
                    return state.sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                } else if (state.sortBy === 'pctIncrease') {
                    valA = a.pctIncrease || 0;
                    valB = b.pctIncrease || 0;
                    return state.sortOrder === 'asc' ? valA - valB : valB - valA;
                } else if (state.sortBy.startsWith('price-')) {
                    const month = state.sortBy.substring(6);
                    valA = a.prices[month] || 0;
                    valB = b.prices[month] || 0;
                    if (valA === 0) return 1;
                    if (valB === 0) return -1;
                    return state.sortOrder === 'asc' ? valA - valB : valB - valA;
                }
                return 0;
            });
        } else if (state.view === 'extremes') {
            filtered.sort((a, b) => b.pctIncrease - a.pctIncrease);
        }

        state.filteredData = filtered;
        renderView();
    }

    function renderView() {
        const tableView = document.getElementById('table-view');
        const gridView = document.getElementById('grid-view');
        const uploadView = document.getElementById('upload-view');
        const analyticsView = document.getElementById('analytics-view');
        const stockView = document.getElementById('stock-view');
        const searchBarContainer = document.querySelector('.search-bar-container');

        tableView.classList.remove('active');
        gridView.classList.remove('active');
        if (uploadView) uploadView.classList.remove('active');
        if (analyticsView) analyticsView.classList.remove('active');
        if (stockView) stockView.classList.remove('active');

        // Hide floating comparison bar when not in main tables
        updateComparisonBar();

        if (state.view === 'upload') {
            if (searchBarContainer) searchBarContainer.style.display = 'none';
            if (uploadView) {
                uploadView.classList.add('active');
                checkUploadAuth();
            }
        } else if (state.view === 'analytics') {
            if (searchBarContainer) searchBarContainer.style.display = 'none';
            if (analyticsView) {
                analyticsView.classList.add('active');
                renderAnalytics();
            }
        } else if (state.view === 'stock') {
            if (searchBarContainer) searchBarContainer.style.display = 'none';
            if (stockView) {
                stockView.classList.add('active');
            }
        } else {
            if (searchBarContainer) searchBarContainer.style.display = 'flex';
            if (state.view === 'extremes') {
                if (state.extremesMode === 'list') {
                    tableView.classList.add('active');
                    renderTable();
                } else {
                    gridView.classList.add('active');
                    renderExtremes();
                }
            } else {
                tableView.classList.add('active');
                renderTable();
            }
        }
    }

    function renderTable() {
        const thead = document.getElementById('table-header-row');
        if (thead && state.data.length > 0) {
            const months = Object.keys(state.data[0].prices);
            
            // Generate sort indicators
            const getIndicator = (col) => {
                if (state.sortBy === col) {
                    return state.sortOrder === 'asc' ? ' <span class="sort-indicator">▲</span>' : ' <span class="sort-indicator">▼</span>';
                }
                return ' <span class="sort-indicator" style="opacity:0.3">▲</span>';
            };

            let headHTML = `<th class="checkbox-col"><input type="checkbox" id="check-all-parts" ${state.filteredData.length > 0 && state.filteredData.every(item => state.selectedParts.has(item.partNo)) ? 'checked' : ''}></th>`;
            headHTML += `<th class="sortable" data-sort="partNo">Parça No${getIndicator('partNo')}</th>`;
            headHTML += `<th class="sortable" data-sort="partName">Parça Adı${getIndicator('partName')}</th>`;
            
            months.forEach((m, idx) => {
                let changeStr = '';
                if (idx > 0) {
                    const pct = state.monthlyChanges[m];
                    if (pct !== undefined && pct !== null) {
                        const sign = pct > 0 ? '+' : '';
                        const colorClass = pct > 0 ? 'price-up' : pct < 0 ? 'price-down' : 'price-same';
                        changeStr = `<div style="font-size: 0.72rem; font-weight: 500; text-transform: none; margin-top: 3px;" class="${colorClass}">(${sign}${pct.toFixed(2)}%)</div>`;
                    }
                } else {
                    changeStr = `<div style="font-size: 0.72rem; font-weight: 500; text-transform: none; margin-top: 3px; visibility: hidden;">(0.00%)</div>`;
                }
                headHTML += `<th class="sortable" data-sort="price-${m}">
                    <div style="display: inline-flex; flex-direction: column; align-items: flex-start; vertical-align: middle;">
                        <span>${m} '26</span>
                        ${changeStr}
                    </div>
                    ${getIndicator('price-' + m)}
                </th>`;
            });
            headHTML += `<th class="sortable" data-sort="pctIncrease">Artış (%)${getIndicator('pctIncrease')}</th>`;
            
            thead.innerHTML = headHTML;
            
            // Add sort event listeners
            thead.querySelectorAll('.sortable').forEach(th => {
                th.addEventListener('click', (e) => {
                    const sortCol = e.currentTarget.dataset.sort;
                    if (state.sortBy === sortCol) {
                        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
                    } else {
                        state.sortBy = sortCol;
                        state.sortOrder = 'asc';
                    }
                    applyFilters();
                });
            });

            // check-all event listener
            const checkAll = document.getElementById('check-all-parts');
            if (checkAll) {
                checkAll.addEventListener('change', (e) => {
                    const checked = e.target.checked;
                    state.filteredData.forEach(item => {
                        if (checked) {
                            state.selectedParts.add(item.partNo);
                        } else {
                            state.selectedParts.delete(item.partNo);
                        }
                    });
                    updateComparisonBar();
                    renderTable(); // rerender rows
                });
            }
        }

        const tbody = document.getElementById('table-body');
        tbody.innerHTML = '';

        const start = (state.currentPage - 1) * state.itemsPerPage;
        const end = start + state.itemsPerPage;
        const pageData = state.filteredData.slice(start, end);

        pageData.forEach(item => {
            const tr = document.createElement('tr');
            
            let pctClass = 'price-same';
            if (item.pctIncrease > 0) pctClass = 'price-up';
            else if (item.pctIncrease < 0) pctClass = 'price-down';

            const isChecked = state.selectedParts.has(item.partNo);

            let rowHTML = `
                <td class="checkbox-col"><input type="checkbox" class="part-checkbox" data-part="${item.partNo}" ${isChecked ? 'checked' : ''}></td>
                <td class="part-no-cell"><strong>${item.partNo}</strong></td>
                <td class="part-name-cell">${item.partName}</td>
            `;
            const pricesValues = Object.values(item.prices);
            pricesValues.forEach((p, idx) => {
                if (p === 0) {
                    rowHTML += `<td class="price-cell">-</td>`;
                    return;
                }
                
                // Find previous valid price
                let prevValid = null;
                for (let k = idx - 1; k >= 0; k--) {
                    if (pricesValues[k] > 0) {
                        prevValid = pricesValues[k];
                        break;
                    }
                }
                
                // Find next valid price
                let nextValid = null;
                for (let k = idx + 1; k < pricesValues.length; k++) {
                    if (pricesValues[k] > 0) {
                        nextValid = pricesValues[k];
                        break;
                    }
                }
                
                let cellClass = '';
                if (prevValid !== null && p > prevValid) {
                    cellClass = 'cell-price-up';
                } else if (nextValid !== null && p < nextValid) {
                    cellClass = 'cell-price-old';
                }
                
                rowHTML += `<td class="price-cell ${cellClass}">${formatPrice(p)}</td>`;
            });
            rowHTML += `<td class="${pctClass}">${item.pctIncrease > 0 ? '+' : ''}${item.pctIncrease.toFixed(2)}%</td>`;
            tr.innerHTML = rowHTML;
            tbody.appendChild(tr);
        });

        // Add checkbox change event listeners
        tbody.querySelectorAll('.part-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const partNo = e.target.dataset.part;
                if (e.target.checked) {
                    state.selectedParts.add(partNo);
                } else {
                    state.selectedParts.delete(partNo);
                }
                updateComparisonBar();
                
                // update check-all checkbox state
                const checkAll = document.getElementById('check-all-parts');
                if (checkAll) {
                    checkAll.checked = state.filteredData.length > 0 && state.filteredData.every(item => state.selectedParts.has(item.partNo));
                }
            });
        });

        // Update Pagination Info
        const maxPage = Math.max(1, Math.ceil(state.filteredData.length / state.itemsPerPage));
        document.getElementById('page-info').textContent = `Sayfa ${state.currentPage} / ${maxPage} (${state.filteredData.length} kayıt)`;
        document.getElementById('prev-btn').disabled = state.currentPage === 1;
        document.getElementById('next-btn').disabled = state.currentPage === maxPage;
    }

    function renderExtremes() {
        const container = document.getElementById('charts-container');
        container.innerHTML = '';

        // Only display first 50 extremes to avoid freezing max
        const displayData = state.filteredData.slice(0, 50);

        displayData.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'chart-card';
            
            const canvasId = `chart-${index}`;

            card.innerHTML = `
                <div class="chart-header">
                    <h3>${item.partNo}</h3>
                    <p>${item.partName}</p>
                    <div class="percentage-badge high">+${item.pctIncrease.toFixed(2)}% Artış</div>
                </div>
                <div style="position: relative; height: 150px; width: 100%;">
                    <canvas id="${canvasId}"></canvas>
                </div>
            `;
            container.appendChild(card);

            renderChart(canvasId, item);
        });
    }

    function renderChart(canvasId, item) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        const months = Object.keys(item.prices);
        const data = Object.values(item.prices);

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: 'Fiyat (TL)',
                    data: data,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    pointBackgroundColor: '#ef4444',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        grid: { color: '#2e364f' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    // Feature: Instant visual tracking when exact or single item is searched
    let instantChartInstance = null;
    function checkInstantFeature() {
        const existingInstant = document.getElementById('instant-feature-box');
        
        // If query is empty or we have too many results, remove it
        if (!state.searchQuery || state.filteredData.length !== 1) {
            if (existingInstant) existingInstant.remove();
            if (instantChartInstance) {
                instantChartInstance.destroy();
                instantChartInstance = null;
            }
            return;
        }

        // We have exactly 1 match
        const item = state.filteredData[0];
        
        if (!existingInstant) {
            const div = document.createElement('div');
            div.id = 'instant-feature-box';
            div.className = 'instant-feature';
            searchBarContainer.parentNode.insertBefore(div, searchBarContainer.nextSibling);
        }
        
        const box = document.getElementById('instant-feature-box');
        
        const validPrices = Object.values(item.prices).filter(p => p > 0);
        const startPrice = validPrices[0] || 0;
        const endPrice = validPrices[validPrices.length - 1] || 0;
        
        const monthsList = Object.keys(item.prices);
        const fMonth = monthsList[0] || 'Oca';
        const lMonth = monthsList[monthsList.length - 1] || 'Güncel';

        box.innerHTML = `
            <div class="info">
                <h3>${item.partNo}</h3>
                <p>${item.partName}</p>
                <div class="price-highlight">
                    <div class="price-box">
                        <span>${fMonth} '26</span>
                        <strong>${formatPrice(startPrice)}</strong>
                    </div>
                    <div class="price-box">
                        <span>${lMonth} '26</span>
                        <strong>${formatPrice(endPrice)}</strong>
                    </div>
                </div>
                <div class="huge-perc ${item.pctIncrease > 0 ? 'price-up' : item.pctIncrease < 0 ? 'price-down' : 'price-same'}">
                    ${item.pctIncrease > 0 ? '↗ +' : item.pctIncrease < 0 ? '↘ ' : ''}${item.pctIncrease.toFixed(2)}%
                </div>
            </div>
            <div class="chart-wrapper" style="position: relative; height: 200px; width: 400px;">
                <canvas id="instant-chart"></canvas>
            </div>
        `;

        if (instantChartInstance) instantChartInstance.destroy();
        
        const ctx = document.getElementById('instant-chart').getContext('2d');
        const labels = Object.keys(item.prices);
        const data = Object.values(item.prices);
        
        instantChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Fiyat',
                    data: data,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    borderWidth: 3,
                    pointRadius: 4,
                    pointBackgroundColor: '#fff',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { display:false } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: '#2e364f' } }
                }
            }
        });
    }

    function formatPrice(val) {
        if (!val) return '-';
        return val.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
    }

    function exportToCSV() {
        if (state.filteredData.length === 0) {
            alert('Dışa aktarılacak veri bulunamadı.');
            return;
        }

        let csvContent = "";
        
        // Dynamic Headers
        const allMonths = state.data.length > 0 ? Object.keys(state.data[0].prices) : [];
        let curHeaders = '"Parça No";"Parça Adı";"Durum"';
        allMonths.forEach(m => curHeaders += `;"${m} '26"`);
        curHeaders += ';"Artış (%)"\n';
        csvContent += curHeaders;

        state.filteredData.forEach(row => {
            // Escape quotes and remove newlines to prevent column/row shifting
            let pNo = `"${String(row.partNo || '').replace(/"/g, '""').replace(/\n|\r/g, ' ')}"`;
            let pName = `"${String(row.partName || '').replace(/"/g, '""').replace(/\n|\r/g, ' ')}"`;
            let statusStr = `"${row.isRemoved ? "Çıkarıldı" : (row.isNew ? "Yeni Eklendi" : (row.hasChanged ? "Fiyat Değişti" : "Aynı"))}"`;
            
            // Format floats for Turkish Excel (replace dot with comma) to prevent datatype mixing
            let formatNum = (num) => `"${String(num || 0).replace('.', ',')}"`;
            
            let rowCsv = `${pNo};${pName};${statusStr}`;
            allMonths.forEach(m => {
                rowCsv += `;${formatNum(row.prices[m])}`;
            });
            
            let inc = `"%${row.pctIncrease.toFixed(2).replace('.', ',')}"`;
            rowCsv += `;${inc}\n`;

            csvContent += rowCsv;
        });

        // Prepend pure UTF-8 BOM bytes so Excel natively detects Turkish characters
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        
        const timestamp = new Date().toISOString().slice(0,10);
        link.setAttribute("download", `fiyat_degisimi_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // File Upload Functionality
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const protocolWarning = document.getElementById('protocol-warning');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    const statusText = document.getElementById('upload-status-text');
    const resultBox = document.getElementById('upload-result-box');

    // Password Protection Elements
    const passwordCard = document.getElementById('password-card');
    const uploadMainCard = document.getElementById('upload-main-card');
    const passwordInput = document.getElementById('upload-password-input');
    const passwordSubmit = document.getElementById('upload-password-submit');
    const passwordError = document.getElementById('upload-password-error');

    function checkUploadAuth() {
        if (!passwordCard || !uploadMainCard) return;
        
        if (state.uploadAuthorized) {
            passwordCard.style.display = 'none';
            uploadMainCard.style.display = 'block';
        } else {
            passwordCard.style.display = 'block';
            uploadMainCard.style.display = 'none';
            if (passwordInput) passwordInput.focus();
        }
    }

    if (passwordSubmit) {
        passwordSubmit.addEventListener('click', handlePasswordSubmit);
    }
    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handlePasswordSubmit();
            }
        });
    }

    function handlePasswordSubmit() {
        if (!passwordInput) return;
        const password = passwordInput.value.trim();
        if (password === '581534') {
            state.uploadAuthorized = true;
            sessionStorage.setItem('uploadAuthorized', 'true');
            if (passwordError) passwordError.style.display = 'none';
            passwordInput.value = '';
            checkUploadAuth();
        } else {
            if (passwordError) {
                passwordError.textContent = 'Hatalı şifre! Lütfen tekrar deneyin.';
                passwordError.style.display = 'block';
            }
            passwordInput.focus();
            passwordInput.select();
        }
    }

    const isFileProtocol = window.location.protocol === 'file:';

    if (dropZone) {
        if (isFileProtocol) {
            if (protocolWarning) protocolWarning.style.display = 'block';
            dropZone.style.opacity = '0.5';
            dropZone.style.pointerEvents = 'none';
        } else {
            if (protocolWarning) protocolWarning.style.display = 'none';
            dropZone.style.opacity = '1';
            dropZone.style.pointerEvents = 'auto';

            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragover');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    handleFileUpload(files[0]);
                }
            });

            dropZone.addEventListener('click', () => {
                fileInput.click();
            });

            fileInput.addEventListener('change', (e) => {
                const files = e.target.files;
                if (files.length > 0) {
                    handleFileUpload(files[0]);
                }
            });
        }
    }

    function handleFileUpload(file) {
        if (!file.name.toLowerCase().endsWith('.xlsx')) {
            showUploadResult(false, 'Yalnızca Excel (.xlsx) dosyaları yükleyebilirsiniz.');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        statusText.textContent = 'Bağlantı kuruluyor...';
        resultBox.style.display = 'none';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                progressBar.style.width = percent + '%';
                statusText.textContent = `Yükleniyor: %${Math.round(percent)}`;
                if (percent >= 100) {
                    statusText.textContent = 'Dosya sunucuya ulaştı, veri analiz ediliyor... Bu işlem 30-60 saniye sürebilir.';
                }
            }
        };

        xhr.onload = () => {
            progressContainer.style.display = 'none';
            if (xhr.status === 200) {
                try {
                    const res = JSON.parse(xhr.responseText);
                    showUploadResult(true, res.message || 'Başarıyla güncellendi!');
                    
                    statusText.textContent = 'Veriler başarıyla güncellendi! Sayfa 3 saniye içinde yenilenecek...';
                    progressContainer.style.display = 'block';
                    progressBar.style.width = '100%';
                    setTimeout(() => {
                        window.location.reload();
                    }, 3000);
                } catch(err) {
                    showUploadResult(true, 'Yükleme başarılı, veriler güncelleniyor. Lütfen sayfayı yenileyin.');
                }
            } else {
                let errorMsg = 'Yükleme hatası oluştu.';
                try {
                    const res = JSON.parse(xhr.responseText);
                    errorMsg = res.message || errorMsg;
                } catch(err) {}
                showUploadResult(false, errorMsg);
            }
        };

        xhr.onerror = () => {
            progressContainer.style.display = 'none';
            showUploadResult(false, 'Sunucu bağlantı hatası. Lütfen "Sistemi_Baslat.bat" dosyasının çalıştığından emin olun.');
        };

        xhr.send(formData);
    }

    function showUploadResult(isSuccess, message) {
        resultBox.style.display = 'block';
        resultBox.className = `alert-box ${isSuccess ? 'success' : 'error'}`;
        resultBox.innerHTML = isSuccess ? 
            `<strong>✔️ Başarılı:</strong> ${message}` : 
            `<strong>❌ Hata:</strong> ${message}`;
    }

    // Comparison Bar & Modal Functions
    function updateComparisonBar() {
        const bar = document.getElementById('comparison-bar');
        const countEl = document.getElementById('comparison-count');
        if (!bar || !countEl) return;

        const count = state.selectedParts.size;
        countEl.textContent = count;

        if (count > 0 && state.view !== 'upload' && state.view !== 'analytics') {
            bar.style.display = 'flex';
        } else {
            bar.style.display = 'none';
        }
    }

    let compareChartInstance = null;
    function openCompareModal() {
        const modal = document.getElementById('compare-modal');
        if (!modal) return;
        
        modal.style.display = 'flex';
        
        const selectedList = state.data.filter(d => state.selectedParts.has(d.partNo));
        
        const theader = document.getElementById('compare-table-header');
        const tbody = document.getElementById('compare-table-body');
        
        if (selectedList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Seçili ürün bulunamadı.</td></tr>';
            return;
        }
        
        const months = Object.keys(selectedList[0].prices);
        
        let headerHTML = `<th>Parça No</th><th>Parça Adı</th>`;
        months.forEach((m, idx) => {
            let changeStr = '';
            if (idx > 0) {
                const pct = state.monthlyChanges[m];
                if (pct !== undefined && pct !== null) {
                    const sign = pct > 0 ? '+' : '';
                    const colorClass = pct > 0 ? 'price-up' : pct < 0 ? 'price-down' : 'price-same';
                    changeStr = `<div style="font-size: 0.72rem; font-weight: 500; text-transform: none; margin-top: 3px;" class="${colorClass}">(${sign}${pct.toFixed(2)}%)</div>`;
                }
            } else {
                changeStr = `<div style="font-size: 0.72rem; font-weight: 500; text-transform: none; margin-top: 3px; visibility: hidden;">(0.00%)</div>`;
            }
            headerHTML += `<th>
                <div style="display: inline-flex; flex-direction: column; align-items: flex-start; vertical-align: middle;">
                    <span>${m} '26</span>
                    ${changeStr}
                </div>
            </th>`;
        });
        headerHTML += `<th>Toplam Değişim</th>`;
        theader.innerHTML = headerHTML;
        
        tbody.innerHTML = '';
        selectedList.forEach(item => {
            let rowHTML = `<td class="part-no-cell"><strong>${item.partNo}</strong></td><td class="part-name-cell">${item.partName}</td>`;
            months.forEach(m => {
                const val = item.prices[m];
                rowHTML += `<td class="price-cell">${val > 0 ? formatPrice(val) : '-'}</td>`;
            });
            const pctClass = item.pctIncrease > 0 ? 'price-up' : item.pctIncrease < 0 ? 'price-down' : 'price-same';
            rowHTML += `<td class="${pctClass}">${item.pctIncrease > 0 ? '+' : ''}${item.pctIncrease.toFixed(2)}%</td>`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = rowHTML;
            tbody.appendChild(tr);
        });
        
        if (compareChartInstance) {
            compareChartInstance.destroy();
        }
        
        const ctx = document.getElementById('chart-comparison-multi').getContext('2d');
        const colors = [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', 
            '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#14b8a6'
        ];
        
        const datasets = selectedList.map((item, idx) => {
            const color = colors[idx % colors.length];
            const dataPoints = months.map(m => item.prices[m] || null);
            return {
                label: item.partNo,
                data: dataPoints,
                borderColor: color,
                backgroundColor: 'transparent',
                borderWidth: 3,
                pointBackgroundColor: color,
                pointRadius: 4,
                tension: 0.3,
                spanGaps: true
            };
        });
        
        compareChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: months,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#f1f5f9' }
                    }
                },
                scales: {
                    y: {
                        grid: { color: '#2e364f' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    // Advanced Filters Toggle and Event Listeners
    const btnToggleFilters = document.getElementById('btn-toggle-filters');
    const advancedFilterPanel = document.getElementById('advanced-filter-panel');
    const btnApplyFilters = document.getElementById('btn-apply-advanced-filters');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const btnGlobalExportExcel = document.getElementById('btn-global-export-excel');

    if (btnToggleFilters && advancedFilterPanel) {
        btnToggleFilters.addEventListener('click', () => {
            if (advancedFilterPanel.style.display === 'none') {
                advancedFilterPanel.style.display = 'block';
                btnToggleFilters.classList.add('active');
            } else {
                advancedFilterPanel.style.display = 'none';
                btnToggleFilters.classList.remove('active');
            }
        });
    }

    if (btnApplyFilters) {
        btnApplyFilters.addEventListener('click', () => {
            const minPriceEl = document.getElementById('filter-min-price');
            const maxPriceEl = document.getElementById('filter-max-price');
            const minChangeEl = document.getElementById('filter-min-change');
            const maxChangeEl = document.getElementById('filter-max-change');

            state.filters.minPrice = minPriceEl && minPriceEl.value ? parseFloat(minPriceEl.value) : null;
            state.filters.maxPrice = maxPriceEl && maxPriceEl.value ? parseFloat(maxPriceEl.value) : null;
            state.filters.minChange = minChangeEl && minChangeEl.value ? parseFloat(minChangeEl.value) : null;
            state.filters.maxChange = maxChangeEl && maxChangeEl.value ? parseFloat(maxChangeEl.value) : null;

            const upEl = document.getElementById('filter-status-up');
            const downEl = document.getElementById('filter-status-down');
            const sameEl = document.getElementById('filter-status-same');
            const newEl = document.getElementById('filter-status-new');
            const removedEl = document.getElementById('filter-status-removed');

            state.filters.statusUp = upEl ? upEl.checked : true;
            state.filters.statusDown = downEl ? downEl.checked : true;
            state.filters.statusSame = sameEl ? sameEl.checked : true;
            state.filters.statusNew = newEl ? newEl.checked : true;
            state.filters.statusRemoved = removedEl ? removedEl.checked : true;

            state.currentPage = 1;
            applyFilters();
        });
    }

    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', () => {
            const minPriceEl = document.getElementById('filter-min-price');
            const maxPriceEl = document.getElementById('filter-max-price');
            const minChangeEl = document.getElementById('filter-min-change');
            const maxChangeEl = document.getElementById('filter-max-change');

            if (minPriceEl) minPriceEl.value = '';
            if (maxPriceEl) maxPriceEl.value = '';
            if (minChangeEl) minChangeEl.value = '';
            if (maxChangeEl) maxChangeEl.value = '';
            
            const upEl = document.getElementById('filter-status-up');
            const downEl = document.getElementById('filter-status-down');
            const sameEl = document.getElementById('filter-status-same');
            const newEl = document.getElementById('filter-status-new');
            const removedEl = document.getElementById('filter-status-removed');

            if (upEl) upEl.checked = true;
            if (downEl) downEl.checked = true;
            if (sameEl) sameEl.checked = true;
            if (newEl) newEl.checked = true;
            if (removedEl) removedEl.checked = true;

            state.filters = {
                minPrice: null,
                maxPrice: null,
                minChange: null,
                maxChange: null,
                statusUp: true,
                statusDown: true,
                statusSame: true,
                statusNew: true,
                statusRemoved: true
            };

            state.currentPage = 1;
            applyFilters();
        });
    }

    if (btnGlobalExportExcel) {
        btnGlobalExportExcel.addEventListener('click', () => {
            exportToCSV();
        });
    }

    // Comparison Event Listeners
    const btnClearComparison = document.getElementById('btn-clear-comparison');
    const btnOpenComparison = document.getElementById('btn-open-comparison');
    const btnCloseCompareModal = document.getElementById('btn-close-compare-modal');
    const compareModal = document.getElementById('compare-modal');

    if (btnClearComparison) {
        btnClearComparison.addEventListener('click', () => {
            state.selectedParts.clear();
            updateComparisonBar();
            renderTable();
        });
    }

    if (btnOpenComparison) {
        btnOpenComparison.addEventListener('click', () => {
            openCompareModal();
        });
    }

    if (btnCloseCompareModal) {
        btnCloseCompareModal.addEventListener('click', () => {
            if (compareModal) compareModal.style.display = 'none';
        });
    }

    if (compareModal) {
        compareModal.addEventListener('click', (e) => {
            if (e.target.id === 'compare-modal') {
                compareModal.style.display = 'none';
            }
        });
    }

    // Analytics Rendering Functions
    let generalIndexChart = null;
    let categoryIncreaseChart = null;

    function renderAnalytics() {
        const container = document.getElementById('analytics-view');
        if (!container) return;

        let dataList = state.data;
        if (state.analyticsIndexFilter === 'servisim') {
            dataList = dataList.filter(d => d.partNo && d.partNo.toUpperCase().startsWith('SM'));
        }

        if (dataList.length === 0) return;

        const months = Object.keys(dataList[0].prices);
        
        const monthlyAverages = months.map(m => {
            const activeParts = dataList.filter(d => d.prices[m] > 0);
            const sum = activeParts.reduce((acc, curr) => acc + curr.prices[m], 0);
            return activeParts.length > 0 ? sum / activeParts.length : 0;
        });

        const baseAvg = monthlyAverages[0] || 1;
        const indexData = monthlyAverages.map(avg => (avg / baseAvg) * 100);

        if (generalIndexChart) generalIndexChart.destroy();
        const ctxIndex = document.getElementById('chart-general-index').getContext('2d');
        generalIndexChart = new Chart(ctxIndex, {
            type: 'line',
            data: {
                labels: months,
                datasets: [{
                    label: 'Fiyat Endeksi',
                    data: indexData,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 3,
                    pointBackgroundColor: '#06b6d4',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        grid: { color: '#2e364f' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });

        const categories = {};
        state.data.forEach(item => {
            let prefix = 'DİĞER';
            if (item.partNo) {
                const match = item.partNo.toUpperCase().match(/^([A-Z]+)/);
                if (match) {
                    prefix = match[1];
                } else {
                    const digitMatch = item.partNo.match(/^([0-9]{2})/);
                    if (digitMatch) {
                        prefix = digitMatch[1] + '...';
                    }
                }
            }

            if (!categories[prefix]) {
                categories[prefix] = [];
            }
            categories[prefix].push(item);
        });

        const catList = Object.keys(categories).map(prefix => {
            const items = categories[prefix];
            const count = items.length;
            
            let ocaSum = 0, ocaCount = 0;
            let currentSum = 0, currentCount = 0;
            
            items.forEach(item => {
                const prices = Object.values(item.prices);
                const startPrice = prices[0] || 0;
                const endPrice = prices[prices.length - 1] || 0;
                
                if (startPrice > 0) {
                    ocaSum += startPrice;
                    ocaCount++;
                }
                if (endPrice > 0) {
                    currentSum += endPrice;
                    currentCount++;
                }
            });

            const ocaAvg = ocaCount > 0 ? ocaSum / ocaCount : 0;
            const currentAvg = currentCount > 0 ? currentSum / currentCount : 0;
            
            let avgChange = 0;
            if (ocaAvg > 0) {
                avgChange = ((currentAvg - ocaAvg) / ocaAvg) * 100;
            }

            return {
                prefix: prefix,
                count: count,
                ocaAvg: ocaAvg,
                currentAvg: currentAvg,
                avgChange: avgChange
            };
        });

        let mainCategories = catList.filter(c => c.count >= 3);
        mainCategories.sort((a, b) => b.count - a.count);

        if (mainCategories.length > 10) {
            mainCategories = mainCategories.slice(0, 10);
        }

        if (categoryIncreaseChart) categoryIncreaseChart.destroy();
        const ctxCat = document.getElementById('chart-category-increase').getContext('2d');
        categoryIncreaseChart = new Chart(ctxCat, {
            type: 'bar',
            data: {
                labels: mainCategories.map(c => c.prefix),
                datasets: [{
                    label: 'Ortalama Artış (%)',
                    data: mainCategories.map(c => c.avgChange),
                    backgroundColor: mainCategories.map(c => c.avgChange >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'),
                    borderColor: mainCategories.map(c => c.avgChange >= 0 ? '#10b981' : '#ef4444'),
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        grid: { color: '#2e364f' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });

        const tableBody = document.getElementById('analytics-category-table-body');
        if (tableBody) {
            tableBody.innerHTML = '';
            catList.sort((a, b) => b.count - a.count).forEach(c => {
                const tr = document.createElement('tr');
                const pctClass = c.avgChange > 0 ? 'price-up' : c.avgChange < 0 ? 'price-down' : 'price-same';
                tr.innerHTML = `
                    <td><strong>${c.prefix}</strong></td>
                    <td>${c.count}</td>
                    <td>${c.ocaAvg > 0 ? formatPrice(c.ocaAvg) : '-'}</td>
                    <td>${c.currentAvg > 0 ? formatPrice(c.currentAvg) : '-'}</td>
                    <td class="${pctClass}">${c.avgChange > 0 ? '+' : ''}${c.avgChange.toFixed(2)}%</td>
                `;
                tableBody.appendChild(tr);
            });
        }
    }

    const analyticsFilter = document.getElementById('analytics-index-filter');
    if (analyticsFilter) {
        analyticsFilter.addEventListener('change', (e) => {
            state.analyticsIndexFilter = e.target.value;
            renderAnalytics();
        });
    }
});
