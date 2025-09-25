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
    sparse: true
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String
  }
}, { timestamps: true });

// Generate unique link code
userSchema.statics.generateUniqueLinkCode = async function() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code, exists;
  let attempts = 0;
  const maxAttempts = 50;

  do {
    code = Array.from({ length: 8 }, () => 
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    exists = await this.findOne({ linkCode: code });
    attempts++;
    if (attempts > maxAttempts) {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 10).toUpperCase();
      code = (timestamp + random).slice(0, 8);
      break;
    }
  } while (exists);

  return code;
};

// Auto-generate linkCode on save
userSchema.pre('save', async function(next) {
  if (this.isNew && !this.linkCode) {
    try {
      this.linkCode = await this.constructor.generateUniqueLinkCode();
    } catch (err) {
      return next(new Error('Failed to generate unique link code'));
    }
  }
  next();
});

// ✅ CORRECT EXPORT — THIS IS CRITICAL
module.exports = mongoose.model('User', userSchema);
