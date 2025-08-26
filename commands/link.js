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
    if (!user) return interaction.reply({ content: '❌ Invalid code', ephemeral: true });

    user.discordId = interaction.user.id;
    user.linkCode = null;
    await user.save();
    return interaction.reply({ content: '✅ Account linked!', ephemeral: true });
  }
};
