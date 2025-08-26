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
    const code = interaction.options.getString('code').toUpperCase();
    const user = await User.findOne({ linkCode: code });

    if (!user) {
      return interaction.reply({
        content: '❌ Invalid or expired link code.',
        ephemeral: true
      });
    }

    if (user.discordId) {
      return interaction.reply({
        content: '⚠️ This account is already linked to a Discord user.',
        ephemeral: true
      });
    }

    // ✅ Link account
    user.discordId = interaction.user.id;
    user.linkCode = null; // 🔒 Permanently invalidate
    await user.save();

    return interaction.reply({
      content: '✅ Account linked successfully! You can now access the site.',
      ephemeral: true
    });
  }
};
