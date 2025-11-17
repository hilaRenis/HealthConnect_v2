const client = require('prom-client');

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'service']
});

// Register custom metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestsTotal);

// Middleware to record metrics
function metricsMiddleware(serviceName) {
  return (req, res, next) => {
    const start = Date.now();

    // Capture the original end function
    const originalEnd = res.end;

    res.end = function(...args) {
      const duration = (Date.now() - start) / 1000;
      const route = req.route?.path || req.path || 'unknown';

      // Record metrics
      httpRequestDuration.labels(
        req.method,
        route,
        res.statusCode.toString(),
        serviceName
      ).observe(duration);

      httpRequestsTotal.labels(
        req.method,
        route,
        res.statusCode.toString(),
        serviceName
      ).inc();

      // Call the original end function
      originalEnd.apply(res, args);
    };

    next();
  };
}

module.exports = {
  register,
  metricsMiddleware
};
