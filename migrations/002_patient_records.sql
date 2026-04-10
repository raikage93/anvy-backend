CREATE TABLE IF NOT EXISTS patient_records (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  birth_year SMALLINT CHECK (birth_year IS NULL OR (birth_year >= 1900 AND birth_year <= 2100)),
  exam_date DATE NOT NULL,
  phone VARCHAR(40) DEFAULT '',
  address TEXT DEFAULT '',
  quick_medical_assessment TEXT DEFAULT '',
  va_old_mp VARCHAR(24) DEFAULT '',
  va_old_mt VARCHAR(24) DEFAULT '',
  va_old_binocular VARCHAR(24) DEFAULT '',
  va_new_mp VARCHAR(24) DEFAULT '',
  va_new_mt VARCHAR(24) DEFAULT '',
  va_new_binocular VARCHAR(24) DEFAULT '',
  sphere_old_mp NUMERIC(7, 2),
  cylinder_old_mp NUMERIC(7, 2),
  axis_old_mp SMALLINT,
  sphere_old_mt NUMERIC(7, 2),
  cylinder_old_mt NUMERIC(7, 2),
  axis_old_mt SMALLINT,
  sphere_new_mp NUMERIC(7, 2),
  cylinder_new_mp NUMERIC(7, 2),
  axis_new_mp SMALLINT,
  sphere_new_mt NUMERIC(7, 2),
  cylinder_new_mt NUMERIC(7, 2),
  axis_new_mt SMALLINT,
  next_appointment_date DATE,
  clinical_diagnosis TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_patient_records_exam_date ON patient_records(exam_date DESC);
CREATE INDEX IF NOT EXISTS idx_patient_records_full_name ON patient_records(full_name);
CREATE INDEX IF NOT EXISTS idx_patient_records_phone ON patient_records(phone);

CREATE TABLE IF NOT EXISTS patient_profiles (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  birth_year SMALLINT CHECK (birth_year IS NULL OR (birth_year >= 1900 AND birth_year <= 2100)),
  phone VARCHAR(40) NOT NULL,
  phone_digits VARCHAR(20) NOT NULL UNIQUE,
  address TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS patient_exam_results (
  id SERIAL PRIMARY KEY,
  patient_profile_id INTEGER NOT NULL REFERENCES patient_profiles(id) ON DELETE CASCADE,
  exam_date DATE NOT NULL,
  quick_medical_assessment TEXT DEFAULT '',
  va_unaided_mp VARCHAR(24) DEFAULT '',
  va_unaided_mt VARCHAR(24) DEFAULT '',
  va_unaided_binocular VARCHAR(24) DEFAULT '',
  va_old_mp VARCHAR(24) DEFAULT '',
  va_old_mt VARCHAR(24) DEFAULT '',
  va_old_binocular VARCHAR(24) DEFAULT '',
  va_new_mp VARCHAR(24) DEFAULT '',
  va_new_mt VARCHAR(24) DEFAULT '',
  va_new_binocular VARCHAR(24) DEFAULT '',
  sphere_old_mp NUMERIC(7, 2),
  cylinder_old_mp NUMERIC(7, 2),
  axis_old_mp SMALLINT,
  sphere_old_mt NUMERIC(7, 2),
  cylinder_old_mt NUMERIC(7, 2),
  axis_old_mt SMALLINT,
  sphere_new_mp NUMERIC(7, 2),
  cylinder_new_mp NUMERIC(7, 2),
  axis_new_mp SMALLINT,
  sphere_new_mt NUMERIC(7, 2),
  cylinder_new_mt NUMERIC(7, 2),
  axis_new_mt SMALLINT,
  clinical_diagnosis TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id),
  UNIQUE (patient_profile_id, exam_date)
);

CREATE INDEX IF NOT EXISTS idx_patient_profiles_full_name ON patient_profiles(full_name);
CREATE INDEX IF NOT EXISTS idx_patient_profiles_phone ON patient_profiles(phone);
CREATE INDEX IF NOT EXISTS idx_patient_profiles_phone_digits ON patient_profiles(phone_digits);
CREATE INDEX IF NOT EXISTS idx_patient_exam_results_profile_date ON patient_exam_results(patient_profile_id, exam_date DESC);

ALTER TABLE patient_exam_results ADD COLUMN IF NOT EXISTS va_unaided_mp VARCHAR(24) DEFAULT '';
ALTER TABLE patient_exam_results ADD COLUMN IF NOT EXISTS va_unaided_mt VARCHAR(24) DEFAULT '';
ALTER TABLE patient_exam_results ADD COLUMN IF NOT EXISTS va_unaided_binocular VARCHAR(24) DEFAULT '';
ALTER TABLE patient_exam_results ADD COLUMN IF NOT EXISTS next_appointment_date DATE;

INSERT INTO patient_profiles (full_name, birth_year, phone, phone_digits, address, created_at, updated_at, created_by)
SELECT DISTINCT ON (regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'))
  full_name,
  birth_year,
  phone,
  regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') AS phone_digits,
  address,
  created_at,
  updated_at,
  created_by
FROM patient_records
WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') <> ''
ORDER BY regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), exam_date DESC, id DESC
ON CONFLICT (phone_digits) DO NOTHING;

INSERT INTO patient_exam_results (
  patient_profile_id, exam_date, quick_medical_assessment,
  va_unaided_mp, va_unaided_mt, va_unaided_binocular,
  va_old_mp, va_old_mt, va_old_binocular, va_new_mp, va_new_mt, va_new_binocular,
  sphere_old_mp, cylinder_old_mp, axis_old_mp, sphere_old_mt, cylinder_old_mt, axis_old_mt,
  sphere_new_mp, cylinder_new_mp, axis_new_mp, sphere_new_mt, cylinder_new_mt, axis_new_mt,
  next_appointment_date, clinical_diagnosis, created_at, updated_at, created_by
)
SELECT
  p.id,
  r.exam_date,
  r.quick_medical_assessment,
  '',
  '',
  '',
  r.va_old_mp,
  r.va_old_mt,
  r.va_old_binocular,
  r.va_new_mp,
  r.va_new_mt,
  r.va_new_binocular,
  r.sphere_old_mp,
  r.cylinder_old_mp,
  r.axis_old_mp,
  r.sphere_old_mt,
  r.cylinder_old_mt,
  r.axis_old_mt,
  r.sphere_new_mp,
  r.cylinder_new_mp,
  r.axis_new_mp,
  r.sphere_new_mt,
  r.cylinder_new_mt,
  r.axis_new_mt,
  NULL,
  r.clinical_diagnosis,
  r.created_at,
  r.updated_at,
  r.created_by
FROM patient_records r
JOIN patient_profiles p ON p.phone_digits = regexp_replace(COALESCE(r.phone, ''), '[^0-9]', '', 'g')
ON CONFLICT (patient_profile_id, exam_date) DO NOTHING;
