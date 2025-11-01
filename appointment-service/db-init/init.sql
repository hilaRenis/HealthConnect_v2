CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patientUserId TEXT NOT NULL,
  doctorUserId TEXT NOT NULL,
  date TEXT,
  slot TEXT,
  status TEXT,
  startTime TIMESTAMPTZ,
  endTime TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS appointments_doctor_active_idx
  ON appointments (doctorUserId)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS appointments_patient_active_idx
  ON appointments (patientUserId)
  WHERE deleted_at IS NULL;

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
