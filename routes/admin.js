const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const [stats, recentPending, completed, byEmployee, byDelivery, receiptCount] = await Promise.all([
      db.query(`SELECT COUNT(*) as total,
        COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company!='' THEN 1 END) as dispatched,
        COUNT(CASE WHEN transport_company IS NULL OR transport_company='' THEN 1 END) as pending,
        COUNT(CASE WHEN dispatch_status='delivered' THEN 1 END) as delivered,
        COALESCE(SUM(inv_tot_excl),0) as total_value,
        COALESCE(SUM(weight),0) as total_weight FROM dispatch_records`),
      db.query(`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.dispatch_status!='delivered' ORDER BY d.inv_date DESC LIMIT 5`),
      db.query(`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.dispatch_status='delivered' ORDER BY d.dispatched_at DESC LIMIT 5`),
      db.query(`SELECT invoiced_by, COUNT(*) as cnt, COALESCE(SUM(inv_tot_excl),0) as total FROM dispatch_records GROUP BY invoiced_by ORDER BY cnt DESC LIMIT 10`),
      db.query(`SELECT delivery_method, COUNT(*) as cnt, COALESCE(SUM(weight),0) as total_weight FROM dispatch_records GROUP BY delivery_method ORDER BY cnt DESC`),
      db.query(`SELECT COUNT(*) as cnt FROM delivery_receipts`)
    ]);
    res.render('admin/dashboard', {
      title: 'Admin Dashboard', stats: stats.rows[0],
      recentPending: recentPending.rows, completed: completed.rows,
      byEmployee: byEmployee.rows, byDelivery: byDelivery.rows,
      receiptCount: receiptCount.rows[0].cnt
    });
  } catch (err) { console.error(err); req.flash('error','Dashboard error.'); res.redirect('/'); }
});

router.get('/dispatches', requireAdmin, async (req, res) => {
  try {
    const search = req.query.search||'', delivery=req.query.delivery||'', status=req.query.status||'';
    let q = `SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE 1=1`;
    const params=[]; let idx=1;
    if (search) { q+=` AND (CAST(d.inv_number AS TEXT) ILIKE $${idx} OR d.acc_name ILIKE $${idx} OR d.acc_no ILIKE $${idx} OR d.invoiced_by ILIKE $${idx} OR d.transport_company ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (delivery) { q+=` AND d.delivery_method=$${idx}`; params.push(delivery); idx++; }
    if (status==='pending') q+=` AND (d.transport_company IS NULL OR d.transport_company='')`;
    else if (status==='delivered') q+=` AND d.dispatch_status='delivered'`;
    else if (status==='dispatched') q+=` AND d.dispatch_status='dispatched'`;
    q+=` ORDER BY d.inv_date DESC, d.inv_number DESC`;
    const result = await db.query(q, params);
    res.render('admin/dispatches', { title:'All Dispatch Records', dispatches:result.rows, search, delivery, status });
  } catch (err) { console.error(err); req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
});

router.get('/receipts', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page)||1;
    const limit = 20, offset = (page-1)*limit;
    const total = await db.query('SELECT COUNT(*) as cnt FROM delivery_receipts');
    const result = await db.query(`
      SELECT r.*,d.acc_name,d.acc_no,d.email AS customer_email,d.delivery_method,d.transport_company,d.tracking_number,d.picker,d.packer,d.checker
      FROM delivery_receipts r JOIN dispatch_records d ON r.inv_number=d.inv_number
      ORDER BY r.captured_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.render('admin/receipts', {
      title:'Delivery Receipts', receipts:result.rows,
      page, totalPages: Math.ceil(parseInt(total.rows[0].cnt)/limit), total: parseInt(total.rows[0].cnt)
    });
  } catch (err) { console.error(err); req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
});

router.get('/reports', requireAdmin, async (req, res) => {
  try {
    const [byEmp, byDel, monthly] = await Promise.all([
      db.query(`SELECT invoiced_by, COUNT(*) as inv_count, COALESCE(SUM(inv_tot_excl),0) as total_value, COALESCE(SUM(weight),0) as total_weight, COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company!='' THEN 1 END) as captured FROM dispatch_records GROUP BY invoiced_by ORDER BY inv_count DESC`),
      db.query(`SELECT delivery_method, COUNT(*) as cnt, COALESCE(SUM(weight),0) as total_weight, COALESCE(SUM(inv_tot_excl),0) as total_value FROM dispatch_records GROUP BY delivery_method ORDER BY cnt DESC`),
      db.query(`SELECT TO_CHAR(inv_date,'Mon YYYY') as month, DATE_TRUNC('month',inv_date) as month_date, COUNT(*) as cnt, COALESCE(SUM(inv_tot_excl),0) as total_value FROM dispatch_records WHERE inv_date>=NOW()-INTERVAL '6 months' GROUP BY month, month_date ORDER BY month_date ASC`)
    ]);
    res.render('admin/reports', { title:'Reports & Analytics', byEmployee:byEmp.rows, byDelivery:byDel.rows, monthly:monthly.rows });
  } catch (err) { console.error(err); res.redirect('/admin/dashboard'); }
});

// GET settings page
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT key,value FROM system_settings');
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });
    res.render('admin/settings', { title:'System Settings', settings });
  } catch (err) { console.error(err); res.redirect('/admin/dashboard'); }
});

// POST save settings
router.post('/settings', requireAdmin, async (req, res) => {
  const keys = ['require_goods_photo','require_driver_photo','require_license_photo','sms_enabled','sms_provider'];
  try {
    for (const key of keys) {
      const val = req.body[key] === 'on' ? 'true' : (req.body[key] || 'false');
      await db.query(`INSERT INTO system_settings (key,value,updated_by,updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
        [key, val, req.session.user.name]);
    }
    req.flash('success','Settings saved.');
  } catch (err) { req.flash('error','Failed to save settings.'); }
  res.redirect('/admin/settings');
});

// GET audit log
router.get('/audit', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200');
    res.render('admin/audit-log', { title:'Audit Log', logs:result.rows });
  } catch (err) { console.error(err); res.redirect('/admin/dashboard'); }
});

// GET export CSV
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT d.*,t.truck_name,
        (SELECT COUNT(*) FROM delivery_receipts r WHERE r.inv_number=d.inv_number) as receipt_count
      FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id
      ORDER BY d.inv_date DESC
    `);
    const headers = ['inv_number','inv_date','order_num','acc_no','acc_name','email','phone','address','city','invoiced_by','picker','packer','packer2','checker','internal_rep','ext_rep','weight','boxes','bales','grey_bags','total_packages','delivery_method','truck_name','transport_company','driver_first_name','driver_surname','driver_phone','license_plate','tracking_number','inv_tot_excl','dispatch_status','captured_by','captured_at','dispatched_at','receipt_count'];
    const csv = [
      headers.join(','),
      ...result.rows.map(r => headers.map(h => `"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(','))
    ].join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="icc_dispatch_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) { res.status(500).send('Export error'); }
});

// API: delivery method detail
router.get('/delivery-detail/:method', requireAdmin, async (req, res) => {
  try {
    const method = req.params.method;
    let q, params;
    if (method === 'ICC Truck') {
      q = `SELECT d.*,t.truck_name,t.driver_name,t.driver_phone FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.delivery_method='ICC Truck' ORDER BY d.inv_date DESC`;
      params = [];
    } else {
      q = `SELECT * FROM dispatch_records WHERE delivery_method=$1 ORDER BY inv_date DESC`;
      params = [method];
    }
    const result = await db.query(q, params);
    res.render('admin/delivery-detail', { title:`${method} — Dispatch Detail`, dispatches:result.rows, method });
  } catch (err) { console.error(err); res.redirect('/admin/reports'); }
});

module.exports = router;
