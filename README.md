# AegisDeploy — Production-Ready DevOps Deployment Platform

A full-stack **DevOps Deployment & Observability Platform** that builds, tests, containerizes, deploys, scales, rolls back, and monitors containerized applications across **Node.js, GitHub Actions, Docker, Kubernetes, Nginx, Prometheus, and Grafana**.

---

## Key Features

1. **Automated Build & Test Pipelines (`GitHub Actions` + Pipeline Orchestrator)**
   - 5-stage continuous delivery pipeline:
     1. Static Analysis & Lint Verification (`ESLint`, `kubeconform`, `hadolint`)
     2. Automated Unit & API Integration Tests (`node --test` + `supertest`)
     3. Multi-Stage Docker Image Build & Aqua Trivy CVE Vulnerability Scan
     4. Container Registry Publishing (`ghcr.io`) with Sigstore Cosign signing
     5. Zero-Downtime Kubernetes Rolling Update & Probe Verification
2. **Docker Image Creation & Registry Publishing**
   - Hardened 3-stage [`Dockerfile`](Dockerfile) (`deps` &rarr; `test` &rarr; `production-nonroot`) running on `node:20-alpine` with `dumb-init`, non-root user (`UID 1001`), and native container `HEALTHCHECK`.
   - Registry catalog tracking SHA-256 digests, multi-arch manifests (`linux/amd64, linux/arm64`), image sizes, Trivy CVE scan results, and one-click promotion to Kubernetes.
3. **Kubernetes Deployments & Health Checks**
   - Complete manifests in [`k8s/`](k8s/) (`Namespace`, `ConfigMap`, `Deployment`, `Service`, `HorizontalPodAutoscaler`, `PodDisruptionBudget`, `Ingress`).
   - Dedicated Kubernetes probe endpoints:
     - Liveness Probe: `GET /health/live`
     - Readiness Probe: `GET /health/ready`
     - Startup Probe: `GET /health/startup`
4. **Zero-Downtime Rolling Updates & Instant Rollback**
   - Configured with `RollingUpdate` (`maxSurge: 25%`, `maxUnavailable: 0`), pod anti-affinity, and `preStop` connection draining.
   - Full ReplicaSet revision history with one-click or CLI-driven instant rollback (`POST /api/k8s/deployments/:service/rollback` or [`scripts/rollback.sh`](scripts/rollback.sh)).
5. **Centralized Logs, Prometheus Metrics & Grafana Alerts**
   - Native OpenMetrics / Prometheus scrape endpoint at `GET /metrics` (`prom-client`) tracking HTTP request histograms, CI/CD pipeline runs, Docker registry builds, Kubernetes replica states, rolling updates, and rollbacks.
   - Real-time Server-Sent Events (`GET /api/stream`) streaming structured JSON logs, live SVG telemetry charts, and Prometheus Alertmanager incidents directly to the Control Plane UI.

---

## Project Architecture

```text
├── .github/workflows/
│   └── ci-cd.yml                          # Automated GitHub Actions Build, Test, Scan, Push & K8s Deploy
├── k8s/
│   ├── namespace.yaml                     # Production Kubernetes Namespace
│   ├── configmap.yaml                     # Environment & cluster configuration
│   ├── deployment.yaml                    # Zero-downtime RollingUpdate, probes, non-root securityContext
│   ├── service.yaml                       # ClusterIP service with Prometheus scrape annotations
│   ├── hpa.yaml                           # HorizontalPodAutoscaler (3-12 replicas on CPU/Memory)
│   ├── pdb.yaml                           # PodDisruptionBudget (minAvailable: 75%)
│   └── ingress.yaml                       # Nginx Ingress with TLSv1.3, rate limits & SSE support
├── monitoring/
│   ├── prometheus/
│   │   ├── prometheus.yml                 # 10s-15s scrape config for Node.js & cluster targets
│   │   └── alert.rules.yml                # PromQL SLO alerting rules (5xx rate, pod readiness, P95 latency)
│   ├── alertmanager/
│   │   └── alertmanager.yml               # Alert routing & webhook integration with Control Plane
│   └── grafana/
│       ├── provisioning/                  # Auto-provisioned Prometheus datasource & dashboard provider
│       └── dashboards/
│           └── devops-platform-dashboard.json
├── nginx/
│   └── nginx.conf                         # Reverse proxy, rate limiting, gzip, JSON logs & SSE streaming
├── scripts/
│   ├── rolling-update.sh                  # Automated K8s rollout with probe verification & auto-rollback
│   └── rollback.sh                        # Instant K8s revision rollback script
├── src/
│   ├── config/index.js                    # Environment configuration
│   ├── services/
│   │   ├── logService.js                  # Centralized structured JSON logger & query engine
│   │   ├── metricsService.js              # Prometheus registry, counters, gauges & histograms
│   │   ├── dockerRegistryService.js       # Container builder, Trivy CVE scanner & GHCR publisher
│   │   ├── kubernetesService.js           # K8s deployments, RollingUpdate & revision rollback controller
│   │   ├── pipelineService.js             # 5-stage CI/CD pipeline execution engine
│   │   └── alertService.js                # Prometheus Alertmanager rules & incident lifecycle
│   ├── public/                            # Interactive Real-Time DevOps Control Plane SPA
│   ├── server.js                          # Express REST API, probes, /metrics & /api/stream SSE
│   └── index.js                           # Server entrypoint with SIGTERM graceful drain
├── tests/
│   └── platform.test.js                   # Automated integration test suite
├── Dockerfile                             # Multi-stage non-root production Dockerfile
└── docker-compose.yml                     # Full-stack local orchestration (Node + Nginx + Prometheus + Grafana)
```

---

## Quick Start

### 1. Run Locally with Node.js

```bash
npm install
npm test
npm start
```

Open **http://localhost:3000** to access the **AegisDeploy Control Plane Dashboard**, or inspect **http://localhost:3000/metrics** for the Prometheus scrape output.

### 2. Run Full Observability & Gateway Stack with Docker Compose

```bash
docker compose up --build -d
```

- **DevOps Control Plane (Direct)**: http://localhost:3000
- **Nginx API Gateway & Reverse Proxy**: http://localhost:8080
- **Prometheus UI**: http://localhost:9090
- **Alertmanager UI**: http://localhost:9093
- **Grafana Dashboards**: http://localhost:3001 (`admin` / `admin`)

### 3. Deploy or Roll Back on Kubernetes

```bash
# Execute a zero-downtime RollingUpdate (auto-rolls back if probes fail)
./scripts/rolling-update.sh 1.4.2 production

# Instant rollback to previous revision or specific revision number
./scripts/rollback.sh production
./scripts/rollback.sh production 13
```
