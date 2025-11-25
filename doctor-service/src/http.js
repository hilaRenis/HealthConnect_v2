// src/http.js
const express = require('express');
const helmet = require('helmet');
const xssClean = require('xss-clean');
const { register, metricsMiddleware } = require('./metrics');

function createApp({ name, routes, port }) {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(xssClean());

  app.use(express.json());

  // Metrics middleware
  app.use(metricsMiddleware(name));

  // Parse forwarded user from gateway (if present)
  app.use((req, res, next) => {
    const xu = req.headers['x-user'];
    if (xu) {
      try { req.user = JSON.parse(xu); } catch {}
    }
    next();
  });

  // Health check
  app.get('/health', (req, res) => res.json({ service: name, ok: true }));

  // Metrics endpoint
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Routes injector
  routes(app);

  // Error handler
  app.use((err, req, res, next) => {
    console.error(`[${name}]`, err && err.stack || err);
    res.status(err.status || 500).json({ error: err.message || 'InternalError' });
  });

  app.listen(port, () => console.log(`${name} listening on ${port}`));
}

module.exports = { createApp };
