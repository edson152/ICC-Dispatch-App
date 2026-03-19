const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const notify = require('../services/notifications');
const tracking = require('../services/tracking');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// SA/SADC plate patterns
const PLATE_RE = [/^[A-Z]{3}\s?\d{3}\s?[A-Z]{2}$/,/^[A-Z]{2}\s?\d{2}\s?[A-Z]{2}$/,/^ICC[-\s]?\d{1,4}$/i,/^[A-Z0-9]{2,10}$/];
function validatePlate(p) { return !p || PLATE_RE.some(r=>r.test(p.trim().toUpperCase())); }

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdir = file.fieldname==='license_photo'?'licenses':file.fieldname==='driver_photo_upload'?'drivers':'goods';
    const dir = path.join(__dirname,'..','public','uploads',subdir);
    fs.mkdirSync(dir,{recursive:true});
    cb(null,dir);
  },
  filename: (req,file,cb) => { cb(null,`${file.fieldname}_${req.params?.invNumber||'x'}_${Date.now()}${path.extname(file.originalname)}`); }
});
const upload = multer({storage,limits:{fileSize:50*1024*1024},fileFilter:(req,file,cb)=>{
  const ok=/jpeg|jpg|png|gif|webp|mp4|mov|avi|pdf/i;
  cb(null, ok.test(path.extname(file.originalname))||ok.test(file.mimetype));
}});

// GET dispatch list
router.get('/', requireAuth, async (req, res) => {
  try {
    const {search='',delivery='',status=''} = req.query;
    let q=`SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE 1=1`;
    const params=[]; let idx=1;
    if(search){q+=` AND (CAST(d.inv_number AS TEXT) ILIKE $${idx} OR d.acc_name ILIKE $${idx} OR d.acc_no ILIKE $${idx})`;params.push(`%${search}%`);idx++;}
    if(delivery){q+=` AND d.delivery_method=$${idx}`;params.push(delivery);idx++;}
    if(status==='pending') q+=` AND (d.transport_company IS NULL OR d.transport_company='')`;
    else if(status==='dispatched') q+=` AND d.dispatch_status='dispatched'`;
    else if(status==='delivered') q+=` AND d.dispatch_status='delivered'`;
    q+=` ORDER BY d.inv_date DESC,d.inv_number DESC LIMIT 100`;
    const result = await db.query(q,params);
    const stats = await db.query(`SELECT COUNT(*) as total,COUNT(CASE WHEN transport_company IS NOT NULL AND transport_company!='' THEN 1 END) as dispatched_count,COUNT(CASE WHEN transport_company IS NULL OR transport_company='' THEN 1 END) as pending,COUNT(CASE WHEN dispatch_status='delivered' THEN 1 END) as delivered FROM dispatch_records`);
    const pending = result.rows.filter(r=>r.dispatch_status!=='delivered');
    const completed = result.rows.filter(r=>r.dispatch_status==='delivered');
    res.render('dispatch/index',{title:'Dispatch Orders',dispatches:pending,completed,stats:stats.rows[0],search,delivery,status});
  } catch(err){console.error(err);req.flash('error','Failed to load.');res.redirect('/');}
});

// API: invoice lookup for auto-fill
router.get('/lookup/:invNumber', requireAuth, async (req,res) => {
  try {
    const r = await db.query('SELECT * FROM dispatch_records WHERE inv_number=$1',[req.params.invNumber]);
    if(!r.rows.length) return res.json({error:'Invoice not found'});
    res.json(r.rows[0]);
  } catch(err){res.status(500).json({error:err.message});}
});

// GET capture form
router.get('/capture/:invNumber', requireAuth, async (req,res) => {
  try {
    const result = await db.query('SELECT d.*,t.truck_name FROM dispatch_records d LEFT JOIN icc_trucks t ON d.icc_truck_id=t.id WHERE d.inv_number=$1',[req.params.invNumber]);
    if(!result.rows.length){req.flash('error','Invoice not found.');return res.redirect('/dispatch');}
    const [media,trucks,settingsRows,prevC,prevD,prevP] = await Promise.all([
      db.query('SELECT * FROM dispatch_media WHERE inv_number=$1 ORDER BY uploaded_at DESC',[req.params.invNumber]),
      db.query('SELECT * FROM icc_trucks WHERE is_active=TRUE ORDER BY truck_name ASC'),
      db.query('SELECT key,value FROM system_settings'),
      db.query(`SELECT DISTINCT transport_company FROM dispatch_records WHERE transport_company IS NOT NULL AND transport_company NOT IN ('ICC Truck','Collection') AND transport_company!='' ORDER BY transport_company LIMIT 30`),
      db.query(`SELECT DISTINCT driver_first_name AS first,driver_surname AS surname FROM dispatch_records WHERE driver_first_name IS NOT NULL AND driver_first_name!='' ORDER BY driver_first_name LIMIT 30`),
      db.query(`SELECT DISTINCT license_plate FROM dispatch_records WHERE license_plate IS NOT NULL AND license_plate!='' ORDER BY license_plate LIMIT 30`)
    ]);
    const cfg={};settingsRows.rows.forEach(r=>{cfg[r.key]=r.value;});
    res.render('dispatch/capture',{
      title:'Capture Transport Details',dispatch:result.rows[0],
      media:media.rows,trucks:trucks.rows,settings:cfg,
      prevCouriers:prevC.rows.map(r=>r.transport_company),
      prevDrivers:prevD.rows,prevPlates:prevP.rows.map(r=>r.license_plate)
    });
  } catch(err){console.error(err);req.flash('error','Error loading invoice.');res.redirect('/dispatch');}
});

// POST save transport details
router.post('/capture/:invNumber', requireAuth, upload.fields([
  {name:'goods_photos',maxCount:5},{name:'license_photo',maxCount:1},{name:'driver_photo_upload',maxCount:1}
]), async (req,res) => {
  const {transport_company,icc_truck_id,driver_first_name,driver_surname,driver_phone,license_plate,tracking_number,notes,notify_channel} = req.body;
  const capturedBy = req.session.user.name;

  if(license_plate && !validatePlate(license_plate)){
    req.flash('error','Invalid number plate format. Please check and re-enter.');
    return res.redirect(`/dispatch/capture/${req.params.invNumber}`);
  }

  try {
    const updated = await db.query(`
      UPDATE dispatch_records SET
        transport_company=$1,icc_truck_id=$2,driver_first_name=$3,driver_surname=$4,
        driver_phone=$5,license_plate=$6,tracking_number=$7,notes=$8,
        captured_by=$9,captured_at=NOW(),dispatch_status='dispatched',dispatched_at=NOW(),updated_at=NOW()
      WHERE inv_number=$10 RETURNING *
    `,[transport_company||null,icc_truck_id||null,driver_first_name,driver_surname,
       driver_phone,license_plate?.toUpperCase()||null,tracking_number,notes,
       capturedBy,req.params.invNumber]);

    const dispatch = updated.rows[0];

    // Save uploads
    for(const field of ['goods_photos','license_photo','driver_photo_upload']){
      const files = req.files?.[field];
      if(!files) continue;
      const type = field==='license_photo'?'license':field==='driver_photo_upload'?'driver':'goods';
      for(const f of files){
        await db.query('INSERT INTO dispatch_media (inv_number,media_type,file_name,original_name,mime_type,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [req.params.invNumber,type,f.filename,f.originalname,f.mimetype,capturedBy]);
      }
    }

    // Generate tracking token
    const token = await tracking.generateTrackingToken(req.params.invNumber);

    // Notifications
    const channel = notify_channel || 'none';
    if(channel!=='none'){
      await notify.notifyCustomerDispatched(dispatch, channel);
      await notify.notifyDriver(dispatch, channel);
    }
    await notify.notifyAdminCaptured(dispatch, capturedBy);

    await db.query('INSERT INTO audit_log (user_name,user_role,action,detail) VALUES ($1,$2,$3,$4)',
      [capturedBy,req.session.user.role,'CAPTURE_TRANSPORT',`Invoice #${req.params.invNumber} — ${channel!=='none'?`notified via ${channel}`:'no notification'}`]);

    req.flash('success',`Transport details saved for Invoice #${req.params.invNumber}.${channel!=='none'?' Customer & driver notified.':''}`);
    res.redirect('/dispatch');
  } catch(err){
    console.error(err);
    req.flash('error','Failed to save: '+err.message);
    res.redirect(`/dispatch/capture/${req.params.invNumber}`);
  }
});

module.exports = router;
