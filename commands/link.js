// commands/link.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
   new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your PulseHub account')
    .addStringOption(option =>
      option
        .setName('code')
        .setDescription('Your 8-character link code')
        .setRequired(true)
        .setMinLength(8)
        .setMaxLength(8)
    ),

  async execute(interaction) {
    if (interaction.replied || interaction.deferred) return;

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.error('Defer failed:', err);
      return;
    }

    const code = interaction.options.getString('code').trim().toUpperCase();

    if (!/^[A-Z0-9]{8}$/.test(code)) {
      return await interaction.editReply({
        content: `❌ Invalid format. Use 8 letters/numbers.\n\nYou entered: \`${code}\``
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

      if (dbUser.discordId) {
        return await interaction.editReply({
          content: '⚠️ This code has already been used.'
        });
      }

      dbUser.discordId = interaction.user.id;
      dbUser.linkCode = null;
      await dbUser.save();

      console.log(`✅ Linked: ${dbUser.username} → ${interaction.user.tag}`);

      return await interaction.editReply({
        content: `✅ Success! Your account \`${dbUser.username}\` is now linked to Discord.`
      });
    } catch (err) {
      console.error('Link error:', err);
      await interaction.editReply({
        content: '❌ A server error occurred. Try again later.'
      }).catch(console.error);
    }
  }
};
