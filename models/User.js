const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    discordId: { type: String, default: null },
    verifyCode: { type: String, index: true },
    verifyCodeExpiresAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
