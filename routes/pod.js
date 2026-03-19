// ICC Dispatch — POD (Proof of Delivery) & QR Code Routes
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const qrService = require('../services/qr');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'pods');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `pod_${req.params.token || 'x'}_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Admin: Pending QR list ────────────────────────────────────────────────────
router.get('/pending', requireAdmin, async (req, res) => {
  try {
    const pending = await qrService.getPendingQRs();
    res.render('admin/qr-pending', { title: 'Pending PODs — QR Codes', pending });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load QR list.');
    res.redirect('/admin/dashboard');
  }
});

// ── Admin: POD Archive / Completed logs ──────────────────────────────────────
router.get('/logs', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 25, offset = (page - 1) * limit;
    const search = req.query.search || '';

    let q = `SELECT * FROM pod_logs WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (search) {
      q += ` AND (CAST(inv_number AS TEXT) ILIKE $${idx} OR acc_name ILIKE $${idx} OR acc_no ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }
    q += ` ORDER BY archived_at DESC LIMIT $${idx} OFFSET $${idx+1}`;
    params.push(limit, offset);

    const total = await db.query(`SELECT COUNT(*) as cnt FROM pod_logs` + (search ? ` WHERE CAST(inv_number AS TEXT) ILIKE '%${search}%' OR acc_name ILIKE '%${search}%'` : ''));
    const result = await db.query(q, params);

    res.render('admin/pod-logs', {
      title: 'POD Archive — Completed Orders',
      logs: result.rows,
      page,
      totalPages: Math.ceil(parseInt(total.rows[0].cnt) / limit),
      total: parseInt(total.rows[0].cnt),
      search
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
});

// ── Generate / view QR for a dispatch ────────────────────────────────────────
router.get('/label/:invNumber', requireAuth, async (req, res) => {
  try {
    const qr = await qrService.getOrCreateQR(req.params.invNumber);
    const disp = await db.query('SELECT * FROM dispatch_records WHERE inv_number=$1', [req.params.invNumber]);
    if (!disp.rows.length) { req.flash('error', 'Invoice not found.'); return res.redirect('/dispatch'); }

    // Mark as printed
    await db.query('UPDATE dispatch_qr SET printed=TRUE WHERE inv_number=$1', [req.params.invNumber]);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const { dataUrl, url } = await qrService.generateQRDataURL(qr.qr_token, baseUrl);

    res.render('pod/label', {
      title: `Dispatch Label — #${req.params.invNumber}`,
      dispatch: disp.rows[0],
      qr, dataUrl, url
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to generate QR: ' + err.message);
    res.redirect('/dispatch');
  }
});

// ── Scan QR (public — scanner hits this URL) ─────────────────────────────────
router.get('/scan/:token', async (req, res) => {
  try {
    const qr = await db.query(
      'SELECT q.*, d.acc_name, d.inv_number FROM dispatch_qr q JOIN dispatch_records d ON q.inv_number=d.inv_number WHERE q.qr_token=$1',
      [req.params.token]
    );
    if (!qr.rows.length) return res.render('pod/scan-result', { title: 'Scan Result', result: null, error: 'Invalid QR code' });

    // If already scanned — show info
    if (qr.rows[0].scanned) {
      return res.render('pod/scan-result', {
        title: 'Already Scanned',
        result: qr.rows[0],
        error: null,
        alreadyDone: true
      });
    }

    // Show scan confirmation page
    res.render('pod/scan-confirm', {
      title: `Confirm POD — Invoice #${qr.rows[0].inv_number}`,
      qr: qr.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.render('pod/scan-result', { title: 'Error', result: null, error: 'Server error' });
  }
});

// ── POST: confirm scan + optional photo upload ────────────────────────────────
router.post('/scan/:token', upload.single('pod_photo'), async (req, res) => {
  const scannedBy = req.session?.user?.name || req.body.scanned_by || 'Scanner';
  const podScanPath = req.file?.filename || null;
  try {
    const result = await qrService.markScanned(req.params.token, scannedBy, podScanPath);
    res.render('pod/scan-result', { title: 'POD Scanned', result, error: null, alreadyDone: false });
  } catch (err) {
    console.error(err);
    res.render('pod/scan-result', { title: 'Error', result: null, error: err.message });
  }
});

// ── API: quick scan (for admin manual scan button) ───────────────────────────
router.post('/scan-manual/:invNumber', requireAdmin, async (req, res) => {
  try {
    const qr = await db.query('SELECT qr_token FROM dispatch_qr WHERE inv_number=$1', [req.params.invNumber]);
    if (!qr.rows.length) {
      // Generate one first
      const newQr = await qrService.getOrCreateQR(req.params.invNumber);
      const result = await qrService.markScanned(newQr.qr_token, req.session.user.name, null);
      return res.json(result);
    }
    const result = await qrService.markScanned(qr.rows[0].qr_token, req.session.user.name, null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
