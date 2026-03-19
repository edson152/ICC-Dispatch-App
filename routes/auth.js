const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { loginRateLimit, recordLoginFailure, recordLoginSuccess } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

router.get('/', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/dispatch');
  res.render('login', { title: 'ICC Dispatch System' });
});

router.get('/employees-list', async (req, res) => {
  try {
    const result = await db.query('SELECT id, full_name, role FROM employees WHERE is_active = TRUE ORDER BY full_name ASC');
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: 'Database error' }); }
});

// Employee login with rate limiting
router.post('/login/employee', loginRateLimit, async (req, res) => {
  const { employee_id, pin } = req.body;
  try {
    const result = await db.query('SELECT * FROM employees WHERE id = $1 AND is_active = TRUE', [employee_id]);
    if (!result.rows.length) {
      recordLoginFailure(req.ip);
      req.flash('error', 'Employee not found or inactive.');
      return res.redirect('/');
    }
    const emp = result.rows[0];
    const match = await bcrypt.compare(String(pin), emp.pin_hash);
    if (!match) {
      recordLoginFailure(req.ip);
      req.flash('error', 'Incorrect PIN. Please try again.');
      return res.redirect('/');
    }
    recordLoginSuccess(req.ip);
    req.session.user = { id: emp.id, name: emp.full_name, role: 'employee', empRole: emp.role };
    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
      [emp.full_name, 'employee', 'LOGIN', `Employee signed in from ${req.ip}`]);
    res.redirect('/dispatch');
  } catch(err) {
    console.error(err);
    req.flash('error', 'Login error. Please try again.');
    res.redirect('/');
  }
});

// Admin login with rate limiting
router.post('/login/admin', loginRateLimit, async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (!result.rows.length) {
      recordLoginFailure(req.ip);
      req.flash('error', 'Invalid admin credentials.');
      return res.redirect('/');
    }
    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      recordLoginFailure(req.ip);
      req.flash('error', 'Invalid admin credentials.');
      return res.redirect('/');
    }
    recordLoginSuccess(req.ip);
    req.session.user = { id: admin.id, name: admin.full_name, role: 'admin' };
    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
      [admin.full_name, 'admin', 'LOGIN', `Admin signed in from ${req.ip}`]);
    res.redirect('/admin/dashboard');
  } catch(err) {
    console.error(err);
    req.flash('error', 'Login error. Please try again.');
    res.redirect('/');
  }
});

// Employee change PIN (item 6)
router.get('/change-pin', requireAuth, (req, res) => {
  if (req.session.user.role !== 'employee') return res.redirect('/admin/dashboard');
  res.render('change-pin', { title: 'Change My PIN' });
});

router.post('/change-pin', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'employee') return res.redirect('/admin/dashboard');
  const { current_pin, new_pin, confirm_pin } = req.body;
  if (!new_pin || !/^\d{4}$/.test(new_pin)) { req.flash('error', 'New PIN must be exactly 4 digits.'); return res.redirect('/change-pin'); }
  if (new_pin !== confirm_pin) { req.flash('error', 'New PIN and confirmation do not match.'); return res.redirect('/change-pin'); }
  try {
    const emp = await db.query('SELECT pin_hash FROM employees WHERE id=$1', [req.session.user.id]);
    const match = await bcrypt.compare(String(current_pin), emp.rows[0].pin_hash);
    if (!match) { req.flash('error', 'Current PIN is incorrect.'); return res.redirect('/change-pin'); }
    const hash = await bcrypt.hash(new_pin, 10);
    await db.query('UPDATE employees SET pin_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.session.user.id]);
    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
      [req.session.user.name, 'employee', 'PIN_CHANGED', 'Employee changed their own PIN']);
    req.flash('success', 'PIN changed successfully.');
    res.redirect('/dispatch');
  } catch(err) {
    console.error(err);
    req.flash('error', 'Failed to change PIN.');
    res.redirect('/change-pin');
  }
});

// Admin change password
router.get('/change-password', requireAuth, (req, res) => {
  if (req.session.user.role !== 'admin') return res.redirect('/dispatch');
  res.render('change-password', { title: 'Change Admin Password' });
});

router.post('/change-password', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.redirect('/dispatch');
  const { current_password, new_password, confirm_password } = req.body;
  if (!new_password || new_password.length < 8) { req.flash('error', 'New password must be at least 8 characters.'); return res.redirect('/change-password'); }
  if (new_password !== confirm_password) { req.flash('error', 'Passwords do not match.'); return res.redirect('/change-password'); }
  try {
    const admin = await db.query('SELECT password_hash FROM admins WHERE id=$1', [req.session.user.id]);
    const match = await bcrypt.compare(current_password, admin.rows[0].password_hash);
    if (!match) { req.flash('error', 'Current password is incorrect.'); return res.redirect('/change-password'); }
    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE admins SET password_hash=$1 WHERE id=$2', [hash, req.session.user.id]);
    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
      [req.session.user.name, 'admin', 'PASSWORD_CHANGED', 'Admin changed their password']);
    req.flash('success', 'Password changed successfully.');
    res.redirect('/admin/dashboard');
  } catch(err) {
    req.flash('error', 'Failed to change password.');
    res.redirect('/change-password');
  }
});

router.post('/logout', (req, res) => {
  const name = req.session.user?.name;
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
