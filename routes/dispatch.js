const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// SA + SADC number plate validation patterns
const PLATE_PATTERNS = [
  /^[A-Z]{3}\s?\d{3}\s?[A-Z]{2}$/, // Standard SA: ABC 123 GP
  /^[A-Z]{2}\s?\d{2}\s?[A-Z]{2}$/, // Older format
  /^[A-Z]{1,3}\s?\d{1,4}$/,         // Namibia/Botswana
  /^ICC[-\s]?\d{1,4}$/i,            // ICC internal fleet
  /^[A-Z0-9]{2,10}$/,               // General fallback
];
function validatePlate(plate) {
  if (!plate) return true; // optional
  const clean = plate.trim().toUpperCase();
  return PLATE_PATTERNS.some(p => p.test(clean));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdir = file.fieldname === 'license_photo' ? 'licenses'
                 : file.fieldname === 'driver_photo_upload' ? 'drivers'
                 : 'goods';
    const dir = path.join(__dirname, '..', 'public', 'uploads', subdir);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}_${req.params?.invNumber || 'x'}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|pdf/i;
    if (allowed.test(path.extname(file.originalname)) || allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images, videos and PDFs allowed'));
  }
});

// GET dispatch list
router.get('/', requireAuth, async (req, res) => {
  try {
    const search = req.query.search || '';
    const delivery = req.query.delivery || '';
    const status = req.query.status || '';
    let q = `SELECT d.*, t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE 1=1`;
    const params = []; let idx = 1;
    if (search) { q += ` AND (CAST(d.inv_number AS TEXT) ILIKE $${idx} OR d.acc_name ILIKE $${idx} OR d.acc_no ILIKE $${idx} OR d.invoiced_by ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (delivery) { q += ` AND d.delivery_method=$${idx}`; params.push(delivery); idx++; }
    if (status === 'pending') q += ` AND (d.transport_company IS NULL OR d.transport_company='')`;
    else if (status === 'complete') q += ` AND d.dispatch_status='delivered'`;
    else if (status === 'dispatched') q += ` AND d.dispatch_status='dispatched'`;
    q += ` ORDER BY d.inv_date DESC, d.inv_number DESC LIMIT 100`;
    const result = await db.query(q, params);
    const stats = await db.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company!='' THEN 1 END) as complete, COUNT(CASE WHEN transport_company IS NULL OR transport_company='' THEN 1 END) as pending, COUNT(CASE WHEN dispatch_status='delivered' THEN 1 END) as delivered FROM dispatch_records`);
    // Split into pending vs completed
    const pending = result.rows.filter(r => r.dispatch_status !== 'delivered');
    const completed = result.rows.filter(r => r.dispatch_status === 'delivered');
    res.render('dispatch/index', { title: 'Dispatch Orders', dispatches: pending, completed, stats: stats.rows[0], search, delivery, status });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load.'); res.redirect('/'); }
});

// API: lookup invoice by number (auto-fill)
router.get('/lookup/:invNumber', requireAuth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM dispatch_records WHERE inv_number=$1', [req.params.invNumber]);
    if (!r.rows.length) return res.json({ error: 'Invoice not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET capture form
router.get('/capture/:invNumber', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT d.*, t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.inv_number=$1', [req.params.invNumber]);
    if (!result.rows.length) { req.flash('error', 'Invoice not found.'); return res.redirect('/dispatch'); }
    const media = await db.query('SELECT * FROM dispatch_media WHERE inv_number=$1 ORDER BY uploaded_at DESC', [req.params.invNumber]);
    const trucks = await db.query('SELECT * FROM icc_trucks WHERE is_active=TRUE ORDER BY truck_name ASC');
    const settings = await db.query('SELECT key,value FROM system_settings');
    const cfg = {};
    settings.rows.forEach(r => { cfg[r.key] = r.value; });
    res.render('dispatch/capture', {
      title: 'Capture Transport Details',
      dispatch: result.rows[0],
      media: media.rows,
      trucks: trucks.rows,
      settings: cfg
    });
  } catch (err) { console.error(err); req.flash('error', 'Error loading invoice.'); res.redirect('/dispatch'); }
});

// POST save transport details
router.post('/capture/:invNumber', requireAuth, upload.fields([
  { name: 'goods_photos', maxCount: 5 },
  { name: 'license_photo', maxCount: 1 },
  { name: 'driver_photo_upload', maxCount: 1 }
]), async (req, res) => {
  const { transport_company, icc_truck_id, driver_first_name, driver_surname, driver_phone, license_plate, tracking_number, notes } = req.body;
  const capturedBy = req.session.user.name;

  if (license_plate && !validatePlate(license_plate)) {
    req.flash('error', 'Invalid number plate format for SA/SADC. Please check and re-enter.');
    return res.redirect(`/dispatch/capture/${req.params.invNumber}`);
  }

  try {
    const updated = await db.query(`
      UPDATE dispatch_records SET
        transport_company=$1, icc_truck_id=$2, driver_first_name=$3, driver_surname=$4,
        driver_phone=$5, license_plate=$6, tracking_number=$7, notes=$8,
        captured_by=$9, captured_at=NOW(), dispatch_status='dispatched', dispatched_at=NOW(), updated_at=NOW()
      WHERE inv_number=$10 RETURNING *
    `, [transport_company||null, icc_truck_id||null, driver_first_name, driver_surname, driver_phone, license_plate?.toUpperCase()||null, tracking_number, notes, capturedBy, req.params.invNumber]);

    // Save uploaded photos
    if (req.files?.goods_photos) {
      for (const f of req.files.goods_photos) {
        await db.query(`INSERT INTO dispatch_media (inv_number,media_type,file_name,original_name,mime_type,uploaded_by) VALUES ($1,'goods',$2,$3,$4,$5)`,
          [req.params.invNumber, f.filename, f.originalname, f.mimetype, capturedBy]);
      }
    }
    if (req.files?.license_photo) {
      const f = req.files.license_photo[0];
      await db.query(`INSERT INTO dispatch_media (inv_number,media_type,file_name,original_name,mime_type,uploaded_by) VALUES ($1,'license',$2,$3,$4,$5)`,
        [req.params.invNumber, f.filename, f.originalname, f.mimetype, capturedBy]);
    }
    if (req.files?.driver_photo_upload) {
      const f = req.files.driver_photo_upload[0];
      await db.query(`INSERT INTO dispatch_media (inv_number,media_type,file_name,original_name,mime_type,uploaded_by) VALUES ($1,'driver',$2,$3,$4,$5)`,
        [req.params.invNumber, f.filename, f.originalname, f.mimetype, capturedBy]);
    }

    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
      [capturedBy, req.session.user.role, 'CAPTURE_TRANSPORT', `Invoice #${req.params.invNumber}`]);

    req.flash('success', `Transport details saved for Invoice #${req.params.invNumber}.`);
    res.redirect('/dispatch');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to save: ' + err.message);
    res.redirect(`/dispatch/capture/${req.params.invNumber}`);
  }
});

module.exports = router;
