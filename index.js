// index.js
require('dotenv').config();
const config = require('./config');
const { MessageFlags } = require('discord.js'); // or import { MessageFlags } from 'discord.js'

const { Client, GatewayIntentBits, Partials, Collection, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Add more intents only if you need them
  ],
  partials: [Partials.Channel] // for thread events/messages on uncached channels
});

// Command registry
client.commands = new Collection();

// Load all commands
const commandFolders = [
  'commands',
  'commands/user',
  'commands/admin',
  'commands/matches' // ← important if you keep confirmmatch here
];

for (const folder of commandFolders) {
  const dir = path.join(__dirname, folder);
  if (!fs.existsSync(dir)) continue;

  const files = fs.readdirSync(dir).filter(file => file.endsWith('.js'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      console.log(`✅ Registered /${command.data.name} (${folder}/${file})`);
    } else {
      console.warn(`⚠️ Skipped command at ${filePath} (missing data/execute)`);
    }
  }
}

// Ready
client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Interactions (autocomplete + slash)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Autocomplete
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try { await command.autocomplete(interaction); } catch (e) { console.error('Autocomplete error:', e); }
      }
      return;
    }

    // Slash commands
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;


    // index.js (top of the slash branch)
    if (!global.__seenInteractions) global.__seenInteractions = new Set();
    if (global.__seenInteractions.has(interaction.id)) {
      console.warn('[DUP] execute called again for interaction', interaction.id, interaction.commandName);
    } else {
      global.__seenInteractions.add(interaction.id);
      setTimeout(() => global.__seenInteractions.delete(interaction.id), 60_000);
    }
    
    await command.execute(interaction);
  } catch (error) {
    console.error('Command error:', error);
    try {
      if (interaction.replied || interaction.deferred) {
        // Already replied or deferred, cannot send another reply
        console.warn('Interaction already replied or deferred, cannot send error reply.');
      } else if (interaction.isRepliable && interaction.isRepliable()) {
        await interaction.reply({ content: '❌ Error running this command.', flags: MessageFlags.Ephemeral });
      } else {
        // Not repliable, cannot send reply
        console.warn('Interaction is not repliable, cannot send error reply.');
      }
    } catch (e) {
      console.error('Failed to send error reply:', e);
    }
  }
});

// Global safety nets
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Login
client.login(config.discord.token);
