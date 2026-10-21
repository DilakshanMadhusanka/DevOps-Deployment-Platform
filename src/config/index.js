const os = require('os');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  version: process.env.APP_VERSION || '1.4.2',
  commitSha: process.env.GIT_COMMIT_SHA || 'a9f4c82',
  executionMode: process.env.EXECUTION_MODE || 'hybrid', // 'hybrid' | 'live' | 'simulation'
  dockerRegistry: process.env.DOCKER_REGISTRY || 'ghcr.io/devops-platform',
  kubernetesNamespace: process.env.K8S_NAMESPACE || 'production',
  kubernetesCluster: process.env.K8S_CLUSTER || 'eks-us-east-1-prod',
  prometheusUrl: process.env.PROMETHEUS_URL || 'http://prometheus:9090',
  grafanaUrl: process.env.GRAFANA_URL || 'http://localhost:3001',
  nginxGatewayUrl: process.env.NGINX_GATEWAY_URL || 'http://localhost:8080',
  hostname: os.hostname(),
  logMaxBuffer: parseInt(process.env.LOG_MAX_BUFFER || '500', 10)
};

module.exports = config;
