const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'receipts');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt_${req.params.id || Date.now()}_${Date.now()}${ext}`);
  }
});
const uploadReceipt = multer({ storage: receiptStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// Dashboard
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const [stats, recent, byEmployee, byDelivery, receiptCount] = await Promise.all([
      db.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company != '' THEN 1 END) as complete, COUNT(CASE WHEN transport_company IS NULL OR transport_company = '' THEN 1 END) as pending, COALESCE(SUM(inv_tot_excl), 0) as total_value, COALESCE(SUM(weight), 0) as total_weight FROM dispatch_records`),
      db.query(`SELECT * FROM dispatch_records ORDER BY inv_date DESC, inv_number DESC LIMIT 15`),
      db.query(`SELECT invoiced_by, COUNT(*) as cnt, COALESCE(SUM(inv_tot_excl),0) as total FROM dispatch_records GROUP BY invoiced_by ORDER BY cnt DESC LIMIT 10`),
      db.query(`SELECT delivery_method, COUNT(*) as cnt, COALESCE(SUM(weight),0) as total_weight FROM dispatch_records GROUP BY delivery_method ORDER BY cnt DESC`),
      db.query(`SELECT COUNT(*) as cnt FROM delivery_receipts`)
    ]);
    res.render('admin/dashboard', { title: 'Admin Dashboard', stats: stats.rows[0], recent: recent.rows, byEmployee: byEmployee.rows, byDelivery: byDelivery.rows, receiptCount: receiptCount.rows[0].cnt });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load dashboard.'); res.redirect('/'); }
});

// Dispatches list
router.get('/dispatches', requireAdmin, async (req, res) => {
  try {
    const search = req.query.search || '', delivery = req.query.delivery || '', status = req.query.status || '';
    let query = `SELECT * FROM dispatch_records WHERE 1=1`; const params = []; let idx = 1;
    if (search) { query += ` AND (CAST(inv_number AS TEXT) ILIKE $${idx} OR acc_name ILIKE $${idx} OR acc_no ILIKE $${idx} OR invoiced_by ILIKE $${idx} OR transport_company ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (delivery) { query += ` AND delivery_method = $${idx}`; params.push(delivery); idx++; }
    if (status === 'pending') query += ` AND (transport_company IS NULL OR transport_company = '')`;
    else if (status === 'complete') query += ` AND transport_company IS NOT NULL AND transport_company != ''`;
    query += ` ORDER BY inv_date DESC, inv_number DESC`;
    const result = await db.query(query, params);
    res.render('admin/dispatches', { title: 'All Dispatch Records', dispatches: result.rows, search, delivery, status });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load records.'); res.redirect('/admin/dashboard'); }
});

// GET edit invoice form (admin)
router.get('/invoices/edit/:invNumber', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM dispatch_records WHERE inv_number = $1', [req.params.invNumber]);
    if (!result.rows.length) { req.flash('error', 'Invoice not found.'); return res.redirect('/admin/dispatches'); }
    const media = await db.query('SELECT * FROM dispatch_media WHERE inv_number = $1 ORDER BY uploaded_at DESC', [req.params.invNumber]);
    const editLog = await db.query('SELECT * FROM invoice_edit_log WHERE inv_number = $1 ORDER BY edited_at DESC LIMIT 20', [req.params.invNumber]);
    res.render('admin/edit-invoice', { title: 'Edit Invoice', dispatch: result.rows[0], media: media.rows, editLog: editLog.rows });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load invoice.'); res.redirect('/admin/dispatches'); }
});

// POST update invoice (admin full edit)
router.post('/invoices/edit/:invNumber', requireAdmin, async (req, res) => {
  const { inv_date, order_num, acc_no, acc_name, email, cust_ord_no, internal_rep, ext_rep, picker, packer, packer2, checker, weight, boxes, bales, grey_bags, delivery_method, inv_tot_excl, transport_company, driver_first_name, driver_surname, license_plate, tracking_number, notes } = req.body;
  const editedBy = req.session.user.name;
  const boxes_n = parseInt(boxes)||0, bales_n = parseInt(bales)||0, bags_n = parseInt(grey_bags)||0;
  const total_packages = `${boxes_n} Boxes; ${bales_n} Bales; ${bags_n} GreyBags`;
  try {
    await db.query(`UPDATE dispatch_records SET inv_date=$1,order_num=$2,acc_no=$3,acc_name=$4,email=$5,cust_ord_no=$6,internal_rep=$7,ext_rep=$8,picker=$9,packer=$10,packer2=$11,checker=$12,weight=$13,boxes=$14,bales=$15,grey_bags=$16,total_packages=$17,delivery_method=$18,inv_tot_excl=$19,transport_company=$20,driver_first_name=$21,driver_surname=$22,license_plate=$23,tracking_number=$24,notes=$25,updated_at=NOW() WHERE inv_number=$26`,
      [inv_date, order_num, acc_no, acc_name, email, cust_ord_no, internal_rep, ext_rep, picker, packer, packer2, checker, parseFloat(weight)||0, boxes_n, bales_n, bags_n, total_packages, delivery_method, parseFloat(inv_tot_excl)||0, transport_company, driver_first_name, driver_surname, license_plate?.toUpperCase(), tracking_number, notes, req.params.invNumber]);
    await db.query('INSERT INTO invoice_edit_log (inv_number, edited_by, edit_type, changes_detail) VALUES ($1,$2,$3,$4)', [req.params.invNumber, editedBy, 'ADMIN_FULL_EDIT', 'Full invoice edit by admin']);
    await db.query('INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1,$2,$3,$4)', [editedBy, 'admin', 'ADMIN_EDIT_INVOICE', `Invoice #${req.params.invNumber} fully edited`]);
    req.flash('success', `Invoice #${req.params.invNumber} updated successfully.`);
    res.redirect('/admin/dispatches');
  } catch (err) { console.error(err); req.flash('error', 'Failed to update invoice: ' + err.message); res.redirect(`/admin/invoices/edit/${req.params.invNumber}`); }
});

// DELETE invoice (admin)
router.delete('/invoices/:invNumber', requireAdmin, async (req, res) => {
  const deletedBy = req.session.user.name;
  try {
    // Get invoice info before delete for logging
    const inv = await db.query('SELECT acc_name FROM dispatch_records WHERE inv_number = $1', [req.params.invNumber]);
    // Delete related media files from disk
    const mediaFiles = await db.query('SELECT file_name FROM dispatch_media WHERE inv_number = $1', [req.params.invNumber]);
    for (const m of mediaFiles.rows) {
      const fp = path.join(__dirname, '..', 'public', 'uploads', 'goods', m.file_name);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await db.query('DELETE FROM dispatch_records WHERE inv_number = $1', [req.params.invNumber]);
    await db.query('INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1,$2,$3,$4)',
      [deletedBy, 'admin', 'ADMIN_DELETE_INVOICE', `Invoice #${req.params.invNumber} (${inv.rows[0]?.acc_name||'?'}) deleted by admin`]);
    req.flash('success', `Invoice #${req.params.invNumber} has been permanently deleted.`);
    res.redirect('/admin/dispatches');
  } catch (err) { console.error(err); req.flash('error', 'Failed to delete invoice: ' + err.message); res.redirect('/admin/dispatches'); }
});

// Receipts list with edit/delete
router.get('/receipts', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT r.*, d.acc_name, d.acc_no, d.email AS customer_email, d.delivery_method, d.transport_company, d.tracking_number FROM delivery_receipts r JOIN dispatch_records d ON r.inv_number = d.inv_number ORDER BY r.captured_at DESC`);
    res.render('admin/receipts', { title: 'Delivery Receipts', receipts: result.rows });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load receipts.'); res.redirect('/admin/dashboard'); }
});

// GET edit receipt (admin)
router.get('/receipts/edit/:id', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT r.*, d.acc_name, d.acc_no, d.email AS customer_email FROM delivery_receipts r JOIN dispatch_records d ON r.inv_number = d.inv_number WHERE r.id = $1`, [req.params.id]);
    if (!result.rows.length) { req.flash('error', 'Receipt not found.'); return res.redirect('/admin/receipts'); }
    const receiptMedia = await db.query('SELECT * FROM dispatch_media WHERE inv_number = $1 AND media_type = $2 ORDER BY uploaded_at DESC', [result.rows[0].inv_number, 'receipt']);
    res.render('admin/edit-receipt', { title: 'Edit Receipt', receipt: result.rows[0], receiptMedia: receiptMedia.rows });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load receipt.'); res.redirect('/admin/receipts'); }
});

// POST update receipt (admin) with optional photo upload
router.post('/receipts/edit/:id', requireAdmin, uploadReceipt.array('receipt_media', 5), async (req, res) => {
  const { receipt_date, received_by, recipient_name, condition, notes } = req.body;
  const editedBy = req.session.user.name;
  try {
    const r = await db.query('UPDATE delivery_receipts SET receipt_date=$1, received_by=$2, recipient_name=$3, condition=$4, notes=$5 WHERE id=$6 RETURNING *',
      [receipt_date, received_by, recipient_name, condition, notes, req.params.id]);
    if (req.files?.length) {
      for (const file of req.files) {
        await db.query('INSERT INTO dispatch_media (inv_number, media_type, file_name, original_name, mime_type, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [r.rows[0].inv_number, 'receipt', file.filename, file.originalname, file.mimetype, editedBy]);
      }
    }
    await db.query('INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1,$2,$3,$4)', [editedBy, 'admin', 'ADMIN_EDIT_RECEIPT', `Receipt #${req.params.id} edited`]);
    req.flash('success', 'Receipt updated successfully.');
    res.redirect('/admin/receipts');
  } catch (err) { console.error(err); req.flash('error', 'Failed to update receipt.'); res.redirect(`/admin/receipts/edit/${req.params.id}`); }
});

// DELETE receipt (admin)
router.delete('/receipts/:id', requireAdmin, async (req, res) => {
  const deletedBy = req.session.user.name;
  try {
    await db.query('DELETE FROM delivery_receipts WHERE id = $1', [req.params.id]);
    await db.query('INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1,$2,$3,$4)', [deletedBy, 'admin', 'ADMIN_DELETE_RECEIPT', `Receipt #${req.params.id} deleted`]);
    req.flash('success', `Receipt #${req.params.id} deleted.`);
    res.redirect('/admin/receipts');
  } catch (err) { console.error(err); req.flash('error', 'Failed to delete receipt.'); res.redirect('/admin/receipts'); }
});

// Reports
router.get('/reports', requireAdmin, async (req, res) => {
  try {
    const [byEmp, byDel, monthly] = await Promise.all([
      db.query(`SELECT invoiced_by, COUNT(*) as inv_count, COALESCE(SUM(inv_tot_excl),0) as total_value, COALESCE(SUM(weight),0) as total_weight, COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company != '' THEN 1 END) as captured FROM dispatch_records GROUP BY invoiced_by ORDER BY inv_count DESC`),
      db.query(`SELECT delivery_method, COUNT(*) as cnt, COALESCE(SUM(weight),0) as total_weight, COALESCE(SUM(inv_tot_excl),0) as total_value FROM dispatch_records GROUP BY delivery_method ORDER BY cnt DESC`),
      db.query(`SELECT TO_CHAR(inv_date, 'Mon YYYY') as month, DATE_TRUNC('month', inv_date) as month_date, COUNT(*) as cnt, COALESCE(SUM(inv_tot_excl),0) as total_value FROM dispatch_records WHERE inv_date >= NOW() - INTERVAL '6 months' GROUP BY month, month_date ORDER BY month_date ASC`)
    ]);
    res.render('admin/reports', { title: 'Reports & Analytics', byEmployee: byEmp.rows, byDelivery: byDel.rows, monthly: monthly.rows });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load reports.'); res.redirect('/admin/dashboard'); }
});

// Export CSV
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM dispatch_records ORDER BY inv_date DESC`);
    const headers = ['inv_number','inv_date','order_num','acc_no','acc_name','email','invoiced_by','internal_rep','ext_rep','picker','packer','checker','weight','boxes','bales','grey_bags','total_packages','delivery_method','transport_company','driver_first_name','driver_surname','license_plate','tracking_number','inv_tot_excl','captured_by','captured_at'];
    const csv = [headers.join(','), ...result.rows.map(r => headers.map(h => `"${(r[h]||'').toString().replace(/"/g,'""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="icc_dispatch_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) { res.status(500).send('Export error'); }
});

// Audit log view
router.get('/audit-log', requireAdmin, async (req, res) => {
  try {
    const logs = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200');
    const editLogs = await db.query('SELECT * FROM invoice_edit_log ORDER BY edited_at DESC LIMIT 200');
    res.render('admin/audit-log', { title: 'Audit Log', logs: logs.rows, editLogs: editLogs.rows });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load audit log.'); res.redirect('/admin/dashboard'); }
});

module.exports = router;
