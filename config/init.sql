-- ICC Dispatch Management System — Database Schema
-- Tables only. Seeding is handled by server.js at startup

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL UNIQUE,
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
  full_name VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_name VARCHAR(100),
  user_role VARCHAR(20),
  action VARCHAR(100),
  detail TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
