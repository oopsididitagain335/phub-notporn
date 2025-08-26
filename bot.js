// bot.js

const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans
  ]
});

client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: ${command.data.name}`);
  } else {
    console.warn(`❌ [WARNING] Invalid command at ${filePath}`);
  }
}

// Register commands on ready
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  try {
    const commandData = [...client.commands.values()].map(cmd => cmd.data.toJSON());

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
      console.log(`✅ Commands deployed to guild: ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commandData });
      console.log('✅ Commands deployed globally');
    }
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
});

// Handle interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    await interaction.reply({
      content: '❌ There was an error running this command.',
      ephemeral: true
    });
  }
});

// 👇 BAN DETECTION
client.on('guildBanAdd', async (guild, user) => {
  console.log(`🚫 ${user.tag} was banned from ${guild.name}`);
  
  const User = require('./models/User');
  const dbUser = await User.findOne({ discordId: user.id });

  if (!dbUser) {
    console.log(`ℹ️ No PulseHub account linked for ${user.tag}`);
    return;
  }

  let reason = 'No reason provided';
  try {
    const auditLogs = await guild.fetchAuditLogs({ limit: 1, type: 'MEMBER_BAN_ADD' });
    const log = auditLogs.entries.first();
    if (log && log.target.id === user.id) {
      reason = log.reason || 'No reason provided';
    }
  } catch (err) {
    console.warn('Failed to fetch audit log:', err.message);
  }

  dbUser.isBanned = true;
  dbUser.banReason = reason;
  await dbUser.save();

  console.log(`✅ PulseHub account ${dbUser.username} marked as banned: ${reason}`);
});

// ✅ Export startBot function
function startBot() {
  client.login(process.env.BOT_TOKEN);
}

// 🔥 Critical: Export as named export
module.exports = { startBot, client };
