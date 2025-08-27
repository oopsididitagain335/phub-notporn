// commands/link.js

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your PulseHub account to Discord')
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('Your link code from the website')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Prevent double handling
    if (interaction.replied || interaction.deferred) {
      console.warn('Interaction already handled:', interaction.id);
      return;
    }

    let deferred = false;

    try {
      // Defer the reply first
      await interaction.deferReply({ ephemeral: true });
      deferred = true;

      const code = interaction.options.getString('code').toUpperCase().trim();

      // Validate code format (optional, e.g., assume 6 uppercase alphanumeric)
      if (!/^[A-Z0-9]{6}$/.test(code)) {
        return await interaction.editReply({
          content: '❌ Invalid link code format. Must be 6 alphanumeric characters.',
        });
      }

      const User = require('../models/User');
      const dbUser = await User.findOne({ linkCode: code });

      if (!dbUser) {
        return await interaction.editReply({
          content: '❌ Invalid or expired link code. It may have already been used.',
        });
      }

      if (dbUser.discordId) {
        return await interaction.editReply({
          content: '⚠️ This account has already been linked to a Discord user.',
        });
      }

      // Link the account
      dbUser.discordId = interaction.user.id;
      dbUser.linkCode = null; // invalidate code
      await dbUser.save();

      return await interaction.editReply({
        content: '✅ Your PulseHub account has been successfully linked to Discord!\nYou can now access the website.',
      });
    } catch (err) {
      console.error('Error in /link command:', err);

      // Only reply if we deferred and haven't replied yet
      if (deferred && !interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while linking your account. Please try again or contact support.',
        }).catch((replyErr) => {
          console.error('Failed to send error reply:', replyErr);
        });
      } else if (!deferred) {
        // If we couldn't even defer, try a non-deferred reply
        await interaction.reply({
          content: '❌ The bot encountered an error and could not respond.',
          ephemeral: true,
        }).catch(console.error);
      }
    }
  },
};
