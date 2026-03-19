// ICC Dispatch — Customer Tracking Token Service
const crypto = require('crypto');
const db = require('../config/db');

async function generateTrackingToken(inv_number) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    'INSERT INTO tracking_tokens (inv_number,token) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [inv_number, token]
  );
  return token;
}

async function getDispatchByToken(token) {
  const result = await db.query(`
    SELECT d.*, t.token, t.expires_at,
           tr.truck_name,
           r.condition AS receipt_condition, r.received_by, r.captured_at AS receipt_date
    FROM tracking_tokens t
    JOIN dispatch_records d ON t.inv_number = d.inv_number
    LEFT JOIN icc_trucks tr ON d.icc_truck_id = tr.id
    LEFT JOIN delivery_receipts r ON r.inv_number = d.inv_number
    WHERE t.token = $1 AND t.expires_at > NOW()
    ORDER BY r.captured_at DESC
    LIMIT 1
  `, [token]);
  return result.rows[0] || null;
}

module.exports = { generateTrackingToken, getDispatchByToken };
