const crypto = require('crypto');
const EventEmitter = require('events');
const config = require('../config');

class LogService extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.maxBuffer = config.logMaxBuffer || 500;
    this.seedInitialLogs();
  }

  seedInitialLogs() {
    const now = Date.now();
    const initialEntries = [
      {
        offsetMs: -320000,
        level: 'INFO',
        component: 'k8s-controller',
        service: 'payment-gateway-api',
        traceId: 'tr-88f10a2',
        message: 'Deployment payment-gateway-api synced with replicaSet payment-gateway-api-7b9d4c (4/4 pods ready)',
        metadata: { namespace: 'production', revision: 14, image: 'ghcr.io/devops-platform/payment-gateway-api:v2.4.0' }
      },
      {
        offsetMs: -260000,
        level: 'INFO',
        component: 'docker-registry',
        service: 'auth-identity-service',
        traceId: 'tr-91b33c4',
        message: 'Pushed multi-arch manifest sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 to ghcr.io',
        metadata: { sizeMb: 68.4, layers: 9, vulnerabilityScan: '0 critical, 0 high' }
      },
      {
        offsetMs: -195000,
        level: 'INFO',
        component: 'nginx-ingress',
        service: 'order-orchestrator',
        traceId: 'tr-44e92d1',
        message: 'Upstream pool reloaded: 3 active endpoints healthy, weight=100, keepalive=64',
        metadata: { upstream: 'order_orchestrator_prod', p99LatencyMs: 24.6 }
      },
      {
        offsetMs: -140000,
        level: 'WARN',
        component: 'prometheus-alertmanager',
        service: 'realtime-telemetry-ingest',
        traceId: 'tr-72c01f9',
        message: 'HighMemoryPressure warning on pod realtime-telemetry-ingest-5c8b9-x4k2p (81.4% of 1024Mi limit)',
        metadata: { pod: 'realtime-telemetry-ingest-5c8b9-x4k2p', metric: 'container_memory_working_set_bytes' }
      },
      {
        offsetMs: -80000,
        level: 'INFO',
        component: 'github-actions-runner',
        service: 'payment-gateway-api',
        traceId: 'tr-53a88e0',
        message: 'CI/CD Pipeline #1042 completed all 5 stages (Lint, Unit Tests, Docker Build, Trivy Scan, K8s Rollout) in 41.2s',
        metadata: { pipelineId: 'pipe-1042', branch: 'main', commit: 'a9f4c82' }
      },
      {
        offsetMs: -30000,
        level: 'INFO',
        component: 'health-probe',
        service: 'platform-control-plane',
        traceId: 'tr-19d77b3',
        message: 'Liveness (/health/live) and Readiness (/health/ready) probes verified across 14 active cluster pods',
        metadata: { healthyPods: 14, totalPods: 14, cluster: config.kubernetesCluster }
      }
    ];

    initialEntries.forEach((item) => {
      this.logs.push({
        id: crypto.randomUUID(),
        timestamp: new Date(now + item.offsetMs).toISOString(),
        level: item.level,
        component: item.component,
        service: item.service,
        traceId: item.traceId,
        message: item.message,
        metadata: item.metadata || {}
      });
    });
  }

  log(level, component, message, options = {}) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: (level || 'INFO').toUpperCase(),
      component: component || 'control-plane',
      service: options.service || 'platform-core',
      traceId: options.traceId || `tr-${Math.random().toString(16).substring(2, 9)}`,
      message,
      metadata: options.metadata || {}
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxBuffer) {
      this.logs.shift();
    }

    if (config.nodeEnv !== 'test') {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    }

    this.emit('log', entry);
    return entry;
  }

  info(component, message, options = {}) {
    return this.log('INFO', component, message, options);
  }

  warn(component, message, options = {}) {
    return this.log('WARN', component, message, options);
  }

  error(component, message, options = {}) {
    return this.log('ERROR', component, message, options);
  }

  query({ level, component, service, search, limit = 100 } = {}) {
    let filtered = [...this.logs];

    if (level && level !== 'ALL') {
      filtered = filtered.filter((l) => l.level === level.toUpperCase());
    }
    if (component && component !== 'ALL') {
      filtered = filtered.filter((l) => l.component === component);
    }
    if (service && service !== 'ALL') {
      filtered = filtered.filter((l) => l.service === service);
    }
    if (search && search.trim() !== '') {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (l) =>
          l.message.toLowerCase().includes(q) ||
          l.service.toLowerCase().includes(q) ||
          l.component.toLowerCase().includes(q) ||
          l.traceId.toLowerCase().includes(q)
      );
    }

    return filtered.slice(-Math.min(Number(limit) || 100, 500)).reverse();
  }

  getStats() {
    const counts = { INFO: 0, WARN: 0, ERROR: 0, total: this.logs.length };
    this.logs.forEach((l) => {
      if (counts[l.level] !== undefined) counts[l.level] += 1;
    });
    return counts;
  }
}

module.exports = new LogService();
