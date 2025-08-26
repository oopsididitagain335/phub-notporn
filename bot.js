const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
require('dotenv').config();
const linkCommand = require('./commands/link');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();
client.commands.set(linkCommand.data.name, linkCommand);

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // Register /link globally
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), {
      body: [linkCommand.data.toJSON()]
    });
    console.log('✅ /link command registered globally');
  } catch (err) {
    console.error('❌ Error registering command:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try { await command.execute(interaction); } 
  catch (err) { console.error(err); interaction.reply({ content: 'Error', ephemeral: true }); }
});

function startBot() {
  client.login(process.env.BOT_TOKEN);
}

module.exports = { startBot, client };
