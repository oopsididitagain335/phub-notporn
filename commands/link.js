// commands/link.js

const { SlashCommandBuilder, ApplicationFlags } = require('discord.js');
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
    // ✅ Defer immediately to avoid timeout
    await interaction.deferReply({ ephemeral: true });

    const code = interaction.options.getString('code').toUpperCase();

    try {
      const user = await User.findOne({ linkCode: code });

      if (!user) {
        return interaction.editReply({
          content: '❌ Invalid or expired link code. It may have already been used.'
        });
      }

      if (user.discordId) {
        return interaction.editReply({
          content: '⚠️ This account has already been linked to a Discord user.'
        });
      }

      // ✅ Link account
      user.discordId = interaction.user.id;
      user.linkCode = null;
      await user.save();

      // ✅ Send final reply
      return interaction.editReply({
        content: '✅ Your PulseHub account has been successfully linked to Discord!\nYou can now access the website.'
      });

    } catch (err) {
      console.error('Error in /link command:', err);
      return interaction.editReply({
        content: '❌ An error occurred while linking your account. Please try again.'
      });
    }
  }
};
