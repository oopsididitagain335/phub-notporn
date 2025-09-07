// security/antiScrape.js
// Detects headless browsers, automation tools, rapid behavior

const { logThreat } = require('../models/logging');

function detectAutomation(req, res, next) {
    const ua = req.get('User-Agent') || '';
    const headers = req.headers;

    const automationSignatures = [
        'HeadlessChrome',
        'PhantomJS',
        'Selenium',
        'Puppeteer',
        'Cypress',
        'Playwright'
    ];

    const isHeadless = automationSignatures.some(sig => ua.includes(sig)) ||
                      headers['webdriver'] === 'true' ||
                      headers['x-puppeteer'] ||
                      !headers['accept-language'] ||
                      headers['headless'] === '1';

    const isSuspicious = headers['x-scraper'] ||
                         ua.includes('Python-urllib') ||
                         ua.includes('scrapy') ||
                         ua.includes('curl') && !ua.includes('Chrome');

    if (isHeadless || isSuspicious) {
        logThreat({
            ip: req.clientIp,
            fingerprint: req.fingerprint || 'unknown',
            userAgent: ua,
            reason: 'headless_browser',
            actionTaken: 'blocked',
            endpoint: req.path,
            headers: headers,
            metadata: { isHeadless, isSuspicious }
        });

        return res.status(403).json({
            error: "Automated access detected. Access denied.",
            code: "AUTOMATION_BLOCKED"
        });
    }

    next();
}

module.exports = { detectAutomation };
