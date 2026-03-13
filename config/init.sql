-- ICC Dispatch Management System
-- Run this once on your Railway PostgreSQL database

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'Employee',
  pin_hash VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Dispatch records table (mirrors vw_Dispatch + added transport fields)
CREATE TABLE IF NOT EXISTS dispatch_records (
  id SERIAL PRIMARY KEY,

  -- From ICC_BI vw_Dispatch view
  inv_number BIGINT UNIQUE NOT NULL,
  inv_date DATE,
  order_num VARCHAR(50),
  invoiced_by VARCHAR(100),
  acc_no VARCHAR(50),
  acc_name VARCHAR(255),
  email VARCHAR(255),
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

  -- Transport details (captured by dispatch staff)
  transport_company VARCHAR(150),
  driver_first_name VARCHAR(100),
  driver_surname VARCHAR(100),
  license_plate VARCHAR(30),
  tracking_number VARCHAR(100),
  notes TEXT,
  captured_by VARCHAR(100),
  captured_at TIMESTAMP,

  synced_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_name VARCHAR(100),
  user_role VARCHAR(20),
  action VARCHAR(100),
  detail TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed default admin (password: icc2024 - CHANGE THIS!)
-- bcrypt hash of 'icc2024'
INSERT INTO admins (username, password_hash, full_name, email)
VALUES (
  'admin',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh3y',
  'Administrator',
  'admin@icc.co.za'
) ON CONFLICT (username) DO NOTHING;

-- Seed 2 employees (PIN: 1234 for both - admin should reset)
-- bcrypt hash of '1234'
INSERT INTO employees (full_name, role, pin_hash) VALUES
  ('Patience Khumalo', 'Invoicing', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh3y'),
  ('Sylvia Mokoena', 'Invoicing', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh3y')
ON CONFLICT DO NOTHING;

-- Seed sample dispatch records (from your vw_Dispatch view sample)
INSERT INTO dispatch_records (inv_number, inv_date, order_num, invoiced_by, acc_no, acc_name, email, cust_ord_no, internal_rep, ext_rep, picker, packer, checker, weight, boxes, bales, grey_bags, total_packages, delivery_method, inv_tot_excl)
VALUES
  (776691, '2026-02-27', '629496', 'Patience', 'AMO001', 'AMODSONS WESTRAND (PTY) LTD T/A AMOD & SONS', 'amodandsons@gmail.com', 'ISMAIL', 'Shenaaz Hortense', 'Grace Pretorius', 'Thando', 'Shirley', 'Alfred', 18.8, 0, 1, 0, '0 Boxes; 1 Bales; 0 GreyBags', 'ICC Truck', 6657.80),
  (773111, '2026-02-05', '626343', 'Sylvia', 'APO001', 'BRAKKEFONTEIN CLAY PRODUCTS T/A APOLLO BRICK', 'storesabg@apollobrick.com', '319743', 'Joyce Chauke', 'Pindile Malema', NULL, NULL, 'NotChecked', 0, 0, 0, 0, '0 Boxes; 0 Bales; 0 GreyBags', 'ICC Truck', 6456.00),
  (775329, '2026-02-19', '628346', 'Samkeliso', 'CKE001', 'NELSPORTS CC T/A CK EMBROIDERY - CASH ACC', 'ckreception@global.co.za', 'PO-0059/02', 'Joyce Chauke', 'Vusi Khumalo', 'Mlungisi', 'Tapelo', 'Michael', 17.5, 2, 0, 0, '2 Boxes; 0 Bales; 0 GreyBags', 'ICC Truck', 5018.20),
  (777001, '2026-03-01', '630100', 'Patience', 'TXA001', 'TEXTILE AFRICA (PTY) LTD', 'orders@texafrica.co.za', 'TA-20260301', 'Shenaaz Hortense', 'Lerato Nkosi', 'Thando', 'Shirley', 'Alfred', 32.4, 4, 2, 0, '4 Boxes; 2 Bales; 0 GreyBags', 'Courier', 12450.00),
  (777250, '2026-03-05', '630380', 'Samkeliso', 'MAR002', 'MARKHAMS RETAIL GROUP', 'dispatch@markhams.co.za', 'MRK-6610', 'Joyce Chauke', 'Bongani Sithole', 'Grace Pretorius', 'Tapelo', 'Michael', 11.2, 1, 0, 2, '1 Boxes; 0 Bales; 2 GreyBags', 'Collection', 3780.50)
ON CONFLICT (inv_number) DO NOTHING;
