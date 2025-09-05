// deploy-commands.js
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Validate required environment variables
if (!process.env.DISCORD_CLIENT_ID) {
  throw new Error('❌ Missing DISCORD_CLIENT_ID in .env');
}
if (!process.env.BOT_TOKEN) {
  throw new Error('❌ Missing BOT_TOKEN in .env');
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log(`🔍 Found ${commandFiles.length} file(s) in /commands`);

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
    console.log(`✅ Loaded command: ${command.data.name}`);
  } else {
    console.warn(`⚠️ Failed to load command from ${filePath}: missing 'data' or 'execute'`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

// 🔧 Replace with your actual Guild ID (keep as string)
const GUILD_ID = '1410014241896927412';

(async () => {
  try {
    console.log(`🔁 Deploying ${commands.length} command(s) to guild ${GUILD_ID}...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log(`✅ Successfully registered ${data.length} command(s) in the server.`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
