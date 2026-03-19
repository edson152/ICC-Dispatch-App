const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM employees ORDER BY full_name ASC');
    res.render('admin/employees', { title:'Employee Management', employees:result.rows });
  } catch (err) { console.error(err); req.flash('error','Failed.'); res.redirect('/admin/dashboard'); }
});

router.post('/add', requireAdmin, async (req, res) => {
  const { full_name, role, pin } = req.body;
  const finalPin = pin && /^\d{4}$/.test(pin) ? pin : generatePin();
  try {
    const hash = await bcrypt.hash(finalPin, 10);
    await db.query('INSERT INTO employees (full_name,role,pin_hash) VALUES ($1,$2,$3)', [full_name.trim(), role||'Employee', hash]);
    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)', [req.session.user.name,'admin','ADD_EMPLOYEE',`Added: ${full_name}`]);
    req.flash('success', `${full_name} added. PIN: ${finalPin}`);
  } catch (err) { req.flash('error','Failed: '+err.message); }
  res.redirect('/employees');
});

router.post('/reset-pin/:id', requireAdmin, async (req, res) => {
  const { new_pin } = req.body;
  if (!new_pin || !/^\d{4}$/.test(new_pin)) { req.flash('error','PIN must be 4 digits.'); return res.redirect('/employees'); }
  try {
    const hash = await bcrypt.hash(new_pin, 10);
    const r = await db.query('UPDATE employees SET pin_hash=$1,updated_at=NOW() WHERE id=$2 RETURNING full_name', [hash, req.params.id]);
    req.flash('success', `PIN reset for ${r.rows[0]?.full_name}.`);
  } catch (err) { req.flash('error','Failed.'); }
  res.redirect('/employees');
});

router.post('/toggle/:id', requireAdmin, async (req, res) => {
  await db.query('UPDATE employees SET is_active=NOT is_active,updated_at=NOW() WHERE id=$1', [req.params.id]);
  req.flash('success','Employee status updated.');
  res.redirect('/employees');
});

router.post('/delete/:id', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM employees WHERE id=$1', [req.params.id]);
  req.flash('success','Employee removed.');
  res.redirect('/employees');
});

router.post('/import', requireAdmin, upload.single('csv_file'), async (req, res) => {
  if (!req.file) { req.flash('error','No file.'); return res.redirect('/employees'); }
  try {
    const lines = req.file.buffer.toString('utf-8').split('\n').filter(l => l.trim());
    let count=0, pinList=[];
    for (let i=1; i<lines.length; i++) {
      const parts = lines[i].split(',').map(s => s.trim().replace(/"/g,''));
      if (!parts[0]) continue;
      const name=parts[0], role=parts[1]||'Employee';
      const pin = parts[2] && /^\d{4}$/.test(parts[2]) ? parts[2] : generatePin();
      const hash = await bcrypt.hash(pin, 10);
      await db.query('INSERT INTO employees (full_name,role,pin_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [name, role, hash]);
      pinList.push(`${name}: PIN ${pin}`);
      count++;
    }
    req.flash('success', `${count} employees imported. PINs — ${pinList.join(' | ')}`);
  } catch (err) { req.flash('error','Import failed.'); }
  res.redirect('/employees');
});

module.exports = router;
