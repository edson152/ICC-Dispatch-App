const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req,file,cb) => { const d=path.join(__dirname,'..','public','uploads','returns'); fs.mkdirSync(d,{recursive:true}); cb(null,d); },
  filename: (req,file,cb) => { cb(null,`return_${Date.now()}${path.extname(file.originalname)}`); }
});
const upload = multer({storage,limits:{fileSize:20*1024*1024}});

// GET returns list (admin)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*,d.acc_name,d.acc_no,d.email,d.phone FROM returns r
      JOIN dispatch_records d ON r.inv_number=d.inv_number
      ORDER BY r.created_at DESC
    `);
    res.render('admin/returns', { title: 'Returns & Damaged Goods', returns: result.rows });
  } catch(err) { console.error(err); res.redirect('/admin/dashboard'); }
});

// POST: report a return/damage
router.post('/report', requireAuth, upload.single('photo'), async (req, res) => {
  const { inv_number, return_type, description } = req.body;
  const photo_path = req.file?.filename || null;
  try {
    await db.query('INSERT INTO returns (inv_number,return_type,description,photo_path,reported_by) VALUES ($1,$2,$3,$4,$5)',
      [inv_number, return_type||'damaged', description, photo_path, req.session.user.name]);
    // Alert admin
    const { sendEmail } = require('../services/notifications');
    if (process.env.ADMIN_EMAIL) {
      const d = await db.query('SELECT * FROM dispatch_records WHERE inv_number=$1',[inv_number]);
      const disp = d.rows[0];
      await sendEmail(process.env.ADMIN_EMAIL,
        `⚠ Return/Damage Report — Invoice #${inv_number}`,
        `<h3>Return Reported</h3><p><b>Invoice:</b> #${inv_number}</p><p><b>Customer:</b> ${disp?.acc_name}</p><p><b>Type:</b> ${return_type}</p><p><b>Description:</b> ${description}</p><p><b>Reported by:</b> ${req.session.user.name}</p>`
      ).catch(()=>{});
    }
    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
      [req.session.user.name,req.session.user.role,'RETURN_REPORTED',`Return for Invoice #${inv_number}: ${return_type}`]);
    req.flash('success','Return reported and admin notified.');
  } catch(err) { req.flash('error','Failed to report return.'); }
  res.redirect(req.get('Referer')||'/receipts');
});

// POST: resolve return
router.post('/resolve/:id', requireAdmin, async (req, res) => {
  await db.query('UPDATE returns SET resolved=TRUE WHERE id=$1',[req.params.id]);
  req.flash('success','Return marked as resolved.');
  res.redirect('/returns');
});

module.exports = router;
