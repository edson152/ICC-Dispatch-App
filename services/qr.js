// ICC Dispatch — QR Code Service
// Uses qrcode package to generate QR codes for dispatch labels
// Each QR encodes a URL: /pod/scan/[token]

const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../config/db');

// Generate a unique 16-char hex token
function makeToken() {
  return crypto.randomBytes(8).toString('hex');
}

// Get or create QR token for an invoice
async function getOrCreateQR(inv_number) {
  // Check if one already exists
  const existing = await db.query(
    'SELECT * FROM dispatch_qr WHERE inv_number=$1', [inv_number]
  );
  if (existing.rows.length) return existing.rows[0];

  const token = makeToken();
  const result = await db.query(
    'INSERT INTO dispatch_qr (inv_number, qr_token) VALUES ($1,$2) RETURNING *',
    [inv_number, token]
  );
  return result.rows[0];
}

// Generate QR code as a base64 data URL (for embedding in HTML/PDF)
async function generateQRDataURL(token, baseUrl) {
  const url = `${baseUrl}/pod/scan/${token}`;
  const dataUrl = await QRCode.toDataURL(url, {
    width: 200,
    margin: 1,
    color: { dark: '#0D2B5E', light: '#FFFFFF' }
  });
  return { dataUrl, url };
}

// Get all pending (unscanned) QR codes
async function getPendingQRs() {
  const result = await db.query(`
    SELECT q.*, d.acc_name, d.acc_no, d.inv_date, d.total_packages,
           d.delivery_method, d.transport_company, d.dispatch_status,
           d.driver_first_name, d.driver_surname
    FROM dispatch_qr q
    JOIN dispatch_records d ON q.inv_number = d.inv_number
    WHERE q.scanned = FALSE
    ORDER BY q.generated_at DESC
  `);
  return result.rows;
}

// Mark QR as scanned and archive to pod_logs
async function markScanned(token, scannedBy, podScanPath) {
  // Get the QR record
  const qr = await db.query('SELECT * FROM dispatch_qr WHERE qr_token=$1', [token]);
  if (!qr.rows.length) return { error: 'Invalid QR code' };
  if (qr.rows[0].scanned) return { error: 'Already scanned', alreadyDone: true };

  const inv = qr.rows[0].inv_number;

  // Get full dispatch record
  const disp = await db.query('SELECT * FROM dispatch_records WHERE inv_number=$1', [inv]);
  if (!disp.rows.length) return { error: 'Invoice not found' };
  const d = disp.rows[0];

  // Get receipt if exists
  const receipt = await db.query(
    'SELECT * FROM delivery_receipts WHERE inv_number=$1 ORDER BY captured_at DESC LIMIT 1', [inv]
  );
  const r = receipt.rows[0];

  // Mark QR as scanned
  await db.query(
    'UPDATE dispatch_qr SET scanned=TRUE, scanned_at=NOW(), scanned_by=$1 WHERE qr_token=$2',
    [scannedBy, token]
  );

  // Update dispatch record — mark as delivered, attach POD scan
  await db.query(
    `UPDATE dispatch_records SET dispatch_status='delivered', delivered_at=COALESCE(delivered_at,NOW()), pod_scan_path=$1, updated_at=NOW() WHERE inv_number=$2`,
    [podScanPath || null, inv]
  );

  // Archive to pod_logs (permanent record)
  await db.query(`
    INSERT INTO pod_logs (inv_number, acc_name, acc_no, inv_date, total_packages,
      delivery_method, transport_company, driver_name, license_plate,
      captured_by, dispatched_at, delivered_at, pod_scan_path,
      receipt_condition, received_by, archived_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12,$13,$14,$15)
    ON CONFLICT DO NOTHING
  `, [
    inv, d.acc_name, d.acc_no, d.inv_date, d.total_packages,
    d.delivery_method, d.transport_company,
    [d.driver_first_name, d.driver_surname].filter(Boolean).join(' '),
    d.license_plate, d.captured_by, d.dispatched_at,
    podScanPath || null,
    r?.condition || null, r?.received_by || null,
    scannedBy
  ]);

  // Audit log
  await db.query(
    'INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
    [scannedBy, 'employee', 'POD_SCANNED', `POD scanned for Invoice #${inv} — archived to logs`]
  );

  return { ok: true, inv_number: inv, acc_name: d.acc_name };
}

module.exports = { getOrCreateQR, generateQRDataURL, getPendingQRs, markScanned, makeToken };
