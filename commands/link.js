// commands/link.js
module.exports = {
  data: {
    name: 'link',
    description: 'Link your Discord account'
  },
  async execute(interaction) {
    try {
      // Check if interaction is already handled
      if (interaction.replied || interaction.deferred) {
        console.warn(`⚠️ Interaction already acknowledged for link command`);
        return;
      }

      // Defer the reply to prevent "Unknown interaction" error
      await interaction.deferReply({ ephemeral: true });

      // Get user from database
      const User = require('../models/User');
      const userId = interaction.user.id;
      
      // Find user by discordId
      const user = await User.findOne({ discordId: userId });
      
      if (user) {
        await interaction.editReply({
          content: '❌ You already have a Discord account linked.',
          ephemeral: true
        });
        return;
      }

      // Get user from session or database
      const sessionUserId = interaction.member?.user?.id || interaction.user.id;
      
      // Check if user exists in database by session
      const dbUser = await User.findOne({ 
        $or: [
          { discordId: userId },
          { linkCode: interaction.options.getString('code') }
        ]
      });

      if (!dbUser) {
        await interaction.editReply({
          content: '❌ No account found. Please sign up first.',
          ephemeral: true
        });
        return;
      }

      // Link the Discord account
      await User.findByIdAndUpdate(dbUser._id, {
        $set: { 
          discordId: userId 
        },
        $unset: { linkCode: "" } // Remove linkCode after successful linking
      });

      await interaction.editReply({
        content: '✅ Successfully linked your Discord account!',
        ephemeral: true
      });

    } catch (error) {
      console.error('Link command error:', error);
      
      // Handle the error gracefully
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ An error occurred while processing your request.',
          ephemeral: true
        });
      } else {
        // If already deferred, try to edit the reply
        try {
          await interaction.editReply({
            content: '❌ An error occurred while processing your request.',
            ephemeral: true
          });
        } catch (editError) {
          console.error('Failed to edit reply:', editError);
        }
      }
    }
  }
};
