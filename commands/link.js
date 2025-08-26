// commands/link.js

const { SlashCommandBuilder } = require('discord.js');
const User = require('../models/User');

module.exports = {
   new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your PulseHub account to Discord')
    .addStringOption(option =>
      option.setName('code')
        .setDescription('Your link code from the website')
        .setRequired(true)
    ),

  async execute(interaction) {
    // ✅ 1. If already replied or deferred, do nothing
    if (interaction.replied || interaction.deferred) {
      console.warn(`[Link] Interaction already handled: ${interaction.id}`);
      return;
    }

    // ✅ 2. Defer immediately (within 3 seconds)
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.error('[Link] Failed to defer reply:', err.message);
      return; // Interaction likely expired
    }

    const code = interaction.options.getString('code').toUpperCase().trim();

    try {
      // ✅ 3. Find user by linkCode
      const user = await User.findOne({ linkCode: code });

      if (!user) {
        return await interaction.editReply({
          content: '❌ Invalid or expired link code. It may have already been used.'
        });
      }

      if (user.discordId) {
        return await interaction.editReply({
          content: '⚠️ This account has already been linked to a Discord user.'
        });
      }

      // ✅ 4. Link account
      user.discordId = interaction.user.id;
      user.linkCode = null;
      await user.save();

      return await interaction.editReply({
        content: '✅ Your PulseHub account has been successfully linked to Discord!\nYou can now access the website.'
      });

    } catch (err) {
      console.error('[Link] Error during execution:', err);

      // ✅ 5. Always try to respond
      if (!interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while linking. Please try again or contact support.'
        }).catch(() => {
          console.error('Could not send error reply');
        });
      }
    }
  }
};
