
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.mimetype.startsWith('image')) cb(null, 'uploads/goods');
        else if (file.mimetype.startsWith('video')) cb(null, 'uploads/videos');
        else cb(null, 'uploads/receipts');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

router.get('/dispatch/new', (req, res) => {
    res.render('dispatch_form');
});

router.post('/dispatch/create',
    upload.fields([
        { name: 'goods_photo', maxCount: 5 },
        { name: 'goods_video', maxCount: 1 },
        { name: 'receipt_photo', maxCount: 1 }
    ]),
    async (req, res) => {
        const user = req.session?.user?.name || "Employee";
        console.log("Captured By:", user);
        res.send("Dispatch evidence uploaded successfully.");
    }
);

module.exports = router;
