CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  specialty TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS doctor_patient_map (
  id BIGSERIAL PRIMARY KEY,
  doctorId TEXT NOT NULL,
  patientId TEXT NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS doctor_patient_unique_active
  ON doctor_patient_map (doctorId, patientId)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY,
  doctorUserId TEXT NOT NULL,
  date TEXT,
  slot TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_directory (
  id TEXT PRIMARY KEY,
  role TEXT,
  name TEXT,
  email TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT,
  dob TEXT,
  conditions TEXT[],
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_profiles_user_active_unique
  ON patient_profiles (userId)
  WHERE deleted_at IS NULL;
