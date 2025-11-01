const { createApp } = require('./http');

const PORT = process.env.PORT || 3005;
const filled = []; // {requestId, dispensedAt}

function routes(app) {
  // List approved (pull from patient-service)
  app.get('/prescriptions/approved', async (req, res) => {
    const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
    const headers = {};
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    const r = await fetch('http://api-gateway:8080/api/patients/internal/prescriptions/requests', { headers });
    const data = (await r.json()).filter(r => r.status === 'approved');
    res.json(data);
  });

  // Mark as dispensed
  app.post('/prescriptions/:id/dispense', (req, res) => {
    filled.push({ requestId: req.params.id, dispensedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}

createApp({ name: 'pharmacy-service', routes, port: PORT });
