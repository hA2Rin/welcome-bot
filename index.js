const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, Routes, EmbedBuilder, ApplicationCommandOptionType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { createClient } = require('@supabase/supabase-js');
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

app.get('/', (req, res) => res.send('봇이 정상 작동 중입니다! (DB & 슬래시 커맨드 모드)'));
app.listen(PORT, () => console.log(`웹 서버가 ${PORT} 포트에서 준비되었습니다.`));

// --- 2. External Services (Supabase & MongoDB) ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('몽고DB 연결 성공'))
    .catch((err) => console.error('몽고DB 연결 실패:', err));

// MongoDB 스키마 설정
const warningSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    count: { type: Number, default: 0 }
});
const Warning = mongoose.model('Warning', warningSchema);

const guildSettingsSchema = new mongoose.Schema({
    guildId: { type: String, unique: true },
    maxWarnings: { type: Number, default: 5 }
});
const GuildSettings = mongoose.model('GuildSettings', guildSettingsSchema);

// 화이트리스트 유저 스키마 (채널에서 유저로 변경)
const whitelistUserSchema = new mongoose.Schema({
    guildId: String,
    userId: String
});
const WhitelistUser = mongoose.model('WhitelistUser', whitelistUserSchema);

// 디스코드 클라이언트 설정
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

    // 3-1. 전역 명령어 등록 (채널설정)
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

    // 3-2. 서버별 명령어 등록 (경고 및 화이트리스트 기능 포함)
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
                { name: '사유', description: '경고를 차감해주는 명확한 사유를 적으세요.', type: ApplicationCommandOptionType.String, required: false }
            ]
        },
        {
            name: '경고한도',
            description: '서버의 최대 누적 경고 제한 수치를 확인하거나 수정합니다.',
            options: [
                { name: '설정값', description: '변경할 경고 한도 숫자를 입력하세요. (비워두면 현재 한도 조회)', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        },
        {
            name: '화이트리스트',
            description: '금지어 필터링 감시를 면제할 유저를 관리합니다.',
            options: [
                {
                    name: '등록',
                    description: '금지어 필터링을 면제할 화이트리스트 유저를 추가합니다.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [{ name: '유저', description: '면제할 유저를 지정하세요.', type: ApplicationCommandOptionType.User, required: true }]
                },
                {
                    name: '해제',
                    description: '지정한 유저의 금지어 필터링 면제를 철회합니다.',
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

// --- 4. 슬래시 명령어 처리 (Supabase & MongoDB 통합) ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // 공통 권한 에러 임베드 템플릿
    const noPermissionEmbed = new EmbedBuilder()
        .setTitle('❌ 권한 거부')
        .setDescription('이 명령어를 사용할 수 있는 권한이 없습니다.')
        .setColor(0xFF0000)
        .setTimestamp();

    // 4-1. 채널설정 (Supabase) - 기본 관리자 권한 체크 유지
    if (commandName === '채널설정') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }

        const channel = interaction.options.getChannel('채널');
        const { error } = await supabase
            .from('server_settings')
            .upsert({ 
                guild_id: interaction.guildId, 
                welcome_channel_id: channel.id 
            });

        if (error) {
            console.error('DB 저장 에러:', error);
            const dbErrorEmbed = new EmbedBuilder()
                .setTitle('❌ 오류 발생')
                .setDescription('설정 저장 중 오류가 발생했습니다.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [dbErrorEmbed], ephemeral: true });
        }

        const setupSuccessEmbed = new EmbedBuilder()
            .setTitle('✅ 채널 설정 완료')
            .setDescription(`앞으로 이 서버의 환영 인사는 ${channel} 채널에 전송됩니다.`)
            .setColor(0x00FF00)
            .setTimestamp();

        await interaction.reply({ embeds: [setupSuccessEmbed], ephemeral: true });
    }

    // 4-2. 경고 부여 (역할 ID 체크)
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

        let finalCount;
        if (customCount !== null) {
            await Warning.findOneAndUpdate({ guildId: interaction.guild.id, userId: targetUser.id }, { count: customCount }, { upsert: true });
            finalCount = customCount;
        } else {
            const userData = await Warning.findOneAndUpdate({ guildId: interaction.guild.id, userId: targetUser.id }, { $inc: { count: 1 } }, { upsert: true, new: true });
            finalCount = userData ? userData.count : 1;
        }

        let duration = 0;
        if (actionTaken.includes('분')) duration = parseInt(actionTaken) * 60 * 1000;
        else if (actionTaken.includes('시간')) duration = parseInt(actionTaken) * 60 * 60 * 1000;
        else if (actionTaken === '하루 타임아웃') duration = 24 * 60 * 60 * 1000;
        else if (actionTaken === '이틀 타임아웃') duration = 48 * 60 * 60 * 1000;
        else if (actionTaken === '사흘 타임아웃') duration = 72 * 60 * 60 * 1000;
        else if (actionTaken === '나흘 타임아웃') duration = 96 * 60 * 60 * 1000;
        else if (actionTaken.includes('일 타임아웃')) duration = parseInt(actionTaken) * 24 * 60 * 60 * 1000;

        let realActionText = `**${actionTaken}**`;
        if (targetMember) {
            if (duration > 0 && targetMember.moderatable) await targetMember.timeout(duration, `관리자 수동 제재: ${reason}`).catch(console.error);
            else if (actionTaken === '서버 추방 (킥)' && targetMember.kickable) { await targetMember.kick(`관리자 수동 제재: ${reason}`).catch(console.error); realActionText = '🔥 **서버 추방 (킥) 완료**'; }
            else if (actionTaken === '서버 차단 (밴)' && targetMember.bannable) { await targetMember.ban({ reason: `관리자 수동 제재: ${reason}` }).catch(console.error); realActionText = '🚫 **서버 영구 차단 (밴) 완료**'; }
        }

        const warnChannel = interaction.guild.channels.cache.find(ch => ch.name === '경고');
        const manualEmbed = new EmbedBuilder()
            .setTitle('⚠️ [수동 제재] 관리자 경고')
            .setColor(0xFFCC00)
            .addFields(
                { name: '👤 시행자', value: `<@${interaction.user.id}>`, inline: true },
                { name: '🎯 대상자', value: `<@${targetUser.id}>`, inline: true },
                { name: '📊 누적 경고 수', value: `**${finalCount}회**`, inline: true },
                { name: '⏳ 조치 사항', value: realActionText, inline: true },
                { name: '📝 경고 이유', value: reason },
                { name: '💬 무슨 말을 했는지', value: `\`\`\`${whatTheySaid}\`\`\`` }
            ).setTimestamp();

        if (warnChannel) await warnChannel.send({ embeds: [manualEmbed] }).catch(() => {});
        await interaction.reply({ embeds: [manualEmbed] });
    }

    // 4-3. 경고 차감 (역할 ID 체크)
    if (commandName === '경고차감') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }

        const targetUser = interaction.options.getUser('대상');
        const reduceAmount = interaction.options.getInteger('차감수');
        const reason = interaction.options.getString('사유');
        let userData = await Warning.findOne({ guildId: interaction.guild.id, userId: targetUser.id });
        let beforeCount = userData ? userData.count : 0;
        let afterCount = Math.max(0, beforeCount - reduceAmount);

        userData = await Warning.findOneAndUpdate({ guildId: interaction.guild.id, userId: targetUser.id }, { count: afterCount }, { upsert: true, new: true });
        const warnChannel = interaction.guild.channels.cache.find(ch => ch.name === '경고');

        const deductEmbed = new EmbedBuilder()
            .setTitle('🟢 [경고 차감] 관리자 면제 조치')
            .setColor(0x00FF00)
            .addFields(
                { name: '👤 시행자', value: `<@${interaction.user.id}>`, inline: true },
                { name: '🎯 대상자', value: `<@${targetUser.id}>`, inline: true },
                { name: '📊 경고 변동 사항', value: `**${beforeCount}회 ➡️ ${userData.count}회** (\`-${reduceAmount}\`)`, inline: true }
            ).setTimestamp();
        
        if (reason) deductEmbed.addFields({ name: '📝 차감 사유', value: reason });
        if (warnChannel) await warnChannel.send({ embeds: [deductEmbed] }).catch(() => {});
        await interaction.reply({ embeds: [deductEmbed] });
    }

    // 4-4. 경고 한도 설정 (역할 ID 체크)
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
                .setDescription(`현재 한도: **${settings ? settings.maxWarnings : 5}회**`)
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

    // 4-5. 화이트리스트 유저 조작 (역할 ID 체크 - 유저 타겟 및 임베드 변경 완료)
    if (commandName === '화이트리스트') {
        const hasRole = interaction.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (!hasRole) {
            return await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('유저');

        if (subcommand === '등록') {
            await WhitelistUser.findOneAndUpdate(
                { guildId: interaction.guild.id, userId: targetUser.id },
                { guildId: interaction.guild.id, userId: targetUser.id },
                { upsert: true }
            );

            const registerEmbed = new EmbedBuilder()
                .setTitle('✅ 화이트리스트 등록')
                .setDescription(`${targetUser}님이 이제 금지어 필터링 **화이트리스트(면제구역)**로 등록되었습니다.`)
                .setColor(0x00FF00)
                .setTimestamp();

            await interaction.reply({ embeds: [registerEmbed], ephemeral: true });
        } else if (subcommand === '해제') {
            await WhitelistUser.findOneAndDelete({ guildId: interaction.guild.id, userId: targetUser.id });

            const removeEmbed = new EmbedBuilder()
                .setTitle('❌ 화이트리스트 해제')
                .setDescription(`${targetUser}님이 화이트리스트에서 **제거**되어 다시 금지어를 감시합니다.`)
                .setColor(0xFF0000)
                .setTimestamp();

            await interaction.reply({ embeds: [removeEmbed], ephemeral: true });
        }
    }
});

// --- 5. 멤버 입장 시 환영 인사 전송 (Supabase 조회) ---
client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    
    const { data, error } = await supabase
        .from('server_settings')
        .select('welcome_channel_id')
        .eq('guild_id', member.guild.id)
        .single();

    if (error || !data) {
        console.log('이 서버는 환영 채널 설정이 되어있지 않습니다.');
        return;
    }

    const channel = member.guild.channels.cache.get(data.welcome_channel_id);
    
    if (channel) {
        channel.send(`${member}님 오셔서 환영합니다!!

╰˚｡⋆📝<#1482351706628161649>에 양식에 맞춰서 자기소개 해주시고 나이성별 비공 가능합니다!

│˚｡⋆📢<#1476962498912714840>에 있는 │˚｡⋆📚<#1476961964419846176>이랑 │˚｡⋆⛔<#1497953540688187654> 확인 부탁드리겠습니다!

그리고 2일동안 자기소개 작성 안할 시 퇴장당하실 수 있습니다.`);
    }
});

// --- 6. 금지어 필터링 로직 ---
const forbiddenWords = [
    "18년", "18놈", "ㄱㅐㅈㅏ", "가슴만져", "가슴빨아", "가슴빨어", "가슴조물락", "가슴주물럭", 
    "가슴쪼물딱", "가슴쪼물락", "가슴핧아", "가슴핧어", "강간", "개가튼년", "개가튼뇬", "개같은년", "개걸레", "개고치", 
    "개너미", "개넘", "개년", "개놈", "개늠", "개똥", "개떵", "개떡", "개라슥", "개보지", "개부달", "개부랄", "개불랄", 
    "개붕알", "개쓰래기", "개쓰레기", "개씁년", "개씁자지", "개자식", "개자지", "개잡년", "개젓가튼넘", "개좆", 
    "개후라년", "개후라들놈", "걔잡년", "거시기", "걸래년", "걸레같은년", "걸레년", "걸레핀년", "게부럴", 
    "게늠", "게자식", "고환", "귀두", "난자마셔", "난자먹어", "난자핧아", "내꺼빨아", "내꺼핧아", "내버지", "내자지", 
    "내잠지", "내조지", "너거애비", "노옴", "누나강간", "니기미", "니뿡", "니뽕", "니씨브랄", "니아범", "니아비", 
    "니애미", "니애뷔", "니애비", "니할애비", "닝기미", "닌기미", "니미", "닳은년", "돌으년", "돌은넘", 
    "동생강간", "동성애자", "딸딸이", "똥구녁", "똥꾸뇽", "똥구뇽","막간년", "막대쑤셔줘", "막대핧아줘", "맛간년", "맛없는년", "맛이간년", "멜리스", 
    "미친구녕", "미친구멍", 
    "백보지", "버따리자지", "버지구녕", 
    "버지구멍", "버지냄새", "버지따먹기", "버지뚫어", "버지뜨더", "버지물마셔", "버지벌려", "버지벌료", "버지빨아", 
    "버지빨어", "버지썰어", "버지쑤셔", "버지털", "버지핧아", "버짓물", "버짓물마셔", "벌창같은년", "보쥐", 
    "보지", "보지핧어", "보짓물", "보짓물마셔", "봉알", "부랄", "불알", "붕알", "붜지",
    "빠구리", "빠굴이", "뽕알", "뽀지", "사까시", "상년", "색스", "써글", "써글년", "성교", "성폭행", 
    "섹스", "섹스하자", "섹스해", "섹쓰", "섹히", "수셔", "쑤셔", "쉑쓰", "실프", 
    "십버지",  "십자석", "십자슥", "십창녀", "십창", "십탱", "십탱구리", "십탱굴이", "느금마", 
    "느금빠", "쌍보지", "쌔리", "쌕스", "쌕쓰", "썅년", "썅놈", 
    "썅뇬", "썅늠", "쓉새", "쓰브랄쉽세", "씹년", "씹물", "씹미랄", "씹버지", "씹보지", "씹부랄", "씹브랄", 
    "씹빵구", "씹뽀지", "씹세", "씹자석", "씹자슥", "씹자지", "씹창", "씹창녀", "씹탱", "씹탱굴이", "씹탱이", 
    "씹팔", "아가리", "애무", "애미", "애미랄", "애미보지", "애미씨뱅", "애미자지", "애미잡년", "애미좃물", "애비", 
    "애자", "양아치", "어미강간", "어미따먹자", "어미쑤시자", "영자", "엄창", "에미", "에비", "엔플레버", "엠플레버", 
    "엿먹어라", "오랄", "오르가즘", "왕버지", "왕자지", "왕잠지", "왕털버지", "왕털보지", "왕털자지", "왕털잠지", 
    "우미쑤셔", "운디네", "운영자", "유두", "유두빨어", "유두핧어", "유방", "유방만져", "유방빨아", "유방주물럭", 
    "유방쪼물딱", "유방쪼물럭", "유방핧아", "유방핧어", "육갑", "이그니스", "이년", "이프리트", "자기핧아", 
    "자지", "자지구녕", "자지구멍", "자지꽂아", "자지넣자", "자지뜨더", "자지뜯어", "자지박어", "자지빨아", 
    "자지빨아줘", "자지빨어", "자지쑤셔", "자지쓰레기", "자지정개", "자지짤라", "자지털", "자지핧아", "자지핧아줘", 
    "자지핧어", "작은보지", "잠지", "잠지뚫어", "잠지물마셔", "잠지털", "잠짓물마셔", "잡년", "잡놈", 
    "저년", "점물", "젓가튼", "젓가튼쉐이", "젓같내", "젓같은", "젓까", "젓나", "젓냄새", "젓대가리", 
    "젓떠", "젓마무리", "젓만이", "젓물", "젓물냄새", "젓밥", "정액마셔", "정액먹어", "정액발사", "정액짜", 
    "정액핧아", "정자마셔", "정자먹어", "정자핧아", "젖같은", "젖까", "젖밥", "젖탱이", "조개넓은년", 
    "조개따조", "조개마셔줘", "조개벌려조", "조개속물", "조개쑤셔줘", "조개핧아줘", "조까", "조또", "족같내", 
    "족까", "족까내", "존나", "존나게", "존니", "졸라", "좀마니", "좀물", "좀쓰레기", "좁빠라라", 
    "좃가튼뇬", "좃간년", "좃까", "좃까리", "좃깟네", "좃냄새", "좃넘", "좃대가리", "좃도", 
    "좃또", "좃만아", "좃만이", "좃만한것", "좃만한쉐이", "좃물", "좃물냄새", "좃보지", "좃부랄", 
    "좃빠구리", "좃빠네", "좃빠라라", "좃털", "좆같은놈", "좆까", "좆까라", "좆나", "좆년", 
    "좆도", "좆만아", "좆만한년", "좆만한놈", "좆먹어", "좆물", "좆밥", "좆빨아", "좆털", 
    "좋만한것", "주글년", "주길년", "쪼까튼", "쪼다", "찌질이", "창남", "창녀", "창녀버지", 
    "창년", "처먹고", "처먹을", "쳐먹고", "쳐쑤셔박어", "촌씨브라리", "촌씨브랑이", "촌씨브랭이", "크리토리스", 
    "큰보지", "클리토리스", "트랜스젠더", "페니스", "18뇬", 
    "G스팟", "ass", "bitch", "bogi", "boji", "bozi", "damm", "jaji", 
    "jazi", "jot", "oral", "sex", "shit", "shutup", "suck", "zot", "갈보", "같은년", "같은뇬",
    "개대중", "개독", "개돼중", "개뻥", "개뿔", "개아들",  
    "개접","걸레", "고추", "고츄", 
    "곧츄", "곧휴", "곶츄", "곶휴", "광뇬", "구녕", "구라", "구멍", "그년", 
    "까러", "깔어", "꺼져", "껃여", "껃져", "껒여", "꼬봉", "꼬우냐", "꼬추", 
    "꼬츄", "꼳츄", "꼳휴", "꼴린다", "꼽냐", "꼽다", "꼽사리", "꽂추", "꽂츄", 
    "냄비", "녜미", "놈현", "뇬", "눈까러", "눈깔", "눈깔어", "뉘미럴", "늬미", 
    "뉘미럴", "니귀미", "니미랄", "니미럴", "니미씹", "니아배", "니아베", "니어매", 
    "니어메", "니엄마", "니어미", "닝기리",
    "딩시", "따식", "때놈", "똘추", "뙈놈", 
    "뙤놈", "뙨넘", "뙨놈", "뚜쟁", "바랄년", "뱅마", "부럴", 
    "불할", "붕가", "붙어먹", "삐리리", 
    "사까아시", "사까아시이", "삿갓이", "상넘이", "상놈을", "상놈의", "상놈이", 
    "생쑈", "성노예", "쉐리", 
    "쉐에기", "쉗", "쉨", "쉬탱", "스패킹", "스팽", "시궁창", "시방", 
    "시부리", "시팍", "신발끈", "심발끈", "심탱", "십스키",  "싹아지", 
    "쌉년", "쌍뇬", "쌍쌍보지", "쌕", "쌩쑈", "쌰럽", "쌴년", "썅", 
    "썡쇼", "썩을년", "썩을놈", "쎄엑", "쎄엑스", "쑤시자", "쑤우시자", 
    "씹같", "씹뇬", "씹덕", "씹덕후", "씹쉐", "씹스키", "씹이", "씹질", 
    "씹퇭", "아갈", "아갈빡", "아갈이", "아갈통", "아구창", "아구통", "아굴", 
    "아닥", "아헤가오", "앰창", "얌마", "양넘", "양년", "양놈", "여물통", 
    "염창", "엿같", "오라질", "오라질년", "오입", "왜년", "왜놈", "요미령", 
    "은년", "을년", "임마", "입싸", "자슥", "잡것", "잡넘", "접년", 
    "정액", "젖꼭지", "젖꼮찌", "조까치", "조낸", "조랭", "조빠", "조쟁이", 
    "조지냐", "조진다", "조질래", "조찐", "존만", "존만한", "졸래", 
    "좁년", "좁밥", "좃", "좃만", "좃밥", "좃이", "좃찐", "좆", 
    "좆같", "좆또", "좆만", "좆이", "좆찐", "좇같", "좇이", "좋같은", 
    "좋만", "좌식",  "주데이", "주뎅", "주뎅이", "주둥아리", 
    "주둥이", "주디", "주접", "주접떨", "죽고잡", "죽을래", "죽통", "쥬디", 
    "지스팟", "질싸", "짜식", "짜아식", "짜지", "짜찌", "쫍빱", "창놈", 
    "쳐닥", "촌년", "촌놈", "캐년", "캐놈", "탱구", "팔럼", "헐보", "호구", 
    "호로", "후라덜", "후라들", "후래자식", "후레자식", "후레", 
    "후뢰", "후장", "새애액스", "세에엑스", "세애액스", "새에액스", "샥스", "쎽", 
    "쎡", "쎾", "쏐", "쒝", "쒞", "양년", "항문수셔", "항문쑤셔", "허덥", 
    "허버리년", "허벌년", "허벌보지", "허벌자식", "허벌자지", "허접", "허젚", "허졉", 
    "허좁", "헐렁보지", "혀로보지핧기", "호냥년", "호로자슥", "호로자식", "호로짜식", "호루자슥", 
    "호모", "호졉", "호좁", "후라덜넘", "후장꽂아", "후장뚫어", "흐접", "흐젚", 
    "흐졉", "nflavor", "penis", "pennis", "pussy", "개차반", "거유", 
    "계집년", "고자", "근친", "노모", "때씹", "로리타", "망가", "몰카", 
    "바바리맨", "변태", "스와핑",  "암캐", "야동", "야사", "야애니", 
    "에로", "유모", "은꼴", "자위", "종간나", "죽일년", "쥐좆", "직촬", 
    "짱깨", "쪽바리", "포르노", "하드코어", "화냥년", "후레아들", "희쭈그리"
];

client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    // 화이트리스트 유저 체크 (MongoDB 검사 - 채널에서 유저ID 체크로 변경)
    const isWhitelisted = await WhitelistUser.findOne({ guildId: message.guild.id, userId: message.author.id });
    if (isWhitelisted) return; 

    if (forbiddenWords.some(word => message.content.includes(word))) {
        // 필터링 면제 대상: 서버 소유자이거나 관리자 역할(Role)을 가진 유저
        const hasManageRole = message.member.roles.cache.some(role => ALLOWED_ROLE_IDS.includes(role.id));
        if (message.guild.ownerId === message.author.id || hasManageRole) return;
        
        await message.delete().catch(() => {});
        await message.channel.send(`${message.author}님, 금지어 사용으로 삭제되었습니다.`);
    }
});

// 봇 로그인
client.login(process.env.TOKEN);
