const { Client, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// --- 1. UptimeRobot & Render용 웹 서버 설정 ---
const app = express();
const PORT = process.env.PORT || 3000; // Render에서 제공하는 포트를 사용하거나 기본값 3000 사용

app.get('/', (req, res) => res.send('봇이 정상 작동 중입니다! (DB & 슬래시 커맨드 모드)'));
app.listen(PORT, () => console.log(`웹 서버가 ${PORT} 포트에서 준비되었습니다.`));

// --- 2. 외부 서비스 연결 (Supabase & Discord) ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, 
  ],
});

// --- 3. 슬래시 명령어 등록 및 봇 준비 ---
client.on('ready', async () => {
  console.log(`${client.user.tag} 로그인이 완료되었습니다!`);

  const commands = [
    new SlashCommandBuilder()
      .setName('채널설정')
      .setDescription('환영 인사를 보낼 채널을 설정합니다. (관리자 전용)')
      .addChannelOption(option => 
        option.setName('채널')
          .setDescription('환영 인사를 보낼 채팅방을 선택해 주세요.')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) 
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    console.log('슬래시 명령어 등록을 시작합니다...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('슬래시 명령어 등록 완료!');
  } catch (error) {
    console.error('명령어 등록 중 에러 발생:', error);
  }
});

// --- 4. 슬래시 명령어 처리 (DB 저장) ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === '채널설정') {
    const channel = interaction.options.getChannel('채널');

    const { error } = await supabase
      .from('server_settings')
      .upsert({ 
        guild_id: interaction.guildId, 
        welcome_channel_id: channel.id 
      });

    if (error) {
      console.error('DB 저장 에러:', error);
      return interaction.reply({ content: '❌ 설정 저장 중 오류가 발생했습니다.', ephemeral: true });
    }

    await interaction.reply({
      content: `✅ 설정 완료! 앞으로 이 서버의 환영 인사는 ${channel} 채널에 전송됩니다.`,
      ephemeral: true 
    });
  }
});

// --- 5. 멤버 입장 시 환영 인사 전송 (DB 조회) ---
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
    channel.send(`${member}님 오셔서 환영합니다!! <#1482351706628161649>에 양식에 맞춰서 자기소개 해주시고 나이성별 비공 가능합니다!\n<#1476962498912714840>에 있는 <#1476961964419846176>이랑 <#1497953540688187654> 확인 부탁드리겠습니다!\n그리고 2일동안 자기소개 작성 안할 시 퇴장당하실 수 있습니다.`);
  }
});

// 봇 로그인
client.login(process.env.TOKEN);
