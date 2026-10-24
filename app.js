// ─── CONFIG ───────────────────────────────────────────────
let API_KEY = '';
let API_URL = 'https://yoyomedia.in/api/v2';
let orders = [];
let scheduledJobs = [];
let servicesCache = [];
let pollInterval = null;

// ─── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  await loadConfig();
  await loadDataFromServer();
  fetchBalance();
  renderDashboard();

  document.getElementById('service-search').addEventListener('input', filterServices);
  document.getElementById('category-filter').addEventListener('change', filterServices);
  document.getElementById('order-search').addEventListener('input', renderOrders);
  document.getElementById('status-filter').addEventListener('change', filterServices);
  document.getElementById('order-service').addEventListener('input', showServiceHint);
  document.getElementById('balance-display').addEventListener('click', fetchBalance);

  document.querySelectorAll('.row-toggle').forEach(toggle => {
    const row = toggle.closest('.planner-row');
    if (!toggle.checked) row.classList.add('disabled');
    toggle.addEventListener('change', () => row.classList.toggle('disabled', !toggle.checked));
  });

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('planner-start').value = now.toISOString().slice(0, 16);

  // Poll server every 10s instead of running scheduler in browser
  setInterval(loadDataFromServer, 10000);
});

async function loadConfig() {
  try {
    const res = await fetch('/config');
    const cfg = await res.json();
    API_URL = cfg.api_url || API_URL;
    API_KEY = localStorage.getItem('api_key') || '';
    document.getElementById('settings-apiurl').value = API_URL;
    document.getElementById('settings-apikey').value = API_KEY;
  } catch(e) {}
}

async function loadDataFromServer() {
  try {
    const [oRes, jRes] = await Promise.all([fetch('/orders'), fetch('/jobs')]);
    orders = await oRes.json();
    scheduledJobs = await jRes.json();
    renderDashboard();
    const activePage = document.querySelector('.nav-item.active')?.dataset?.page;
    if (activePage === 'orders') renderOrders();
    if (activePage === 'scheduled') renderScheduled();
  } catch(e) {}
}

// ─── NAVIGATION ───────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const page = item.dataset.page;
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + page).classList.add('active');
      document.getElementById('page-title').textContent = item.textContent.trim().slice(2);

      if (page === 'services' && servicesCache.length === 0) loadServices();
      if (page === 'orders') renderOrders();
      if (page === 'dashboard') renderDashboard();
      if (page === 'scheduled') renderScheduled();
    });
  });
}

// ─── API CALL ─────────────────────────────────────────────
async function apiCall(params) {
  if (!API_KEY) { showModal('Error', 'API Key not set! Go to ⚙️ Settings first.'); return null; }
  try {
    const res = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: API_KEY, ...params })
    });
    return await res.json();
  } catch (e) {
    showModal('API Error', e.message);
    return null;
  }
}

// ─── BALANCE ──────────────────────────────────────────────
async function fetchBalance() {
  const el = document.getElementById('balance-display');
  el.textContent = '💰 Loading...';
  const data = await apiCall({ action: 'balance' });
  if (data && data.balance !== undefined) {
    el.textContent = `💰 ${parseFloat(data.balance).toFixed(4)} ${data.currency || 'USD'}`;
  } else {
    el.textContent = '💰 Balance: --';
  }
}

// ─── SERVICES ─────────────────────────────────────────────
async function loadServices() {
  const el = document.getElementById('services-table');
  el.innerHTML = '<div class="loading">Loading services...</div>';
  const data = await apiCall({ action: 'services' });
  if (!data || !Array.isArray(data)) { el.innerHTML = '<div class="loading">Failed to load.</div>'; return; }

  servicesCache = data;

  // populate categories
  const cats = [...new Set(data.map(s => s.Category).filter(Boolean))].sort();
  const catSel = document.getElementById('category-filter');
  catSel.innerHTML = '<option value="">All Categories</option>';
  cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o); });

  renderServicesTable(data);
}

function filterServices() {
  const q = document.getElementById('service-search').value.toLowerCase();
  const cat = document.getElementById('category-filter').value;
  let filtered = servicesCache;
  if (cat) filtered = filtered.filter(s => s.Category === cat);
  if (q) filtered = filtered.filter(s =>
    (s.name || '').toLowerCase().includes(q) ||
    String(s.service || s.services || '').includes(q)
  );
  renderServicesTable(filtered);
}

function renderServicesTable(data) {
  if (!data.length) { document.getElementById('services-table').innerHTML = '<div class="loading">No services found.</div>'; return; }
  let html = `<div class="table-wrap"><table>
    <thead><tr><th>ID</th><th>Category</th><th>Name</th><th>Rate/1000</th><th>Min</th><th>Max</th><th>Type</th><th>Action</th></tr></thead><tbody>`;
  data.forEach(s => {
    const id = s.service || s.services;
    html += `<tr>
      <td><b>${id}</b></td>
      <td>${s.Category || '-'}</td>
      <td>${s.name}</td>
      <td>$${parseFloat(s.rate).toFixed(4)}</td>
      <td>${s.min}</td>
      <td>${s.max}</td>
      <td>${s.type || 'Default'}</td>
      <td><button class="btn-sm btn-status" onclick="goToOrder(${id}, '${escHtml(s.name)}', ${s.min}, ${s.max})">Order</button></td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  document.getElementById('services-table').innerHTML = html;
}

function goToOrder(id, name, min, max) {
  document.querySelector('[data-page="new-order"]').click();
  document.getElementById('order-service').value = id;
  document.getElementById('order-qty').min = min;
  document.getElementById('order-qty').max = max;
  document.getElementById('service-hint').textContent = `${name} | Min: ${min} | Max: ${max}`;
}

function showServiceHint() {
  const id = document.getElementById('order-service').value;
  const s = servicesCache.find(x => String(x.service || x.services) === String(id));
  document.getElementById('service-hint').textContent = s
    ? `${s.name} | Min: ${s.min} | Max: ${s.max} | Rate: $${s.rate}`
    : '';
}

// ─── PLACE ORDER ──────────────────────────────────────────
async function placeOrder() {
  const service = document.getElementById('order-service').value.trim();
  const link = document.getElementById('order-link').value.trim();
  const quantity = document.getElementById('order-qty').value.trim();
  const resultEl = document.getElementById('order-result');

  if (!service || !link || !quantity) { showResult(resultEl, 'error', 'Please fill all fields.'); return; }

  showResult(resultEl, '', 'Placing order...');
  const data = await apiCall({ action: 'add', service, link, quantity });

  if (data && data.order) {
    showResult(resultEl, 'success', `✅ Order placed! Order ID: ${data.order}`);
    document.getElementById('order-service').value = '';
    document.getElementById('order-link').value = '';
    document.getElementById('order-qty').value = '';
    document.getElementById('service-hint').textContent = '';
    await loadDataFromServer();
  } else {
    showResult(resultEl, 'error', JSON.stringify(data, null, 2));
  }
}

// ─── ORDERS TABLE ─────────────────────────────────────────
function renderOrders() {
  const q = document.getElementById('order-search').value.toLowerCase();
  const sf = document.getElementById('status-filter').value;
  let filtered = orders;
  if (q) filtered = filtered.filter(o => String(o.id).includes(q) || (o.link || '').toLowerCase().includes(q));
  if (sf) filtered = filtered.filter(o => o.status === sf);

  if (!filtered.length) {
    document.getElementById('orders-table').innerHTML = '<div class="loading">No orders found.</div>';
    return;
  }

  const grouped = {};
  filtered.forEach(o => {
    const key = o.link || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(o);
  });

  let html = '';
  Object.entries(grouped).forEach(([link, items], idx) => {
    const sectionId = `orders-section-${idx}`;
    const active = items.some(o => o.status === 'Pending' || o.status === 'In progress');
    html += `
      <div class="link-section">
        <div class="link-section-header${active ? ' open' : ''}" onclick="toggleSection('${sectionId}', this)">
          <div class="link-section-left">
            <span class="link-section-arrow">▶</span>
            <span class="link-section-url" title="${escHtml(link)}">${link}</span>
          </div>
          <div class="link-section-right">
            ${active ? `<span class="link-badge blue">${items.filter(o=>o.status==='Pending'||o.status==='In progress').length} active</span>` : ''}
            <span class="link-section-count">${items.length} orders</span>
          </div>
        </div>
        <div class="link-section-body${active ? ' open' : ''}" id="${sectionId}">
          <div class="table-wrap"><table>
            <thead><tr><th>Order ID</th><th>Service</th><th>Qty</th><th>Charge</th><th>Remains</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>`;
    items.forEach(o => {
      html += `<tr>
        <td><b>${o.id}</b></td>
        <td>${o.service}</td>
        <td>${o.quantity}</td>
        <td>${o.charge}</td>
        <td>${o.remains}</td>
        <td>${badge(o.status)}</td>
        <td>${o.date}</td>
        <td>
          <button class="btn-sm btn-status" onclick="refreshSingleOrder(${o.id})">🔄</button>
          <button class="btn-sm btn-refill" onclick="refillOrder(${o.id})">♻️</button>
          <button class="btn-sm btn-cancel" onclick="cancelOrder(${o.id})">❌</button>
        </td>
      </tr>`;
    });
    html += `</tbody></table></div>
        <div class="graph-container"><canvas id="graph-orders-${idx}"></canvas></div>
        </div></div>`;
  });

  document.getElementById('orders-table').innerHTML = html;

  Object.keys(grouped).forEach((link, idx) => renderGraph(link, `graph-orders-${idx}`));
}

async function refreshSingleOrder(id) {
  const data = await apiCall({ action: 'status', order: id });
  if (data && !data.error) {
    updateOrderInList(id, data);
    renderOrders();
    renderDashboard();
  } else {
    showModal('Status Error', data?.error || 'Failed to fetch status.');
  }
}

async function refreshAllOrders() {
  if (!orders.length) return;
  const ids = orders.map(o => o.id).join(',');
  const data = await apiCall({ action: 'status', order: ids });
  if (!data) return;
  Object.entries(data).forEach(([id, info]) => {
    if (!info.error) updateOrderInList(parseInt(id), info);
  });
  saveOrders();
  renderOrders();
  renderDashboard();
}

function updateOrderInList(id, info) {
  const o = orders.find(x => x.id == id);
  if (o) {
    o.status = info.status || o.status;
    o.charge = info.charge || o.charge;
    o.remains = info.remains !== undefined ? info.remains : o.remains;
  }
}

async function refillOrder(id) {
  const data = await apiCall({ action: 'refill', order: id });
  showModal('Refill', data?.success || JSON.stringify(data));
}

async function cancelOrder(id) {
  if (!confirm(`Cancel order #${id}?`)) return;
  const data = await apiCall({ action: 'cancel', order: id });
  showModal('Cancel', data?.success || JSON.stringify(data));
  await loadDataFromServer();
}

async function clearOrders() {
  if (!confirm('Clear all order history?')) return;
  await fetch('/orders/clear', { method: 'POST' });
  await loadDataFromServer();
}

// ─── CHECK STATUS ─────────────────────────────────────────
async function checkStatus() {
  const input = document.getElementById('status-input').value.trim();
  const resultEl = document.getElementById('status-result');
  if (!input) { showResult(resultEl, 'error', 'Enter order ID(s).'); return; }

  showResult(resultEl, '', 'Checking...');
  const data = await apiCall({ action: 'status', order: input });

  if (!data) return;
  showResult(resultEl, 'success', JSON.stringify(data, null, 2));
}

// ─── DASHBOARD ────────────────────────────────────────────
function renderDashboard() {
  document.getElementById('stat-total').textContent = orders.length;
  document.getElementById('stat-pending').textContent = orders.filter(o => o.status === 'Pending' || o.status === 'In progress').length;
  document.getElementById('stat-completed').textContent = orders.filter(o => o.status === 'Completed').length;
  document.getElementById('stat-partial').textContent = orders.filter(o => o.status === 'Partial').length;

  const recent = orders.slice(0, 30);
  if (!recent.length) {
    document.getElementById('recent-orders-table').innerHTML = '<div class="loading">No orders yet.</div>';
    return;
  }

  const grouped = {};
  recent.forEach(o => {
    const key = o.link || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(o);
  });

  let html = '';
  Object.entries(grouped).forEach(([link, items], idx) => {
    const sectionId = `dash-section-${idx}`;
    html += `
      <div class="link-section">
        <div class="link-section-header" onclick="toggleSection('${sectionId}', this)">
          <div class="link-section-left">
            <span class="link-section-arrow">▶</span>
            <span class="link-section-url" title="${escHtml(link)}">${link}</span>
          </div>
          <div class="link-section-right">
            <span class="link-section-count">${items.length} orders</span>
          </div>
        </div>
        <div class="link-section-body" id="${sectionId}">
          <div class="table-wrap"><table>
            <thead><tr><th>Order ID</th><th>Service</th><th>Qty</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>`;
    items.forEach(o => {
      html += `<tr>
        <td><b>${o.id}</b></td>
        <td>${o.service}</td>
        <td>${o.quantity}</td>
        <td>${badge(o.status)}</td>
        <td>${o.date}</td>
      </tr>`;
    });
    html += `</tbody></table></div></div></div>`;
  });

  document.getElementById('recent-orders-table').innerHTML = html;
}

// ─── SETTINGS ─────────────────────────────────────────────
async function saveSettings() {
  API_KEY = document.getElementById('settings-apikey').value.trim();
  API_URL = document.getElementById('settings-apiurl').value.trim();
  localStorage.setItem('api_key', API_KEY);
  // save to server too
  await fetch('/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: API_KEY, api_url: API_URL })
  });
  const el = document.getElementById('settings-result');
  showResult(el, 'success', '✅ Settings saved!');
  fetchBalance();
}

function toggleApiKeyVisibility() {
  const el = document.getElementById('settings-apikey');
  el.type = el.type === 'password' ? 'text' : 'password';
}

// ─── HELPERS ──────────────────────────────────────────────
async function saveOrders() {
  // orders are managed by server, just update local cache
  // server saves automatically after each action
}

function badge(status) {
  const map = {
    'Pending': 'badge-pending',
    'In progress': 'badge-progress',
    'Completed': 'badge-completed',
    'Partial': 'badge-partial',
    'Cancelled': 'badge-cancelled'
  };
  return `<span class="badge ${map[status] || 'badge-pending'}">${status || 'Pending'}</span>`;
}

function truncate(str, n) {
  if (!str) return '-';
  return str.length > n ? str.slice(0, n) + '...' : str;
}

function escHtml(str) {
  return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function showResult(el, type, msg) {
  el.className = 'result-box' + (type ? ' ' + type : '');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showModal(title, body) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = typeof body === 'object' ? JSON.stringify(body, null, 2) : body;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function toggleSection(id, header) {
  const body = document.getElementById(id);
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  header.classList.toggle('open', !isOpen);
}

// ─── GRAPH ─────────────────────────────────────────────────
const chartInstances = {};

async function renderGraph(link, canvasId) {
  const res = await fetch(`/orders/graph?link=${encodeURIComponent(link)}`);
  const data = await res.json();

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }

  const wrap = canvas.closest('.graph-container');

  if (!data.length) {
    wrap.innerHTML = '<div class="graph-empty">No data yet — orders deliver hone ke baad graph aayega</div>';
    return;
  }

  const maxViews = data[data.length - 1].views || 1;
  const maxLikes = data[data.length - 1].likes || 1;
  const firstT   = data[0].t;
  const lastT    = data[data.length - 1].t;
  const midT     = Math.round((firstT + lastT) / 2);

  const labels = data.map(p => {
    const d = new Date(p.t);
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  });

  // annotation lines at mid-time index
  const midIdx = data.reduce((best, p, i) => Math.abs(p.t - midT) < Math.abs(data[best].t - midT) ? i : best, 0);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Views',
          data: data.map(p => p.views),
          borderColor: '#6c63ff',
          backgroundColor: 'rgba(108,99,255,0.10)',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#6c63ff',
          fill: true,
          tension: 0.45,
          yAxisID: 'yV'
        },
        {
          label: 'Likes',
          data: data.map(p => p.likes),
          borderColor: '#f43f5e',
          backgroundColor: 'rgba(244,63,94,0.07)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#f43f5e',
          fill: true,
          tension: 0.45,
          yAxisID: 'yL'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { color: '#8b8b99', font: { size: 11 }, boxWidth: 10, padding: 16 }
        },
        tooltip: {
          backgroundColor: '#18181b',
          borderColor: '#2a2a2f',
          borderWidth: 1,
          titleColor: '#f0f0f5',
          bodyColor: '#8b8b99',
          padding: 12,
          callbacks: {
            title: items => 'Time: ' + items[0].label,
            label: item => item.dataset.label + ': ' + item.parsed.y.toLocaleString()
          }
        },
        annotation: undefined
      },
      scales: {
        x: {
          ticks: {
            color: '#55555f',
            font: { size: 10 },
            maxTicksLimit: 8,
            maxRotation: 0
          },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        yV: {
          position: 'left',
          min: 0,
          max: maxViews,
          ticks: {
            color: '#6c63ff',
            font: { size: 10 },
            count: 3,
            callback: v => {
              if (v === 0) return '0';
              if (Math.abs(v - maxViews / 2) < maxViews * 0.05) return Math.round(maxViews / 2).toLocaleString();
              if (Math.abs(v - maxViews) < maxViews * 0.05) return maxViews.toLocaleString();
              return '';
            }
          },
          grid: { color: 'rgba(255,255,255,0.03)' },
          border: { color: 'rgba(255,255,255,0.06)' }
        },
        yL: {
          position: 'right',
          min: 0,
          max: maxLikes,
          ticks: {
            color: '#f43f5e',
            font: { size: 10 },
            count: 3,
            callback: v => {
              if (v === 0) return '0';
              if (Math.abs(v - maxLikes / 2) < maxLikes * 0.05) return Math.round(maxLikes / 2).toLocaleString();
              if (Math.abs(v - maxLikes) < maxLikes * 0.05) return maxLikes.toLocaleString();
              return '';
            }
          },
          grid: { drawOnChartArea: false },
          border: { color: 'rgba(255,255,255,0.06)' }
        }
      }
    }
  });

  // draw mid-time dashed line + labels via afterDraw plugin
  const chart = chartInstances[canvasId];
  const pluginMid = {
    id: 'midline',
    afterDraw(ch) {
      const ctx = ch.ctx;
      const xScale = ch.scales.x;
      const yVScale = ch.scales.yV;
      const yLScale = ch.scales.yL;
      if (!xScale || midIdx >= ch.data.labels.length) return;

      const x = xScale.getPixelForIndex(midIdx);
      const top = ch.chartArea.top;
      const bottom = ch.chartArea.bottom;

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // mid views label
      const midViews = Math.round(maxViews / 2);
      const midLikes = Math.round(maxLikes / 2);
      const yMidV = yVScale.getPixelForValue(midViews);
      const yMidL = yLScale.getPixelForValue(midLikes);

      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(108,99,255,0.7)';
      ctx.fillText(midViews.toLocaleString(), ch.chartArea.left + 6, yMidV - 4);

      ctx.fillStyle = 'rgba(244,63,94,0.7)';
      ctx.fillText(midLikes.toLocaleString(), ch.chartArea.right - 36, yMidL - 4);

      ctx.restore();
    }
  };
  chart.options.plugins.midline = {};
  Chart.register(pluginMid);
  chart.update('none');
}

const QB_SCHEDULE = [
  // [offsetMin, serviceId, qty, type]
  [5,   '12876', 47,  'Views'],
  [15,  '12876', 58,  'Views'],
  [30,  '12876', 67,  'Views'],
  [45,  '11085', 134, 'Views'],
  [45,  '13639', 13,  'Likes'],
  [55,  '12876', 62,  'Views'],
  [85,  '11085', 156, 'Views'],
  [95,  '12876', 74,  'Views'],
  [95,  '13626', 24,  'Likes'],
  [125, '11085', 176, 'Views'],
  [135, '12876', 82,  'Views'],
  [165, '11085', 183, 'Views'],
  [165, '13626', 27,  'Likes'],
  [175, '12876', 79,  'Views'],
  [205, '11085', 189, 'Views'],
  [215, '12876', 85,  'Views'],
  [245, '11085', 187, 'Views'],
  [245, '13626', 29,  'Likes'],
  [255, '12876', 83,  'Views'],
  [285, '11085', 184, 'Views'],
  [295, '12876', 77,  'Views'],
  [325, '11085', 178, 'Views'],
  [325, '13626', 24,  'Likes'],
  [335, '12876', 71,  'Views'],
  [365, '11085', 172, 'Views'],
  [375, '12876', 65,  'Views'],
  [405, '11085', 165, 'Views'],
  [405, '13639', 15,  'Likes'],
  [415, '12876', 60,  'Views'],
  [445, '11085', 158, 'Views'],
  [455, '12876', 55,  'Views'],
  [485, '11085', 150, 'Views'],
  [485, '13626', 21,  'Likes'],
  [495, '12876', 51,  'Views'],
  [525, '11085', 143, 'Views'],
  [535, '12876', 48,  'Views'],
  [565, '11085', 136, 'Views'],
  [575, '12876', 47,  'Views'],
];

async function startQuickBoost() {
  const link = document.getElementById('qb-link').value.trim();
  const resultEl = document.getElementById('qb-result');
  if (!link) { showResult(resultEl, 'error', 'Post link daalo!'); return; }

  const now = Date.now();
  const jobs = QB_SCHEDULE.map(([offset, serviceId, qty, type]) => ({
    id: `qb_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type,
    serviceId,
    link,
    quantity: qty,
    scheduledAt: now + offset * 60 * 1000,
    status: 'pending',
    orderId: null,
    createdAt: now
  }));

  await fetch('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobs)
  });

  await loadDataFromServer();
  document.getElementById('qb-link').value = '';
  showResult(resultEl, 'success', `✅ ${jobs.length} orders scheduled! Pehla order ${new Date(now + 5*60*1000).toLocaleTimeString()} pe lagega.`);
}

function applyReelBoostTemplate() {
  const link = document.getElementById('planner-link').value.trim();
  if (!link) { alert('Pehle Post Link daalo!'); return; }

  const startVal = document.getElementById('planner-start').value;
  if (!startVal) { alert('Start time select karo!'); return; }

  const startTime = new Date(startVal).getTime();

  // 4 fixed jobs: [offsetMin, serviceId, qty, type, label, enabled]
  const jobs = [
    { offset: 0,  serviceId: '11085', quantity: 200, type: 'Views', label: '👁 Main Views (slow organic)',   enabled: true  },
    { offset: 2,  serviceId: '13626', quantity: 20,  type: 'Likes', label: '❤️ Organic Likes (chunked)',     enabled: true  },
    { offset: 25, serviceId: '13639', quantity: 10,  type: 'Likes', label: '❤️ Instant Likes (peak spike)',  enabled: true  },
    { offset: 30, serviceId: '12876', quantity: 50,  type: 'Views', label: '👁 Filler Views (gap cover)',    enabled: false },
  ];

  currentPlan = jobs.map(j => ({
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: j.type,
    serviceId: j.serviceId,
    link,
    quantity: j.quantity,
    scheduledAt: startTime + j.offset * 60 * 1000,
    label: j.label,
    enabled: j.enabled
  }));

  renderBoostPreview();
}

function renderBoostPreview() {
  const link = document.getElementById('planner-link').value.trim();
  let html = `<div class="plan-preview">
    <div class="plan-preview-header">
      <div class="plan-preview-title">🚀 Reel Boost Preview</div>
      <div class="plan-actions">
        <button class="btn-sm btn-status" onclick="confirmBoostPlan()">✅ Confirm & Schedule</button>
      </div>
    </div>
    <div class="plan-summary" style="margin-bottom:14px">
      <div>Link: <span style="color:var(--text2);font-weight:400">${link}</span></div>
      <div>Jobs: <span>${currentPlan.length}</span></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>On/Off</th><th>Service</th><th>Label</th><th>Qty</th><th>Scheduled At</th></tr></thead>
      <tbody>`;

  currentPlan.forEach((item, i) => {
    const dt = new Date(item.scheduledAt);
    const dtLocal = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    html += `<tr>
      <td><label class="toggle-switch" style="margin:0">
        <input type="checkbox" ${item.enabled ? 'checked' : ''} onchange="toggleBoostJob(${i}, this.checked)" />
        <span class="toggle-slider"></span>
      </label></td>
      <td><b>${item.serviceId}</b></td>
      <td style="color:var(--text2);font-size:12px">${item.label}</td>
      <td><input type="number" value="${item.quantity}" min="1" style="width:70px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px;outline:none" onchange="currentPlan[${i}].quantity=parseInt(this.value)||1" /></td>
      <td><input type="datetime-local" value="${dtLocal}" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px;outline:none" onchange="currentPlan[${i}].scheduledAt=new Date(this.value).getTime()" /></td>
    </tr>`;
  });

  html += `</tbody></table></div></div>`;
  document.getElementById('plan-preview').innerHTML = html;
}

function toggleBoostJob(i, checked) {
  currentPlan[i].enabled = checked;
}

async function confirmBoostPlan() {
  const active = currentPlan.filter(j => j.enabled);
  if (!active.length) { alert('Koi job enabled nahi hai!'); return; }
  const jobs = active.map(item => ({
    ...item,
    status: 'pending',
    orderId: null,
    createdAt: Date.now()
  }));
  await fetch('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobs)
  });
  await loadDataFromServer();
  currentPlan = [];
  document.getElementById('plan-preview').innerHTML = '<div class="plan-preview-empty">✅ Reel Boost scheduled! Go to 🕐 Scheduled to view.</div>';
  alert(`✅ ${jobs.length} jobs scheduled!`);
}

let currentPlan = [];

function generatePlan() {
  const link = document.getElementById('planner-link').value.trim();
  if (!link) { alert('Please enter a post link!'); return; }

  const startVal = document.getElementById('planner-start').value;
  if (!startVal) { alert('Please select a start time!'); return; }

  const spreadHours = parseInt(document.getElementById('planner-spread').value) || 24;
  const startTime = new Date(startVal).getTime();
  const endTime = startTime + spreadHours * 60 * 60 * 1000;

  currentPlan = [];

  document.querySelectorAll('.planner-row').forEach(row => {
    const toggle = row.querySelector('.row-toggle');
    if (!toggle.checked) return;

    const type = row.dataset.type;
    const serviceId = row.querySelector('.row-service').value.trim();
    const totalQty = parseInt(row.querySelector('.row-qty').value);
    const minChunk = parseInt(row.querySelector('.row-min-chunk').value) || Math.floor(totalQty * 0.05);
    const maxChunk = parseInt(row.querySelector('.row-max-chunk').value) || Math.floor(totalQty * 0.15);

    if (!serviceId || !totalQty || totalQty <= 0) return;

    const chunks = splitIntoChunks(totalQty, minChunk, maxChunk);
    const times = generateRandomTimes(startTime, endTime, chunks.length);

    chunks.forEach((qty, i) => {
      currentPlan.push({
        id: `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type,
        serviceId,
        link,
        quantity: qty,
        scheduledAt: times[i]
      });
    });
  });

  if (!currentPlan.length) { alert('Enable at least one engagement type and fill in the details!'); return; }

  renderPlanPreview();
}

function splitIntoChunks(total, minChunk, maxChunk) {
  const chunks = [];
  let remaining = total;
  while (remaining > 0) {
    if (remaining <= maxChunk) { chunks.push(remaining); break; }
    const chunk = randInt(minChunk, Math.min(maxChunk, remaining));
    chunks.push(chunk);
    remaining -= chunk;
  }
  return chunks;
}

function generateRandomTimes(start, end, count) {
  const times = [];
  const range = end - start;
  for (let i = 0; i < count; i++) {
    times.push(start + Math.floor(Math.random() * range));
  }
  return times.sort((a, b) => a - b);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function renderPlanPreview() {
  const byType = {};
  currentPlan.forEach(item => {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item);
  });

  const totalOrders = currentPlan.length;
  const totalQtyMap = {};
  currentPlan.forEach(item => {
    totalQtyMap[item.type] = (totalQtyMap[item.type] || 0) + item.quantity;
  });

  let summaryHtml = '<div class="plan-summary">';
  Object.entries(totalQtyMap).forEach(([type, qty]) => {
    summaryHtml += `<div>${type}: <span>${qty.toLocaleString()}</span></div>`;
  });
  summaryHtml += `<div>Total Orders: <span>${totalOrders}</span></div></div>`;

  let html = `<div class="plan-preview">
    <div class="plan-preview-header">
      <div class="plan-preview-title">📋 Plan Preview</div>
      <div class="plan-actions">
        <button class="btn-sm btn-refill" onclick="regeneratePlan()">🎲 Regenerate</button>
        <button class="btn-sm btn-status" onclick="confirmPlan()">✅ Confirm & Schedule</button>
      </div>
    </div>
    ${summaryHtml}`;

  Object.entries(byType).forEach(([type, items]) => {
    html += `<div class="plan-type-section">
      <div class="plan-type-title">${typeEmoji(type)} ${type}</div>`;
    items.forEach((item, i) => {
      const dt = new Date(item.scheduledAt);
      const dtLocal = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      html += `<div class="plan-chunk" data-id="${item.id}">
        <div class="chunk-num">${i + 1}</div>
        <input type="number" value="${item.quantity}" min="1" onchange="updateChunk('${item.id}', 'quantity', this.value)" />
        <input type="datetime-local" value="${dtLocal}" onchange="updateChunk('${item.id}', 'scheduledAt', new Date(this.value).getTime())" />
        <button class="btn-remove-chunk" onclick="removeChunk('${item.id}')">✕</button>
      </div>`;
    });
    html += `<div style="text-align:right;margin-top:6px">
      <button class="btn-sm btn-refill" onclick="addChunk('${type}')">+ Add Row</button>
    </div></div>`;
  });

  html += '</div>';
  document.getElementById('plan-preview').innerHTML = html;
}

function updateChunk(id, field, value) {
  const item = currentPlan.find(x => x.id === id);
  if (!item) return;
  if (field === 'quantity') item.quantity = parseInt(value) || 0;
  if (field === 'scheduledAt') item.scheduledAt = parseInt(value);
}

function removeChunk(id) {
  currentPlan = currentPlan.filter(x => x.id !== id);
  renderPlanPreview();
}

function addChunk(type) {
  const existing = currentPlan.filter(x => x.type === type);
  if (!existing.length) return;
  const last = existing[existing.length - 1];
  currentPlan.push({
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type,
    serviceId: last.serviceId,
    link: last.link,
    quantity: 100,
    scheduledAt: last.scheduledAt + 3600000
  });
  renderPlanPreview();
}

function regeneratePlan() {
  generatePlan();
}

async function confirmPlan() {
  if (!currentPlan.length) return;
  const jobs = currentPlan.map(item => ({
    ...item,
    status: 'pending',
    orderId: null,
    createdAt: Date.now()
  }));
  await fetch('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobs)
  });
  await loadDataFromServer();
  currentPlan = [];
  document.getElementById('plan-preview').innerHTML = '<div class="plan-preview-empty">✅ Plan scheduled! Go to 🕐 Scheduled to view.</div>';
  alert(`✅ ${jobs.length} orders scheduled successfully!`);
}

function typeEmoji(type) {
  const map = { Views: '👁️', Likes: '❤️', Saves: '🔖', Shares: '↗️', Comments: '💬', Followers: '👥' };
  return map[type] || '📌';
}

// ─── SCHEDULER TICK (kept for reference, actual runs on server) ───────────────
const PRE_CANCEL_MS = 2 * 60 * 1000;
const RETRY_INTERVAL_MS = 35 * 1000;

async function schedulerTick() {
  const now = Date.now();

  // ─ Step 1: Refresh all active placed order statuses ─
  const activeIds = [
    ...scheduledJobs.filter(j => j.status === 'placed' && j.orderId).map(j => j.orderId),
    ...orders.filter(o => o.status === 'Pending' || o.status === 'In progress').map(o => String(o.id))
  ];
  const uniqueIds = [...new Set(activeIds)];

  if (uniqueIds.length) {
    const statusData = await apiCall({ action: 'status', order: uniqueIds.join(',') });
    if (statusData) {
      Object.entries(statusData).forEach(([id, info]) => {
        if (!info.error) updateOrderInList(parseInt(id), info);
      });
      scheduledJobs.forEach(j => {
        if (j.status === 'placed' && j.orderId) {
          const info = statusData[String(j.orderId)];
          if (info && !info.error) j.placedOrderStatus = info.status;
        }
      });
      saveOrders();
    }
  }

  // ─ Step 2: For each upcoming job (within 2 min), cancel the running order for same service+link ─
  const upcomingJobs = scheduledJobs.filter(j =>
    j.status === 'pending' &&
    j.scheduledAt > now &&
    j.scheduledAt - now <= PRE_CANCEL_MS
  );

  for (const upcoming of upcomingJobs) {
    const key = `${upcoming.serviceId}|${upcoming.link}`;
    const runningJob = scheduledJobs.find(j =>
      j.status === 'placed' &&
      j.orderId &&
      `${j.serviceId}|${j.link}` === key &&
      (j.placedOrderStatus === 'Pending' || j.placedOrderStatus === 'In progress' || !j.placedOrderStatus)
    );

    if (runningJob) {
      // Keep retrying cancel every tick until it actually gets cancelled
      const cancelRes = await apiCall({ action: 'cancel', order: runningJob.orderId });
      if (cancelRes && cancelRes.success) {
        runningJob.placedOrderStatus = 'Cancelled';
        runningJob.cancelNote = `Auto-cancelled for next scheduled order`;
        updateOrderInList(runningJob.orderId, { status: 'Cancelled' });
        saveOrders();
      }
    }
  }

  // ─ Step 3: Place due pending jobs + retry jobs ─
  const toPlace = scheduledJobs.filter(j =>
    (j.status === 'pending' && j.scheduledAt <= now) ||
    (j.status === 'retrying' && (!j.lastRetryAt || now - j.lastRetryAt >= RETRY_INTERVAL_MS))
  ).sort((a, b) => (a.scheduledAt || a.createdAt || 0) - (b.scheduledAt || b.createdAt || 0));

  for (const job of toPlace) {
    job.lastRetryAt = now;
    const data = await apiCall({ action: 'add', service: job.serviceId, link: job.link, quantity: job.quantity });

    if (data && data.order) {
      job.status = 'placed';
      job.orderId = data.order;
      job.placedOrderStatus = 'Pending';
      job.retryCount = 0;
      job.waitNote = null;
      orders.unshift({
        id: data.order,
        service: job.serviceId,
        link: job.link,
        quantity: job.quantity,
        status: 'Pending',
        charge: '-',
        remains: '-',
        date: new Date().toLocaleString(),
        note: `Auto: ${job.type}`
      });
      saveOrders();
    } else {
      const errMsg = (data?.error || '').toLowerCase();
      const isConflict = errMsg.includes('running') || errMsg.includes('progress') ||
                         errMsg.includes('active') || errMsg.includes('already') ||
                         errMsg.includes('incomplete');
      if (isConflict) {
        job.status = 'retrying';
        job.retryCount = (job.retryCount || 0) + 1;
        job.waitNote = `Retrying... attempt #${job.retryCount} (prev order still cancelling)`;
      } else {
        job.status = 'failed';
        job.error = data?.error || 'Unknown error';
      }
    }
  }

  // server handles saving
  await loadDataFromServer();
}

// ─── SCHEDULED TABLE ──────────────────────────────────────
function renderScheduled() {
  const el = document.getElementById('scheduled-table');
  if (!scheduledJobs.length) {
    el.innerHTML = '<div class="loading">No scheduled orders yet. Use the Planner!</div>';
    return;
  }

  const sorted = [...scheduledJobs].sort((a, b) => a.scheduledAt - b.scheduledAt);

  const grouped = {};
  sorted.forEach(job => {
    const key = job.link || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(job);
  });

  let html = '';
  Object.entries(grouped).forEach(([link, jobs], idx) => {
    const sectionId = `sched-section-${idx}`;
    const pending   = jobs.filter(j => j.status === 'pending' || j.status === 'retrying').length;
    const placed    = jobs.filter(j => j.status === 'placed').length;
    const hasActive = pending > 0;
    html += `
      <div class="link-section">
        <div class="link-section-header${hasActive ? ' open' : ''}" onclick="toggleSection('${sectionId}', this)">
          <div class="link-section-left">
            <span class="link-section-arrow">▶</span>
            <span class="link-section-url" title="${escHtml(link)}">${link}</span>
          </div>
          <div class="link-section-right">
            ${pending ? `<span class="link-badge yellow">${pending} pending</span>` : ''}
            ${placed  ? `<span class="link-badge green">${placed} placed</span>` : ''}
            <span class="link-section-count">${jobs.length} total</span>
          </div>
        </div>
        <div class="link-section-body${hasActive ? ' open' : ''}" id="${sectionId}">
          <div class="table-wrap"><table>
            <thead><tr><th>Type</th><th>Service</th><th>Qty</th><th>Scheduled At</th><th>Status</th><th>Order ID / Note</th><th>Action</th></tr></thead>
            <tbody>`;
    jobs.forEach(job => {
      const statusClass = `sched-status-${job.status === 'placing' ? 'pending' : job.status}`;
      const dt = new Date(job.scheduledAt);
      const dtLocal = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const isEditable = job.status === 'pending';
      html += `<tr>
        <td>${typeEmoji(job.type)} ${job.type}</td>
        <td>${job.serviceId}</td>
        <td>${job.quantity}</td>
        <td>${isEditable
          ? `<input type="datetime-local" value="${dtLocal}" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px;outline:none;" onchange="updateScheduledTime('${job.id}', this.value)" />`
          : new Date(job.scheduledAt).toLocaleString()}
        </td>
        <td class="${statusClass}">${
          job.status === 'placing'   ? '⏳ Placing...' :
          job.status === 'placed'    ? '✅ Placed' :
          job.status === 'failed'    ? '❌ Failed' :
          job.status === 'cancelled' ? '🚫 Cancelled' :
          job.status === 'retrying'  ? `🔄 Retrying #${job.retryCount || 1}` :
          '⏰ Pending'}</td>
        <td>${job.orderId ? `<b>${job.orderId}</b>` : job.waitNote || job.error || '-'}</td>
        <td>
          ${job.status === 'pending'  ? `<button class="btn-sm btn-cancel" onclick="cancelScheduled('${job.id}')">Cancel</button>` : ''}
          ${job.status === 'failed'   ? `<button class="btn-sm btn-refill" onclick="retryScheduled('${job.id}')">Retry</button>` : ''}
        </td>
      </tr>`;
    });
    html += `</tbody></table></div></div></div>`;
  });

  el.innerHTML = html;
}

async function cancelScheduled(id) {
  await fetch('/jobs/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  await loadDataFromServer();
}

async function updateScheduledTime(id, value) {
  await fetch('/jobs/update-time', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, scheduledAt: new Date(value).getTime() })
  });
  await loadDataFromServer();
}

async function retryScheduled(id) {
  await fetch('/jobs/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  await loadDataFromServer();
}

async function clearScheduled() {
  await fetch('/jobs/clear', { method: 'POST' });
  await loadDataFromServer();
}
