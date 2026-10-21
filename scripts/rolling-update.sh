#!/usr/bin/env bash
# ============================================================================
# Zero-Downtime Kubernetes Rolling Update & Health Verification Script
# Usage: ./scripts/rolling-update.sh <image-tag> [namespace]
# ============================================================================
set -euo pipefail

IMAGE_TAG="${1:-1.4.2}"
NAMESPACE="${2:-production}"
DEPLOYMENT="aegis-deploy-platform"
REGISTRY="ghcr.io/devops-platform"
FULL_IMAGE="${REGISTRY}/${DEPLOYMENT}:${IMAGE_TAG}"

echo "[AegisDeploy] Applying Kubernetes manifests in namespace '${NAMESPACE}'..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/pdb.yaml
kubectl apply -f k8s/ingress.yaml

echo "[AegisDeploy] Triggering zero-downtime RollingUpdate to ${FULL_IMAGE}..."
kubectl -n "${NAMESPACE}" set image "deployment/${DEPLOYMENT}" "${DEPLOYMENT}=${FULL_IMAGE}"
kubectl -n "${NAMESPACE}" annotate "deployment/${DEPLOYMENT}" \
  kubernetes.io/change-cause="RollingUpdate to ${FULL_IMAGE} at $(date -u +"%Y-%m-%dT%H:%M:%SZ")" --overwrite

echo "[AegisDeploy] Waiting for surge pods to pass Startup, Liveness, and Readiness probes..."
if ! kubectl -n "${NAMESPACE}" rollout status "deployment/${DEPLOYMENT}" --timeout=180s; then
  echo "[ERROR] RollingUpdate failed health checks! Initiating automatic rollback..."
  ./scripts/rollback.sh "${NAMESPACE}"
  exit 1
fi

echo "[SUCCESS] Deployment '${DEPLOYMENT}' rolled out to ${FULL_IMAGE} with zero downtime."
kubectl -n "${NAMESPACE}" get pods -l "app=${DEPLOYMENT}" -o wide
