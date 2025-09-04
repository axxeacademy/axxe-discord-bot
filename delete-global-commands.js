require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const appId = process.env.DISCORD_CLIENT_ID;
    // List all global commands
    const commands = await rest.get(Routes.applicationCommands(appId));
    if (!commands.length) {
      console.log('No global commands found.');
      return;
    }
    console.log(`Found ${commands.length} global commands. Deleting...`);
    for (const command of commands) {
      await rest.delete(Routes.applicationCommand(appId, command.id));
      console.log(`Deleted global command: ${command.name}`);
    }
    console.log('✅ All global commands deleted.');
  } catch (error) {
    console.error('❌ Failed to delete global commands:', error);
  }
})();
