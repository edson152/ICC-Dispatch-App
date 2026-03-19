require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const db = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

async function initDB() {
  try {
    const sql = fs.readFileSync(path.join(__dirname,'config','init.sql'),'utf8');
    await db.query(sql);
    console.log('✅ Tables ready');
    const adminPassword = process.env.ADMIN_PASSWORD||'icc2024';
    const adminHash = await bcrypt.hash(adminPassword,10);
    await db.query(`INSERT INTO admins (username,password_hash,full_name,email) VALUES ('admin',$1,'Administrator','admin@icc.co.za') ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash`,[adminHash]);
    console.log('✅ Admin ready  |  username: admin  |  password: '+adminPassword);
    const empCount = await db.query('SELECT COUNT(*) FROM employees');
    if(parseInt(empCount.rows[0].count)===0){
      const pinHash=await bcrypt.hash('1234',10);
      await db.query(`INSERT INTO employees (full_name,role,pin_hash) VALUES ('Patience Khumalo','Invoicing',$1),('Sylvia Mokoena','Invoicing',$1)`,[pinHash]);
      console.log('✅ Seed employees  |  PIN: 1234');
    }
    await db.query(`INSERT INTO dispatch_records (inv_number,inv_date,order_num,invoiced_by,acc_no,acc_name,email,phone,address,city,cust_ord_no,internal_rep,ext_rep,picker,packer,checker,weight,boxes,bales,grey_bags,total_packages,delivery_method,inv_tot_excl) VALUES
      (776691,'2026-02-27','629496','Patience','AMO001','AMODSONS WESTRAND (PTY) LTD','amodandsons@gmail.com','0117625555','12 Industry Rd','Roodepoort','ISMAIL','Shenaaz Hortense','Grace Pretorius','Thando','Shirley','Alfred',18.8,0,1,0,'0 Boxes; 1 Bales; 0 GreyBags','ICC Truck',6657.80),
      (773111,'2026-02-05','626343','Sylvia','APO001','BRAKKEFONTEIN CLAY PRODUCTS','storesabg@apollobrick.com','0118451234','45 Brick Ave','Benoni','319743','Joyce Chauke','Pindile Malema',NULL,NULL,'NotChecked',0,0,0,0,'0 Boxes; 0 Bales; 0 GreyBags','ICC Truck',6456.00),
      (775329,'2026-02-19','628346','Samkeliso','CKE001','NELSPORTS CC T/A CK EMBROIDERY','ckreception@global.co.za','0119337788','88 Market St','Soweto','PO-0059/02','Joyce Chauke','Vusi Khumalo','Mlungisi','Tapelo','Michael',17.5,2,0,0,'2 Boxes; 0 Bales; 0 GreyBags','ICC Truck',5018.20),
      (777001,'2026-03-01','630100','Patience','TXA001','TEXTILE AFRICA (PTY) LTD','orders@texafrica.co.za','0113124455','1 Fashion Park','Midrand','TA-20260301','Shenaaz Hortense','Lerato Nkosi','Thando','Shirley','Alfred',32.4,4,2,0,'4 Boxes; 2 Bales; 0 GreyBags','Courier',12450.00),
      (777250,'2026-03-05','630380','Samkeliso','MAR002','MARKHAMS RETAIL GROUP','dispatch@markhams.co.za','0117849900','99 Mall Rd','Sandton','MRK-6610','Joyce Chauke','Bongani Sithole','Grace Pretorius','Tapelo','Michael',11.2,1,0,2,'1 Boxes; 0 Bales; 2 GreyBags','Collection',3780.50)
      ON CONFLICT (inv_number) DO NOTHING`);
    console.log('✅ Dispatch records ready');
  } catch(err){ console.error('❌ DB init error:',err.message); }
}
initDB();

// Ensure upload dirs
['goods','drivers','licenses','pods','returns'].forEach(d=>{
  fs.mkdirSync(path.join(__dirname,'public','uploads',d),{recursive:true});
});

// ── CRON JOBS ────────────────────────────────────────────────────────────────

// Daily report at 8am
cron.schedule('0 8 * * *', async () => {
  try { const { sendDailyReport } = require('./services/notifications'); await sendDailyReport(); } catch(e){}
});

// Item 29: DB backup email at midnight (exports data summary to admin)
cron.schedule('0 0 * * *', async () => {
  if (!process.env.ADMIN_EMAIL || !process.env.SMTP_USER) return;
  try {
    const { sendEmail } = require('./services/notifications');
    const [dispCount, receiptCount, podCount] = await Promise.all([
      db.query('SELECT COUNT(*) as cnt FROM dispatch_records'),
      db.query('SELECT COUNT(*) as cnt FROM delivery_receipts'),
      db.query('SELECT COUNT(*) as cnt FROM pod_logs')
    ]);
    const today = new Date().toISOString().slice(0,10);
    await sendEmail(process.env.ADMIN_EMAIL,
      `ICC Dispatch — Nightly Backup Summary ${today}`,
      `<div style="font-family:sans-serif;padding:20px;max-width:500px;">
        <h3 style="color:#0D2B5E;">🗃 Nightly Database Summary</h3>
        <p style="color:#718096;font-size:13px;">Date: ${today}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <tr style="background:#0D2B5E;"><td colspan="2" style="padding:10px;color:white;font-weight:700;">Record Counts</td></tr>
          <tr><td style="padding:8px;color:#718096;">Dispatch Records</td><td style="padding:8px;font-weight:700;">${dispCount.rows[0].cnt}</td></tr>
          <tr style="background:#f7fafc"><td style="padding:8px;color:#718096;">Delivery Receipts</td><td style="padding:8px;font-weight:700;">${receiptCount.rows[0].cnt}</td></tr>
          <tr><td style="padding:8px;color:#718096;">POD Archive</td><td style="padding:8px;font-weight:700;">${podCount.rows[0].cnt}</td></tr>
        </table>
        <p style="color:#718096;font-size:12px;margin-top:16px;">For a full database backup, set up pg_dump on your server as described in LOCAL_HOSTING_GUIDE.md.</p>
      </div>`
    );
    console.log('✅ Nightly backup summary sent');
  } catch(e){ console.error('Backup email error:', e.message); }
});

app.set('view engine','ejs');
app.set('views',path.join(__dirname,'views'));
app.use(express.static(path.join(__dirname,'public')));
app.use('/uploads',express.static(path.join(__dirname,'public','uploads')));
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(methodOverride('_method'));
app.set('trust proxy',1);

app.use(session({
  secret: process.env.SESSION_SECRET||'icc_secret_2024',
  resave:false, saveUninitialized:false,
  cookie:{ secure:false, httpOnly:true, maxAge:8*60*60*1000 }
}));
app.use(flash());

// Item 30: Log all admin actions
app.use(async(req,res,next)=>{
  res.locals.user    = req.session.user||null;
  res.locals.success = req.flash('success');
  res.locals.error   = req.flash('error');
  if(req.session.user?.role==='employee'){
    try{
      const r=await db.query(`SELECT COUNT(*) as cnt FROM dispatch_records WHERE (transport_company IS NULL OR transport_company='') AND dispatch_status='pending'`);
      res.locals.pendingCount=parseInt(r.rows[0].cnt);
    }catch(e){res.locals.pendingCount=0;}
  } else { res.locals.pendingCount=0; }
  // Log admin POST/DELETE actions
  if(req.session.user?.role==='admin' && ['POST','DELETE','PUT'].includes(req.method) && req.path.startsWith('/admin')){
    try{
      await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
        [req.session.user.name,'admin',`ADMIN_${req.method}`,`${req.method} ${req.path}`]);
    }catch(e){}
  }
  next();
});

app.use('/',           require('./routes/auth'));
app.use('/dispatch',   require('./routes/dispatch'));
app.use('/receipts',   require('./routes/receipts'));
app.use('/admin',      require('./routes/admin'));
app.use('/employees',  require('./routes/employees'));
app.use('/trucks',     require('./routes/trucks'));
app.use('/track',      require('./routes/tracking'));
app.use('/driver',     require('./routes/driver'));
app.use('/returns',    require('./routes/returns'));
app.use('/pod',        require('./routes/pod'));

// 404
app.use((req,res) => { res.status(404).render('404',{title:'404 — Not Found'}); });

// Item 4: Global 500 error handler
app.use((err, req, res, next) => {
  console.error('500 Error:', err.stack || err.message);
  try {
    res.status(500).render('500', { title: '500 — Server Error', error: err });
  } catch(e) {
    res.status(500).send('<h1>Server Error</h1><p>Please try again or contact support.</p>');
  }
});

app.listen(PORT,()=>{ console.log(`🚚 ICC Dispatch v7 running on port ${PORT}`); });
