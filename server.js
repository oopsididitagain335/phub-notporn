// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const { startBot } = require('./bot');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

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
  ttl: 86400 // 24 hours
});

// Session Config
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret_dev_secret_change_in_prod',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 // 24h
    }
  })
);

// Global Error Logging
process.on('unhandledRejection', (err) => {
  console.error('🚨 Unhandled Rejection:', err.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('🚨 Uncaught Exception:', err.message || err);
  process.exit(1);
});

// Auth Middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

// Ban Check Middleware
async function checkBan(req, res, next) {
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      if (!user) {
        req.session.destroy();
        return res.redirect('/login');
      }
      if (user.isBanned) {
        req.session.destroy();
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
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message || err);
  process.exit(1);
});

// Generate Unique Link Code
async function generateUniqueLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  let exists;
  do {
    code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    exists = await User.findOne({ linkCode: code });
  } while (exists);
  return code;
}

// Routes

app.get('/', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    res.render('index', { totalUsers });
  } catch (err) {
    console.error('Landing page error:', err);
    res.status(500).send('<h1>❌ Server Error</h1><p>Please try again later.</p>');
  }
});

app.get('/signup', (req, res) => {
  res.render('signup', { error: null });
});

app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.render('signup', { error: 'All fields are required.' });
  }

  try {
    const existing = await User.findOne({
      $or: [
        { username: new RegExp(`^${username}$`, 'i') },
        { email: new RegExp(`^${email}$`, 'i') }
      ]
    });

    if (existing) {
      return res.render('signup', { error: 'Username or email already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const linkCode = await generateUniqueLinkCode();

    const user = await User.create({ username, email, passwordHash, linkCode });

    req.session.userId = user._id;
    req.session.user = { username: user.username, discordId: user.discordId };

    res.redirect('/link');
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).send('<h1>❌ Server Error</h1><p>Failed to create account. Try again.</p>');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password) {
    return res.render('login', { error: 'All fields required.' });
  }

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${usernameOrEmail}$`, 'i') },
        { email: new RegExp(`^${usernameOrEmail}$`, 'i') }
      ]
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.render('login', { error: 'Invalid credentials.' });
    }

    if (user.isBanned) {
      return res.status(403).send(`
        <h1>🚫 Banned</h1>
        <p>${user.banReason || 'You have been banned.'}</p>
        <a href="/login">Try Again</a>
      `);
    }

    req.session.userId = user._id;
    req.session.user = { username: user.username, discordId: user.discordId };

    res.redirect(user.discordId ? '/home' : '/link');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('<h1>❌ Server Error</h1><p>Please try again.</p>');
  }
});

app.get('/link', requireAuth, checkBan, async (req, res) => {
  const user = res.locals.user;
  if (user.discordId) return res.redirect('/home');

  res.render('link', {
    username: user.username,
    linkCode: user.linkCode,
    inviteUrl: 'https://discord.gg/MmDs5ees4S'
  });
});

app.get('/home', requireAuth, checkBan, async (req, res) => {
  const user = res.locals.user;
  if (!user.discordId) return res.redirect('/link');

  try {
    const totalUsers = await User.countDocuments();
    res.render('home', { user, totalUsers });
  } catch (err) {
    console.error('Home error:', err);
    res.status(500).send('<h1>❌ Failed to load home</h1><a href="/link">Try Again</a>');
  }
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).render('404', { message: 'Page not found.' });
});

// 500 Handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send(`
    <h1>❌ Server Error</h1>
    <p>An unexpected error occurred.</p>
    <pre>${err.message}</pre>
  `);
});

// Start Discord Bot
startBot().catch(err => {
  console.error('❌ Failed to start bot:', err);
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`👉 Open http://localhost:${PORT}`);
  }
});
