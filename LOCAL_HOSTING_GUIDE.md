# ICC Dispatch System — Local Server Hosting Guide

## Overview
This guide covers hosting the system on your own company server (Windows Server or Ubuntu Linux) for use on your internal network, with no internet dependency.

---

## Option A: Windows Server (Recommended for ICC — no Linux experience needed)

### 1. Install Prerequisites
Download and install:
- **Node.js 20 LTS**: https://nodejs.org/en/download (choose Windows Installer)
- **PostgreSQL 16**: https://www.postgresql.org/download/windows/
  - During install, set a password for the `postgres` user — write it down
- **Git** (optional): https://git-scm.com/download/win

### 2. Set Up the Database
1. Open **pgAdmin 4** (installed with PostgreSQL)
2. Right-click **Databases** → New Database → name it `icc_dispatch`
3. The app will create all tables automatically on first run

### 3. Configure the App
1. Copy the ICC Dispatch folder to `C:\icc-dispatch\`
2. Copy `.env.example` → `.env`
3. Edit `.env`:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/icc_dispatch
SESSION_SECRET=any_long_random_text_here_make_it_unique
ADMIN_PASSWORD=your_admin_password
NODE_ENV=production
```

### 4. Install & Run
Open **Command Prompt** or **PowerShell** as Administrator:
```cmd
cd C:\icc-dispatch
npm install
npm start
```
App will be available at: **http://localhost:3000**

### 5. Run as a Windows Service (auto-start on boot)
Install PM2 to keep the app running:
```cmd
npm install -g pm2
npm install -g pm2-windows-startup
pm2 start server.js --name "icc-dispatch"
pm2 save
pm2-startup install
```

---

## Option B: Ubuntu Linux Server

### 1. Install Node.js + PostgreSQL
```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt install postgresql postgresql-contrib -y
sudo -u postgres createdb icc_dispatch
```

### 2. Configure & Run
```bash
cp .env.example .env
nano .env   # Set your DATABASE_URL and secrets

npm install
npm start
```

### 3. Run as a service with PM2
```bash
sudo npm install -g pm2
pm2 start server.js --name icc-dispatch
pm2 startup
pm2 save
```

---

## Making It Available on Your Local Network

### Get Your Server's IP Address
- **Windows**: Open CMD → type `ipconfig` → look for **IPv4 Address** (e.g., 192.168.1.50)
- **Linux**: `hostname -I`

### Access from Other Computers
All computers on the same network can open:
```
http://192.168.1.50:3000
```
(Replace with your server's actual IP)

### Optional: Use Port 80 (no port number in URL)
```bash
# Linux only — redirect port 80 to 3000
sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000
```
Windows: Use **nginx** as a reverse proxy (see below).

---

## Optional: Nginx Reverse Proxy (Port 80, clean URLs)

### Windows (nginx)
1. Download nginx: http://nginx.org/en/download.html
2. Edit `nginx/conf/nginx.conf`:
```nginx
server {
    listen 80;
    server_name icc-dispatch.local;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Set a Friendly Hostname (Optional)
On each employee's computer, edit the `hosts` file:
- Windows: `C:\Windows\System32\drivers\etc\hosts`
- Add: `192.168.1.50  icc-dispatch.local`

Then employees can access via: **http://icc-dispatch.local**

---

## Database Backups

### Automatic Daily Backup (Windows Task Scheduler)
Create `backup.bat`:
```bat
@echo off
set DATE=%date:~10,4%%date:~4,2%%date:~7,2%
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres icc_dispatch > C:\backups\icc_%DATE%.sql
```
Schedule it to run daily via Task Scheduler.

### Linux cron backup
```bash
# Add to crontab: crontab -e
0 2 * * * pg_dump icc_dispatch > /backups/icc_$(date +\%Y\%m\%d).sql
```

---

## Sage Evolution Integration (Future Phase)

To pull customer data automatically from Sage Evolution:

### Option 1: ODBC Direct Connection
```
npm install mssql
```
Sage Evolution uses SQL Server. Add to `.env`:
```
SAGE_DB_HOST=your_sage_server
SAGE_DB_NAME=SageEvolution
SAGE_DB_USER=sa
SAGE_DB_PASS=your_password
```
Then query `ArCustomer` and `SorMaster` tables directly.

### Option 2: CSV/Excel Export (Simpler)
Export customer list from Sage periodically → import into dispatch system via Admin → Employees import (same CSV format works for customers).

### Option 3: Sage Evolution API
If you have Sage Evolution Premium with the API module enabled, use the REST API.

---

## SMS Setup — BulkSMS South Africa

1. Register at https://www.bulksms.com (SA numbers, POPIA compliant)
2. Top up credits (costs ~R0.30–0.50 per SMS in SA)
3. Add to `.env`:
```
BULKSMS_USERNAME=your_username
BULKSMS_PASSWORD=your_password
BULKSMS_SENDER=ICCDispatch
```
4. Enable SMS in Admin → Settings

---

## Phase 2 Features (To Be Built Next)
- SMS reply confirmation (Reply 1 received / 2 not received)
- Driver mobile app for GPS tracking and delivery sequence
- Google Maps route optimization
- POD scanner auto-attachment
- Sage Evolution live sync
- Real-time delivery notifications via WebSockets

---

## Troubleshooting

| Problem | Solution |
|---|---|
| App won't start | Check `.env` file exists and DATABASE_URL is correct |
| Database error | Ensure PostgreSQL is running; check credentials |
| Port already in use | Change PORT in `.env` to 3001 |
| Images not showing | Ensure `public/uploads/` folder exists and has write permission |
| Can't access from network | Check Windows Firewall — allow port 3000 inbound |
