// commands/reset-password.js
const { SlashCommandBuilder } = require('discord.js');
const bcrypt = require('bcrypt');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset-password')
    .setDescription('Reset your PulseHub account password (linked accounts only)')
    .addStringOption((option) =>
      option
        .setName('new_password')
        .setDescription('Choose a new password (min 6 characters)')
        .setRequired(true)
        .setMinLength(6)
    ),

  async execute(interaction) {
    if (interaction.replied || interaction.deferred) return;

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.error('Defer failed:', err);
      return;
    }

    const userId = interaction.user.id;
    const newPassword = interaction.options.getString('new_password').trim();

    // Validate password
    if (newPassword.length < 6) {
      return await interaction.editReply({
        content: '❌ Password must be at least 6 characters long.',
      });
    }

    try {
      const User = require('../models/User');
      const dbUser = await User.findOne({ discordId: userId });

      if (!dbUser) {
        return await interaction.editReply({
          content: '❌ Your Discord account is not linked to a PulseHub account.\n\nUse your link code in the server to link first.',
        });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, 12);
      dbUser.passwordHash = passwordHash;
      await dbUser.save();

      console.log(`✅ Password reset via command: ${dbUser.username} (${userId})`);

      return await interaction.editReply({
        content: '✅ Your PulseHub password has been successfully reset!\n\nYou can now log in with your new password.',
      });
    } catch (err) {
      console.error('Reset password error:', err);
      await interaction.editReply({
        content: '❌ A server error occurred. Please try again later.',
      }).catch(console.error);
    }
  },
};
