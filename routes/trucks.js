const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.fieldname === 'driver_photo'
      ? path.join(__dirname, '..', 'public', 'uploads', 'drivers')
      : path.join(__dirname, '..', 'public', 'uploads', 'licenses');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// GET all trucks
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM icc_trucks ORDER BY truck_name ASC');
    res.render('admin/trucks', { title: 'Fleet Management', trucks: result.rows });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load trucks.');
    res.redirect('/admin/dashboard');
  }
});

// GET single truck detail
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const truck = await db.query('SELECT * FROM icc_trucks WHERE id=$1', [req.params.id]);
    if (!truck.rows.length) { req.flash('error', 'Truck not found.'); return res.redirect('/trucks'); }
    const dispatches = await db.query(`
      SELECT * FROM dispatch_records WHERE icc_truck_id=$1 ORDER BY inv_date DESC LIMIT 20
    `, [req.params.id]);
    res.render('admin/truck-detail', {
      title: truck.rows[0].truck_name,
      truck: truck.rows[0],
      dispatches: dispatches.rows
    });
  } catch (err) {
    console.error(err);
    res.redirect('/trucks');
  }
});

// POST add truck
router.post('/add', requireAdmin, upload.fields([
  { name: 'driver_photo', maxCount: 1 },
  { name: 'driver_license_photo', maxCount: 1 }
]), async (req, res) => {
  const { truck_name, license_plate, driver_name, driver_surname, driver_phone, driver_id_number, notes } = req.body;
  const driver_photo = req.files?.driver_photo?.[0]?.filename || null;
  const driver_license_photo = req.files?.driver_license_photo?.[0]?.filename || null;
  try {
    await db.query(`
      INSERT INTO icc_trucks (truck_name, license_plate, driver_name, driver_surname, driver_phone, driver_id_number, driver_photo, driver_license_photo, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [truck_name, license_plate?.toUpperCase(), driver_name, driver_surname, driver_phone, driver_id_number, driver_photo, driver_license_photo, notes, req.session.user.name]);
    req.flash('success', `Truck "${truck_name}" added to fleet.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add truck: ' + err.message);
  }
  res.redirect('/trucks');
});

// POST toggle active
router.post('/toggle/:id', requireAdmin, async (req, res) => {
  await db.query('UPDATE icc_trucks SET is_active = NOT is_active WHERE id=$1', [req.params.id]);
  req.flash('success', 'Truck status updated.');
  res.redirect('/trucks');
});

// API: get truck details for auto-fill on capture form
router.get('/api/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM icc_trucks WHERE id=$1 AND is_active=TRUE', [req.params.id]);
    if (!result.rows.length) return res.json({ error: 'Not found' });
    const t = result.rows[0];
    res.json({
      driver_first_name: t.driver_name,
      driver_surname: t.driver_surname,
      driver_phone: t.driver_phone,
      license_plate: t.license_plate
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
