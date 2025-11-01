const { createApp } = require('./http');
const db = require('./db');
const axios = require('axios');
const patientApi = require('./axiosInstance');
const { publishEvent, startConsumer } = require('./kafka');

const USER_EVENTS_TOPIC = 'user.events';
const PATIENT_EVENTS_TOPIC = 'patient.events';
const DOCTOR_ASSIGNMENT_TOPIC = 'doctor-patient.events';

const PORT = process.env.PORT || 3003;

function ensureRole(role) {
  return (req, res, next) => (req.user?.role === role ? next() : res.status(403).json({ error: 'Forbidden' }));
}

async function publishAssignmentEvent(type, payload) {
  const { doctorId, patientId, deletedAt } = payload || {};
  if (!doctorId || !patientId) return;
  const eventPayload = {
    type,
    doctorId,
    patientId,
  };
  if (deletedAt) {
    eventPayload.deletedAt = deletedAt;
  }
  await publishEvent(DOCTOR_ASSIGNMENT_TOPIC, eventPayload);
}

async function assignDoctorMapping({ doctorId, patientId }) {
  if (!doctorId || !patientId) return;
  await db.query(
    'UPDATE doctor_patient_map SET deleted_at = NOW() WHERE patientId = $1 AND doctorId <> $2 AND deleted_at IS NULL',
    [patientId, doctorId]
  );
  const { rowCount } = await db.query(
    'UPDATE doctor_patient_map SET deleted_at = NULL WHERE doctorId = $1 AND patientId = $2',
    [doctorId, patientId]
  );
  if (rowCount === 0) {
    await db.query('INSERT INTO doctor_patient_map (doctorId, patientId, deleted_at) VALUES ($1, $2, NULL)', [doctorId, patientId]);
  }
}

async function unassignDoctorMapping({ doctorId, patientId, deletedAt }) {
  if (!doctorId || !patientId) return [];
  const timestamp = deletedAt || new Date().toISOString();
  const { rows } = await db.query(
    `UPDATE doctor_patient_map
     SET deleted_at = $3
     WHERE doctorId = $1 AND patientId = $2 AND deleted_at IS NULL
     RETURNING doctorId, patientId`,
    [doctorId, patientId, timestamp]
  );
  return rows;
}

async function upsertUserDirectory({ id, role, name, email }) {
  if (!id) return;
  await db.query(
    `INSERT INTO user_directory (id, role, name, email, deleted_at)
     VALUES ($1, $2, $3, $4, NULL)
     ON CONFLICT (id) DO UPDATE
       SET role = EXCLUDED.role,
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       deleted_at = NULL`,
    [id, role, name, email]
  );

  if (role === 'doctor') {
    await db.query(
      `INSERT INTO doctors (id, deleted_at)
       VALUES ($1, NULL)
       ON CONFLICT (id) DO UPDATE SET deleted_at = NULL`,
      [id]
    );
  }
}

async function softDeleteUserDirectory({ id, deletedAt, role }) {
  if (!id) return;
  const timestamp = deletedAt || new Date().toISOString();
  await db.query('UPDATE user_directory SET deleted_at = $2 WHERE id = $1', [id, timestamp]);

  if (role === 'doctor') {
    await db.query('UPDATE doctors SET deleted_at = $2 WHERE id = $1', [id, timestamp]);
    const { rows } = await db.query(
      'SELECT patientId FROM doctor_patient_map WHERE doctorId = $1 AND deleted_at IS NULL',
      [id]
    );
    for (const row of rows) {
      const affected = await unassignDoctorMapping({ doctorId: id, patientId: row.patientid, deletedAt: timestamp });
      if (affected.length > 0) {
        await publishAssignmentEvent('DOCTOR_PATIENT_UNASSIGNED', {
          doctorId: id,
          patientId: row.patientid,
          deletedAt: timestamp,
        });
      }
    }
  }
}

async function upsertPatientProfile(event) {
  const { id, userId, name, dob, conditions } = event;
  if (!id) return;
  await db.query(
    `INSERT INTO patient_profiles (id, userId, name, dob, conditions, deleted_at)
     VALUES ($1, $2, $3, $4, $5, NULL)
     ON CONFLICT (id) DO UPDATE
       SET userId = EXCLUDED.userId,
           name = EXCLUDED.name,
           dob = EXCLUDED.dob,
           conditions = EXCLUDED.conditions,
           deleted_at = NULL`,
    [id, userId, name, dob, conditions]
  );
}

async function softDeletePatientProfile(event) {
  const { id, userId, deletedAt } = event;
  const timestamp = deletedAt || new Date().toISOString();
  const patientIds = [];

  if (id) {
    await db.query('UPDATE patient_profiles SET deleted_at = $2 WHERE id = $1', [id, timestamp]);
    patientIds.push(id);
  } else if (userId) {
    const { rows } = await db.query('SELECT id FROM patient_profiles WHERE userId = $1 AND deleted_at IS NULL', [userId]);
    for (const row of rows) {
      await db.query('UPDATE patient_profiles SET deleted_at = $2 WHERE id = $1', [row.id, timestamp]);
      patientIds.push(row.id);
    }
  }

  for (const patientId of patientIds) {
    const { rows: doctors } = await db.query(
      'SELECT doctorId FROM doctor_patient_map WHERE patientId = $1 AND deleted_at IS NULL',
      [patientId]
    );
    for (const doctor of doctors) {
      const affected = await unassignDoctorMapping({ doctorId: doctor.doctorid, patientId, deletedAt: timestamp });
      if (affected.length > 0) {
        await publishAssignmentEvent('DOCTOR_PATIENT_UNASSIGNED', {
          doctorId: doctor.doctorid,
          patientId,
          deletedAt: timestamp,
        });
      }
    }
  }
}

async function handleDomainEvent(topic, event) {
  if (!event || !event.type) return;

  switch (topic) {
    case USER_EVENTS_TOPIC: {
      if (event.type === 'USER_CREATED' || event.type === 'USER_UPDATED') {
        await upsertUserDirectory(event);
      } else if (event.type === 'USER_DELETED') {
        await softDeleteUserDirectory(event);
      }
      break;
    }
    case PATIENT_EVENTS_TOPIC: {
      if (event.type === 'PATIENT_CREATED') {
        await upsertPatientProfile(event);
      } else if (event.type === 'PATIENT_DELETED') {
        await softDeletePatientProfile(event);
      }
      break;
    }
    case DOCTOR_ASSIGNMENT_TOPIC: {
      if (event.type === 'DOCTOR_PATIENT_ASSIGNED') {
        await assignDoctorMapping(event);
      } else if (event.type === 'DOCTOR_PATIENT_UNASSIGNED') {
        await unassignDoctorMapping(event);
      }
      break;
    }
    default:
      break;
  }
}

let consumersStarted = false;
async function initializeConsumers() {
  if (consumersStarted) return;
  consumersStarted = true;
  try {
    await startConsumer({
      groupId: 'doctor-service-projections',
      topics: [USER_EVENTS_TOPIC, PATIENT_EVENTS_TOPIC, DOCTOR_ASSIGNMENT_TOPIC],
      handleMessage: handleDomainEvent,
    });
  } catch (error) {
    console.error('[doctor-service] Failed to initialize Kafka consumers', error);
  }
}

initializeConsumers();

function routes(app) {
  // Doctor schedule
  app.post('/schedule', ensureRole('doctor'), async (req, res) => {
    const slot = { id: `${Date.now()}`, doctorUserId: req.user.sub, date: req.body.date, slot: req.body.slot };
    await db.query('INSERT INTO schedule (id, doctorUserId, date, slot) VALUES ($1, $2, $3, $4)', [slot.id, slot.doctorUserId, slot.date, slot.slot]);
    res.status(201).json(slot);
  });

  app.get('/schedule/mine', ensureRole('doctor'), async (req, res) => {
    const { rows } = await db.query('SELECT * FROM schedule WHERE doctorUserId = $1 AND deleted_at IS NULL', [req.user.sub]);
    res.json(rows);
  });

  // Patient management
  app.get('/patients', ensureRole('doctor'), async (req, res) => {
    const { page = 1, limit = 10, sortBy = 'name', order = 'asc', search = '' } = req.query;
    const offset = (page - 1) * limit;
    const searchQuery = `%${search}%`;
    const sortColumns = {
      name: 'COALESCE(pp.name, ud.name)',
      email: 'ud.email',
      dob: 'pp.dob',
    };
    const orderColumn = sortColumns[sortBy] || sortColumns.name;
    const orderDirection = order?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const { rows } = await db.query(
      `SELECT
         pp.id,
         pp.userId,
         COALESCE(pp.name, ud.name) AS name,
         ud.email,
         pp.dob,
         pp.conditions
       FROM patient_profiles pp
       JOIN doctor_patient_map dpm ON pp.id = dpm.patientId AND dpm.deleted_at IS NULL
       LEFT JOIN user_directory ud ON ud.id = pp.userId
       WHERE dpm.doctorId = $1
         AND pp.deleted_at IS NULL
         AND (ud.deleted_at IS NULL OR ud.id IS NULL)
         AND (COALESCE(pp.name, ud.name) ILIKE $2 OR ud.email ILIKE $2)
       ORDER BY ${orderColumn} ${orderDirection}
       LIMIT $3 OFFSET $4`,
      [req.user.sub, searchQuery, limit, offset]
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM patient_profiles pp
       JOIN doctor_patient_map dpm ON pp.id = dpm.patientId AND dpm.deleted_at IS NULL
       LEFT JOIN user_directory ud ON ud.id = pp.userId
       WHERE dpm.doctorId = $1
         AND pp.deleted_at IS NULL
         AND (ud.deleted_at IS NULL OR ud.id IS NULL)
         AND (COALESCE(pp.name, ud.name) ILIKE $2 OR ud.email ILIKE $2)`,
      [req.user.sub, searchQuery]
    );

    const data = rows.map((row) => ({
      id: row.id,
      userId: row.userid,
      name: row.name,
      email: row.email,
      dob: row.dob,
      conditions: row.conditions,
    }));

    res.json({
      data,
      total: parseInt(countRows[0].count, 10),
    });
  });

  app.get('/patients/:id', ensureRole('doctor'), async (req, res) => {
    const { rows } = await db.query(
      `SELECT
         pp.id,
         pp.userId,
         COALESCE(pp.name, ud.name) AS name,
         ud.email,
         pp.dob,
         pp.conditions
       FROM patient_profiles pp
       JOIN doctor_patient_map dpm ON pp.id = dpm.patientId AND dpm.deleted_at IS NULL
       LEFT JOIN user_directory ud ON ud.id = pp.userId
       WHERE pp.id = $1
         AND pp.deleted_at IS NULL
         AND (ud.deleted_at IS NULL OR ud.id IS NULL)
         AND dpm.doctorId = $2`,
      [req.params.id, req.user.sub]
    );

    const patient = rows[0];
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found or not assigned' });
    }

    res.json({
      id: patient.id,
      userId: patient.userid,
      name: patient.name,
      email: patient.email,
      dob: patient.dob,
      conditions: patient.conditions,
    });
  });

  app.post('/patients', ensureRole('doctor'), async (req, res) => {
    const { name, email, password, dob } = req.body || {};
    if (!name || !email || !password || !dob) return res.status(400).json({ error: 'Missing fields' });

    try {
      const gatewayBase = 'http://api-gateway:8080';

      const { data: authData } = await axios.post(`${gatewayBase}/api/auth/register-patient`, { name, email, password }, {
        headers: { Authorization: req.headers.authorization },
      });

      const { data: patientData } = await axios.post(`${gatewayBase}/api/patients/profiles`, {
        userId: authData.id,
        name,
        dob,
      }, {
        headers: { Authorization: req.headers.authorization },
      });

      await assignDoctorMapping({ doctorId: req.user.sub, patientId: patientData.id });

      await publishAssignmentEvent('DOCTOR_PATIENT_ASSIGNED', {
        doctorId: req.user.sub,
        patientId: patientData.id,
      });

      res.status(201).json({ ...authData, ...patientData });
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      console.error('[doctor-service] Failed to create patient', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Review prescription requests from patient-service
  app.get('/prescriptions/requests', ensureRole('doctor'), async (req, res) => {
    const { data } = await patientApi.get('/internal/prescriptions/requests', {
      headers: { Authorization: req.headers.authorization }
    });
    res.json(data);
  });

  app.post('/prescriptions/requests/:id/:action', ensureRole('doctor'), async (req, res) => {
    const status = req.params.action === 'approve' ? 'approved' : 'denied';
    const { data } = await patientApi.post(`/internal/prescriptions/requests/${req.params.id}/status`, { status }, {
      headers: { Authorization: req.headers.authorization }
    });
    res.json(data);
  });
}

createApp({ name: 'doctor-service', routes, port: PORT });
