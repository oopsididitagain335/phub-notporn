// deploy-commands.js

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
  } else {
    console.log(`[WARNING] The command at ${file} is missing "data" or "execute"`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

// ✅ Your server's Guild ID
const GUILD_ID = '1410014241896927412';

(async () => {
  try {
    console.log(`🔁 Started refreshing ${commands.length} slash commands...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log(`✅ Successfully reloaded ${data.length} application (/) commands in server ${GUILD_ID}.`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
