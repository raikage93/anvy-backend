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
