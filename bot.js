// bot.js

const { Client, Collection, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ✅ 1. Import REST and Routes from @discordjs/rest
const { REST, Routes } = require('@discordjs/rest');

// ✅ 2. Create Discord client
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
    console.warn(`❌ [WARNING] Command at ${filePath} missing "data" or "execute"`);
  }
}

// ✅ 3. Use 'clientReady' instead of 'ready' (v14+)
client.once('clientReady', async () => {
  console.log(`🤖 ${client.user.tag} is online!`);

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = '1410014241896927412'; // Your server ID

  try {
    console.log(`🔁 Deploying ${client.commands.size} commands to guild ${guildId}...`);

    // ✅ Now Routes is defined
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: [...client.commands.values()].map(cmd => cmd.data.toJSON()) }
    );

    console.log('✅ Commands deployed successfully!');
  } catch (err) {
    console.error('❌ Failed to deploy commands:', err);
  }
});

// ✅ 4. Handle interactions
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

// ✅ 5. Handle bans
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

    let reason = 'No reason provided';
    try {
      const audit = await guild.fetchAuditLogs({
        limit: 1,
        type: 'MEMBER_BAN_ADD'
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

    console.log(`✅ ${dbUser.username} marked as banned`);
  } catch (err) {
    console.error('❌ Error in guildBanAdd:', err);
  }
});

// ✅ 6. Start bot
function startBot() {
  if (!process.env.BOT_TOKEN) {
    throw new Error('❌ BOT_TOKEN is missing in .env');
  }
  client.login(process.env.BOT_TOKEN).catch(console.error);
}

module.exports = { startBot, client };
