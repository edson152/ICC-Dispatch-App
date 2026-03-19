-- ICC Dispatch System v5 — Full Schema + All Migrations

-- ── CORE TABLES ──────────────────────────────────────────────────────────────

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

CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_by VARCHAR(100),
  updated_at TIMESTAMP DEFAULT NOW()
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
  whatsapp_sent BOOLEAN DEFAULT FALSE,
  notification_channel VARCHAR(20) DEFAULT 'none',
  captured_by VARCHAR(100),
  captured_at TIMESTAMP,
  dispatched_at TIMESTAMP,
  delivered_at TIMESTAMP,
  synced_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

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

-- Customer tracking tokens (for self-service tracking page)
CREATE TABLE IF NOT EXISTS tracking_tokens (
  id SERIAL PRIMARY KEY,
  inv_number BIGINT REFERENCES dispatch_records(inv_number) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '30 days'
);

-- Driver delivery sessions (for driver mobile page)
CREATE TABLE IF NOT EXISTS driver_sessions (
  id SERIAL PRIMARY KEY,
  truck_id INTEGER REFERENCES icc_trucks(id),
  driver_name VARCHAR(150),
  session_date DATE DEFAULT CURRENT_DATE,
  total_deliveries INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Individual delivery stops for a driver session
CREATE TABLE IF NOT EXISTS driver_stops (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES driver_sessions(id),
  inv_number BIGINT REFERENCES dispatch_records(inv_number),
  stop_order INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  completed_at TIMESTAMP,
  notes TEXT
);

-- Returns & damaged goods
CREATE TABLE IF NOT EXISTS returns (
  id SERIAL PRIMARY KEY,
  inv_number BIGINT REFERENCES dispatch_records(inv_number),
  return_type VARCHAR(30) DEFAULT 'damaged',
  description TEXT,
  photo_path VARCHAR(255),
  reported_by VARCHAR(100),
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notification log
CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  inv_number BIGINT,
  channel VARCHAR(20),
  recipient VARCHAR(100),
  message TEXT,
  status VARCHAR(20) DEFAULT 'sent',
  sent_at TIMESTAMP DEFAULT NOW()
);

-- ── SAFE MIGRATIONS (add new columns if missing) ─────────────────────────────

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='icc_truck_id') THEN ALTER TABLE dispatch_records ADD COLUMN icc_truck_id INTEGER; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='driver_phone') THEN ALTER TABLE dispatch_records ADD COLUMN driver_phone VARCHAR(30); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='phone') THEN ALTER TABLE dispatch_records ADD COLUMN phone VARCHAR(30); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='address') THEN ALTER TABLE dispatch_records ADD COLUMN address TEXT; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='city') THEN ALTER TABLE dispatch_records ADD COLUMN city VARCHAR(100); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='dispatch_status') THEN ALTER TABLE dispatch_records ADD COLUMN dispatch_status VARCHAR(30) DEFAULT 'pending'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='sms_sent') THEN ALTER TABLE dispatch_records ADD COLUMN sms_sent BOOLEAN DEFAULT FALSE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='whatsapp_sent') THEN ALTER TABLE dispatch_records ADD COLUMN whatsapp_sent BOOLEAN DEFAULT FALSE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='notification_channel') THEN ALTER TABLE dispatch_records ADD COLUMN notification_channel VARCHAR(20) DEFAULT 'none'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='dispatched_at') THEN ALTER TABLE dispatch_records ADD COLUMN dispatched_at TIMESTAMP; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='delivered_at') THEN ALTER TABLE dispatch_records ADD COLUMN delivered_at TIMESTAMP; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='delivery_receipts' AND column_name='pod_scan_path') THEN ALTER TABLE delivery_receipts ADD COLUMN pod_scan_path VARCHAR(255); END IF; END $$;

-- Fix existing row statuses
UPDATE dispatch_records SET dispatch_status='dispatched' WHERE dispatch_status IS NULL AND transport_company IS NOT NULL AND transport_company!='';
UPDATE dispatch_records SET dispatch_status='pending' WHERE dispatch_status IS NULL;

-- ── DEFAULT SETTINGS ─────────────────────────────────────────────────────────

INSERT INTO system_settings (key, value, updated_by) VALUES
  ('require_goods_photo',   'false', 'system'),
  ('require_driver_photo',  'false', 'system'),
  ('require_license_photo', 'false', 'system'),
  ('sms_enabled',           'false', 'system'),
  ('whatsapp_enabled',      'false', 'system'),
  ('notification_channel',  'sms',   'system'),
  ('daily_report_email',    'false', 'system'),
  ('daily_report_time',     '08:00', 'system'),
  ('daily_report_to',       '',      'system'),
  ('sage_enabled',          'false', 'system'),
  ('sage_host',             '',      'system'),
  ('sage_db',               '',      'system'),
  ('sage_user',             '',      'system'),
  ('tracking_enabled',      'true',  'system')
ON CONFLICT (key) DO NOTHING;

-- ── QR CODES & POD LOGS ───────────────────────────────────────────────────────

-- QR dispatch labels (one per invoice)
CREATE TABLE IF NOT EXISTS dispatch_qr (
  id SERIAL PRIMARY KEY,
  inv_number BIGINT UNIQUE REFERENCES dispatch_records(inv_number) ON DELETE CASCADE,
  qr_token VARCHAR(32) UNIQUE NOT NULL,
  generated_at TIMESTAMP DEFAULT NOW(),
  printed BOOLEAN DEFAULT FALSE,
  scanned BOOLEAN DEFAULT FALSE,
  scanned_at TIMESTAMP,
  scanned_by VARCHAR(100)
);

-- Completed POD archive (permanent log — nothing deleted from here)
CREATE TABLE IF NOT EXISTS pod_logs (
  id SERIAL PRIMARY KEY,
  inv_number BIGINT NOT NULL,
  acc_name VARCHAR(255),
  acc_no VARCHAR(50),
  inv_date DATE,
  total_packages VARCHAR(255),
  delivery_method VARCHAR(100),
  transport_company VARCHAR(150),
  driver_name VARCHAR(200),
  license_plate VARCHAR(30),
  captured_by VARCHAR(100),
  dispatched_at TIMESTAMP,
  delivered_at TIMESTAMP,
  pod_scan_path VARCHAR(255),
  receipt_condition VARCHAR(50),
  received_by VARCHAR(150),
  archived_at TIMESTAMP DEFAULT NOW(),
  archived_by VARCHAR(100)
);

-- Add pod_scan_path to dispatch_records if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispatch_records' AND column_name='pod_scan_path') THEN
    ALTER TABLE dispatch_records ADD COLUMN pod_scan_path VARCHAR(255);
  END IF;
END $$;
