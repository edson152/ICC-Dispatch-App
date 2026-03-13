const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

// GET login page
router.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/dispatch');
  }
  res.render('login', { title: 'ICC Dispatch System' });
});

// GET employees list for dropdown (AJAX)
router.get('/employees-list', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, full_name, role FROM employees WHERE is_active = TRUE ORDER BY full_name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// POST employee login
router.post('/login/employee', async (req, res) => {
  const { employee_id, pin } = req.body;
  try {
    const result = await db.query(
      'SELECT * FROM employees WHERE id = $1 AND is_active = TRUE',
      [employee_id]
    );
    if (!result.rows.length) {
      req.flash('error', 'Employee not found or inactive.');
      return res.redirect('/');
    }
    const emp = result.rows[0];
    const match = await bcrypt.compare(pin, emp.pin_hash);
    if (!match) {
      req.flash('error', 'Incorrect PIN. Please try again.');
      return res.redirect('/');
    }
    req.session.user = {
      id: emp.id,
      name: emp.full_name,
      role: 'employee',
      empRole: emp.role
    };
    // Audit log
    await db.query(
      'INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1, $2, $3, $4)',
      [emp.full_name, 'employee', 'LOGIN', 'Employee signed in']
    );
    res.redirect('/dispatch');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Login error. Please try again.');
    res.redirect('/');
  }
});

// POST admin login
router.post('/login/admin', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query(
      'SELECT * FROM admins WHERE username = $1',
      [username]
    );
    if (!result.rows.length) {
      req.flash('error', 'Invalid admin credentials.');
      return res.redirect('/');
    }
    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      req.flash('error', 'Invalid admin credentials.');
      return res.redirect('/');
    }
    req.session.user = {
      id: admin.id,
      name: admin.full_name,
      role: 'admin'
    };
    await db.query(
      'INSERT INTO audit_log (user_name, user_role, action, detail) VALUES ($1, $2, $3, $4)',
      [admin.full_name, 'admin', 'LOGIN', 'Admin signed in']
    );
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Login error. Please try again.');
    res.redirect('/');
  }
});

// POST logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
