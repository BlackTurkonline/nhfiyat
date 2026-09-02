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
        view: 'all', // all, changed, extremes, analytics, upload, price-search
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
        monthlyChanges: {},
        // Price search states
        priceSearchQuery: '',
        searchSites: [],
        selectedSearchSites: new Set(),
        searchInProgress: false,
        priceSearchInitialized: false,
        // Sales dashboard states
        salesSearchQuery: '',
        salesSelectedCity: '',
        salesCurrentPage: 1,
        salesItemsPerPage: 50,
        salesTab: 'customers',
        salesSelectedYear: 'all'
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
        const priceSearchView = document.getElementById('price-search-view');
        if (priceSearchView) priceSearchView.classList.remove('active');
        const salesView = document.getElementById('sales-view');
        if (salesView) salesView.classList.remove('active');

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
        } else if (state.view === 'price-search') {
            if (searchBarContainer) searchBarContainer.style.display = 'none';
            if (priceSearchView) {
                priceSearchView.classList.add('active');
                initPriceSearchView();
            }
        } else if (state.view === 'sales') {
            if (searchBarContainer) searchBarContainer.style.display = 'none';
            const salesView = document.getElementById('sales-view');
            if (salesView) {
                salesView.classList.add('active');
                renderSales();
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

    // Price Search Implementation
    function initPriceSearchView() {
        if (!state.priceSearchInitialized) {
            state.priceSearchInitialized = true;
            bindPriceSearchEvents();
        }
        loadSearchSites();
    }

    function bindPriceSearchEvents() {
        const btnSearch = document.getElementById('btn-price-search-submit');
        const inputSearch = document.getElementById('price-search-input');
        const btnManage = document.getElementById('btn-manage-search-sites');
        const modal = document.getElementById('search-sites-modal');
        const btnCloseModal = document.getElementById('btn-close-sites-modal');
        const backdropModal = document.getElementById('sites-modal-backdrop');
        const siteForm = document.getElementById('search-site-form');
        const btnCancelForm = document.getElementById('btn-cancel-site-form');
        const btnToggleRegex = document.getElementById('btn-toggle-advanced-regex');
        const regexFieldsDiv = document.getElementById('advanced-regex-fields');

        if (btnToggleRegex && regexFieldsDiv) {
            btnToggleRegex.addEventListener('click', () => {
                if (regexFieldsDiv.style.display === 'none') {
                    regexFieldsDiv.style.display = 'flex';
                } else {
                    regexFieldsDiv.style.display = 'none';
                }
            });
        }

        if (btnSearch) {
            btnSearch.addEventListener('click', () => {
                const query = inputSearch.value.trim();
                performPriceSearch(query);
            });
        }

        if (inputSearch) {
            inputSearch.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const query = inputSearch.value.trim();
                    performPriceSearch(query);
                }
            });
        }

        if (btnManage && modal) {
            btnManage.addEventListener('click', () => {
                modal.style.display = 'flex';
                resetSiteForm();
                renderSitesTable();
            });
        }

        if (btnCloseModal && modal) {
            btnCloseModal.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }

        if (backdropModal && modal) {
            backdropModal.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }

        if (siteForm) {
            siteForm.addEventListener('submit', (e) => {
                e.preventDefault();
                saveSearchSite();
            });
        }

        if (btnCancelForm) {
            btnCancelForm.addEventListener('click', () => {
                resetSiteForm();
            });
        }
    }

    function loadSearchSites() {
        fetch('/api/sites')
            .then(res => res.json())
            .then(sites => {
                state.searchSites = sites;
                if (state.selectedSearchSites.size === 0) {
                    sites.forEach(s => state.selectedSearchSites.add(s.id));
                }
                renderSitesChecklist();
                renderSitesTable();
            })
            .catch(err => {
                console.error("Arama siteleri yuklenirken hata, varsayilan yukleniyor:", err);
                const fallbackSites = [
                    {
                        "id": "traktoryedekparcalari",
                        "name": "traktoryedekparcalari.net",
                        "search_url": "https://www.traktoryedekparcalari.net/arama?k={query}",
                        "card_regex": "<div class=\"card-product\">.*?</div>\\s*</div>\\s*</div>",
                        "title_regex": "<div class=\"title\">\\s*(.*?)\\s*</div>",
                        "price_regex": "<div class=\"sale-price\\s*[^\"]*\">\\s*(.*?)\\s*</div>",
                        "link_regex": "<a href=\"([^\"]+)\" class=\"c-p-i-link\"",
                        "base_url": "https://www.traktoryedekparcalari.net"
                    }
                ];
                state.searchSites = fallbackSites;
                if (state.selectedSearchSites.size === 0) {
                    fallbackSites.forEach(s => state.selectedSearchSites.add(s.id));
                }
                renderSitesChecklist();
                renderSitesTable();
            });
    }

    function renderSitesChecklist() {
        const container = document.getElementById('search-sites-checklist');
        if (!container) return;
        
        container.innerHTML = '';
        state.searchSites.forEach(site => {
            const label = document.createElement('label');
            const checked = state.selectedSearchSites.has(site.id) ? 'checked' : '';
            label.innerHTML = `
                <input type="checkbox" data-id="${site.id}" ${checked}>
                <span>${site.name}</span>
            `;
            const cb = label.querySelector('input');
            cb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    state.selectedSearchSites.add(site.id);
                } else {
                    state.selectedSearchSites.delete(site.id);
                }
            });
            container.appendChild(label);
        });
    }

    function renderSitesTable() {
        const tbody = document.getElementById('sites-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        if (state.searchSites.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 15px; color: var(--text-muted);">Kayıtlı site bulunamadı.</td></tr>';
            return;
        }

        state.searchSites.forEach(site => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 10px 15px; border-bottom: 1px solid var(--border-color);"><strong>${site.name}</strong></td>
                <td style="padding: 10px 15px; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 0.8rem; word-break: break-all;">${site.search_url}</td>
                <td style="padding: 10px 15px; border-bottom: 1px solid var(--border-color); text-align: right; display: flex; gap: 8px; justify-content: flex-end; align-items: center; min-height: 44px;">
                    <button class="edit-site-btn" type="button" style="background: rgba(59,130,246,0.15); color: #3b82f6; border: 1px solid rgba(59,130,246,0.3); padding: 5px 10px; border-radius: 4px; font-size: 0.78rem; cursor: pointer;">Düzenle</button>
                    <button class="delete-site-btn" type="button" style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); padding: 5px 10px; border-radius: 4px; font-size: 0.78rem; cursor: pointer;">Sil</button>
                </td>
            `;

            tr.querySelector('.edit-site-btn').addEventListener('click', () => {
                editSearchSite(site);
            });

            tr.querySelector('.delete-site-btn').addEventListener('click', () => {
                if (confirm(`"${site.name}" sitesini silmek istediğinize emin misiniz?`)) {
                    deleteSearchSite(site.id);
                }
            });

            tbody.appendChild(tr);
        });
    }

    function editSearchSite(site) {
        document.getElementById('site-id').value = site.id || '';
        document.getElementById('site-name').value = site.name || '';
        document.getElementById('site-base-url').value = site.base_url || '';
        document.getElementById('site-search-url').value = site.search_url || '';
        document.getElementById('site-card-regex').value = site.card_regex || '';
        document.getElementById('site-title-regex').value = site.title_regex || '';
        document.getElementById('site-price-regex').value = site.price_regex || '';
        document.getElementById('site-link-regex').value = site.link_regex || '';

        const regexFieldsDiv = document.getElementById('advanced-regex-fields');
        if (regexFieldsDiv) regexFieldsDiv.style.display = 'none';

        document.getElementById('site-form-title').innerText = 'Siteyi Güncelle';
    }

    function resetSiteForm() {
        document.getElementById('site-id').value = '';
        document.getElementById('site-name').value = '';
        document.getElementById('site-base-url').value = '';
        document.getElementById('site-search-url').value = '';
        document.getElementById('site-card-regex').value = '';
        document.getElementById('site-title-regex').value = '';
        document.getElementById('site-price-regex').value = '';
        document.getElementById('site-link-regex').value = '';

        const regexFieldsDiv = document.getElementById('advanced-regex-fields');
        if (regexFieldsDiv) regexFieldsDiv.style.display = 'none';

        document.getElementById('site-form-title').innerText = 'Yeni Site Ekle';
    }

    function saveSearchSite() {
        const siteData = {
            id: document.getElementById('site-id').value || undefined,
            name: document.getElementById('site-name').value.trim(),
            base_url: document.getElementById('site-base-url').value.trim(),
            search_url: document.getElementById('site-search-url').value.trim(),
            card_regex: document.getElementById('site-card-regex').value,
            title_regex: document.getElementById('site-title-regex').value,
            price_regex: document.getElementById('site-price-regex').value,
            link_regex: document.getElementById('site-link-regex').value
        };

        fetch('/api/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(siteData)
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === 'success') {
                resetSiteForm();
                loadSearchSites();
            } else {
                alert('Hata: ' + res.message);
            }
        })
        .catch(err => {
            alert('Site kaydedilemedi: ' + err);
        });
    }

    function deleteSearchSite(siteId) {
        fetch(`/api/sites?id=${siteId}`, {
            method: 'DELETE'
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === 'success') {
                loadSearchSites();
            } else {
                alert('Hata: ' + res.message);
            }
        })
        .catch(err => {
            alert('Site silinemedi: ' + err);
        });
    }

    function performPriceSearch(query) {
        if (!query) {
            alert('Lütfen aramak istediğiniz parça numarasını girin.');
            return;
        }

        const selectedIds = state.searchSites.map(s => s.id);
        if (selectedIds.length === 0) {
            alert('Lütfen arama yapmak için en az bir site ekleyin.');
            return;
        }

        const resultsContainer = document.getElementById('price-search-results');
        if (!resultsContainer) return;

        resultsContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem; gap: 1rem; border: 1px solid var(--border-color); border-radius: 8px; background: rgba(255,255,255,0.01);">
                <svg class="spinner-icon" stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" height="3em" width="3em" xmlns="http://www.w3.org/2000/svg" style="color: var(--warning);"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
                <div style="color: var(--text-muted); font-size: 0.95rem;">Tüm kayıtlı siteler sorgulanıyor, lütfen bekleyin...</div>
            </div>
        `;
        state.searchInProgress = true;

        const siteIdsParam = selectedIds.join(',');
        fetch(`/api/search?query=${encodeURIComponent(query)}&site_ids=${siteIdsParam}`)
            .then(res => res.json())
            .then(data => {
                state.searchInProgress = false;
                
                let allItems = [];
                
                selectedIds.forEach(id => {
                    const siteResult = data.results && data.results[id];
                    if (siteResult && siteResult.success && siteResult.items) {
                        siteResult.items.forEach(item => {
                            let sourceSite = '';
                            if (id === 'google_search') {
                                try {
                                    sourceSite = new URL(item.link).hostname.replace('www.', '');
                                } catch(e) {
                                    sourceSite = 'Google Araması';
                                }
                            } else {
                                const site = state.searchSites.find(s => s.id === id);
                                sourceSite = site ? site.name : id;
                            }
                            
                            let cleanTitle = item.title;
                            if (cleanTitle.startsWith('[')) {
                                const closeBracket = cleanTitle.indexOf(']');
                                if (closeBracket !== -1) {
                                    cleanTitle = cleanTitle.substring(closeBracket + 1).trim();
                                }
                            }
                            
                            allItems.push({
                                title: cleanTitle,
                                price: item.price,
                                link: item.link,
                                source: sourceSite
                            });
                        });
                    }
                });
                
                if (allItems.length === 0) {
                    resultsContainer.innerHTML = `
                        <div class="site-result-card" style="padding: 2.5rem; text-align: center; color: var(--text-muted); font-size: 1rem;">
                            🔍 Aradığınız parça seçilen sitelerin hiçbirinde bulunamadı.
                        </div>
                    `;
                    return;
                }
                
                // Sort items by price (cheapest first)
                allItems.sort((a, b) => {
                    const getNum = (str) => {
                        let clean = str.replace(/[^\d\.,]/g, '');
                        if (!clean) return 99999999;
                        if (clean.includes('.') && clean.includes(',')) {
                            clean = clean.replace(/\./g, '').replace(/,/g, '.');
                        } else if (clean.includes(',')) {
                            clean = clean.replace(/,/g, '.');
                        }
                        const n = parseFloat(clean);
                        return isNaN(n) ? 99999999 : n;
                    };
                    return getNum(a.price) - getNum(b.price);
                });

                let tableHTML = `
                    <div class="site-result-card" style="padding: 0; overflow: hidden; border: 1px solid var(--border-color); border-radius: 8px;">
                        <div style="padding: 15px 20px; border-bottom: 1px solid var(--border-color); background: rgba(255,255,255,0.02); display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin: 0; font-size: 1rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                                📊 Fiyat Karşılaştırma Sonuçları
                            </h3>
                            <span style="font-size: 0.85rem; color: var(--text-muted);">${allItems.length} Ürün Bulundu</span>
                        </div>
                        <div style="overflow-x: auto;">
                            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                                <thead style="background: rgba(255,255,255,0.01); border-bottom: 1px solid var(--border-color);">
                                    <tr>
                                        <th style="padding: 12px 20px; color: var(--text-muted); font-weight: 500;">Parça Adı</th>
                                        <th style="padding: 12px 20px; color: var(--text-muted); font-weight: 500;">Bulunduğu Site</th>
                                        <th style="padding: 12px 20px; color: var(--text-muted); font-weight: 500;">Fiyatı</th>
                                        <th style="padding: 12px 20px; color: var(--text-muted); font-weight: 500; text-align: right;">Detaylar</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                allItems.forEach(item => {
                    tableHTML += `
                        <tr style="border-bottom: 1px solid var(--border-color); background: transparent;">
                            <td style="padding: 12px 20px;"><strong>${item.title}</strong></td>
                            <td style="padding: 12px 20px;">
                                <span style="background: rgba(255,255,255,0.04); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; color: var(--text-muted); border: 1px solid var(--border-color); font-weight: 500;">
                                    ${item.source}
                                </span>
                            </td>
                            <td style="padding: 12px 20px; color: var(--success); font-weight: 600; font-size: 0.95rem;">${item.price}</td>
                            <td style="padding: 12px 20px; text-align: right;">
                                <a href="${item.link}" target="_blank" class="site-result-link" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.85rem; text-decoration: none; color: var(--accent); font-weight: 500;">
                                    Git
                                    <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                </a>
                            </td>
                        </tr>
                    `;
                });
                
                tableHTML += `
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
                resultsContainer.innerHTML = tableHTML;
            })
            .catch(err => {
                state.searchInProgress = false;
                resultsContainer.innerHTML = `
                    <div class="site-result-card" style="padding: 2.5rem; text-align: center; color: var(--danger); font-size: 1rem;">
                        ⚠️ Arama yapılırken bir hata oluştu: ${err.message || err}
                    </div>
                `;
            });
    }

    // ========================================================
    // SALES DASHBOARD CORE FUNCTIONS
    // ========================================================
    let salesInitialized = false;
    let salesMonthlyChart = null;
    let salesCityChart = null;

    function renderSales() {
        const salesView = document.getElementById('sales-view');
        const emptyState = document.getElementById('sales-empty-state');
        const contentWrap = document.getElementById('sales-content-wrap');

        if (!salesView) return;

        // Check if salesData is defined and has invoices
        if (typeof salesData === 'undefined' || !salesData.invoices || salesData.invoices.length === 0) {
            emptyState.style.display = 'block';
            contentWrap.style.display = 'none';
            return;
        } else {
            emptyState.style.display = 'none';
            contentWrap.style.display = 'block';
        }

        // Initialize Year selector dropdown
        const yearSelect = document.getElementById('sales-year-select');
        if (yearSelect && yearSelect.options.length <= 1) {
            // Extract unique years
            const yearsSet = new Set();
            salesData.invoices.forEach(inv => {
                const date = inv[1]; // YYYY-MM-DD
                if (date && date.length >= 4) {
                    yearsSet.add(date.substring(0, 4));
                }
            });
            const sortedYears = Array.from(yearsSet).sort().reverse(); // Decending
            sortedYears.forEach(yr => {
                const opt = document.createElement('option');
                opt.value = yr;
                opt.textContent = yr + " Yılı";
                yearSelect.appendChild(opt);
            });
            
            // Set current value
            yearSelect.value = state.salesSelectedYear;
            
            // Add change listener
            yearSelect.addEventListener('change', (e) => {
                state.salesSelectedYear = e.target.value;
                state.salesCurrentPage = 1;
                renderSales();
            });
        }

        // Filter invoices by year
        let filteredByYearInvoices = salesData.invoices;
        if (state.salesSelectedYear !== 'all') {
            filteredByYearInvoices = salesData.invoices.filter(inv => inv[1].startsWith(state.salesSelectedYear));
        }

        // 1. Calculate and update summary stats based on filteredByYearInvoices
        let totalRevenue = 0;
        let invoiceCount = filteredByYearInvoices.length;
        let customerCodes = new Set();
        
        filteredByYearInvoices.forEach(inv => {
            totalRevenue += inv[5]; // GenelToplam is index 5
            customerCodes.add(inv[2]); // CariKodu is index 2
        });
        
        let avgInvoiceValue = invoiceCount > 0 ? totalRevenue / invoiceCount : 0;
        let activeCustomers = customerCodes.size;

        // Update DOM elements
        document.getElementById('sales-stat-total-revenue').textContent = totalRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
        document.getElementById('sales-stat-invoice-count').textContent = invoiceCount.toLocaleString('tr-TR');
        document.getElementById('sales-stat-average-value').textContent = avgInvoiceValue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
        document.getElementById('sales-stat-customer-count').textContent = activeCustomers.toLocaleString('tr-TR');

        // 2. Aggregate Data dynamically for charts and tables
        
        // A. Monthly aggregation
        const monthlyGroups = {};
        filteredByYearInvoices.forEach(inv => {
            const ym = inv[1].substring(0, 7); // YYYY-MM
            if (!monthlyGroups[ym]) {
                monthlyGroups[ym] = { revenue: 0, count: 0 };
            }
            monthlyGroups[ym].revenue += inv[5];
            monthlyGroups[ym].count += 1;
        });

        // If a specific year is selected, fill in any missing months with 0s to make the chart look nice
        if (state.salesSelectedYear !== 'all') {
            for (let m = 1; m <= 12; m++) {
                const mStr = m.toString().padStart(2, '0');
                const ym = `${state.salesSelectedYear}-${mStr}`;
                if (!monthlyGroups[ym]) {
                    monthlyGroups[ym] = { revenue: 0, count: 0 };
                }
            }
        }

        const sortedMonths = Object.keys(monthlyGroups).sort();
        const monthlyLabels = sortedMonths.map(ym => {
            // Convert "YYYY-MM" to Turkish month name or abbreviation
            const parts = ym.split('-');
            const year = parts[0];
            const monthVal = parseInt(parts[1], 10);
            const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
            const mName = monthNames[monthVal - 1];
            return state.salesSelectedYear === 'all' ? `${mName} ${year}` : mName;
        });
        const monthlyRevenues = sortedMonths.map(ym => monthlyGroups[ym].revenue);
        const monthlyCounts = sortedMonths.map(ym => monthlyGroups[ym].count);

        if (salesMonthlyChart) salesMonthlyChart.destroy();
        const ctxMonthly = document.getElementById('chart-sales-monthly').getContext('2d');
        salesMonthlyChart = new Chart(ctxMonthly, {
            type: 'bar',
            data: {
                labels: monthlyLabels,
                datasets: [
                    {
                        label: 'Ciro (TL)',
                        data: monthlyRevenues,
                        backgroundColor: 'rgba(99, 102, 241, 0.6)',
                        borderColor: '#6366f1',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Fatura Adedi',
                        data: monthlyCounts,
                        type: 'line',
                        borderColor: '#10b981',
                        backgroundColor: 'transparent',
                        borderWidth: 3,
                        pointBackgroundColor: '#10b981',
                        tension: 0.3,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: function(value) {
                                if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M TL';
                                if (value >= 1e3) return (value / 1e3).toFixed(0) + 'K TL';
                                return value + ' TL';
                            }
                        }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: '#f1f5f9' }
                    }
                }
            }
        });

        // B. City distribution (Top 10)
        const cityGroups = {};
        filteredByYearInvoices.forEach(inv => {
            const city = inv[4] || 'BELİRSİZ';
            if (!cityGroups[city]) {
                cityGroups[city] = { revenue: 0, count: 0 };
            }
            cityGroups[city].revenue += inv[5];
            cityGroups[city].count += 1;
        });

        const sortedCities = Object.keys(cityGroups).map(city => ({
            city: city,
            revenue: cityGroups[city].revenue,
            count: cityGroups[city].count
        })).sort((a, b) => b.revenue - a.revenue);

        const topCities = sortedCities.slice(0, 10);
        const cityLabels = topCities.map(c => c.city);
        const cityRevenues = topCities.map(c => c.revenue);

        if (salesCityChart) salesCityChart.destroy();
        const ctxCity = document.getElementById('chart-sales-city').getContext('2d');
        salesCityChart = new Chart(ctxCity, {
            type: 'bar',
            data: {
                labels: cityLabels,
                datasets: [{
                    label: 'Toplam Ciro (TL)',
                    data: cityRevenues,
                    backgroundColor: 'rgba(6, 182, 212, 0.7)',
                    borderColor: '#06b6d4',
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: function(value) {
                                if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M TL';
                                if (value >= 1e3) return (value / 1e3).toFixed(0) + 'K TL';
                                return value + ' TL';
                            }
                        }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });

        // 3. Populate City Dropdown Filter dynamics
        const cityFilter = document.getElementById('sales-invoice-filter-city');
        if (cityFilter) {
            // Keep the selected value
            const currentSelectedCity = state.salesSelectedCity;
            
            // Clear all options except the first one
            cityFilter.innerHTML = '<option value="">Tüm Şehirler</option>';
            
            sortedCities.forEach(c => {
                if (c.city) {
                    const opt = document.createElement('option');
                    opt.value = c.city;
                    opt.textContent = c.city + ` (${c.revenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL)`;
                    cityFilter.appendChild(opt);
                }
            });
            
            // Restore selection if valid, else reset
            if (cityGroups[currentSelectedCity]) {
                cityFilter.value = currentSelectedCity;
            } else {
                state.salesSelectedCity = '';
                cityFilter.value = '';
            }
        }

        // C. Customer Leaderboard aggregation (Top 100)
        const customerGroups = {};
        filteredByYearInvoices.forEach(inv => {
            const key = inv[2] + '|||' + inv[3]; // CariKodu + TicariUnvan
            if (!customerGroups[key]) {
                customerGroups[key] = { revenue: 0, count: 0 };
            }
            customerGroups[key].revenue += inv[5];
            customerGroups[key].count += 1;
        });

        const sortedCustomers = Object.keys(customerGroups).map(key => {
            const parts = key.split('|||');
            return {
                code: parts[0],
                name: parts[1],
                revenue: customerGroups[key].revenue,
                count: customerGroups[key].count
            };
        }).sort((a, b) => b.revenue - a.revenue).slice(0, 100);

        // Save current Top Customers for rendering
        state.currentTopCustomers = sortedCustomers;

        // Initialize Tab Event Listeners once
        if (!salesInitialized) {
            salesInitialized = true;
            
            // Tab Toggles
            const tabCustomers = document.getElementById('btn-sales-tab-customers');
            const tabInvoices = document.getElementById('btn-sales-tab-invoices');
            const contentCustomers = document.getElementById('sales-tab-content-customers');
            const contentInvoices = document.getElementById('sales-tab-content-invoices');

            if (tabCustomers && tabInvoices) {
                tabCustomers.addEventListener('click', () => {
                    tabCustomers.classList.add('active');
                    tabCustomers.style.background = 'var(--panel-bg)';
                    tabCustomers.style.borderColor = 'var(--border-color)';
                    tabCustomers.style.color = '#fff';

                    tabInvoices.classList.remove('active');
                    tabInvoices.style.background = 'transparent';
                    tabInvoices.style.borderColor = 'transparent';
                    tabInvoices.style.color = 'var(--text-muted)';

                    contentCustomers.style.display = 'block';
                    contentInvoices.style.display = 'none';
                    state.salesTab = 'customers';
                });

                tabInvoices.addEventListener('click', () => {
                    tabInvoices.classList.add('active');
                    tabInvoices.style.background = 'var(--panel-bg)';
                    tabInvoices.style.borderColor = 'var(--border-color)';
                    tabInvoices.style.color = '#fff';

                    tabCustomers.classList.remove('active');
                    tabCustomers.style.background = 'transparent';
                    tabCustomers.style.borderColor = 'transparent';
                    tabCustomers.style.color = 'var(--text-muted)';

                    contentInvoices.style.display = 'block';
                    contentCustomers.style.display = 'none';
                    state.salesTab = 'invoices';
                    renderSalesInvoices();
                });
            }

            // Invoices Filters Listeners
            const invoiceSearch = document.getElementById('sales-invoice-search');
            if (invoiceSearch) {
                invoiceSearch.addEventListener('input', (e) => {
                    state.salesSearchQuery = e.target.value.toLowerCase().trim();
                    state.salesCurrentPage = 1;
                    renderSalesInvoices();
                });
            }

            if (cityFilter) {
                cityFilter.addEventListener('change', (e) => {
                    state.salesSelectedCity = e.target.value;
                    state.salesCurrentPage = 1;
                    renderSalesInvoices();
                });
            }

            const clearBtn = document.getElementById('btn-sales-invoice-clear-filters');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    if (invoiceSearch) invoiceSearch.value = '';
                    if (cityFilter) cityFilter.value = '';
                    state.salesSearchQuery = '';
                    state.salesSelectedCity = '';
                    state.salesCurrentPage = 1;
                    renderSalesInvoices();
                });
            }

            // Invoices Pagination Listeners
            const prevBtn = document.getElementById('btn-sales-invoice-prev');
            const nextBtn = document.getElementById('btn-sales-invoice-next');

            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    if (state.salesCurrentPage > 1) {
                        state.salesCurrentPage--;
                        renderSalesInvoices();
                    }
                });
            }

            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    const filteredInvoices = getFilteredInvoices();
                    const maxPage = Math.ceil(filteredInvoices.length / state.salesItemsPerPage);
                    if (state.salesCurrentPage < maxPage) {
                        state.salesCurrentPage++;
                        renderSalesInvoices();
                    }
                });
            }
        }

        // Render Tab contents
        renderSalesCustomers();
        if (state.salesTab === 'invoices') {
            renderSalesInvoices();
        }
    }

    function renderSalesCustomers() {
        const tbody = document.getElementById('sales-customers-table-body');
        if (!tbody || !state.currentTopCustomers) return;

        tbody.innerHTML = '';
        state.currentTopCustomers.forEach((cust, index) => {
            const tr = document.createElement('tr');
            
            const avgVal = cust.count > 0 ? cust.revenue / cust.count : 0;
            
            tr.innerHTML = `
                <td style="text-align: center; font-weight: 600; color: ${index < 3 ? 'var(--warning)' : 'var(--text-muted)'}">${index + 1}</td>
                <td style="font-family: monospace; font-size: 0.85rem;">${cust.code}</td>
                <td style="font-weight: 500;">${cust.name}</td>
                <td style="text-align: right;">${cust.count.toLocaleString('tr-TR')}</td>
                <td style="text-align: right;">${avgVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</td>
                <td style="text-align: right; font-weight: 600; color: #6366f1;">${cust.revenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function getFilteredInvoices() {
        if (!salesData.invoices) return [];
        
        // First filter by year
        let yearFiltered = salesData.invoices;
        if (state.salesSelectedYear !== 'all') {
            yearFiltered = salesData.invoices.filter(inv => inv[1].startsWith(state.salesSelectedYear));
        }

        return yearFiltered.filter(inv => {
            const faturaNo = inv[0].toLowerCase();
            const cariKodu = inv[2].toLowerCase();
            const unvan = inv[3].toLowerCase();
            const sehir = inv[4];

            if (state.salesSelectedCity && sehir !== state.salesSelectedCity) {
                return false;
            }

            if (state.salesSearchQuery) {
                const match = faturaNo.includes(state.salesSearchQuery) || 
                              cariKodu.includes(state.salesSearchQuery) || 
                              unvan.includes(state.salesSearchQuery);
                if (!match) return false;
            }

            return true;
        });
    }

    function renderSalesInvoices() {
        const tbody = document.getElementById('sales-invoices-table-body');
        const pageInfo = document.getElementById('sales-invoice-page-info');
        if (!tbody) return;

        tbody.innerHTML = '';
        const filtered = getFilteredInvoices();
        
        const start = (state.salesCurrentPage - 1) * state.salesItemsPerPage;
        const end = start + state.salesItemsPerPage;
        const pageData = filtered.slice(start, end);

        if (pageData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 2rem;">Arama kriterlerine uygun fatura bulunamadı.</td></tr>`;
            if (pageInfo) pageInfo.textContent = 'Sayfa 0 / 0';
            return;
        }

        pageData.forEach(inv => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 500; color: #fff;">${inv[0]}</td>
                <td style="color: var(--text-muted); font-size: 0.85rem;">${inv[1]}</td>
                <td style="font-family: monospace; font-size: 0.85rem; color: var(--text-muted);">${inv[2]}</td>
                <td style="font-weight: 500;">${inv[3]}</td>
                <td><span class="status-badge" style="background: rgba(255,255,255,0.05); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--border-color);">${inv[4]}</span></td>
                <td style="text-align: right; font-weight: 600; color: #10b981;">${inv[5].toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</td>
            `;
            tbody.appendChild(tr);
        });

        const maxPage = Math.ceil(filtered.length / state.salesItemsPerPage);
        if (pageInfo) {
            pageInfo.textContent = `Sayfa ${state.salesCurrentPage} / ${maxPage} (Toplam ${filtered.length.toLocaleString('tr-TR')} fatura)`;
        }
    }
});
