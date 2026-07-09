const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, Routes, EmbedBuilder, ApplicationCommandOptionType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const mongoose = require('mongoose');
const express = require('express');

// --- [설정] 명령어를 사용할 수 있는 관리자 역할(Role) ID 목록 ---
const ALLOWED_ROLE_IDS = [
    '1482357650367975458', // 관리자 역할 1 
    '1480570310116773888', // 부관리자 역할 2 
    '1460522936921227347'
];

// --- 1. 상태 유지용 웹 서버 ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('봇이 정상 작동 중입니다! (수동 경고 & 한도 추방 모드)'));
app.listen(PORT, () => console.log(`웹 서버가 ${PORT} 포트에서 준비되었습니다.`));

// --- 2. MongoDB 연동 ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('몽고DB 연결 성공'))
    .catch((err) => console.error('몽고DB 연결 실패:', err));

const warningSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    count: { type: Number, default: 0 },
    punishmentPeriod: { type: String, default: '없음' }
});
const Warning = mongoose.model('Warning', warningSchema);

const guildSettingsSchema = new mongoose.Schema({
    guildId: { type: String, unique: true },
    maxWarnings: { type: Number, default: 3 }, // 🌟 경고 한도 세팅 복구
    welcomeChannelId: { type: String, default: null }
});
const GuildSettings = mongoose.model('GuildSettings', guildSettingsSchema);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// --- 3. 슬래시 명령어 등록 ---
client.on('ready', async () => {
    console.log(`${client.user.tag} 로그인이 완료되었습니다!`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    // 전역 명령어 (채널설정)
    const globalCommands = [
        new SlashCommandBuilder()
            .setName('채널설정')
            .setDescription('환영 인사를 보낼 채널을 설정합니다. (관리자 전용)')
            .addChannelOption(option => 
                option.setName('채널')
                    .setDescription('환영 인사를 보낼 채팅방을 선택해 주세요.')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) 
    ].map(command => command.toJSON());

    try { await rest.put(Routes.applicationCommands(client.user.id), { body: globalCommands }); } 
    catch (error) { console.error('전역 명령어 등록 에러:', error); }

    // 서버별 명령어 (경고, 경고차감, 경고한도)
    const guildCommands = [
        {
            name: '경고',
            description: '관리자가 직접 유저에게 경고를 부여합니다.',
            options: [
                { name: '대상', description: '경고를 줄 대상자를 선택하세요.', type: ApplicationCommandOptionType.User, required: true },
                { name: '이유', description: '경고를 부여하는 명확한 이유를 적으세요.', type: ApplicationCommandOptionType.String, required: true },
                { name: '무슨말', description: '해당 유저가 무슨 행동이나 말을 했는지 적으세요.', type: ApplicationCommandOptionType.String, required: true },
                { 
                    name: '조치사항', 
                    description: '유저에게 취할 조치 사항을 선택하세요.', 
                    type: ApplicationCommandOptionType.String, 
                    required: true,
                    choices: [
                        { name: '📢 구두 경고', value: '구두 경고' },
                        { name: '⏳ 10분 타임아웃', value: '10분 타임아웃' },
                        { name: '⏳ 1시간 타임아웃', value: '1시간 타임아웃' },
                        { name: '⏰ 하루 (24시간) 타임아웃', value: '하루 타임아웃' },
                        { name: '⏰ 일주일 (7일) 타임아웃', value: '7일 타임아웃' },
                        { name: '🚨 서버 추방 (킥)', value: '서버 추방 (킥)' },
                        { name: '🚫 서버 차단 (밴)', value: '서버 차단 (밴)' }
                        // 필요시 이전 선택지 추가 가능
                    ]
                }
            ]
        },
        {
            name: '경고차감',
            description: '관리자가 유저의 누적 경고 수를 차감합니다.',
            options: [
                { name: '대상', description: '경고를 차감할 대상 유저를 선택하세요.', type: ApplicationCommandOptionType.User, required: true },
                { name: '차감수', description: '차감할 경고 개수를 적으세요.', type: ApplicationCommandOptionType.Integer, required: true },
                { name: '처벌해제', description: '이 유저의 타임아웃 제재도 함께 해제하시겠습니까?', type: ApplicationCommandOptionType.Boolean, required: true },
                { name: '사유', description: '경고를 차감해주는 명확한 사유를 적으세요.', type: ApplicationCommandOptionType.String, required: false }
            ]
        },
        {
            name: '경고한도', // 🌟 복구됨
            description: '서버의 최대 누적 경고 제한 수치를 확인하거나 수정합니다.',
            options: [
                { name: '설정값', description: '변경할 경고 한도 숫자가 있으면 입력하세요. (비워두면 현재 한도 조회)', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        }
    ];

    try {
        client.guilds.cache.forEach(async (guild) => {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: guildCommands });
        });
        console.log('서버별 명령어 최신화 성공 (경고한도 포함)!');
    } catch (error) { console.error('서버 명령어 등록 에러:', error); }
});

// --- 4. 슬래시 명령어 처리 ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    const noPermissionEmbed = new EmbedBuilder()
        .setTitle('❌ 권한 거부')
        .setDescription('이 명령어를 사용할 수 있는 권한이 없습니다.')
        .setColor(0xFF0000);

    // 1️⃣ 채널 설정 (기본형 유지)
    if (commandName === '채널설정') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }
        const channel = interaction.options.getChannel('채널');
        try {
            await GuildSettings.findOneAndUpdate({ guildId: interaction.guildId }, { welcomeChannelId: channel.id }, { upsert: true });
            await interaction.reply({ content: `✅ 앞으로 이 서버의 환영 인사는 ${channel} 채널에 전송됩니다.`, ephemeral: true });
        } catch (error) {
            return interaction.reply({ content: '❌ 데이터베이스 저장 실패', ephemeral: true });
        }
    }

    // 2️⃣ 수동 경고 부여 (🌟 한도 초과 시 자동 추방 로직 포함 & 깔끔한 카드 UI)
    if (commandName === '경고') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });

        const targetUser = interaction.options.getUser('대상');
        const targetMember = interaction.options.getMember('대상'); 
        const reason = interaction.options.getString('이유');
        const whatTheySaid = interaction.options.getString('무슨말');
        const actionTaken = interaction.options.getString('조치사항');

        // 🌟 DB에서 최대 한도값 가져오기
        const settings = await GuildSettings.findOne({ guildId: interaction.guild.id });
        const maxWarnings = settings ? settings.maxWarnings : 3;

        // DB에 경고 +1 누적
        const userData = await Warning.findOneAndUpdate(
            { guildId: interaction.guild.id, userId: targetUser.id }, 
            { $inc: { count: 1 } }, 
            { upsert: true, new: true }
        );
        let finalCount = userData.count;

        let punishmentPeriod = actionTaken;
        let realActionText = `**${actionTaken}**`;
        let isAutoKicked = false;

        // 🌟 한도 초과 체크
        if (finalCount >= maxWarnings && !['서버 차단 (밴)', '서버 추방 (킥)'].includes(actionTaken)) {
            isAutoKicked = true;
            punishmentPeriod = '즉시 추방 (경고 누적 한도 초과)';
            realActionText = `🚨 **경고 한도 초과 (${maxWarnings}회) 자동 추방**`;
        } else if (actionTaken === '서버 추방 (킥)') {
            punishmentPeriod = '즉시 추방';
        } else if (actionTaken === '서버 차단 (밴)') {
            punishmentPeriod = '영구 차단';
        } else if (actionTaken === '구두 경고') {
            punishmentPeriod = '없음';
        }

        await Warning.findOneAndUpdate({ guildId: interaction.guild.id, userId: targetUser.id }, { punishmentPeriod: punishmentPeriod });

        let duration = 0;
        if (actionTaken.includes('분')) duration = parseInt(actionTaken) * 60 * 1000;
        else if (actionTaken.includes('시간')) duration = parseInt(actionTaken) * 60 * 60 * 1000;
        else if (actionTaken === '하루 타임아웃') duration = 24 * 60 * 60 * 1000;
        else if (actionTaken === '7일 타임아웃') duration = 7 * 24 * 60 * 60 * 1000;

        // 디스코드 유저에게 실제 처벌 적용
        if (targetMember) {
            if (isAutoKicked) {
                if (targetMember.kickable) {
                    await targetMember.kick(`경고 한도 초과 (${finalCount}/${maxWarnings})`).catch(console.error);
                } else {
                    realActionText += `\n❌ *(실패: 봇의 권한이 대상보다 낮습니다)*`;
                }
            } else {
                if (duration > 0 && targetMember.moderatable) {
                    await targetMember.timeout(duration, `관리자 수동 제재: ${reason}`).catch(console.error);
                } else if (actionTaken === '서버 추방 (킥)' && targetMember.kickable) {
                    await targetMember.kick(`관리자 수동 제재: ${reason}`).catch(console.error);
                } else if (actionTaken === '서버 차단 (밴)' && targetMember.bannable) {
                    await targetMember.ban({ reason: `관리자 수동 제재: ${reason}` }).catch(console.error);
                }
            }
        }

        // 🌟 깔끔한 임베드 카드 렌더링
        const warnChannel = interaction.guild.channels.cache.find(ch => ch.name === '경고');
        const manualEmbed = new EmbedBuilder()
            .setAuthor({ name: '⚠️ 관리자 수동 제재 로그', iconURL: interaction.user.displayAvatarURL() })
            .setColor(isAutoKicked ? 0xFF0000 : 0xFF9900) // 킥이면 빨강, 일반이면 주황
            .setDescription(`**${targetUser.tag}** 님에게 제재가 가해졌습니다.\n<@${targetUser.id}>`)
            .addFields(
                { name: '📌 조치 결과', value: `> ${realActionText}`, inline: false },
                { name: '📈 누적 경고', value: `> **${finalCount}** / ${maxWarnings}회`, inline: true },
                { name: '⏱️ 처벌 기간', value: `> \`${punishmentPeriod}\``, inline: true },
                { name: '📝 제재 사유', value: `\`\`\`${reason}\`\`\``, inline: false },
                { name: '💬 문제의 발언/행동', value: `\`\`\`${whatTheySaid}\`\`\``, inline: false }
            )
            .setFooter({ text: `시행자: ${interaction.user.tag}` })
            .setTimestamp();
            
        if (warnChannel) await warnChannel.send({ embeds: [manualEmbed] }).catch(() => {});
        await interaction.reply({ embeds: [manualEmbed] });
    }

    // 3️⃣ 경고 차감 (깔끔한 카드 UI)
    if (commandName === '경고차감') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });

        const targetUser = interaction.options.getUser('대상');
        const targetMember = interaction.options.getMember('대상'); 
        const reduceAmount = interaction.options.getInteger('차감수');
        const liftTimeout = interaction.options.getBoolean('처벌해제'); 
        const reason = interaction.options.getString('사유') || '사유 미기재';
        
        let userData = await Warning.findOne({ guildId: interaction.guild.id, userId: targetUser.id });
        let beforeCount = userData ? userData.count : 0;
        let afterCount = Math.max(0, beforeCount - reduceAmount);

        let timeoutLiftedText = '처벌 유지';
        if (liftTimeout) {
            if (targetMember && targetMember.moderatable && targetMember.communicationDisabledUntilTimestamp > Date.now()) {
                await targetMember.timeout(null, `경고 차감으로 인한 해제`).catch(console.error);
                timeoutLiftedText = '✅ 타임아웃 즉시 해제됨';
            } else {
                timeoutLiftedText = '➖ 적용 가능한 타임아웃 없음';
            }
        }

        await Warning.findOneAndUpdate(
            { guildId: interaction.guild.id, userId: targetUser.id }, 
            { count: afterCount, punishmentPeriod: '없음' }, 
            { upsert: true }
        );
        
        // 🌟 깔끔한 임베드 카드 렌더링
        const warnChannel = interaction.guild.channels.cache.find(ch => ch.name === '경고');
        const deductEmbed = new EmbedBuilder()
            .setAuthor({ name: '🛡️ 경고 차감 로그', iconURL: interaction.user.displayAvatarURL() })
            .setColor(0x00CC66) // 초록색 계열
            .setDescription(`**${targetUser.tag}** 님의 경고가 차감되었습니다.\n<@${targetUser.id}>`)
            .addFields(
                { name: '📉 경고 변동 내역', value: `> **${beforeCount}회** ➔ **${afterCount}회** (\`-${reduceAmount}\`)`, inline: true },
                { name: '🔓 타임아웃 해제 여부', value: `> ${timeoutLiftedText}`, inline: true },
                { name: '📝 차감 사유', value: `\`\`\`${reason}\`\`\``, inline: false }
            )
            .setFooter({ text: `시행자: ${interaction.user.tag}` })
            .setTimestamp();
            
        if (warnChannel) await warnChannel.send({ embeds: [deductEmbed] }).catch(() => {});
        await interaction.reply({ embeds: [deductEmbed] });
    }

    // 4️⃣ 경고 한도 (🌟 복구 완료 & 깔끔한 카드 UI)
    if (commandName === '경고한도') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });

        const newLimit = interaction.options.getInteger('설정값');
        
        if (newLimit === null) {
            // 한도 조회
            const settings = await GuildSettings.findOne({ guildId: interaction.guild.id });
            const currentLimit = settings ? settings.maxWarnings : 3;

            const infoEmbed = new EmbedBuilder()
                .setAuthor({ name: '⚙️ 서버 경고 한도 조회', iconURL: interaction.guild.iconURL() })
                .setColor(0x3498DB) // 파란색
                .setDescription('유저가 해당 횟수에 도달하면 시스템이 **자동으로 추방(Kick)** 처리합니다.')
                .addFields({ name: '현재 설정된 최대 한도', value: `> **${currentLimit}회**` });
            return await interaction.reply({ embeds: [infoEmbed] });
        } else {
            // 한도 변경
            await GuildSettings.findOneAndUpdate({ guildId: interaction.guild.id }, { maxWarnings: newLimit }, { upsert: true });

            const updateEmbed = new EmbedBuilder()
                .setAuthor({ name: '⚙️ 서버 경고 한도 업데이트', iconURL: interaction.guild.iconURL() })
                .setColor(0x2ECC71) // 밝은 초록색
                .setDescription('성공적으로 서버 경고 제한 수치가 변경되었습니다.')
                .addFields({ name: '새로운 최대 한도', value: `> **${newLimit}회** 도달 시 자동 추방` })
                .setFooter({ text: `수정자: ${interaction.user.tag}` });
            return await interaction.reply({ embeds: [updateEmbed] });
        }
    }
});

// --- 5. 멤버 입장 환영 인사 ---
client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    try {
        const settings = await GuildSettings.findOne({ guildId: member.guild.id });
        if (!settings || !settings.welcomeChannelId) return;

        const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (channel) {
            channel.send(`${member}님 오셔서 환영합니다!!\n\n╰˚｡⋆📝<#1482351706628161649>에 양식에 맞춰서 자기소개 해주시고 나이성별 비공 가능합니다!\n\n│˚｡⋆📢<#1476962498912714840>에 있는 │˚｡⋆📚<#1476961964419846176>이랑 \n│˚｡⋆⛔<#1497953540688187654> 확인 부탁드리겠습니다!\n\n그리고 2일동안 자기소개 작성 안할 시 퇴장당하실 수 있습니다.`);
        }
    } catch (error) { console.error('환영 채널 불러오기 에러:', error); }
});

client.login(process.env.TOKEN);
