const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ── Multer Storage ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'goods');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `goods_${req.params.invNumber}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|pdf/i;
    if (allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images, videos, and PDFs are allowed'));
  }
});

// ── GET dispatch list ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const search = req.query.search || '';
    const delivery = req.query.delivery || '';
    const status = req.query.status || '';
    let query = `SELECT * FROM dispatch_records WHERE 1=1`;
    const params = []; let idx = 1;
    if (search) { query += ` AND (CAST(inv_number AS TEXT) ILIKE $${idx} OR acc_name ILIKE $${idx} OR acc_no ILIKE $${idx} OR invoiced_by ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (delivery) { query += ` AND delivery_method = $${idx}`; params.push(delivery); idx++; }
    if (status === 'pending') query += ` AND (transport_company IS NULL OR transport_company = '')`;
    else if (status === 'complete') query += ` AND transport_company IS NOT NULL AND transport_company != ''`;
    query += ` ORDER BY inv_date DESC, inv_number DESC LIMIT 100`;
    const result = await db.query(query, params);
    const stats = await db.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company != '' THEN 1 END) as complete, COUNT(CASE WHEN transport_company IS NULL OR transport_company = '' THEN 1 END) as pending FROM dispatch_records`);
    res.render('dispatch/index', { title: 'Dispatch Orders', dispatches: result.rows, stats: stats.rows[0], search, delivery, status });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load dispatch records.'); res.redirect('/'); }
});

// ── GET new invoice form ──────────────────────────────────────────────────────
router.get('/new', requireAuth, (req, res) => {
  res.render('dispatch/new', { title: 'Add New Invoice' });
});

// ── POST create new invoice ───────────────────────────────────────────────────
router.post('/new', requireAuth, async (req, res) => {
  const { inv_number, inv_date, order_num, acc_no, acc_name, email, cust_ord_no, internal_rep, ext_rep, picker, packer, packer2, checker, weight, boxes, bales, grey_bags, delivery_method, inv_tot_excl, notes } = req.body;
  const capturedBy = req.session.user.name;
  const boxes_n = parseInt(boxes) || 0, bales_n = parseInt(bales) || 0, bags_n = parseInt(grey_bags) || 0;
  const total_packages = `${boxes_n} Boxes; ${bales_n} Bales; ${bags_n} GreyBags`;
  try {
    await db.query(`INSERT INTO dispatch_records (inv_number,inv_date,order_num,invoiced_by,acc_no,acc_name,email,cust_ord_no,internal_rep,ext_rep,picker,packer,packer2,checker,weight,boxes,bales,grey_bags,total_packages,delivery_method,inv_tot_excl,notes,captured_by,captured_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())`,
      [inv_number, inv_date, order_num, capturedBy, acc_no, acc_name, email, cust_ord_no, internal_rep, ext_rep, picker, packer, packer2, checker, parseFloat(weight)||0, boxes_n, bales_n, bags_n, total_packages, delivery_method, parseFloat(inv_tot_excl)||0, notes]);
    await db.query('INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1,$2,$3,$4)', [capturedBy, req.session.user.role, 'CREATE_INVOICE', `New invoice #${inv_number} created by ${capturedBy}`]);
    req.flash('success', `Invoice #${inv_number} created successfully. You can now upload goods photos.`);
    res.redirect(`/dispatch/capture/${inv_number}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create invoice: ' + err.message);
    res.redirect('/dispatch/new');
  }
});

// ── GET capture form ──────────────────────────────────────────────────────────
router.get('/capture/:invNumber', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM dispatch_records WHERE inv_number = $1', [req.params.invNumber]);
    if (!result.rows.length) { req.flash('error', 'Invoice not found.'); return res.redirect('/dispatch'); }
    const media = await db.query('SELECT * FROM dispatch_media WHERE inv_number = $1 ORDER BY uploaded_at DESC', [req.params.invNumber]);
    const editLog = await db.query('SELECT * FROM invoice_edit_log WHERE inv_number = $1 ORDER BY edited_at DESC LIMIT 20', [req.params.invNumber]);
    res.render('dispatch/capture', { title: 'Capture / Edit Invoice', dispatch: result.rows[0], media: media.rows, editLog: editLog.rows });
  } catch (err) { console.error(err); req.flash('error', 'Error loading invoice.'); res.redirect('/dispatch'); }
});

// ── POST save transport details ────────────────────────────────────────────────
router.post('/capture/:invNumber', requireAuth, upload.array('goods_media', 10), async (req, res) => {
  const { transport_company, driver_first_name, driver_surname, license_plate, tracking_number, notes } = req.body;
  const capturedBy = req.session.user.name;
  try {
    const old = await db.query('SELECT * FROM dispatch_records WHERE inv_number = $1', [req.params.invNumber]);
    const oldRec = old.rows[0];
    const result = await db.query(`UPDATE dispatch_records SET transport_company=$1,driver_first_name=$2,driver_surname=$3,license_plate=$4,tracking_number=$5,notes=$6,captured_by=$7,captured_at=NOW(),updated_at=NOW() WHERE inv_number=$8 RETURNING *`,
      [transport_company, driver_first_name, driver_surname, license_plate?.toUpperCase(), tracking_number, notes, capturedBy, req.params.invNumber]);
    const dispatch = result.rows[0];
    const changes = [];
    if (oldRec.transport_company !== transport_company) changes.push(`Transport: "${oldRec.transport_company||''}" → "${transport_company}"`);
    if (oldRec.tracking_number !== tracking_number) changes.push(`Tracking: "${oldRec.tracking_number||''}" → "${tracking_number}"`);
    if (oldRec.driver_first_name !== driver_first_name || oldRec.driver_surname !== driver_surname) changes.push(`Driver updated`);
    if (oldRec.notes !== notes) changes.push(`Notes updated`);
    if (req.files?.length) changes.push(`${req.files.length} file(s) uploaded`);
    await db.query('INSERT INTO invoice_edit_log (inv_number, edited_by, edit_type, changes_detail) VALUES ($1,$2,$3,$4)',
      [req.params.invNumber, capturedBy, 'TRANSPORT_CAPTURE', changes.length ? changes.join('; ') : 'Transport details saved']);
    await db.query('INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1,$2,$3,$4)',
      [capturedBy, req.session.user.role, 'CAPTURE_TRANSPORT', `Invoice #${req.params.invNumber} updated`]);
    if (req.files?.length) {
      for (const file of req.files) {
        await db.query('INSERT INTO dispatch_media (inv_number, media_type, file_name, original_name, mime_type, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [req.params.invNumber, 'goods', file.filename, file.originalname, file.mimetype, capturedBy]);
      }
    }
    await sendAdminEmail(dispatch, capturedBy, req.files || []);
    if (dispatch.email && req.files?.length > 0) await sendCustomerGoodsEmail(dispatch, req.files || []);
    req.flash('success', `Invoice #${req.params.invNumber} updated by ${capturedBy}.${req.files?.length ? ' ' + req.files.length + ' file(s) uploaded.' : ''}`);
    res.redirect('/dispatch');
  } catch (err) { console.error(err); req.flash('error', 'Failed to save details.'); res.redirect(`/dispatch/capture/${req.params.invNumber}`); }
});

// ── DELETE media file ─────────────────────────────────────────────────────────
router.post('/media/delete/:mediaId', requireAuth, async (req, res) => {
  try {
    const med = await db.query('SELECT * FROM dispatch_media WHERE id = $1', [req.params.mediaId]);
    if (med.rows.length) {
      const filePath = path.join(__dirname, '..', 'public', 'uploads', 'goods', med.rows[0].file_name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await db.query('DELETE FROM dispatch_media WHERE id = $1', [req.params.mediaId]);
    }
    req.flash('success', 'File removed.');
    res.redirect(med.rows[0]?.inv_number ? `/dispatch/capture/${med.rows[0].inv_number}` : '/dispatch');
  } catch (err) { console.error(err); req.flash('error', 'Failed to delete file.'); res.redirect('/dispatch'); }
});

// ── Email helpers ─────────────────────────────────────────────────────────────
function createTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST||'smtp.gmail.com', port: parseInt(process.env.SMTP_PORT)||587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}

async function sendAdminEmail(dispatch, capturedBy, files) {
  const t = createTransporter(); if (!t) return;
  try {
    const fileList = files.length ? `<p style="font-size:13px;color:#4a5568;margin-top:16px;"><strong>📎 ${files.length} file(s) attached:</strong> ${files.map(f=>f.originalname).join(', ')}</p>` : '';
    await t.sendMail({ from: `"ICC Dispatch System" <${process.env.SMTP_USER}>`, to: process.env.ADMIN_EMAIL||process.env.SMTP_USER, subject: `Dispatch Updated — Invoice #${dispatch.inv_number} by ${capturedBy}`,
      html: `<div style="font-family:sans-serif;max-width:600px;"><div style="background:#0D2B5E;color:white;padding:20px;border-radius:8px 8px 0 0;"><h2>📦 Dispatch Updated</h2><p style="margin:4px 0 0;opacity:0.7;font-size:13px;">Captured by: ${capturedBy}</p></div><div style="padding:24px;border:1px solid #e2e8f0;border-radius:0 0 8px 8px;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:8px;color:#718096;width:40%">Invoice #</td><td style="padding:8px;font-weight:600">${dispatch.inv_number}</td></tr><tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Customer</td><td style="padding:8px;font-weight:600">${dispatch.acc_name}</td></tr><tr><td style="padding:8px;color:#718096">Transport Co.</td><td style="padding:8px;font-weight:600;color:#1A4A9C">${dispatch.transport_company||'—'}</td></tr><tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Tracking #</td><td style="padding:8px">${dispatch.tracking_number||'—'}</td></tr><tr><td style="padding:8px;color:#718096">Captured By</td><td style="padding:8px;font-weight:600;color:#1A4A9C">${capturedBy}</td></tr></table>${fileList}</div></div>`,
      attachments: files.map(f => ({ filename: f.originalname, path: f.path })) });
  } catch (err) { console.error('Admin email error:', err.message); }
}

async function sendCustomerGoodsEmail(dispatch, files) {
  const t = createTransporter(); if (!t) return;
  try {
    const imgFiles = files.filter(f => f.mimetype.startsWith('image/'));
    const imgHtml = imgFiles.map(f => `<img src="cid:${f.filename}" style="max-width:100%;border-radius:8px;margin-bottom:12px;" />`).join('');
    const cidAtts = imgFiles.map(f => ({ filename: f.originalname, path: f.path, cid: f.filename }));
    await t.sendMail({ from: `"Industrial Clothing Company" <${process.env.SMTP_USER}>`, to: dispatch.email, subject: `Your Order is Being Dispatched — Invoice #${dispatch.inv_number}`,
      html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#0D2B5E;padding:28px 32px;border-radius:10px 10px 0 0;"><h1 style="color:white;margin:0;font-size:22px;font-weight:800;">Industrial Clothing Company</h1><p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">Dispatch &amp; Goods Notification</p></div><div style="background:#f8fafc;padding:32px;border:1px solid #e2e8f0;border-top:none;"><h2 style="color:#0D2B5E;font-size:18px;margin:0 0 8px;">📦 Your order is being dispatched!</h2><p style="color:#4a5568;margin:0 0 24px;font-size:14px;">Dear <strong>${dispatch.acc_name}</strong>, please find below the current state of your goods.</p>${imgHtml ? `<div style="margin-bottom:20px;"><p style="font-weight:600;color:#2d3748;margin-bottom:8px;">📸 Goods Photos:</p>${imgHtml}</div>` : ''}<table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;"><tr style="background:#0D2B5E;"><td colspan="2" style="padding:12px 16px;color:white;font-weight:700;font-size:13px;">Order Details</td></tr><tr><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;width:40%">Invoice #</td><td style="padding:10px 16px;font-weight:600;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.inv_number}</td></tr><tr style="background:#fafafa"><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Delivery Method</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.delivery_method}</td></tr>${dispatch.transport_company ? `<tr><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Transport Co.</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.transport_company}</td></tr>` : ''}${dispatch.tracking_number ? `<tr style="background:#fafafa"><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Tracking #</td><td style="padding:10px 16px;font-weight:700;color:#1A4A9C;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.tracking_number}</td></tr>` : ''}</table><div style="margin-top:16px;padding:14px 16px;background:#FFFDE7;border-left:4px solid #F6A623;border-radius:4px;"><p style="margin:0;font-size:13px;color:#856404;"><strong>⚠️ Please inspect your goods on arrival.</strong> If you notice any damage, contact us immediately so we can investigate.</p></div></div></div>`,
      attachments: [...files.map(f => ({ filename: f.originalname, path: f.path })), ...cidAtts] });
  } catch (err) { console.error('Customer email error:', err.message); }
}

module.exports = router;
