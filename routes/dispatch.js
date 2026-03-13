const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const nodemailer = require('nodemailer');

// GET dispatch list (employee view)
router.get('/', requireAuth, async (req, res) => {
  try {
    const search = req.query.search || '';
    const delivery = req.query.delivery || '';
    const status = req.query.status || '';

    let query = `SELECT * FROM dispatch_records WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (search) {
      query += ` AND (CAST(inv_number AS TEXT) ILIKE $${idx} OR acc_name ILIKE $${idx} OR acc_no ILIKE $${idx} OR invoiced_by ILIKE $${idx})`;
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

    query += ` ORDER BY inv_date DESC, inv_number DESC LIMIT 100`;

    const result = await db.query(query, params);
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company != '' THEN 1 END) as complete,
        COUNT(CASE WHEN transport_company IS NULL OR transport_company = '' THEN 1 END) as pending
      FROM dispatch_records
    `);

    res.render('dispatch/index', {
      title: 'Dispatch Orders',
      dispatches: result.rows,
      stats: stats.rows[0],
      search, delivery, status
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load dispatch records.');
    res.redirect('/');
  }
});

// GET capture form for specific invoice
router.get('/capture/:invNumber', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM dispatch_records WHERE inv_number = $1',
      [req.params.invNumber]
    );
    if (!result.rows.length) {
      req.flash('error', 'Invoice not found.');
      return res.redirect('/dispatch');
    }
    res.render('dispatch/capture', {
      title: 'Capture Transport Details',
      dispatch: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error loading invoice.');
    res.redirect('/dispatch');
  }
});

// POST save transport details
router.post('/capture/:invNumber', requireAuth, async (req, res) => {
  const { transport_company, driver_first_name, driver_surname, license_plate, tracking_number, notes } = req.body;
  const capturedBy = req.session.user.name;

  try {
    const result = await db.query(`
      UPDATE dispatch_records SET
        transport_company = $1,
        driver_first_name = $2,
        driver_surname = $3,
        license_plate = $4,
        tracking_number = $5,
        notes = $6,
        captured_by = $7,
        captured_at = NOW(),
        updated_at = NOW()
      WHERE inv_number = $8
      RETURNING *
    `, [transport_company, driver_first_name, driver_surname, license_plate?.toUpperCase(), tracking_number, notes, capturedBy, req.params.invNumber]);

    const dispatch = result.rows[0];

    // Audit log
    await db.query(
      'INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1, $2, $3, $4)',
      [capturedBy, 'employee', 'CAPTURE_TRANSPORT', `Invoice #${req.params.invNumber} transport details updated`]
    );

    // Send email notification
    await sendAdminEmail(dispatch);

    req.flash('success', `Transport details saved for Invoice #${req.params.invNumber}. Admin notified by email.`);
    res.redirect('/dispatch');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to save transport details.');
    res.redirect(`/dispatch/capture/${req.params.invNumber}`);
  }
});

// Email helper
async function sendAdminEmail(dispatch) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: `"ICC Dispatch System" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL || process.env.SMTP_USER,
      subject: `Dispatch Updated — Invoice #${dispatch.inv_number}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;">
          <div style="background:#0D2B5E;color:white;padding:20px;border-radius:8px 8px 0 0;">
            <h2>📦 Dispatch Transport Details Updated</h2>
          </div>
          <div style="padding:24px;border:1px solid #e2e8f0;border-radius:0 0 8px 8px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px;color:#718096;width:40%">Invoice #</td><td style="padding:8px;font-weight:600">${dispatch.inv_number}</td></tr>
              <tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Customer</td><td style="padding:8px;font-weight:600">${dispatch.acc_name}</td></tr>
              <tr><td style="padding:8px;color:#718096">Invoice Date</td><td style="padding:8px">${dispatch.inv_date}</td></tr>
              <tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Delivery Method</td><td style="padding:8px">${dispatch.delivery_method}</td></tr>
              <tr><td style="padding:8px;color:#718096">Transport Company</td><td style="padding:8px;font-weight:600;color:#1A4A9C">${dispatch.transport_company || '—'}</td></tr>
              <tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Driver</td><td style="padding:8px">${dispatch.driver_first_name || ''} ${dispatch.driver_surname || ''}</td></tr>
              <tr><td style="padding:8px;color:#718096">License Plate</td><td style="padding:8px">${dispatch.license_plate || '—'}</td></tr>
              <tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Tracking #</td><td style="padding:8px">${dispatch.tracking_number || '—'}</td></tr>
              <tr><td style="padding:8px;color:#718096">Captured By</td><td style="padding:8px;font-weight:600">${dispatch.captured_by}</td></tr>
              ${dispatch.notes ? `<tr style="background:#f7fafc"><td style="padding:8px;color:#718096">Notes</td><td style="padding:8px">${dispatch.notes}</td></tr>` : ''}
            </table>
          </div>
          <p style="color:#718096;font-size:12px;margin-top:16px;">This is an automated notification from the ICC Dispatch Management System.</p>
        </div>
      `
    });
  } catch (err) {
    console.error('Email error:', err.message);
  }
}

module.exports = router;
