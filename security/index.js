// security/index.js

const antiVpn = require('./antiVpn');
const antiScrape = require('./antiScrape'); // Updated version
const antiDdos = require('./antiDdos');
const antiAdblock = require('./antiAdblock'); // Updated version
const { logThreat } = require('../models/logging');

module.exports = {
    // Logging
    logThreat,

    // Defense Middlewares
    antiVpn: antiVpn.detectVpnOrBanEvasion,
    antiScrape: antiScrape.detectAutomation, // ← Use the enhanced one
    antiDdos: antiDdos.antiDdosMiddleware,
    apiRateLimiter: antiDdos.apiRateLimiter,

    // Utilities
    generateFingerprint: antiVpn.generateFingerprint,
    banUser: antiVpn.banUser,
    getAntiAdblockScript: antiAdblock.getAntiAdblockScript, // ← Use the enhanced one
    handleAdblockReport: antiAdblock.handleAdblockReport,

    // Data Stores
    BANNED_IPS: antiVpn.BANNED_IPS,
    BANNED_FINGERPRINTS: antiVpn.BANNED_FINGERPRINTS,
    REQUEST_HISTORY: antiDdos.REQUEST_HISTORY
};
