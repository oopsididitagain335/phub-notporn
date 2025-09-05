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
    console.warn(`❌ Invalid command at ${filePath}`);
  }
}

// Ready event
client.once('ready', () => {
  console.log(`🤖 ${client.user.tag} is ready!`);
  // Optional: Log how many commands were loaded
  console.log(`📦 Loaded ${client.commands.size} command(s)`);
});

// Interaction handler (slash commands)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error('❌ Command error:', err);
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({
      content: '❌ An error occurred while running this command.',
      ephemeral: true
    }).catch(console.error);
  }
});

// Sync bans
client.on('guildBanAdd', async (ban) => {
  try {
    const user = ban.user;
    const guild = ban.guild;
    if (!user || !guild) return console.warn('⚠️ Missing user or guild');

    console.log(`🚫 ${user.tag} was banned from ${guild.name}`);
    const User = require('./models/User');
    const dbUser = await User.findOne({ discordId: user.id });

    if (!dbUser) {
      console.log(`ℹ️ No PulseHub account for ${user.tag}`);
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
      console.warn('Audit log fetch failed:', err.message);
    }

    dbUser.isBanned = true;
    dbUser.banReason = reason;
    await dbUser.save();

    console.log(`✅ ${dbUser.username} marked as banned: ${reason}`);
  } catch (err) {
    console.error('❌ Error in guildBanAdd:', err);
  }
});

// Export client and start function
module.exports = { client, startBot: () => {
  if (!process.env.BOT_TOKEN) {
    throw new Error('❌ BOT_TOKEN is missing in .env');
  }
  return client.login(process.env.BOT_TOKEN);
}};
