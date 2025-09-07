// security/antiAdblock.js — ENHANCED VERSION

const { logThreat } = require('../models/logging');

function getAntiAdblockScript() {
    return `
    (function() {
        // Multiple bait elements
        const baitElements = [
            { class: 'pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads', style: 'width: 300px; height: 250px;' },
            { class: 'ad-banner', style: 'width: 728px; height: 90px;' },
            { class: 'google-auto-placed ap_container', style: 'width: 100px; height: 100px;' },
            { id: 'div-gpt-ad-1234567890123-0', style: 'width: 300px; height: 600px;' }
        ];

        baitElements.forEach(bait => {
            const el = document.createElement('div');
            if (bait.class) el.className = bait.class;
            if (bait.id) el.id = bait.id;
            el.style.cssText = bait.style + ' position: absolute; left: -10000px; top: -10000px;';

            // Add fake ad content
            el.innerHTML = '<div class="adsbygoogle" style="display:inline-block;width:300px;height:250px" data-ad-client="ca-pub-1234567890123456"></div>';

            document.body.appendChild(el);

            // Check after 1.5s
            setTimeout(() => {
                if (el.offsetHeight === 0 || el.offsetParent === null || window.getComputedStyle(el).display === 'none') {
                    triggerAdblock();
                    document.body.removeChild(el);
                } else {
                    document.body.removeChild(el);
                }
            }, 1500);
        });

        function triggerAdblock() {
            fetch('/api/report-adblock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: window.location.href,
                    userAgent: navigator.userAgent
                })
            }).catch(() => {});

            // Create overlay
            if (document.getElementById('ph-adblock-wall')) return;

            const overlay = document.createElement('div');
            overlay.id = 'ph-adblock-wall';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.95);color:white;z-index:2147483647;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;font-family:Arial,sans-serif;padding:20px;';
            overlay.innerHTML = \`
                <h2 style="color:#ff4d4d">⛔ Ad Blocker Detected</h2>
                <p>PulseHub is ad-supported. Please disable your ad blocker to continue.</p>
                <p>Refresh the page after disabling.</p>
                <button onclick="document.getElementById('ph-adblock-wall').remove(); alert('Please actually disable your ad blocker. This page will not function properly until you do.');" style="margin-top:20px;padding:10px 20px;background:#ff4d4d;color:white;border:none;border-radius:4px;cursor:pointer;">I Disabled It</button>
                <small style="margin-top:30px;color:#aaa">Repeated violations may result in IP ban.</small>
            \`;
            document.body.appendChild(overlay);

            // Prevent scrolling
            document.body.style.overflow = 'hidden';
        }
    })();
    `;
}

async function handleAdblockReport(req, res) {
    await logThreat({
        ip: req.clientIp,
        fingerprint: req.fingerprint || 'unknown',
        userAgent: req.body.userAgent || req.get('User-Agent'),
        reason: 'adblock_detected',
        actionTaken: 'logged',
        endpoint: '/api/report-adblock',
        meta: { reportedUrl: req.body.url }
    });

    res.json({ status: 'reported' });
}

module.exports = { getAntiAdblockScript, handleAdblockReport };
