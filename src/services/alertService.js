const EventEmitter = require('events');
const logService = require('./logService');
const metricsService = require('./metricsService');

class AlertService extends EventEmitter {
  constructor() {
    super();
    this.rules = [
      {
        id: 'rule-high-error-rate',
        name: 'HighHttp5xxErrorRate',
        expr: 'sum(rate(devops_http_request_duration_seconds_count{status_code=~"5.."}[5m])) / sum(rate(devops_http_request_duration_seconds_count[5m])) * 100 > 2.0',
        forDuration: '2m',
        severity: 'critical',
        summary: 'HTTP 5xx error rate exceeds 2.0% SLO threshold across Nginx ingress'
      },
      {
        id: 'rule-pod-not-ready',
        name: 'KubernetesPodReadinessDegraded',
        expr: 'devops_k8s_deployment_replicas{state="ready"} < devops_k8s_deployment_replicas{state="desired"}',
        forDuration: '1m',
        severity: 'critical',
        summary: 'Kubernetes deployment has fewer Ready pods than Desired replicas'
      },
      {
        id: 'rule-memory-pressure',
        name: 'ContainerMemoryWorkingSetHigh',
        expr: 'container_memory_working_set_bytes / container_spec_memory_limit_bytes * 100 > 80',
        forDuration: '5m',
        severity: 'warning',
        summary: 'Container memory working set above 80% of configured cgroup limit'
      },
      {
        id: 'rule-p95-latency',
        name: 'IngressHighP95Latency',
        expr: 'histogram_quantile(0.95, sum(rate(devops_http_request_duration_seconds_bucket[5m])) by (le)) > 0.250',
        forDuration: '3m',
        severity: 'warning',
        summary: 'P95 HTTP request latency above 250ms SLO target'
      },
      {
        id: 'rule-pipeline-failure',
        name: 'CiCdPipelineFailureDetected',
        expr: 'increase(devops_pipeline_runs_total{status="failed"}[15m]) > 0',
        forDuration: '0m',
        severity: 'warning',
        summary: 'Automated GitHub Actions CI/CD pipeline execution failed'
      }
    ];

    this.alerts = [
      {
        id: 'alert-401',
        ruleName: 'ContainerMemoryWorkingSetHigh',
        severity: 'warning',
        status: 'firing', // firing | acknowledged | resolved
        service: 'realtime-telemetry-ingest',
        namespace: 'production',
        pod: 'realtime-telemetry-ingest-5c8b9a-x4k2p',
        value: '81.4% (833Mi / 1024Mi)',
        summary: 'Pod memory working set at 81.4% of 1024Mi limit during peak telemetry burst',
        runbookUrl: 'https://runbooks.aegisdeploy.io/k8s/memory-pressure',
        firedAt: new Date(Date.now() - 1400000).toISOString(),
        acknowledgedBy: null,
        resolvedAt: null
      },
      {
        id: 'alert-400',
        ruleName: 'CiCdPipelineFailureDetected',
        severity: 'info',
        status: 'resolved',
        service: 'realtime-telemetry-ingest',
        namespace: 'production',
        pod: 'github-runner-pool-02',
        value: 'pipe-1040 (feat/batch-stream)',
        summary: 'PR branch feat/batch-stream failed unit test test_backpressure_drain_timeout (main branch unaffected)',
        runbookUrl: 'https://runbooks.aegisdeploy.io/cicd/test-timeout',
        firedAt: new Date(Date.now() - 3600000 * 7).toISOString(),
        acknowledgedBy: 'devon.brooks',
        resolvedAt: new Date(Date.now() - 3600000 * 6).toISOString()
      }
    ];

    metricsService.updateAlertGauges(this.alerts);
  }

  getAlerts({ status } = {}) {
    if (status && status !== 'ALL') {
      return this.alerts.filter((a) => a.status.toUpperCase() === status.toUpperCase());
    }
    return this.alerts;
  }

  getRules() {
    return this.rules;
  }

  fireAlert({
    ruleName = 'HighHttp5xxErrorRate',
    severity = 'critical',
    service = 'payment-gateway-api',
    namespace = 'production',
    pod = 'payment-gateway-api-7b9d4c-k9m1z',
    value = '3.42% 5xx rate',
    summary = 'Elevated HTTP 5xx responses detected by Prometheus scrape'
  } = {}) {
    const alert = {
      id: `alert-${402 + this.alerts.length}`,
      ruleName,
      severity: severity.toLowerCase(),
      status: 'firing',
      service,
      namespace,
      pod,
      value,
      summary,
      runbookUrl: `https://runbooks.aegisdeploy.io/alerts/${ruleName.toLowerCase()}`,
      firedAt: new Date().toISOString(),
      acknowledgedBy: null,
      resolvedAt: null
    };

    this.alerts.unshift(alert);
    metricsService.updateAlertGauges(this.alerts);

    logService.warn(
      'prometheus-alertmanager',
      `[ALERT FIRING] ${alert.ruleName} (${alert.severity.toUpperCase()}) on ${alert.service}: ${alert.summary} [${alert.value}]`,
      { service: alert.service, metadata: { alertId: alert.id, severity: alert.severity } }
    );

    this.emit('alert_updated', alert);
    return alert;
  }

  acknowledgeAlert(alertId, operator = 'sre-oncall') {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new Error(`Alert '${alertId}' not found`);
    }
    alert.status = 'acknowledged';
    alert.acknowledgedBy = operator;
    metricsService.updateAlertGauges(this.alerts);

    logService.info(
      'prometheus-alertmanager',
      `Alert ${alert.id} (${alert.ruleName}) acknowledged by ${operator}`,
      { service: alert.service, metadata: { alertId: alert.id, operator } }
    );

    this.emit('alert_updated', alert);
    return alert;
  }

  resolveAlert(alertId, operator = 'sre-oncall') {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new Error(`Alert '${alertId}' not found`);
    }
    alert.status = 'resolved';
    alert.resolvedAt = new Date().toISOString();
    if (!alert.acknowledgedBy) alert.acknowledgedBy = operator;
    metricsService.updateAlertGauges(this.alerts);

    logService.info(
      'prometheus-alertmanager',
      `Alert ${alert.id} (${alert.ruleName}) resolved by ${operator}`,
      { service: alert.service, metadata: { alertId: alert.id, operator } }
    );

    this.emit('alert_updated', alert);
    return alert;
  }
}

module.exports = new AlertService();
