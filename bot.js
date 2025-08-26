// bot.js

const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

// Load commands from /commands folder
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: ${command.data.name}`);
  } else {
    console.warn(`❌ [WARNING] The command at ${filePath} is missing "data" or "execute".`);
  }
}

// Register commands on ready
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

  try {
    const commandData = [...client.commands.values()].map(cmd => cmd.data.toJSON());

    let data;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.GUILD_ID; // Optional: set for fast testing

    if (guildId) {
      // Deploy to specific guild (instant)
      data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commandData,
      });
      console.log(`✅ Deployed ${data.length} commands to guild: ${guildId}`);
    } else {
      // Deploy globally (can take up to 1 hour)
      data = await rest.put(Routes.applicationCommands(clientId), {
        body: commandData,
      });
      console.log(`✅ Deployed ${data.length} commands globally`);
    }
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
});

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.error(`❌ No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    await interaction.reply({
      content: '❌ There was an error while executing this command.',
      ephemeral: true,
    });
  }
});

// Start the bot
function startBot() {
  client.login(process.env.BOT_TOKEN);
}

module.exports = { startBot, client };
