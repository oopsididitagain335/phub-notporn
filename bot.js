// bot.js
const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildBans] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
  }
}

client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag} ready!`);
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), {
      body: [...client.commands.values()].map(cmd => cmd.data.toJSON())
    });
    console.log('✅ Commands registered globally');
  } catch (err) {
    console.error('❌ Command registration failed:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (command) await command.execute(interaction);
});

// Ban handler (optional)
client.on('guildBanAdd', async (guild, user) => {
  const User = require('./models/User');
  const dbUser = await User.findOne({ discordId: user.id });
  if (dbUser) {
    dbUser.isBanned = true;
    dbUser.banReason = 'Banned from community server';
    await dbUser.save();
  }
});

function startBot() {
  client.login(process.env.BOT_TOKEN);
}

module.exports = { startBot };
