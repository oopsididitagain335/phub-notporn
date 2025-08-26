// bot.js

const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { REST, Routes } = require('@discordjs/rest');
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

// Ready event
client.once('clientReady', async () => {
  console.log(`🤖 ${client.user.tag} is ready!`);

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = '1410014241896927412'; // Your server ID

  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: [...client.commands.values()].map(cmd => cmd.data.toJSON()) }
    );
    console.log(`✅ Commands deployed to guild ${guildId}`);
  } catch (err) {
    console.error('❌ Command deploy failed:', err);
  }
});

// Interaction handler
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
      content: '❌ An error occurred. Try again.',
      ephemeral: true
    }).catch(console.error);
  }
});

// ✅ Fixed: guildBanAdd with correct audit log type
client.on('guildBanAdd', async (ban) => {
  try {
    const user = ban.user;
    const guild = ban.guild;

    if (!user || !guild) {
      return console.warn('⚠️ Missing user or guild in ban event');
    }

    console.log(`🚫 ${user.tag} was banned from ${guild.name}`);

    const User = require('./models/User');
    const dbUser = await User.findOne({ discordId: user.id });

    if (!dbUser) {
      console.log(`ℹ️ No PulseHub account linked for ${user.tag}`);
      return;
    }

    // ✅ Use number 22 for MEMBER_BAN_ADD
    let reason = 'No reason provided';
    try {
      const audit = await guild.fetchAuditLogs({
        limit: 1,
        type: 22 // ← Correct enum value for MEMBER_BAN_ADD
      });
      const log = audit.entries.first();
      if (log && log.target.id === user.id) {
        reason = log.reason || reason;
      }
    } catch (auditErr) {
      console.warn('Failed to fetch audit log:', auditErr.message);
    }

    dbUser.isBanned = true;
    dbUser.banReason = reason;
    await dbUser.save();

    console.log(`✅ ${dbUser.username} marked as banned: ${reason}`);
  } catch (err) {
    console.error('❌ Error in guildBanAdd:', err);
  }
});

// Start bot
function startBot() {
  if (!process.env.BOT_TOKEN) {
    throw new Error('❌ BOT_TOKEN missing in .env');
  }
  client.login(process.env.BOT_TOKEN).catch(console.error);
}

module.exports = { startBot, client };
