// commands/link.js

const { SlashCommandBuilder } = require('discord.js');
const User = require('../models/User');

module.exports = {
  data: new SlashCommandBuilder()
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
      console.log('⚠️ Interaction already handled, skipping...');
      return;
    }

    // ✅ 2. Defer immediately
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      // 🚫 If defer fails (e.g., unknown interaction), log and exit
      console.error('❌ Failed to defer reply:', err.message);
      return;
    }

    const code = interaction.options.getString('code').toUpperCase();

    try {
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

      // ✅ Link account
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
          content: '❌ An error occurred while linking your account.'
        });
      }
    }
  }
};
