const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
const app = require('../src/server');

describe('AegisDeploy Production DevOps Deployment Platform — Test Suite', () => {
  it('GET /health/live returns 200 UP for Kubernetes Liveness Probe', async () => {
    const res = await request(app).get('/health/live');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'UP');
    assert.equal(res.body.probe, 'liveness');
  });

  it('GET /health/ready returns 200 READY for Kubernetes Readiness Probe with cluster summary', async () => {
    const res = await request(app).get('/health/ready');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'READY');
    assert.equal(res.body.probe, 'readiness');
    assert.ok(res.body.podsReady);
  });

  it('GET /health/startup returns 200 STARTED for Kubernetes Startup Probe', async () => {
    const res = await request(app).get('/health/startup');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'STARTED');
  });

  it('GET /metrics exposes OpenMetrics / Prometheus scrape metrics', async () => {
    const res = await request(app).get('/metrics');
    assert.equal(res.status, 200);
    assert.match(res.text, /devops_pipeline_runs_total/);
    assert.match(res.text, /devops_docker_images_published_total/);
    assert.match(res.text, /devops_k8s_deployment_replicas/);
    assert.match(res.text, /devops_k8s_rolling_updates_total/);
    assert.match(res.text, /devops_k8s_rollbacks_total/);
  });

  it('GET /api/overview returns complete DevOps platform state', async () => {
    const res = await request(app).get('/api/overview');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.deployments));
    assert.ok(res.body.deployments.length >= 4);
    assert.ok(Array.isArray(res.body.pipelines));
    assert.ok(Array.isArray(res.body.images));
    assert.ok(Array.isArray(res.body.alerts));
  });

  it('POST /api/registry/build builds, scans, and publishes a new Docker image to registry', async () => {
    const res = await request(app)
      .post('/api/registry/build')
      .send({
        service: 'payment-gateway-api',
        tag: 'v2.4.9-test',
        commitSha: '1234567'
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.image.service, 'payment-gateway-api');
    assert.equal(res.body.image.tag, 'v2.4.9-test');
    assert.equal(res.body.image.scanStatus, 'PASSED');
    assert.equal(res.body.image.signedWithCosign, true);
    assert.match(res.body.image.digest, /^sha256:/);
  });

  it('POST /api/k8s/deployments/:service/rolling-update executes zero-downtime RollingUpdate', async () => {
    const before = await request(app).get('/api/k8s/deployments/auth-identity-service');
    const prevRevision = before.body.deployment.currentRevision;

    const res = await request(app)
      .post('/api/k8s/deployments/auth-identity-service/rolling-update')
      .send({
        imageTag: 'v1.9.3',
        commitSha: 'c0ffee1',
        author: 'test-runner'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.deployment.currentRevision, prevRevision + 1);
    assert.equal(res.body.deployment.status, 'Healthy');
    assert.match(res.body.deployment.image, /:v1\.9\.3$/);
  });

  it('POST /api/k8s/deployments/:service/rollback reverts deployment to previous revision', async () => {
    const res = await request(app)
      .post('/api/k8s/deployments/auth-identity-service/rollback')
      .send({
        reason: 'Automated test rollback verification'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.rolledBackFromRevision);
    assert.ok(res.body.restoredRevision);
    assert.equal(res.body.deployment.status, 'Healthy');
  });

  it('POST /api/pipelines/trigger starts an automated 5-stage build & test pipeline', async () => {
    const res = await request(app)
      .post('/api/pipelines/trigger')
      .send({
        service: 'order-orchestrator',
        branch: 'main',
        commitMessage: 'test: automated pipeline execution',
        deployToK8s: false
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.pipeline.service, 'order-orchestrator');
    assert.equal(res.body.pipeline.stages.length, 5);
  });

  it('Centralized logs & Alertmanager lifecycle endpoints work end-to-end', async () => {
    const logRes = await request(app)
      .post('/api/logs')
      .send({
        level: 'WARN',
        component: 'nginx-ingress',
        service: 'payment-gateway-api',
        message: 'Rate limit threshold approached from 198.51.100.42'
      });
    assert.equal(logRes.status, 201);

    const queryRes = await request(app).get('/api/logs?level=WARN&component=nginx-ingress');
    assert.equal(queryRes.status, 200);
    assert.ok(queryRes.body.logs.length >= 1);

    const alertRes = await request(app)
      .post('/api/alerts/simulate')
      .send({
        ruleName: 'HighHttp5xxErrorRate',
        severity: 'critical',
        service: 'payment-gateway-api',
        value: '3.1% 5xx'
      });
    assert.equal(alertRes.status, 201);
    const alertId = alertRes.body.alert.id;

    const ackRes = await request(app).post(`/api/alerts/${alertId}/acknowledge`);
    assert.equal(ackRes.status, 200);
    assert.equal(ackRes.body.alert.status, 'acknowledged');

    const resolveRes = await request(app).post(`/api/alerts/${alertId}/resolve`);
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.alert.status, 'resolved');
  });
});
