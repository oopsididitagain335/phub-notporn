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
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Enable in HTTPS
      maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
  })
);

// Auth Middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// Ban Check Middleware (if user is banned, show ban page)
async function checkBan(req, res, next) {
  if (req.session.userId) {
    const user = await User.findById(req.session.userId);
    if (user?.isBanned) {
      req.session.destroy(); // Optional: destroy session
      return res.render('ban', { banReason: user.banReason || 'Violated community rules.' });
    }
  }
  next();
}

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
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
  const linkCode = Math.random().toString(36).substring(2, 10).toUpperCase();

  const user = await User.create({ username, email, passwordHash, linkCode });

  req.session.userId = user._id;
  req.session.user = user;

  res.redirect('/dashboard');
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
    return res.render('login', { error: 'Invalid username/email or password.' });
  }

  // 👇 Check if banned before password check
  if (user.isBanned) {
    return res.render('ban', { banReason: user.banReason || 'You have been banned from this service.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.render('login', { error: 'Invalid username/email or password.' });
  }

  req.session.userId = user._id;
  req.session.user = user;

  res.redirect('/dashboard');
});

// Dashboard (protected + ban check)
app.get('/dashboard', requireAuth, checkBan, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('dashboard', { user });
});

// Optional: Regenerate link code
app.post('/api/generate-link-code', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId);
  user.linkCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  await user.save();
  res.json({ linkCode: user.linkCode });
});

// Logout
app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.redirect('/dashboard');
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// 404 for undefined routes
app.use((req, res) => {
  res.status(404).render('404', { message: 'Page not found.' });
});

// Start Discord Bot
startBot();

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
