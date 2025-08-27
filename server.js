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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGO_URI,
  collection: 'sessions',
  ttl: 86400
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { httpOnly: true, secure: false, maxAge: 86400000 }
  })
);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

async function checkBan(req, res, next) {
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      if (!user) {
        req.session.destroy();
        return res.redirect('/');
      }
      if (user.isBanned) {
        req.session.destroy();
        return res.render('ban', { banReason: user.banReason || 'Banned.' });
      }
      res.locals.user = user;
    } catch (err) {
      return res.status(500).render('500', { message: 'Server error.' });
    }
  }
  next();
}

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB error:', err));

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

app.get('/', (req, res) => {
  res.render('signup', { error: null });
});

app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.render('signup', { error: 'All fields required.' });
  }

  const existing = await User.findOne({
    $or: [
      { username: new RegExp(`^${username}$`, 'i') },
      { email: new RegExp(`^${email}$`, 'i') }
    ]
  });

  if (existing) {
    return res.render('signup', { error: 'Username or email taken.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const linkCode = await generateUniqueLinkCode();

  const user = await User.create({ username, email, passwordHash, linkCode });

  req.session.userId = user._id;
  req.session.user = { username: user.username, discordId: user.discordId };

  res.redirect('/link');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password) {
    return res.render('login', { error: 'All fields required.' });
  }

  const user = await User.findOne({
    $or: [
      { username: new RegExp(`^${usernameOrEmail}$`, 'i') },
      { email: new RegExp(`^${usernameOrEmail}$`, 'i') }
    ]
  });

  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    return res.render('login', { error: 'Invalid credentials.' });
  }

  if (user.isBanned) {
    return res.render('ban', { banReason: user.banReason });
  }

  req.session.userId = user._id;
  req.session.user = { username: user.username, discordId: user.discordId };

  res.redirect(user.discordId ? '/home' : '/link');
});

app.get('/link', requireAuth, checkBan, (req, res) => {
  const user = res.locals.user;
  if (user.discordId) return res.redirect('/home');

  res.render('link', {
    username: user.username,
    linkCode: user.linkCode,
    inviteUrl: 'https://discord.gg/MmDs5ees4S'
  });
});

app.get('/home', requireAuth, checkBan, (req, res) => {
  const user = res.locals.user;
  if (!user.discordId) return res.redirect('/link');
  res.render('home', { user });
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

app.use((req, res) => {
  res.status(404).render('404', { message: 'Not found.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500', { message: 'Server error.' });
});

startBot().catch(err => console.error('❌ Bot failed:', err));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
