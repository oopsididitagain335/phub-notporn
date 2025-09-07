// models/logging.js
// Logs dangerous IPs, fingerprints, and attack attempts to MongoDB + console

const mongoose = require('mongoose');

const threatLogSchema = new mongoose.Schema({
    ip: { type: String, required: true, index: true },
    userAgent: String,
    fingerprint: String,
    reason: { type: String, required: true, enum: [
        'ban_evasion',
        'vpn_proxy',
        'rapid_requests',
        'headless_browser',
        'adblock_detected',
        'api_bomb',
        'ddos_attempt',
        'suspicious_behavior'
    ]},
    actionTaken: { type: String, enum: ['blocked', 'redirected', 'logged', 'captcha'] },
    endpoint: String,
    timestamp: { type: Date, default: Date.now },
    headers: Object,
    geo: Object,
    vpnScore: Number,
    tor: Boolean,
    bot: Boolean,
    metadata: Object // Extra context
});

// Indexes for fast lookup
threatLogSchema.index({ ip: 1, timestamp: -1 });
threatLogSchema.index({ reason: 1 });
threatLogSchema.index({ fingerprint: 1 });

const ThreatLog = mongoose.model('ThreatLog', threatLogSchema);

// Log + Console Warn
async function logThreat(data) {
    try {
        if (!data.ip) {
            console.error("[⚠️ LOG ERROR] Missing IP in threat log");
            return;
        }

        const logEntry = new ThreatLog(data);
        await logEntry.save();

        // Pretty console output
        console.warn(`🛡️ [THREAT] ${data.reason.toUpperCase()} → IP: ${data.ip} | UA: ${data.userAgent?.substring(0, 30)}... | ${new Date().toISOString()}`);
    } catch (err) {
        console.error("❌ [MONGO LOG FAILED]", err.message);
    }
}

module.exports = { ThreatLog, logThreat };
