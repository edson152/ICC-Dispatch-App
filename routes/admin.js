const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { generateDispatchExcel } = require('../services/excel');

router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const [stats, recentPending, completed, byEmployee, byDelivery, receiptCount, truckProgress] = await Promise.all([
      db.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company!='' THEN 1 END) as dispatched, COUNT(CASE WHEN transport_company IS NULL OR transport_company='' THEN 1 END) as pending, COUNT(CASE WHEN dispatch_status='delivered' THEN 1 END) as delivered, COALESCE(SUM(inv_tot_excl),0) as total_value, COALESCE(SUM(weight),0) as total_weight FROM dispatch_records`),
      db.query(`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.dispatch_status!='delivered' ORDER BY d.inv_date DESC LIMIT 5`),
      db.query(`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.dispatch_status='delivered' ORDER BY d.delivered_at DESC LIMIT 5`),
      db.query(`SELECT invoiced_by,COUNT(*) as cnt,COALESCE(SUM(inv_tot_excl),0) as total FROM dispatch_records GROUP BY invoiced_by ORDER BY cnt DESC LIMIT 10`),
      db.query(`SELECT delivery_method,COUNT(*) as cnt,COALESCE(SUM(weight),0) as total_weight,COALESCE(SUM(inv_tot_excl),0) as total_value FROM dispatch_records GROUP BY delivery_method ORDER BY cnt DESC`),
      db.query(`SELECT COUNT(*) as cnt FROM delivery_receipts`),
      db.query(`SELECT t.id,t.truck_name,t.license_plate,t.driver_name,t.driver_surname,COUNT(d.id) FILTER(WHERE d.dispatch_status='dispatched') AS out_count,COUNT(d.id) FILTER(WHERE d.dispatch_status='delivered' AND DATE(d.delivered_at)=CURRENT_DATE) AS done_today FROM icc_trucks t LEFT JOIN dispatch_records d ON d.icc_truck_id=t.id WHERE t.is_active=TRUE GROUP BY t.id ORDER BY t.truck_name`)
    ]);
    res.render('admin/dashboard', { title:'Admin Dashboard', stats:stats.rows[0], recentPending:recentPending.rows, completed:completed.rows, byEmployee:byEmployee.rows, byDelivery:byDelivery.rows, receiptCount:receiptCount.rows[0].cnt, truckProgress:truckProgress.rows });
  } catch(err){ console.error(err); req.flash('error','Dashboard error.'); res.redirect('/'); }
});

router.get('/dispatches', requireAdmin, async (req,res) => {
  try {
    const {search='',delivery='',status='',date_from='',date_to=''} = req.query;
    let q=`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE 1=1`;
    const params=[]; let idx=1;
    if(search){
      q+=` AND (CAST(d.inv_number AS TEXT) ILIKE $${idx} OR d.acc_name ILIKE $${idx} OR d.acc_no ILIKE $${idx} OR d.transport_company ILIKE $${idx} OR d.tracking_number ILIKE $${idx} OR d.driver_first_name ILIKE $${idx} OR d.driver_surname ILIKE $${idx} OR d.license_plate ILIKE $${idx})`;
      params.push(`%${search}%`);idx++;
    }
    if(delivery){q+=` AND d.delivery_method=$${idx}`;params.push(delivery);idx++;}
    if(date_from){q+=` AND d.inv_date >= $${idx}`;params.push(date_from);idx++;}
    if(date_to){q+=` AND d.inv_date <= $${idx}`;params.push(date_to);idx++;}
    if(status==='pending') q+=` AND (d.transport_company IS NULL OR d.transport_company='')`;
    else if(status==='delivered') q+=` AND d.dispatch_status='delivered'`;
    else if(status==='dispatched') q+=` AND d.dispatch_status='dispatched'`;
    q+=` ORDER BY d.inv_date DESC,d.inv_number DESC`;
    const result = await db.query(q,params);
    res.render('admin/dispatches',{title:'All Dispatch Records',dispatches:result.rows,search,delivery,status,date_from,date_to});
  } catch(err){ console.error(err); res.redirect('/admin/dashboard'); }
});

router.get('/receipts', requireAdmin, async (req,res) => {
  try {
    const page=parseInt(req.query.page)||1, limit=20, offset=(page-1)*limit;
    const total = await db.query('SELECT COUNT(*) as cnt FROM delivery_receipts');
    const result = await db.query(`SELECT r.*,d.acc_name,d.acc_no,d.email AS customer_email,d.delivery_method,d.transport_company,d.tracking_number,d.picker,d.packer,d.checker FROM delivery_receipts r JOIN dispatch_records d ON r.inv_number=d.inv_number ORDER BY r.captured_at DESC LIMIT $1 OFFSET $2`,[limit,offset]);
    res.render('admin/receipts',{title:'Delivery Receipts',receipts:result.rows,page,totalPages:Math.ceil(parseInt(total.rows[0].cnt)/limit),total:parseInt(total.rows[0].cnt)});
  } catch(err){ console.error(err); res.redirect('/admin/dashboard'); }
});

router.get('/reports', requireAdmin, async (req,res) => {
  try {
    const [byEmp,byDel,monthly,byPacker,byChecker] = await Promise.all([
      db.query(`SELECT invoiced_by,COUNT(*) as inv_count,COALESCE(SUM(inv_tot_excl),0) as total_value,COALESCE(SUM(weight),0) as total_weight,COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company!='' THEN 1 END) as captured FROM dispatch_records GROUP BY invoiced_by ORDER BY inv_count DESC`),
      db.query(`SELECT delivery_method,COUNT(*) as cnt,COALESCE(SUM(weight),0) as total_weight,COALESCE(SUM(inv_tot_excl),0) as total_value FROM dispatch_records GROUP BY delivery_method ORDER BY cnt DESC`),
      db.query(`SELECT TO_CHAR(inv_date,'Mon YYYY') as month,DATE_TRUNC('month',inv_date) as month_date,COUNT(*) as cnt,COALESCE(SUM(inv_tot_excl),0) as total_value FROM dispatch_records WHERE inv_date>=NOW()-INTERVAL '6 months' GROUP BY month,month_date ORDER BY month_date ASC`),
      db.query(`SELECT packer,COUNT(*) as cnt FROM dispatch_records WHERE packer IS NOT NULL AND packer!='' GROUP BY packer ORDER BY cnt DESC LIMIT 10`),
      db.query(`SELECT checker,COUNT(*) as cnt FROM dispatch_records WHERE checker IS NOT NULL AND checker!='' GROUP BY checker ORDER BY cnt DESC LIMIT 10`)
    ]);
    res.render('admin/reports',{title:'Reports & Analytics',byEmployee:byEmp.rows,byDelivery:byDel.rows,monthly:monthly.rows,byPacker:byPacker.rows,byChecker:byChecker.rows});
  } catch(err){ console.error(err); res.redirect('/admin/dashboard'); }
});

router.get('/customer/:accNo', requireAdmin, async (req,res) => {
  try {
    const dispatches = await db.query(`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.acc_no=$1 ORDER BY d.inv_date DESC`,[req.params.accNo]);
    if(!dispatches.rows.length){req.flash('error','Customer not found.');return res.redirect('/admin/dispatches');}
    const cust = dispatches.rows[0];
    const receipts = await db.query(`SELECT r.* FROM delivery_receipts r JOIN dispatch_records d ON r.inv_number=d.inv_number WHERE d.acc_no=$1 ORDER BY r.captured_at DESC`,[req.params.accNo]);
    const returns_ = await db.query(`SELECT r.* FROM returns r JOIN dispatch_records d ON r.inv_number=d.inv_number WHERE d.acc_no=$1 ORDER BY r.created_at DESC`,[req.params.accNo]);
    res.render('admin/customer-history',{title:`${cust.acc_name} — History`,customer:cust,dispatches:dispatches.rows,receipts:receipts.rows,returns:returns_.rows});
  } catch(err){ console.error(err); res.redirect('/admin/dispatches'); }
});

router.get('/notifications', requireAdmin, async (req,res) => {
  try {
    const result = await db.query('SELECT n.*,d.acc_name FROM notification_log n LEFT JOIN dispatch_records d ON n.inv_number=d.inv_number ORDER BY n.sent_at DESC LIMIT 200');
    res.render('admin/notifications',{title:'Notification Log',logs:result.rows});
  } catch(err){ console.error(err); res.redirect('/admin/dashboard'); }
});

router.get('/settings', requireAdmin, async (req,res) => {
  try {
    const result = await db.query('SELECT key,value FROM system_settings');
    const settings={};result.rows.forEach(r=>{settings[r.key]=r.value;});
    const trucks = await db.query('SELECT id,truck_name,license_plate FROM icc_trucks WHERE is_active=TRUE ORDER BY truck_name');
    res.render('admin/settings',{title:'System Settings',settings,trucks:trucks.rows});
  } catch(err){ console.error(err); res.redirect('/admin/dashboard'); }
});

router.post('/settings', requireAdmin, async (req,res) => {
  const keys=['require_goods_photo','require_driver_photo','require_license_photo','sms_enabled','whatsapp_enabled','notification_channel','daily_report_email','daily_report_time','daily_report_to','tracking_enabled','sage_enabled','sage_host','sage_db','sage_user'];
  try {
    for(const key of keys){
      const val = ['require_goods_photo','require_driver_photo','require_license_photo','sms_enabled','whatsapp_enabled','daily_report_email','tracking_enabled','sage_enabled'].includes(key)
        ? (req.body[key]==='on'||req.body[key]==='true'?'true':'false')
        : (req.body[key]||'');
      await db.query(`INSERT INTO system_settings (key,value,updated_by,updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[key,val,req.session.user.name]);
    }
    req.flash('success','Settings saved.');
  } catch(err){ req.flash('error','Failed to save settings.'); }
  res.redirect('/admin/settings');
});

router.get('/audit', requireAdmin, async (req,res) => {
  try {
    const logs = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200');
    let editLogs={rows:[]};
    try{ editLogs=await db.query('SELECT * FROM invoice_edit_log ORDER BY edited_at DESC LIMIT 100'); }catch(e){}
    res.render('admin/audit-log',{title:'Audit Log',logs:logs.rows,editLogs:editLogs.rows});
  } catch(err){ console.error(err); res.redirect('/admin/dashboard'); }
});

// CSV export
router.get('/export', requireAdmin, async (req,res) => {
  try {
    const result = await db.query(`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id ORDER BY d.inv_date DESC`);
    const headers=['inv_number','inv_date','order_num','acc_no','acc_name','email','phone','address','city','invoiced_by','picker','packer','packer2','checker','weight','boxes','bales','grey_bags','total_packages','delivery_method','truck_name','transport_company','driver_first_name','driver_surname','driver_phone','license_plate','tracking_number','inv_tot_excl','dispatch_status','captured_by','captured_at','dispatched_at'];
    const csv=[headers.join(','),...result.rows.map(r=>headers.map(h=>`"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="icc_dispatch_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch(err){ res.status(500).send('Export error'); }
});

// Excel export
router.get('/export-excel', requireAdmin, async (req,res) => {
  try {
    const result = await db.query(`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id ORDER BY d.inv_date DESC`);
    const buffer = generateDispatchExcel(result.rows);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="icc_dispatch_${new Date().toISOString().slice(0,10)}.xlsx"`);
    res.send(buffer);
  } catch(err){ console.error(err); res.status(500).send('Export error'); }
});

router.get('/delivery-detail/:method', requireAdmin, async (req,res) => {
  try {
    const method=decodeURIComponent(req.params.method);
    let dispatches,trucks=[],couriers=[];
    if(method==='ICC Truck'){
      const r=await db.query(`SELECT d.*,t.truck_name,t.driver_name,t.driver_surname,t.driver_phone FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.delivery_method='ICC Truck' ORDER BY d.inv_date DESC`);
      dispatches=r.rows;
      const tr=await db.query(`SELECT t.*,COUNT(d.id) AS order_count,COUNT(d.id) FILTER(WHERE d.dispatch_status='delivered') AS delivered_count FROM icc_trucks t LEFT JOIN dispatch_records d ON d.icc_truck_id=t.id GROUP BY t.id ORDER BY t.truck_name`);
      trucks=tr.rows;
    } else {
      const r=await db.query(`SELECT * FROM dispatch_records WHERE delivery_method=$1 ORDER BY inv_date DESC`,[method]);
      dispatches=r.rows;
      if(method==='Courier'){
        const cr=await db.query(`SELECT transport_company,COUNT(*) as cnt FROM dispatch_records WHERE delivery_method='Courier' AND transport_company IS NOT NULL AND transport_company!='' GROUP BY transport_company ORDER BY cnt DESC`);
        couriers=cr.rows;
      }
    }
    res.render('admin/delivery-detail',{title:`${method} — Detail`,dispatches,method,trucks,couriers});
  } catch(err){ console.error(err); res.redirect('/admin/reports'); }
});

module.exports = router;

// Item 9: Batch print QR labels for all today's dispatches
router.get('/batch-labels', requireAdmin, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const result = await db.query(`
      SELECT d.* FROM dispatch_records d
      WHERE DATE(d.inv_date) = $1
      ORDER BY d.inv_number ASC
    `, [date]);

    // Ensure QR tokens exist for all
    const qrService = require('../services/qr');
    const qrs = [];
    for (const d of result.rows) {
      const qr = await qrService.getOrCreateQR(d.inv_number);
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const { dataUrl } = await qrService.generateQRDataURL(qr.qr_token, baseUrl);
      qrs.push({ dispatch: d, qr, dataUrl });
    }

    res.render('admin/batch-labels', { title: `Batch Labels — ${date}`, qrs, date });
  } catch(err) { console.error(err); res.redirect('/admin/dispatches'); }
});

// Item 10: Daily dispatch sheet (printable)
router.get('/daily-sheet', requireAdmin, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const result = await db.query(`
      SELECT d.*, t.truck_name
      FROM dispatch_records d
      LEFT JOIN icc_trucks t ON d.icc_truck_id = t.id
      WHERE DATE(d.inv_date) = $1
      ORDER BY d.delivery_method, d.inv_number ASC
    `, [date]);

    const totals = result.rows.reduce((acc, d) => {
      acc.boxes += parseInt(d.boxes)||0;
      acc.bales += parseInt(d.bales)||0;
      acc.bags  += parseInt(d.grey_bags)||0;
      acc.value += parseFloat(d.inv_tot_excl)||0;
      acc.weight += parseFloat(d.weight)||0;
      return acc;
    }, { boxes:0, bales:0, bags:0, value:0, weight:0 });

    res.render('admin/daily-sheet', { title: `Daily Dispatch Sheet — ${date}`, dispatches: result.rows, date, totals });
  } catch(err) { console.error(err); res.redirect('/admin/dispatches'); }
});

// Item 11: Customer search
router.get('/customer-search', requireAdmin, async (req, res) => {
  const search = req.query.q || '';
  let customers = [];
  if (search.trim().length >= 2) {
    const result = await db.query(`
      SELECT DISTINCT acc_no, acc_name, email, phone, address, city,
        COUNT(*) OVER (PARTITION BY acc_no) as order_count
      FROM dispatch_records
      WHERE acc_name ILIKE $1 OR acc_no ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1
      ORDER BY acc_name ASC LIMIT 30
    `, [`%${search}%`]);
    customers = result.rows;
  }
  res.render('admin/customer-search', { title: 'Customer Search', customers, search });
});

// Item 23: Value at risk report
router.get('/value-at-risk', requireAdmin, async (req, res) => {
  try {
    const [atRisk, byMethod, recent] = await Promise.all([
      db.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(inv_tot_excl),0) as total_value, COALESCE(SUM(weight),0) as total_weight FROM dispatch_records WHERE dispatch_status='dispatched'`),
      db.query(`SELECT delivery_method, COUNT(*) as cnt, COALESCE(SUM(inv_tot_excl),0) as total_value FROM dispatch_records WHERE dispatch_status='dispatched' GROUP BY delivery_method ORDER BY total_value DESC`),
      db.query(`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.dispatch_status='dispatched' ORDER BY d.dispatched_at ASC`)
    ]);
    res.render('admin/value-at-risk', { title: 'Value at Risk', atRisk: atRisk.rows[0], byMethod: byMethod.rows, dispatches: recent.rows });
  } catch(err) { console.error(err); res.redirect('/admin/dashboard'); }
});

// Item 22: Driver performance report
router.get('/driver-performance', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COALESCE(t.truck_name, d.transport_company, 'Unknown') as vehicle,
        COALESCE(d.driver_first_name||' '||COALESCE(d.driver_surname,''), 'Unknown') as driver,
        d.delivery_method,
        COUNT(*) as total_deliveries,
        COUNT(CASE WHEN d.dispatch_status='delivered' THEN 1 END) as completed,
        COUNT(CASE WHEN d.dispatch_status='dispatched' THEN 1 END) as in_progress,
        ROUND(AVG(CASE WHEN d.delivered_at IS NOT NULL AND d.dispatched_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (d.delivered_at - d.dispatched_at))/3600 END)::numeric, 1) as avg_hours,
        COALESCE(SUM(d.inv_tot_excl),0) as total_value
      FROM dispatch_records d
      LEFT JOIN icc_trucks t ON d.icc_truck_id = t.id
      WHERE d.transport_company IS NOT NULL AND d.transport_company != ''
      GROUP BY vehicle, driver, d.delivery_method
      ORDER BY completed DESC
    `);
    res.render('admin/driver-performance', { title: 'Driver Performance', drivers: result.rows });
  } catch(err) { console.error(err); res.redirect('/admin/reports'); }
});

// Item 24: Week-on-week comparison for dashboard
router.get('/api/weekly-stats', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(CASE WHEN inv_date >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as this_week,
        COUNT(CASE WHEN inv_date >= CURRENT_DATE - INTERVAL '14 days' AND inv_date < CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as last_week,
        COALESCE(SUM(CASE WHEN inv_date >= CURRENT_DATE - INTERVAL '7 days' THEN inv_tot_excl END),0) as this_week_value,
        COALESCE(SUM(CASE WHEN inv_date >= CURRENT_DATE - INTERVAL '14 days' AND inv_date < CURRENT_DATE - INTERVAL '7 days' THEN inv_tot_excl END),0) as last_week_value
      FROM dispatch_records
    `);
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
