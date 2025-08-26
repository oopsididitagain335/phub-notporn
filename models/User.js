const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  linkCode: { type: String, required: true },
  discordId: { type: String, default: null }
});

module.exports = mongoose.model('User', UserSchema);
