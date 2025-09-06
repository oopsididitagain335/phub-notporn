require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { startBot } = require('./bot');
const User = require('./models/User');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 5000;

// Validate environment variables
const requiredEnvVars = ['MONGO_URI', 'SESSION_SECRET', 'EMAIL_USER', 'EMAIL_APP_PASSWORD', 'DISCORD_TOKEN'];
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

// Auth Middleware
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

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(async () => {
    console.log('✅ MongoDB connected');

    // Manage indexes robustly
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

      // Fix users with null linkCode
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

    // --- ✅ DYNAMIC EJS ROUTES ---
    const viewsPath = path.join(__dirname, 'views');
    const existingRoutes = [
      '/', '/signup', '/login', '/link', '/home',
      '/verify-email', '/logout', '/verify-email-sent'
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
                companyName: 'pulsehub'
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
    // --- ✅ END DYNAMIC EJS ROUTES ---

    // Email transporter setup
    let transporter;
    try {
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_APP_PASSWORD
        }
      });
      transporter.verify((error, success) => {
        if (error) {
          console.error('❌ Email transport configuration error:', error);
        } else {
          console.log('✅ Email transport is ready');
        }
      });
    } catch (error) {
      console.error('❌ Failed to create email transporter:', error);
      transporter = null;
    }

    // Send verification email
    async function sendVerificationEmail(email, verificationToken) {
      if (!transporter) {
        console.error('❌ Email transporter not configured');
        return false;
      }
      const verificationUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/verify-email?token=${verificationToken}`;
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Verify Your Email Address',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px; border-radius: 8px;">
            <h2 style="color: #333;">Welcome to PulseHub!</h2>
            <p>Hello,</p>
            <p>To complete your registration, please verify your email address by clicking the button below:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}"
                 style="background: #6d9eeb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Verify Email Address
              </a>
            </div>
            <p>If the button above doesn't work, copy and paste this link in your browser:</p>
            <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
            <p>This link will expire in 24 hours.</p>
            <p>Best regards,<br>The PulseHub Team</p>
          </div>
        `
      };
      try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Verification email sent to ${email}`);
        return true;
      } catch (error) {
        console.error('❌ Failed to send verification email:', error);
        return false;
      }
    }

    // DevTools detection script
    const devtoolsDetectionScript = `
    <script>
      // DevTools detection
      let devtools = {
        open: false,
        orientation: null
      };
      
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

    // Routes
    app.get('/', async (req, res) => {
      try {
        const totalUsers = await User.countDocuments();
        res.render('index', { totalUsers, devtoolsDetectionScript });
      } catch (err) {
        console.error('Landing page error:', err);
        res.status(500).send('<h1>❌ Server Error</h1><p>Please try again later.</p>');
      }
    });

    app.get('/signup', (req, res) => {
      res.render('signup', { error: null, devtoolsDetectionScript });
    });

    app.post('/signup', async (req, res) => {
      const { username, email, password } = req.body;
      if (!username || !email || !password) {
        return res.render('signup', { error: 'All fields are required.', devtoolsDetectionScript });
      }
      const cleanUsername = username.trim();
      const cleanEmail = email.trim().toLowerCase();
      const cleanPassword = password.trim();
      if (cleanUsername.length < 3 || cleanUsername.length > 30) {
        return res.render('signup', { error: 'Username must be 3–30 characters.', devtoolsDetectionScript });
      }
      if (cleanPassword.length < 6) {
        return res.render('signup', { error: 'Password must be at least 6 characters.', devtoolsDetectionScript });
      }
      if (!/^[\w.-]+$/.test(cleanUsername)) {
        return res.render('signup', { error: 'Username can only contain letters, numbers, _, ., and -', devtoolsDetectionScript });
      }
      if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
        return res.render('signup', { error: 'Please enter a valid email.', devtoolsDetectionScript });
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
            devtoolsDetectionScript
          });
        }
        const passwordHash = await bcrypt.hash(cleanPassword, 12);
        const verificationToken = require('crypto').randomBytes(32).toString('hex');
        const user = await User.create({
          username: cleanUsername,
          email: cleanEmail,
          passwordHash,
          emailVerified: false,
          verificationToken: verificationToken
        });
        const emailSent = await sendVerificationEmail(cleanEmail, verificationToken);
        if (emailSent) {
          req.session.userId = user._id;
          req.session.user = { username: user.username };
          res.render('verify-email-sent', {
            email: cleanEmail,
            success: true,
            error: null,
            devtoolsDetectionScript
          });
        } else {
          await User.deleteOne({ _id: user._id });
          res.render('signup', { error: 'Failed to send verification email. Please try again.', devtoolsDetectionScript });
        }
      } catch (err) {
        console.error('Signup error:', err);
        res.status(500).send('<h1>❌ Server Error</h1><p>Failed to create account.</p>');
      }
    });

    app.get('/verify-email', async (req, res) => {
      const { token } = req.query;
      if (!token) {
        return res.render('verify-email', {
          error: 'Invalid verification link',
          success: false,
          devtoolsDetectionScript
        });
      }
      try {
        const user = await User.findOne({
          verificationToken: token,
          emailVerified: false
        });
        if (!user) {
          return res.render('verify-email', {
            error: 'Invalid or expired verification token',
            success: false,
            devtoolsDetectionScript
          });
        }
        const tokenAge = Date.now() - new Date(user.createdAt).getTime();
        const maxAge = 24 * 60 * 60 * 1000;
        if (tokenAge > maxAge) {
          await User.deleteOne({ _id: user._id });
          return res.render('verify-email', {
            error: 'Verification token has expired. Please sign up again.',
            success: false,
            devtoolsDetectionScript
          });
        }
        await User.findByIdAndUpdate(user._id, {
          emailVerified: true,
          verificationToken: undefined
        });
        res.render('verify-email', {
          success: true,
          error: null,
          message: 'Email verified successfully!',
          devtoolsDetectionScript
        });
      } catch (err) {
        console.error('Email verification error:', err);
        res.render('verify-email', {
          error: 'An error occurred during verification',
          success: false,
          devtoolsDetectionScript
        });
      }
    });

    app.get('/login', (req, res) => {
      res.render('login', { error: null, devtoolsDetectionScript });
    });

    app.post('/login', async (req, res) => {
      const { usernameOrEmail, password } = req.body;
      if (!usernameOrEmail || !password) {
        return res.render('login', { error: 'All fields required.', devtoolsDetectionScript });
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
          return res.render('login', { error: 'Invalid credentials.', devtoolsDetectionScript });
        }
        if (user.isBanned) {
          return res.status(403).send('🚫 You are banned.');
        }
        if (!user.emailVerified) {
          return res.render('login', {
            error: 'Please verify your email address before logging in.',
            devtoolsDetectionScript
          });
        }
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
        devtoolsDetectionScript
      });
    });

    app.get('/home', requireAuth, checkBan, async (req, res) => {
      const user = res.locals.user;
      if (!user.discordId) return res.redirect('/link');
      const totalUsers = await User.countDocuments();
      res.render('home', { user, totalUsers, devtoolsDetectionScript });
    });

    app.post('/logout', requireAuth, (req, res) => {
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
      });
    });

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
    });

  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
