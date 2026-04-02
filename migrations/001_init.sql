CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS default_accounts (
  id SERIAL PRIMARY KEY,
  bank_bin VARCHAR(20) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  bank_logo TEXT,
  account_no VARCHAR(50) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  appointment_time TIMESTAMP NOT NULL,
  notes TEXT DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS availability_settings (
  id SERIAL PRIMARY KEY,
  weekday SMALLINT NOT NULL UNIQUE CHECK (weekday BETWEEN 0 AND 6),
  label VARCHAR(20) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  start_time TIME,
  end_time TIME,
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO availability_settings (weekday, label, enabled, start_time, end_time)
VALUES
  (1, 'Thứ 2', TRUE, '08:00', '17:00'),
  (2, 'Thứ 3', TRUE, '08:00', '17:00'),
  (3, 'Thứ 4', TRUE, '08:00', '17:00'),
  (4, 'Thứ 5', TRUE, '08:00', '17:00'),
  (5, 'Thứ 6', TRUE, '08:00', '17:00'),
  (6, 'Thứ 7', TRUE, '08:00', '12:00'),
  (0, 'Chủ nhật', FALSE, NULL, NULL)
ON CONFLICT (weekday) DO NOTHING;

CREATE TABLE IF NOT EXISTS wheel_prizes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT DEFAULT '',
  total_quantity INTEGER NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  remaining_quantity INTEGER NOT NULL DEFAULT 0 CHECK (remaining_quantity >= 0),
  color VARCHAR(20) NOT NULL DEFAULT '#005eb8',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wheel_spins (
  id SERIAL PRIMARY KEY,
  prize_id INTEGER REFERENCES wheel_prizes(id) ON DELETE SET NULL,
  prize_name VARCHAR(120) NOT NULL,
  prize_description TEXT DEFAULT '',
  prize_color VARCHAR(20) NOT NULL DEFAULT '#005eb8',
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE wheel_spins
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS spin_date DATE;

CREATE INDEX IF NOT EXISTS idx_wheel_spins_phone_spin_date ON wheel_spins(phone, spin_date);

CREATE TABLE IF NOT EXISTS wheel_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_daily_spins_per_phone INTEGER NOT NULL DEFAULT 1 CHECK (max_daily_spins_per_phone >= 1),
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO wheel_settings (id, max_daily_spins_per_phone)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;
