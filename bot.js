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

client.once('ready', () => {
  console.log(`🤖 ${client.user.tag} is ready!`);
});

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
      const audit = await guild.fetchAuditLogs({ limit: 1, type: 22 });
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

function startBot() {
  if (!process.env.BOT_TOKEN) {
    throw new Error('❌ BOT_TOKEN is missing');
  }
  return client.login(process.env.BOT_TOKEN);
}

module.exports = { startBot, client };
