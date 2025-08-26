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
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'],
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: validator.isEmail,
      message: 'Invalid email address'
    },
    index: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  linkCode: {
    type: String,
    default: null,
    unique: true,
    sparse: true, // Allows multiple nulls, enforces uniqueness when not null
    index: true
  },
  discordId: {
    type: String,
    default: null,
    unique: true,
    sparse: true,
    index: true
  },
  isBanned: {
    type: Boolean,
    default: false,
    index: true
  },
  banReason: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false // we use createdAt manually, but you can enable if needed
});

// Optional: Add a compound index if querying by multiple fields often
// UserSchema.index({ discordId: 1, isBanned: 1 });

// Optional: Pre-save hook to auto-generate linkCode if needed
UserSchema.pre('save', function (next) {
  if (!this.linkCode && !this.isBanned) {
    this.linkCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  }
  next();
});

// Remove linkCode before returning user object (security)
UserSchema.methods.toJSON = function () {
  const user = this._doc;
  delete user.passwordHash;
  delete user.linkCode; // don't expose link code unless needed
  return user;
};

module.exports = mongoose.model('User', UserSchema);
