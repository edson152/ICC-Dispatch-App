# ICC Dispatch Management System

Node.js + Express + EJS + PostgreSQL — deployable to Railway.

## Stack
- **Backend**: Node.js + Express.js
- **Views**: EJS templating
- **Database**: PostgreSQL (Railway managed)
- **Auth**: bcryptjs password/PIN hashing + express-session
- **Email**: Nodemailer (SMTP)

---

## 🚀 Deploy to Railway

### Step 1 — Push to GitHub
```bash
cd icc-dispatch
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/edson152/icc-dispatch.git
git push -u origin main
```

### Step 2 — Create Railway Project
1. Go to [railway.app](https://railway.app) → **New Project**
2. Select **Deploy from GitHub repo** → choose your repo
3. Railway will auto-detect Node.js and build it

### Step 3 — Add PostgreSQL
1. In your Railway project → **+ New** → **Database** → **PostgreSQL**
2. Railway automatically sets `DATABASE_URL` environment variable

### Step 4 — Set Environment Variables
In Railway → your service → **Variables**, add:
```
SESSION_SECRET=your_random_long_secret_here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
ADMIN_EMAIL=admin@icc.co.za
NODE_ENV=production
```

### Step 5 — Initialize the Database
1. In Railway → your PostgreSQL service → **Query** tab
2. Paste the contents of `config/init.sql` and run it
3. This creates all tables and seeds the admin + 2 employees

### Step 6 — Access Your App
- Railway gives you a URL like `https://icc-dispatch-xxx.up.railway.app`
- Open it and log in!

---

## 🔑 Default Credentials

### Admin Login
- **Username**: `admin`
- **Password**: `icc2024`
- ⚠️ Change this after first login (update directly in DB)

### Employee Logins (Default PIN: `1234`)
- Patience Khumalo — Invoicing
- Sylvia Mokoena — Invoicing
- Add more employees via Admin → Employee Management

---

## 📁 Project Structure
```
icc-dispatch/
├── server.js              # Entry point
├── package.json
├── railway.toml           # Railway config
├── .env.example           # Environment variables template
├── config/
│   ├── db.js              # PostgreSQL pool
│   └── init.sql           # Database schema + seed data
├── middleware/
│   └── auth.js            # Session auth guards
├── routes/
│   ├── auth.js            # Login / logout
│   ├── dispatch.js        # Employee dispatch capture
│   ├── admin.js           # Admin dashboard, records, reports
│   └── employees.js       # Employee management
├── views/
│   ├── login.ejs
│   ├── 404.ejs
│   ├── partials/
│   │   ├── head.ejs
│   │   ├── sidebar.ejs
│   │   └── topbar.ejs
│   ├── dispatch/
│   │   ├── index.ejs      # Employee dispatch list
│   │   └── capture.ejs    # Transport detail form
│   └── admin/
│       ├── dashboard.ejs
│       ├── dispatches.ejs
│       ├── employees.ejs
│       └── reports.ejs
└── public/
    ├── css/style.css
    ├── js/app.js
    └── images/logo.png
```

---

## 🔌 Connecting to ICC_BI Database (vw_Dispatch)

To sync from your ICC_BI SQL Server view, create a scheduled job or API endpoint that:
1. Queries `vw_Dispatch` from ICC_BI
2. Upserts records into `dispatch_records` table using `inv_number` as the unique key

Example sync query (run from your ICC_BI server):
```sql
SELECT InvNumber, InvDate, OrderNum, InvoicedBy, AccNo, AccName,
       Email, CustOrdNo, InternalRep, ExtRep, Picker, Packer, 
       Packer2, Checker, Weight, Boxes, Bales, GreyBags,
       [Total Packages], [Delivery Method], InvTotExcl
FROM vw_Dispatch
```

---

## 📧 Gmail App Password Setup
1. Google Account → Security → 2-Step Verification (enable)
2. Search "App passwords" → Create one for "Mail"
3. Use that 16-char password as `SMTP_PASS`

---

## 🔐 Resetting Admin Password
Connect to Railway PostgreSQL and run:
```sql
-- Replace 'newpassword' with your new password hash
-- Generate hash: node -e "const b=require('bcryptjs');b.hash('yourpassword',10).then(h=>console.log(h))"
UPDATE admins SET password_hash = '$2a$10$...' WHERE username = 'admin';
```
