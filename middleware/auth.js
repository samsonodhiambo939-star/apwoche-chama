function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  if (req.session.user.admin_role && !['chairman', 'treasurer'].includes(req.session.user.admin_role)) {
    return res.redirect('/login');
  }
  next();
}

function requireMember(req, res, next) {
  if (!req.session.user || (!req.session.user.memberId)) {
    return res.redirect('/login');
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

module.exports = { requireAdmin, requireMember, requireLogin };
