// commands/reset-password.js
const { SlashCommandBuilder } = require('discord.js');
const bcrypt = require('bcrypt');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset-password')
    .setDescription('Reset your PulseHub account password using your link code')
    .addStringOption(option =>
      option
        .setName('code')
        .setDescription('Your 8-character link code (e.g., K7M2X9LP)')
        .setRequired(true)
        .setMinLength(8)
        .setMaxLength(8)
    )
    .addStringOption(option =>
      option
        .setName('new_password')
        .setDescription('Your new password (min 6 characters)')
        .setRequired(true)
        .setMinLength(6)
    ),

  async execute(interaction) {
    if (interaction.replied || interaction.deferred) return;

    // Only allow in DMs
    if (interaction.guild) {
      return await interaction.reply({
        content: '❌ Please use this command in **Direct Messages** (DMs) for security.',
        ephemeral: true
      });
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.error('Defer failed:', err);
      return;
    }

    const code = interaction.options.getString('code').trim().toUpperCase();
    const newPassword = interaction.options.getString('new_password');

    // Validate code format
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      return await interaction.editReply({
        content: `❌ Invalid code format. Must be 8 alphanumeric characters.\n\nYou entered: \`${code}\``
      });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return await interaction.editReply({
        content: '❌ Password must be at least 6 characters long.'
      });
    }

    try {
      const User = require('../models/User');
      const dbUser = await User.findOne({ linkCode: code });

      if (!dbUser) {
        return await interaction.editReply({
          content: '❌ Invalid or expired link code.'
        });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, 12);

      // Update password
      dbUser.passwordHash = passwordHash;
      await dbUser.save();

      console.log(`✅ Password reset for: ${dbUser.username}`);

      return await interaction.editReply({
        content: `✅ Success! Your password has been reset.\n\nYou can now log in with your username and new password at [PulseHub](https://yourdomain.com).`
      });
    } catch (err) {
      console.error('Reset password error:', err);
      await interaction.editReply({
        content: '❌ A server error occurred. Try again later.'
      }).catch(console.error);
    }
  }
};
