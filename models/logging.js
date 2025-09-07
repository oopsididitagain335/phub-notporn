// models/logging.js — MongoDB Logger for Dangerous IPs & Events

const mongoose = require('mongoose');

const threatLogSchema = new mongoose.Schema({
    ip: { type: String, required: true, index: true },
    userAgent: String,
    fingerprint: String,
    reason: { type: String, required: true },
    actionTaken: String, // 'blocked', 'redirected', 'captcha', 'logged'
    endpoint: String,
    timestamp: { type: Date, default: Date.now },
    headers: Object,
    geo: Object,
    vpnScore: Number,
    tor: Boolean,
    bot: Boolean
});

threatLogSchema.index({ ip: 1, timestamp: -1 });
threatLogSchema.index({ reason: 1 });

const ThreatLog = mongoose.model('ThreatLog', threatLogSchema);

// Log to MongoDB + Console
async function logThreat(data) {
    try {
        const logEntry = new ThreatLog(data);
        await logEntry.save();
        console.warn(`[🛡️ THREAT LOGGED] ${data.ip} | ${data.reason} | ${new Date().toISOString()}`);
    } catch (err) {
        console.error("Failed to log threat to MongoDB:", err.message);
    }
}

module.exports = { ThreatLog, logThreat };
