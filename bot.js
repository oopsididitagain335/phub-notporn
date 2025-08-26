// bot.js
// PulseHub Discord bot runtime
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Commands collection
client.commands = new Collection();

// Import commands
const linkCommand = require('./commands/link.js');
client.commands.set(linkCommand.data.name, linkCommand);

// Handle ready
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// Handle slash command interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error('Command error:', err);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ Something went wrong.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
    }
  }
});

function startBot() {
  if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN missing in .env');
    return;
  }
  client.login(process.env.BOT_TOKEN);
}

module.exports = { startBot, client };
