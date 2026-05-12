require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField,
    ApplicationCommandOptionType
} = require("discord.js");

const fs = require("fs");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const TOKEN = process.env.TOKEN;
const LEADERBOARD_CHANNEL_ID = "1502061975251714240";
const UPDATE_SECONDS = 60;
const COIN_MANAGER_ROLE_NAME = "PG bot Coin Manager";

let nextUpdateTime = Date.now() + UPDATE_SECONDS * 1000;
let leaderboardMessage = null;
let leaderboardIntervalStarted = false;

const cooldowns = new Map();

let data = { coins: {}, daily: {}, weeklyMissions: null };

if (fs.existsSync("data.json")) {
    try {
        data = JSON.parse(fs.readFileSync("data.json", "utf8"));
    } catch {
        data = { coins: {}, daily: {}, weeklyMissions: null };
    }

    if (!data.coins && data.credits) {
        data.coins = data.credits;
        delete data.credits;
    }

    if (!data.coins) data.coins = {};
    if (!data.daily) data.daily = {};
    if (!data.weeklyMissions) data.weeklyMissions = null;
}

function saveData() {
    fs.writeFile("data.json", JSON.stringify(data, null, 4), err => {
        if (err) console.log(err);
    });
}

function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function canManageCoins(member) {
    const admin = isAdmin(member);
    const hasCoinRole = member.roles.cache.some(
        role => role.name === COIN_MANAGER_ROLE_NAME
    );

    return admin || hasCoinRole;
}

function getRank(coins) {
    if (coins >= 100000) return "Legend";
    if (coins >= 75000) return "Master";
    if (coins >= 50000) return "Elite";
    if (coins >= 30000) return "Pro";
    if (coins >= 18000) return "Expert";
    if (coins >= 10000) return "Advanced";
    if (coins >= 5000) return "Skilled";
    if (coins >= 1500) return "Amateur";
    if (coins >= 100) return "Newbie";
    return "Unranked";
}

const rankRoles = [
    "Unranked",
    "Newbie",
    "Amateur",
    "Skilled",
    "Advanced",
    "Expert",
    "Pro",
    "Elite",
    "Master",
    "Legend"
];

async function updateRole(guild, userId, coins) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    const rank = getRank(coins);
    const roleToAdd = guild.roles.cache.find(r => r.name === rank);
    if (!roleToAdd) return;

    for (const roleName of rankRoles) {
        const oldRole = guild.roles.cache.find(r => r.name === roleName);

        if (oldRole && member.roles.cache.has(oldRole.id)) {
            await member.roles.remove(oldRole).catch(() => {});
        }
    }

    await member.roles.add(roleToAdd).catch(() => {});
}

function getWeekKey() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), 0, 1);
    const pastDays = Math.floor((now - firstDay) / 86400000);
    const week = Math.ceil((pastDays + firstDay.getDay() + 1) / 7);

    return `${now.getFullYear()}-W${week}`;
}

function pickRandom(arr, count) {
    const copy = [...arr];
    const picked = [];

    while (picked.length < count && copy.length > 0) {
        const index = Math.floor(Math.random() * copy.length);
        picked.push(copy.splice(index, 1)[0]);
    }

    return picked;
}

function loadMissionPool() {
    if (!fs.existsSync("missions.json")) return null;

    try {
        return JSON.parse(fs.readFileSync("missions.json", "utf8"));
    } catch {
        return null;
    }
}

function generateWeeklyMissions(force = false) {
    const weekKey = getWeekKey();

    if (!force && data.weeklyMissions && data.weeklyMissions.weekKey === weekKey) {
        return;
    }

    const pool = loadMissionPool();
    if (!pool) return;

    const easy = pickRandom(pool.easy || [], 3).map(m => ({
        type: "Easy",
        text: m,
        locked: false
    }));

    const medium = pickRandom(pool.medium || [], 3).map(m => ({
        type: "Medium",
        text: m,
        locked: false
    }));

    const hard = pickRandom(pool.hard || [], 3).map(m => ({
        type: "Hard",
        text: m,
        locked: false
    }));

    const elite = pickRandom(pool.elite || [], 2).map(m => ({
        type: "Elite",
        text: m,
        locked: false
    }));

    data.weeklyMissions = {
        weekKey,
        missions: [...easy, ...medium, ...hard, ...elite]
    };

    saveData();
}

function buildMissionsEmbed() {
    generateWeeklyMissions(false);

    if (!data.weeklyMissions || !data.weeklyMissions.missions) {
        return new EmbedBuilder()
            .setTitle("📌 Weekly Missions")
            .setDescription("❌ missions.json not found or invalid.")
            .setColor("#0099ff");
    }

    let easyText = "";
    let mediumText = "";
    let hardText = "";
    let eliteText = "";

    data.weeklyMissions.missions.forEach((mission, index) => {
        const number = index + 1;
        const line = mission.locked
            ? `**${number}.** 🔒 Locked\n`
            : `**${number}.** ${mission.text}\n`;

        if (mission.type === "Easy") easyText += line;
        if (mission.type === "Medium") mediumText += line;
        if (mission.type === "Hard") hardText += line;
        if (mission.type === "Elite") eliteText += line;
    });

    return new EmbedBuilder()
        .setTitle("📌 Weekly Missions")
        .setColor("#0099ff")
        .addFields(
            { name: "🟢 Easy Missions", value: easyText || "None" },
            { name: "🟡 Medium Missions", value: mediumText || "None" },
            { name: "🔴 Hard Missions", value: hardText || "None" },
            { name: "🟣 Elite Missions", value: eliteText || "None" }
        )
        .setFooter({ text: `Week: ${data.weeklyMissions.weekKey}` });
}

function buildLeaderboardEmbed(guild) {
    const sorted = Object.entries(data.coins)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    let text = "";

    sorted.forEach(([userId, coins], index) => {
        const rank = getRank(coins);
        const role = guild.roles.cache.find(r => r.name === rank);
        const rankText = role ? `<@&${role.id}>` : `**${rank}**`;

        text += `\`${index + 1}.\` <@${userId}> • **${coins.toLocaleString()}◎** • ${rankText}\n`;
    });

    if (!text) text = "No leaderboard yet.";

    const secondsLeft = Math.max(
        0,
        Math.ceil((nextUpdateTime - Date.now()) / 1000)
    );

    return new EmbedBuilder()
        .setTitle("🏆 Top 10 PG Players")
        .setDescription(text)
        .setColor("#0099ff")
        .setFooter({ text: `Next update in ${secondsLeft}s` });
}

async function updateLeaderboard(channel) {
    if (!channel || !channel.guild) return;

    const embed = buildLeaderboardEmbed(channel.guild);

    try {
        if (!leaderboardMessage) {
            const messages = await channel.messages.fetch({ limit: 20 });

            leaderboardMessage = messages.find(
                m =>
                    m.author.id === client.user.id &&
                    m.embeds.length > 0 &&
                    m.embeds[0].title?.includes("Top 10 PG Players")
            );
        }

        if (leaderboardMessage) {
            await leaderboardMessage.edit({ embeds: [embed] });
        } else {
            leaderboardMessage = await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.log("Leaderboard Error:", err);
    }
}

async function refreshMainLeaderboard() {
    const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID).catch(() => null);
    if (channel) await updateLeaderboard(channel);
}

function hasCooldown(key) {
    if (cooldowns.has(key)) return true;

    cooldowns.set(key, true);

    setTimeout(() => {
        cooldowns.delete(key);
    }, 1000);

    return false;
}

const commands = [
    {
        name: "pgaddcoin",
        description: "Add coins to user",
        options: [
            {
                name: "amount",
                description: "Amount of coins",
                type: ApplicationCommandOptionType.Integer,
                required: true
            },
            {
                name: "user",
                description: "Target user",
                type: ApplicationCommandOptionType.User,
                required: true
            }
        ]
    },
    {
        name: "pgremovecoin",
        description: "Remove coins from user",
        options: [
            {
                name: "amount",
                description: "Amount of coins",
                type: ApplicationCommandOptionType.Integer,
                required: true
            },
            {
                name: "user",
                description: "Target user",
                type: ApplicationCommandOptionType.User,
                required: true
            }
        ]
    },
    {
        name: "rank",
        description: "Check rank",
        options: [
            {
                name: "user",
                description: "Target user",
                type: ApplicationCommandOptionType.User,
                required: false
            }
        ]
    },
    {
        name: "daily",
        description: "Claim daily reward"
    },
    {
        name: "leaderboard",
        description: "Show leaderboard"
    },
    {
        name: "missions",
        description: "Show weekly missions"
    },
    {
        name: "lockmission",
        description: "Lock a weekly mission",
        options: [
            {
                name: "number",
                description: "Mission number 1-11",
                type: ApplicationCommandOptionType.Integer,
                required: true
            }
        ]
    },
    {
        name: "unlockmission",
        description: "Unlock a weekly mission",
        options: [
            {
                name: "number",
                description: "Mission number 1-11",
                type: ApplicationCommandOptionType.Integer,
                required: true
            }
        ]
    },
    {
        name: "resetmissions",
        description: "Reset weekly missions"
    }
];

client.once("clientReady", async () => {
    console.log(`${client.user.tag} is online!`);

    generateWeeklyMissions(false);

    for (const guild of client.guilds.cache.values()) {
        await guild.commands.set(commands).catch(console.log);
    }

    console.log("Slash commands loaded!");

    const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID).catch(() => null);

    if (!channel) {
        return console.log("Leaderboard channel not found!");
    }

    await updateLeaderboard(channel);

    nextUpdateTime = Date.now() + UPDATE_SECONDS * 1000;

    if (!leaderboardIntervalStarted) {
        leaderboardIntervalStarted = true;

        setInterval(async () => {
            nextUpdateTime = Date.now() + UPDATE_SECONDS * 1000;
            await updateLeaderboard(channel);
        }, UPDATE_SECONDS * 1000);
    }
});

client.on("guildCreate", async guild => {
    await guild.commands.set(commands).catch(console.log);
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply().catch(() => {});

    try {
        const command = interaction.commandName;

        if (command === "pgaddcoin") {
            if (!canManageCoins(interaction.member)) {
                return interaction.editReply("❌ You need Admin or **PG bot Coin Manager** role.");
            }

            const amount = interaction.options.getInteger("amount");
            const user = interaction.options.getUser("user");

            if (!amount || amount <= 0) {
                return interaction.editReply("❌ Invalid amount.");
            }

            const key = `add-${user.id}`;

            if (hasCooldown(key)) {
                return interaction.editReply("⏳ Wait a second...");
            }

            if (!data.coins[user.id]) data.coins[user.id] = 0;

            data.coins[user.id] += amount;
            saveData();

            await updateRole(interaction.guild, user.id, data.coins[user.id]);
            await refreshMainLeaderboard();

            const embed = new EmbedBuilder()
                .setDescription(`Added **${amount.toLocaleString()}◎** to <@${user.id}>.`)
                .setColor("#0099ff");

            return interaction.editReply({ embeds: [embed] });
        }

        if (command === "pgremovecoin") {
            if (!canManageCoins(interaction.member)) {
                return interaction.editReply("❌ You need Admin or **PG bot Coin Manager** role.");
            }

            const amount = interaction.options.getInteger("amount");
            const user = interaction.options.getUser("user");

            if (!amount || amount <= 0) {
                return interaction.editReply("❌ Invalid amount.");
            }

            const key = `remove-${user.id}`;

            if (hasCooldown(key)) {
                return interaction.editReply("⏳ Wait a second...");
            }

            if (!data.coins[user.id]) data.coins[user.id] = 0;

            data.coins[user.id] -= amount;

            if (data.coins[user.id] < 0) {
                data.coins[user.id] = 0;
            }

            saveData();

            await updateRole(interaction.guild, user.id, data.coins[user.id]);
            await refreshMainLeaderboard();

            const embed = new EmbedBuilder()
                .setDescription(`Removed **${amount.toLocaleString()}◎** from <@${user.id}>.`)
                .setColor("#0099ff");

            return interaction.editReply({ embeds: [embed] });
        }

        if (command === "rank") {
            const user = interaction.options.getUser("user") || interaction.user;
            const coins = data.coins[user.id] || 0;
            const rank = getRank(coins);

            const role = interaction.guild.roles.cache.find(r => r.name === rank);
            const rankText = role ? `<@&${role.id}>` : rank;

            const embed = new EmbedBuilder()
                .setTitle(`🏆 ${user.username}`)
                .addFields(
                    { name: "PG Coins", value: `${coins.toLocaleString()}◎`, inline: true },
                    { name: "Rank", value: rankText, inline: true }
                )
                .setColor("#0099ff");

            return interaction.editReply({ embeds: [embed] });
        }

        if (command === "daily") {
            const userId = interaction.user.id;
            const now = Date.now();
            const dailyCooldown = 24 * 60 * 60 * 1000;

            if (!data.daily[userId]) data.daily[userId] = 0;
            if (!data.coins[userId]) data.coins[userId] = 0;

            const remaining = dailyCooldown - (now - data.daily[userId]);

            if (remaining > 0) {
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

                return interaction.editReply(`⏳ Come back in **${hours}h ${minutes}m**.`);
            }

            data.coins[userId] += 100;
            data.daily[userId] = now;

            saveData();

            await updateRole(interaction.guild, userId, data.coins[userId]);
            await refreshMainLeaderboard();

            return interaction.editReply(
                `🎁 You received **100◎**.\nBalance: **${data.coins[userId].toLocaleString()}◎**`
            );
        }

        if (command === "leaderboard") {
            const embed = buildLeaderboardEmbed(interaction.guild);
            return interaction.editReply({ embeds: [embed] });
        }

        if (command === "missions") {
            const embed = buildMissionsEmbed();
            return interaction.editReply({ embeds: [embed] });
        }

        if (command === "lockmission") {
            if (!isAdmin(interaction.member)) {
                return interaction.editReply("❌ Admin only.");
            }

            generateWeeklyMissions(false);

            if (!data.weeklyMissions || !data.weeklyMissions.missions) {
                return interaction.editReply("❌ missions.json not found or invalid.");
            }

            const missionNumber = interaction.options.getInteger("number");
            const maxMission = data.weeklyMissions.missions.length;

            if (!missionNumber || missionNumber < 1 || missionNumber > maxMission) {
                return interaction.editReply(`Use mission number from 1 to ${maxMission}.`);
            }

            data.weeklyMissions.missions[missionNumber - 1].locked = true;
            saveData();

            const embed = buildMissionsEmbed();

            return interaction.editReply({
                content: `🔒 Mission ${missionNumber} locked.`,
                embeds: [embed]
            });
        }

        if (command === "unlockmission") {
            if (!isAdmin(interaction.member)) {
                return interaction.editReply("❌ Admin only.");
            }

            generateWeeklyMissions(false);

            if (!data.weeklyMissions || !data.weeklyMissions.missions) {
                return interaction.editReply("❌ missions.json not found or invalid.");
            }

            const missionNumber = interaction.options.getInteger("number");
            const maxMission = data.weeklyMissions.missions.length;

            if (!missionNumber || missionNumber < 1 || missionNumber > maxMission) {
                return interaction.editReply(`Use mission number from 1 to ${maxMission}.`);
            }

            data.weeklyMissions.missions[missionNumber - 1].locked = false;
            saveData();

            const embed = buildMissionsEmbed();

            return interaction.editReply({
                content: `🔓 Mission ${missionNumber} unlocked.`,
                embeds: [embed]
            });
        }

        if (command === "resetmissions") {
            if (!isAdmin(interaction.member)) {
                return interaction.editReply("❌ Admin only.");
            }

            generateWeeklyMissions(true);

            if (!data.weeklyMissions || !data.weeklyMissions.missions) {
                return interaction.editReply("❌ missions.json not found or invalid.");
            }

            const embed = buildMissionsEmbed();

            return interaction.editReply({
                content: "✅ Weekly missions reset.",
                embeds: [embed]
            });
        }
    } catch (err) {
        console.log("Command Error:", err);

        return interaction.editReply("❌ Bot Error. Check terminal.").catch(() => {});
    }
});

process.on("unhandledRejection", error => {
    console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
    console.error("Uncaught exception:", error);
});

console.log("Bot is starting...");

client.login(TOKEN);