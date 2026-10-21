#!/usr/bin/env bash
# ============================================================================
# Instant Kubernetes Deployment Rollback Script
# Usage: ./scripts/rollback.sh [namespace] [target-revision]
# ============================================================================
set -euo pipefail

NAMESPACE="${1:-production}"
TARGET_REVISION="${2:-}"
DEPLOYMENT="aegis-deploy-platform"

echo "[AegisDeploy] Fetching rollout history for deployment/${DEPLOYMENT} in namespace '${NAMESPACE}'..."
kubectl -n "${NAMESPACE}" rollout history "deployment/${DEPLOYMENT}"

if [ -n "${TARGET_REVISION}" ]; then
  echo "[AegisDeploy] Rolling back deployment/${DEPLOYMENT} to revision #${TARGET_REVISION}..."
  kubectl -n "${NAMESPACE}" rollout undo "deployment/${DEPLOYMENT}" --to-revision="${TARGET_REVISION}"
else
  echo "[AegisDeploy] Rolling back deployment/${DEPLOYMENT} to previous revision..."
  kubectl -n "${NAMESPACE}" rollout undo "deployment/${DEPLOYMENT}"
fi

echo "[AegisDeploy] Verifying pod readiness after rollback..."
kubectl -n "${NAMESPACE}" rollout status "deployment/${DEPLOYMENT}" --timeout=120s
echo "[SUCCESS] Rollback complete."
kubectl -n "${NAMESPACE}" get pods -l "app=${DEPLOYMENT}"
