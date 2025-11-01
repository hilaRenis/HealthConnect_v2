const { nanoid } = require('nanoid');
const { createApp } = require('./http');
const db = require('./db');
const { publishEvent } = require('./kafka');

const PATIENT_EVENTS_TOPIC = 'patient.events';
const PRESCRIPTION_EVENTS_TOPIC = 'prescription.events';

const PORT = process.env.PORT || 3002;

function ensureRole(role) {
  return (req, res, next) => (req.user?.role === role ? next() : res.status(403).json({ error: 'Forbidden' }));
}

async function publishPrescriptionDeletionEvents(patientId, timestamp) {
  const { rows } = await db.query(
    'UPDATE prescription_requests SET deleted_at = $2 WHERE patientId = $1 AND deleted_at IS NULL RETURNING id',
    [patientId, timestamp]
  );

  for (const row of rows) {
    await publishEvent(PRESCRIPTION_EVENTS_TOPIC, {
      type: 'PRESCRIPTION_REQUEST_DELETED',
      id: row.id,
      patientId,
      deletedAt: timestamp,
    });
  }
}

async function softDeletePatient({ patientId = null, userId = null }) {
  if (!patientId && !userId) return null;

  const timestamp = new Date().toISOString();
  let result;

  if (patientId) {
    result = await db.query(
      'UPDATE patients SET deleted_at = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id, userId',
      [patientId, timestamp]
    );
  } else {
    result = await db.query(
      'UPDATE patients SET deleted_at = $2 WHERE userId = $1 AND deleted_at IS NULL RETURNING id, userId',
      [userId, timestamp]
    );
  }

  const record = result?.rows?.[0];
  if (!record) return null;

  const normalizedPatientId = record.id;
  const normalizedUserId = record.userid;

  await publishPrescriptionDeletionEvents(normalizedPatientId, timestamp);

  await publishEvent(PATIENT_EVENTS_TOPIC, {
    type: 'PATIENT_DELETED',
    id: normalizedPatientId,
    userId: normalizedUserId,
    deletedAt: timestamp,
  });

  return { id: normalizedPatientId, userId: normalizedUserId, deletedAt: timestamp };
}

function routes(app) {
  // Profiles
  app.post('/profiles', async (req, res) => {
    const { name, dob, userId: providedUserId } = req.body || {};
    const actingUser = req.user;

    if (!actingUser && !providedUserId) {
      return res.status(401).json({ error: 'No user' });
    }

    let targetUserId = null;
    if (actingUser?.role === 'admin') {
      targetUserId = providedUserId || actingUser.sub;
    } else if (actingUser?.role === 'doctor') {
      if (!providedUserId) {
        return res.status(400).json({ error: 'Missing target user' });
      }
      targetUserId = providedUserId;
    } else {
      targetUserId = actingUser?.sub || providedUserId;
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'Missing target user' });
    }

    const { rows: existing } = await db.query('SELECT id FROM patients WHERE userId = $1 AND deleted_at IS NULL', [targetUserId]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Profile exists' });
    }

    const profile = { id: nanoid(), userId: targetUserId, name, dob, conditions: [] };
    await db.query('INSERT INTO patients (id, userId, name, dob, conditions) VALUES ($1, $2, $3, $4, $5)', [profile.id, profile.userId, profile.name, profile.dob, profile.conditions]);

    await publishEvent(PATIENT_EVENTS_TOPIC, {
      type: 'PATIENT_CREATED',
      id: profile.id,
      userId: profile.userId,
      name: profile.name,
      dob: profile.dob,
      conditions: profile.conditions,
    });

    res.status(201).json(profile);
  });

  app.get('/profiles/me', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'No user' });
    const { rows } = await db.query('SELECT * FROM patients WHERE userId = $1 AND deleted_at IS NULL', [req.user.sub]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  });

  app.delete('/profiles/me', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'No user' });
    const deleted = await softDeletePatient({ userId: req.user.sub });
    res.json({ ok: true, deleted: Boolean(deleted) });
  });

  app.delete('/profiles/:id', ensureRole('admin'), async (req, res) => {
    const deleted = await softDeletePatient({ patientId: req.params.id });
    if (!deleted) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.status(204).send();
  });

  // Prescription requests
  app.post('/prescriptions/requests', ensureRole('patient'), async (req, res) => {
    const { medication, notes } = req.body || {};
    const { rows } = await db.query('SELECT * FROM patients WHERE userId = $1 AND deleted_at IS NULL', [req.user.sub]);
    const me = rows[0];
    if (!me) return res.status(400).json({ error: 'Create profile first' });
    const reqObj = { id: nanoid(), patientId: me.id, medication, notes, status: 'pending' };
    await db.query('INSERT INTO prescription_requests (id, patientId, medication, notes, status) VALUES ($1, $2, $3, $4, $5)', [reqObj.id, reqObj.patientId, reqObj.medication, reqObj.notes, reqObj.status]);
    await publishEvent(PRESCRIPTION_EVENTS_TOPIC, {
      type: 'PRESCRIPTION_REQUEST_CREATED',
      id: reqObj.id,
      patientId: reqObj.patientId,
      medication: reqObj.medication,
      notes: reqObj.notes,
      status: reqObj.status,
    });
    res.status(201).json(reqObj);
  });

  app.get('/prescriptions/requests/mine', ensureRole('patient'), async (req, res) => {
    const { rows: patientRows } = await db.query('SELECT * FROM patients WHERE userId = $1 AND deleted_at IS NULL', [req.user.sub]);
    const me = patientRows[0];
    const { rows } = await db.query('SELECT * FROM prescription_requests WHERE patientId = $1 AND deleted_at IS NULL', [me?.id]);
    res.json(rows);
  });

  // Internal endpoints (simulating service-to-service access)
  app.get('/internal/prescriptions/requests', async (req, res) => {
    const { rows } = await db.query('SELECT * FROM prescription_requests WHERE deleted_at IS NULL');
    res.json(rows);
  });
  app.post('/internal/prescriptions/requests/:id/status', async (req, res) => {
    const { rows } = await db.query(
      'UPDATE prescription_requests SET status = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING *',
      [req.body.status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const updated = rows[0];
    await publishEvent(PRESCRIPTION_EVENTS_TOPIC, {
      type: 'PRESCRIPTION_REQUEST_STATUS_CHANGED',
      id: updated.id,
      patientId: updated.patientid,
      status: updated.status,
    });
    res.json(rows[0]);
  });
}

createApp({ name: 'patient-service', routes, port: PORT });
