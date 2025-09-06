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

// MongoDB Connection with Enhanced Error Handling
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(async () => {
  console.log('✅ MongoDB connected');

  // Recreate indexes safely
  try {
    await User.collection.dropIndex('discordId_1').catch(() => {});
    await User.collection.dropIndex('linkCode_1').catch(() => {});
    await User.collection.dropIndex('username_1').catch(() => {});

    await User.collection.createIndex({ discordId: 1 }, { unique: true, sparse: true });
    await User.collection.createIndex({ linkCode: 1 }, { unique: true, sparse: true });
    await User.collection.createIndex({ username: 1 }, { 
      unique: true, 
      collation: { locale: 'en', strength: 2 }
    });

    console.log('✅ Indexes recreated');

    // FIX ALL EXISTING NULL linkCodes - CRITICAL FIX
    console.log('🛠️  Checking for users with null linkCode...');
    
    const nullUsers = await User.find({ linkCode: null });
    console.log(`Found ${nullUsers.length} users with null linkCode`);
    
    for (const user of nullUsers) {
      try {
        // Generate new unique code using the static method
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
    console.error('❌ Index recreation or migration error:', err);
  }
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});

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
          : 'Email already in use.'
      });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 12);

    // Create user with automatic linkCode generation
    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash
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

app.get('/link', requireAuth, checkBan, async (req, res) => {
  const user = res.locals.user;

  if (user.discordId) {
    return res.redirect('/home');
  }

  // Ensure user has a linkCode using atomic operation
  if (!user.linkCode) {
    try {
      // Use atomic update to prevent race conditions
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id, linkCode: { $exists: false } },
        { $set: { linkCode: await User.generateUniqueLinkCode() } },
        { new: true, runValidators: true }
      );
      
      if (updatedUser) {
        user.linkCode = updatedUser.linkCode;
        console.log(`🆕 Generated linkCode for ${user.username}: ${user.linkCode}`);
      } else {
        // If another process already set it, fetch the existing one
        const freshUser = await User.findById(user._id);
        user.linkCode = freshUser.linkCode;
      }
    } catch (err) {
      console.error('Failed to generate linkCode:', err);
      // Fallback to direct generation
      user.linkCode = await User.generateUniqueLinkCode();
    }
  }

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
