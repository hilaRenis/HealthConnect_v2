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

CREATE TABLE IF NOT EXISTS prescription_requests (
  id TEXT PRIMARY KEY,
  patientId TEXT NOT NULL,
  medication TEXT,
  notes TEXT,
  status TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS prescription_requests_patient_idx
  ON prescription_requests (patientId)
  WHERE deleted_at IS NULL;
