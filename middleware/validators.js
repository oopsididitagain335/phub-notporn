const validator = require('validator');

function validateUsername(u) {
  return (
    typeof u === 'string' &&
    u.length >= 3 &&
    u.length <= 32 &&
    /^[a-zA-Z0-9_]+$/.test(u)
  );
}

function validatePassword(p) {
  return (
    typeof p === 'string' &&
    p.length >= 8 &&
    /[A-Z]/.test(p) &&
    /[a-z]/.test(p) &&
    /[0-9]/.test(p)
  );
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return validator.escape(str.trim());
}

module.exports = { validateUsername, validatePassword, sanitize };
