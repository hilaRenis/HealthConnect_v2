const {nanoid} = require('nanoid');
const {createApp} = require('./http');
const db = require('./db');
const { publishEvent, startConsumer } = require('./kafka');

const USER_EVENTS_TOPIC = 'user.events';
const PATIENT_EVENTS_TOPIC = 'patient.events';
const APPOINTMENT_EVENTS_TOPIC = 'appointment.events';

const PORT = process.env.PORT || 3004;

function ensureRole(...roles) {
    const allowedRoles = Array.isArray(roles[0]) ? roles[0] : roles;
    return (req, res, next) => (allowedRoles.includes(req.user?.role) ? next() : res.status(403).json({error: 'Forbidden'}));
}

let cachedTimeColumnSupport = null;

async function supportsTimeColumns() {
    if (cachedTimeColumnSupport !== null) return cachedTimeColumnSupport;
    try {
        const {rows} = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'appointments'");
        const columns = rows.map((row) => row.column_name);
        cachedTimeColumnSupport = columns.includes('starttime') && columns.includes('endtime');
    } catch (error) {
        cachedTimeColumnSupport = false;
    }
    return cachedTimeColumnSupport;
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
}

async function softDeleteUserDirectory({ id, deletedAt }) {
    if (!id) return;
    await db.query('UPDATE user_directory SET deleted_at = $2 WHERE id = $1', [id, deletedAt || new Date().toISOString()]);
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
    if (id) {
        await db.query('UPDATE patient_profiles SET deleted_at = $2 WHERE id = $1', [id, timestamp]);
    } else if (userId) {
        await db.query('UPDATE patient_profiles SET deleted_at = $2 WHERE userId = $1 AND deleted_at IS NULL', [userId, timestamp]);
    }
}

async function handleDomainEvent(topic, event) {
    if (!event || !event.type) return;

    switch (topic) {
        case USER_EVENTS_TOPIC:
            if (event.type === 'USER_CREATED' || event.type === 'USER_UPDATED') {
                await upsertUserDirectory(event);
            } else if (event.type === 'USER_DELETED') {
                await softDeleteUserDirectory(event);
            }
            break;
        case PATIENT_EVENTS_TOPIC:
            if (event.type === 'PATIENT_CREATED') {
                await upsertPatientProfile(event);
            } else if (event.type === 'PATIENT_DELETED') {
                await softDeletePatientProfile(event);
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
            groupId: 'appointment-service-projections',
            topics: [USER_EVENTS_TOPIC, PATIENT_EVENTS_TOPIC],
            handleMessage: handleDomainEvent,
        });
    } catch (error) {
        console.error('[appointment-service] Failed to initialize Kafka consumers', error);
    }
}

initializeConsumers();

function safeToISOString(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDateInput(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        if (trimmed.includes('T')) return normalizeDateInput(trimmed.split('T')[0]);
    }
    const iso = safeToISOString(value);
    return iso ? iso.slice(0, 10) : null;
}

function normalizeSlotInput(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed;
        if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed.slice(0, 5);
    }
    const iso = safeToISOString(value);
    return iso ? iso.slice(11, 16) : null;
}

function combineToIso(dateStr, slotStr) {
    if (!dateStr || !slotStr) return null;
    const trimmedSlot = slotStr.trim();
    const timePart = /^\d{2}:\d{2}:\d{2}$/.test(trimmedSlot) ? trimmedSlot
        : /^\d{2}:\d{2}$/.test(trimmedSlot) ? `${trimmedSlot}:00`
            : null;
    if (!timePart) return null;
    const localDate = `${dateStr}T${timePart}`;
    return safeToISOString(localDate);
}

function formatLocalDateFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatLocalTimeFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function mapAppointmentRow(row) {
    const startIso = row.starttime ? safeToISOString(row.starttime) : combineToIso(row.date, row.slot);
    const startDateObj = row.starttime ? new Date(row.starttime) : (startIso ? new Date(startIso) : null);
    let endIsoValue = row.endtime ? safeToISOString(row.endtime) : null;
    if (!endIsoValue && startIso) {
        const derivedEnd = new Date(startIso);
        if (!Number.isNaN(derivedEnd.getTime())) {
            derivedEnd.setMinutes(derivedEnd.getMinutes() + 30);
            endIsoValue = derivedEnd.toISOString();
        }
    }

    return {
        id: row.id,
        patientUserId: row.patientuserid,
        doctorUserId: row.doctoruserid,
        patientProfileId: row.patient_profile_id,
        patientName: row.patient_name || null,
        patientEmail: row.patient_email || null,
        doctorName: row.doctor_name || null,
        doctorEmail: row.doctor_email || null,
        date: row.date || formatLocalDateFromDate(startDateObj),
        slot: row.slot || formatLocalTimeFromDate(startDateObj),
        status: row.status,
        startTime: startIso,
        endTime: endIsoValue,
    };
}

const BASE_SELECT = `
    SELECT a.*,
           pu.name  AS patient_name,
           pu.email AS patient_email,
           p.id     AS patient_profile_id,
           du.name  AS doctor_name,
           du.email AS doctor_email
    FROM appointments a
             LEFT JOIN user_directory pu ON pu.id = a.patientUserId AND pu.deleted_at IS NULL
             LEFT JOIN patient_profiles p ON p.userId = a.patientUserId AND p.deleted_at IS NULL
             LEFT JOIN user_directory du ON du.id = a.doctorUserId AND du.deleted_at IS NULL
`;

function routes(app) {
    // Create appointment (patient → doctor)
    app.post('/', ensureRole(['patient', 'admin', 'doctor']), async (req, res) => {
        const {
            doctorUserId,
            date,
            slot,
            startTime,
            endTime,
            patientUserId: overridePatientUserId,
        } = req.body || {};

        const callerRole = req.user?.role;
        let patientUserId = req.user?.sub;
        if (callerRole === 'admin' || callerRole === 'doctor') {
            patientUserId = overridePatientUserId;
            if (!patientUserId) {
                return res.status(400).json({error: 'patientUserId is required for this appointment.'});
            }
        }

        if (!patientUserId) {
            return res.status(400).json({error: 'Invalid patient context'});
        }

        let finalDoctorUserId = doctorUserId;
        if (!finalDoctorUserId && callerRole !== 'doctor') {
            return res.status(400).json({error: 'Missing doctorUserId'});
        }
        if (callerRole === 'doctor') {
            finalDoctorUserId = req.user.sub;
        }

        if (!finalDoctorUserId) {
            return res.status(400).json({error: 'Invalid doctor context'});
        }

        const startIsoFromPayload = safeToISOString(startTime);
        const endIsoFromPayload = safeToISOString(endTime);

        let normalizedDate = normalizeDateInput(date);
        let normalizedSlot = normalizeSlotInput(slot);

        if (startIsoFromPayload) {
            normalizedDate = normalizedDate || startIsoFromPayload.slice(0, 10);
            normalizedSlot = normalizedSlot || startIsoFromPayload.slice(11, 16);
        }

        if (!normalizedDate || !normalizedSlot) {
            return res.status(400).json({error: 'Missing date/slot information for appointment.'});
        }

        const fallbackStart = combineToIso(normalizedDate, normalizedSlot);
        const startIso = startIsoFromPayload || fallbackStart;

        let computedEndIso = endIsoFromPayload;
        if (!computedEndIso && startIso) {
            const eg = new Date(startIso);
            if (!Number.isNaN(eg.getTime())) {
                eg.setMinutes(eg.getMinutes() + 30);
                computedEndIso = eg.toISOString();
            }
        }

        try {
            const hasTimeColumns = await supportsTimeColumns();

            if (hasTimeColumns && startIso && computedEndIso) {
                const {rows} = await db.query(
                    'SELECT 1 FROM appointments WHERE doctorUserId = $1 AND deleted_at IS NULL AND (startTime, endTime) OVERLAPS ($2::timestamptz, $3::timestamptz)',
                    [finalDoctorUserId, startIso, computedEndIso]
                );
                if (rows.length > 0) {
                    return res.status(409).json({error: 'This time range overlaps with an existing appointment for the selected doctor.'});
                }
            } else {
                const {rows} = await db.query(
                    'SELECT 1 FROM appointments WHERE doctorUserId = $1 AND date = $2 AND slot = $3 AND deleted_at IS NULL',
                    [finalDoctorUserId, normalizedDate, normalizedSlot]
                );
                if (rows.length > 0) {
                    return res.status(409).json({error: 'This time slot is already booked for the selected doctor.'});
                }
            }

            const id = nanoid();
            const columns = ['id', 'patientUserId', 'doctorUserId', 'date', 'slot', 'status'];
            const values = [id, patientUserId, finalDoctorUserId, normalizedDate, normalizedSlot, 'pending'];
            const placeholders = columns.map((_, idx) => `$${idx + 1}`);

            if (hasTimeColumns && startIso) {
                columns.push('startTime');
                placeholders.push(`$${placeholders.length + 1}`);
                values.push(startIso);
            }
            if (hasTimeColumns && computedEndIso) {
                columns.push('endTime');
                placeholders.push(`$${placeholders.length + 1}`);
                values.push(computedEndIso);
            }

            await db.query(
                `INSERT INTO appointments (${columns.join(', ')})
                 VALUES (${placeholders.join(', ')})`,
                values
            );

            const {rows: createdRows} = await db.query(`${BASE_SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
            const createdRow = createdRows[0];
            await emitAppointmentEvent('APPOINTMENT_CREATED', createdRow);
            res.status(201).json(mapAppointmentRow(createdRow));
        } catch (error) {
            console.error('[appointment-service] Failed to create appointment', error);
            res.status(500).json({error: 'Internal server error'});
        }
    });

    app.get('/', ensureRole('admin'), async (req, res) => {
        try {
            const hasTimeColumns = await supportsTimeColumns();
            const orderClause = hasTimeColumns ? 'ORDER BY startTime NULLS LAST, date, slot' : 'ORDER BY date, slot';
            const {rows} = await db.query(`${BASE_SELECT} WHERE a.deleted_at IS NULL ${orderClause}`);
            res.json(rows.map(mapAppointmentRow));
        } catch (error) {
            console.error('[appointment-service] Failed to list appointments', error);
            res.status(500).json({error: 'Internal server error'});
        }
    });

    // List mine (both roles)
    app.get('/mine', async (req, res) => {
        const uid = req.user?.sub;
        try {
            const hasTimeColumns = await supportsTimeColumns();
            const orderClause = hasTimeColumns ? 'ORDER BY startTime NULLS LAST, date, slot' : 'ORDER BY date, slot';
            const {rows} = await db.query(`${BASE_SELECT} WHERE a.deleted_at IS NULL AND (a.patientUserId = $1 OR a.doctorUserId = $1) ${orderClause}`, [uid]);
            res.json(rows.map(mapAppointmentRow));
        } catch (error) {
            console.error('[appointment-service] Failed to list user appointments', error);
            res.status(500).json({error: 'Internal server error'});
        }
    });

    app.get('/:id', ensureRole(['admin', 'doctor', 'patient']), async (req, res) => {
        const {id} = req.params;
        const caller = req.user;
        try {
            const {rows} = await db.query(`${BASE_SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
            const row = rows[0];
            if (!row) {
                return res.status(404).json({error: 'Appointment not found'});
            }
            if (caller?.role !== 'admin' && row.patientuserid !== caller?.sub && row.doctoruserid !== caller?.sub) {
                return res.status(403).json({error: 'Forbidden'});
            }
            res.json(mapAppointmentRow(row));
        } catch (error) {
            console.error('[appointment-service] Failed to fetch appointment', error);
            res.status(500).json({error: 'Internal server error'});
        }
    });

    app.put('/:id', ensureRole('admin'), async (req, res) => {
        const {id} = req.params;
        const {
            doctorUserId,
            patientUserId: overridePatientUserId,
            startTime,
            endTime,
            date,
            slot,
            status,
        } = req.body || {};

        try {
            const {rows: existingRows} = await db.query('SELECT * FROM appointments WHERE id = $1 AND deleted_at IS NULL', [id]);
            if (existingRows.length === 0) {
                return res.status(404).json({error: 'Appointment not found'});
            }

            const existing = existingRows[0];

            const finalDoctorUserId = doctorUserId || existing.doctoruserid;
            const finalPatientUserId = overridePatientUserId || existing.patientuserid;

            if (!finalDoctorUserId || !finalPatientUserId) {
                return res.status(400).json({error: 'Missing doctor or patient information'});
            }

            const providedDate = normalizeDateInput(date);
            const providedSlot = normalizeSlotInput(slot);

            const startIsoCandidate = safeToISOString(startTime);
            const existingStartIso = existing.starttime ? safeToISOString(existing.starttime) : combineToIso(existing.date, existing.slot);
            const fallbackFromProvided = combineToIso(providedDate || existing.date, providedSlot || existing.slot);
            const finalStartIso = startIsoCandidate || fallbackFromProvided || existingStartIso;

            if (!finalStartIso) {
                return res.status(400).json({error: 'Invalid start time value'});
            }

            const derivedStartDate = new Date(finalStartIso);

            const finalDate = providedDate || existing.date || formatLocalDateFromDate(derivedStartDate);
            if (!finalDate) {
                return res.status(400).json({error: 'Invalid date value'});
            }

            let finalSlot = providedSlot || existing.slot || formatLocalTimeFromDate(derivedStartDate);
            if (!finalSlot) {
                return res.status(400).json({error: 'Invalid slot value'});
            }

            let finalEndIso = safeToISOString(endTime);
            const existingEndIso = existing.endtime ? safeToISOString(existing.endtime) : null;
            if (!finalEndIso) {
                finalEndIso = existingEndIso;
            }
            if (!finalEndIso && finalStartIso) {
                const derivedEnd = new Date(finalStartIso);
                if (!Number.isNaN(derivedEnd.getTime())) {
                    derivedEnd.setMinutes(derivedEnd.getMinutes() + 30);
                    finalEndIso = derivedEnd.toISOString();
                }
            }

            if (!finalEndIso) {
                return res.status(400).json({error: 'Invalid end time value'});
            }

            const finalStatus = status ?? existing.status ?? 'pending';

            const hasTimeColumns = await supportsTimeColumns();

            if (hasTimeColumns && finalStartIso && finalEndIso) {
                const {rows: overlapRows} = await db.query(
                    'SELECT 1 FROM appointments WHERE doctorUserId = $1 AND id <> $4 AND deleted_at IS NULL AND (startTime, endTime) OVERLAPS ($2::timestamptz, $3::timestamptz)',
                    [finalDoctorUserId, finalStartIso, finalEndIso, id]
                );
                if (overlapRows.length > 0) {
                    return res.status(409).json({error: 'This time range overlaps with an existing appointment for the selected doctor.'});
                }
            } else {
                const {rows: overlapRows} = await db.query(
                    'SELECT 1 FROM appointments WHERE doctorUserId = $1 AND date = $2 AND slot = $3 AND id <> $4 AND deleted_at IS NULL',
                    [finalDoctorUserId, finalDate, finalSlot, id]
                );
                if (overlapRows.length > 0) {
                    return res.status(409).json({error: 'This time slot is already booked for the selected doctor.'});
                }
            }

            const updateColumns = ['patientUserId', 'doctorUserId', 'date', 'slot', 'status'];
            const updateValues = [finalPatientUserId, finalDoctorUserId, finalDate, finalSlot, finalStatus];
            const setFragments = updateColumns.map((col, idx) => `${col} = $${idx + 1}`);

            if (hasTimeColumns) {
                setFragments.push(`startTime = $${setFragments.length + 1}`);
                updateValues.push(finalStartIso);
                setFragments.push(`endTime = $${setFragments.length + 1}`);
                updateValues.push(finalEndIso);
            }

            updateValues.push(id);

            await db.query(
                `UPDATE appointments
                 SET ${setFragments.join(', ')}
                 WHERE id = $${updateValues.length} AND deleted_at IS NULL`,
                updateValues
            );

            const {rows: finalRows} = await db.query(`${BASE_SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
            if (finalRows.length === 0) {
                return res.status(404).json({error: 'Appointment not found'});
            }
            const updatedRow = finalRows[0];
            await emitAppointmentEvent('APPOINTMENT_UPDATED', updatedRow);
            res.json(mapAppointmentRow(updatedRow));
        } catch (error) {
            console.error('[appointment-service] Failed to update appointment', error);
            res.status(500).json({error: 'Internal server error'});
        }
    });

    app.delete('/:id', ensureRole('admin'), async (req, res) => {
        try {
            const { rows } = await db.query(
                'UPDATE appointments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, patientUserId, doctorUserId, status, date, slot, startTime, endTime',
                [req.params.id]
            );
            if (rows.length === 0) {
                return res.status(404).json({error: 'Appointment not found'});
            }
            const deletedRow = rows[0];
            await publishEvent(APPOINTMENT_EVENTS_TOPIC, {
                type: 'APPOINTMENT_DELETED',
                id: deletedRow.id,
                patientUserId: deletedRow.patientuserid,
                doctorUserId: deletedRow.doctoruserid,
            });
            res.status(204).send();
        } catch (error) {
            console.error('[appointment-service] Failed to delete appointment', error);
            res.status(500).json({error: 'Internal server error'});
        }
    });

    // Doctor actions
    app.post('/:id/approve', ensureRole('doctor'), async (req, res) => {
        const {rows} = await db.query(
            "UPDATE appointments SET status = 'approved' WHERE id = $1 AND doctorUserId = $2 AND deleted_at IS NULL RETURNING *",
            [req.params.id, req.user.sub]
        );
        if (rows.length === 0) return res.status(404).json({error: 'Not found or not authorized'});
        await emitAppointmentEvent('APPOINTMENT_APPROVED', rows[0]);
        res.json(rows[0]);
    });

    app.post('/:id/deny', ensureRole('doctor'), async (req, res) => {
        const {rows} = await db.query(
            "UPDATE appointments SET status = 'denied' WHERE id = $1 AND doctorUserId = $2 AND deleted_at IS NULL RETURNING *",
            [req.params.id, req.user.sub]
        );
        if (rows.length === 0) return res.status(404).json({error: 'Not found or not authorized'});
        await emitAppointmentEvent('APPOINTMENT_DENIED', rows[0]);
        res.json(rows[0]);
    });

    // Cancel (patient or doctor)
    app.post('/:id/cancel', async (req, res) => {
        const {rows} = await db.query(
            "UPDATE appointments SET status = 'cancelled' WHERE id = $1 AND deleted_at IS NULL AND (patientUserId = $2 OR doctorUserId = $2) RETURNING *",
            [req.params.id, req.user.sub]
        );
        if (rows.length === 0) return res.status(404).json({error: 'Not found or not authorized'});
        await emitAppointmentEvent('APPOINTMENT_CANCELLED', rows[0]);
        res.json(rows[0]);
    });
}

createApp({name: 'appointment-service', routes, port: PORT});
async function emitAppointmentEvent(type, row) {
    if (!row) return;
    const payload = mapAppointmentRow(row);
    await publishEvent(APPOINTMENT_EVENTS_TOPIC, { type, ...payload });
}
