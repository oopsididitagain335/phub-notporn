// security/index.js — Central export for all defense modules

const antiVpn = require('./antiVpn');
const antiScrape = require('./antiScrape');
const antiDdos = require('./antiDdos');
const antiAdblock = require('./antiAdblock');
const { logThreat } = require('../models/logging');

module.exports = {
    // Logging
    logThreat,

    // Defense Middlewares
    antiVpn: antiVpn.detectVpnOrBanEvasion,
    antiScrape: antiScrape.detectAutomation,
    antiDdos: antiDdos.antiDdosMiddleware,
    apiRateLimiter: antiDdos.apiRateLimiter,

    // Utilities
    generateFingerprint: antiVpn.generateFingerprint,
    banUser: antiVpn.banUser,
    getAntiAdblockScript: antiAdblock.getAntiAdblockScript,
    handleAdblockReport: antiAdblock.handleAdblockReport,

    // Data Stores (for monitoring)
    BANNED_IPS: antiVpn.BANNED_IPS,
    BANNED_FINGERPRINTS: antiVpn.BANNED_FINGERPRINTS,
    REQUEST_HISTORY: antiDdos.REQUEST_HISTORY
};
