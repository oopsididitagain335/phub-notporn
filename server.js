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
  ttl: 86400
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret_dev_secret_change_in_prod',
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
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(async () => {
  console.log('✅ MongoDB connected');

  // Recreate indexes safely
  try {
    await User.collection.dropIndex('discordId_1').catch(() => {});
    await User.collection.dropIndex('linkCode_1').catch(() => {});
    await User.collection.dropIndex('username_1').catch(() => {});

    await User.collection.createIndex({ discordId: 1 }, { unique: true, sparse: true });
    await User.collection.createIndex({ linkCode: 1 }, { unique: true, sparse: false }); // ❗ No nulls allowed
    await User.collection.createIndex({ username: 1 }, { 
      unique: true, 
      collation: { locale: 'en', strength: 2 } // ✅ Case-insensitive uniqueness
    });

    console.log('✅ Indexes recreated: discordId (sparse), linkCode (strict unique), username (case-insensitive)');

    // ✅ FIX EXISTING NULL linkCodes
    const usersWithNullLinkCode = await User.find({ linkCode: null });
    for (const user of usersWithNullLinkCode) {
      const newLinkCode = await generateUniqueLinkCode();
      await User.updateOne(
        { _id: user._id },
        { $set: { linkCode: newLinkCode } }
      );
      console.log(`✅ Fixed user ${user.username}: assigned linkCode ${newLinkCode}`);
    }
    if (usersWithNullLinkCode.length > 0) {
      console.log(`🛠️  Fixed ${usersWithNullLinkCode.length} users with null linkCode`);
    }

  } catch (err) {
    console.error('❌ Index recreation failed:', err);
  }
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});

// Generate Unique Link Code — NEVER returns null
async function generateUniqueLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code, exists;
  do {
    code = Array(8).fill(null)
      .map(() => chars[Math.floor(Math.random() * chars.length)])
      .join('');
    exists = await User.findOne({ linkCode: code });
  } while (exists);

  if (!code || code.length !== 8) {
    throw new Error('Failed to generate valid link code');
  }

  return code; // ✅ Guaranteed 8-char, non-null string
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

  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password.trim();

  // Validation
  if (cleanUsername.length < 3 || cleanUsername.length > 30) {
    return res.render('signup', { error: 'Username must be 3–30 characters.' });
  }
  if (cleanPassword.length < 6) {
    return res.render('signup', { error: 'Password must be at least 6 characters.' });
  }
  if (!/^[\w.-]+$/.test(cleanUsername)) {
    return res.render('signup', { error: 'Username can only contain letters, numbers, _, ., and -' });
  }
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    return res.render('signup', { error: 'Please enter a valid email.' });
  }

  try {
    // ✅ Normalize username for case-insensitive comparison
    const normalizedUsername = cleanUsername.toLowerCase();

    const existing = await User.findOne({
      $or: [
        { username: { $regex: new RegExp(`^${cleanUsername}$`, 'i') } },
        { email: cleanEmail }
      ]
    });

    if (existing) {
      return res.render('signup', { 
        error: existing.username.toLowerCase() === normalizedUsername 
          ? 'Username already taken.' 
          : 'Email already in use.' 
      });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 12);
    const linkCode = await generateUniqueLinkCode(); // ✅ Guaranteed non-null

    const user = await User.create({
      username: cleanUsername, // Store original casing
      email: cleanEmail,
      passwordHash,
      linkCode // ✅ Never null
    });

    req.session.userId = user._id;
    req.session.user = { username: user.username };

    res.redirect('/link');
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).send('<h1>❌ Server Error</h1><p>Failed to create account.</p>');
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
    const cleanInput = usernameOrEmail.trim();
    const user = await User.findOne({
      $or: [
        { username: { $regex: new RegExp(`^${cleanInput}$`, 'i') } },
        { email: new RegExp(`^${cleanInput}$`, 'i') }
      ]
    });

    if (!user || !(await bcrypt.compare(password.trim(), user.passwordHash))) {
      return res.render('login', { error: 'Invalid credentials.' });
    }

    if (user.isBanned) {
      return res.status(403).send('🚫 You are banned.');
    }

    req.session.userId = user._id;
    req.session.user = { username: user.username };

    res.redirect(user.discordId ? '/home' : '/link');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('<h1>❌ Server Error</h1><p>Please try again.</p>');
  }
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

app.get('/home', requireAuth, checkBan, async (req, res) => {
  const user = res.locals.user;
  if (!user.discordId) return res.redirect('/link');
  const totalUsers = await User.countDocuments();
  res.render('home', { user, totalUsers });
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// 404
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
