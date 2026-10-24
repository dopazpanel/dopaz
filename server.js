const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── FILE STORAGE ──────────────────────────────────────────
const ORDERS_FILE = path.join(__dirname, 'data_orders.json');
const JOBS_FILE   = path.join(__dirname, 'data_jobs.json');
const CONFIG_FILE = path.join(__dirname, 'data_config.json');

function readJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return def; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let orders       = readJSON(ORDERS_FILE, []);
let scheduledJobs = readJSON(JOBS_FILE, []);
let config       = readJSON(CONFIG_FILE, { api_key: '', api_url: 'https://yoyomedia.in/api/v2' });

function saveOrders() { writeJSON(ORDERS_FILE, orders); }
function saveJobs()   { writeJSON(JOBS_FILE, scheduledJobs); }
function saveConfig() { writeJSON(CONFIG_FILE, config); }

// ─── YOYOMEDIA API CALL ────────────────────────────────────
async function yoyoCall(params) {
  if (!config.api_key) return { error: 'API key not set' };
  try {
    const body = new URLSearchParams({ key: config.api_key, ...params });
    const res = await fetch(config.api_url || 'https://yoyomedia.in/api/v2', {
      method: 'POST', body
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

// ─── REST ENDPOINTS ────────────────────────────────────────

// Proxy - for direct API calls from browser (services list, balance, manual orders etc)
app.post('/api', async (req, res) => {
  const data = await yoyoCall(req.body);
  res.json(data);
});

// Config
app.get('/config', (req, res) => res.json({ api_url: config.api_url, api_key_set: !!config.api_key }));
app.post('/config', (req, res) => {
  if (req.body.api_key) config.api_key = req.body.api_key;
  if (req.body.api_url) config.api_url = req.body.api_url;
  saveConfig();
  res.json({ success: true });
});

// Orders
app.get('/orders', (req, res) => res.json(orders));
app.post('/orders/clear', (req, res) => { orders = []; saveOrders(); res.json({ success: true }); });

// Graph data for a link - cumulative time series
app.get('/orders/graph', (req, res) => {
  const link = req.query.link;
  if (!link) return res.json([]);
  const linkOrders = orders.filter(o => o.link === link && o.history && o.history.length);

  const allPoints = [];
  linkOrders.forEach(o => {
    const isLike = (o.note || '').toLowerCase().includes('like') ||
                   ['13626','13639'].includes(String(o.service));
    (o.history || []).forEach(p => {
      allPoints.push({
        t: p.t,
        views: isLike ? 0 : p.delivered,
        likes: isLike ? p.delivered : 0
      });
    });
  });

  allPoints.sort((a, b) => a.t - b.t);

  // build cumulative by merging points close in time (same minute)
  const merged = [];
  allPoints.forEach(p => {
    const last = merged[merged.length - 1];
    if (last && p.t - last.t < 60000) {
      last.views += p.views;
      last.likes += p.likes;
    } else {
      merged.push({ t: p.t, views: p.views, likes: p.likes });
    }
  });

  // cumulative sum
  let cv = 0, cl = 0;
  const result = merged.map(p => {
    cv += p.views; cl += p.likes;
    return { t: p.t, views: cv, likes: cl };
  });

  res.json(result);
});

// Scheduled Jobs
app.get('/jobs', (req, res) => res.json(scheduledJobs));
app.post('/jobs', (req, res) => {
  const newJobs = req.body;
  scheduledJobs = [...scheduledJobs, ...newJobs];
  saveJobs();
  res.json({ success: true, count: newJobs.length });
});
app.post('/jobs/cancel', (req, res) => {
  const job = scheduledJobs.find(j => j.id === req.body.id);
  if (job) { job.status = 'cancelled'; saveJobs(); }
  res.json({ success: true });
});
app.post('/jobs/update-time', (req, res) => {
  const job = scheduledJobs.find(j => j.id === req.body.id);
  if (job && job.status === 'pending') { job.scheduledAt = req.body.scheduledAt; saveJobs(); }
  res.json({ success: true });
});
app.post('/jobs/retry', (req, res) => {
  const job = scheduledJobs.find(j => j.id === req.body.id);
  if (job) {
    job.status = 'retrying';
    job.retryCount = 0;
    job.lastRetryAt = null;
    job.error = null;
    job.waitNote = 'Manually queued for retry';
    saveJobs();
  }
  res.json({ success: true });
});
app.post('/jobs/clear', (req, res) => {
  scheduledJobs = scheduledJobs.filter(j => j.status === 'pending');
  saveJobs();
  res.json({ success: true });
});

// ─── BACKGROUND SCHEDULER ─────────────────────────────────
const PRE_CANCEL_MS    = 2 * 60 * 1000;  // 2 min
const RETRY_INTERVAL_MS = 35 * 1000;     // 35 sec
const TICK_MS          = 15 * 1000;      // 15 sec

async function schedulerTick() {
  const now = Date.now();

  // Step 1: Refresh active placed order statuses
  const activeIds = [
    ...scheduledJobs.filter(j => j.status === 'placed' && j.orderId).map(j => String(j.orderId)),
    ...orders.filter(o => o.status === 'Pending' || o.status === 'In progress').map(o => String(o.id))
  ];
  const uniqueIds = [...new Set(activeIds)];

  if (uniqueIds.length) {
    const statusData = await yoyoCall({ action: 'status', order: uniqueIds.join(',') });
    if (statusData && !statusData.error) {
      Object.entries(statusData).forEach(([id, info]) => {
        if (info.error) return;
        const o = orders.find(x => String(x.id) === String(id));
        if (o) {
          o.status  = info.status  || o.status;
          o.charge  = info.charge  || o.charge;
          o.remains = info.remains !== undefined ? info.remains : o.remains;
          // track history for graph
          if (!o.history) o.history = [];
          const delivered = o.quantity - (parseInt(info.remains) || 0);
          const last = o.history[o.history.length - 1];
          if (!last || last.delivered !== delivered) {
            o.history.push({ t: Date.now(), remains: parseInt(info.remains) || 0, delivered });
          }
        }
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

  // Step 2: Auto-cancel running order if next job is within 2 min
  const upcomingJobs = scheduledJobs.filter(j =>
    j.status === 'pending' &&
    j.scheduledAt > now &&
    j.scheduledAt - now <= PRE_CANCEL_MS
  );

  for (const upcoming of upcomingJobs) {
    const key = `${upcoming.serviceId}|${upcoming.link}`;
    const runningJob = scheduledJobs.find(j =>
      j.status === 'placed' && j.orderId &&
      `${j.serviceId}|${j.link}` === key &&
      (j.placedOrderStatus === 'Pending' || j.placedOrderStatus === 'In progress' || !j.placedOrderStatus)
    );
    if (runningJob) {
      console.log(`[Scheduler] Auto-cancelling order #${runningJob.orderId} for upcoming job`);
      const cancelRes = await yoyoCall({ action: 'cancel', order: runningJob.orderId });
      if (cancelRes && cancelRes.success) {
        runningJob.placedOrderStatus = 'Cancelled';
        runningJob.cancelNote = 'Auto-cancelled for next scheduled order';
        const o = orders.find(x => String(x.id) === String(runningJob.orderId));
        if (o) o.status = 'Cancelled';
        saveOrders();
      }
    }
  }

  // Step 3: Place due pending + retrying jobs
  const toPlace = scheduledJobs.filter(j =>
    (j.status === 'pending' && j.scheduledAt <= now) ||
    (j.status === 'retrying' && (!j.lastRetryAt || now - j.lastRetryAt >= RETRY_INTERVAL_MS))
  ).sort((a, b) => (a.scheduledAt || a.createdAt || 0) - (b.scheduledAt || b.createdAt || 0));

  for (const job of toPlace) {
    job.lastRetryAt = now;
    console.log(`[Scheduler] Placing job ${job.id} | type:${job.type} | qty:${job.quantity}`);
    const data = await yoyoCall({ action: 'add', service: job.serviceId, link: job.link, quantity: job.quantity });

    if (data && data.order) {
      job.status = 'placed';
      job.orderId = data.order;
      job.placedOrderStatus = 'Pending';
      job.retryCount = 0;
      job.waitNote = null;
      console.log(`[Scheduler] ✅ Placed order #${data.order}`);
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
        job.waitNote = `Retrying... attempt #${job.retryCount}`;
        console.log(`[Scheduler] ⏳ Conflict, retrying job ${job.id} attempt #${job.retryCount}`);
      } else {
        job.status = 'failed';
        job.error = data?.error || 'Unknown error';
        console.log(`[Scheduler] ❌ Failed job ${job.id}: ${job.error}`);
      }
    }
  }

  if (toPlace.length || upcomingJobs.length) saveJobs();
}

setInterval(schedulerTick, TICK_MS);
schedulerTick(); // run immediately on start
console.log('⚡ Background scheduler started (15s tick)');

// ─── START SERVER ──────────────────────────────────────────
app.listen(3000, () => console.log('✅ DoPaz Panel running at http://localhost:3000'));
