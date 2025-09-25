require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const { startBot } = require('./bot');
const User = require('./models/User'); // ✅ Now safe

// ✅ SECURITY MODULES
const security = require('./security');
const { logThreat } = require('./models/logging');

const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Validate env vars (email vars removed)
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

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  collectionName: 'sessions',
  ttl: 86400
});
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24
  }
}));

// Blocked page
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

// Security middleware
app.use(security.antiDdos);
app.use(security.antiVpn);
app.use(security.antiScrape);
app.use('/api/*', security.apiRateLimiter);
app.post('/api/report-adblock', security.handleAdblockReport);

// Auth middleware
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

// 🚀 START SERVER AFTER DB CONNECTION
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(async () => {
  console.log('✅ MongoDB connected');

  // Indexes
  try {
    const indexes = [
      { key: { discordId: 1 }, options: { unique: true, sparse: true, name: 'discordId_1' } },
      { key: { linkCode: 1 }, options: { unique: true, sparse: true, name: 'linkCode_1' } },
      { key: { username: 1 }, options: { unique: true, collation: { locale: 'en', strength: 2 }, name: 'username_1' } },
      { key: { email: 1 }, options: { unique: true, collation: { locale: 'en', strength: 2 }, name: 'email_1' } }
    ];

    for (const { key, options } of indexes) {
      await User.collection.createIndex(key, options);
    }
    console.log('✅ All indexes created');
  } catch (err) {
    console.error('Index setup error:', err);
  }

  // Fix null linkCode
  const nullUsers = await User.find({ linkCode: null });
  for (const user of nullUsers) {
    try {
      const code = await User.generateUniqueLinkCode();
      await User.updateOne({ _id: user._id }, { $set: { linkCode: code } });
    } catch (e) {
      console.error(`Failed to fix user ${user.username}:`, e.message);
    }
  }

  // Scripts
  const devtoolsDetectionScript = `
  <script>
    let devtools = { open: false, orientation: null };
    const threshold = 160;
    setInterval(() => {
      if (window.outerHeight - window.innerHeight > threshold || 
          window.outerWidth - window.innerWidth > threshold) {
        if (!devtools.open) {
          devtools.open = true;
          window.location.href = 'https://tenor.com/knyHIfWEcPr.gif';
        }
      } else {
        devtools.open = false;
      }
    }, 500);
    let el = new Image();
    Object.defineProperty(el, 'id', { get() { window.location.href = 'https://tenor.com/knyHIfWEcPr.gif'; } });
    console.log(el);
  </script>`;

  const antiAdblockScript = `<script>${security.getAntiAdblockScript()}</script>`;

  // Health check
  app.get('/health', async (req, res) => {
    const start = Date.now();
    const health = {
      status: 'OK',
      service: 'PulseHub',
      uptime: formatUptime(process.uptime()),
      database: '✅ Online',
      totalUsers: await User.countDocuments(),
      security: {
        antiScraping: '✅ Active',
        antiVpn: '✅ Active',
        antiDdos: '✅ Active',
        antiAdblock: '✅ Active'
      },
      responseTimeMs: Date.now() - start
    };
    res.json(health);
  });

  function formatUptime(s) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${d}d ${h}h ${m}m ${sec}s`;
  }

  // Routes
  app.get('/', async (req, res) => {
    res.render('index', {
      totalUsers: await User.countDocuments(),
      devtoolsDetectionScript,
      antiAdblockScript
    });
  });

  app.get('/signup', (req, res) => {
    res.render('signup', { error: null, devtoolsDetectionScript, antiAdblockScript });
  });

  // ✅ SIGNUP WITHOUT EMAIL VERIFICATION
  app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.render('signup', { error: 'All fields required.', devtoolsDetectionScript, antiAdblockScript });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (cleanUsername.length < 3 || cleanUsername.length > 30) {
      return res.render('signup', { error: 'Username must be 3–30 characters.', devtoolsDetectionScript, antiAdblockScript });
    }
    if (cleanPassword.length < 6) {
      return res.render('signup', { error: 'Password must be at least 6 characters.', devtoolsDetectionScript, antiAdblockScript });
    }
    if (!/^[\w.-]+$/.test(cleanUsername)) {
      return res.render('signup', { error: 'Username can only contain letters, numbers, _, ., and -', devtoolsDetectionScript, antiAdblockScript });
    }
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      return res.render('signup', { error: 'Please enter a valid email.', devtoolsDetectionScript, antiAdblockScript });
    }

    try {
      // ✅ THIS IS SAFE NOW — User is a valid model
      const existing = await User.findOne({
        $or: [
          { username: new RegExp(`^${cleanUsername}$`, 'i') },
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

      const hash = await bcrypt.hash(cleanPassword, 12);
      const user = new User({ // ✅ Use `new User()` for clarity
        username: cleanUsername,
        email: cleanEmail,
        passwordHash: hash
      });
      await user.save();

      req.session.userId = user._id;
      res.redirect('/link'); // ✅ Go straight to Discord linking

    } catch (err) {
      console.error('Signup error:', err);
      res.status(500).send('<h1>❌ Server Error</h1><p>Failed to create account.</p>');
    }
  });

  app.get('/login', (req, res) => {
    res.render('login', { error: null, devtoolsDetectionScript, antiAdblockScript });
  });

  // ✅ LOGIN WITHOUT EMAIL CHECK
  app.post('/login', async (req, res) => {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password) {
      return res.render('login', { error: 'All fields required.', devtoolsDetectionScript, antiAdblockScript });
    }

    try {
      const input = usernameOrEmail.trim();
      const user = await User.findOne({
        $or: [
          { username: new RegExp(`^${input}$`, 'i') },
          { email: new RegExp(`^${input}$`, 'i') }
        ]
      });

      if (!user || !(await bcrypt.compare(password.trim(), user.passwordHash))) {
        return res.render('login', { error: 'Invalid credentials.', devtoolsDetectionScript, antiAdblockScript });
      }

      if (user.isBanned) {
        return res.status(403).send('🚫 You are banned.');
      }

      req.session.userId = user._id;
      res.redirect(user.discordId ? '/home' : '/link');

    } catch (err) {
      console.error('Login error:', err);
      res.status(500).send('<h1>❌ Server Error</h1><p>Please try again.</p>');
    }
  });

  app.get('/link', requireAuth, checkBan, async (req, res) => {
    const user = res.locals.user;
    if (user.discordId) return res.redirect('/home');

    if (!user.linkCode) {
      user.linkCode = await User.generateUniqueLinkCode();
      await user.save();
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
    if (!user.discordId) return res.redirect('/link');
    res.render('home', {
      user,
      totalUsers: await User.countDocuments(),
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

  // Dynamic routes
  const viewsPath = path.join(__dirname, 'views');
  const existingRoutes = ['/', '/signup', '/login', '/link', '/home', '/logout'];

  try {
    const files = fs.readdirSync(viewsPath);
    files.forEach(file => {
      if (file.endsWith('.ejs') && !file.startsWith('_')) {
        const route = '/' + file.slice(0, -4);
        if (existingRoutes.includes(route)) return;

        app.get(route, async (req, res) => {
          const data = {
            devtoolsDetectionScript,
            antiAdblockScript,
            companyName: process.env.COMPANY_NAME || 'PulseHub',
            websiteUrl: process.env.WEBSITE_URL || 'pulsehub.space',
            // ... other env vars ...
          };

          if (req.session?.userId) {
            try {
              const user = await User.findById(req.session.userId);
              if (user && !user.isBanned) data.user = user;
            } catch (e) {
              console.warn('User fetch error:', e.message);
            }
          }

          res.render(file.slice(0, -4), data);
        });
      }
    });
  } catch (err) {
    console.error('Views scan error:', err);
  }

  // 404
  app.use((req, res) => {
    res.status(404).send('<h1>🔍 Page Not Found</h1><a href="/">← Home</a>');
  });

  // Start bot & server
  startBot().catch(err => console.error('Bot error:', err));
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`✅ Health: http://localhost:${PORT}/health`);
  });

})
.catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  process.exit(1);
});
