// ICC Dispatch — Input Validation Middleware

function validateCapture(req, res, next) {
  const { license_plate, driver_phone, tracking_number } = req.body;
  const errors = [];

  // License plate format (SA/SADC)
  if (license_plate && license_plate.trim()) {
    const plate = license_plate.trim().toUpperCase();
    const valid = [
      /^[A-Z]{3}\s?\d{3}\s?[A-Z]{2}$/,
      /^[A-Z]{2}\s?\d{2}\s?[A-Z]{2}$/,
      /^ICC[-\s]?\d{1,4}$/i,
      /^[A-Z0-9]{2,10}$/
    ].some(r => r.test(plate));
    if (!valid) errors.push('Invalid license plate format');
  }

  // Phone number basic check
  if (driver_phone && driver_phone.trim()) {
    const phone = driver_phone.replace(/\D/g,'');
    if (phone.length < 9 || phone.length > 12) errors.push('Invalid driver phone number');
  }

  // Tracking number max length
  if (tracking_number && tracking_number.length > 100) errors.push('Tracking number too long (max 100 chars)');

  if (errors.length) {
    req.flash('error', errors.join(' · '));
    return res.redirect('back');
  }
  next();
}

function validateEmployee(req, res, next) {
  const { full_name, pin } = req.body;
  const errors = [];
  if (!full_name || full_name.trim().length < 2) errors.push('Full name must be at least 2 characters');
  if (full_name && full_name.length > 100) errors.push('Name too long');
  if (pin && !/^\d{4}$/.test(pin)) errors.push('PIN must be exactly 4 digits');
  if (errors.length) { req.flash('error', errors.join(' · ')); return res.redirect('back'); }
  next();
}

function validateTruck(req, res, next) {
  const { truck_name, license_plate } = req.body;
  const errors = [];
  if (!truck_name || truck_name.trim().length < 2) errors.push('Truck name required');
  if (!license_plate || license_plate.trim().length < 2) errors.push('License plate required');
  if (errors.length) { req.flash('error', errors.join(' · ')); return res.redirect('back'); }
  next();
}

// Rate limiter: track failed login attempts in memory
const loginAttempts = new Map();

function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, firstAttempt: now, locked: false, lockedUntil: 0 };

  // Check if currently locked
  if (record.locked && now < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - now) / 60000);
    req.flash('error', `Too many failed attempts. Try again in ${remaining} minute(s).`);
    return res.redirect('/');
  }

  // Reset if lock expired
  if (record.locked && now >= record.lockedUntil) {
    loginAttempts.set(key, { count: 0, firstAttempt: now, locked: false, lockedUntil: 0 });
  }

  req.loginRecord = record;
  req.loginKey = key;
  next();
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now, locked: false, lockedUntil: 0 };
  record.count++;
  if (record.count >= 5) {
    record.locked = true;
    record.lockedUntil = now + 10 * 60 * 1000; // 10 minutes
    console.log(`🔒 IP ${ip} locked out after ${record.count} failed login attempts`);
  }
  loginAttempts.set(ip, record);
}

function recordLoginSuccess(ip) {
  loginAttempts.delete(ip);
}

// Clean up old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of loginAttempts.entries()) {
    if (now - record.firstAttempt > 60 * 60 * 1000) loginAttempts.delete(key);
  }
}, 60 * 60 * 1000);

module.exports = { validateCapture, validateEmployee, validateTruck, loginRateLimit, recordLoginFailure, recordLoginSuccess };
