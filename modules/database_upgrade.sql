
CREATE TABLE IF NOT EXISTS dispatch_evidence (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER,
    goods_photo TEXT,
    goods_video TEXT,
    receipt_photo TEXT,
    uploaded_by TEXT,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_logs (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER,
    edited_by TEXT,
    action TEXT,
    edit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
