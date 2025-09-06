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
    sparse: true // Allow documents to not have this field
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String
  }
}, { timestamps: true });

// Generate unique link code with guaranteed uniqueness
userSchema.statics.generateUniqueLinkCode = async function() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars
  let code, exists;
  let attempts = 0;
  const maxAttempts = 50; // Increased limit for safety

  do {
    // Generate 8-character code
    code = Array.from({ length: 8 }, () => 
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    
    // Check if code exists in database
    exists = await this.findOne({ linkCode: code });
    attempts++;
    
    // Safety check to prevent infinite loop
    if (attempts > maxAttempts) {
      // Fallback: use timestamp + random
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 10).toUpperCase();
      code = (timestamp + random).slice(0, 8);
      break;
    }
  } while (exists);

  return code;
};

// Auto-generate linkCode for new users with atomic operation
userSchema.pre('save', async function(next) {
  // Only generate linkCode for new documents that don't have one
  if (this.isNew && !this.linkCode) {
    try {
      // Use the static method to generate unique code
      const uniqueCode = await this.constructor.generateUniqueLinkCode();
      this.linkCode = uniqueCode;
    } catch (err) {
      console.error('Failed to generate unique link code:', err);
      return next(new Error('Failed to generate unique link code'));
    }
  }
  next();
});

module.exports = mongoose.model('User', userSchema);// models/User.js
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
    sparse: true // Allow documents to not have this field
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String
  }
}, { timestamps: true });

// Generate unique link code with guaranteed uniqueness
userSchema.statics.generateUniqueLinkCode = async function() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars
  let code, exists;
  let attempts = 0;
  const maxAttempts = 50; // Increased limit for safety

  do {
    // Generate 8-character code
    code = Array.from({ length: 8 }, () => 
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    
    // Check if code exists in database
    exists = await this.findOne({ linkCode: code });
    attempts++;
    
    // Safety check to prevent infinite loop
    if (attempts > maxAttempts) {
      // Fallback: use timestamp + random
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 10).toUpperCase();
      code = (timestamp + random).slice(0, 8);
      break;
    }
  } while (exists);

  return code;
};

// Auto-generate linkCode for new users with atomic operation
userSchema.pre('save', async function(next) {
  // Only generate linkCode for new documents that don't have one
  if (this.isNew && !this.linkCode) {
    try {
      // Use the static method to generate unique code
      const uniqueCode = await this.constructor.generateUniqueLinkCode();
      this.linkCode = uniqueCode;
    } catch (err) {
      console.error('Failed to generate unique link code:', err);
      return next(new Error('Failed to generate unique link code'));
    }
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
