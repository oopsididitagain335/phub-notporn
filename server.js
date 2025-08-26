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

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
  })
);

// Auth Middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// Ban Check
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

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Routes

// Signup
app.get('/', (req, res) => {
  res.render('signup');
});

app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.render('signup', { error: 'All fields required.' });
  }

  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    return res.render('signup', { error: 'Username or email taken.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const linkCode = Math.random().toString(36).substring(2, 10).toUpperCase();

  const user = await User.create({ username, email, passwordHash, linkCode });

  req.session.userId = user._id;
  req.session.user = user;

  // Redirect to link step
  res.redirect('/link');
});

// Login
app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  const user = await User.findOne({
    $or: [{ username: usernameOrEmail }, { email: usernameOrEmail }]
  });

  if (!user || (await bcrypt.compare(password, user.passwordHash)) === false) {
    return res.render('login', { error: 'Invalid credentials.' });
  }

  if (user.isBanned) {
    return res.render('ban', { banReason: user.banReason });
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

// Link Page (never shows the code)
app.get('/link', requireAuth, checkBan, async (req, res) => {
  const user = res.locals.user;
  if (user.discordId) return res.redirect('/home'); // Already linked

  res.render('link', {
    username: user.username,
    inviteUrl: 'https://discord.gg/MmDs5ees4S'
  });
});

// Home Page (only after linking)
app.get('/home', requireAuth, checkBan, (req, res) => {
  const user = res.locals.user;
  if (!user.discordId) return res.redirect('/link'); // Not linked yet

  res.render('home', { user });
});

// Logout
app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// 404
app.use((req, res) => {
  res.status(404).render('404', { message: 'Page not found.' });
});

// Start Bot
startBot();

// Listen
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
