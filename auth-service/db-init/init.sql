CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  passwordHash TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_active
  ON users (email)
  WHERE deleted_at IS NULL;

INSERT INTO users (id, role, name, email, passwordHash)
SELECT 'default-admin', 'admin', 'Admin', 'admin@healthconnect.com', 'adminpass'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE email = 'admin@healthconnect.com' AND deleted_at IS NULL
);
