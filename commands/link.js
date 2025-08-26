// 
const { SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const User = require('../models/User'); // adjust path if models are in another folder

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your PulseHub account to your Discord')
    .addStringOption(option =>
      option
        .setName('code')
        .setDescription('Your PulseHub link code from the website')
        .setRequired(true)
    ),

  async execute(interaction) {
    const code = interaction.options.getString('code');
    const discordId = interaction.user.id;

    try {
      // find user by pending link code
      const user = await User.findOne({ linkCode: code });
      if (!user) {
        return interaction.reply({
          content: '❌ Invalid or expired code. Try generating a new one from the website.',
          ephemeral: true
        });
      }

      // link discord account
      user.discordId = discordId;
      user.linkCode = null; // clear code after use
      await user.save();

      return interaction.reply({
        content: '✅ Your PulseHub account has been successfully linked!',
        ephemeral: true
      });
    } catch (err) {
      console.error('Link command error:', err);
      return interaction.reply({
        content: '❌ Something went wrong while linking your account.',
        ephemeral: true
      });
    }
  }
};
