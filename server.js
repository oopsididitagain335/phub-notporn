require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
// ❌ REMOVED: nodemailer (no email verification)
const { startBot } = require('./bot');
const User = require('./models/User');

// ✅ IMPORT SECURITY MODULES
const security = require('./security'); // security/index.js
const { logThreat } = require('./models/logging');

const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Validate environment variables
// ⚠️ You can now optionally remove EMAIL_USER & EMAIL_APP_PASSWORD if not used elsewhere
const requiredEnvVars = ['MONGO_URI', 'SESSION_SECRET', 'DISCORD_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// EJS Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session Store
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  collectionName: 'sessions',
  ttl: 86400
});
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

// ========== ✅ BLOCKED PAGE ROUTE ==========
app.get('/blocked', (req, res) => {
    res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Access Denied</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px; background: #111; color: #fff;">
            <h1 style="color: #ff4d4d;">🚫 Access Denied</h1>
            <p>Automated access or suspicious behavior detected.</p>
            <p>This action has been logged.</p>
            <p style="margin-top: 30px; font-size: 14px; color: #aaa;">
                Contact support if you believe this is an error.
            </p>
        </body>
        </html>
    `);
});

// ========== ✅ APPLY SECURITY MIDDLEWARE ==========
app.use(security.antiDdos);
app.use(security.antiVpn);
app.use(security.antiScrape);
app.use('/api/*', security.apiRateLimiter);
app.post('/api/report-adblock', security.handleAdblockReport);

// ========== AUTH MIDDLEWARE ==========
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

async function checkBan(req, res, next) {
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      if (!user) {
        req.session.destroy(() => {});
        return res.redirect('/login');
      }
      if (user.isBanned) {
        await logThreat({
          ip: req.clientIp || 'unknown',
          fingerprint: req.fingerprint || 'unknown',
          userAgent: req.get('User-Agent'),
          reason: 'ban_evasion',
          actionTaken: 'blocked',
          endpoint: req.path,
          meta: { userId: user._id.toString(), username: user.username }
        });
        req.session.destroy(() => {});
        return res.status(403).send(`
          <h1>🚫 You Are Banned</h1>
          <p>${user.banReason || 'You have been banned from this service.'}</p>
          <a href="/login">← Login</a>
        `);
      }
      res.locals.user = user;
    } catch (err) {
      console.error('Ban check error:', err);
      return res.status(500).send('<h1>❌ Server Error</h1><p>Please try again later.</p>');
    }
  }
  next();
}

// ========== MONGODB CONNECTION ==========
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(async () => {
    console.log('✅ MongoDB connected');

    // Manage indexes (unchanged)
    try {
      console.log('🛠️ Ensuring indexes...');
      const desiredIndexes = [
        { key: { discordId: 1 }, options: { unique: true, sparse: true, name: 'discordId_1', background: true } },
        { key: { linkCode: 1 }, options: { unique: true, sparse: true, name: 'linkCode_1', background: true } },
        { key: { username: 1 }, options: { unique: true, collation: { locale: 'en', strength: 2 }, name: 'username_1', background: true } },
        { key: { email: 1 }, options: { unique: true, collation: { locale: 'en', strength: 2 }, name: 'email_1', background: true } }
      ];

      for (const { key, options } of desiredIndexes) {
        const indexName = options.name;
        try {
          const existingIndexes = await User.collection.indexes();
          const existingIndex = existingIndexes.find(idx => idx.name === indexName);

          if (existingIndex) {
            const matches = existingIndex.unique === options.unique &&
                            (existingIndex.sparse === options.sparse || !options.sparse) &&
                            JSON.stringify(existingIndex.collation || {}) === JSON.stringify(options.collation || {}) &&
                            (existingIndex.background === (options.background ?? true));
            if (!matches) {
              console.log(`🛠️ Updating index: ${indexName}`);
              try {
                await User.collection.dropIndex(indexName);
                console.log(`✅ Dropped outdated index: ${indexName}`);
              } catch (dropErr) {
                if (dropErr.codeName !== 'IndexNotFound') {
                  console.error(`⚠️ Error dropping index ${indexName}:`, dropErr.message);
                }
              }
              await User.collection.createIndex(key, options);
              console.log(`✅ Created updated index: ${indexName}`);
            } else {
              console.log(`✅ Index ${indexName} is up-to-date`);
            }
          } else {
            await User.collection.createIndex(key, options);
            console.log(`✅ Created new index: ${indexName}`);
          }
        } catch (err) {
          if (err.code === 86 && err.codeName === 'IndexKeySpecsConflict') {
            console.log(`⚠️ Index ${indexName} conflict detected, forcing update...`);
            try {
              await User.collection.dropIndex(indexName);
              await User.collection.createIndex(key, options);
              console.log(`✅ Resolved conflict for index: ${indexName}`);
            } catch (resolveErr) {
              console.error(`❌ Failed to resolve index ${indexName}:`, resolveErr.message);
            }
          } else {
            console.error(`❌ Error ensuring index ${indexName}:`, err.message);
          }
        }
      }
      console.log('✅ All indexes verified and updated');

      // Fix null linkCode (unchanged)
      console.log('🛠️ Checking for users with null linkCode...');
      const nullUsers = await User.find({ linkCode: null });
      console.log(`Found ${nullUsers.length} users with null linkCode`);
      for (const user of nullUsers) {
        try {
          const newCode = await User.generateUniqueLinkCode();
          await User.updateOne(
            { _id: user._id },
            { $set: { linkCode: newCode } }
          );
          console.log(`✅ Fixed user ${user.username}: assigned linkCode ${newCode}`);
        } catch (updateErr) {
          console.error(`❌ Failed to fix user ${user.username}:`, updateErr.message);
        }
      }
      console.log('✅ Legacy null linkCode users processed');
    } catch (err) {
      console.error('❌ Index management error:', err);
    }

    // ❌ REMOVED: nodemailer setup & sendVerificationEmail function

    // DevTools detection script (unchanged)
    const devtoolsDetectionScript = `
    <script>
      let devtools = { open: false, orientation: null };
      const threshold = 160;
      setInterval(() => {
        if (window.outerHeight - window.innerHeight > threshold || 
            window.outerWidth - window.innerWidth > threshold) {
          if (!devtools.open) {
            devtools.open = true;
            devtools.orientation = window.outerHeight - window.innerHeight > threshold ? 'vertical' : 'horizontal';
            window.location.href = 'https://tenor.com/knyHIfWEcPr.gif';
          }
        } else {
          devtools.open = false;
          devtools.orientation = null;
        }
      }, 500);
      let element = new Image();
      Object.defineProperty(element, 'id', {
        get: function() {
          window.location.href = 'https://tenor.com/knyHIfWEcPr.gif';
        }
      });
      console.log(element);
    </script>
    `;

    const antiAdblockScript = `<script>${security.getAntiAdblockScript()}</script>`;

    // ========== HEALTH CHECK ==========
    app.get('/health', async (req, res) => {
        const startTime = Date.now();
        const healthData = {
            status: 'OK',
            service: 'PulseHub',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            serverTime: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }),
            uptime: formatUptime(process.uptime()),
            lastRestart: new Date(Date.now() - (process.uptime() * 1000)).toLocaleString('en-GB', {
                timeZone: 'Europe/London',
                hour12: false
            })
        };

        try {
            await mongoose.connection.db.admin().ping();
            healthData.databaseConnectivity = '✅ Online';
        } catch (err) {
            healthData.databaseConnectivity = '❌ Offline';
            healthData.status = 'DEGRADED';
        }

        try {
            healthData.totalUsers = await User.countDocuments();
        } catch (err) {
            healthData.totalUsers = -1;
            healthData.status = 'DEGRADED';
        }

        healthData.securitySystems = {
            antiScraping: '✅ Active',
            antiVpnBanEvasion: '✅ Active',
            antiDdosProtection: '✅ Active',
            antiAdblock: '✅ Active'
        };

        healthData.responseTimeMs = Date.now() - startTime;
        const statusCode = healthData.status === 'OK' ? 200 : 503;
        res.status(statusCode).json(healthData);
    });

    function formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${days}d ${hours}h ${minutes}m ${secs}s`;
    }

    // ========== ROUTES ==========

    app.get('/', async (req, res) => {
      try {
        const totalUsers = await User.countDocuments();
        res.render('index', { 
          totalUsers, 
          devtoolsDetectionScript,
          antiAdblockScript
        });
      } catch (err) {
        console.error('Landing page error:', err);
        res.status(500).send('<h1>❌ Server Error</h1><p>Please try again later.</p>');
      }
    });

    app.get('/signup', (req, res) => {
      res.render('signup', { 
        error: null, 
        devtoolsDetectionScript,
        antiAdblockScript
      });
    });

    // ✅ UPDATED: Signup without email verification
    app.post('/signup', async (req, res) => {
      const { username, email, password } = req.body;
      if (!username || !email || !password) {
        return res.render('signup', { 
          error: 'All fields are required.', 
          devtoolsDetectionScript,
          antiAdblockScript
        });
      }
      const cleanUsername = username.trim();
      const cleanEmail = email.trim().toLowerCase();
      const cleanPassword = password.trim();
      if (cleanUsername.length < 3 || cleanUsername.length > 30) {
        return res.render('signup', { 
          error: 'Username must be 3–30 characters.', 
          devtoolsDetectionScript,
          antiAdblockScript
        });
      }
      if (cleanPassword.length < 6) {
        return res.render('signup', { 
          error: 'Password must be at least 6 characters.', 
          devtoolsDetectionScript,
          antiAdblockScript
        });
      }
      if (!/^[\w.-]+$/.test(cleanUsername)) {
        return res.render('signup', { 
          error: 'Username can only contain letters, numbers, _, ., and -', 
          devtoolsDetectionScript,
          antiAdblockScript
        });
      }
      if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return res.render('signup', { 
          error: 'Please enter a valid email.', 
          devtoolsDetectionScript,
          antiAdblockScript
        });
      }
      try {
        const existing = await User.findOne({
          $or: [
            { username: { $regex: new RegExp(`^${cleanUsername}$`, 'i') } },
            { email: cleanEmail }
          ]
        });
        if (existing) {
          return res.render('signup', {
            error: existing.username.toLowerCase() === cleanUsername.toLowerCase()
              ? 'Username already taken.'
              : 'Email already in use.',
            devtoolsDetectionScript,
            antiAdblockScript
          });
        }
        const passwordHash = await bcrypt.hash(cleanPassword, 12);
        // ✅ Create user WITHOUT email verification fields
        const user = await User.create({
          username: cleanUsername,
          email: cleanEmail,
          passwordHash
          // emailVerified & verificationToken REMOVED
        });

        req.session.userId = user._id;
        req.session.user = { username: user.username };
        // ✅ Redirect to Discord linking immediately
        res.redirect('/link');

      } catch (err) {
        console.error('Signup error:', err);
        res.status(500).send('<h1>❌ Server Error</h1><p>Failed to create account.</p>');
      }
    });

    // ❌ REMOVED: /verify-email route

    app.get('/login', (req, res) => {
      res.render('login', { 
        error: null, 
        devtoolsDetectionScript,
        antiAdblockScript
      });
    });

    // ✅ UPDATED: Login without email verification check
    app.post('/login', async (req, res) => {
      const { usernameOrEmail, password } = req.body;
      if (!usernameOrEmail || !password) {
        return res.render('login', { 
          error: 'All fields required.', 
          devtoolsDetectionScript,
          antiAdblockScript
        });
      }
      try {
        const cleanInput = usernameOrEmail.trim();
        const user = await User.findOne({
          $or: [
            { username: { $regex: new RegExp(`^${cleanInput}$`, 'i') } },
            { email: new RegExp(`^${cleanInput}$`, 'i') }
          ]
        });
        if (!user || !(await bcrypt.compare(password.trim(), user.passwordHash))) {
          return res.render('login', { 
            error: 'Invalid credentials.', 
            devtoolsDetectionScript,
            antiAdblockScript
          });
        }
        if (user.isBanned) {
          return res.status(403).send('🚫 You are banned.');
        }
        // ✅ NO email verification check here

        req.session.userId = user._id;
        req.session.user = { username: user.username };
        res.redirect(user.discordId ? '/home' : '/link');
      } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('<h1>❌ Server Error</h1><p>Please try again.</p>');
      }
    });

    app.get('/link', requireAuth, checkBan, async (req, res) => {
      const user = res.locals.user;
      if (user.discordId) {
        return res.redirect('/home');
      }
      if (!user.linkCode) {
        try {
          const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, linkCode: { $exists: false } },
            { $set: { linkCode: await User.generateUniqueLinkCode() } },
            { new: true, runValidators: true }
          );
          if (updatedUser) {
            user.linkCode = updatedUser.linkCode;
            console.log(`🆕 Generated linkCode for ${user.username}: ${user.linkCode}`);
          } else {
            const freshUser = await User.findById(user._id);
            user.linkCode = freshUser.linkCode;
          }
        } catch (err) {
          console.error('Failed to generate linkCode:', err);
          user.linkCode = await User.generateUniqueLinkCode();
        }
      }
      res.render('link', {
        username: user.username,
        linkCode: user.linkCode,
        inviteUrl: 'https://discord.gg/MmDs5ees4S',
        devtoolsDetectionScript,
        antiAdblockScript
      });
    });

    app.get('/home', requireAuth, checkBan, async (req, res) => {
      const user = res.locals.user;
      if (!user.discordId) return res.redirect('/link'); // ✅ Enforce Discord link
      const totalUsers = await User.countDocuments();
      res.render('home', { 
        user, 
        totalUsers, 
        devtoolsDetectionScript,
        antiAdblockScript
      });
    });

    app.post('/logout', requireAuth, (req, res) => {
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
      });
    });

    // ========== DYNAMIC EJS ROUTES ==========
    const viewsPath = path.join(__dirname, 'views');
    const existingRoutes = [
      '/', '/signup', '/login', '/link', '/home', '/logout'
      // ❌ Removed: '/verify-email', '/verify-email-sent'
    ];

    console.log('🔧 Scanning views directory for dynamic routes...');

    try {
      const files = fs.readdirSync(viewsPath);
      files.forEach(file => {
        if (file.endsWith('.ejs') && !file.startsWith('_')) {
          const routeName = '/' + file.slice(0, -4);

          if (existingRoutes.includes(routeName)) {
            console.log(`⚠️ Skipping ${routeName} — already manually defined.`);
            return;
          }

          app.get(routeName, async (req, res) => {
            try {
              const renderData = {
                devtoolsDetectionScript,
                antiAdblockScript,
                companyName: process.env.COMPANY_NAME || 'pulsehub',
                websiteUrl: process.env.WEBSITE_URL || 'pulsehub.space',
                lastUpdated: process.env.TOS_LAST_UPDATED || new Date().toISOString().slice(0, 10),
                companyEntity: process.env.COMPANY_ENTITY || 'PulseHub Inc',
                securityEmail: process.env.SECURITY_EMAIL || 'security@pulsehub.space',
                legalEmail: process.env.LEGAL_EMAIL || 'legal@pulsehub.space',
                supportEmail: process.env.SUPPORT_EMAIL || 'support@pulsehub.space',
                currencySymbol: process.env.CURRENCY_SYMBOL || '£',
                liabilityFloor: process.env.LIABILITY_FLOOR || '£100',
                liabilityFloorBusiness: process.env.LIABILITY_FLOOR_BUSINESS || '£5,000',
                indemnityCapBusiness: process.env.INDEMNITY_CAP_BUSINESS || '£25,000',
                governingLawRegion: process.env.GOVERNING_LAW_REGION || 'England and Wales',
                arbitrationProvider: process.env.ARBITRATION_PROVIDER || 'LCIA',
                consumerADR: process.env.CONSUMER_ADR || 'CMA approved ADR providers / CEDR'
              };

              if (req.session && req.session.userId) {
                try {
                  const user = await User.findById(req.session.userId);
                  if (user && !user.isBanned) {
                    renderData.user = user;
                  }
                } catch (err) {
                  console.warn('User fetch error in dynamic route:', err.message);
                }
              }

              res.render(file.slice(0, -4), renderData);
            } catch (err) {
              console.error(`❌ Failed to render ${file}:`, err);
              res.status(404).send('<h1>🔍 Page Not Found</h1><a href="/">← Home</a>');
            }
          });

          console.log(`✅ Registered dynamic route: ${routeName} → ${file}`);
        }
      });
    } catch (err) {
      console.error('❌ Failed to read views directory:', err);
    }

    // 404 Handler
    app.use((req, res) => {
      res.status(404).send('<h1>🔍 Page Not Found</h1><a href="/">← Home</a>');
    });

    // Start Discord Bot
    startBot().catch(err => console.error('❌ Bot failed to start:', err));

    // Start Server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`👉 Open http://localhost:${PORT}`);
      }
      console.log(`✅ Health check available at: http://localhost:${PORT}/health`);
      console.log(`✅ Blocked page at: http://localhost:${PORT}/blocked`);
    });

  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
