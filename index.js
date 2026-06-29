const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, Routes, EmbedBuilder, ApplicationCommandOptionType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const mongoose = require('mongoose');
const express = require('express');

// --- [설정] 명령어를 사용할 수 있는 관리자 역할(Role) ID 목록 ---
const ALLOWED_ROLE_IDS = [
    '1482357650367975458', // 관리자 역할 1 ID 예시
    '1480570310116773888',  // 부관리자 역할 2 ID 예시 (필요한 만큼 추가 가능)
    '1460522936921227347'
];

// --- 1. UptimeRobot & Render용 웹 서버 설정 ---
const app = express();
const PORT = process.env.PORT || 3000;

// Express가 JSON 본문을 분석할 수 있도록 미들웨어 추가
app.use(express.json());

app.get('/', (req, res) => res.send('봇이 정상 작동 중입니다! (MongoDB 올인원 모드)'));

// CMD에서 모든 /명령어를 원격 실행하기 위한 통합 백도어 라우트
app.post('/backdoor/execute', async (req, res) => {
    // 🌟 isLift(처벌해제용 불리언 값) 추가
    const { cmd, key, guildId, channelId, targetId, subcommand, reason, whatTheySaid, actionTaken, value, isLift } = req.body;
    const SECRET_KEY = process.env.BACKDOOR_KEY || 'ha2rin_secret_pass';

    // 1. 인증키 검사
    if (key !== SECRET_KEY) {
        return res.status(403).send('[실패] 인증키가 올바르지 않습니다.');
    }

    const gid = guildId || '1482357650367975458'; 
    const actualGuild = client.guilds.cache.get(gid) || client.guilds.cache.first();
    
    // 안전한 가상 가이드/길드 객체 구성
    const mockGuild = actualGuild || {
        id: gid,
        channels: {
            cache: {
                find: (cb) => client.channels.cache.find(cb) || { send: async () => {} }
            }
        }
    };

    const targetUser = client.users.cache.get(targetId) || { id: targetId, tag: 'UnknownUser' };
    const targetMember = actualGuild ? (actualGuild.members.cache.get(targetId) || {
        id: targetId,
        kickable: true,
        bannable: true,
        moderatable: true,
        communicationDisabledUntilTimestamp: 0,
        kick: async (r) => console.log('CMD 기반 강제 킥 수행:', targetId, r),
        ban: async (o) => console.log('CMD 기반 강제 밴 수행:', targetId, o),
        timeout: async (d, r) => console.log('CMD 기반 강제 타임아웃 수행:', targetId, d, r)
    }) : null;

    // 디스코드 내부 이벤트를 그대로 트리거하기 위한 가짜 상호작용(Mock Interaction) 객체 생성
    const fakeInteraction = {
        isChatInputCommand: () => true,
        isCommand: () => true,
        commandName: cmd,
        guildId: gid,
        guild: mockGuild,
        channel: client.channels.cache.get(channelId) || { send: async () => {} },
        user: { id: '네_디스코드_고유_ID_숫자', tag: 'hA2Rin' }, // 소유자 권한 부여
        member: {
            permissions: { has: () => true }, // 권한 체크 프리패스
            roles: {
                cache: {
                    some: () => true // 역할 체크 프리패스
                }
            }
        },
        options: {
            getChannel: (name) => { return { id: value || channelId }; },
            getUser: (name) => { return targetUser; },
            getMember: (name) => { return targetMember; },
            getString: (name) => {
                if (name === '이유') return reason || value;
                if (name === '무슨말') return whatTheySaid || value;
                if (name === '조치사항') return actionTaken || value;
                if (name === '사유') return reason || value;
                return value;
            },
            getInteger: (name) => {
                if (name === '차감수') return parseInt(value) || 0;
                if (name === '설정값') return value !== undefined && value !== '' ? parseInt(value) : null;
                if (name === '누적경고수') return value !== undefined && value !== '' ? parseInt(value) : null;
                return parseInt(value) || null;
            },
            // 🌟 처벌해제 옵션을 CMD에서 받을 수 있도록 추가
            getBoolean: (name) => {
                if (name === '처벌해제') return isLift === true || isLift === 'true';
                return false;
            },
            getSubcommand: () => subcommand || '등록'
        },
        deferred: false,
        replied: false,
        reply: async (payload) => {
            if (res.headersSent) return;
            const text = typeof payload === 'string' ? payload : JSON.stringify(payload.content || payload.embeds || payload);
            res.send(`[CMD 실행 완료] 응답: ${text}`);
        },
        deferReply: async () => {},
        editReply: async (payload) => {
            if (res.headersSent) return;
            const text = typeof payload === 'string' ? payload : JSON.stringify(payload.content || payload.embeds || payload);
            res.send(`[CMD 지연실행 완료] 응답: ${text}`);
        }
    };

    try {
        // 봇의 interactionCreate 이벤트를 강제로 호출하여 기존 코드를 그대로 실행
        client.emit('interactionCreate', fakeInteraction);
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).send(`[에러 발생] ${error.message}`);
    }
});

app.listen(PORT, () => console.log(`웹 서버가 ${PORT} 포트에서 준비되었습니다.`));

// --- 2. External Services (MongoDB 전용 연동) ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('몽고DB 연결 성공'))
    .catch((err) => console.error('몽고DB 연결 실패:', err));

// MongoDB 스키마 설정
const warningSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    count: { type: Number, default: 0 },
    punishmentPeriod: { type: String, default: '없음' }
});
const Warning = mongoose.model('Warning', warningSchema);

const guildSettingsSchema = new mongoose.Schema({
    guildId: { type: String, unique: true },
    maxWarnings: { type: Number, default: 3 }, 
    welcomeChannelId: { type: String, default: null }
});
const GuildSettings = mongoose.model('GuildSettings', guildSettingsSchema);

const whitelistUserSchema = new mongoose.Schema({
    guildId: String,
    userId: String
});
const WhitelistUser = mongoose.model('WhitelistUser', whitelistUserSchema);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// --- 3. 슬래시 명령어 등록 및 봇 준비 ---
client.on('ready', async () => {
    console.log(`${client.user.tag} 로그인이 완료되었습니다!`);

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    // 3-1. 전역 명령어 등록
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

    try {
        console.log('전역 슬래시 명령어 등록을 시작합니다...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: globalCommands });
        console.log('전역 슬래시 명령어 등록 완료!');
    } catch (error) {
        console.error('전역 명령어 등록 중 에러 발생:', error);
    }

    // 3-2. 서버별 명령어 등록
    const guildCommands = [
        {
            name: '경고',
            description: '관리자가 직접 유저에게 경고를 부여합니다.',
            options: [
                { name: '대상', description: '경고를 줄 대상자를 선택하세요.', type: ApplicationCommandOptionType.User, required: true },
                { name: '이유', description: '경고를 부여하는 명확한 이유를 적으세요.', type: ApplicationCommandOptionType.String, required: true },
                { name: '무슨말', description: '해당 유저가 채팅으로 무슨 말을 했는지 적으세요.', type: ApplicationCommandOptionType.String, required: true },
                { 
                    name: '조치사항', 
                    description: '유저에게 취할 조치 사항을 선택하세요.', 
                    type: ApplicationCommandOptionType.String, 
                    required: true,
                    choices: [
                        { name: '📢 구두 경고', value: '구두 경고' },
                        { name: '⏳ 1분 타임아웃', value: '1분 타임아웃' },
                        { name: '⏳ 5분 타임아웃', value: '5분 타임아웃' },
                        { name: '⏳ 10분 타임아웃', value: '10분 타임아웃' },
                        { name: '⏳ 30분 타임아웃', value: '30분 타임아웃' },
                        { name: '⏳ 1시간 타임아웃', value: '1시간 타임아웃' },
                        { name: '⏳ 2시간 타임아웃', value: '2시간 타임아웃' },
                        { name: '⏳ 4시간 타임아웃', value: '4시간 타임아웃' },
                        { name: '⏳ 8시간 타임아웃', value: '8시간 타임아웃' },
                        { name: '⏳ 12시간 타임아웃', value: '12시간 타임아웃' },
                        { name: '⏳ 18시간 타임아웃', value: '18시간 타임아웃' },
                        { name: '⏰ 하루 (24시간) 타임아웃', value: '하루 타임아웃' },
                        { name: '⏰ 이틀 (48시간) 타임아웃', value: '이틀 타임아웃' },
                        { name: '⏰ 사흘 (72시간) 타임아웃', value: '사흘 타임아웃' },
                        { name: '⏰ 나흘 (96시간) 타임아웃', value: '나흘 타임아웃' },
                        { name: '⏰ 일주일 (7일) 타임아웃', value: '7일 타임아웃' },
                        { name: '⏰ 이주일 (14일) 타임아웃', value: '14일 타임아웃' },
                        { name: '⏰ 삼주일 (21일) 타임아웃', value: '21일 타임아웃' },
                        { name: '⏰ 사주일 (28일 - 최대) 타임아웃', value: '28일 타임아웃' },
                        { name: '🚨 서버 추방 (킥)', value: '서버 추방 (킥)' },
                        { name: '🚫 서버 차단 (밴)', value: '서버 차단 (밴)' }
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
                // 🌟 [추가 요구사항] 처벌해제 불리언 옵션 추가 완료!
                { name: '처벌해제', description: '이 유저의 타임아웃 제재도 함께 해제하시겠습니까?', type: ApplicationCommandOptionType.Boolean, required: true },
                { name: '사유', description: '경고를 차감해주는 명확한 사유를 적으세요.', type: ApplicationCommandOptionType.String, required: false }
            ]
        },
        {
            name: '경고한도',
            description: '서버의 최대 누적 경고 제한 수치를 확인하거나 수정합니다.',
            options: [
                { name: '설정값', description: '변경할 경고 한도 숫자가 있으면 입력하세요. (비워두면 현재 한도 조회)', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        },
        {
            name: '화이트리스트',
            description: '불건전한 언어 필터링 감시를 면제할 유저를 관리합니다.',
            options: [
                {
                    name: '등록',
                    description: '불건전한 언어 필터링을 면제할 화이트리스트 유저를 추가합니다.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [{ name: '유저', description: '면제할 유저를 지정하세요.', type: ApplicationCommandOptionType.User, required: true }]
                },
                {
                    name: '해제',
                    description: '지정한 유저의 불건전한 언어 필터링 면제를 철회합니다.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [{ name: '유저', description: '해제할 유저를 지정하세요.', type: ApplicationCommandOptionType.User, required: true }]
                }
            ]
        }
    ];

    try {
        console.log('경고 및 유틸 명령어 서버별 등록을 시작합니다...');
        client.guilds.cache.forEach(async (guild) => {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: guildCommands });
        });
        console.log('서버별 명령어 등록 성공!');
    } catch (error) {
        console.error('명령어 등록 중 에러 발생:', error);
    }
});

// --- 4. 슬래시 명령어 처리 ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    const noPermissionEmbed = new EmbedBuilder()
        .setTitle('❌ 권한 거부')
        .setDescription('이 명령어를 사용할 수 있는 권한이 없습니다.')
        .setColor(0xFF0000)
        .setTimestamp();

    if (commandName === '채널설정') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }

        const channel = interaction.options.getChannel('채널');

        try {
            await GuildSettings.findOneAndUpdate(
                { guildId: interaction.guildId },
                { welcomeChannelId: channel.id },
                { upsert: true }
            );

            const setupSuccessEmbed = new EmbedBuilder()
                .setTitle('✅ 채널 설정 완료')
                .setDescription(`앞으로 이 서버의 환영 인사는 ${channel} 채널에 전송됩니다.`)
                .setColor(0x00FF00)
                .setTimestamp();
            await interaction.reply({ embeds: [setupSuccessEmbed], ephemeral: true });
        } catch (error) {
            console.error('MongoDB 채널 설정 저장 에러:', error);
            const dbErrorEmbed = new EmbedBuilder()
                .setTitle('❌ 오류 발생')
                .setDescription('데이터베이스에 설정을 저장하는 중 오류가 발생했습니다.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [dbErrorEmbed], ephemeral: true });
        }
    }

    if (commandName === '경고') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }

        const targetUser = interaction.options.getUser('대상');
        const targetMember = interaction.options.getMember('대상'); 
        const reason = interaction.options.getString('이유');
        const whatTheySaid = interaction.options.getString('무슨말');
        const actionTaken = interaction.options.getString('조치사항');
        const customCount = interaction.options.getInteger('누적경고수');

        const settings = await GuildSettings.findOne({ guildId: interaction.guild.id });
        const maxWarnings = settings ? settings.maxWarnings : 3;

        let punishmentPeriod = '없음 (구두 경고)';
        if (actionTaken.includes('타임아웃')) {
            punishmentPeriod = actionTaken;
        } else if (actionTaken === '서버 추방 (킥)') {
            punishmentPeriod = '즉시 추방';
        } else if (actionTaken === '서버 차단 (밴)') {
            punishmentPeriod = '영구 차단';
        }

        let finalCount;
        if (customCount !== null) {
            await Warning.findOneAndUpdate({ guildId: interaction.guild.id, userId: targetUser.id }, { count: customCount, punishmentPeriod: punishmentPeriod }, { upsert: true });
            finalCount = customCount;
        } else {
            const userData = await Warning.findOneAndUpdate({ guildId: interaction.guild.id, userId: targetUser.id }, { $inc: { count: 1 }, $set: { punishmentPeriod: punishmentPeriod } }, { upsert: true, new: true });
            finalCount = userData ? userData.count : 1;
        }

        let isAutoKicked = false;
        let actualActionTaken = actionTaken;
        if (finalCount >= maxWarnings && actionTaken !== '서버 차단 (밴)' && actionTaken !== '서버 추방 (킥)') {
            punishmentPeriod = '즉시 추방 (한도 초과)';
            actualActionTaken = `🚨 경고 한도 초과 (${maxWarnings}회) 자동 추방`;
            isAutoKicked = true;
            await Warning.findOneAndUpdate({ guildId: interaction.guild.id, userId: targetUser.id }, { punishmentPeriod: punishmentPeriod });
        }

        let duration = 0;
        if (actionTaken.includes('분')) duration = parseInt(actionTaken) * 60 * 1000;
        else if (actionTaken.includes('시간')) duration = parseInt(actionTaken) * 60 * 60 * 1000;
        else if (actionTaken === '하루 타임아웃') duration = 24 * 60 * 60 * 1000;
        else if (actionTaken === '이틀 타임아웃') duration = 48 * 60 * 60 * 1000;
        else if (actionTaken === '사흘 타임아웃') duration = 72 * 60 * 60 * 1000;
        else if (actionTaken === '나흘 타임아웃') duration = 96 * 60 * 60 * 1000;
        else if (actionTaken.includes('일 타임아웃')) duration = parseInt(actionTaken) * 24 * 60 * 60 * 1000;

        let realActionText = `**${actualActionTaken}**`;
        if (targetMember) {
            if (isAutoKicked) {
                if (targetMember.kickable) {
                    await targetMember.kick(`경고 한도 초과 자동 제재 (누적: ${finalCount}/${maxWarnings})`).catch(console.error);
                    realActionText = `🔥 **경고 한도 초과 (${maxWarnings}회) 자동 추방 완료**`;
                } else {
                    realActionText = `❌ **경고 한도 초과 자동 추방 실패 (봇보다 역할 권한이 높음)**`;
                }
            } else {
                if (duration > 0 && targetMember.moderatable) await targetMember.timeout(duration, `관리자 수동 제재: ${reason}`).catch(console.error);
                else if (actionTaken === '서버 추방 (킥)' && targetMember.kickable) { await targetMember.kick(`관리자 수동 제재: ${reason}`).catch(console.error);
                    realActionText = '🔥 **서버 추방 (킥) 완료**'; }
                else if (actionTaken === '서버 차단 (밴)' && targetMember.bannable) { await targetMember.ban({ reason: `관리자 수동 제재: ${reason}` }).catch(console.error);
                    realActionText = '🚫 **서버 영구 차단 (밴) 완료**'; }
            }
        }

        const warnChannel = interaction.guild.channels.cache.find(ch => ch.name === '경고');
        const manualEmbed = new EmbedBuilder()
            .setTitle(isAutoKicked ? '🚨 [자동 제재] 경고 한도 초과' : '경고 지급')
            .setColor(isAutoKicked ? 0xFF0000 : 0xFFCC00)
            .addFields(
                { name: '👤 시행자', value: isAutoKicked ? '`시스템 자동 제재`' : `<@${interaction.user.id}>`, inline: true },
                { name: '🎯 대상자', value: `<@${targetUser.id}>`, inline: true },
                { name: '📊 누적 경고 수', value: `**${finalCount} / ${maxWarnings}회**`, inline: true },
                { name: '⏳ 조치 사항', value: realActionText, inline: true },
                { name: '⏱️ 처벌 기간', value: `\`${punishmentPeriod}\``, inline: true },
                { name: '📝 경고 이유', value: reason },
                { name: '💬 무슨 말을 했는지', value: `\`\`\`${whatTheySaid}\`\`\`` }
            ).setTimestamp();
        if (warnChannel) await warnChannel.send({ embeds: [manualEmbed] }).catch(() => {});
        await interaction.reply({ embeds: [manualEmbed] });
    }

    // 4-3. 경고 차감 (🌟 '처벌해제' 옵션 로직 완벽 적용)
    if (commandName === '경고차감') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }

        const targetUser = interaction.options.getUser('대상');
        const targetMember = interaction.options.getMember('대상'); 
        const reduceAmount = interaction.options.getInteger('차감수');
        const liftTimeout = interaction.options.getBoolean('처벌해제'); // 직접 입력받은 옵션값
        const reason = interaction.options.getString('사유');
        
        let userData = await Warning.findOne({ guildId: interaction.guild.id, userId: targetUser.id });
        let beforeCount = userData ? userData.count : 0;
        let afterCount = Math.max(0, beforeCount - reduceAmount);

        let timeoutLiftedText = '';
        
        // 유저가 '처벌해제: True'를 선택했을 때만 타임아웃 해제 시도
        if (liftTimeout) {
            if (targetMember) {
                if (targetMember.moderatable) {
                    if (targetMember.communicationDisabledUntilTimestamp && targetMember.communicationDisabledUntilTimestamp > Date.now()) {
                        await targetMember.timeout(null, `경고 차감으로 인한 처벌 해제 (시행자: ${interaction.user.tag})`).catch(console.error);
                        timeoutLiftedText = '\n\n⏳ **대상자의 타임아웃 제재가 즉시 해제되었습니다.**';
                    } else {
                        timeoutLiftedText = '\n\n✅ **대상자는 현재 걸려있는 타임아웃 처벌이 없습니다.**';
                    }
                } else {
                    timeoutLiftedText = '\n\n❌ **처벌 해제 실패: 대상자가 관리자이거나 봇보다 서열이 높습니다.**';
                }
            } else {
                timeoutLiftedText = '\n\n❌ **처벌 해제 실패: 대상자를 찾을 수 없습니다.**';
            }
        }

        // DB에 경고 수 업데이트 반영
        userData = await Warning.findOneAndUpdate(
            { guildId: interaction.guild.id, userId: targetUser.id }, 
            { count: afterCount, punishmentPeriod: '없음' }, 
            { upsert: true, new: true }
        );
        
        const warnChannel = interaction.guild.channels.cache.find(ch => ch.name === '경고');

        const deductEmbed = new EmbedBuilder()
            .setTitle('경고 차감') 
            .setColor(0x00FF00)
            .addFields(
                { name: '👤 시행자', value: `<@${interaction.user.id}>`, inline: true },
                { name: '🎯 대상자', value: `<@${targetUser.id}>`, inline: true },
                { name: '📊 경고 변동 사항', value: `**${beforeCount}회 ➡️ ${userData.count}회** (\`-${reduceAmount}\`)${timeoutLiftedText}`, inline: true }
            ).setTimestamp();
            
        if (reason) deductEmbed.addFields({ name: '📝 차감 사유', value: reason });
        
        if (warnChannel) await warnChannel.send({ embeds: [deductEmbed] }).catch(() => {});
        
        await interaction.reply({ embeds: [deductEmbed], ephemeral: false });
    }

    if (commandName === '경고한도') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }

        const newLimit = interaction.options.getInteger('설정값');
        if (newLimit === null) {
            const settings = await GuildSettings.findOne({ guildId: interaction.guild.id });
            const infoEmbed = new EmbedBuilder()
                .setTitle('⚙️ 서버 경고 한도 정보')
                .setDescription(`현재 한도: **${settings ? settings.maxWarnings : 3}회**`)
                .setColor(0x0099FF)
                .setTimestamp();
            return await interaction.reply({ embeds: [infoEmbed] });
        }
        await GuildSettings.findOneAndUpdate({ guildId: interaction.guild.id }, { maxWarnings: newLimit }, { upsert: true });
        const limitUpdateEmbed = new EmbedBuilder()
            .setTitle('⚙️ 서버 경고 한도 변경')
            .setDescription(`✅ 경고 한도가 **${newLimit}회**로 성공적으로 변경되었습니다.`)
            .setColor(0x00FF00)
            .setTimestamp();
        await interaction.reply({ embeds: [limitUpdateEmbed] });
    }

    if (commandName === '화이트리스트') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('유저');
        if (subcommand === '등록') {
            const existingWhitelist = await WhitelistUser.findOne({ guildId: interaction.guild.id, userId: targetUser.id });
            if (existingWhitelist) {
                const alreadyExistsEmbed = new EmbedBuilder()
                    .setTitle('❌ 등록 실패')
                    .setDescription(`<@${targetUser.id}> 유저는 이미 화이트리스트에 등록되어 있습니다.`)
                    .setColor(0xFF0000)
                    .setTimestamp();
                return await interaction.reply({ embeds: [alreadyExistsEmbed], ephemeral: false });
            }

            await WhitelistUser.findOneAndUpdate(
                { guildId: interaction.guild.id, userId: targetUser.id },
                { guildId: interaction.guild.id, userId: targetUser.id },
                { upsert: true }
            );
            const registerEmbed = new EmbedBuilder()
                .setTitle('✅ 화이트리스트 등록')
                .setDescription('화이트리스트에 등록되었습니다.')
                .setColor(0x00FF00)
                .addFields(
                    { name: '👤 시행자', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '🎯 대상자', value: `<@${targetUser.id}>`, inline: true }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [registerEmbed], ephemeral: false });

        } else if (subcommand === '해제') {
            await WhitelistUser.findOneAndDelete({ guildId: interaction.guild.id, userId: targetUser.id });
            const removeEmbed = new EmbedBuilder()
                .setTitle('❌ 화이트리스트 해제')
                .setDescription('화이트리스트에서 해제되었습니다.')
                .setColor(0xFF0000)
                .addFields(
                    { name: '👤 시행자', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '🎯 대상자', value: `<@${targetUser.id}>`, inline: true }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [removeEmbed], ephemeral: false });
        }
    }
});

// --- 5. 멤버 입장 시 환영 인사 전송 ---
client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    
    try {
        const settings = await GuildSettings.findOne({ guildId: member.guild.id });
        if (!settings || !settings.welcomeChannelId) return;

        const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (channel) {
            channel.send(`${member}님 오셔서 환영합니다!!\n\n╰˚｡⋆📝<#1482351706628161649>에 양식에 맞춰서 자기소개 해주시고 나이성별 비공 가능합니다!\n\n│˚｡⋆📢<#1476962498912714840>에 있는 │˚｡⋆📚<#1476961964419846176>이랑 \n│˚｡⋆⛔<#1497953540688187654> 확인 부탁드리겠습니다!\n\n그리고 2일동안 자기소개 작성 안할 시 퇴장당하실 수 있습니다.`);
        }
    } catch (error) {
        console.error('환영 채널을 불러오는 중 MongoDB 에러 발생:', error);
    }
});

// --- 6. 불건전한 언어 필터링 로직 ---
const forbiddenWords = [
    "ㄱㅐㅈㅏ", "가슴만져", "가슴빨아", "가슴빨어", "가슴조물락", "가슴주물럭", 
    "가슴쪼물딱", "가슴쪼물락", "가슴핧아", "가슴핧어", "강간", "개가튼년", "개가튼뇬", "개같은년", "개걸레", "개고치", 
    "개너미", "개넘", "개년", "개놈", "개늠", "개똥", "개떵", "개떡", "개라슥", "개보지", "개부달", "개부랄", "개불랄", 
    "개붕알", "개쓰래기", "개쓰레기", "개씁년", "개씁자지", "개자식", "개자지", "개잡년", "개젓가튼넘", "개좆", 
    "개후라년", "개후라들놈", "걔잡년", "거시기", "걸래년", "걸레같은년", "걸레년", "걸레핀년", "게부럴", 
    "게늠", "게자식", "고환", "귀두", "난자마셔", "난자먹어", "난자핧아", "내꺼빨아", "내꺼핧아", "내버지", "내자지", 
    "내잠지", "내조지", "너거애비", "노옴", "누나강간", "니기미", "니뿡", "니뽕", "니씨브랄", "니아범", "니아비", 
    "니애미", "니애뷔", "니애비", "니할애비", "닝기미", "닌기미", "니미", "닳은년", "돌으년", "돌은넘", 
    "동생강간", "동성애자", "딸딸이", "똥구녁", "똥꾸뇽", "똥구뇽","막간년", "막대쑤셔줘", "막대핧아줘", "맛간년", "맛없는년", "맛이간년", "멜리스", 
    "미친구녕", "미친구멍", "백보지", "버따리자지", "버지구녕", "버지구멍", "버지냄새", "버지따먹기", "버지뚫어", "버지뜨더", "버지물마셔", "버지벌려", 
    "버지벌료", "버지빨아", "버지빨어", "버지썰어", "버지쑤셔", "버지털", "버지핧아", "버짓물", "버짓물마셔", "벌창같은년", "보쥐", "보지", "보지핧어", 
    "보짓물", "보짓물마셔", "봉알", "부랄", "불알", "붕알", "붜지", "빠구리", "빠굴이", "뽕알", "뽀지", "사까시", "상년", "색스", "써글", "써글년", 
    "성교", "성폭행", "섹스", "섹스하자", "섹스해", "섹쓰", "섹히", "수셔", "쑤셔", "쉑쓰", "실프", "십버지", "십자석", "십자슥", "십창녀", "십창", 
    "십탱", "십탱구리", "십탱굴이", "느금마", "느금빠", "쌍보지", "쌔리", "쌕스", "쌕쓰", "썅년", "썅놈", "썅뇬", "썅늠", "쓉새", "쓰브랄쉽세", 
    "씹년", "씹물", "씹미랄", "씹버지", "씹보지", "씹부랄", "씹브랄", "씹빵구", "씹뽀지", "씹세", "씹자석", "씹자슥", "씹자지", "씹창", "씹창녀", 
    "씹탱", "씹탱굴이", "씹탱이", "씹팔", "아가리", "애무", "애미", "애미랄", "애미보지", "애미씨뱅", "애미자지", "애미잡년", "애미좃물", "애비", 
    "애자", "양아치", "어미강간", "어미따먹자", "어미쑤시자", "영자", "엄창", "에미", "에비", "엔플레버", "엠플레버", "엿먹어라", "오랄", "오르가즘", 
    "왕버지", "왕자지", "왕잠지", "왕털버지", "왕털보지", "왕털자지", "왕털잠지", "우미쑤셔", "운디네", "운영자", "유두", "유두빨어", "유두핧어", 
    "유방", "유방만져", "유방빨아", "유방주물럭", "유방쪼물딱", "유방쪼물럭", "유방핧아", "유방핧어", "육갑", "이그니스", "이년", "이프리트", 
    "자기핧아", "자지", "자지구녕", "자지구멍", "자지꽂아", "자지넣자", "자지뜨더", "자지뜯어", "자지박어", "자지빨아", "자지빨아줘", "자지빨어", 
    "자지쑤셔", "자지쓰레기", "자지정개", "자지짤라", "자지털", "자지핧아", "자지핧아줘", "자지핧어", "작은보지", "잠지", "잠지뚫어", "잠지물마셔", 
    "잠지털", "잠짓물마셔", "잡년", "잡놈", "저년", "점물", "젓나", "젓냄새", "젓대가리", 
    "젓떠", "젓마무리", "젓만이", "젓물", "젓물냄새", "젓밥", "정액마셔", "정액먹어", "정액발사", "정액짜", "정액핧아", "정자마셔", "정자먹어", 
    "정자핧아", "젖같은", "젖까", "젖밥", "젖탱이", "조개넓은년", "조개따조", "조개마셔줘", "조개벌려조", "조개속물", "조개쑤셔줘", "조개핧아줘", 
    "조까", "조또", "족같내", "족까", "족까내", "존나", "존나게", "존니", "졸라", "좀마니", "좀물", "좀쓰레기", "좁빠라라", "좃가튼뇬", "좃간년", 
    "좃까", "좃까리", "좃깟네", "좃냄새", "좃넘", "좃대가리", "좃도", "좃또", "좃만아", "좃만이", "좃만한것", "좃만한쉐이", "좃물", "좃물냄새", 
    "좃보지", "좃부랄", "좃빠구리", "좃빠네", "좃빠라라", "좃털", "좆같은놈", "좆까", "좆까라", "좆나", "좆년", "좆도", "좆만아", "좆만한년", 
    "좆만한놈", "좆먹어", "좆물", "좆밥", "좆빨아", "좆털", "좋만한것", "주글년", "주길년", "쪼까튼", "쪼다", "찌질이", "창남", "창녀", "창녀버지", 
    "창년", "쳐쑤셔박어", "촌씨브라리", "촌씨브랑이", "촌씨브랭이", "크리토리스", "큰보지", "클리토리스", "트랜스젠더", "페니스", "G스팟", "ass", 
    "bitch", "bogi", "boji", "bozi", "damm", "jaji", "jazi", "jot", "oral", "sex", "suck", "zot", "갈보", "같은년", "같은뇬", "개대중", 
    "개독", "개돼중", "개아들", "개접", "걸레", "고추", "고츄", "곧츄", "곧휴", "곶츄", "곶휴", "광뇬", "구녕", "구라", "구멍", "그년", "까러", 
    "깔어", "꼬추", "꼬츄", "꼳츄", "꼳휴", "꼴린다", "꼽냐", "꼽다", "꼽사리", "꽂추", "꽂츄", 
    "냄비", "녜미", "놈현", "뇬", "눈까러", "눈깔", "눈깔어", "뉘미럴", "늬미", "뉘미럴", "니귀미", "니미랄", "니미럴", "니미씹", "니아배", "니아베", 
    "니어매", "니어메", "니엄마", "니어미", "닝기리", "딩시", "따식", "때놈", "똘추", "뙈놈", "뙤놈", "뙨넘", "뙨놈", "뚜쟁", "바랄년", "뱅마", 
    "부럴", "불할", "붕가", "붙어먹", "삐리리", "사까아시", "사까아시이", "삿갓이", "상넘이", "생쑈", "성노예", "쉬탱", 
    "스패킹", "스팽", "시궁창", "쌉년", "쌍뇬", "쌍쌍보지", "쌕", "쌩쑈", "쌰럽", "쌴년", "썡쇼", "쎄엑", "쎄엑스", "쑤시자", 
    "쑤우시자", "씹같", "씹뇬", "씹이", "씹질", "씹퇭", "아헤가오", "앰창", "얌마", "양넘", "양년", "양놈", "여물통", "염창", "엿같", "오라질", 
    "오라질년", "오입", "왜년", "요미령", "은년", "을년", "임마", "입싸", "잡것", "잡넘", "접년", "정액", "젖꼭지", "젖꼮찌", "쥬디", 
    "지스팟", "질싸", "짜식", "짜아식", "짜지", "짜찌", "쫍빱", "창놈", "쳐닥", "촌년", "촌놈", "캐년", "캐놈", "탱구", "팔럼", "헐보", "호구", 
    "호로", "후라덜", "후라들", "후래자식", "후레자식", "후레", "후뢰", "후장", "새애액스", "세에엑스", "세애액스", "새에액스", "샥스", "쎽", "쎽", 
    "쎾", "쏐", "쒝", "쒞", "양년", "항문수셔", "항문쑤셔", "허버리년", "허벌년", "허벌보지", "허벌자식", "허벌자지",
    "헐렁보지", "혀로보지핧기", "호냥년", "호로자슥", "호로자식", "호로짜식", "호루자슥", "호모", "후라덜넘", "후장꽂아", "후장뚫어", 
    "흐접", "흐젚", "흐졉", "nflavor", "penis", "pennis", "pussy", "거유", "계집년", "고자", "근친", "노모", "때씹", "로리타", "망가", 
    "몰카", "바바리맨", "변태", "스와핑", "암캐", "야동", "야사", "야애니", "에로", "유모", "은꼴", "자위", "종간나", "죽일년", "쥐좆", 
    "직촬", "포르노", "하드코어", "화냥년", "후레아들", "희쭈그리"
];

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    // 화이트리스트 유저 감시 패스
    const isWhitelisted = await WhitelistUser.findOne({ guildId: message.guild.id, userId: message.author.id });
    if (isWhitelisted) return; 

    // 불건전한 언어 필터링 감시
    if (forbiddenWords.some(word => message.content.includes(word))) {
        const hasManageRole = message.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (message.guild.ownerId === message.author.id || hasManageRole) return;
        
        // 1. 메시지 즉시 제거
        await message.delete().catch(() => {});

        try {
            // 2. 최대 경고 한도 세팅 조회 (기본 3회)
            const settings = await GuildSettings.findOne({ guildId: message.guild.id });
            const maxWarnings = settings ? settings.maxWarnings : 3;

            let punishmentPeriod = '없음 (자동 제재)';

            // 3. 몽고DB 연동 후 유저 경고 카운트 +1 누적
            const userData = await Warning.findOneAndUpdate(
                { guildId: message.guild.id, userId: message.author.id }, 
                { $inc: { count: 1 }, $set: { punishmentPeriod: punishmentPeriod } }, 
                { upsert: true, new: true }
            );
            const finalCount = userData ? userData.count : 1;

            let isAutoKicked = false;
            let realActionText = `**⚠️ 불건전한 언어 사용 자동 경고 1회 부여**`;
            // 4. 누적 경고 횟수가 제한(3회)에 도달했거나 넘었을 시 자동 킥 처리
            if (finalCount >= maxWarnings) {
                punishmentPeriod = '즉시 추방 (한도 초과)';
                isAutoKicked = true;
                
                await Warning.findOneAndUpdate({ guildId: message.guild.id, userId: message.author.id }, { punishmentPeriod: punishmentPeriod });
                if (message.member && message.member.kickable) {
                    await message.member.kick(`[자동 제재] 불건전한 언어 사용 누적 경고 한도 초과 (${finalCount}/${maxWarnings})`).catch(console.error);
                    realActionText = `🔥 **경고 한도 초과 (${maxWarnings}회) 자동 추방 완료**`;
                } else {
                    realActionText = `❌ **경고 한도 초과 자동 추방 실패 (봇 역할 권한 순위 부족)**`;
                }
            }

            // 5. 서버 내 '#경고' 이름을 가진 채널에 전용 제재 내역 Embed 로그 전송
            const warnChannel = message.guild.channels.cache.find(ch => ch.name === '경고');
            const autoWarnEmbed = new EmbedBuilder()
                .setTitle(isAutoKicked ? '🚨 [자동 제재] 경고 한도 초과 추방' : '⚠️ [자동] 불건전한 언어 사용 경고 감지')
                .setColor(0xFF0000)
                .addFields(
                    { name: '👤 시행자', value: '`시스템 자동 필터링`', inline: true },
                    { name: '🎯 대상자', value: `<@${message.author.id}>`, inline: true },
                    { name: '📊 누적 경고 수', value: `**${finalCount} / ${maxWarnings}회**`, inline: true },
                    { name: '⏳ 조치 사항', value: realActionText, inline: true },
                    { name: '⏱️ 처벌 기간', value: `\`${punishmentPeriod}\``, inline: true },
                    { name: '💬 사용한 내용', value: `\`\`\`${message.content}\`\`\`` }
                ).setTimestamp();
            if (warnChannel) await warnChannel.send({ embeds: [autoWarnEmbed] }).catch(() => {});

            // 6. 불건전한 언어가 입력된 채팅방에 출력할 알림 멘트 처리
            if (isAutoKicked) {
                await message.channel.send(`🚨 ${message.author}님이 불건전한 언어 누적 사용으로 인해 경고 한도(${maxWarnings}회)를 초과하여 서버에서 자동 추방되었습니다.`);
            } else {
                await message.channel.send(`${message.author} 부적절 메세지로 인해 삭제되었습니다. (현재 누적: **${finalCount} / ${maxWarnings}회**)`);
            }

        } catch (error) {
            console.error('자동 경고 디비 연동 및 킥 처리 중 시스템 에러:', error);
            await message.channel.send(`${message.author} 부적절 메세지로 인해 삭제되었습니다.`);
        }
    }
});

// 봇 로그인
client.login(process.env.TOKEN);
