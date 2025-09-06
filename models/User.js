// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  discordId: { type: String, unique: true, sparse: true },
  linkCode: { type: String, unique: true, sparse: true }, // ← sparse = true is critical
  isBanned: { type: Boolean, default: false },
  banReason: { type: String }
}, { timestamps: true });

// ✅ Auto-generate linkCode ONLY for new users who don't have one
userSchema.pre('save', async function(next) {
  if (this.isNew && !this.linkCode) {
    let attempts = 0;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const code = Array.from({ length: 8 }, () => 
        chars[Math.floor(Math.random() * chars.length)]
      ).join('');

      const existing = await this.constructor.findOne({ linkCode: code });
      if (!existing) {
        this.linkCode = code;
        return next();
      }
      attempts++;
    }

    // Fallback (practically impossible)
    this.linkCode = Date.now().toString(36).toUpperCase().slice(-8);
    console.warn(`⚠️  Fallback linkCode used: ${this.linkCode}`);
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
