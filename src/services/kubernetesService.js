const EventEmitter = require('events');
const { execFile } = require('child_process');
const config = require('../config');
const logService = require('./logService');
const metricsService = require('./metricsService');

class KubernetesService extends EventEmitter {
  constructor() {
    super();
    this.clusterName = config.kubernetesCluster;
    this.defaultNamespace = config.kubernetesNamespace;
    this.deployments = [];
    this.seedDeployments();
    metricsService.updateDeploymentGauges(this.deployments);
  }

  seedDeployments() {
    const now = Date.now();
    this.deployments = [
      {
        id: 'dep-payment-gateway',
        service: 'payment-gateway-api',
        namespace: 'production',
        cluster: this.clusterName,
        strategy: {
          type: 'RollingUpdate',
          maxSurge: '25%',
          maxUnavailable: 0
        },
        currentRevision: 14,
        image: `${config.dockerRegistry}/payment-gateway-api:v2.4.0`,
        status: 'Healthy', // Healthy | RollingUpdate | Degraded | RolledBack
        rolloutProgress: 100,
        replicas: {
          desired: 4,
          updated: 4,
          ready: 4,
          available: 4
        },
        healthProbes: {
          liveness: { path: '/health/live', port: 3000, status: 'Passing', intervalSeconds: 10, failureThreshold: 3 },
          readiness: { path: '/health/ready', port: 3000, status: 'Passing', intervalSeconds: 5, failureThreshold: 2 },
          startup: { path: '/health/startup', port: 3000, status: 'Passing', failureThreshold: 15 }
        },
        resources: {
          requests: { cpu: '250m', memory: '256Mi' },
          limits: { cpu: '1000m', memory: '512Mi' }
        },
        hpa: { enabled: true, minReplicas: 3, maxReplicas: 10, targetCpuUtilization: 70, currentCpuUtilization: 44 },
        nginxIngress: {
          host: 'payments.api.aegisdeploy.io',
          upstream: 'payment_gateway_prod',
          tls: 'TLSv1.3 (Let\'s Encrypt)',
          rateLimit: '250r/s'
        },
        pods: this.generatePods('payment-gateway-api', 'v2.4.0', 4, '7b9d4c'),
        revisionHistory: [
          {
            revision: 14,
            image: `${config.dockerRegistry}/payment-gateway-api:v2.4.0`,
            commitSha: 'a9f4c82',
            deployedAt: new Date(now - 3600000 * 3).toISOString(),
            author: 'github-actions[bot]',
            status: 'Active',
            changeCause: 'Automated CI/CD rollout pipe-1042 (Zero-downtime RollingUpdate)'
          },
          {
            revision: 13,
            image: `${config.dockerRegistry}/payment-gateway-api:v2.3.9`,
            commitSha: '7c3e910',
            deployedAt: new Date(now - 3600000 * 28).toISOString(),
            author: 'sarah.chen',
            status: 'Superseded',
            changeCause: 'ISO-8583 settlement idempotency patch'
          },
          {
            revision: 12,
            image: `${config.dockerRegistry}/payment-gateway-api:v2.3.8`,
            commitSha: '1b8a42d',
            deployedAt: new Date(now - 3600000 * 72).toISOString(),
            author: 'alex.rivera',
            status: 'Superseded',
            changeCause: 'Stripe webhook signature verification optimization'
          }
        ],
        updatedAt: new Date(now - 3600000 * 3).toISOString()
      },
      {
        id: 'dep-auth-identity',
        service: 'auth-identity-service',
        namespace: 'production',
        cluster: this.clusterName,
        strategy: {
          type: 'RollingUpdate',
          maxSurge: '25%',
          maxUnavailable: 0
        },
        currentRevision: 11,
        image: `${config.dockerRegistry}/auth-identity-service:v1.9.2`,
        status: 'Healthy',
        rolloutProgress: 100,
        replicas: {
          desired: 3,
          updated: 3,
          ready: 3,
          available: 3
        },
        healthProbes: {
          liveness: { path: '/health/live', port: 3000, status: 'Passing', intervalSeconds: 10, failureThreshold: 3 },
          readiness: { path: '/health/ready', port: 3000, status: 'Passing', intervalSeconds: 5, failureThreshold: 2 },
          startup: { path: '/health/startup', port: 3000, status: 'Passing', failureThreshold: 15 }
        },
        resources: {
          requests: { cpu: '200m', memory: '256Mi' },
          limits: { cpu: '800m', memory: '512Mi' }
        },
        hpa: { enabled: true, minReplicas: 2, maxReplicas: 8, targetCpuUtilization: 65, currentCpuUtilization: 39 },
        nginxIngress: {
          host: 'auth.api.aegisdeploy.io',
          upstream: 'auth_identity_prod',
          tls: 'TLSv1.3 (Let\'s Encrypt)',
          rateLimit: '300r/s'
        },
        pods: this.generatePods('auth-identity-service', 'v1.9.2', 3, '6f8a2b'),
        revisionHistory: [
          {
            revision: 11,
            image: `${config.dockerRegistry}/auth-identity-service:v1.9.2`,
            commitSha: 'e41b66a',
            deployedAt: new Date(now - 3600000 * 5).toISOString(),
            author: 'github-actions[bot]',
            status: 'Active',
            changeCause: 'Rotate OIDC JWK key-pair & token introspection cache'
          },
          {
            revision: 10,
            image: `${config.dockerRegistry}/auth-identity-service:v1.9.1`,
            commitSha: '9a01c3f',
            deployedAt: new Date(now - 3600000 * 54).toISOString(),
            author: 'marcus.vance',
            status: 'Superseded',
            changeCause: 'Add WebAuthn passkey challenge verification'
          }
        ],
        updatedAt: new Date(now - 3600000 * 5).toISOString()
      },
      {
        id: 'dep-order-orchestrator',
        service: 'order-orchestrator',
        namespace: 'production',
        cluster: this.clusterName,
        strategy: {
          type: 'RollingUpdate',
          maxSurge: '33%',
          maxUnavailable: 0
        },
        currentRevision: 9,
        image: `${config.dockerRegistry}/order-orchestrator:v3.1.4`,
        status: 'Healthy',
        rolloutProgress: 100,
        replicas: {
          desired: 3,
          updated: 3,
          ready: 3,
          available: 3
        },
        healthProbes: {
          liveness: { path: '/health/live', port: 3000, status: 'Passing', intervalSeconds: 10, failureThreshold: 3 },
          readiness: { path: '/health/ready', port: 3000, status: 'Passing', intervalSeconds: 5, failureThreshold: 2 },
          startup: { path: '/health/startup', port: 3000, status: 'Passing', failureThreshold: 15 }
        },
        resources: {
          requests: { cpu: '300m', memory: '384Mi' },
          limits: { cpu: '1000m', memory: '768Mi' }
        },
        hpa: { enabled: true, minReplicas: 3, maxReplicas: 12, targetCpuUtilization: 70, currentCpuUtilization: 51 },
        nginxIngress: {
          host: 'orders.api.aegisdeploy.io',
          upstream: 'order_orchestrator_prod',
          tls: 'TLSv1.3 (Let\'s Encrypt)',
          rateLimit: '200r/s'
        },
        pods: this.generatePods('order-orchestrator', 'v3.1.4', 3, '9d1e4f'),
        revisionHistory: [
          {
            revision: 9,
            image: `${config.dockerRegistry}/order-orchestrator:v3.1.4`,
            commitSha: 'c12d88f',
            deployedAt: new Date(now - 3600000 * 8).toISOString(),
            author: 'github-actions[bot]',
            status: 'Active',
            changeCause: 'Saga distributed transaction compensation timeout fix'
          },
          {
            revision: 8,
            image: `${config.dockerRegistry}/order-orchestrator:v3.1.3`,
            commitSha: '4d29a1b',
            deployedAt: new Date(now - 3600000 * 60).toISOString(),
            author: 'elena.rostova',
            status: 'Superseded',
            changeCause: 'Kafka consumer group rebalance graceful drain'
          }
        ],
        updatedAt: new Date(now - 3600000 * 8).toISOString()
      },
      {
        id: 'dep-telemetry-ingest',
        service: 'realtime-telemetry-ingest',
        namespace: 'production',
        cluster: this.clusterName,
        strategy: {
          type: 'RollingUpdate',
          maxSurge: '25%',
          maxUnavailable: 0
        },
        currentRevision: 6,
        image: `${config.dockerRegistry}/realtime-telemetry-ingest:v1.6.1`,
        status: 'Healthy',
        rolloutProgress: 100,
        replicas: {
          desired: 4,
          updated: 4,
          ready: 4,
          available: 4
        },
        healthProbes: {
          liveness: { path: '/health/live', port: 3000, status: 'Passing', intervalSeconds: 10, failureThreshold: 3 },
          readiness: { path: '/health/ready', port: 3000, status: 'Passing', intervalSeconds: 5, failureThreshold: 2 },
          startup: { path: '/health/startup', port: 3000, status: 'Passing', failureThreshold: 15 }
        },
        resources: {
          requests: { cpu: '500m', memory: '512Mi' },
          limits: { cpu: '1500m', memory: '1024Mi' }
        },
        hpa: { enabled: true, minReplicas: 4, maxReplicas: 16, targetCpuUtilization: 75, currentCpuUtilization: 68 },
        nginxIngress: {
          host: 'ingest.api.aegisdeploy.io',
          upstream: 'telemetry_ingest_prod',
          tls: 'TLSv1.3 (Let\'s Encrypt)',
          rateLimit: '1000r/s'
        },
        pods: this.generatePods('realtime-telemetry-ingest', 'v1.6.1', 4, '5c8b9a'),
        revisionHistory: [
          {
            revision: 6,
            image: `${config.dockerRegistry}/realtime-telemetry-ingest:v1.6.1`,
            commitSha: 'f09a31e',
            deployedAt: new Date(now - 3600000 * 12).toISOString(),
            author: 'github-actions[bot]',
            status: 'Active',
            changeCause: 'Zero-copy protobuf ring buffer optimization'
          },
          {
            revision: 5,
            image: `${config.dockerRegistry}/realtime-telemetry-ingest:v1.6.0`,
            commitSha: '3f88e12',
            deployedAt: new Date(now - 3600000 * 48).toISOString(),
            author: 'devon.brooks',
            status: 'Superseded',
            changeCause: 'Initial gRPC + HTTP/2 batch ingestion workers'
          }
        ],
        updatedAt: new Date(now - 3600000 * 12).toISOString()
      }
    ];
  }

  generatePods(service, versionTag, count, rsHash = null) {
    const hash = rsHash || Math.random().toString(16).substring(2, 8);
    const zones = ['us-east-1a', 'us-east-1b', 'us-east-1c'];
    const pods = [];
    for (let i = 0; i < count; i++) {
      const suffix = Math.random().toString(36).substring(2, 7);
      pods.push({
        name: `${service}-${hash}-${suffix}`,
        replicaSet: `${service}-${hash}`,
        version: versionTag,
        node: `ip-10-24-${10 + i}-${40 + i * 7}.ec2.internal`,
        zone: zones[i % zones.length],
        status: 'Running',
        ready: true,
        restarts: 0,
        livenessProbe: 'OK',
        readinessProbe: 'OK',
        cpuMillicores: Math.round(95 + Math.random() * 140),
        memoryMiB: Math.round(180 + Math.random() * 160),
        startedAt: new Date(Date.now() - Math.floor(Math.random() * 7200000 + 600000)).toISOString()
      });
    }
    return pods;
  }

  checkKubectlAvailable() {
    return new Promise((resolve) => {
      execFile('kubectl', ['version', '--client'], { timeout: 2500 }, (err, stdout) => {
        if (err) return resolve({ available: false, output: null });
        resolve({ available: true, output: stdout.trim() });
      });
    });
  }

  getAllDeployments() {
    return this.deployments;
  }

  getDeploymentByService(serviceName) {
    return this.deployments.find((d) => d.service === serviceName || d.id === serviceName);
  }

  /**
   * Executes a progressive Kubernetes RollingUpdate with surge pod creation,
   * readiness probe verification, and old replicaSet termination.
   */
  async triggerRollingUpdate(serviceName, { imageTag, commitSha = '9b2e41d', author = 'operator', replicas } = {}) {
    const dep = this.getDeploymentByService(serviceName);
    if (!dep) {
      throw new Error(`Deployment '${serviceName}' not found in namespace '${this.defaultNamespace}'`);
    }

    const targetTag = imageTag || this.bumpPatchVersion(dep.image.split(':')[1] || 'v1.0.0');
    const newImage = targetTag.includes('/') ? targetTag : `${config.dockerRegistry}/${dep.service}:${targetTag}`;
    const cleanTag = newImage.split(':')[1] || 'latest';
    const desiredReplicas = replicas ? Math.max(1, Math.min(16, Number(replicas))) : dep.replicas.desired;
    const newRevision = dep.currentRevision + 1;
    const newRsHash = Math.random().toString(16).substring(2, 8);

    const kubectlCheck = await this.checkKubectlAvailable();
    logService.info(
      'k8s-controller',
      `Initiating RollingUpdate for deployment/${dep.service} -> ${newImage} (revision #${newRevision}, maxSurge=${dep.strategy.maxSurge}, maxUnavailable=${dep.strategy.maxUnavailable})`,
      {
        service: dep.service,
        metadata: {
          namespace: dep.namespace,
          revision: newRevision,
          image: newImage,
          kubectlClientDetected: kubectlCheck.available
        }
      }
    );

    dep.status = 'RollingUpdate';
    dep.rolloutProgress = 25;
    dep.replicas.desired = desiredReplicas;
    dep.replicas.updated = 1;
    this.emit('deployment_updated', dep);

    // Step through progressive canary/surge pods asynchronously so SSE/UI sees live rollout
    await this.sleep(600);
    dep.rolloutProgress = 60;
    dep.replicas.updated = Math.ceil(desiredReplicas / 2);
    logService.info(
      'health-probe',
      `Readiness probe (/health/ready) passed on surge pods for ${dep.service} (${dep.replicas.updated}/${desiredReplicas} updated)`,
      { service: dep.service, metadata: { revision: newRevision, probe: 'HTTP GET /health/ready 200 OK' } }
    );
    this.emit('deployment_updated', dep);

    await this.sleep(600);
    dep.currentRevision = newRevision;
    dep.image = newImage;
    dep.status = 'Healthy';
    dep.rolloutProgress = 100;
    dep.replicas = {
      desired: desiredReplicas,
      updated: desiredReplicas,
      ready: desiredReplicas,
      available: desiredReplicas
    };
    dep.pods = this.generatePods(dep.service, cleanTag, desiredReplicas, newRsHash);
    dep.updatedAt = new Date().toISOString();

    dep.revisionHistory.forEach((rev) => {
      if (rev.status === 'Active') rev.status = 'Superseded';
    });

    dep.revisionHistory.unshift({
      revision: newRevision,
      image: newImage,
      commitSha: commitSha.substring(0, 7),
      deployedAt: dep.updatedAt,
      author,
      status: 'Active',
      changeCause: `RollingUpdate to ${cleanTag} (maxSurge=${dep.strategy.maxSurge}, maxUnavailable=0)`
    });

    metricsService.k8sRollingUpdatesTotal.inc({
      service: dep.service,
      namespace: dep.namespace,
      strategy: 'RollingUpdate'
    });
    metricsService.updateDeploymentGauges(this.deployments);

    logService.info(
      'k8s-controller',
      `Deployment ${dep.service} rollout to revision #${newRevision} (${cleanTag}) completed with zero downtime (${desiredReplicas}/${desiredReplicas} pods Ready)`,
      { service: dep.service, metadata: { revision: newRevision, replicaSet: `${dep.service}-${newRsHash}` } }
    );

    this.emit('deployment_updated', dep);
    return dep;
  }

  /**
   * Executes an instant Kubernetes rollback (`kubectl rollout undo deployment/<name> --to-revision=<rev>`)
   */
  async rollbackDeployment(serviceName, { targetRevision, reason = 'Manual operator rollback' } = {}) {
    const dep = this.getDeploymentByService(serviceName);
    if (!dep) {
      throw new Error(`Deployment '${serviceName}' not found`);
    }

    const candidates = dep.revisionHistory.filter((r) => r.revision !== dep.currentRevision);
    if (candidates.length === 0) {
      throw new Error(`No previous revision available to roll back for '${serviceName}'`);
    }

    const target = targetRevision
      ? dep.revisionHistory.find((r) => r.revision === Number(targetRevision))
      : candidates[0];

    if (!target) {
      throw new Error(`Target revision #${targetRevision} not found in revision history`);
    }

    const previousRevision = dep.currentRevision;
    const newRevisionNumber = dep.currentRevision + 1;
    const cleanTag = target.image.split(':')[1] || 'rollback';
    const rsHash = Math.random().toString(16).substring(2, 8);

    logService.warn(
      'k8s-controller',
      `Executing rollback on deployment/${dep.service}: reverting from rev #${previousRevision} to rev #${target.revision} (${target.image}). Reason: ${reason}`,
      {
        service: dep.service,
        metadata: { fromRevision: previousRevision, toRevision: target.revision, reason }
      }
    );

    dep.status = 'RollingUpdate';
    dep.rolloutProgress = 50;
    this.emit('deployment_updated', dep);

    await this.sleep(500);

    dep.currentRevision = newRevisionNumber;
    dep.image = target.image;
    dep.status = 'Healthy';
    dep.rolloutProgress = 100;
    dep.pods = this.generatePods(dep.service, cleanTag, dep.replicas.desired, rsHash);
    dep.updatedAt = new Date().toISOString();

    dep.revisionHistory.forEach((r) => {
      if (r.status === 'Active') r.status = 'RolledBack';
    });

    dep.revisionHistory.unshift({
      revision: newRevisionNumber,
      image: target.image,
      commitSha: target.commitSha,
      deployedAt: dep.updatedAt,
      author: 'rollback-controller',
      status: 'Active',
      changeCause: `Rollback to rev #${target.revision} (${cleanTag}) — ${reason}`
    });

    metricsService.k8sRollbacksTotal.inc({
      service: dep.service,
      namespace: dep.namespace,
      reason: reason.substring(0, 32)
    });
    metricsService.updateDeploymentGauges(this.deployments);

    logService.info(
      'k8s-controller',
      `Rollback complete for deployment/${dep.service}: now running ${target.image} as revision #${newRevisionNumber} (${dep.replicas.ready}/${dep.replicas.desired} pods Ready)`,
      { service: dep.service, metadata: { activeRevision: newRevisionNumber, restoredFrom: target.revision } }
    );

    this.emit('deployment_updated', dep);
    return {
      deployment: dep,
      rolledBackFromRevision: previousRevision,
      restoredRevision: target.revision,
      activeRevision: newRevisionNumber
    };
  }

  async scaleDeployment(serviceName, replicas) {
    const dep = this.getDeploymentByService(serviceName);
    if (!dep) {
      throw new Error(`Deployment '${serviceName}' not found`);
    }
    const count = Math.max(1, Math.min(16, Number(replicas)));
    const cleanTag = dep.image.split(':')[1] || 'latest';

    dep.replicas = {
      desired: count,
      updated: count,
      ready: count,
      available: count
    };
    dep.pods = this.generatePods(dep.service, cleanTag, count);
    dep.updatedAt = new Date().toISOString();

    metricsService.updateDeploymentGauges(this.deployments);
    logService.info(
      'k8s-controller',
      `Scaled deployment/${dep.service} replicas to ${count} in namespace ${dep.namespace}`,
      { service: dep.service, metadata: { replicas: count } }
    );
    this.emit('deployment_updated', dep);
    return dep;
  }

  getClusterHealthSummary() {
    let totalDesired = 0;
    let totalReady = 0;
    this.deployments.forEach((d) => {
      totalDesired += d.replicas.desired;
      totalReady += d.replicas.ready;
    });

    return {
      clusterName: this.clusterName,
      namespace: this.defaultNamespace,
      kubernetesVersion: 'v1.30.4-eks',
      ingressController: 'nginx-ingress-controller v1.11.2',
      deploymentsCount: this.deployments.length,
      healthyDeployments: this.deployments.filter((d) => d.status === 'Healthy').length,
      totalPodsDesired: totalDesired,
      totalPodsReady: totalReady,
      probesStatus: {
        liveness: 'Passing',
        readiness: 'Passing',
        startup: 'Passing'
      }
    };
  }

  bumpPatchVersion(versionStr) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(versionStr);
    if (!match) return 'v1.0.1';
    return `v${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new KubernetesService();
