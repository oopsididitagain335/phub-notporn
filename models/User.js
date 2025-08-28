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
    // Only enforces uniqueness if value exists (not null)
    unique: true,
    sparse: true,
    // Optional: faster lookups when validating codes
    index: true
  },
  discordId: {
    type: String,
    default: null,
    // Only one Discord ID per user, but many can be unlinked
    unique: true,
    sparse: true,
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

// 🔁 This model definition tells Mongoose to create sparse indexes
// But you still need to drop old indexes once (see server.js fix)

module.exports = mongoose.model('User', UserSchema);
