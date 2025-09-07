// bot.js — with PulseHub Health Monitor

const { Client, Collection, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.DirectMessages
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
    console.warn(`❌ Invalid command at ${filePath}: missing 'data' or 'execute'`);
  }
}

// Ready event
client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag} is ready!`);
  console.log(`🌍 Serving ${client.guilds.cache.size} server(s).`);

  // ✅ START HEALTH MONITOR AFTER BOT IS READY
  startHealthMonitor(client);
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`❌ Command '${interaction.commandName}' not found.`);
    return;
  }

  try {
    if (interaction.replied || interaction.deferred) {
      console.warn(`⚠️ Interaction already acknowledged for ${interaction.commandName}`);
      return;
    }

    await Promise.race([
      command.execute(interaction),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Command timeout')), 10000))
    ]);
  } catch (err) {
    console.error('❌ Command execution error:', err);

    if (interaction.replied || interaction.deferred) {
      console.warn(`⚠️ Cannot send error reply: interaction already acknowledged.`);
      return;
    }

    try {
      await interaction.reply({
        content: '❌ Something went wrong while executing this command.',
        ephemeral: true
      });
    } catch (replyErr) {
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

// Sync bans from Discord
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
      const audit = await guild.fetchAuditLogs({ limit: 1, type: 22 });
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

// ✅ PULSEHUB HEALTH MONITOR
async function startHealthMonitor(botClient) {
    const HEALTH_URL = 'https://pulsehub.space/health';
    const CHANNEL_ID = '1414055520477777981'; // Your logging channel
    const CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes

    const channel = await botClient.channels.fetch(CHANNEL_ID).catch(err => {
        console.error('❌ Could not find health log channel:', err.message);
        return null;
    });

    if (!channel) {
        console.error('❌ Health monitor disabled — channel not found');
        return;
    }

    console.log(`✅ PulseHub Health Monitor started → logging to #${channel.name || CHANNEL_ID}`);

    async function checkHealth() {
        try {
            const startTime = Date.now();
            const res = await axios.get(HEALTH_URL, { timeout: 8000 });
            const data = res.data;
            const responseTime = Date.now() - startTime;

            const statusEmoji = data.status === 'OK' ? '🟢' : '🔴';
            const dbEmoji = data.databaseConnectivity.includes('✅') ? '🟢' : '🔴';
            const secEmoji = Object.values(data.securitySystems).every(s => s.includes('✅')) ? '🟢' : '🟡';

            const embed = new EmbedBuilder()
                .setTitle(`${statusEmoji} PulseHub System Status`)
                .setColor(data.status === 'OK' ? 0x00ff00 : 0xff0000)
                .addFields(
                    { name: 'Status', value: `\`${data.status}\``, inline: true },
                    { name: 'Response Time', value: `\`${responseTime}ms\``, inline: true },
                    { name: 'Uptime', value: `\`${data.uptime}\``, inline: true },
                    { name: 'Database', value: `${dbEmoji} ${data.databaseConnectivity}`, inline: false },
                    { name: 'Security Systems', value: `${secEmoji} All Active`, inline: false },
                    { name: 'Total Users', value: `\`${data.totalUsers.toLocaleString()}\``, inline: true },
                    { name: 'Last Checked', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: 'PulseHub Health Monitor' })
                .setTimestamp();

            await channel.send({ embeds: [embed] });
            console.log(`✅ Health check passed — posted to Discord`);

        } catch (err) {
            console.error('❌ Health check failed:', err.message);

            const errorEmbed = new EmbedBuilder()
                .setTitle('🔴 PulseHub Health Check FAILED')
                .setColor(0xff0000)
                .setDescription(`Could not reach \`${HEALTH_URL}\`\n\`\`\`${err.message}\`\`\``)
                .addFields(
                    { name: 'Error Code', value: err.code || 'UNKNOWN', inline: true },
                    { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
                )
                .setFooter({ text: 'PulseHub Health Monitor - Auto Retry in 15min' })
                .setTimestamp();

            try {
                await channel.send({ embeds: [errorEmbed] });
                console.log('✅ Health failure alert posted to Discord');
            } catch (sendErr) {
                console.error('❌ Failed to send health alert to Discord:', sendErr.message);
            }
        }
    }

    // Run first check immediately
    await checkHealth();

    // Then run every X minutes
    setInterval(checkHealth, CHECK_INTERVAL);
}

// Start the bot
function startBot() {
  if (!process.env.BOT_TOKEN) {
    throw new Error('❌ BOT_TOKEN is missing in .env');
  }

  return client.login(process.env.BOT_TOKEN).catch((err) => {
    console.error('❌ Failed to log in:', err);
    setTimeout(() => {
      console.log('🔄 Retrying bot login...');
      startBot();
    }, 30000);
  });
}

// Process monitoring
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = { client, startBot };
