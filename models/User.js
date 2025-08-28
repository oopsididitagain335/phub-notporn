// models/User.js
const mongoose = require('mongoose');
const validator = require('validator');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 32,
    match: [/^[a-zA-Z0-9_]+$/, 'Invalid username']
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: [validator.isEmail, 'Invalid email']
  },
  passwordHash: {
    type: String,
    required: true
  },
  linkCode: {
    type: String,
    default: null,
    unique: true,       // Ensures generated codes are unique
    sparse: true,       // ✅ Allows multiple users with linkCode = null
    index: true         // Faster lookups when validating codes
  },
  discordId: {
    type: String,
    default: null,
    unique: true,
    sparse: true,       // ✅ Only enforces uniqueness for non-null values
    index: true
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// 🔁 Drop and recreate indexes (optional, only needed once)
// Run this once after deploy if issues persist:
// UserSchema.index({ discordId: 1 }, { unique: true, sparse: true });
// UserSchema.index({ linkCode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', UserSchema);
