const crypto = require('crypto');

function csrfMiddleware(req, res, next) {
  // Generate token if not exists
  if (!req.session) return next();
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Provide token getter
  req.csrfToken = () => req.session.csrfToken;

  // Skip validation for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip for install routes (no session yet) and API
  if (req.path.startsWith('/install') || req.path.startsWith('/api/ipn')) {
    return next();
  }

  // Validate
  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).render('pages/error', {
      title: 'Invalid Request',
      message: 'Invalid or missing CSRF token. Please try again.'
    });
  }

  next();
}

function csrfErrorHandler(err, req, res, next) {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('pages/error', {
      title: 'Invalid Request',
      message: 'Invalid CSRF token. Please refresh the page and try again.'
    });
  }
  next(err);
}

module.exports = { csrfMiddleware, csrfErrorHandler };
