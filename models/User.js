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
    // ✅ Removed unique: true to allow multiple nulls
    // We handle uniqueness in code with generateUniqueLinkCode()
    index: true // Optional: for faster lookup when validating codes
  },
  discordId: {
    type: String,
    default: null,
    unique: true,
    sparse: true, // ✅ Only one Discord ID per user
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

module.exports = mongoose.model('User', UserSchema);
