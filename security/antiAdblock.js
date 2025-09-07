// security/antiAdblock.js
// Server-side delivery of anti-adblock script

const { logThreat } = require('../models/logging');

// Returns the client-side anti-adblock script as string
function getAntiAdblockScript() {
    return `
    (function() {
        // Create bait element
        const bait = document.createElement('div');
        bait.className = 'adsbox pub_300x250 text-ad';
        bait.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px;top:-9999px;';
        document.body.appendChild(bait);

        setTimeout(() => {
            if (bait.offsetHeight === 0 || bait.offsetParent === null) {
                // Adblock detected
                fetch('/api/report-adblock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: window.location.href,
                        userAgent: navigator.userAgent
                    })
                }).catch(() => {});

                // Show full-page overlay
                const overlay = document.createElement('div');
                overlay.id = 'ph-adblock-wall';
                overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.95);color:white;z-index:2147483647;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;font-family:Arial,sans-serif;padding:20px;';
                overlay.innerHTML = \`
                    <h2 style="color:#ff4d4d">⛔ Ad Blocker Detected</h2>
                    <p>PulseHub is ad-supported. Please disable your ad blocker.</p>
                    <p>Refresh after disabling.</p>
                    <button onclick="document.getElementById('ph-adblock-wall').remove(); alert('You must actually disable your ad blocker.');" style="margin-top:20px;padding:10px 20px;background:#ff4d4d;color:white;border:none;border-radius:4px;cursor:pointer;">I Disabled It (Test)</button>
                    <small style="margin-top:30px;color:#aaa">Repeated violations may result in a permanent ban.</small>
                \`;
                document.body.appendChild(overlay);
            } else {
                document.body.removeChild(bait);
            }
        }, 1200);
    })();
    `;
}

// Middleware to log adblock reports
async function handleAdblockReport(req, res) {
    await logThreat({
        ip: req.clientIp,
        fingerprint: req.fingerprint || 'unknown',
        userAgent: req.body.userAgent || req.get('User-Agent'),
        reason: 'adblock_detected',
        actionTaken: 'logged',
        endpoint: '/api/report-adblock',
        metadata: { reportedUrl: req.body.url }
    });

    res.json({ status: 'reported' });
}

module.exports = { getAntiAdblockScript, handleAdblockReport };
