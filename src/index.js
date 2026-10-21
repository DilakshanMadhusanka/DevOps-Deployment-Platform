const http = require('http');
const app = require('./server');
const config = require('./config');
const logService = require('./services/logService');

const server = http.createServer(app);

server.listen(config.port, () => {
  logService.info(
    'control-plane',
    `AegisDeploy Production DevOps Platform listening on http://localhost:${config.port} (mode=${config.executionMode}, cluster=${config.kubernetesCluster})`,
    {
      service: 'platform-control-plane',
      metadata: {
        port: config.port,
        version: config.version,
        commitSha: config.commitSha,
        prometheusMetrics: `http://localhost:${config.port}/metrics`
      }
    }
  );
});

// Graceful shutdown for Kubernetes SIGTERM / preStop lifecycle hook
const gracefulShutdown = (signal) => {
  logService.warn('control-plane', `Received ${signal}. Draining active HTTP & SSE connections before pod termination...`, {
    service: 'platform-control-plane'
  });
  server.close(() => {
    logService.info('control-plane', 'HTTP server closed cleanly. Exiting process 0.', {
      service: 'platform-control-plane'
    });
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
