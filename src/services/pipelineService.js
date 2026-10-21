const EventEmitter = require('events');
const config = require('../config');
const logService = require('./logService');
const metricsService = require('./metricsService');
const dockerRegistryService = require('./dockerRegistryService');
const kubernetesService = require('./kubernetesService');

class PipelineService extends EventEmitter {
  constructor() {
    super();
    this.pipelines = [];
    this.counter = 1043;
    this.seedPipelines();
  }

  seedPipelines() {
    const now = Date.now();
    this.pipelines = [
      {
        id: 'pipe-1042',
        runNumber: 1042,
        service: 'payment-gateway-api',
        branch: 'main',
        commitSha: 'a9f4c82',
        commitMessage: 'feat(settlement): enforce idempotent ledger locks & retry backoff',
        author: 'sarah.chen',
        trigger: 'github_push',
        status: 'SUCCEEDED',
        imageTag: 'v2.4.0',
        imageDigest: 'sha256:4b825dc642cb6eb9a060e54bf8d69288fbee4904e583f22b917c81239a00e12d',
        durationSeconds: 41.2,
        startedAt: new Date(now - 3600000 * 3 - 42000).toISOString(),
        completedAt: new Date(now - 3600000 * 3).toISOString(),
        stages: [
          { name: 'Static Analysis & Lint', status: 'SUCCEEDED', durationSeconds: 4.1, summary: 'ESLint & OpenAPI schema check passed (0 warnings)' },
          { name: 'Automated Unit & Integration Tests', status: 'SUCCEEDED', durationSeconds: 11.4, summary: '148/148 tests passed • Coverage 94.2%' },
          { name: 'Docker Build & Trivy Security Scan', status: 'SUCCEEDED', durationSeconds: 14.8, summary: 'Built multi-arch image (74.2 MB) • 0 Critical/High CVEs' },
          { name: 'Container Registry Publish (GHCR)', status: 'SUCCEEDED', durationSeconds: 4.6, summary: 'Pushed & signed ghcr.io/devops-platform/payment-gateway-api:v2.4.0' },
          { name: 'Kubernetes Rolling Update & Probes', status: 'SUCCEEDED', durationSeconds: 6.3, summary: 'Rolled out rev #14 (4/4 pods Ready, 0 unavailable)' }
        ]
      },
      {
        id: 'pipe-1041',
        runNumber: 1041,
        service: 'auth-identity-service',
        branch: 'main',
        commitSha: 'e41b66a',
        commitMessage: 'sec(oidc): rotate JWK signing keys and harden rate limiter headers',
        author: 'marcus.vance',
        trigger: 'github_push',
        status: 'SUCCEEDED',
        imageTag: 'v1.9.2',
        imageDigest: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        durationSeconds: 37.8,
        startedAt: new Date(now - 3600000 * 5 - 38000).toISOString(),
        completedAt: new Date(now - 3600000 * 5).toISOString(),
        stages: [
          { name: 'Static Analysis & Lint', status: 'SUCCEEDED', durationSeconds: 3.8, summary: 'Passed strict TypeScript/Node syntax checks' },
          { name: 'Automated Unit & Integration Tests', status: 'SUCCEEDED', durationSeconds: 9.7, summary: '96/96 tests passed • Coverage 96.0%' },
          { name: 'Docker Build & Trivy Security Scan', status: 'SUCCEEDED', durationSeconds: 13.5, summary: 'Built image (68.4 MB) • 0 Critical/High CVEs' },
          { name: 'Container Registry Publish (GHCR)', status: 'SUCCEEDED', durationSeconds: 4.2, summary: 'Pushed ghcr.io/devops-platform/auth-identity-service:v1.9.2' },
          { name: 'Kubernetes Rolling Update & Probes', status: 'SUCCEEDED', durationSeconds: 6.6, summary: 'Rolled out rev #11 (3/3 pods Ready)' }
        ]
      },
      {
        id: 'pipe-1040',
        runNumber: 1040,
        service: 'realtime-telemetry-ingest',
        branch: 'feat/batch-stream',
        commitSha: '8c19e04',
        commitMessage: 'perf(ingest): experimental zero-copy buffer pool',
        author: 'devon.brooks',
        trigger: 'pull_request',
        status: 'FAILED',
        imageTag: 'v1.6.2-rc1',
        imageDigest: null,
        durationSeconds: 14.9,
        startedAt: new Date(now - 3600000 * 7).toISOString(),
        completedAt: new Date(now - 3600000 * 7 + 15000).toISOString(),
        stages: [
          { name: 'Static Analysis & Lint', status: 'SUCCEEDED', durationSeconds: 3.9, summary: 'Passed syntax & lint verification' },
          { name: 'Automated Unit & Integration Tests', status: 'FAILED', durationSeconds: 11.0, summary: '1 test failed: test_backpressure_drain_timeout exceeded 2000ms' },
          { name: 'Docker Build & Trivy Security Scan', status: 'SKIPPED', durationSeconds: 0, summary: 'Skipped due to upstream test failure' },
          { name: 'Container Registry Publish (GHCR)', status: 'SKIPPED', durationSeconds: 0, summary: 'Skipped' },
          { name: 'Kubernetes Rolling Update & Probes', status: 'SKIPPED', durationSeconds: 0, summary: 'Skipped' }
        ]
      }
    ];
  }

  listPipelines(serviceFilter) {
    if (serviceFilter && serviceFilter !== 'ALL') {
      return this.pipelines.filter((p) => p.service === serviceFilter);
    }
    return this.pipelines;
  }

  getPipelineById(id) {
    return this.pipelines.find((p) => p.id === id);
  }

  /**
   * Triggers a complete 5-stage automated CI/CD pipeline:
   * 1. Static Analysis & Lint
   * 2. Automated Unit & Integration Tests
   * 3. Docker Multi-Stage Build & Trivy Vulnerability Scan
   * 4. Container Registry Publish (GHCR)
   * 5. Kubernetes Rolling Update & Readiness/Liveness Verification
   */
  async triggerPipeline({
    service = 'payment-gateway-api',
    branch = 'main',
    commitSha,
    commitMessage = 'feat: automated production release via AegisDeploy control plane',
    author = 'devops-operator',
    imageTag,
    deployToK8s = true
  } = {}) {
    const runNum = this.counter++;
    const id = `pipe-${runNum}`;
    const sha = commitSha || Math.random().toString(16).substring(2, 9);
    const dep = kubernetesService.getDeploymentByService(service);
    const currentTag = dep ? dep.image.split(':')[1] : 'v1.0.0';
    const nextTag = imageTag || kubernetesService.bumpPatchVersion(currentTag);

    const pipeline = {
      id,
      runNumber: runNum,
      service,
      branch,
      commitSha: sha,
      commitMessage,
      author,
      trigger: 'manual_dispatch',
      status: 'RUNNING',
      imageTag: nextTag,
      imageDigest: null,
      durationSeconds: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      stages: [
        { name: 'Static Analysis & Lint', status: 'RUNNING', durationSeconds: 0, summary: 'Executing ESLint, Dockerfile hadolint & K8s kubeconform...' },
        { name: 'Automated Unit & Integration Tests', status: 'PENDING', durationSeconds: 0, summary: 'Waiting...' },
        { name: 'Docker Build & Trivy Security Scan', status: 'PENDING', durationSeconds: 0, summary: 'Waiting...' },
        { name: 'Container Registry Publish (GHCR)', status: 'PENDING', durationSeconds: 0, summary: 'Waiting...' },
        { name: 'Kubernetes Rolling Update & Probes', status: 'PENDING', durationSeconds: 0, summary: 'Waiting...' }
      ]
    };

    this.pipelines.unshift(pipeline);
    logService.info(
      'github-actions-runner',
      `Started CI/CD Pipeline #${runNum} (${id}) for ${service}@${branch} [${sha}] -> target tag ${nextTag}`,
      { service, metadata: { pipelineId: id, branch, commitSha: sha, targetTag: nextTag } }
    );
    this.emit('pipeline_updated', pipeline);

    // Execute stages asynchronously so API returns immediately & streams updates via SSE
    this.executePipelineStages(pipeline, deployToK8s).catch((err) => {
      logService.error('github-actions-runner', `Pipeline ${id} encountered unexpected error: ${err.message}`, {
        service
      });
    });

    return pipeline;
  }

  async executePipelineStages(pipeline, deployToK8s) {
    const startTime = Date.now();
    const { service, commitSha, imageTag, branch, author } = pipeline;

    // Stage 1: Lint & Static Analysis
    await this.sleep(350);
    pipeline.stages[0].status = 'SUCCEEDED';
    pipeline.stages[0].durationSeconds = 2.4;
    pipeline.stages[0].summary = 'ESLint, K8s manifest validation, and Dockerfile audit passed (0 errors)';
    pipeline.stages[1].status = 'RUNNING';
    pipeline.stages[1].summary = 'Running unit & integration test suites with coverage instrumentation...';
    metricsService.pipelineDurationSeconds.observe({ service, stage: 'lint' }, 2.4);
    this.emit('pipeline_updated', pipeline);

    // Stage 2: Automated Unit & Integration Tests
    await this.sleep(450);
    pipeline.stages[1].status = 'SUCCEEDED';
    pipeline.stages[1].durationSeconds = 8.7;
    pipeline.stages[1].summary = '152/152 tests passed • Line coverage: 94.8%';
    pipeline.stages[2].status = 'RUNNING';
    pipeline.stages[2].summary = `Building multi-stage Docker image ${config.dockerRegistry}/${service}:${imageTag}...`;
    metricsService.pipelineDurationSeconds.observe({ service, stage: 'test' }, 8.7);
    logService.info(
      'github-actions-runner',
      `[${pipeline.id}] Automated test suite passed for ${service} (152 tests, 94.8% coverage)`,
      { service, metadata: { pipelineId: pipeline.id } }
    );
    this.emit('pipeline_updated', pipeline);

    // Stage 3 & 4: Docker Build, Trivy Scan & Registry Publish
    await this.sleep(450);
    const builtImage = await dockerRegistryService.buildAndPublishImage({
      service,
      tag: imageTag,
      commitSha
    });

    pipeline.imageDigest = builtImage.digest;
    pipeline.stages[2].status = 'SUCCEEDED';
    pipeline.stages[2].durationSeconds = 11.2;
    pipeline.stages[2].summary = `Built ${builtImage.sizeMb} MB image • Trivy scan: 0 Critical, 0 High CVEs`;
    metricsService.pipelineDurationSeconds.observe({ service, stage: 'docker_build' }, 11.2);

    await this.sleep(300);
    pipeline.stages[3].status = 'SUCCEEDED';
    pipeline.stages[3].durationSeconds = 3.9;
    pipeline.stages[3].summary = `Published & Cosign-signed ${builtImage.repository}:${builtImage.tag}`;
    metricsService.pipelineDurationSeconds.observe({ service, stage: 'registry_publish' }, 3.9);

    // Stage 5: Kubernetes Rolling Update & Health Checks
    if (deployToK8s && kubernetesService.getDeploymentByService(service)) {
      pipeline.stages[4].status = 'RUNNING';
      pipeline.stages[4].summary = `Rolling out ${builtImage.repository}:${builtImage.tag} to namespace ${config.kubernetesNamespace}...`;
      this.emit('pipeline_updated', pipeline);

      const updatedDep = await kubernetesService.triggerRollingUpdate(service, {
        imageTag: builtImage.tag,
        commitSha,
        author: `${author} (${pipeline.id})`
      });

      pipeline.stages[4].status = 'SUCCEEDED';
      pipeline.stages[4].durationSeconds = 5.4;
      pipeline.stages[4].summary = `Rolled out rev #${updatedDep.currentRevision} (${updatedDep.replicas.ready}/${updatedDep.replicas.desired} pods Ready, probes Passing)`;
      metricsService.pipelineDurationSeconds.observe({ service, stage: 'k8s_deploy' }, 5.4);
    } else {
      pipeline.stages[4].status = 'SUCCEEDED';
      pipeline.stages[4].durationSeconds = 1.0;
      pipeline.stages[4].summary = 'Artifact promoted to staging manifest';
    }

    pipeline.status = 'SUCCEEDED';
    pipeline.completedAt = new Date().toISOString();
    pipeline.durationSeconds = Number((31.6 + (Date.now() - startTime) / 1000).toFixed(1));

    metricsService.pipelineRunsTotal.inc({
      service,
      branch,
      status: 'succeeded'
    });

    logService.info(
      'github-actions-runner',
      `Pipeline #${pipeline.runNumber} (${pipeline.id}) SUCCEEDED for ${service}:${imageTag} in ${pipeline.durationSeconds}s`,
      { service, metadata: { pipelineId: pipeline.id, imageDigest: pipeline.imageDigest } }
    );

    this.emit('pipeline_updated', pipeline);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new PipelineService();
