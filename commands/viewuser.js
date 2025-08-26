// commands/viewuser.js

const { SlashCommandBuilder } = require('discord.js');
const User = require('../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewuser')
    .setDescription('View your linked PulseHub account information'),
    
  async execute(interaction) {
    // Find user by Discord ID
    const user = await User.findOne({ discordId: interaction.user.id });

    if (!user) {
      return interaction.reply({
        content: '❌ You do not have a PulseHub account linked to this Discord account.',
        ephemeral: true,
      });
    }

    // Reply with linked account info
    return interaction.reply({
      content: `✅ **PulseHub Account Linked**\n\n**Username:** \`${user.username}\`\n**Email:** \`${user.email}\`\n**Joined:** <t:${Math.floor(user.createdAt.getTime() / 1000)}:R>`,
      ephemeral: true,
    });
  },
};
