CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT,
  email TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_active
  ON users (email)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT,
  dob TEXT,
  conditions TEXT[],
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS patients_user_active_unique
  ON patients (userId)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS doctor_patient_map (
  id BIGSERIAL PRIMARY KEY,
  doctorId TEXT NOT NULL,
  patientId TEXT NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS doctor_patient_active_unique
  ON doctor_patient_map (doctorId, patientId)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patientUserId TEXT,
  doctorUserId TEXT,
  status TEXT,
  date TEXT,
  slot TEXT,
  startTime TIMESTAMPTZ,
  endTime TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS prescription_requests (
  id TEXT PRIMARY KEY,
  patientId TEXT,
  medication TEXT,
  notes TEXT,
  status TEXT,
  deleted_at TIMESTAMPTZ
);
