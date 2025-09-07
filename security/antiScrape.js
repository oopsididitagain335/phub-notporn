// security/antiScrape.js — ENHANCED VERSION

const { logThreat } = require('../models/logging');

function detectAutomation(req, res, next) {
    const ua = req.get('User-Agent') || '';
    const headers = req.headers;

    // STRONGER HEADLESS DETECTION
    const headlessIndicators = [
        'HeadlessChrome',
        'PhantomJS',
        'Selenium',
        'Puppeteer',
        'Playwright',
        'Cypress',
        'SlimerJS',
        'Java',
        'Python-urllib',
        'scrapy',
        'curl/',
        'wget/',
        'Go-http-client'
    ];

    const isKnownBot = headlessIndicators.some(bot => ua.includes(bot));

    // Check for missing browser headers
    const missingRealHeaders = !headers['sec-ch-ua'] && 
                              !headers['sec-ch-ua-mobile'] && 
                              !headers['sec-ch-ua-platform'];

    // Check for automation flags
    const isAutomated = headers['webdriver'] === 'true' || 
                       headers['x-puppeteer'] || 
                       headers['x-playwright'] ||
                       headers['x-selenium'];

    // Check for suspicious viewport headers
    const hasSuspiciousViewport = headers['viewport-width'] === '0' || 
                                 headers['viewport-height'] === '0';

    const isSuspicious = isKnownBot || 
                        missingRealHeaders || 
                        isAutomated || 
                        hasSuspiciousViewport;

    if (isSuspicious) {
        logThreat({
            ip: req.clientIp,
            fingerprint: req.fingerprint || 'unknown',
            userAgent: ua,
            reason: 'headless_browser',
            actionTaken: 'blocked',
            endpoint: req.path,
            headers: headers,
            meta: { 
                isKnownBot, 
                missingRealHeaders, 
                isAutomated, 
                hasSuspiciousViewport 
            }
        });

        // REDIRECT TO INVALID DOMAIN (silent to user, breaks bots)
        return res.redirect(302, "http://scrapers-trap.invalid.pulsehub.space/");
    }

    next();
}

module.exports = { detectAutomation };
