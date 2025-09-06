// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  discordId: {
    type: String,
    unique: true,
    sparse: true
  },
  linkCode: {
    type: String,
    unique: true,
    sparse: true, // ← Keep for backward compatibility with old users
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String
  }
}, { timestamps: true });

// ✅ STEP 2: Auto-generate linkCode for NEW users
userSchema.pre('save', async function(next) {
  // Only run for new documents AND if linkCode is missing
  if (this.isNew && !this.linkCode) {
    let attempts = 0;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      // Generate 8-char code
      const code = Array.from({ length: 8 }, () => 
        chars[Math.floor(Math.random() * chars.length)]
      ).join('');

      // Check if code is already taken
      const existing = await this.constructor.findOne({ linkCode: code });
      if (!existing) {
        this.linkCode = code; // ✅ Assign unique code
        return next();
      }
      attempts++;
    }

    // 🆘 Fallback: use timestamp if all else fails (practically impossible)
    this.linkCode = Date.now().toString(36).toUpperCase().slice(-8);
    console.warn(`⚠️  Used fallback linkCode: ${this.linkCode}`);
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
