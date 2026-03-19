-- ICC Dispatch Management System v4 — Full Schema + Migrations
-- Safe to run multiple times — uses IF NOT EXISTS and DO blocks

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'Employee',
  pin_hash VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS icc_trucks (
  id SERIAL PRIMARY KEY,
  truck_name VARCHAR(100) NOT NULL,
  license_plate VARCHAR(30) NOT NULL,
  driver_name VARCHAR(150),
  driver_surname VARCHAR(100),
  driver_phone VARCHAR(20),
  driver_id_number VARCHAR(30),
  driver_photo VARCHAR(255),
  driver_license_photo VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_by VARCHAR(100),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch_records (
  id SERIAL PRIMARY KEY,
  inv_number BIGINT UNIQUE NOT NULL,
  inv_date DATE,
  order_num VARCHAR(50),
  invoiced_by VARCHAR(100),
  acc_no VARCHAR(50),
  acc_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(30),
  address TEXT,
  city VARCHAR(100),
  cust_ord_no VARCHAR(100),
  internal_rep VARCHAR(100),
  ext_rep VARCHAR(100),
  picker VARCHAR(100),
  packer VARCHAR(100),
  packer2 VARCHAR(100),
  checker VARCHAR(100),
  weight DECIMAL(10,2),
  boxes INTEGER DEFAULT 0,
  bales INTEGER DEFAULT 0,
  grey_bags INTEGER DEFAULT 0,
  total_packages VARCHAR(255),
  delivery_method VARCHAR(100),
  inv_tot_excl DECIMAL(12,2),
  transport_company VARCHAR(150),
  icc_truck_id INTEGER,
  driver_first_name VARCHAR(100),
  driver_surname VARCHAR(100),
  driver_phone VARCHAR(30),
  license_plate VARCHAR(30),
  tracking_number VARCHAR(100),
  notes TEXT,
  dispatch_status VARCHAR(30) DEFAULT 'pending',
  sms_sent BOOLEAN DEFAULT FALSE,
  captured_by VARCHAR(100),
  captured_at TIMESTAMP,
  dispatched_at TIMESTAMP,
  synced_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ── MIGRATIONS: safely add new columns to existing tables ──────────────────
-- These DO blocks check if the column exists before adding it
-- Safe to run on both fresh installs and existing databases

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='icc_truck_id') THEN
    ALTER TABLE dispatch_records ADD COLUMN icc_truck_id INTEGER;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='driver_phone') THEN
    ALTER TABLE dispatch_records ADD COLUMN driver_phone VARCHAR(30);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='phone') THEN
    ALTER TABLE dispatch_records ADD COLUMN phone VARCHAR(30);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='address') THEN
    ALTER TABLE dispatch_records ADD COLUMN address TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='city') THEN
    ALTER TABLE dispatch_records ADD COLUMN city VARCHAR(100);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='dispatch_status') THEN
    ALTER TABLE dispatch_records ADD COLUMN dispatch_status VARCHAR(30) DEFAULT 'pending';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='sms_sent') THEN
    ALTER TABLE dispatch_records ADD COLUMN sms_sent BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='dispatched_at') THEN
    ALTER TABLE dispatch_records ADD COLUMN dispatched_at TIMESTAMP;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='delivery_receipts' AND column_name='pod_scan_path') THEN
    ALTER TABLE delivery_receipts ADD COLUMN pod_scan_path VARCHAR(255);
  END IF;
END $$;

-- Set dispatch_status on existing rows that have transport captured
UPDATE dispatch_records
SET dispatch_status = 'dispatched'
WHERE dispatch_status IS NULL
  AND transport_company IS NOT NULL
  AND transport_company != '';

UPDATE dispatch_records
SET dispatch_status = 'pending'
WHERE dispatch_status IS NULL;

-- ── END MIGRATIONS ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS delivery_receipts (
  id SERIAL PRIMARY KEY,
  inv_number BIGINT REFERENCES dispatch_records(inv_number) ON DELETE CASCADE,
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  received_by VARCHAR(100),
  recipient_name VARCHAR(150),
  condition VARCHAR(50) DEFAULT 'Good',
  notes TEXT,
  pod_scan_path VARCHAR(255),
  captured_by VARCHAR(100) NOT NULL,
  captured_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch_media (
  id SERIAL PRIMARY KEY,
  inv_number BIGINT REFERENCES dispatch_records(inv_number) ON DELETE CASCADE,
  media_type VARCHAR(30) DEFAULT 'goods',
  file_name VARCHAR(255),
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  uploaded_by VARCHAR(100),
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_name VARCHAR(100),
  user_role VARCHAR(20),
  action VARCHAR(100),
  detail TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO system_settings (key, value, updated_by) VALUES
  ('require_goods_photo', 'false', 'system'),
  ('require_driver_photo', 'false', 'system'),
  ('require_license_photo', 'false', 'system'),
  ('sms_provider', 'bulksms', 'system'),
  ('sms_enabled', 'false', 'system')
ON CONFLICT (key) DO NOTHING;