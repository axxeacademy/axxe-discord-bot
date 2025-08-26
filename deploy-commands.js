require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const commands = [];

// Load root-level commands (global)
const rootCommands = fs.readdirSync(path.join(__dirname, 'commands'))
  .filter(file => file.endsWith('.js'));

for (const file of rootCommands) {
  const filePath = path.join(__dirname, 'commands', file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
    console.log(`✅ Loaded global command: /${command.data.name}`);
  } else {
    console.warn(`⚠️ Skipped file in /commands/: ${file} — missing 'data' or 'execute'`);
  }
}

// Load user/admin folders
const folders = ['user', 'admin'];
for (const folder of folders) {
  const folderPath = path.join(__dirname, 'commands', folder);
  if (!fs.existsSync(folderPath)) continue;

  const files = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
  for (const file of files) {
    const filePath = path.join(folderPath, file);
    try {
      const command = require(filePath);
      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
        console.log(`✅ Loaded /${folder}/${command.data.name}`);
      } else {
        console.warn(`⚠️ Skipped file in /${folder}: ${file} — missing 'data' or 'execute'`);
      }
    } catch (err) {
      console.error(`❌ Error loading command in /${folder}/${file}:`, err.message);
    }
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`🚀 Deploying ${commands.length} commands...`);
    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log(`✅ Successfully reloaded ${data.length} commands.`);
  } catch (error) {
    console.error('❌ Failed to deploy commands:', error);
  }
})();
