// src/http.js
const express = require('express');
const helmet = require('helmet');
const xssClean = require('xss-clean');
const { register, metricsMiddleware } = require('./metrics');

function createApp({ name, routes, port }) {
  const app = express();

  // Trust proxy for Cloud Run
  app.set('trust proxy', true);

  // Security middleware
  app.use(helmet());
  app.use(xssClean());

  // Request body size limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
    // Log the full error internally
    console.error(`[${name}] ERROR:`, err && err.stack || err);

    // Don't expose error details in production
    const isDev = process.env.NODE_ENV === 'development';
    const statusCode = err.status || 500;

    if (statusCode >= 500) {
      // Server errors - don't expose details
      res.status(statusCode).json({
        error: 'Internal server error',
        ...(isDev && { details: err.message, stack: err.stack })
      });
    } else {
      // Client errors - safe to show message
      res.status(statusCode).json({
        error: err.message || 'Bad request',
        ...(isDev && { stack: err.stack })
      });
    }
  });

  app.listen(port, () => console.log(`${name} listening on ${port}`));
}

module.exports = { createApp };
