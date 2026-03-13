require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./config/db');
 
const app = express();
const PORT = process.env.PORT || 3000;
 
async function initDB() {
  try {
    // Create tables
    const sql = fs.readFileSync(path.join(__dirname, 'config', 'init.sql'), 'utf8');
    await db.query(sql);
    console.log('✅ Tables ready');
 
    // Generate fresh hashes at runtime
    const adminPassword = process.env.ADMIN_PASSWORD || 'icc2024';
    const adminHash = await bcrypt.hash(adminPassword, 10);
    const pinHash   = await bcrypt.hash('1234', 10);
 
    // Force-upsert admin using ON CONFLICT on username (has UNIQUE constraint)
    await db.query(`
      INSERT INTO admins (username, password_hash, full_name, email)
      VALUES ('admin', $1, 'Administrator', 'admin@icc.co.za')
      ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [adminHash]);
    console.log('✅ Admin ready  |  username: admin  |  password: ' + adminPassword);
 
    // For employees: if none exist, insert seed. Otherwise update all hashes.
    const empCount = await db.query('SELECT COUNT(*) FROM employees');
    if (parseInt(empCount.rows[0].count) === 0) {
      await db.query(`
        INSERT INTO employees (full_name, role, pin_hash) VALUES
          ('Patience Khumalo', 'Invoicing', $1),
          ('Sylvia Mokoena',   'Invoicing', $1)
      `, [pinHash]);
      console.log('✅ Seed employees inserted  |  PIN: 1234');
    } else {
      // Always update ALL employee hashes so PIN 1234 is guaranteed to work
      await db.query('UPDATE employees SET pin_hash = $1', [pinHash]);
      console.log('✅ Employee PINs refreshed  |  PIN: 1234');
    }
 
    // Seed sample dispatch records
    await db.query(`
      INSERT INTO dispatch_records
        (inv_number,inv_date,order_num,invoiced_by,acc_no,acc_name,email,cust_ord_no,
         internal_rep,ext_rep,picker,packer,checker,weight,boxes,bales,grey_bags,
         total_packages,delivery_method,inv_tot_excl)
      VALUES
        (776691,'2026-02-27','629496','Patience','AMO001','AMODSONS WESTRAND (PTY) LTD T/A AMOD & SONS','amodandsons@gmail.com','ISMAIL','Shenaaz Hortense','Grace Pretorius','Thando','Shirley','Alfred',18.8,0,1,0,'0 Boxes; 1 Bales; 0 GreyBags','ICC Truck',6657.80),
        (773111,'2026-02-05','626343','Sylvia','APO001','BRAKKEFONTEIN CLAY PRODUCTS T/A APOLLO BRICK','storesabg@apollobrick.com','319743','Joyce Chauke','Pindile Malema',NULL,NULL,'NotChecked',0,0,0,0,'0 Boxes; 0 Bales; 0 GreyBags','ICC Truck',6456.00),
        (775329,'2026-02-19','628346','Samkeliso','CKE001','NELSPORTS CC T/A CK EMBROIDERY','ckreception@global.co.za','PO-0059/02','Joyce Chauke','Vusi Khumalo','Mlungisi','Tapelo','Michael',17.5,2,0,0,'2 Boxes; 0 Bales; 0 GreyBags','ICC Truck',5018.20),
        (777001,'2026-03-01','630100','Patience','TXA001','TEXTILE AFRICA (PTY) LTD','orders@texafrica.co.za','TA-20260301','Shenaaz Hortense','Lerato Nkosi','Thando','Shirley','Alfred',32.4,4,2,0,'4 Boxes; 2 Bales; 0 GreyBags','Courier',12450.00),
        (777250,'2026-03-05','630380','Samkeliso','MAR002','MARKHAMS RETAIL GROUP','dispatch@markhams.co.za','MRK-6610','Joyce Chauke','Bongani Sithole','Grace Pretorius','Tapelo','Michael',11.2,1,0,2,'1 Boxes; 0 Bales; 2 GreyBags','Collection',3780.50)
      ON CONFLICT (inv_number) DO NOTHING
    `);
    console.log('✅ Dispatch records ready');
 
  } catch (err) {
    console.error('❌ DB init error:', err.message);
  }
}
initDB();
 
// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
 
// Static files
app.use(express.static(path.join(__dirname, 'public')));
 
// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
 
// Trust Railway's proxy
app.set('trust proxy', 1);
 
// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'icc_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000
  }
}));
 
app.use(flash());
 
app.use((req, res, next) => {
  res.locals.user    = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error   = req.flash('error');
  next();
});
 
app.use('/',          require('./routes/auth'));
app.use('/dispatch',  require('./routes/dispatch'));
app.use('/admin',     require('./routes/admin'));
app.use('/employees', require('./routes/employees'));
 
app.use((req, res) => {
  res.status(404).render('404', { title: '404 - Page Not Found' });
});
 
app.listen(PORT, () => {
  console.log(`🚚 ICC Dispatch running on port ${PORT}`);
});
 