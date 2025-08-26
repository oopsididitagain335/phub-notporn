// bot.js

client.on('guildBanAdd', async (ban) => {
  try {
    // ✅ Get user and guild from ban object
    const user = ban.user;
    const guild = ban.guild;

    if (!user || !guild) {
      return console.warn('[Ban] Missing user or guild data');
    }

    console.log(`🚫 ${user.tag} was banned from ${guild.name}`);

    const User = require('./models/User');
    const dbUser = await User.findOne({ discordId: user.id });

    if (!dbUser) {
      console.log(`ℹ️ No PulseHub account linked for ${user.tag}`);
      return;
    }

    // Fetch reason from audit log
    let reason = 'No reason provided';
    try {
      const audit = await guild.fetchAuditLogs({
        limit: 1,
        type: 'MEMBER_BAN_ADD'
      });
      const log = audit.entries.first();
      if (log && log.target.id === user.id) {
        reason = log.reason || reason;
      }
    } catch (auditErr) {
      console.warn('[Ban] Could not fetch audit log:', auditErr.message);
    }

    // ✅ Mark user as banned
    dbUser.isBanned = true;
    dbUser.banReason = reason;
    await dbUser.save();

    console.log(`✅ ${dbUser.username} marked as banned: ${reason}`);

  } catch (err) {
    console.error('[guildBanAdd] Unexpected error:', err);
    // Never crash the bot
  }
});
