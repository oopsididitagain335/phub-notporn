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
    sparse: true  // ← Allows multiple nulls
  },
  linkCode: {
    type: String,
    unique: true,
    sparse: true  // ← Allows multiple nulls
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
