const { createApp } = require('./http');
const db = require('./db');
const axios = require('./axiosInstance');
const { publishEvent, startConsumer } = require('./kafka');

const USER_EVENTS_TOPIC = 'user.events';
const PATIENT_EVENTS_TOPIC = 'patient.events';
const DOCTOR_ASSIGNMENT_TOPIC = 'doctor-patient.events';
const APPOINTMENT_EVENTS_TOPIC = 'appointment.events';
const PRESCRIPTION_EVENTS_TOPIC = 'prescription.events';

const PORT = process.env.PORT || 3006;

function ensureRole(roleOrRoles) {
  const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  return (req, res, next) => (roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Forbidden' }));
}

async function upsertUser(event) {
  const { id, role, name, email } = event;
  if (!id) return;
  await db.query(
    `INSERT INTO users (id, role, name, email, deleted_at)
     VALUES ($1, $2, $3, $4, NULL)
     ON CONFLICT (id) DO UPDATE
       SET role = EXCLUDED.role,
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           deleted_at = NULL`,
    [id, role, name, email]
  );
}

async function softDeleteUser(event) {
  const { id, deletedAt, role } = event;
  if (!id) return;
  const timestamp = deletedAt || new Date().toISOString();
  await db.query('UPDATE users SET deleted_at = $2 WHERE id = $1', [id, timestamp]);
  if (role === 'doctor') {
    await db.query('UPDATE doctor_patient_map SET deleted_at = $2 WHERE doctorId = $1 AND deleted_at IS NULL', [id, timestamp]);
  }
}

async function upsertPatient(event) {
  const { id, userId, name, dob, conditions } = event;
  if (!id) return;
  await db.query(
    `INSERT INTO patients (id, userId, name, dob, conditions, deleted_at)
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

async function softDeletePatient(event) {
  const timestamp = event.deletedAt || new Date().toISOString();
  if (event.id) {
    await db.query('UPDATE patients SET deleted_at = $2 WHERE id = $1', [event.id, timestamp]);
    await db.query('UPDATE doctor_patient_map SET deleted_at = $2 WHERE patientId = $1 AND deleted_at IS NULL', [event.id, timestamp]);
  }
  if (event.userId) {
    const { rows } = await db.query('SELECT id FROM patients WHERE userId = $1', [event.userId]);
    for (const row of rows) {
      await db.query('UPDATE patients SET deleted_at = $2 WHERE id = $1', [row.id, timestamp]);
      await db.query('UPDATE doctor_patient_map SET deleted_at = $2 WHERE patientId = $1 AND deleted_at IS NULL', [row.id, timestamp]);
    }
  }
}

async function assignDoctor(event) {
  const { doctorId, patientId } = event;
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

async function unassignDoctor(event) {
  const { doctorId, patientId, deletedAt } = event;
  if (!doctorId || !patientId) return;
  await db.query(
    'UPDATE doctor_patient_map SET deleted_at = $3 WHERE doctorId = $1 AND patientId = $2 AND deleted_at IS NULL',
    [doctorId, patientId, deletedAt || new Date().toISOString()]
  );
}

async function upsertAppointment(event) {
  const { id, patientUserId, doctorUserId, status, date, slot, startTime, endTime } = event;
  if (!id) return;
  await db.query(
    `INSERT INTO appointments (id, patientUserId, doctorUserId, status, date, slot, startTime, endTime, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
     ON CONFLICT (id) DO UPDATE
       SET patientUserId = EXCLUDED.patientUserId,
           doctorUserId = EXCLUDED.doctorUserId,
           status = EXCLUDED.status,
           date = EXCLUDED.date,
           slot = EXCLUDED.slot,
           startTime = EXCLUDED.startTime,
           endTime = EXCLUDED.endTime,
           deleted_at = NULL`,
    [id, patientUserId, doctorUserId, status, date, slot, startTime, endTime]
  );
}

async function removeAppointment(event) {
  const { id } = event;
  if (!id) return;
  await db.query('UPDATE appointments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL', [id]);
}

async function upsertPrescription(event) {
  const { id, patientId, medication, notes, status } = event;
  if (!id) return;
  await db.query(
    `INSERT INTO prescription_requests (id, patientId, medication, notes, status, deleted_at)
     VALUES ($1, $2, $3, $4, $5, NULL)
     ON CONFLICT (id) DO UPDATE
       SET patientId = EXCLUDED.patientId,
           medication = EXCLUDED.medication,
           notes = EXCLUDED.notes,
           status = EXCLUDED.status,
           deleted_at = NULL`,
    [id, patientId, medication, notes, status]
  );
}

async function removePrescription(event) {
  const { id, deletedAt } = event;
  if (!id) return;
  await db.query(
    'UPDATE prescription_requests SET deleted_at = $2 WHERE id = $1',
    [id, deletedAt || new Date().toISOString()]
  );
}

async function handleDomainEvent(topic, event) {
  if (!event || !event.type) return;

  switch (topic) {
    case USER_EVENTS_TOPIC:
      if (event.type === 'USER_CREATED' || event.type === 'USER_UPDATED') {
        await upsertUser(event);
      } else if (event.type === 'USER_DELETED') {
        await softDeleteUser(event);
      }
      break;
    case PATIENT_EVENTS_TOPIC:
      if (event.type === 'PATIENT_CREATED') {
        await upsertPatient(event);
      } else if (event.type === 'PATIENT_DELETED') {
        await softDeletePatient(event);
      }
      break;
    case DOCTOR_ASSIGNMENT_TOPIC:
      if (event.type === 'DOCTOR_PATIENT_ASSIGNED') {
        await assignDoctor(event);
      } else if (event.type === 'DOCTOR_PATIENT_UNASSIGNED') {
        await unassignDoctor(event);
      }
      break;
    case APPOINTMENT_EVENTS_TOPIC:
      if (event.type === 'APPOINTMENT_DELETED') {
        await removeAppointment(event);
      } else {
        await upsertAppointment(event);
      }
      break;
    case PRESCRIPTION_EVENTS_TOPIC:
      if (event.type === 'PRESCRIPTION_REQUEST_CREATED' || event.type === 'PRESCRIPTION_REQUEST_STATUS_CHANGED') {
        await upsertPrescription(event);
      } else if (event.type === 'PRESCRIPTION_REQUEST_DELETED') {
        await removePrescription(event);
      }
      break;
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
      groupId: 'admin-service-projections',
      topics: [
        USER_EVENTS_TOPIC,
        PATIENT_EVENTS_TOPIC,
        DOCTOR_ASSIGNMENT_TOPIC,
        APPOINTMENT_EVENTS_TOPIC,
        PRESCRIPTION_EVENTS_TOPIC,
      ],
      handleMessage: handleDomainEvent,
    });
  } catch (error) {
    console.error('[admin-service] Failed to initialize Kafka consumers', error);
  }
}

initializeConsumers();

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

async function fetchPatientById(id) {
  const { rows } = await db.query(
    `SELECT 
       p.id,
       p.userId,
       COALESCE(p.name, u.name) AS name,
       p.dob,
       p.conditions,
       u.email,
       u.name AS user_name,
       u.role AS user_role,
       dpm.doctorId AS doctor_id,
       du.name AS doctor_name,
       du.email AS doctor_email
     FROM patients p
     JOIN users u ON u.id = p.userId
     LEFT JOIN doctor_patient_map dpm ON dpm.patientId = p.id AND dpm.deleted_at IS NULL
     LEFT JOIN users du ON du.id = dpm.doctorId AND du.deleted_at IS NULL
     WHERE p.id = $1
       AND p.deleted_at IS NULL
       AND u.deleted_at IS NULL`,
    [id]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    userId: row.userid,
    name: row.name,
    dob: row.dob,
    conditions: row.conditions,
    email: row.email,
    userName: row.user_name,
    userRole: row.user_role,
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    doctorEmail: row.doctor_email,
  };
}

function routes(app) {
  app.get('/users/:id', ensureRole('admin'), async (req, res) => {
    try {
      const { rows } = await db.query(
        'SELECT id, role, name, email FROM users WHERE id = $1 AND deleted_at IS NULL',
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(rows[0]);
    } catch (error) {
      console.error('[admin-service] Failed to fetch user', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/doctors', ensureRole('admin'), async (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

    // Call auth-service to create the doctor user
    try {
      const { data } = await axios.post('/api/auth/register-doctor', { name, email, password }, {
        headers: { 'Authorization': req.headers.authorization }
      });

      // Optimistically update local projections so the doctor appears immediately
      await upsertUser({ id: data.id, role: 'doctor', name, email });

      res.status(201).json(data);
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      return res.status(500).json({ error: 'Internal server error' });
    }

  });

  app.put('/doctors/:id', ensureRole('admin'), async (req, res) => {
    const { id } = req.params;
    const { name, email, password } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    try {
      const payload = { name, email };
      if (password) {
        payload.password = password;
      }

      const { data } = await axios.put(`/api/auth/users/${id}`, payload, {
        headers: { Authorization: req.headers.authorization },
      });

      res.json(data);
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/doctors/:id', ensureRole('admin'), async (req, res) => {
    const { id } = req.params;

    try {
      const { rows: userRows } = await db.query('SELECT id FROM users WHERE id = $1 AND role = $2', [id, 'doctor']);
      if (userRows.length === 0) {
        return res.status(404).json({ error: 'Doctor not found' });
      }

      const timestamp = new Date().toISOString();
      await softDeleteUser({ id, role: 'doctor', deletedAt: timestamp });

      try {
        await axios.delete(`/api/auth/users/${id}`, {
          headers: { Authorization: req.headers.authorization },
        });
      } catch (error) {
        if (!(error.response && error.response.status === 404)) {
          throw error;
        }
      }

      res.status(204).send();
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      console.error('[admin-service] Failed to delete doctor', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/stats', ensureRole('admin'), async (req, res) => {
    const { rows: patientRows } = await db.query("SELECT COUNT(*) FROM users WHERE role = 'patient' AND deleted_at IS NULL");
    const { rows: doctorRows } = await db.query("SELECT COUNT(*) FROM users WHERE role = 'doctor' AND deleted_at IS NULL");
    res.json({
      patients: parseInt(patientRows[0].count, 10),
      doctors: parseInt(doctorRows[0].count, 10)
    });
  });

  app.get('/doctors', ensureRole('admin'), async (req, res) => {
    const { page = 1, limit = 10, sortBy = 'name', order = 'asc', search = '' } = req.query;
    const offset = (page - 1) * limit;
    const searchQuery = `%${search}%`;

    const { rows } = await db.query(
      `SELECT id, name, email FROM users
       WHERE role = 'doctor' AND deleted_at IS NULL AND name ILIKE $1
       ORDER BY ${sortBy} ${order}
       LIMIT $2 OFFSET $3`,
      [searchQuery, limit, offset]
    );

    const { rows: countRows } = await db.query(
      "SELECT COUNT(*) FROM users WHERE role = 'doctor' AND deleted_at IS NULL AND name ILIKE $1",
      [searchQuery]
    );

    res.json({
      data: rows,
      total: parseInt(countRows[0].count, 10),
    });
  });

  app.get('/patients', ensureRole('admin'), async (req, res) => {
    const { page = 1, limit = 10, sortBy = 'name', order = 'asc', search = '' } = req.query;

    const pageNum = Number(page) > 0 ? Number(page) : 1;
    const limitNum = Number(limit) > 0 ? Number(limit) : 10;
    const offset = (pageNum - 1) * limitNum;
    const searchQuery = `%${search}%`;

    const sortColumns = {
      name: 'COALESCE(p.name, u.name)',
      dob: 'p.dob',
      email: 'u.email',
      doctor: 'du.name',
      doctorName: 'du.name'
    };
    const orderColumn = sortColumns[sortBy] || sortColumns.name;
    const orderDirection = order?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const { rows } = await db.query(
      `SELECT 
         p.id,
         p.userId,
         COALESCE(p.name, u.name) AS name,
         p.dob,
         p.conditions,
         u.email,
         u.name AS user_name,
         u.role AS user_role,
         dpm.doctorId AS doctor_id,
         du.name AS doctor_name,
         du.email AS doctor_email
       FROM patients p
       JOIN users u ON u.id = p.userId AND u.deleted_at IS NULL
       LEFT JOIN doctor_patient_map dpm ON dpm.patientId = p.id AND dpm.deleted_at IS NULL
       LEFT JOIN users du ON du.id = dpm.doctorId AND du.deleted_at IS NULL
       WHERE p.deleted_at IS NULL
         AND (COALESCE(p.name, u.name) ILIKE $1 OR u.email ILIKE $1 OR du.name ILIKE $1)
       ORDER BY ${orderColumn} ${orderDirection}
       LIMIT $2 OFFSET $3`,
      [searchQuery, limitNum, offset]
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(DISTINCT p.id) 
       FROM patients p
       JOIN users u ON u.id = p.userId AND u.deleted_at IS NULL
       LEFT JOIN doctor_patient_map dpm ON dpm.patientId = p.id AND dpm.deleted_at IS NULL
       LEFT JOIN users du ON du.id = dpm.doctorId AND du.deleted_at IS NULL
       WHERE p.deleted_at IS NULL
         AND (COALESCE(p.name, u.name) ILIKE $1 OR u.email ILIKE $1 OR du.name ILIKE $1)`,
      [searchQuery]
    );

    const data = rows.map((row) => ({
      ...row,
      doctor: row.doctor_id ? {
        id: row.doctor_id,
        name: row.doctor_name,
        email: row.doctor_email
      } : null,
      doctorId: row.doctor_id,
      doctorName: row.doctor_name,
      doctorEmail: row.doctor_email
    }));

    res.json({
      data,
      total: parseInt(countRows[0].count, 10),
    });
  });

  app.get('/patients/:id', ensureRole('admin'), async (req, res) => {
    const { id } = req.params;

    const patient = await fetchPatientById(id);

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const response = {
      ...patient,
      doctor: patient.doctorId ? {
        id: patient.doctorId,
        name: patient.doctorName,
        email: patient.doctorEmail
      } : null,
      doctorId: patient.doctorId,
      doctorName: patient.doctorName,
      doctorEmail: patient.doctorEmail
    };

    res.json(response);
  });

  app.delete('/patients/:id', ensureRole('admin'), async (req, res) => {
    const { id } = req.params;

    try {
      const patient = await fetchPatientById(id);
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      const timestamp = new Date().toISOString();

      await axios.delete(`/api/patients/profiles/${id}`, {
        headers: { Authorization: req.headers.authorization },
      });

      if (patient.userId) {
        try {
          await axios.delete(`/api/auth/users/${patient.userId}`, {
            headers: { Authorization: req.headers.authorization },
          });
        } catch (error) {
          if (!(error.response && error.response.status === 404)) {
            throw error;
          }
        }
      }

      await softDeletePatient({ id, userId: patient.userId, deletedAt: timestamp });

      res.status(204).send();
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      console.error('[admin-service] Failed to delete patient', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/patients/:patientId/assign-doctor', ensureRole('admin'), async (req, res) => {
    const { patientId } = req.params;
    let { doctorId } = req.body;

    if (doctorId === '' || doctorId === undefined) {
      doctorId = null;
    }

    const patient = await fetchPatientById(patientId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const { rows: existingRows } = await db.query(
      'SELECT doctorId FROM doctor_patient_map WHERE patientId = $1 AND deleted_at IS NULL',
      [patientId]
    );
    const currentDoctorId = existingRows[0]?.doctorid || null;

    if (doctorId) {
      const { rows: doctorRows } = await db.query(
        'SELECT id FROM users WHERE id = $1 AND role = $2 AND deleted_at IS NULL',
        [doctorId, 'doctor']
      );
      if (doctorRows.length === 0) {
        return res.status(404).json({ error: 'Doctor not found' });
      }
    }

    const timestamp = new Date().toISOString();

    if (currentDoctorId && currentDoctorId !== doctorId) {
      await unassignDoctor({ doctorId: currentDoctorId, patientId, deletedAt: timestamp });
      await publishEvent(DOCTOR_ASSIGNMENT_TOPIC, {
        type: 'DOCTOR_PATIENT_UNASSIGNED',
        doctorId: currentDoctorId,
        patientId,
        deletedAt: timestamp,
      });
    }

    if (doctorId && doctorId !== currentDoctorId) {
      await assignDoctor({ doctorId, patientId });
      await publishEvent(DOCTOR_ASSIGNMENT_TOPIC, {
        type: 'DOCTOR_PATIENT_ASSIGNED',
        doctorId,
        patientId,
      });
    }

    const updated = await fetchPatientById(patientId);

    const response = updated ? {
      ...updated,
      doctor: updated.doctorId ? {
        id: updated.doctorId,
        name: updated.doctorName,
        email: updated.doctorEmail
      } : null,
      doctorId: updated.doctorId,
      doctorName: updated.doctorName,
      doctorEmail: updated.doctorEmail
    } : null;

    res.json({ ok: true, patient: response });
  });

  app.post('/appointments', ensureRole(['admin', 'doctor']), async (req, res) => {
    const { patientId, doctorId, startTime, endTime } = req.body || {};

    if (!patientId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    try {
      const { rows: patientRows } = await db.query('SELECT userId FROM patients WHERE id = $1 AND deleted_at IS NULL', [patientId]);
      if (patientRows.length === 0) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      const patientUserId = patientRows[0]?.userid;
      if (!patientUserId) {
        return res.status(400).json({ error: 'Patient record is missing an associated user' });
      }

      const startTimeDate = startTime ? new Date(startTime) : null;
      const startTimeIso = startTimeDate && !Number.isNaN(startTimeDate.getTime()) ? startTimeDate.toISOString() : null;
      const endTimeDate = endTime ? new Date(endTime) : null;
      const endTimeIso = endTimeDate && !Number.isNaN(endTimeDate.getTime()) ? endTimeDate.toISOString() : null;

      if (!startTimeIso) {
        return res.status(400).json({ error: 'Invalid startTime value' });
      }

      if (!endTimeIso) {
        return res.status(400).json({ error: 'Invalid endTime value' });
      }

      let finalDoctorId = doctorId;
      if (req.user.role === 'doctor') {
        finalDoctorId = req.user.sub;
        const { rows: assignmentRows } = await db.query('SELECT 1 FROM doctor_patient_map WHERE doctorId = $1 AND patientId = $2 AND deleted_at IS NULL', [finalDoctorId, patientId]);
        if (assignmentRows.length === 0) {
          return res.status(403).json({ error: 'Patient is not assigned to this doctor' });
        }
      }

      if (!finalDoctorId) {
        return res.status(400).json({ error: 'Doctor is required' });
      }

      const { rows: doctorRows } = await db.query(
        'SELECT id FROM users WHERE id = $1 AND role = $2 AND deleted_at IS NULL',
        [finalDoctorId, 'doctor']
      );
      if (doctorRows.length === 0) {
        return res.status(404).json({ error: 'Doctor not found' });
      }

      const payload = {
        patientUserId,
        doctorUserId: finalDoctorId,
        startTime: startTimeIso,
        endTime: endTimeIso,
        date: req.body?.date || formatLocalDate(startTimeDate),
        slot: req.body?.slot || formatLocalTime(startTimeDate),
      };

      const { data } = await axios.post('/api/appointments', payload, {
        headers: { 'Authorization': req.headers.authorization }
      });
      res.status(201).json(data);
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/appointments/:id', ensureRole('admin'), async (req, res) => {
    try {
      const { data } = await axios.get(`/api/appointments/${req.params.id}`, {
        headers: { Authorization: req.headers.authorization }
      });
      res.json(data);
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/appointments/:id', ensureRole('admin'), async (req, res) => {
    const { patientId, doctorId, startTime, endTime, status } = req.body || {};

    if (!patientId || !doctorId || !startTime || !endTime) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    try {
      const { rows: patientRows } = await db.query('SELECT userId FROM patients WHERE id = $1', [patientId]);
      if (patientRows.length === 0) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      const patientUserId = patientRows[0]?.userid;
      if (!patientUserId) {
        return res.status(400).json({ error: 'Patient record is missing an associated user' });
      }

      const startDate = new Date(startTime);
      const endDate = new Date(endTime);

      if (Number.isNaN(startDate.getTime())) {
        return res.status(400).json({ error: 'Invalid startTime value' });
      }

      if (Number.isNaN(endDate.getTime())) {
        return res.status(400).json({ error: 'Invalid endTime value' });
      }

      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();

      const payload = {
        patientUserId,
        doctorUserId: doctorId,
        startTime: startIso,
        endTime: endIso,
        date: req.body?.date || formatLocalDate(startDate),
        slot: req.body?.slot || formatLocalTime(startDate),
      };

      if (status) {
        payload.status = status;
      }

      const { data } = await axios.put(`/api/appointments/${req.params.id}`, payload, {
        headers: { Authorization: req.headers.authorization }
      });
      res.json(data);
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/appointments/:id', ensureRole('admin'), async (req, res) => {
    try {
      await axios.delete(`/api/appointments/${req.params.id}`, {
        headers: { Authorization: req.headers.authorization },
      });
      res.status(204).send();
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      console.error('[admin-service] Failed to delete appointment', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/patients', ensureRole('admin'), async (req, res) => {
    const { name, email, password, dob, doctorId } = req.body || {};
    if (!name || !email || !password || !dob) return res.status(400).json({ error: 'Missing fields' });

    try {
      // Call auth-service to create the patient user
      const { data: authData } = await axios.post('/api/auth/register-patient', { name, email, password }, {
        headers: { 'Authorization': req.headers.authorization }
      });

      // Create the patient profile in patient-service
      const { data: patientData } = await axios.post('/api/patients/profiles', {
        userId: authData.id,
        name,
        dob,
      }, {
        headers: { 'Authorization': req.headers.authorization }
      });

      // Immediately upsert local projections so the new patient appears without waiting for Kafka replay
      await upsertUser({ id: authData.id, role: 'patient', name, email });
      await upsertPatient({ id: patientData.id, userId: patientData.userId, name: patientData.name, dob: patientData.dob, conditions: patientData.conditions });

      if (doctorId) {
        await assignDoctor({ doctorId, patientId: patientData.id });
        await publishEvent(DOCTOR_ASSIGNMENT_TOPIC, {
          type: 'DOCTOR_PATIENT_ASSIGNED',
          doctorId,
          patientId: patientData.id,
        });
      }

      res.status(201).json({ ...authData, ...patientData });
    } catch (error) {
      if (error.response) {
        return res.status(error.response.status).json(error.response.data);
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
}

createApp({ name: 'admin-service', routes, port: PORT });
