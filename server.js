// server.js
// PulseHub main server — Express + Mongoose + secure defaults + Discord bot starter
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const { nanoid } = require('nanoid');

const security = require('./middleware/security');
const { validateUsername, validatePassword, sanitize } = require('./middleware/validators');
const User = require('./models/User');
const { startBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;
const MEMBER_LIMIT = parseInt(process.env.MEMBER_LIMIT || '50', 10);

// --------------------
// Database
// --------------------
mongoose.set('strictQuery', true);
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((e) => {
    console.error('Mongo connection error', e);
    process.exit(1);
  });

// --------------------
// Security & middleware
// --------------------
security(app); // helmet, rate-limiting, trust proxy
app.use(morgan('combined'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Sessions (Mongo-backed)
app.use(
  session({
    name: 'ph.sid',
    secret: process.env.SESSION_SECRET || 'change_this_in_production',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI, ttl: 60 * 60 * 24 * 7 }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

// Views & static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// CSRF (after session)
const csrfProtection = csrf({ cookie: false });

// --------------------
// Helpers
// --------------------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/');
  next();
}

async function getCounts() {
  const total = await User.countDocuments();
  return { total, remaining: Math.max(MEMBER_LIMIT - total, 0) };
}

// --------------------
// Routes
// --------------------

// Home / signup gate
app.get('/', csrfProtection, async (req, res) => {
  const { total, remaining } = await getCounts();

  // If still below limit and user not logged in -> show signup page
  if (total < MEMBER_LIMIT && !req.session.userId) {
    return res.render('signup', {
      csrfToken: req.csrfToken(),
      total,
      remaining,
      memberLimit: MEMBER_LIMIT,
      message: `PulseHub is locked. ${remaining} spots left before launch!`
    });
  }

  // Otherwise show index (open or for logged-in users)
  const user = req.session.userId ? await User.findById(req.session.userId).lean() : null;
  return res.render('index', { user, total, memberLimit: MEMBER_LIMIT });
});

// Signup
app.post('/signup', csrfProtection, async (req, res) => {
  try {
    const username = sanitize(req.body.username);
    const password = req.body.password;

    const { total } = await getCounts();
    if (total >= MEMBER_LIMIT) return res.status(403).send('Signups closed – limit reached.');

    if (!validateUsername(username)) {
      return res.status(400).send('Invalid username. Use 3–32 letters, numbers, underscores.');
    }
    if (!validatePassword(password)) {
      return res.status(400).send('Password must be 8+ chars incl. upper, lower, number.');
    }

    const existing = await User.findOne({ username });
    if (existing) return res.status(409).send('Username already taken.');

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyCode = nanoid(8).toUpperCase();
    const verifyCodeExpiresAt = new Date(Date.now() + 1000 * 60 * 10); // 10 minutes

    const user = await User.create({ username, passwordHash, verifyCode, verifyCodeExpiresAt });
    req.session.userId = user._id.toString();
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).send('Server error. Try again later.');
  }
});

// Dashboard (shows link code)
app.get('/dashboard', requireAuth, csrfProtection, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.redirect('/');

    // Rotate expired codes automatically
    let { verifyCode, verifyCodeExpiresAt } = user;
    if (!verifyCode || !verifyCodeExpiresAt || verifyCodeExpiresAt < new Date()) {
      verifyCode = nanoid(8).toUpperCase();
      verifyCodeExpiresAt = new Date(Date.now() + 1000 * 60 * 10);
      await User.findByIdAndUpdate(user._id, { verifyCode, verifyCodeExpiresAt });
    }

    res.render('dashboard', {
      user,
      code: verifyCode,
      codeExpiresAt: verifyCodeExpiresAt,
      csrfToken: req.csrfToken()
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Server error. Try again later.');
  }
});

// Logout
app.post('/logout', requireAuth, csrfProtection, async (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Healthcheck
app.get('/_health', (req, res) => res.json({ ok: true, env: process.env.NODE_ENV || 'development' }));

// --------------------
// Start bot & server
// --------------------
startBot(); // starts the Discord bot from bot.js

app.listen(PORT, () => console.log(`✅ PulseHub listening on :${PORT}`));
