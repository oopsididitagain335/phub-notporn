// security/antiVpn.js
// Detects and blocks banned users trying to return via VPN/proxy
// Uses IP + Fingerprint correlation

const crypto = require('crypto');
const { logThreat } = require('../models/logging');

// In-memory ban lists (replace with Redis in production)
const BANNED_IPS = new Set();
const BANNED_FINGERPRINTS = new Set();

// Generate device/browser fingerprint from request
function generateFingerprint(req) {
    const headers = req.headers;
    const values = [
        headers['user-agent'] || '',
        headers['accept-language'] || '',
        headers['accept-encoding'] || '',
        headers['sec-ch-ua'] || '',
        req.clientIp || '',
        process.env.JWT_SECRET // Salt
    ].join('|');

    return crypto.createHash('sha256').update(values).digest('hex').substring(0, 32);
}

// Basic IP validator (extend with IPQS or other APIs)
function isPrivateIp(ip) {
    return /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|127\.|169\.254\.)/.test(ip);
}

// Core VPN/Ban Evasion Detector
async function detectVpnOrBanEvasion(req, res, next) {
    const ip = req.clientIp;
    const fingerprint = generateFingerprint(req);

    // Skip private IPs (internal traffic)
    if (isPrivateIp(ip)) {
        req.fingerprint = fingerprint;
        return next();
    }

    // Check if banned
    if (BANNED_IPS.has(ip) || BANNED_FINGERPRINTS.has(fingerprint)) {
        await logThreat({
            ip,
            fingerprint,
            userAgent: req.get('User-Agent'),
            reason: 'ban_evasion',
            actionTaken: 'blocked',
            endpoint: req.path,
            headers: req.headers
        });

        // Redirect to invalid domain (silent bot trap)
        return res.redirect(302, "http://trap.pulsehub.invalid-domain.fake/");
    }

    // Optional: Integrate external threat intel (e.g., IPQualityScore)
    // Uncomment and configure if you have API key
    /*
    try {
        const response = await fetch(
            `https://ipqualityscore.com/api/json/ip/${process.env.IPQS_API_KEY}/${ip}?strictness=1&fast=1`
        );
        const data = await response.json();
        
        if (data.success && (data.vpn || data.tor || data.fraud_score > 85)) {
            await logThreat({
                ip,
                fingerprint,
                userAgent: req.get('User-Agent'),
                reason: 'vpn_proxy',
                actionTaken: 'redirected',
                endpoint: req.path,
                headers: req.headers,
                vpnScore: data.fraud_score,
                tor: data.tor,
                bot: data.bot_status
            });

            return res.redirect(302, "http://honeypot.pulsehub.fake/ddos-trap");
        }
    } catch (error) {
        console.error("IPQS Check Failed:", error.message);
    }
    */

    req.fingerprint = fingerprint;
    next();
}

// Utility: Ban IP + Fingerprint
function banUser(ip, fingerprint, reason = 'manual_ban') {
    BANNED_IPS.add(ip);
    BANNED_FINGERPRINTS.add(fingerprint);

    console.log(`⛔ [BAN ISSUED] IP: ${ip} | Fingerprint: ${fingerprint} | Reason: ${reason}`);
}

module.exports = {
    detectVpnOrBanEvasion,
    generateFingerprint,
    banUser,
    BANNED_IPS,
    BANNED_FINGERPRINTS
};
