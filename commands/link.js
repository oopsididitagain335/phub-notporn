// commands/link.js
module.exports = {
  data: {
    name: 'link',
    description: 'Link your Discord account'
  },
  async execute(interaction) {
    try {
      // Check if interaction is still valid
      if (interaction.replied || interaction.deferred) {
        return;
      }

      // Defer the reply to prevent "Unknown interaction" error
      await interaction.deferReply({ ephemeral: true });

      // Your link logic here
      // ...

      // Edit the deferred reply with final result
      await interaction.editReply({
        content: 'Successfully linked your Discord account!',
        ephemeral: true
      });

    } catch (error) {
      console.error('Link command error:', error);
      
      // Handle the error gracefully
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your request.',
          ephemeral: true
        });
      } else {
        // If already replied, edit the reply
        await interaction.editReply({
          content: 'An error occurred while processing your request.',
          ephemeral: true
        });
      }
    }
  }
};
