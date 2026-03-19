const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer for receipt media
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'receipts');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt_${req.params.invNumber}_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage: receiptStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET - list receipts
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*, d.acc_name, d.acc_no, d.email AS customer_email,
             d.delivery_method, d.transport_company, d.tracking_number,
             d.driver_first_name, d.driver_surname, d.license_plate
      FROM delivery_receipts r
      JOIN dispatch_records d ON r.inv_number = d.inv_number
      ORDER BY r.captured_at DESC
    `);
    res.render('receipts/index', { title: 'Delivery Receipts', receipts: result.rows });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load receipts.'); res.redirect('/dispatch'); }
});

// GET - new receipt form
router.get('/new/:invNumber', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM dispatch_records WHERE inv_number = $1', [req.params.invNumber]);
    if (!result.rows.length) { req.flash('error', 'Invoice not found.'); return res.redirect('/dispatch'); }
    const existing = await db.query('SELECT id FROM delivery_receipts WHERE inv_number = $1', [req.params.invNumber]);
    res.render('receipts/new', {
      title: 'Capture Delivery Receipt',
      dispatch: result.rows[0],
      existingId: existing.rows[0]?.id || null
    });
  } catch (err) { console.error(err); req.flash('error', 'Error loading form.'); res.redirect('/dispatch'); }
});

// POST - save receipt (with optional media)
router.post('/new/:invNumber', requireAuth, upload.array('receipt_media', 5), async (req, res) => {
  const { receipt_date, received_by, recipient_name, condition, notes } = req.body;
  const capturedBy = req.session.user.name;
  try {
    const dispResult = await db.query('SELECT * FROM dispatch_records WHERE inv_number = $1', [req.params.invNumber]);
    const dispatch = dispResult.rows[0];

    const receiptResult = await db.query(`
      INSERT INTO delivery_receipts (inv_number, receipt_date, received_by, recipient_name, condition, notes, captured_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [req.params.invNumber, receipt_date, received_by, recipient_name, condition, notes, capturedBy]);

    // Save receipt media files
    if (req.files?.length) {
      for (const file of req.files) {
        await db.query('INSERT INTO dispatch_media (inv_number, media_type, file_name, original_name, mime_type, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [req.params.invNumber, 'receipt', file.filename, file.originalname, file.mimetype, capturedBy]);
      }
    }

    await db.query('INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1,$2,$3,$4)',
      [capturedBy, req.session.user.role, 'CAPTURE_RECEIPT', `Receipt for Invoice #${req.params.invNumber}`]);

    if (dispatch && dispatch.email) {
      await sendTrackingEmail(dispatch, { receipt_date, received_by, recipient_name, condition, notes, capturedBy }, req.files || []);
    }

    req.flash('success', `Receipt saved for Invoice #${req.params.invNumber}. Customer notified by email.${req.files?.length ? ' ' + req.files.length + ' photo(s) attached.' : ''}`);
    res.redirect('/receipts');
  } catch (err) { console.error(err); req.flash('error', 'Failed to save receipt: ' + err.message); res.redirect(`/receipts/new/${req.params.invNumber}`); }
});

// GET - view single receipt
router.get('/view/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*, d.acc_name, d.acc_no, d.email AS customer_email,
             d.delivery_method, d.transport_company, d.tracking_number,
             d.driver_first_name, d.driver_surname, d.license_plate,
             d.inv_date, d.total_packages, d.inv_tot_excl
      FROM delivery_receipts r
      JOIN dispatch_records d ON r.inv_number = d.inv_number
      WHERE r.id = $1
    `, [req.params.id]);
    if (!result.rows.length) { req.flash('error', 'Receipt not found.'); return res.redirect('/receipts'); }
    // Load receipt media
    const media = await db.query('SELECT * FROM dispatch_media WHERE inv_number = $1 AND media_type = $2 ORDER BY uploaded_at DESC',
      [result.rows[0].inv_number, 'receipt']);
    const goodsMedia = await db.query('SELECT * FROM dispatch_media WHERE inv_number = $1 AND media_type = $2 ORDER BY uploaded_at DESC',
      [result.rows[0].inv_number, 'goods']);
    res.render('receipts/view', { title: 'Receipt Detail', receipt: result.rows[0], receiptMedia: media.rows, goodsMedia: goodsMedia.rows });
  } catch (err) { console.error(err); res.redirect('/receipts'); }
});

function createTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST||'smtp.gmail.com', port: parseInt(process.env.SMTP_PORT)||587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}

async function sendTrackingEmail(dispatch, receipt, files) {
  const transporter = createTransporter();
  if (!transporter) return;
  try {
    const imgFiles = (files||[]).filter(f => f.mimetype.startsWith('image/'));
    const imgHtml = imgFiles.map(f => `<img src="cid:${f.filename}" style="max-width:100%;border-radius:8px;margin-bottom:12px;" />`).join('');
    const cidAtts = imgFiles.map(f => ({ filename: f.originalname, path: f.path, cid: f.filename }));

    await transporter.sendMail({
      from: `"Industrial Clothing Company" <${process.env.SMTP_USER}>`,
      to: dispatch.email,
      subject: `Your Order Has Been Delivered — Invoice #${dispatch.inv_number}`,
      html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0D2B5E;padding:28px 32px;border-radius:10px 10px 0 0;">
          <h1 style="color:white;margin:0;font-size:22px;font-weight:800;">Industrial Clothing Company</h1>
          <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">Dispatch &amp; Delivery Notification</p>
        </div>
        <div style="background:#f8fafc;padding:32px;border:1px solid #e2e8f0;border-top:none;">
          <h2 style="color:#0D2B5E;font-size:18px;margin:0 0 8px;">📦 Your order has been delivered!</h2>
          <p style="color:#4a5568;margin:0 0 24px;font-size:14px;">Dear <strong>${dispatch.acc_name}</strong>, your delivery has been received and confirmed.</p>
          ${imgHtml ? `<div style="margin-bottom:20px;"><p style="font-weight:600;color:#2d3748;margin-bottom:8px;">📸 Delivery Photos:</p>${imgHtml}</div>` : ''}
          <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr style="background:#0D2B5E;"><td colspan="2" style="padding:12px 16px;color:white;font-weight:700;font-size:13px;">Order &amp; Delivery Details</td></tr>
            <tr><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;width:40%">Invoice #</td><td style="padding:10px 16px;font-weight:600;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.inv_number}</td></tr>
            <tr style="background:#fafafa"><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Your Order Ref</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.cust_ord_no || '—'}</td></tr>
            <tr><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Delivery Method</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.delivery_method}</td></tr>
            ${dispatch.transport_company ? `<tr style="background:#fafafa"><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Transport Co.</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.transport_company}</td></tr>` : ''}
            ${dispatch.tracking_number ? `<tr><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Tracking #</td><td style="padding:10px 16px;font-weight:700;color:#1A4A9C;font-size:13px;border-bottom:1px solid #f0f0f0;">${dispatch.tracking_number}</td></tr>` : ''}
            <tr style="background:#fafafa"><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Receipt Date</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f0f0f0;">${receipt.receipt_date}</td></tr>
            <tr><td style="padding:10px 16px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Received By</td><td style="padding:10px 16px;font-weight:600;font-size:13px;border-bottom:1px solid #f0f0f0;">${receipt.recipient_name || receipt.received_by || '—'}</td></tr>
            <tr style="background:#fafafa"><td style="padding:10px 16px;color:#718096;font-size:13px;">Condition</td><td style="padding:10px 16px;font-weight:600;font-size:13px;">${receipt.condition}</td></tr>
          </table>
          ${receipt.notes ? `<div style="margin-top:16px;padding:14px 16px;background:#EBF8FF;border-left:4px solid #4A90D9;border-radius:4px;"><p style="margin:0;font-size:13px;color:#2b6cb0;"><strong>Note:</strong> ${receipt.notes}</p></div>` : ''}
          ${receipt.condition !== 'Good' ? `<div style="margin-top:16px;padding:14px 16px;background:#FFF5F5;border-left:4px solid #FC8181;border-radius:4px;"><p style="margin:0;font-size:13px;color:#742a2a;"><strong>⚠️ Damage / Issue Noted:</strong> Please contact us immediately to resolve this. Our records show the goods were in good condition before dispatch.</p></div>` : ''}
          <p style="margin-top:24px;font-size:13px;color:#718096;">Questions? Contact us at <a href="mailto:${process.env.SMTP_USER}" style="color:#1A4A9C;">${process.env.SMTP_USER}</a></p>
        </div>
        <div style="padding:16px 32px;background:#f0f4f8;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none;">
          <p style="margin:0;font-size:11px;color:#a0aec0;text-align:center;">Automated notification from Industrial Clothing Company Dispatch System.</p>
        </div>
      </div>`,
      attachments: [...(files||[]).map(f => ({ filename: f.originalname, path: f.path })), ...cidAtts]
    });

    if (process.env.ADMIN_EMAIL) {
      const fileList = files?.length ? `<p style="font-size:13px;"><strong>📎 ${files.length} file(s) attached:</strong> ${files.map(f=>f.originalname).join(', ')}</p>` : '';
      await transporter.sendMail({
        from: `"ICC Dispatch System" <${process.env.SMTP_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: `Receipt Captured — Invoice #${dispatch.inv_number} by ${receipt.capturedBy}`,
        html: `<div style="font-family:sans-serif;padding:20px;max-width:500px;">
          <h3 style="color:#0D2B5E;">🧾 Delivery Receipt Captured</h3>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px;color:#718096;width:40%">Invoice #</td><td style="padding:8px;font-weight:600">${dispatch.inv_number}</td></tr>
            <tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Customer</td><td style="padding:8px">${dispatch.acc_name}</td></tr>
            <tr><td style="padding:8px;color:#718096">Received By</td><td style="padding:8px">${receipt.recipient_name || '—'}</td></tr>
            <tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Condition</td><td style="padding:8px;font-weight:600;color:${receipt.condition==='Good'?'#38A169':'#e53e3e'}">${receipt.condition}</td></tr>
            <tr><td style="padding:8px;color:#718096">Captured By</td><td style="padding:8px;font-weight:600;color:#1A4A9C">${receipt.capturedBy}</td></tr>
            ${receipt.notes ? `<tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Notes</td><td style="padding:8px">${receipt.notes}</td></tr>` : ''}
          </table>
          ${fileList}
        </div>`,
        attachments: (files||[]).map(f => ({ filename: f.originalname, path: f.path }))
      });
    }
  } catch (err) { console.error('Email error:', err.message); }
}


// GET - manual receipt entry (employee types invoice number, details auto-fill)
router.get('/manual', requireAuth, async (req, res) => {
  const invNum = req.query.inv;
  let dispatch = null;
  if (invNum) {
    try {
      const r = await db.query('SELECT * FROM dispatch_records WHERE inv_number=$1', [invNum]);
      if (r.rows.length) dispatch = r.rows[0];
    } catch(e) {}
  }
  res.render('receipts/manual', { title: 'New Delivery Receipt', dispatch, invNum: invNum||'' });
});

// API: lookup invoice for receipt auto-fill
router.get('/lookup/:invNumber', requireAuth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM dispatch_records WHERE inv_number=$1', [req.params.invNumber]);
    if (!r.rows.length) return res.json({ error: 'Invoice not found' });
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
