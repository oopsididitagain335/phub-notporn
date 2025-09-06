require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer'); // This should work correctly
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
    await User.collection.dropIndex('email_1').catch(() => {});

    await User.collection.createIndex({ discordId: 1 }, { unique: true, sparse: true });
    await User.collection.createIndex({ linkCode: 1 }, { unique: true, sparse: true });
    await User.collection.createIndex({ username: 1 }, { 
      unique: true, 
      collation: { locale: 'en', strength: 2 }
    });
    await User.collection.createIndex({ email: 1 }, { 
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

// Email transporter setup - FIXED VERSION
let transporter;
try {
  transporter = nodemailer.createTransporter({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD
    }
  });
  
  // Verify email configuration
  transporter.verify((error, success) => {
    if (error) {
      console.error('❌ Email transport configuration error:', error);
    } else {
      console.log('✅ Email transport is ready');
    }
  });
} catch (error) {
  console.error('❌ Failed to create email transporter:', error);
  transporter = null;
}

// Send verification email
async function sendVerificationEmail(email, verificationToken) {
  if (!transporter) {
    console.error('❌ Email transporter not configured');
    return false;
  }
  
  const verificationUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}`;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Verify Your Email Address',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px; border-radius: 8px;">
        <h2 style="color: #333;">Welcome to PulseHub!</h2>
        <p>Hello,</p>
        <p>To complete your registration, please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background: #6d9eeb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Verify Email Address
          </a>
        </div>
        <p>If the button above doesn't work, copy and paste this link in your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
        <p>Best regards,<br>The PulseHub Team</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Verification email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send verification email:', error);
    return false;
  }
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
    
    // Generate verification token
    const verificationToken = require('crypto').randomBytes(32).toString('hex');
    
    // Create user with unverified status
    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      emailVerified: false,
      verificationToken: verificationToken
    });

    // Send verification email
    const emailSent = await sendVerificationEmail(cleanEmail, verificationToken);
    
    if (emailSent) {
      req.session.userId = user._id;
      req.session.user = { username: user.username };
      
      res.render('verify-email-sent', { 
        email: cleanEmail,
        success: true,
        error: null
      });
    } else {
      // If email fails, delete the user and show error
      await User.deleteOne({ _id: user._id });
      res.render('signup', { error: 'Failed to send verification email. Please try again.' });
    }
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).send('<h1>❌ Server Error</h1><p>Failed to create account.</p>');
  }
});

app.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.render('verify-email', { 
      error: 'Invalid verification link',
      success: false 
    });
  }

  try {
    const user = await User.findOne({ 
      verificationToken: token,
      emailVerified: false 
    });

    if (!user) {
      return res.render('verify-email', { 
        error: 'Invalid or expired verification token',
        success: false 
      });
    }

    // Check if token is expired (24 hours)
    const tokenAge = Date.now() - new Date(user.createdAt).getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (tokenAge > maxAge) {
      await User.deleteOne({ _id: user._id });
      return res.render('verify-email', { 
        error: 'Verification token has expired. Please sign up again.',
        success: false 
      });
    }

    // Verify the email
    await User.findByIdAndUpdate(user._id, {
      emailVerified: true,
      verificationToken: undefined
    });

    res.render('verify-email', { 
      success: true,
      error: null,
      message: 'Email verified successfully!'
    });

  } catch (err) {
    console.error('Email verification error:', err);
    res.render('verify-email', { 
      error: 'An error occurred during verification',
      success: false 
    });
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

    // Check if email is verified
    if (!user.emailVerified) {
      return res.render('login', { 
        error: 'Please verify your email address before logging in.' 
      });
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
