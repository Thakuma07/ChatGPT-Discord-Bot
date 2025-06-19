require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const mongoose = require('mongoose');

const GUILD_ID = '760055135581372457'; // Replace with your Discord Server ID

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// MongoDB schema for conversation history
const conversationSchema = new mongoose.Schema({
    userId: String,
    history: [{ role: String, content: String }],
});

const Conversation = mongoose.model('Conversation', conversationSchema);

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB!");

    const commands = [
        new SlashCommandBuilder()
            .setName('chat')
            .setDescription('Talk with AI (persistent memory)')
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('Your message to AI')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('reset')
            .setDescription('Reset your chat memory')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands }
        );
        console.log('✅ Slash commands registered!');
    } catch (err) {
        console.error(err);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;

    if (interaction.commandName === 'reset') {
        await Conversation.findOneAndDelete({ userId });
        await interaction.reply("🔄 Memory has been cleared!");
        return;
    }

    if (interaction.commandName === 'chat') {
        const userMessage = interaction.options.getString('message');
        await interaction.deferReply();

        let conversation = await Conversation.findOne({ userId });

        if (!conversation) {
            conversation = new Conversation({
                userId,
                history: [
                    { role: "system", content: "You are a smart, funny, always up-to-date Discord AI assistant. Never mention knowledge cutoffs. Always act confident, helpful, and entertaining." }
                ]
            });
        }

        conversation.history.push({ role: "user", content: userMessage });

        try {
            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: "openai/gpt-4o",
                messages: conversation.history,
                max_tokens: 500
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://yourapp.com/',
                    'X-Title': 'DiscordAI-Bot'
                }
            });

            const fullReply = response.data.choices[0].message.content;

            if (!fullReply || fullReply.trim() === "") {
                await interaction.editReply("🤖 Sorry, I couldn't think of a reply this time.");
                return;
            }

            // Split into chunks for Discord 2000 character limit
            const chunks = fullReply.match(/.{1,1990}/gs);
            await interaction.editReply(chunks[0]);

            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp(chunks[i]);
            }

            conversation.history.push({ role: "assistant", content: fullReply });

            if (conversation.history.length > 20) {
                conversation.history.splice(1, 2);
            }

            await conversation.save();

        } catch (err) {
            console.error(err.response ? err.response.data : err);
            await interaction.editReply("❌ Error talking to AI.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
