const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

// GET employees list
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM employees ORDER BY full_name ASC');
    res.render('admin/employees', {
      title: 'Employee Management',
      employees: result.rows
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load employees.');
    res.redirect('/admin/dashboard');
  }
});

// POST add employee
router.post('/add', requireAdmin, async (req, res) => {
  const { full_name, role, pin } = req.body;
  if (!full_name || !pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    req.flash('error', 'Please provide a valid name and 4-digit numeric PIN.');
    return res.redirect('/employees');
  }
  try {
    const hash = await bcrypt.hash(pin, 10);
    await db.query(
      'INSERT INTO employees (full_name, role, pin_hash) VALUES ($1, $2, $3)',
      [full_name.trim(), role || 'Employee', hash]
    );
    await db.query(
      'INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1, $2, $3, $4)',
      [req.session.user.name, 'admin', 'ADD_EMPLOYEE', `Added employee: ${full_name}`]
    );
    req.flash('success', `Employee ${full_name} added successfully.`);
    res.redirect('/employees');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add employee.');
    res.redirect('/employees');
  }
});

// POST reset PIN
router.post('/reset-pin/:id', requireAdmin, async (req, res) => {
  const { new_pin } = req.body;
  if (!new_pin || new_pin.length !== 4 || !/^\d{4}$/.test(new_pin)) {
    req.flash('error', 'PIN must be exactly 4 digits.');
    return res.redirect('/employees');
  }
  try {
    const hash = await bcrypt.hash(new_pin, 10);
    const result = await db.query(
      'UPDATE employees SET pin_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING full_name',
      [hash, req.params.id]
    );
    req.flash('success', `PIN reset for ${result.rows[0]?.full_name}.`);
    res.redirect('/employees');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to reset PIN.');
    res.redirect('/employees');
  }
});

// POST toggle active
router.post('/toggle/:id', requireAdmin, async (req, res) => {
  try {
    await db.query(
      'UPDATE employees SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    req.flash('success', 'Employee status updated.');
    res.redirect('/employees');
  } catch (err) {
    req.flash('error', 'Failed to update employee.');
    res.redirect('/employees');
  }
});

// POST delete
router.post('/delete/:id', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    req.flash('success', 'Employee removed.');
    res.redirect('/employees');
  } catch (err) {
    req.flash('error', 'Failed to remove employee.');
    res.redirect('/employees');
  }
});

// POST import from CSV
router.post('/import', requireAdmin, upload.single('csv_file'), async (req, res) => {
  if (!req.file) {
    req.flash('error', 'No file uploaded.');
    return res.redirect('/employees');
  }
  try {
    const content = req.file.buffer.toString('utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const defaultPin = '1234';
    const hash = await bcrypt.hash(defaultPin, 10);
    let count = 0;

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(s => s.trim().replace(/"/g, ''));
      if (!parts[0]) continue;
      const name = parts[0];
      const role = parts[1] || 'Employee';
      const pin = parts[2] && /^\d{4}$/.test(parts[2]) ? parts[2] : defaultPin;
      const pinHash = pin === defaultPin ? hash : await bcrypt.hash(pin, 10);
      await db.query(
        'INSERT INTO employees (full_name, role, pin_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [name, role, pinHash]
      );
      count++;
    }
    req.flash('success', `${count} employees imported. Default PIN is 1234 unless specified.`);
    res.redirect('/employees');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Import failed. Check your CSV format.');
    res.redirect('/employees');
  }
});

module.exports = router;
