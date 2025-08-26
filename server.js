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

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 } // 24 hours
  })
);

// Auth Middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// Ban Check Middleware
async function checkBan(req, res, next) {
  if (req.session.userId) {
    const user = await User.findById(req.session.userId);
    if (user?.isBanned) {
      req.session.destroy();
      return res.render('ban', { banReason: user.banReason || 'Banned from service.' });
    }
    res.locals.user = user; // Make available in templates
  }
  next();
}

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Routes

// Signup Page
app.get('/', (req, res) => {
  res.render('signup');
});

// Signup POST
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.render('signup', { error: 'All fields are required.' });
  }

  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    return res.render('signup', { error: 'Username or email already taken.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const linkCode = Math.random().toString(36).substring(2, 10).toUpperCase(); // e.g., K7M2X9LP

  const user = await User.create({ username, email, passwordHash, linkCode });

  req.session.userId = user._id;
  req.session.user = user;

  // Redirect to link step
  res.redirect('/link');
});

// Login Page
app.get('/login', (req, res) => {
  res.render('login');
});

// Login POST
app.post('/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  const user = await User.findOne({
    $or: [{ username: usernameOrEmail }, { email: usernameOrEmail }]
  });

  if (!user) {
    return res.render('login', { error: 'Invalid username or email.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.render('login', { error: 'Incorrect password.' });
  }

  if (user.isBanned) {
    return res.render('ban', { banReason: user.banReason || 'You have been banned.' });
  }

  req.session.userId = user._id;
  req.session.user = user;

  // Redirect based on link status
  if (user.discordId) {
    res.redirect('/home');
  } else {
    res.redirect('/link');
  }
});

// Link Page – Show real code once
app.get('/link', requireAuth, checkBan, async (req, res) => {
  const user = res.locals.user;
  if (user.discordId) return res.redirect('/home'); // Already linked

  res.render('link', {
    username: user.username,
    linkCode: user.linkCode, // ✅ Show real code
    inviteUrl: 'https://discord.gg/MmDs5ees4S'
  });
});

// Home Page – Only after linking
app.get('/home', requireAuth, checkBan, (req, res) => {
  const user = res.locals.user;
  if (!user.discordId) return res.redirect('/link'); // Not linked yet

  res.render('home', { user });
});

// Logout
app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// 404
app.use((req, res) => {
  res.status(404).render('404', { message: 'Page not found.' });
});

// Start Discord Bot
startBot();

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
