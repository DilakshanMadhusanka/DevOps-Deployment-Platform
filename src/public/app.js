const state = {
  deployments: [],
  pipelines: [],
  images: [],
  alerts: [],
  alertRules: [],
  logs: [],
  metricsSeries: [],
  cluster: null
};

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initModalsAndActions();
  loadInitialOverview();
  loadLogs();
  connectEventStream();
});

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
}

function initModalsAndActions() {
  const modal = document.getElementById('pipeline-modal');
  const openBtn = document.getElementById('btn-open-pipeline-modal');
  const inlineBtn = document.getElementById('btn-trigger-pipeline-inline');
  const closeBtn = document.getElementById('btn-close-modal');
  const cancelBtn = document.getElementById('btn-cancel-modal');
  const form = document.getElementById('form-trigger-pipeline');

  const openModal = () => modal.classList.remove('hidden');
  const closeModal = () => modal.classList.add('hidden');

  openBtn?.addEventListener('click', openModal);
  inlineBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const service = document.getElementById('modal-service').value;
    const branch = document.getElementById('modal-branch').value;
    const imageTag = document.getElementById('modal-tag').value.trim() || undefined;
    const commitMessage = document.getElementById('modal-message').value;
    const deployToK8s = document.getElementById('modal-deploy-k8s').checked;

    closeModal();
    await triggerPipeline({ service, branch, imageTag, commitMessage, deployToK8s });
  });

  document.getElementById('pipeline-service-filter')?.addEventListener('change', () => {
    renderPipelines();
  });

  document.getElementById('btn-build-docker-image')?.addEventListener('click', async () => {
    const service = document.getElementById('build-image-service').value;
    const tagInput = document.getElementById('build-image-tag');
    const tag = tagInput.value.trim() || undefined;
    try {
      const res = await fetch('/api/registry/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, tag })
      });
      const data = await res.json();
      if (res.ok) {
        tagInput.value = '';
        state.images.unshift(data.image);
        renderRegistryImages();
        updateKpiCards();
        showToast(`Built & published ${data.image.repository}:${data.image.tag}`);
      }
    } catch (err) {
      showToast(`Build error: ${err.message}`);
    }
  });

  document.getElementById('btn-simulate-alert')?.addEventListener('click', async () => {
    const samples = [
      {
        ruleName: 'HighHttp5xxErrorRate',
        severity: 'critical',
        service: 'payment-gateway-api',
        pod: 'payment-gateway-api-7b9d4c-x8k2m',
        value: '2.84% 5xx rate (SLO < 2.0%)',
        summary: 'Spike in upstream HTTP 502 responses detected by Nginx ingress controller'
      },
      {
        ruleName: 'IngressHighP95Latency',
        severity: 'warning',
        service: 'order-orchestrator',
        pod: 'order-orchestrator-9d1e4f-p2q9w',
        value: '312ms P95 latency',
        summary: 'P95 response latency exceeded 250ms threshold for 3m window'
      }
    ];
    const pick = samples[Math.floor(Math.random() * samples.length)];
    const res = await fetch('/api/alerts/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pick)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Prometheus Alert Fired: ${data.alert.ruleName}`);
    }
  });

  // Log filtering listeners
  ['log-level-filter', 'log-component-filter', 'log-search-input'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => loadLogs());
    document.getElementById(id)?.addEventListener('change', () => loadLogs());
  });
}

async function loadInitialOverview() {
  try {
    const res = await fetch('/api/overview');
    const data = await res.json();

    state.cluster = data.cluster;
    state.deployments = data.deployments || [];
    state.pipelines = data.pipelines || [];
    state.images = data.images || [];
    state.alerts = data.alerts || [];
    state.alertRules = data.alertRules || [];
    state.metricsSeries = data.metrics?.series || [];

    document.getElementById('platform-version').textContent = `v${data.platform.version}`;
    document.getElementById('cluster-badge').textContent = data.cluster.clusterName;

    updateKpiCards(data.logStats);
    renderDeployments();
    renderPipelines();
    renderRegistryImages();
    renderAlerts();
    renderTelemetryCharts();
  } catch (err) {
    showToast(`Failed to load overview: ${err.message}`);
  }
}

async function loadLogs() {
  const level = document.getElementById('log-level-filter')?.value || 'ALL';
  const component = document.getElementById('log-component-filter')?.value || 'ALL';
  const search = document.getElementById('log-search-input')?.value || '';

  const params = new URLSearchParams({ level, component, search, limit: '120' });
  const res = await fetch(`/api/logs?${params.toString()}`);
  const data = await res.json();
  state.logs = data.logs || [];
  renderLogs();
}

function connectEventStream() {
  const es = new EventSource('/api/stream');
  const dot = document.getElementById('sse-dot');
  const statusEl = document.getElementById('sse-status');

  es.addEventListener('connected', () => {
    if (dot) dot.className = 'dot dot-green';
    if (statusEl) statusEl.textContent = 'Stream Connected';
  });

  es.addEventListener('deployment', (ev) => {
    const updated = JSON.parse(ev.data);
    const idx = state.deployments.findIndex((d) => d.service === updated.service);
    if (idx !== -1) state.deployments[idx] = updated;
    else state.deployments.push(updated);
    renderDeployments();
    updateKpiCards();
  });

  es.addEventListener('pipeline', (ev) => {
    const updated = JSON.parse(ev.data);
    const idx = state.pipelines.findIndex((p) => p.id === updated.id);
    if (idx !== -1) state.pipelines[idx] = updated;
    else state.pipelines.unshift(updated);
    renderPipelines();
    updateKpiCards();
    if (updated.status === 'SUCCEEDED') {
      fetch('/api/registry/images')
        .then((r) => r.json())
        .then((d) => {
          state.images = d.images || [];
          renderRegistryImages();
          updateKpiCards();
        });
    }
  });

  es.addEventListener('alert', (ev) => {
    const alert = JSON.parse(ev.data);
    const idx = state.alerts.findIndex((a) => a.id === alert.id);
    if (idx !== -1) state.alerts[idx] = alert;
    else state.alerts.unshift(alert);
    renderAlerts();
    updateKpiCards();
  });

  es.addEventListener('log', (ev) => {
    const entry = JSON.parse(ev.data);
    state.logs.unshift(entry);
    if (state.logs.length > 150) state.logs.pop();
    renderLogs();
  });

  es.addEventListener('metrics', (ev) => {
    const point = JSON.parse(ev.data);
    state.metricsSeries.push(point);
    if (state.metricsSeries.length > 40) state.metricsSeries.shift();
    renderTelemetryCharts();
    updateKpiCards();
  });

  es.onerror = () => {
    if (dot) dot.className = 'dot dot-amber';
    if (statusEl) statusEl.textContent = 'Reconnecting...';
  };
}

function updateKpiCards(logStats) {
  let desired = 0;
  let ready = 0;
  let healthyDeps = 0;
  state.deployments.forEach((d) => {
    desired += d.replicas.desired;
    ready += d.replicas.ready;
    if (d.status === 'Healthy') healthyDeps += 1;
  });

  document.getElementById('kpi-pods-ready').textContent = `${ready} / ${desired}`;
  document.getElementById('kpi-deployments-healthy').textContent = `${healthyDeps}/${state.deployments.length} Healthy`;

  const succeededPipes = state.pipelines.filter((p) => p.status === 'SUCCEEDED').length;
  const passRate = state.pipelines.length ? ((succeededPipes / state.pipelines.length) * 100).toFixed(1) : '100.0';
  document.getElementById('kpi-pipeline-rate').textContent = `${passRate}% Pass`;
  document.getElementById('kpi-pipeline-total').textContent = `${113 + state.pipelines.length} Runs`;
  if (state.pipelines[0]) {
    document.getElementById('kpi-latest-pipeline').textContent =
      `Latest: ${state.pipelines[0].id} (${state.pipelines[0].status})`;
  }

  document.getElementById('kpi-images-count').textContent = `${state.images.length} Artifacts`;

  const latestMetric = state.metricsSeries[state.metricsSeries.length - 1];
  if (latestMetric) {
    document.getElementById('kpi-rps').textContent = latestMetric.requestRateRps.toLocaleString();
    document.getElementById('kpi-p95').textContent = `${latestMetric.p95LatencyMs} ms`;
    document.getElementById('kpi-err-rate').textContent = `${latestMetric.errorRatePercent}% 5xx`;
  }

  const firingAlerts = state.alerts.filter((a) => a.status === 'firing').length;
  const alertBadge = document.getElementById('kpi-alert-badge');
  alertBadge.textContent = `${firingAlerts} Firing`;
  alertBadge.className = `badge ${firingAlerts > 0 ? 'badge-amber' : 'badge-green'}`;
  document.getElementById('kpi-alerts-firing').textContent = `${firingAlerts} Active`;

  if (logStats) {
    document.getElementById('kpi-log-count').textContent = `${logStats.total} Structured Logs indexed`;
  }
}

function renderDeployments() {
  const container = document.getElementById('k8s-deployments-list');
  if (!container) return;

  container.innerHTML = state.deployments
    .map((dep) => {
      const statusBadgeClass =
        dep.status === 'Healthy'
          ? 'badge-green'
          : dep.status === 'RollingUpdate'
          ? 'badge-cyan'
          : 'badge-amber';

      const podsHtml = dep.pods
        .map(
          (pod) =>
            `<span class="pod-chip" title="Node: ${pod.node} (${pod.zone}) | CPU: ${pod.cpuMillicores}m | Mem: ${pod.memoryMiB}Mi">
              <span class="dot dot-green"></span>
              ${escapeHtml(pod.name)} (${escapeHtml(pod.version)})
            </span>`
        )
        .join('');

      const historyHtml = dep.revisionHistory
        .slice(0, 3)
        .map(
          (rev) => `
          <div class="revision-row">
            <div>
              <strong>Rev #${rev.revision}</strong> &bull; <code>${escapeHtml(rev.image.split(':')[1] || rev.image)}</code>
              <span style="color:var(--text-muted); margin-left:6px;">(${escapeHtml(rev.commitSha)})</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge ${rev.status === 'Active' ? 'badge-green' : 'badge-outline'}">${escapeHtml(rev.status)}</span>
              ${
                rev.revision !== dep.currentRevision
                  ? `<button class="btn btn-ghost btn-sm" onclick="rollbackToRevision('${dep.service}', ${rev.revision})">Rollback to #${rev.revision}</button>`
                  : ''
              }
            </div>
          </div>`
        )
        .join('');

      return `
      <article class="dep-card">
        <div class="dep-header">
          <div>
            <div class="dep-title-row">
              <span class="dep-title">${escapeHtml(dep.service)}</span>
              <span class="badge ${statusBadgeClass}">${escapeHtml(dep.status)} (${dep.rolloutProgress}%)</span>
              <span class="badge badge-outline">Rev #${dep.currentRevision}</span>
            </div>
            <div class="dep-image">${escapeHtml(dep.image)}</div>
          </div>
          <div class="dep-actions">
            <button class="btn btn-primary btn-sm" onclick="triggerRollingUpdateAction('${dep.service}')">
              &#8635; Rolling Update
            </button>
            <button class="btn btn-amber btn-sm" onclick="rollbackToRevision('${dep.service}')">
              &#9100; Instant Rollback
            </button>
            <button class="btn btn-ghost btn-sm" onclick="scaleDeploymentAction('${dep.service}', ${dep.replicas.desired === 4 ? 6 : 4})">
              Scale (${dep.replicas.desired} &rarr; ${dep.replicas.desired === 4 ? 6 : 4})
            </button>
          </div>
        </div>

        <div class="dep-meta-grid">
          <div class="meta-item">
            <span class="meta-label">Replicas (Ready/Desired)</span>
            <span class="meta-val">${dep.replicas.ready} / ${dep.replicas.desired} Pods</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Liveness &amp; Readiness</span>
            <span class="meta-val" style="color:#34d399;">${dep.healthProbes.liveness.status} (200 OK)</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">HPA Autoscaler</span>
            <span class="meta-val">${dep.hpa.minReplicas}-${dep.hpa.maxReplicas} pods (${dep.hpa.currentCpuUtilization}% CPU)</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Nginx Upstream</span>
            <span class="meta-val">${escapeHtml(dep.nginxIngress.host)}</span>
          </div>
        </div>

        <div>
          <div class="revisions-title">Active Kubernetes Pods (${dep.pods.length})</div>
          <div class="pods-strip">${podsHtml}</div>
        </div>

        <div class="revisions-box">
          <div class="revisions-title">ReplicaSet Revision History &amp; One-Click Rollback</div>
          ${historyHtml}
        </div>
      </article>`;
    })
    .join('');
}

function renderPipelines() {
  const container = document.getElementById('pipelines-list');
  const filter = document.getElementById('pipeline-service-filter')?.value || 'ALL';
  if (!container) return;

  const list = filter === 'ALL' ? state.pipelines : state.pipelines.filter((p) => p.service === filter);

  container.innerHTML = list
    .map((pipe) => {
      const badgeClass =
        pipe.status === 'SUCCEEDED'
          ? 'badge-green'
          : pipe.status === 'RUNNING'
          ? 'badge-cyan'
          : 'badge-rose';

      const stagesHtml = pipe.stages
        .map(
          (st) => `
          <div class="stage-step ${st.status}">
            <div class="stage-header">
              <span>${escapeHtml(st.name)}</span>
              <span class="badge ${
                st.status === 'SUCCEEDED'
                  ? 'badge-green'
                  : st.status === 'RUNNING'
                  ? 'badge-cyan'
                  : st.status === 'FAILED'
                  ? 'badge-rose'
                  : 'badge-outline'
              }">${st.status}</span>
            </div>
            <div class="stage-summary">${escapeHtml(st.summary)}</div>
          </div>`
        )
        .join('');

      return `
      <div class="pipeline-card">
        <div class="pipeline-top">
          <div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <strong>#${pipe.runNumber} (${escapeHtml(pipe.id)})</strong>
              <span class="badge ${badgeClass}">${pipe.status}</span>
              <code>${escapeHtml(pipe.service)}:${escapeHtml(pipe.imageTag)}</code>
              <span class="badge badge-outline">branch: ${escapeHtml(pipe.branch)} (${escapeHtml(pipe.commitSha)})</span>
            </div>
            <div class="pipeline-meta">
              ${escapeHtml(pipe.commitMessage)} &bull; Triggered by <strong>${escapeHtml(pipe.author)}</strong> &bull; Duration: <strong>${pipe.durationSeconds}s</strong>
            </div>
          </div>
        </div>
        <div class="stages-track">${stagesHtml}</div>
      </div>`;
    })
    .join('');
}

function renderRegistryImages() {
  const tbody = document.getElementById('registry-images-tbody');
  if (!tbody) return;

  tbody.innerHTML = state.images
    .map(
      (img) => `
      <tr>
        <td><strong>${escapeHtml(img.repository)}:${escapeHtml(img.tag)}</strong></td>
        <td><code>${escapeHtml(img.digest.substring(0, 23))}...</code></td>
        <td><code>${escapeHtml(img.commitSha)}</code></td>
        <td>${escapeHtml(img.architecture)}<br/><small style="color:var(--text-muted)">${escapeHtml(img.baseImage)}</small></td>
        <td>${img.sizeMb} MB</td>
        <td>
          <span class="badge ${img.scanStatus === 'PASSED' ? 'badge-green' : 'badge-amber'}">
            ${img.scanStatus} (0 Crit / ${img.vulnerabilities.high} High)
          </span>
        </td>
        <td><span class="badge badge-cyan">Verified</span></td>
        <td>${new Date(img.publishedAt).toLocaleTimeString()}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="deploySpecificImage('${img.service}', '${img.tag}')">
            Deploy to K8s
          </button>
        </td>
      </tr>`
    )
    .join('');
}

function renderAlerts() {
  const alertsContainer = document.getElementById('alerts-list');
  const rulesContainer = document.getElementById('alert-rules-list');
  if (alertsContainer) {
    alertsContainer.innerHTML = state.alerts
      .map(
        (a) => `
        <div class="alert-item ${a.status === 'resolved' ? 'resolved' : a.severity}">
          <div class="alert-top">
            <div>
              <strong>${escapeHtml(a.ruleName)}</strong>
              <span class="badge ${
                a.status === 'resolved'
                  ? 'badge-green'
                  : a.severity === 'critical'
                  ? 'badge-rose'
                  : 'badge-amber'
              }">${a.status.toUpperCase()}</span>
            </div>
            <code>${escapeHtml(a.value)}</code>
          </div>
          <div class="alert-summary">${escapeHtml(a.summary)} (service: <code>${escapeHtml(a.service)}</code>)</div>
          <div class="alert-actions">
            <span>Pod: ${escapeHtml(a.pod)}</span>
            <div style="display:flex; gap:6px;">
              ${
                a.status === 'firing'
                  ? `<button class="btn btn-ghost btn-sm" onclick="ackAlert('${a.id}')">Acknowledge</button>`
                  : ''
              }
              ${
                a.status !== 'resolved'
                  ? `<button class="btn btn-primary btn-sm" onclick="resolveAlertAction('${a.id}')">Resolve</button>`
                  : `<span>Resolved</span>`
              }
            </div>
          </div>
        </div>`
      )
      .join('');
  }

  if (rulesContainer) {
    rulesContainer.innerHTML = state.alertRules
      .map(
        (r) => `
        <div class="rule-row">
          <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
            <strong>${escapeHtml(r.name)}</strong>
            <span class="badge ${r.severity === 'critical' ? 'badge-rose' : 'badge-amber'}">${r.severity} (for ${r.forDuration})</span>
          </div>
          <div style="margin-bottom:3px;"><code>${escapeHtml(r.expr)}</code></div>
          <div style="color:var(--text-secondary);">${escapeHtml(r.summary)}</div>
        </div>`
      )
      .join('');
  }
}

function renderLogs() {
  const container = document.getElementById('logs-terminal');
  if (!container) return;

  container.innerHTML = state.logs
    .map((l) => {
      const time = new Date(l.timestamp).toISOString().substring(11, 23);
      return `
      <div class="log-line ${l.level}">
        <span class="log-ts">${time}</span>
        <span class="log-lvl ${l.level}">[${l.level}]</span>
        <span class="log-comp">[${escapeHtml(l.component)}]</span>
        <span class="log-svc">(${escapeHtml(l.service)})</span>
        <span>${escapeHtml(l.message)}</span>
        <span style="color:var(--text-muted); margin-left:6px;">trace=${escapeHtml(l.traceId)}</span>
      </div>`;
    })
    .join('');
}

function renderTelemetryCharts() {
  const series = state.metricsSeries;
  if (!series || series.length < 2) return;

  const latest = series[series.length - 1];
  document.getElementById('chart-cpu-val').textContent = `${latest.cpuPercent}%`;
  document.getElementById('chart-mem-val').textContent = `${latest.memoryPercent}%`;
  document.getElementById('chart-rps-val').textContent = `${latest.requestRateRps} rps`;
  document.getElementById('chart-lat-val').textContent = `${latest.p95LatencyMs} ms`;

  drawDualLineSvg(
    'svg-chart-resources',
    series.map((p) => p.cpuPercent),
    series.map((p) => p.memoryPercent),
    100,
    '#06b6d4',
    '#8b5cf6'
  );

  drawDualLineSvg(
    'svg-chart-traffic',
    series.map((p) => p.requestRateRps / 22),
    series.map((p) => p.p95LatencyMs * 1.4),
    100,
    '#10b981',
    '#f59e0b'
  );
}

function drawDualLineSvg(svgId, valuesA, valuesB, maxVal, colorA, colorB) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const w = 600;
  const h = 170;
  const pad = 16;

  const buildPath = (arr) =>
    arr
      .map((v, idx) => {
        const x = pad + (idx / Math.max(1, arr.length - 1)) * (w - pad * 2);
        const clamped = Math.max(0, Math.min(maxVal, v));
        const y = h - pad - (clamped / maxVal) * (h - pad * 2);
        return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const pathA = buildPath(valuesA);
  const pathB = buildPath(valuesB);

  svg.innerHTML = `
    <line x1="0" y1="42" x2="${w}" y2="42" stroke="#1e293b" stroke-dasharray="4" />
    <line x1="0" y1="85" x2="${w}" y2="85" stroke="#1e293b" stroke-dasharray="4" />
    <line x1="0" y1="128" x2="${w}" y2="128" stroke="#1e293b" stroke-dasharray="4" />
    <path d="${pathA}" fill="none" stroke="${colorA}" stroke-width="2.5" />
    <path d="${pathB}" fill="none" stroke="${colorB}" stroke-width="2.5" />
  `;
}

// Global Interactive Handlers
window.triggerRollingUpdateAction = async function (service) {
  showToast(`Triggering zero-downtime RollingUpdate for ${service}...`);
  const res = await fetch(`/api/k8s/deployments/${service}/rolling-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: 'dashboard-operator' })
  });
  const data = await res.json();
  if (res.ok) {
    showToast(data.message);
  } else {
    showToast(`Error: ${data.error}`);
  }
};

window.rollbackToRevision = async function (service, targetRevision) {
  showToast(`Executing Kubernetes rollback for ${service}...`);
  const res = await fetch(`/api/k8s/deployments/${service}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetRevision,
      reason: targetRevision ? `Rollback to revision #${targetRevision}` : 'Instant operator rollback via Control Plane'
    })
  });
  const data = await res.json();
  if (res.ok) {
    showToast(data.message);
  } else {
    showToast(`Rollback failed: ${data.error}`);
  }
};

window.scaleDeploymentAction = async function (service, replicas) {
  const res = await fetch(`/api/k8s/deployments/${service}/scale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ replicas })
  });
  const data = await res.json();
  if (res.ok) {
    showToast(data.message);
  }
};

window.deploySpecificImage = async function (service, imageTag) {
  showToast(`Rolling out ${service}:${imageTag} to Kubernetes...`);
  const res = await fetch(`/api/k8s/deployments/${service}/rolling-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageTag, author: 'registry-promote' })
  });
  const data = await res.json();
  if (res.ok) {
    showToast(data.message);
  }
};

window.ackAlert = async function (id) {
  const res = await fetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
  if (res.ok) showToast(`Alert ${id} acknowledged`);
};

window.resolveAlertAction = async function (id) {
  const res = await fetch(`/api/alerts/${id}/resolve`, { method: 'POST' });
  if (res.ok) showToast(`Alert ${id} resolved`);
};

async function triggerPipeline(payload) {
  showToast(`Starting 5-stage CI/CD pipeline for ${payload.service}...`);
  const res = await fetch('/api/pipelines/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (res.ok) {
    showToast(`Pipeline ${data.pipeline.id} running...`);
  }
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
