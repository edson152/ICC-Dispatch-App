const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

// GET admin dashboard
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const [stats, recent, byEmployee, byDelivery] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company != '' THEN 1 END) as complete,
          COUNT(CASE WHEN transport_company IS NULL OR transport_company = '' THEN 1 END) as pending,
          COALESCE(SUM(inv_tot_excl), 0) as total_value,
          COALESCE(SUM(weight), 0) as total_weight
        FROM dispatch_records
      `),
      db.query(`SELECT * FROM dispatch_records ORDER BY inv_date DESC, inv_number DESC LIMIT 15`),
      db.query(`
        SELECT invoiced_by, COUNT(*) as cnt, COALESCE(SUM(inv_tot_excl),0) as total
        FROM dispatch_records GROUP BY invoiced_by ORDER BY cnt DESC LIMIT 10
      `),
      db.query(`
        SELECT delivery_method, COUNT(*) as cnt, COALESCE(SUM(weight),0) as total_weight
        FROM dispatch_records GROUP BY delivery_method ORDER BY cnt DESC
      `)
    ]);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: stats.rows[0],
      recent: recent.rows,
      byEmployee: byEmployee.rows,
      byDelivery: byDelivery.rows
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load dashboard.');
    res.redirect('/');
  }
});

// GET all dispatch records (admin full view)
router.get('/dispatches', requireAdmin, async (req, res) => {
  try {
    const search = req.query.search || '';
    const delivery = req.query.delivery || '';
    const status = req.query.status || '';

    let query = `SELECT * FROM dispatch_records WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (search) {
      query += ` AND (CAST(inv_number AS TEXT) ILIKE $${idx} OR acc_name ILIKE $${idx} OR acc_no ILIKE $${idx} OR invoiced_by ILIKE $${idx} OR transport_company ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (delivery) {
      query += ` AND delivery_method = $${idx}`;
      params.push(delivery);
      idx++;
    }
    if (status === 'pending') {
      query += ` AND (transport_company IS NULL OR transport_company = '')`;
    } else if (status === 'complete') {
      query += ` AND transport_company IS NOT NULL AND transport_company != ''`;
    }
    query += ` ORDER BY inv_date DESC, inv_number DESC`;

    const result = await db.query(query, params);
    res.render('admin/dispatches', {
      title: 'All Dispatch Records',
      dispatches: result.rows,
      search, delivery, status
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load records.');
    res.redirect('/admin/dashboard');
  }
});

// GET reports
router.get('/reports', requireAdmin, async (req, res) => {
  try {
    const [byEmp, byDel, monthly] = await Promise.all([
      db.query(`
        SELECT invoiced_by, COUNT(*) as inv_count,
          COALESCE(SUM(inv_tot_excl),0) as total_value,
          COALESCE(SUM(weight),0) as total_weight,
          COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company != '' THEN 1 END) as captured
        FROM dispatch_records GROUP BY invoiced_by ORDER BY inv_count DESC
      `),
      db.query(`
        SELECT delivery_method, COUNT(*) as cnt,
          COALESCE(SUM(weight),0) as total_weight,
          COALESCE(SUM(inv_tot_excl),0) as total_value
        FROM dispatch_records GROUP BY delivery_method ORDER BY cnt DESC
      `),
      db.query(`
        SELECT TO_CHAR(inv_date, 'Mon YYYY') as month,
          DATE_TRUNC('month', inv_date) as month_date,
          COUNT(*) as cnt,
          COALESCE(SUM(inv_tot_excl),0) as total_value
        FROM dispatch_records
        WHERE inv_date >= NOW() - INTERVAL '6 months'
        GROUP BY month, month_date ORDER BY month_date ASC
      `)
    ]);

    res.render('admin/reports', {
      title: 'Reports & Analytics',
      byEmployee: byEmp.rows,
      byDelivery: byDel.rows,
      monthly: monthly.rows
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load reports.');
    res.redirect('/admin/dashboard');
  }
});

// GET export CSV
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM dispatch_records ORDER BY inv_date DESC`);
    const headers = ['inv_number','inv_date','order_num','acc_no','acc_name','email','invoiced_by','internal_rep','ext_rep','picker','packer','checker','weight','boxes','bales','grey_bags','total_packages','delivery_method','transport_company','driver_first_name','driver_surname','license_plate','tracking_number','inv_tot_excl','captured_by','captured_at'];
    const csv = [
      headers.join(','),
      ...result.rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="icc_dispatch_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).send('Export error');
  }
});

module.exports = router;
