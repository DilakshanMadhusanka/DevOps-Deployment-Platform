const client = require('prom-client');
const config = require('../config');

class MetricsService {
  constructor() {
    this.register = new client.Registry();
    this.register.setDefaultLabels({
      app: 'aegis-deploy-platform',
      environment: config.nodeEnv,
      cluster: config.kubernetesCluster
    });

    client.collectDefaultMetrics({ register: this.register, prefix: 'devops_node_' });

    this.httpRequestDuration = new client.Histogram({
      name: 'devops_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds across control plane and ingress',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.register]
    });

    this.pipelineRunsTotal = new client.Counter({
      name: 'devops_pipeline_runs_total',
      help: 'Total number of automated build and test pipeline executions',
      labelNames: ['service', 'branch', 'status'],
      registers: [this.register]
    });

    this.pipelineDurationSeconds = new client.Histogram({
      name: 'devops_pipeline_duration_seconds',
      help: 'Build, test, and deployment pipeline execution time in seconds',
      labelNames: ['service', 'stage'],
      buckets: [1, 2, 5, 10, 20, 30, 60, 120],
      registers: [this.register]
    });

    this.dockerImagesPublishedTotal = new client.Counter({
      name: 'devops_docker_images_published_total',
      help: 'Total Docker images built, scanned, and published to registry',
      labelNames: ['service', 'registry', 'scan_status'],
      registers: [this.register]
    });

    this.k8sDeploymentReplicas = new client.Gauge({
      name: 'devops_k8s_deployment_replicas',
      help: 'Kubernetes deployment replica counts by state',
      labelNames: ['service', 'namespace', 'state'], // desired, ready, available, updated
      registers: [this.register]
    });

    this.k8sRollbacksTotal = new client.Counter({
      name: 'devops_k8s_rollbacks_total',
      help: 'Total number of Kubernetes deployment rollbacks executed',
      labelNames: ['service', 'namespace', 'reason'],
      registers: [this.register]
    });

    this.k8sRollingUpdatesTotal = new client.Counter({
      name: 'devops_k8s_rolling_updates_total',
      help: 'Total number of Kubernetes rolling updates triggered',
      labelNames: ['service', 'namespace', 'strategy'],
      registers: [this.register]
    });

    this.activeAlertsGauge = new client.Gauge({
      name: 'devops_active_alerts_count',
      help: 'Number of currently active platform alerts by severity',
      labelNames: ['severity'], // critical, warning, info
      registers: [this.register]
    });

    this.clusterResourceUtilization = new client.Gauge({
      name: 'devops_cluster_resource_utilization_percent',
      help: 'Kubernetes cluster resource utilization percentage',
      labelNames: ['resource'], // cpu, memory, disk, network_ingress
      registers: [this.register]
    });

    // Time-series history ring buffer for real-time Grafana-style charts in dashboard
    this.timeSeriesHistory = [];
    this.seedInitialMetrics();
  }

  seedInitialMetrics() {
    // Seed initial Prometheus counters
    this.pipelineRunsTotal.inc({ service: 'payment-gateway-api', branch: 'main', status: 'succeeded' }, 48);
    this.pipelineRunsTotal.inc({ service: 'auth-identity-service', branch: 'main', status: 'succeeded' }, 36);
    this.pipelineRunsTotal.inc({ service: 'order-orchestrator', branch: 'main', status: 'succeeded' }, 29);
    this.pipelineRunsTotal.inc({ service: 'realtime-telemetry-ingest', branch: 'feat/batch-stream', status: 'failed' }, 3);

    this.dockerImagesPublishedTotal.inc({ service: 'payment-gateway-api', registry: config.dockerRegistry, scan_status: 'passed' }, 48);
    this.dockerImagesPublishedTotal.inc({ service: 'auth-identity-service', registry: config.dockerRegistry, scan_status: 'passed' }, 36);
    this.dockerImagesPublishedTotal.inc({ service: 'order-orchestrator', registry: config.dockerRegistry, scan_status: 'passed' }, 29);
    this.dockerImagesPublishedTotal.inc({ service: 'realtime-telemetry-ingest', registry: config.dockerRegistry, scan_status: 'warning' }, 19);

    this.k8sRollingUpdatesTotal.inc({ service: 'payment-gateway-api', namespace: 'production', strategy: 'RollingUpdate' }, 14);
    this.k8sRollingUpdatesTotal.inc({ service: 'auth-identity-service', namespace: 'production', strategy: 'RollingUpdate' }, 11);
    this.k8sRollingUpdatesTotal.inc({ service: 'order-orchestrator', namespace: 'production', strategy: 'RollingUpdate' }, 9);
    this.k8sRollbacksTotal.inc({ service: 'realtime-telemetry-ingest', namespace: 'production', reason: 'ReadinessProbeFailed' }, 2);

    this.clusterResourceUtilization.set({ resource: 'cpu' }, 46.8);
    this.clusterResourceUtilization.set({ resource: 'memory' }, 62.4);
    this.clusterResourceUtilization.set({ resource: 'disk' }, 38.1);
    this.clusterResourceUtilization.set({ resource: 'network_ingress' }, 54.2);

    const now = Date.now();
    for (let i = 24; i >= 0; i--) {
      const ts = new Date(now - i * 15000).toISOString();
      const wave = Math.sin(i * 0.45);
      this.timeSeriesHistory.push({
        timestamp: ts,
        cpuPercent: Number((46 + wave * 8 + (Math.random() * 3 - 1.5)).toFixed(1)),
        memoryPercent: Number((62 + Math.cos(i * 0.3) * 5 + (Math.random() * 2 - 1)).toFixed(1)),
        requestRateRps: Math.round(1420 + wave * 280 + (Math.random() * 90 - 45)),
        p95LatencyMs: Number((28 + Math.abs(wave) * 14 + Math.random() * 4).toFixed(1)),
        errorRatePercent: Number((0.12 + Math.max(0, wave * 0.15)).toFixed(2))
      });
    }
  }

  recordPoint(override = {}) {
    const last = this.timeSeriesHistory[this.timeSeriesHistory.length - 1] || {
      cpuPercent: 46,
      memoryPercent: 62,
      requestRateRps: 1400,
      p95LatencyMs: 29,
      errorRatePercent: 0.12
    };

    const nextCpu = Math.min(96, Math.max(18, Number((last.cpuPercent + (Math.random() * 4 - 2)).toFixed(1))));
    const nextMem = Math.min(95, Math.max(30, Number((last.memoryPercent + (Math.random() * 2.4 - 1.2)).toFixed(1))));
    const nextRps = Math.max(400, Math.round(last.requestRateRps + (Math.random() * 120 - 60)));
    const nextLat = Math.max(12, Number((last.p95LatencyMs + (Math.random() * 5 - 2.5)).toFixed(1)));
    const nextErr = Math.max(0.01, Math.min(8.5, Number((last.errorRatePercent + (Math.random() * 0.08 - 0.04)).toFixed(2))));

    const point = {
      timestamp: new Date().toISOString(),
      cpuPercent: override.cpuPercent ?? nextCpu,
      memoryPercent: override.memoryPercent ?? nextMem,
      requestRateRps: override.requestRateRps ?? nextRps,
      p95LatencyMs: override.p95LatencyMs ?? nextLat,
      errorRatePercent: override.errorRatePercent ?? nextErr
    };

    this.clusterResourceUtilization.set({ resource: 'cpu' }, point.cpuPercent);
    this.clusterResourceUtilization.set({ resource: 'memory' }, point.memoryPercent);

    this.timeSeriesHistory.push(point);
    if (this.timeSeriesHistory.length > 40) {
      this.timeSeriesHistory.shift();
    }
    return point;
  }

  updateDeploymentGauges(deployments) {
    deployments.forEach((dep) => {
      this.k8sDeploymentReplicas.set(
        { service: dep.service, namespace: dep.namespace, state: 'desired' },
        dep.replicas.desired
      );
      this.k8sDeploymentReplicas.set(
        { service: dep.service, namespace: dep.namespace, state: 'ready' },
        dep.replicas.ready
      );
      this.k8sDeploymentReplicas.set(
        { service: dep.service, namespace: dep.namespace, state: 'available' },
        dep.replicas.available
      );
      this.k8sDeploymentReplicas.set(
        { service: dep.service, namespace: dep.namespace, state: 'updated' },
        dep.replicas.updated
      );
    });
  }

  updateAlertGauges(alerts) {
    const counts = { critical: 0, warning: 0, info: 0 };
    alerts.forEach((a) => {
      if (a.status === 'firing') {
        const sev = (a.severity || 'info').toLowerCase();
        if (counts[sev] !== undefined) counts[sev] += 1;
      }
    });
    this.activeAlertsGauge.set({ severity: 'critical' }, counts.critical);
    this.activeAlertsGauge.set({ severity: 'warning' }, counts.warning);
    this.activeAlertsGauge.set({ severity: 'info' }, counts.info);
  }

  async getMetricsText() {
    return this.register.metrics();
  }

  getContentType() {
    return this.register.contentType;
  }

  getDashboardSummary() {
    const latest = this.recordPoint();
    return {
      current: latest,
      series: this.timeSeriesHistory,
      prometheusScrapeEndpoint: '/metrics',
      grafanaDashboards: [
        {
          uid: 'aegis-devops-overview',
          title: 'AegisDeploy Kubernetes & CI/CD Overview',
          path: 'monitoring/grafana/dashboards/devops-platform-dashboard.json'
        }
      ]
    };
  }
}

module.exports = new MetricsService();
