const API_URL = '/api';

// --- CITIZEN AUTHENTICATION ---
let citizenToken = localStorage.getItem('citizenToken');
let userId = localStorage.getItem('civic_user_id');

function checkCitizenAuth() {
    if (citizenToken && userId) {
        document.getElementById('view-citizen-login').classList.remove('active');
        document.getElementById('view-report').classList.add('active');
        document.querySelector('.bottom-nav').style.display = 'flex';
        document.getElementById('citizen-logout-view').style.display = 'block';
        fetchCivicScore();
        fetchNotifications();
    } else {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-citizen-login').classList.add('active');
        document.querySelector('.bottom-nav').style.display = 'none';
        document.getElementById('citizen-logout-view').style.display = 'none';
    }
}

let currentLoginMethod = 'phone'; // 'phone' or 'email'

window.switchLoginTab = function(method) {
    currentLoginMethod = method;
    if (method === 'phone') {
        document.getElementById('tab-phone').classList.add('active-tab');
        document.getElementById('tab-email').classList.remove('active-tab');
        document.getElementById('input-phone-group').style.display = 'block';
        document.getElementById('input-email-group').style.display = 'none';
    } else {
        document.getElementById('tab-email').classList.add('active-tab');
        document.getElementById('tab-phone').classList.remove('active-tab');
        document.getElementById('input-email-group').style.display = 'block';
        document.getElementById('input-phone-group').style.display = 'none';
    }
}

window.sendOtp = async function() {
    let identifier = '';
    let phone = null;
    let email = null;
    
    if (currentLoginMethod === 'phone') {
        identifier = document.getElementById('citizen-phone').value;
        if (!identifier) return alert('Enter a mobile number');
        phone = identifier;
    } else {
        identifier = document.getElementById('citizen-email').value;
        if (!identifier) return alert('Enter an email address');
        email = identifier;
    }
    
    document.getElementById('btn-send-otp').textContent = 'Sending...';
    
    try {
        const res = await fetch(`${API_URL}/request_otp`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({phone, email})
        });
        
        if (res.ok) {
            document.getElementById('btn-send-otp').style.display = 'none';
            document.getElementById('otp-group').style.display = 'block';
            document.getElementById('btn-verify-otp').style.display = 'block';
            alert(`OTP sent to ${identifier}! Check your phone for the code.`);
        } else {
            alert('Failed to send OTP.');
            document.getElementById('btn-send-otp').textContent = 'Send OTP';
        }
    } catch(e) {
        alert('Server error.');
        document.getElementById('btn-send-otp').textContent = 'Send OTP';
    }
}

window.verifyOtp = async function() {
    let phone = null;
    let email = null;
    if (currentLoginMethod === 'phone') {
        phone = document.getElementById('citizen-phone').value;
    } else {
        email = document.getElementById('citizen-email').value;
    }
    const otp = document.getElementById('citizen-otp').value;
    
    try {
        const res = await fetch(`${API_URL}/citizen_login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({phone, email, otp})
        });
        
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('citizenToken', data.token);
            localStorage.setItem('civic_user_id', data.user_id);
            citizenToken = data.token;
            userId = data.user_id;
            checkCitizenAuth();
        } else {
            alert('Invalid OTP. Use 1234');
        }
    } catch(e) {
        console.error(e);
        alert('Login failed');
    }
}

window.citizenLogout = function() {
    localStorage.removeItem('citizenToken');
    localStorage.removeItem('civic_user_id');
    citizenToken = null;
    userId = null;
    document.getElementById('notif-badge').style.display = 'none';
    checkCitizenAuth();
    toggleSidebar(); // Close sidebar
}

// --- NOTIFICATIONS ---
window.toggleNotifs = function() {
    const d = document.getElementById('notif-dropdown');
    d.style.display = d.style.display === 'none' ? 'block' : 'none';
    if (d.style.display === 'block') {
        document.getElementById('notif-badge').style.display = 'none'; // Clear badge
    }
}

async function fetchNotifications() {
    if (!userId) return;
    try {
        const res = await fetch(`${API_URL}/notifications/${userId}`);
        const notifs = await res.json();
        
        const list = document.getElementById('notif-list');
        if (notifs.length === 0) {
            list.innerHTML = 'No new notifications.';
            return;
        }
        
        list.innerHTML = '';
        let unread = 0;
        notifs.forEach(n => {
            if (!n.is_read) unread++;
            list.innerHTML += `
                <div style="padding:8px 0; border-bottom:1px solid var(--border);">
                    <div>${n.message}</div>
                    <small style="color:#aaa;">${new Date(n.timestamp).toLocaleString()}</small>
                </div>
            `;
        });
        
        if (unread > 0) {
            const badge = document.getElementById('notif-badge');
            badge.innerText = unread;
            badge.style.display = 'block';
        }
    } catch(e) {
        console.error("Failed to load notifs", e);
    }
}

async function fetchCivicScore() {
    try {
        const res = await fetch(`${API_URL}/users/${userId}/points`);
        const data = await res.json();
        document.getElementById('civic-score').innerText = `🏆 Civic Score: ${data.points}`;
    } catch(e) {
        console.log("Could not fetch civic score");
    }
}

// --- PWA INSTALL BANNER ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = document.getElementById('install-banner');
    banner.style.display = 'flex';
    
    document.getElementById('install-btn').addEventListener('click', () => {
        banner.style.display = 'none';
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('User accepted the A2HS prompt');
            }
            deferredPrompt = null;
        });
    });
});

// --- SERVICE WORKER REGISTRATION (PWA Enabled) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('Service Worker registered for offline capability!', reg);
        }).catch(err => {
            console.error('Service Worker registration failed:', err);
        });
    });
}

// --- INDEXED DB SETUP ---
let db;
const request = indexedDB.open('CivicReportsDB', 1);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains('offline_reports')) {
        db.createObjectStore('offline_reports', { keyPath: 'id', autoIncrement: true });
    }
};

request.onsuccess = (e) => {
    db = e.target.result;
    checkOnlineStatus();
};

request.onerror = (e) => {
    console.error('IndexedDB error', e);
};

// --- NETWORK STATUS & SYNC ---
const statusEl = document.getElementById('network-status');

function updateNetworkStatus() {
    if (navigator.onLine) {
        statusEl.textContent = 'Online';
        statusEl.className = 'status-online';
        syncOfflineReports();
        fetchReports();
        fetchCivicScore();
    } else {
        statusEl.textContent = 'Offline Mode';
        statusEl.className = 'status-offline';
    }
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

async function syncOfflineReports() {
    if (!db) return;
    const tx = db.transaction('offline_reports', 'readonly');
    const store = tx.objectStore('offline_reports');
    const req = store.getAll();

    req.onsuccess = async () => {
        const reports = req.result;
        for (let report of reports) {
            try {
                const formData = new FormData();
                formData.append('category', report.category);
                formData.append('description', report.description);
                formData.append('lat', report.lat);
                formData.append('lng', report.lng);
                formData.append('is_anonymous', report.is_anonymous);
                formData.append('user_id', report.user_id);
                if (report.photo) {
                    formData.append('photo', report.photo, 'offline_photo.jpg');
                }

                const res = await fetch(`${API_URL}/reports`, {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) {
                    const delTx = db.transaction('offline_reports', 'readwrite');
                    delTx.objectStore('offline_reports').delete(report.id);
                }
            } catch (err) {
                console.error('Sync failed for report', report.id, err);
            }
        }
    };
}


// --- MAP INITIALIZATION (Leaflet) ---
let map = null;
let markers = [];

function initMap() {
    if (map !== null) return;
    // Default to a central city coordinate, e.g. New York
    map = L.map('map-container').setView([40.7128, -74.0060], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Try to locate user
    map.locate({setView: true, maxZoom: 16});
}


// --- UI LOGIC ---
function switchTab(tab) {
    if (!citizenToken) return; // Must be logged in

    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
        if(v.id === 'view-map') v.style.display = 'none';
    });
    document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));
    
    if (tab === 'report') {
        document.getElementById('view-report').classList.add('active');
        document.querySelectorAll('.nav-item')[0].classList.add('active');
    } else {
        const mapView = document.getElementById('view-map');
        mapView.classList.add('active');
        mapView.style.display = 'flex'; // Use flex for map container to fill space
        document.querySelectorAll('.nav-item')[1].classList.add('active');
        
        // Leaflet needs to know the container size changed when made visible
        setTimeout(() => {
            initMap();
            map.invalidateSize();
            fetchReports();
        }, 100);
    }
}

// Photo preview
let currentPhotoBlob = null;
const photoInput = document.getElementById('photo-input');
const photoPreview = document.getElementById('photo-preview');
const photoPlaceholder = document.getElementById('photo-placeholder');

photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        currentPhotoBlob = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            photoPreview.src = e.target.result;
            photoPreview.style.display = 'block';
            photoPlaceholder.style.display = 'none';
        }
        reader.readAsDataURL(file);
    }
});

// Emergency Triage
const descInput = document.getElementById('description');
const alertBox = document.getElementById('emergency-alert');
const submitBtn = document.getElementById('submit-btn');

descInput.addEventListener('input', (e) => {
    const text = e.target.value.toLowerCase();
    const keywords = ['fire', 'accident', 'gun', 'blood', 'emergency', 'help', 'crash'];
    const hasEmergency = keywords.some(kw => text.includes(kw));
    
    if (hasEmergency) {
        alertBox.style.display = 'block';
        submitBtn.style.opacity = '0.5';
        submitBtn.style.pointerEvents = 'none';
    } else {
        alertBox.style.display = 'none';
        submitBtn.style.opacity = '1';
        submitBtn.style.pointerEvents = 'auto';
    }
});

// Submit Report
submitBtn.addEventListener('click', async () => {
    const category = document.getElementById('category').value;
    const description = descInput.value;
    const isAnonymous = document.getElementById('anonymous-toggle').checked;
    
    if (!description.trim()) {
        alert('Please provide a description.');
        return;
    }

    submitBtn.textContent = 'Saving...';
    
    // Get GPS
    let lat = 40.7128, lng = -74.0060; // Fallback to NYC
    try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout: 5000}));
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
    } catch(e) {
        console.log("GPS unavailable, using fallback.");
    }

    if (navigator.onLine) {
        const formData = new FormData();
        formData.append('category', category);
        formData.append('description', description);
        formData.append('lat', lat);
        formData.append('lng', lng);
        formData.append('is_anonymous', isAnonymous);
        formData.append('user_id', userId);
        if (currentPhotoBlob) formData.append('photo', currentPhotoBlob);

        try {
            const res = await fetch(`${API_URL}/reports`, { method: 'POST', body: formData });
            if (res.ok) {
                alert('Report submitted successfully!');
                resetForm();
            } else {
                saveOffline(category, description, lat, lng, isAnonymous, currentPhotoBlob);
            }
        } catch(e) {
            saveOffline(category, description, lat, lng, isAnonymous, currentPhotoBlob);
        }
    } else {
        saveOffline(category, description, lat, lng, isAnonymous, currentPhotoBlob);
    }
});

function saveOffline(category, description, lat, lng, is_anonymous, photo) {
    const tx = db.transaction('offline_reports', 'readwrite');
    const store = tx.objectStore('offline_reports');
    store.add({ category, description, lat, lng, is_anonymous, user_id: userId, photo, timestamp: Date.now() });
    
    alert('You are offline. Report saved locally and will sync when connected.');
    resetForm();
}

function resetForm() {
    descInput.value = '';
    photoPreview.style.display = 'none';
    photoPlaceholder.style.display = 'block';
    currentPhotoBlob = null;
    submitBtn.textContent = 'Submit Report';
}

// Fetch Reports and Plot on Map
async function fetchReports() {
    if (!navigator.onLine || !map) return;
    
    try {
        const res = await fetch(`${API_URL}/reports`);
        const reports = await res.json();
        
        // Clear existing markers
        markers.forEach(m => map.removeLayer(m));
        markers = [];
        
        reports.forEach(r => {
            // Green for resolved, red for open/in_progress
            const iconColor = r.status === 'resolved' ? 'green' : 'red';
            
            // Custom Leaflet icon using a colored marker
            const markerIcon = new L.Icon({
              iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${iconColor}.png`,
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41]
            });

            const author = r.is_anonymous ? 'Anonymous Neighbor' : 'Verified Resident';
            
            const popupContent = `
                <div style="min-width: 200px;">
                    <h4 style="margin:0 0 5px 0;">${r.category.toUpperCase()}</h4>
                    <p style="margin:0 0 5px 0; font-size:12px; color:#666;">${author} &bull; ${new Date(r.timestamp).toLocaleDateString()}</p>
                    <p style="margin:0 0 10px 0;">${r.description}</p>
                    <p style="margin:0 0 5px 0; font-weight:bold; color:${r.status==='resolved'?'green':(r.status==='in_progress'?'orange':'red')};">Status: ${r.status}</p>
                    <p style="margin:0 0 10px 0; font-size:12px; font-weight:bold; color:${r.is_read || r.status !== 'open' ? '#3b82f6' : '#94a3b8'};">
                        ${r.is_read || r.status !== 'open' ? '👀 Viewed by City' : '📨 Sent (Not viewed yet)'}
                    </p>
                    ${r.resolution_photo_path ? `
                        <div style="margin:10px 0;">
                            <strong style="font-size:12px; color:green;">Proof of Completion:</strong><br>
                            <img src="http://localhost:5000/${r.resolution_photo_path}" style="width:100%; border-radius:8px; margin-top:5px; border: 2px solid green;">
                        </div>
                    ` : ''}
                    ${r.status !== 'resolved' ? `<button onclick="upvote('${r.id}')" style="width:100%; padding:8px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; cursor:pointer;">👍 Me Too (${r.upvotes})</button>` : ''}
                </div>
            `;

            const m = L.marker([r.lat, r.lng], {icon: markerIcon}).addTo(map)
                .bindPopup(popupContent);
            markers.push(m);
        });
    } catch(e) {
        console.error("Failed to fetch reports", e);
    }
}

// Must attach to window so popup HTML button can find it
window.upvote = async function(id) {
    try {
        await fetch(`${API_URL}/reports/${id}/upvote`, { method: 'POST' });
        fetchReports(); // Refresh markers
    } catch(e) {
        alert("Must be online to upvote.");
    }
}

// Init
checkCitizenAuth();
checkOnlineStatus = updateNetworkStatus;

// --- SIDEBAR & ADMIN LOGIC ---
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        overlay.style.opacity = '0';
        setTimeout(() => overlay.style.display = 'none', 300);
        adminLogout(); // Auto-logout when sidebar is closed
        
        // Reset the login form state
        document.getElementById('admin-login-step1').style.display = 'block';
        document.getElementById('admin-login-step2').style.display = 'none';
        document.getElementById('admin-username').value = '';
        document.getElementById('admin-password').value = '';
    } else {
        sidebar.classList.add('open');
        overlay.style.display = 'block';
        setTimeout(() => overlay.style.opacity = '1', 10);
        checkAdminAuth();
    }
}

function checkAdminAuth() {
    if (localStorage.getItem('adminToken')) {
        document.getElementById('admin-login-view').style.display = 'none';
        document.getElementById('admin-dashboard-view').style.display = 'block';
        loadAdminReports();
    } else {
        document.getElementById('admin-login-view').style.display = 'block';
        document.getElementById('admin-dashboard-view').style.display = 'none';
    }
}

async function adminLogin() {
    const u = document.getElementById('admin-username').value;
    const p = document.getElementById('admin-password').value;
    
    const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: u, password: p})
    });
    
    if (res.ok) {
        const data = await res.json();
        localStorage.setItem('adminToken', data.token);
        checkAdminAuth();
    } else {
        alert('Invalid credentials (try admin / admin)');
    }
}

function adminLogout() {
    localStorage.removeItem('adminToken');
    checkAdminAuth();
}

async function loadAdminReports() {
    try {
        const res = await fetch(`${API_URL}/reports`);
        const reports = await res.json();
        
        const list = document.getElementById('admin-reports');
        list.innerHTML = '';
        
        reports.forEach(r => {
            const row = document.createElement('div');
            row.className = 'report-row';
            row.innerHTML = `
                <div>
                    <strong>${r.category.toUpperCase()}</strong><br>
                    <small>${new Date(r.timestamp).toLocaleString()} | 👍 ${r.upvotes}</small><br>
                    <span style="font-size:14px;">${r.description}</span>
                </div>
                <div>
                    ${!r.is_read ? `<button onclick="markAsRead('${r.id}')" style="margin-top:8px; margin-right:8px; padding:6px; background:#eff6ff; border:1px solid #3b82f6; color:#3b82f6; border-radius:4px; cursor:pointer;">👀 Mark Read</button>` : ''}
                    <select class="status-select" id="select-${r.id}" onchange="updateStatus('${r.id}', this.value)">
                        <option value="open" ${r.status === 'open' ? 'selected' : ''}>Open</option>
                        <option value="in_progress" ${r.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                        <option value="resolved" ${r.status === 'resolved' ? 'selected' : ''}>Resolved</option>
                    </select>
                    <input type="file" id="photo-${r.id}" style="display:none" accept="image/*" onchange="resolveWithPhoto('${r.id}')">
                </div>
            `;
            list.appendChild(row);
        });
    } catch(e) {
        console.error("Failed to load admin reports", e);
    }
}

window.updateStatus = async function(id, newStatus) {
    if (newStatus === 'resolved') {
        alert('You must provide a completion photo to resolve this issue.');
        document.getElementById(`photo-${id}`).click();
        return;
    }
    
    const token = localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/reports/${id}/status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({status: newStatus})
    });
    
    if (res.ok) {
        console.log("Status updated");
        fetchReports(); // Refresh public map instantly
    } else {
        alert('Failed to update status.');
        loadAdminReports();
    }
}

window.resolveWithPhoto = async function(id) {
    const photoInput = document.getElementById(`photo-${id}`);
    if (!photoInput.files[0]) {
        alert('A photo is required to resolve an issue.');
        loadAdminReports(); // Reset select
        return;
    }

    const token = localStorage.getItem('adminToken');
    const formData = new FormData();
    formData.append('resolution_photo', photoInput.files[0]);

    const res = await fetch(`${API_URL}/reports/${id}/resolve`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    });

    if (res.ok) {
        alert('Status updated to Resolved. Proof photo uploaded, and user earned +50 Civic Points!');
        loadAdminReports();
        fetchReports(); // Refresh map
        fetchCivicScore(); // Refresh score if it was their own post
    } else {
        alert('Failed to resolve issue.');
        loadAdminReports();
    }
}

window.markAsRead = async function(id) {
    const token = localStorage.getItem('adminToken');
    const res = await fetch(`${API_URL}/reports/${id}/read`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });
    if (res.ok) {
        loadAdminReports();
        fetchReports(); // Refresh map
    } else {
        alert('Failed to mark as read');
    }
}
