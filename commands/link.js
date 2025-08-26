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

    // Find user by linkCode
    const user = await User.findOne({ linkCode: code });

    if (!user) {
      return interaction.reply({
        content: '❌ Invalid or expired link code. It may have already been used.',
        ephemeral: true
      });
    }

    // Prevent reuse if already linked
    if (user.discordId) {
      return interaction.reply({
        content: '⚠️ This account has already been linked to a Discord user.',
        ephemeral: true
      });
    }

    // ✅ Perform linking
    user.discordId = interaction.user.id;
    user.linkCode = null; // 🔒 One-time use: invalidate code
    await user.save();

    return interaction.reply({
      content: '✅ Your PulseHub account has been successfully linked to Discord!\nYou can now access the website.',
      ephemeral: true
    });
  }
};
