// security/antiDdos.js
// Rate limiting + IP behavior analysis + Redirect traps

const rateLimit = require('express-rate-limit');
const { logThreat } = require('../models/logging');

// Track request bursts per IP
const REQUEST_HISTORY = new Map(); // ip => { count, windowStart }

function analyzeRequestBurst(req) {
    const ip = req.clientIp;
    const now = Date.now();
    const windowMs = 10000; // 10 seconds

    let record = REQUEST_HISTORY.get(ip);
    if (!record || now - record.windowStart > windowMs) {
        record = { count: 1, windowStart: now };
    } else {
        record.count++;
    }

    REQUEST_HISTORY.set(ip, record);

    // If > 50 requests in 10s → DDoS/API Bomb
    if (record.count > 50) {
        return true;
    }

    // Cleanup old records (optional)
    if (REQUEST_HISTORY.size > 10000) {
        for (let [key, val] of REQUEST_HISTORY.entries()) {
            if (now - val.windowStart > windowMs) {
                REQUEST_HISTORY.delete(key);
            }
        }
    }

    return false;
}

// DDoS Middleware
function antiDdosMiddleware(req, res, next) {
    if (analyzeRequestBurst(req)) {
        logThreat({
            ip: req.clientIp,
            fingerprint: req.fingerprint || 'unknown',
            userAgent: req.get('User-Agent'),
            reason: 'ddos_attempt',
            actionTaken: 'redirected',
            endpoint: req.path
        });

        // Redirect to invalid domain — breaks bots silently
        return res.redirect(302, "http://attack-trap.invalid.pulsehub.fake/api/bomb");
    }
    next();
}

// Express Rate Limiter (for API endpoints)
const apiRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 40, // 40 requests per IP
    message: { error: "Too many requests. Try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        logThreat({
            ip: req.clientIp,
            fingerprint: req.fingerprint,
            userAgent: req.get('User-Agent'),
            reason: 'api_bomb',
            actionTaken: 'rate_limited',
            endpoint: req.path
        });

        res.redirect(302, "http://rate-limit-trap.pulsehub.fake/429");
    }
});

module.exports = {
    antiDdosMiddleware,
    apiRateLimiter,
    REQUEST_HISTORY
};
