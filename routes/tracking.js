const express = require('express');
const router = express.Router();
const { getDispatchByToken } = require('../services/tracking');
const db = require('../config/db');

// Public tracking page — no login needed
router.get('/:token', async (req, res) => {
  try {
    const dispatch = await getDispatchByToken(req.params.token);
    if (!dispatch) {
      return res.render('tracking/not-found', { title: 'Tracking — Not Found' });
    }
    res.render('tracking/status', { title: `Track Order #${dispatch.inv_number}`, dispatch });
  } catch(err) {
    console.error(err);
    res.render('tracking/not-found', { title: 'Tracking Error' });
  }
});

// Inbound SMS reply webhook (BulkSMS calls this when customer replies 1 or 2)
router.post('/sms/reply', async (req, res) => {
  try {
    const { message, sender } = req.body;
    const text = (message||'').trim();
    // Find most recent dispatch for this phone number
    const phone = sender?.replace(/\D/g,'');
    const result = await db.query(`
      SELECT * FROM dispatch_records
      WHERE REGEXP_REPLACE(phone,'\\D','','g') LIKE $1
         OR REGEXP_REPLACE(driver_phone,'\\D','','g') LIKE $1
      ORDER BY dispatched_at DESC LIMIT 1
    `, [`%${phone?.slice(-9)||''}%`]);

    if (result.rows.length && (text === '1' || text.toLowerCase().includes('received'))) {
      const d = result.rows[0];
      await db.query(`UPDATE dispatch_records SET dispatch_status='delivered', delivered_at=NOW() WHERE inv_number=$1`, [d.inv_number]);
      await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
        ['SMS Reply', 'customer', 'CUSTOMER_CONFIRMED', `Customer confirmed receipt of Invoice #${d.inv_number} via SMS`]);
      await db.query('INSERT INTO notification_log (inv_number,channel,recipient,message,status) VALUES ($1,$2,$3,$4,$5)',
        [d.inv_number, 'sms_reply', sender, text, 'received_confirmed']);
    } else if (result.rows.length && (text === '2' || text.toLowerCase().includes('not received'))) {
      const d = result.rows[0];
      await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
        ['SMS Reply', 'customer', 'CUSTOMER_NOT_RECEIVED', `Customer reported NOT received Invoice #${d.inv_number} via SMS`]);
      // Alert admin
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const { sendEmail } = require('../services/notifications');
        await sendEmail(adminEmail, `⚠ Customer NOT Received — Invoice #${d.inv_number}`,
          `<p>Customer phone ${sender} replied "2" (not received) for Invoice #${d.inv_number} (${d.acc_name}).</p><p>Please follow up immediately.</p>`
        ).catch(()=>{});
      }
    }
    res.status(200).json({ status: 'ok' });
  } catch(err) {
    console.error('SMS reply error:', err.message);
    res.status(200).json({ status: 'ok' }); // Always 200 to BulkSMS
  }
});

module.exports = router;
