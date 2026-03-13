function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please sign in to continue.');
  res.redirect('/');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error', 'Admin access required.');
  res.redirect('/dashboard');
}

function requireEmployee(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please sign in to continue.');
  res.redirect('/');
}

module.exports = { requireAuth, requireAdmin, requireEmployee };
