// commands/link.js

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your PulseHub account to Discord')
    .addStringOption(option =>
      option
        .setName('code')
        .setDescription('Your link code from the website')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Prevent double replies
    if (interaction.replied || interaction.deferred) {
      return console.warn('Interaction already handled:', interaction.id);
    }

    // Defer reply immediately
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.error('Failed to defer reply:', err.message);
      return;
    }

    const code = interaction.options.getString('code').toUpperCase().trim();

    try {
      // Dynamically require User to avoid circular issues
      const User = require('../models/User');
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

      // Link the account
      user.discordId = interaction.user.id;
      user.linkCode = null;
      await user.save();

      return await interaction.editReply({
        content: '✅ Your PulseHub account has been successfully linked to Discord!\nYou can now access the website.'
      });

    } catch (err) {
      console.error('Error in /link command:', err);
      if (!interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred. Please try again or contact support.'
        }).catch(console.error);
      }
    }
  }
};
