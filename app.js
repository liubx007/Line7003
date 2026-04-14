// ==========================================
// Security Settings
const CORRECT_PASSWORD = "7003"; 
// ==========================================

const loginOverlay = document.getElementById('loginOverlay');
const mainDashboard = document.getElementById('mainDashboard');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const loadingOverlay = document.getElementById('loadingOverlay');

function attemptLogin() {
    if (passwordInput.value === CORRECT_PASSWORD) {
        loginOverlay.style.display = 'none';
        mainDashboard.style.display = 'flex';
        loadingOverlay.style.display = 'flex'; // Show loading screen
        initializeDashboard(); 
    } else {
        errorMsg.style.display = 'block';
        passwordInput.value = '';
        passwordInput.focus();
    }
}

loginBtn.addEventListener('click', attemptLogin);
passwordInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') attemptLogin(); });

let map, markersLayer, heatLayer = null, userLocationMarker = null;
let allData = [];
let filteredData = [];
let markerRegistry = {}; 

let isColorMode = false;
let isBarMode = false;
let isHeatMode = false;
let isTableMode = false;
let isInitialLoad = true; 

// Sorting State
let currentSortCol = 'id';
let currentSortAsc = true;

function initializeDashboard() {
    // Mobile Detection: Auto-collapse panels on small screens to save map view
    if (window.innerWidth <= 768) {
        document.getElementById('summaryContent').classList.add('collapsed');
        document.getElementById('summaryToggleIcon').classList.add('collapsed');
        document.getElementById('summaryHeader').classList.add('collapsed');
    }

    // Add preferCanvas: true for massive performance gains with 1000s of markers
    map = L.map('map', { preferCanvas: true }).setView([45.5, -62.0], 9);
    
    // Define tile layers for Leaflet
    let standardMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    });
    
    let topoMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri', maxZoom: 19
    });
    
    let satelliteMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri', maxZoom: 19
    });

    // Add default map layer
    standardMap.addTo(map);

    // Create map preview labels (using static tile coordinates for preview images)
    let standardHtml = `<div class="map-preview-card"><img src="https://a.tile.openstreetmap.org/10/335/368.png" alt="Map"><div class="collapsed-badge"><i class="fa-solid fa-layer-group"></i> 图层</div><span class="map-preview-name">Default</span></div>`;
    let topoHtml = `<div class="map-preview-card"><img src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/10/368/335" alt="Topo"><div class="collapsed-badge"><i class="fa-solid fa-layer-group"></i> 图层</div><span class="map-preview-name">Terrain</span></div>`;
    let satHtml = `<div class="map-preview-card"><img src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/368/335" alt="Sat"><div class="collapsed-badge"><i class="fa-solid fa-layer-group"></i> 图层</div><span class="map-preview-name">Satellite</span></div>`;

    // Add map layers control to UI
    let baseMaps = {};
    baseMaps[standardHtml] = standardMap;
    baseMaps[topoHtml] = topoMap;
    baseMaps[satHtml] = satelliteMap;
    
    L.control.layers(baseMaps, null, { collapsed: false }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    setupEventListeners();
    loadData(); 
}

function cleanCoord(str) {
    if (!str) return null;
    let val = String(str).toUpperCase().trim();
    let mult = (val.includes('S') || val.includes('W')) ? -1 : 1;
    let match = val.match(/-?\d+\.\d+/);
    if (match) {
        let n = parseFloat(match[0]);
        if (n > 0 && mult === -1) n = n * -1;
        return n;
    }
    return null;
}

function standardizeSpecies(s) {
    if (!s) return 'Other';
    s = s.trim().toUpperCase();
    if (['RD', 'RP', 'D', 'RED PINE'].includes(s)) return 'Red Pine';
    if (['WRC', 'WRC?', 'CEDER', 'CEDAR'].includes(s)) return 'West Red Cedar';
    if (['YP', 'SYP', 'SOUTH YELLOW PINE'].includes(s)) return 'South Yellow Pine';
    if (['DF', 'D.FIR'].includes(s)) return 'D.Fir';
    return 'Other';
}

function getMarkerColor(pcf) {
    if (!isColorMode && !isBarMode) return "#0052cc"; 
    if (pcf <= 0) return "#919eab"; 
    let ratio = Math.min(pcf, 0.5) / 0.5;
    let hue = 60 - (ratio * 60); 
    return `hsl(${hue}, 100%, 45%)`;
}

function parsePoleId(idStr) {
    let match = idStr.match(/(\d+)(?:\s*\(\s*(\d+)\s*\))?/);
    if (!match) return [999999, 0];
    return [parseInt(match[1], 10), match[2] ? parseInt(match[2], 10) : 0];
}

function loadData() {
    Papa.parse("Line 7003 Final Data.csv", {
        download: true, 
        header: true, 
        skipEmptyLines: true,
        worker: false, // Disabling Web Worker to prevent Cross-Origin CDN blocking errors
        complete: function(results) {
            let rawData = results.data;
            let refLat = null, refLon = null;

            rawData.forEach(row => {
                if (String(row['Structure Number1']).trim() === '324 (2)') {
                    refLat = row['GPS Lat']; refLon = row['GPS Long'];
                }
            });

            let coordOccurrences = {}; 

            rawData.forEach(row => {
                let structNum = String(row['Structure Number1']).trim();
                // Check if structNum needs coordinate override
                if (structNum === '324 (3)' && refLat) {
                    row['GPS Lat'] = refLat; row['GPS Long'] = refLon;
                }

                let lat = cleanCoord(row['GPS Lat']);
                let lon = cleanCoord(row['GPS Long']);
                
                let pcfStr = row['Sawdust Progrqm PCF'];
                let pcfValue = 0;
                if (pcfStr) {
                    let parsed = parseFloat(String(pcfStr).replace(/[^0-9.-]/g, ''));
                    if (!isNaN(parsed)) pcfValue = parsed;
                }

                if (pcfValue !== 0) {
                    row['Preservative3'] = 'Pentachlorophenol';
                }
                
                let finalPreservative = row['Preservative3'] || 'N/A';
                
                let moistureStr = row['Moisture %'] || 'N/A';
                let moistureVal = moistureStr === 'N/A' ? 0.0 : parseFloat(moistureStr) || 0.0;

                if (lat !== null && lon !== null) {
                    let key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
                    if (coordOccurrences[key] !== undefined) {
                        coordOccurrences[key]++;
                        lat += 0.00006 * coordOccurrences[key]; 
                        lon += 0.00006 * coordOccurrences[key];
                    } else {
                        coordOccurrences[key] = 0;
                    }

                    allData.push({
                        original: row,
                        id: structNum,
                        lat: lat,
                        lon: lon,
                        species: standardizeSpecies(row['Wood Species2']),
                        pcf: pcfValue,
                        moisture: moistureStr,
                        moistureValue: moistureVal, // Helper for sorting
                        preservative: finalPreservative
                    });
                }
            });
            renderApplication();
            loadingOverlay.style.display = 'none'; // Hide loading after map renders
            
            // Start Tour if first visit
            if (!localStorage.getItem('dashboardTourShown')) {
                setTimeout(startTour, 300); // Small delay to let map draw visually
            }
        },
        error: function(err, file) {
            loadingOverlay.style.display = 'none';
            alert("Error loading data file ('Line 7003 Final Data.csv'). Please ensure the file exists and you have access permissions.\nDetail: " + err);
        }
    });
}

function setupEventListeners() {
    const pcfMinSlider = document.getElementById('pcfMin');
    const pcfMaxSlider = document.getElementById('pcfMax');
    const pcfMinInput = document.getElementById('pcfMinInput');
    const pcfMaxInput = document.getElementById('pcfMaxInput');

    document.getElementById('speciesFilter').addEventListener('change', renderApplication);
    
    function syncValues(source) {
        let minVal, maxVal;
        
        if (source === 'slider') {
            minVal = parseFloat(pcfMinSlider.value);
            maxVal = parseFloat(pcfMaxSlider.value);
            if(minVal > maxVal) { maxVal = minVal; pcfMaxSlider.value = maxVal; }
            pcfMinInput.value = minVal.toFixed(2);
            pcfMaxInput.value = maxVal.toFixed(2);
        } else if (source === 'input') {
            minVal = parseFloat(pcfMinInput.value);
            if(isNaN(minVal)) minVal = 0;
            
            maxVal = parseFloat(pcfMaxInput.value);
            if(isNaN(maxVal)) maxVal = 1.5;

            if(minVal < 0) minVal = 0;
            if(maxVal > 1.5) maxVal = 1.5;
            if(minVal > maxVal) { maxVal = minVal; pcfMaxInput.value = maxVal.toFixed(2); }
            
            pcfMinSlider.value = minVal;
            pcfMaxSlider.value = maxVal;
        }
        
        renderApplication();
    }

    pcfMinSlider.addEventListener('input', () => syncValues('slider'));
    pcfMaxSlider.addEventListener('input', () => syncValues('slider'));
    
    pcfMinInput.addEventListener('change', () => syncValues('input'));
    pcfMaxInput.addEventListener('change', () => syncValues('input'));
    pcfMinInput.addEventListener('keyup', (e) => { if(e.key === 'Enter') syncValues('input'); });
    pcfMaxInput.addEventListener('keyup', (e) => { if(e.key === 'Enter') syncValues('input'); });

    document.getElementById('summaryHeader').addEventListener('click', function() {
        const content = document.getElementById('summaryContent');
        const icon = document.getElementById('summaryToggleIcon');
        content.classList.toggle('collapsed');
        icon.classList.toggle('collapsed');
        this.classList.toggle('collapsed');
    });

    document.getElementById('resetBtn').addEventListener('click', function() {
        document.getElementById('speciesFilter').value = 'ALL';
        pcfMinSlider.value = '0.00';
        pcfMaxSlider.value = '1.50';
        pcfMinInput.value = '0.00';
        pcfMaxInput.value = '1.50';
        document.getElementById('searchInput').value = '';

        isColorMode = false;
        isBarMode = false;
        isHeatMode = false;
        document.getElementById('colorToggleBtn').classList.remove('active');
        document.getElementById('barChartBtn').classList.remove('active');
        document.getElementById('heatMapBtn').classList.remove('active');
        
        currentSortCol = 'id';
        currentSortAsc = true;
        updateSortIcons();

        isInitialLoad = true;
        renderApplication();
    });

    document.getElementById('colorToggleBtn').addEventListener('click', function() {
        isColorMode = !isColorMode; this.classList.toggle('active'); renderApplication();
    });

    document.getElementById('barChartBtn').addEventListener('click', function() {
        isBarMode = !isBarMode; this.classList.toggle('active'); renderApplication();
    });

    document.getElementById('heatMapBtn').addEventListener('click', function() {
        isHeatMode = !isHeatMode; this.classList.toggle('active'); renderApplication();
    });

    document.getElementById('tableViewBtn').addEventListener('click', function() {
        isTableMode = !isTableMode;
        let mapView = document.getElementById('mapView');
        let tableView = document.getElementById('tableView');
        
        if (isTableMode) {
            this.classList.add('active');
            this.innerHTML = '<i class="fa-solid fa-map"></i>'; 
            this.title = 'Map View';
            mapView.classList.remove('active');
            tableView.classList.add('active');
        } else {
            this.classList.remove('active');
            this.innerHTML = '<i class="fa-solid fa-table"></i>'; 
            this.title = 'Table View';
            tableView.classList.remove('active');
            mapView.classList.add('active');
            map.invalidateSize(); 
        }
    });

    document.getElementById('exportBtn').addEventListener('click', exportData);

    document.getElementById('searchBtn').addEventListener('click', searchPole);
    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchPole();
    });

    document.getElementById('locationBtn').addEventListener('click', function() {
        if (!navigator.geolocation) { alert("Geolocation is not supported by your browser."); return; }
        if(isTableMode) document.getElementById('tableViewBtn').click();

        let originalHTML = this.innerHTML; 
        this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; 
        
        navigator.geolocation.getCurrentPosition(
            function(position) {
                document.getElementById('locationBtn').innerHTML = originalHTML;
                let lat = position.coords.latitude; let lon = position.coords.longitude;
                if (userLocationMarker) map.removeLayer(userLocationMarker);
                
                userLocationMarker = L.circleMarker([lat, lon], { 
                    radius: 7, fillColor: "var(--success)", color: "#ffffff", weight: 2, opacity: 1, fillOpacity: 1, zIndexOffset: 1000 
                }).addTo(map);
                
                userLocationMarker.bindTooltip("Current Location").openTooltip();
                map.flyTo([lat, lon], 14, { duration: 1.5 });
            }, 
            function(error) { document.getElementById('locationBtn').innerHTML = originalHTML; alert("Unable to retrieve location. Please check browser permissions."); }, 
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    });

    // Setup sorting handlers
    document.querySelectorAll('th.sortable-col').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (currentSortCol === col) {
                currentSortAsc = !currentSortAsc;
            } else {
                currentSortCol = col;
                currentSortAsc = true;
            }
            updateSortIcons();
            renderTable();
        });
    });

    // Tour manual trigger
    document.getElementById('tourBtn').addEventListener('click', startTour);
}

function updateSortIcons() {
    document.querySelectorAll('th.sortable-col').forEach(th => {
        th.classList.remove('active-sort');
        const icon = th.querySelector('.sort-icon');
        icon.className = 'fa-solid sort-icon fa-sort'; // default
        
        if (th.getAttribute('data-sort') === currentSortCol) {
            th.classList.add('active-sort');
            icon.className = currentSortAsc ? 'fa-solid sort-icon fa-sort-up' : 'fa-solid sort-icon fa-sort-down';
        }
    });
}

function searchPole() {
    let query = document.getElementById('searchInput').value.trim().toUpperCase();
    if (!query) return;

    let target = filteredData.find(d => d.id.toUpperCase().includes(query));
    if (target) {
        if (isTableMode) document.getElementById('tableViewBtn').click();
        if(markerRegistry[target.id]) {
            let m = markerRegistry[target.id];
            map.flyTo(m.getLatLng(), 18, {duration: 1.0});
            setTimeout(() => m.openPopup(), 1000);
        }
    } else {
        alert("Pole ID not found in current filtered dataset.");
    }
}

function renderApplication() {
    filteredData = [];
    let selectedSpecies = document.getElementById('speciesFilter').value;
    
    let minVal = parseFloat(document.getElementById('pcfMin').value);
    if(isNaN(minVal)) minVal = 0;
    
    let maxVal = parseFloat(document.getElementById('pcfMax').value);
    if(isNaN(maxVal)) maxVal = 1.5;
    
    let isAtMax = (maxVal >= 1.5);
    let totalPcf = 0;

    allData.forEach(data => {
        let matchSp = (selectedSpecies === "ALL" || data.species === selectedSpecies);
        let matchPcf = (data.pcf >= minVal && (isAtMax ? true : data.pcf <= maxVal));

        if (matchSp && matchPcf) {
            filteredData.push(data);
            totalPcf += data.pcf;
        }
    });

    renderMap();
    renderTable();

    let count = filteredData.length;
    document.getElementById('sumTotal').textContent = count;
    document.getElementById('sumAvg').textContent = count > 0 ? (totalPcf / count).toFixed(3) : "0.00";
    
    renderMiniChart();
}

function renderMiniChart() {
    let binCount = 15;
    let bins = new Array(binCount).fill(0);
    let maxPcfScale = 1.5;
    
    filteredData.forEach(d => {
        let binIdx = Math.floor((d.pcf / maxPcfScale) * binCount);
        if (binIdx >= binCount) binIdx = binCount - 1; 
        if (binIdx < 0) binIdx = 0;
        bins[binIdx]++;
    });

    let maxFreq = Math.max(...bins, 1); 
    let chartContainer = document.getElementById('miniChart');
    chartContainer.innerHTML = '';

    bins.forEach((count, idx) => {
        let heightPct = (count / maxFreq) * 100;
        let binStart = ((idx / binCount) * maxPcfScale).toFixed(1);
        
        let bar = document.createElement('div');
        bar.className = 'chart-bar';
        bar.style.height = heightPct + '%';
        bar.title = `PCF ~${binStart}: ${count} poles`;
        
        if (isColorMode && parseFloat(binStart) >= 0.5) {
            bar.style.backgroundColor = 'var(--danger)';
        }

        chartContainer.appendChild(bar);
    });
}

function renderMap() {
    markersLayer.clearLayers();
    if (heatLayer) map.removeLayer(heatLayer);
    markerRegistry = {};
    
    let bounds = [];
    let heatData = [];

    filteredData.forEach(data => {
        let markerColor = getMarkerColor(data.pcf);
        
        let popupHTML = `
            <div class="popup-content">
                <div class="popup-header">Pole ID: ${data.id}</div>
                <div style="margin-bottom: 2px;"><b>Species:</b> ${data.species}</div>
                <div style="margin-bottom: 2px;"><b>Preservative:</b> ${data.preservative}</div>
                <div style="margin-bottom: 2px;"><b>Moisture:</b> ${data.moisture}%</div>
                <div><b>PCF Concentration:</b> <span style="font-weight:600; color:${data.pcf > 0.5 ? '#de3618' : '#202b36'}">${data.pcf}</span></div>
            </div>
        `;

        let marker;
        if (isBarMode && !isHeatMode) {
            let h = Math.max((data.pcf / 1.0) * 80, 5); 
            let barHtml = `
                <div style="width:10px; height:${h}px; background-color:${markerColor}; 
                box-shadow: 2px 2px 4px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.6); border-bottom: 1px solid #333;"></div>
            `;
            let barIcon = L.divIcon({ html: barHtml, className: '', iconSize: [10, h], iconAnchor: [5, h], popupAnchor: [0, -h] });
            marker = L.marker([data.lat, data.lon], { icon: barIcon });
        } else if (!isHeatMode) {
            marker = L.circleMarker([data.lat, data.lon], { radius: 5, fillColor: markerColor, color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.85 });
            marker.on('mouseover', function () { this.setStyle({ radius: 7, weight: 2 }); });
            marker.on('mouseout', function () { this.setStyle({ radius: 5, weight: 1 }); });
        }

        if (!isHeatMode) {
            marker.bindPopup(popupHTML);
            marker.bindTooltip(data.id, { direction: 'top', offset: [0, isBarMode ? -10 : -5] });
            markersLayer.addLayer(marker);
            markerRegistry[data.id] = marker;
        }

        bounds.push([data.lat, data.lon]);
        
        if (isHeatMode) {
            let intensity = Math.min(data.pcf / 1.0, 1.0);
            heatData.push([data.lat, data.lon, intensity]);
        }
    });

    if (isHeatMode && heatData.length > 0) {
        heatLayer = L.heatLayer(heatData, {
            radius: 18, blur: 12, maxZoom: 14, 
            gradient: {0.2: '#0052cc', 0.4: '#00a3bf', 0.6: '#57d9a3', 0.8: '#ffc400', 1.0: '#de3618'}
        }).addTo(map);
    }

    if (isInitialLoad && bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        isInitialLoad = false; 
    }
}

function renderTable() {
    let tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';
    
    let sortedData = [...filteredData].sort((a, b) => {
        let valA, valB;
        if (currentSortCol === 'id') {
            let aParsed = parsePoleId(a.id);
            let bParsed = parsePoleId(b.id);
            if (aParsed[0] !== bParsed[0]) {
                valA = aParsed[0]; valB = bParsed[0];
            } else {
                valA = aParsed[1]; valB = bParsed[1];
            }
        } else if (currentSortCol === 'moisture') {
            valA = a.moistureValue; valB = b.moistureValue;
        } else {
            valA = a[currentSortCol]; valB = b[currentSortCol];
        }

        if (valA < valB) return currentSortAsc ? -1 : 1;
        if (valA > valB) return currentSortAsc ? 1 : -1;
        return 0;
    });

    sortedData.forEach(data => {
        let tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = function() {
            document.getElementById('tableViewBtn').click(); 
            if(markerRegistry[data.id]) {
                map.flyTo([data.lat, data.lon], 17, {duration: 0.8});
                setTimeout(() => markerRegistry[data.id].openPopup(), 800);
            }
        };
        
        let pcfStyle = data.pcf > 0.5 ? 'class="val-danger"' : '';
        
        tr.innerHTML = `
            <td style="font-weight:600; color:var(--primary);">${data.id}</td>
            <td>${data.species}</td>
            <td>${data.moisture}</td>
            <td>${data.preservative}</td>
            <td ${pcfStyle}>${data.pcf.toFixed(3)}</td>
            <td style="color:var(--text-muted); font-size: 10px;">${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function exportData() {
    if (filteredData.length === 0) return alert("No data to export.");
    let exportArr = filteredData.map(d => d.original);
    let csv = Papa.unparse(exportArr);
    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Line_7003_Export.csv";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// Initial sorting icon update
updateSortIcons();

// ==========================================
// Tour Feature
// ==========================================
function startTour() {
    localStorage.setItem('dashboardTourShown', 'true'); // Save immediately when started
    const driver = window.driver.js.driver;
    const driverObj = driver({
        showProgress: true,
        steps: [
            { element: '#searchGroup', popover: { title: 'Search Poles', description: 'Quickly find a specific pole by typing its ID here.', side: "bottom", align: 'start' } },
            { element: '#filterGroup', popover: { title: 'Refine Data', description: 'Filter the visible poles by Wood Species and PCF Concentration.', side: "bottom", align: 'start' } },
            { element: '#vizGroup', popover: { title: 'Map Visualizations', description: 'Toggle between Gradients, 3D Bars, and Heatmaps.', side: "bottom", align: 'start' } }
        ]
    });
    driverObj.drive();
}
