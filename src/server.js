const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const config = require('./config');
const logService = require('./services/logService');
const metricsService = require('./services/metricsService');
const dockerRegistryService = require('./services/dockerRegistryService');
const kubernetesService = require('./services/kubernetesService');
const pipelineService = require('./services/pipelineService');
const alertService = require('./services/alertService');

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Prometheus HTTP duration tracking middleware
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSeconds = durationNs / 1e9;
    const routePath = req.route ? req.route.path : req.path;
    metricsService.httpRequestDuration.observe(
      {
        method: req.method,
        route: routePath,
        status_code: String(res.statusCode)
      },
      durationSeconds
    );
  });
  next();
});

// Serve frontend SPA assets
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// KUBERNETES HEALTH CHECK PROBES (Liveness, Readiness, Startup)
// ============================================================================
let serviceReady = true;

app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'UP',
    probe: 'liveness',
    service: 'aegis-deploy-platform',
    version: config.version,
    commitSha: config.commitSha,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/health/ready', (req, res) => {
  if (!serviceReady) {
    return res.status(503).json({
      status: 'OUT_OF_SERVICE',
      probe: 'readiness',
      reason: 'Draining connections or dependency check failed'
    });
  }
  const clusterSummary = kubernetesService.getClusterHealthSummary();
  res.status(200).json({
    status: 'READY',
    probe: 'readiness',
    cluster: clusterSummary.clusterName,
    namespace: clusterSummary.namespace,
    deploymentsReady: `${clusterSummary.healthyDeployments}/${clusterSummary.deploymentsCount}`,
    podsReady: `${clusterSummary.totalPodsReady}/${clusterSummary.totalPodsDesired}`,
    timestamp: new Date().toISOString()
  });
});

app.get('/health/startup', (req, res) => {
  res.status(200).json({
    status: 'STARTED',
    probe: 'startup',
    bootTimeSeconds: Number(process.uptime().toFixed(2)),
    executionMode: config.executionMode,
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// PROMETHEUS SCRAPE ENDPOINT (/metrics)
// ============================================================================
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metricsService.getContentType());
    const metrics = await metricsService.getMetricsText();
    res.end(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// PLATFORM OVERVIEW & REAL-TIME SSE STREAM
// ============================================================================
app.get('/api/overview', (req, res) => {
  const deployments = kubernetesService.getAllDeployments();
  const pipelines = pipelineService.listPipelines();
  const images = dockerRegistryService.listImages();
  const alerts = alertService.getAlerts();
  const metricsSummary = metricsService.getDashboardSummary();
  const logStats = logService.getStats();

  res.json({
    platform: {
      name: 'AegisDeploy Production DevOps Platform',
      version: config.version,
      commitSha: config.commitSha,
      executionMode: config.executionMode,
      hostname: config.hostname,
      dockerRegistry: config.dockerRegistry,
      nginxGateway: 'nginx/1.27.2 (TLSv1.3 + Upstreams Active)',
      prometheusScrape: '/metrics (15s interval)',
      grafanaProvisioned: true
    },
    cluster: kubernetesService.getClusterHealthSummary(),
    deployments,
    pipelines: pipelines.slice(0, 12),
    images: images.slice(0, 12),
    alerts,
    alertRules: alertService.getRules(),
    metrics: metricsSummary,
    logStats
  });
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('connected', { timestamp: new Date().toISOString() });

  const onLog = (entry) => sendEvent('log', entry);
  const onPipeline = (pipeline) => sendEvent('pipeline', pipeline);
  const onDeployment = (dep) => sendEvent('deployment', dep);
  const onAlert = (alert) => sendEvent('alert', alert);

  logService.on('log', onLog);
  pipelineService.on('pipeline_updated', onPipeline);
  kubernetesService.on('deployment_updated', onDeployment);
  alertService.on('alert_updated', onAlert);

  const metricsTimer = setInterval(() => {
    const point = metricsService.recordPoint();
    sendEvent('metrics', point);
  }, 5000);

  req.on('close', () => {
    clearInterval(metricsTimer);
    logService.off('log', onLog);
    pipelineService.off('pipeline_updated', onPipeline);
    kubernetesService.off('deployment_updated', onDeployment);
    alertService.off('alert_updated', onAlert);
  });
});

// ============================================================================
// AUTOMATED BUILD & TEST PIPELINE ENDPOINTS
// ============================================================================
app.get('/api/pipelines', (req, res) => {
  const { service } = req.query;
  res.json({
    pipelines: pipelineService.listPipelines(service)
  });
});

app.get('/api/pipelines/:id', (req, res) => {
  const pipeline = pipelineService.getPipelineById(req.params.id);
  if (!pipeline) {
    return res.status(404).json({ error: `Pipeline '${req.params.id}' not found` });
  }
  res.json({ pipeline });
});

app.post('/api/pipelines/trigger', async (req, res) => {
  try {
    const { service, branch, commitSha, commitMessage, author, imageTag, deployToK8s } = req.body || {};
    const pipeline = await pipelineService.triggerPipeline({
      service,
      branch,
      commitSha,
      commitMessage,
      author,
      imageTag,
      deployToK8s: deployToK8s !== false
    });
    res.status(201).json({
      message: `Pipeline ${pipeline.id} triggered for ${pipeline.service}`,
      pipeline
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// DOCKER IMAGE CREATION & REGISTRY PUBLISHING ENDPOINTS
// ============================================================================
app.get('/api/registry/images', (req, res) => {
  const { service } = req.query;
  res.json({
    registry: config.dockerRegistry,
    images: dockerRegistryService.listImages(service)
  });
});

app.post('/api/registry/build', async (req, res) => {
  try {
    const { service, tag, commitSha, architecture } = req.body || {};
    const image = await dockerRegistryService.buildAndPublishImage({
      service,
      tag,
      commitSha,
      architecture
    });
    res.status(201).json({
      message: `Docker image ${image.repository}:${image.tag} built, scanned, and published`,
      image
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// KUBERNETES DEPLOYMENTS, ROLLING UPDATES & ROLLBACK ENDPOINTS
// ============================================================================
app.get('/api/k8s/deployments', (req, res) => {
  res.json({
    cluster: kubernetesService.getClusterHealthSummary(),
    deployments: kubernetesService.getAllDeployments()
  });
});

app.get('/api/k8s/deployments/:service', (req, res) => {
  const dep = kubernetesService.getDeploymentByService(req.params.service);
  if (!dep) {
    return res.status(404).json({ error: `Deployment '${req.params.service}' not found` });
  }
  res.json({ deployment: dep });
});

app.post('/api/k8s/deployments/:service/rolling-update', async (req, res) => {
  try {
    const { imageTag, commitSha, author, replicas } = req.body || {};
    const deployment = await kubernetesService.triggerRollingUpdate(req.params.service, {
      imageTag,
      commitSha,
      author,
      replicas
    });
    res.json({
      message: `RollingUpdate completed for ${deployment.service} to revision #${deployment.currentRevision}`,
      deployment
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/k8s/deployments/:service/rollback', async (req, res) => {
  try {
    const { targetRevision, reason } = req.body || {};
    const result = await kubernetesService.rollbackDeployment(req.params.service, {
      targetRevision,
      reason
    });
    res.json({
      message: `Rolled back ${req.params.service} from revision #${result.rolledBackFromRevision} to #${result.restoredRevision} (active revision #${result.activeRevision})`,
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/k8s/deployments/:service/scale', async (req, res) => {
  try {
    const { replicas } = req.body || {};
    if (replicas === undefined) {
      return res.status(400).json({ error: 'replicas count is required' });
    }
    const deployment = await kubernetesService.scaleDeployment(req.params.service, replicas);
    res.json({
      message: `Scaled ${deployment.service} to ${deployment.replicas.desired} replicas`,
      deployment
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// CENTRALIZED LOGS, METRICS & ALERTS ENDPOINTS
// ============================================================================
app.get('/api/logs', (req, res) => {
  const { level, component, service, search, limit } = req.query;
  res.json({
    stats: logService.getStats(),
    logs: logService.query({ level, component, service, search, limit })
  });
});

app.post('/api/logs', (req, res) => {
  const { level = 'INFO', component = 'custom-ingest', service = 'external-service', message, metadata } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'Log message is required' });
  }
  const entry = logService.log(level, component, message, { service, metadata });
  res.status(201).json({ entry });
});

app.get('/api/metrics/summary', (req, res) => {
  res.json(metricsService.getDashboardSummary());
});

app.get('/api/alerts', (req, res) => {
  const { status } = req.query;
  res.json({
    alerts: alertService.getAlerts({ status }),
    rules: alertService.getRules()
  });
});

app.post('/api/alerts/simulate', (req, res) => {
  const { ruleName, severity, service, pod, value, summary } = req.body || {};
  const alert = alertService.fireAlert({ ruleName, severity, service, pod, value, summary });
  res.status(201).json({
    message: `Alert ${alert.id} triggered`,
    alert
  });
});

app.post('/api/alerts/:id/acknowledge', (req, res) => {
  try {
    const { operator } = req.body || {};
    const alert = alertService.acknowledgeAlert(req.params.id, operator);
    res.json({ message: `Alert ${alert.id} acknowledged`, alert });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/alerts/:id/resolve', (req, res) => {
  try {
    const { operator } = req.body || {};
    const alert = alertService.resolveAlert(req.params.id, operator);
    res.json({ message: `Alert ${alert.id} resolved`, alert });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Fallback for SPA client routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
