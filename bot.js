// bot.js
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.DirectMessages
  ]
});

client.commands = new Collection();

// Load commands from /commands folder
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: ${command.data.name}`);
  } else {
    console.warn(`❌ Invalid command at ${filePath}: missing 'data' or 'execute'`);
  }
}

// Ready event
client.once('ready', () => {
  console.log(`🤖 ${client.user.tag} is ready!`);
  console.log(`🌍 Serving ${client.guilds.cache.size} server(s).`);
});

// Interaction handler (slash commands)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`❌ Command '${interaction.commandName}' not found.`);
    return;
  }

  try {
    // Check if interaction is already handled
    if (interaction.replied || interaction.deferred) {
      console.warn(`⚠️ Interaction already acknowledged for ${interaction.commandName}`);
      return;
    }

    // Execute command with timeout protection
    await Promise.race([
      command.execute(interaction),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Command timeout')), 10000))
    ]);
  } catch (err) {
    console.error('❌ Command execution error:', err);

    // Prevent duplicate replies to expired interactions
    if (interaction.replied || interaction.deferred) {
      console.warn(`⚠️ Cannot send error reply: interaction already acknowledged.`);
      return;
    }

    // Attempt to send error message with better error handling
    try {
      await interaction.reply({
        content: '❌ Something went wrong while executing this command.',
        ephemeral: true
      });
    } catch (replyErr) {
      // Handle specific Discord API errors
      if (replyErr.code === 10062) {
        console.warn('❌ Failed to reply: interaction token expired (10062)');
      } else if (replyErr.code === 40060) {
        console.warn('❌ Failed to reply: interaction already acknowledged (40060)');
      } else if (replyErr.code === 40002) {
        console.warn('❌ Failed to reply: Maximum number of reactions reached');
      } else {
        console.error('❌ Unexpected reply error:', replyErr);
      }
    }
  }
});

// Sync bans from Discord to your database
client.on('guildBanAdd', async (ban) => {
  try {
    const user = ban.user;
    const guild = ban.guild;
    if (!user || !guild) return console.warn('⚠️ Missing user or guild in guildBanAdd event');

    console.log(`🚫 ${user.tag} was banned from ${guild.name}`);

    const User = require('./models/User');
    const dbUser = await User.findOne({ discordId: user.id });

    if (!dbUser) {
      console.log(`ℹ️ No PulseHub account linked for ${user.tag}`);
      return;
    }

    let reason = 'No reason provided';
    try {
      const audit = await guild.fetchAuditLogs({ limit: 1, type: 22 }); // 22 = MEMBER_BAN_ADD
      const log = audit.entries.first();
      if (log && log.target.id === user.id) {
        reason = log.reason || reason;
      }
    } catch (err) {
      console.warn('⚠️ Failed to fetch audit log:', err.message);
    }

    dbUser.isBanned = true;
    dbUser.banReason = reason;
    await dbUser.save();

    console.log(`✅ PulseHub account ${dbUser.username} marked as banned: ${reason}`);
  } catch (err) {
    console.error('❌ Error in guildBanAdd handler:', err);
  }
});

// Start the bot with enhanced error handling
function startBot() {
  if (!process.env.BOT_TOKEN) {
    throw new Error('❌ BOT_TOKEN is missing in .env');
  }

  return client.login(process.env.BOT_TOKEN).catch((err) => {
    console.error('❌ Failed to log in:', err);
    // Add retry logic for better reliability
    setTimeout(() => {
      console.log('🔄 Retrying bot login...');
      startBot();
    }, 30000); // Retry after 30 seconds
  });
}

// Add process monitoring
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = { client, startBot };
