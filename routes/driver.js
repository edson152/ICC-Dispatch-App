const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Driver mobile page — accessed via URL + truck ID, no complex login
router.get('/:truckId', async (req, res) => {
  try {
    const truck = await db.query('SELECT * FROM icc_trucks WHERE id=$1', [req.params.truckId]);
    if (!truck.rows.length) return res.render('driver/not-found', { title: 'Driver Page' });

    // Get today's dispatched (not yet delivered) orders for this truck
    const stops = await db.query(`
      SELECT d.*, s.stop_order, s.status AS stop_status, s.id AS stop_id
      FROM dispatch_records d
      LEFT JOIN driver_stops s ON s.inv_number=d.inv_number
      WHERE d.icc_truck_id=$1
        AND d.dispatch_status='dispatched'
      ORDER BY COALESCE(s.stop_order, 999), d.inv_number
    `, [req.params.truckId]);

    res.render('driver/dashboard', {
      title: `${truck.rows[0].truck_name} — Deliveries`,
      truck: truck.rows[0],
      stops: stops.rows
    });
  } catch(err) {
    console.error(err);
    res.render('driver/not-found', { title: 'Error' });
  }
});

// POST: driver marks delivery complete
router.post('/complete/:invNumber', async (req, res) => {
  try {
    await db.query(`UPDATE dispatch_records SET dispatch_status='delivered', delivered_at=NOW() WHERE inv_number=$1`, [req.params.invNumber]);
    await db.query(`UPDATE driver_stops SET status='delivered', completed_at=NOW() WHERE inv_number=$1`, [req.params.invNumber]);
    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
      ['Driver App','driver','DRIVER_DELIVERED',`Invoice #${req.params.invNumber} marked delivered by driver`]);
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// API: driver progress for admin
router.get('/api/progress/:truckId', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT COUNT(*) FILTER (WHERE dispatch_status='dispatched') AS out,
             COUNT(*) FILTER (WHERE dispatch_status='delivered' AND DATE(delivered_at)=CURRENT_DATE) AS done,
             COUNT(*) AS total
      FROM dispatch_records WHERE icc_truck_id=$1
        AND (dispatch_status='dispatched' OR (dispatch_status='delivered' AND DATE(delivered_at)=CURRENT_DATE))
    `, [req.params.truckId]);
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
