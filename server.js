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
  collection: 'sessions',
  ttl: 1 * 24 * 60 * 60 // 1 day
});

// Session Configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Set to true if using HTTPS
      maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
  })
);

// Authentication Middleware
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
        return res.redirect('/');
      }

      if (user.isBanned) {
        req.session.destroy((err) => {
          if (err) console.error('Session destroy error on ban:', err);
        });
        return res.render('ban', {
          banReason: user.banReason || 'You have been banned from this service.'
        });
      }

      // Expose user in res.locals for templates
      res.locals.user = user;
    } catch (err) {
      console.error('Error in checkBan middleware:', err);
      return res.status(500).render('500', { message: 'Internal server error.' });
    }
  }
  next();
}

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Routes

// Home / Signup Page
app.get('/', (req, res) => {
  res.render('signup', { error: null });
});

// Signup POST
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.render('signup', { error: 'All fields are required.' });
  }

  try {
    const existing = await User.findOne({
      $or: [{ username: new RegExp(`^${username}$`, 'i') }, { email: new RegExp(`^${email}$`, 'i') }]
    });

    if (existing) {
      return res.render('signup', {
        error: 'Username or email already taken.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const linkCode = Math.random().toString(36).substring(2, 10).toUpperCase(); // 8 chars

    const user = await User.create({ username, email, passwordHash, linkCode });

    req.session.userId = user._id;
    req.session.user = {
      username: user.username,
      discordId: user.discordId
    };

    return res.redirect('/link');
  } catch (err) {
    console.error('Signup error:', err);
    return res.render('signup', {
      error: 'An internal error occurred. Please try again.'
    });
  }
});

// Login Page
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Login POST
app.post('/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  if (!usernameOrEmail || !password) {
    return res.render('login', { error: 'All fields are required.' });
  }

  try {
    const user = await User.findOne({
      $or: [
        { username: new RegExp(`^${usernameOrEmail}$`, 'i') },
        { email: new RegExp(`^${usernameOrEmail}$`, 'i') }
      ]
    });

    if (!user) {
      return res.render('login', { error: 'Invalid username or email.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.render('login', { error: 'Incorrect password.' });
    }

    if (user.isBanned) {
      return res.render('ban', {
        banReason: user.banReason || 'You have been banned from this service.'
      });
    }

    req.session.userId = user._id;
    req.session.user = {
      username: user.username,
      discordId: user.discordId
    };

    if (user.discordId) {
      return res.redirect('/home');
    } else {
      return res.redirect('/link');
    }
  } catch (err) {
    console.error('Login error:', err);
    return res.render('login', {
      error: 'An internal error occurred. Please try again.'
    });
  }
});

// Link Page (Show code to user)
app.get('/link', requireAuth, checkBan, async (req, res) => {
  const user = res.locals.user;

  if (!user) {
    return res.redirect('/login');
  }

  if (user.discordId) {
    return res.redirect('/home');
  }

  res.render('link', {
    username: user.username,
    linkCode: user.linkCode,
    inviteUrl: 'https://discord.gg/MmDs5ees4S'
  });
});

// Home Page (After linking)
app.get('/home', requireAuth, checkBan, (req, res) => {
  const user = res.locals.user;

  if (!user) {
    return res.redirect('/login');
  }

  if (!user.discordId) {
    return res.redirect('/link');
  }

  res.render('home', { user });
});

// Logout
app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.redirect('/home');
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).render('404', {
    message: 'The page you are looking for does not exist.'
  });
});

// 500 Handler (Optional – add if you have a 500.ejs)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('500', {
    message: 'Something went wrong on our end.'
  });
});

// Start Discord Bot
startBot().catch(err => {
  console.error('❌ Failed to start Discord bot:', err);
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`👉 Open http://localhost:${PORT}`);
  }
});
