// ICC Dispatch — Notification Service
// Handles SMS (BulkSMS SA), WhatsApp (Twilio), and Email
const axios = require('axios');
const nodemailer = require('nodemailer');
const db = require('../config/db');

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSAPhone(phone) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  if (clean.startsWith('27') && clean.length === 11) return '+' + clean;
  if (clean.startsWith('0') && clean.length === 10) return '+27' + clean.slice(1);
  if (clean.length === 9) return '+27' + clean;
  return '+' + clean;
}

async function logNotification(inv_number, channel, recipient, message, status) {
  try {
    await db.query(
      'INSERT INTO notification_log (inv_number,channel,recipient,message,status) VALUES ($1,$2,$3,$4,$5)',
      [inv_number, channel, recipient, message, status]
    );
  } catch(e) { /* non-critical */ }
}

// ── BulkSMS South Africa ──────────────────────────────────────────────────────

async function sendBulkSMS(to, message) {
  const phone = formatSAPhone(to);
  if (!phone) throw new Error('Invalid phone number');
  const username = process.env.BULKSMS_USERNAME;
  const password = process.env.BULKSMS_PASSWORD;
  if (!username || !password) throw new Error('BulkSMS credentials not configured');

  const response = await axios.post('https://api.bulksms.com/v1/messages', {
    to: phone,
    body: message,
    from: process.env.BULKSMS_SENDER || 'ICCDispatch'
  }, {
    auth: { username, password },
    headers: { 'Content-Type': 'application/json' }
  });
  return response.data;
}

// ── WhatsApp via Twilio ───────────────────────────────────────────────────────

async function sendWhatsApp(to, message) {
  const phone = formatSAPhone(to);
  if (!phone) throw new Error('Invalid phone number');
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  if (!accountSid || !authToken) throw new Error('Twilio credentials not configured');

  const response = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    new URLSearchParams({
      From: from,
      To: `whatsapp:${phone}`,
      Body: message
    }),
    { auth: { username: accountSid, password: authToken } }
  );
  return response.data;
}

// ── Email via Nodemailer ──────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: `"Industrial Clothing Company" <${process.env.SMTP_USER}>`,
    to, subject, html
  });
}

// ── Customer Dispatch Notification ───────────────────────────────────────────

async function notifyCustomerDispatched(dispatch, channel) {
  const msg = buildCustomerDispatchMessage(dispatch);
  const phone = dispatch.phone;
  const email = dispatch.email;
  let status = 'sent';

  try {
    if ((channel === 'sms' || channel === 'both') && phone) {
      await sendBulkSMS(phone, msg.sms);
      await db.query('UPDATE dispatch_records SET sms_sent=TRUE WHERE inv_number=$1', [dispatch.inv_number]);
      await logNotification(dispatch.inv_number, 'sms', phone, msg.sms, 'sent');
    }
    if ((channel === 'whatsapp' || channel === 'both') && phone) {
      await sendWhatsApp(phone, msg.sms);
      await db.query('UPDATE dispatch_records SET whatsapp_sent=TRUE WHERE inv_number=$1', [dispatch.inv_number]);
      await logNotification(dispatch.inv_number, 'whatsapp', phone, msg.sms, 'sent');
    }
    if (email) {
      await sendEmail(email, `Your ICC Order #${dispatch.inv_number} is on its way!`, msg.email);
      await logNotification(dispatch.inv_number, 'email', email, 'HTML email', 'sent');
    }
    await db.query(`UPDATE dispatch_records SET notification_channel=$1 WHERE inv_number=$2`, [channel, dispatch.inv_number]);
  } catch(err) {
    status = 'failed';
    await logNotification(dispatch.inv_number, channel, phone||email, err.message, 'failed');
    console.error('Notification error:', err.message);
  }
  return status;
}

function buildCustomerDispatchMessage(d) {
  const driver = [d.driver_first_name, d.driver_surname].filter(Boolean).join(' ') || 'Our driver';
  const pkgs = d.total_packages || `${d.bales||0} bales, ${d.boxes||0} boxes`;
  const sms = `Hi ${d.acc_name}, your ICC order #${d.inv_number} (${pkgs}) is on its way!\nDriver: ${driver}\nPhone: ${d.driver_phone||'—'}\nPlate: ${d.license_plate||'—'}\nReply 1=Received ✅ Reply 2=Not received ❌`;
  const email = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#0D2B5E;padding:28px 32px;border-radius:10px 10px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;font-weight:800;">Industrial Clothing Company</h1>
        <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">Dispatch Notification</p>
      </div>
      <div style="background:#f8fafc;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;">
        <h2 style="color:#0D2B5E;font-size:17px;margin:0 0 6px;">📦 Your order is on its way!</h2>
        <p style="color:#4a5568;margin:0 0 20px;font-size:14px;">Dear <strong>${d.acc_name}</strong>,</p>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr style="background:#0D2B5E;"><td colspan="2" style="padding:10px 14px;color:white;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Order Details</td></tr>
          <tr><td style="padding:9px 14px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;width:40%">Invoice #</td><td style="padding:9px 14px;font-weight:600;font-size:13px;border-bottom:1px solid #f0f0f0;">${d.inv_number}</td></tr>
          <tr style="background:#fafafa"><td style="padding:9px 14px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Packages</td><td style="padding:9px 14px;font-size:13px;border-bottom:1px solid #f0f0f0;">${pkgs}</td></tr>
          ${d.transport_company ? `<tr><td style="padding:9px 14px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Transport</td><td style="padding:9px 14px;font-size:13px;border-bottom:1px solid #f0f0f0;">${d.transport_company}</td></tr>` : ''}
          <tr style="background:#fafafa"><td style="padding:9px 14px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Driver</td><td style="padding:9px 14px;font-size:13px;border-bottom:1px solid #f0f0f0;">${driver}</td></tr>
          ${d.driver_phone ? `<tr><td style="padding:9px 14px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Driver Phone</td><td style="padding:9px 14px;font-weight:600;font-size:13px;border-bottom:1px solid #f0f0f0;"><a href="tel:${d.driver_phone}">${d.driver_phone}</a></td></tr>` : ''}
          ${d.license_plate ? `<tr style="background:#fafafa"><td style="padding:9px 14px;color:#718096;font-size:13px;border-bottom:1px solid #f0f0f0;">Vehicle Plate</td><td style="padding:9px 14px;font-size:13px;border-bottom:1px solid #f0f0f0;">${d.license_plate}</td></tr>` : ''}
          ${d.tracking_number ? `<tr><td style="padding:9px 14px;color:#718096;font-size:13px;">Tracking #</td><td style="padding:9px 14px;font-weight:700;color:#1A4A9C;font-size:13px;">${d.tracking_number}</td></tr>` : ''}
        </table>
        <div style="margin-top:20px;padding:14px 16px;background:#EBF8FF;border-left:4px solid #4A90D9;border-radius:4px;font-size:13px;color:#2b6cb0;">
          ✅ Reply <strong>1</strong> when you receive the goods &nbsp;|&nbsp; ❌ Reply <strong>2</strong> if you did not receive them.
        </div>
      </div>
      <div style="padding:14px 32px;background:#f0f4f8;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none;">
        <p style="margin:0;font-size:11px;color:#a0aec0;text-align:center;">Industrial Clothing Company · Dispatch Management System</p>
      </div>
    </div>`;
  return { sms, email };
}

// ── Driver Notification ───────────────────────────────────────────────────────

async function notifyDriver(dispatch, channel) {
  const phone = dispatch.driver_phone;
  if (!phone) return;
  const pkgs = dispatch.total_packages || `${dispatch.bales||0} bales, ${dispatch.boxes||0} boxes`;
  const msg = `ICC Dispatch #${dispatch.inv_number}\nCustomer: ${dispatch.acc_name}\nAddress: ${dispatch.address||'—'}${dispatch.city?', '+dispatch.city:''}\nPhone: ${dispatch.phone||'—'}\nPackages: ${pkgs}\nRef: #${dispatch.inv_number}`;
  try {
    if (channel === 'sms' || channel === 'both') await sendBulkSMS(phone, msg);
    if (channel === 'whatsapp' || channel === 'both') await sendWhatsApp(phone, msg);
    await logNotification(dispatch.inv_number, channel+'_driver', phone, msg, 'sent');
  } catch(err) {
    await logNotification(dispatch.inv_number, channel+'_driver', phone, err.message, 'failed');
  }
}

// ── Admin Notification ────────────────────────────────────────────────────────

async function notifyAdminCaptured(dispatch, capturedBy) {
  if (!process.env.ADMIN_EMAIL) return;
  const pkgs = dispatch.total_packages || `${dispatch.bales||0} bales, ${dispatch.boxes||0} boxes`;
  await sendEmail(
    process.env.ADMIN_EMAIL,
    `Dispatch Captured — Invoice #${dispatch.inv_number} by ${capturedBy}`,
    `<div style="font-family:sans-serif;padding:20px;max-width:500px;">
      <h3 style="color:#0D2B5E;">📦 Dispatch Captured</h3>
      <p><b>Invoice:</b> #${dispatch.inv_number}</p>
      <p><b>Customer:</b> ${dispatch.acc_name}</p>
      <p><b>Packages:</b> ${pkgs}</p>
      <p><b>Transport:</b> ${dispatch.transport_company||'—'}</p>
      <p><b>Driver:</b> ${dispatch.driver_first_name||''} ${dispatch.driver_surname||''}</p>
      <p><b>Plate:</b> ${dispatch.license_plate||'—'}</p>
      <p><b>Captured By:</b> ${capturedBy}</p>
    </div>`
  ).catch(()=>{});
}

// ── Daily Report Email ────────────────────────────────────────────────────────

async function sendDailyReport() {
  try {
    const settings = await db.query('SELECT key,value FROM system_settings');
    const cfg = {};
    settings.rows.forEach(r => { cfg[r.key] = r.value; });
    if (cfg.daily_report_email !== 'true' || !cfg.daily_report_to) return;

    const today = new Date().toISOString().slice(0, 10);
    const [total, pending, dispatched, delivered, receipts] = await Promise.all([
      db.query(`SELECT COUNT(*) as cnt, COALESCE(SUM(inv_tot_excl),0) as val FROM dispatch_records WHERE inv_date=$1`, [today]),
      db.query(`SELECT COUNT(*) as cnt FROM dispatch_records WHERE dispatch_status='pending' AND inv_date=$1`, [today]),
      db.query(`SELECT COUNT(*) as cnt FROM dispatch_records WHERE dispatch_status='dispatched'`),
      db.query(`SELECT COUNT(*) as cnt FROM dispatch_records WHERE dispatch_status='delivered' AND DATE(delivered_at)=$1`, [today]),
      db.query(`SELECT COUNT(*) as cnt FROM delivery_receipts WHERE DATE(captured_at)=$1`, [today])
    ]);

    const html = `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0D2B5E;padding:24px 28px;border-radius:10px 10px 0 0;">
          <h2 style="color:white;margin:0;font-size:18px;">📊 ICC Daily Dispatch Report — ${today}</h2>
        </div>
        <div style="padding:24px 28px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;">
          <table style="width:100%;border-collapse:collapse;">
            <tr style="background:#0D2B5E;"><td style="padding:10px 14px;color:white;font-weight:700;" colspan="2">Today's Summary</td></tr>
            <tr><td style="padding:9px 14px;color:#718096;border-bottom:1px solid #f0f0f0;">New Invoices Today</td><td style="padding:9px 14px;font-weight:700;border-bottom:1px solid #f0f0f0;">${total.rows[0].cnt}</td></tr>
            <tr style="background:#fafafa"><td style="padding:9px 14px;color:#718096;border-bottom:1px solid #f0f0f0;">Total Value</td><td style="padding:9px 14px;font-weight:700;border-bottom:1px solid #f0f0f0;">R ${parseFloat(total.rows[0].val).toLocaleString('en-ZA',{minimumFractionDigits:2})}</td></tr>
            <tr><td style="padding:9px 14px;color:#718096;border-bottom:1px solid #f0f0f0;">Pending Capture</td><td style="padding:9px 14px;color:#D69E2E;font-weight:700;border-bottom:1px solid #f0f0f0;">${pending.rows[0].cnt}</td></tr>
            <tr style="background:#fafafa"><td style="padding:9px 14px;color:#718096;border-bottom:1px solid #f0f0f0;">Currently Out for Delivery</td><td style="padding:9px 14px;color:#1A4A9C;font-weight:700;border-bottom:1px solid #f0f0f0;">${dispatched.rows[0].cnt}</td></tr>
            <tr><td style="padding:9px 14px;color:#718096;border-bottom:1px solid #f0f0f0;">Delivered Today</td><td style="padding:9px 14px;color:#38A169;font-weight:700;border-bottom:1px solid #f0f0f0;">${delivered.rows[0].cnt}</td></tr>
            <tr style="background:#fafafa"><td style="padding:9px 14px;color:#718096;">Receipts Captured Today</td><td style="padding:9px 14px;font-weight:700;">${receipts.rows[0].cnt}</td></tr>
          </table>
        </div>
        <div style="padding:12px 28px;background:#f0f4f8;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none;">
          <p style="margin:0;font-size:11px;color:#a0aec0;text-align:center;">Automated daily report — ICC Dispatch Management System</p>
        </div>
      </div>`;

    await sendEmail(cfg.daily_report_to, `ICC Daily Dispatch Report — ${today}`, html);
    console.log('✅ Daily report sent to', cfg.daily_report_to);
  } catch(err) {
    console.error('Daily report error:', err.message);
  }
}

// ── Receipt Notification ──────────────────────────────────────────────────────

async function notifyCustomerDelivered(dispatch, receipt, channel) {
  const phone = dispatch.phone;
  const email = dispatch.email;
  const msg = `Hi ${dispatch.acc_name}, your ICC order #${dispatch.inv_number} has been delivered and confirmed. Received by: ${receipt.recipient_name||receipt.received_by||'—'}. Condition: ${receipt.condition}. Thank you for your business!`;
  try {
    if ((channel==='sms'||channel==='both') && phone) await sendBulkSMS(phone, msg);
    if ((channel==='whatsapp'||channel==='both') && phone) await sendWhatsApp(phone, msg);
    if (email) await sendEmail(email, `Your ICC Order #${dispatch.inv_number} Delivered`, `<p>${msg}</p>`);
    await logNotification(dispatch.inv_number, channel, phone||email, msg, 'sent');
  } catch(err) {
    await logNotification(dispatch.inv_number, channel, phone||email, err.message, 'failed');
  }
}

module.exports = {
  sendBulkSMS, sendWhatsApp, sendEmail,
  notifyCustomerDispatched, notifyDriver,
  notifyAdminCaptured, sendDailyReport,
  notifyCustomerDelivered, formatSAPhone
};
