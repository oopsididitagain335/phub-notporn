// commands/link.js

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your PulseHub account using your 8-character code')
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('Enter your 8-character link code (e.g., ABC123XY)')
        .setRequired(true)
        .setMinLength(8)
        .setMaxLength(8)
    ),

  async execute(interaction) {
    // Prevent duplicate replies
    if (interaction.replied || interaction.deferred) {
      console.warn('[Link] Interaction already handled:', interaction.id);
      return;
    }

    // Defer immediately
    let deferred = false;
    try {
      await interaction.deferReply({ ephemeral: true });
      deferred = true;
    } catch (err) {
      console.error('[Link] Failed to defer reply:', err.message);
      return;
    }

    // Extract and sanitize code
    const rawCode = interaction.options.getString('code');
    const code = rawCode.trim().toUpperCase();

    // Validate format: exactly 8 alphanumeric uppercase chars
    const validFormat = /^[A-Z0-9]{8}$/;
    if (!validFormat.test(code)) {
      return await interaction.editReply({
        content: `❌ Invalid code format.\n\n🔹 Got: \`${code}\`\n🔹 Expected: 8 letters/numbers (e.g., \`K7M2X9LP\`)\n\nMake sure you copied it correctly from the website.`,
      });
    }

    try {
      const User = require('../models/User');
      const dbUser = await User.findOne({ linkCode: code });

      // Case 1: No user found with this code
      if (!dbUser) {
        return await interaction.editReply({
          content: `❌ No account found with that code.\n\n➡️ Double-check the code on the [PulseHub Link Page](http://localhost:3000/link).\n➡️ Codes expire after use or re-login.`,
        });
      }

      // Case 2: Already linked
      if (dbUser.discordId) {
        return await interaction.editReply({
          content: `⚠️ This code has already been used.\n\nIf this is your account, contact support for help.`,
        });
      }

      // Case 3: Success — link account
      dbUser.discordId = interaction.user.id;
      dbUser.linkCode = null; // invalidate for security
      await dbUser.save();

      console.log(`✅ Linked: ${dbUser.username} (${dbUser._id}) → ${interaction.user.tag}`);

      return await interaction.editReply({
        content: `✅ Success!\n\nYour PulseHub account **${dbUser.username}** is now linked to Discord.\n\nYou can now access all features on the website.`,
      });
    } catch (err) {
      console.error('[Link] Database error:', err);

      if (deferred && !interaction.replied) {
        await interaction.editReply({
          content: '❌ A server error occurred. Please try again or contact support.',
        }).catch(console.error);
      }
    }
  },
};
