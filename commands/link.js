// commands/link.js

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your PulseHub account using your 8-character code')
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('Your 8-character link code (e.g., K7M2X9LP)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (interaction.replied || interaction.deferred) {
      console.warn('Interaction already handled:', interaction.id);
      return;
    }

    let deferred = false;
    try {
      await interaction.deferReply({ ephemeral: true });
      deferred = true;
    } catch (err) {
      console.error('Failed to defer reply:', err);
      return;
    }

    // Clean and validate input
    const rawCode = interaction.options.getString('code');
    const code = rawCode.trim().toUpperCase();

    // ✅ Strict 8-character validation
    const validFormat = /^[A-Z0-9]{8}$/;
    if (!validFormat.test(code)) {
      return await interaction.editReply({
        content: `❌ Invalid format. Code must be **8 uppercase letters/numbers**.\n\nYou entered: \`${code}\`\n\nExample: \`K7M2X9LP\``,
      });
    }

    try {
      const User = require('../models/User');
      const dbUser = await User.findOne({ linkCode: code });

      if (!dbUser) {
        return await interaction.editReply({
          content: `❌ No account found with that code. Double-check it or generate a new one on the website.`,
        });
      }

      if (dbUser.discordId) {
        return await interaction.editReply({
          content: `⚠️ This code has already been used and linked to a Discord account.`,
        });
      }

      // ✅ Link account
      dbUser.discordId = interaction.user.id;
      dbUser.linkCode = null; // invalidate code after use
      await dbUser.save();

      console.log(`✅ Successfully linked: ${dbUser.username} → ${interaction.user.tag}`);

      return await interaction.editReply({
        content: `✅ Success! Your PulseHub account (\`${dbUser.username}\`) is now linked to Discord.\n\nYou can now access the full website.`,
      });
    } catch (err) {
      console.error('Error in /link command:', err);
      if (deferred && !interaction.replied) {
        await interaction.editReply({
          content: '❌ A database error occurred. Please try again or contact support.',
        }).catch(console.error);
      }
    }
  },
};
