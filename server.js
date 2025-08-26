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

// Sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
  })
);

// Auth Helper
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// Routes

// Signup Page
app.get('/', (req, res) => {
  res.render('signup');
});

// Signup POST
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  // Validate inputs
  if (!username || !email || !password) {
    return res.render('signup', { error: 'All fields required' });
  }

  // Check if user already exists
  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    return res.render('signup', { error: 'Username or email already taken' });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);
  const linkCode = Math.random().toString(36).substring(2, 10).toUpperCase();

  // Create user
  const user = await User.create({ username, email, passwordHash, linkCode });

  // Set session
  req.session.userId = user._id;
  req.session.user = user;

  // Redirect to dashboard
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
    return res.render('login', { error: 'Invalid username/email or password' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.render('login', { error: 'Invalid username/email or password' });
  }

  req.session.userId = user._id;
  req.session.user = user;
  res.redirect('/dashboard');
});

// Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('dashboard', { user });
});

// Logout
app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Start Bot
startBot();

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
