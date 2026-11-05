/**
 * Moderator CLI (service role / postgres connection). Reports with a safety escalation come first.
 *   pnpm moderation list                 open reports + integrity flags
 *   pnpm moderation close <report-id> [note]
 *   pnpm moderation restore-run <run-id> un-hide a run that was auto-hidden
 *   pnpm moderation expire [hours]       void abandoned/disputed games (default 24h); run this from cron too
 */
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const [cmd, a, b] = process.argv.slice(2);

try {
  if (cmd === 'list' || !cmd) {
    const q = await pool.query('select id, created_at, target_type, target_id, reason, safety_escalation, report_count, details from public.moderation_queue limit 50');
    console.log(q.rows.length ? q.rows.map((r) => `${r.safety_escalation ? '!! SAFETY ' : ''}#${r.id} ${r.target_type}:${r.target_id} ${r.reason} x${r.report_count}${r.details ? ` - ${String(r.details).slice(0, 80)}` : ''}`).join('\n') : 'No open reports.');
    const f = await pool.query('select id, user_id, kind, detail, created_at from public.integrity_flags order by created_at desc limit 20');
    if (f.rows.length) console.log('\nIntegrity flags:\n' + f.rows.map((r) => `#${r.id} ${r.kind} user ${r.user_id}: ${r.detail}`).join('\n'));
  } else if (cmd === 'close' && a) {
    await pool.query("update public.reports set status = 'closed' where id = $1", [a]);
    console.log(`closed ${a}${b ? ` (${b})` : ''}`);
  } else if (cmd === 'restore-run' && a) {
    await pool.query('update public.runs set hidden = false where id = $1', [a]);
    console.log(`restored run ${a}`);
  } else if (cmd === 'expire') {
    const r = await pool.query('select public.expire_stale_games($1) as n', [Number(a ?? 24)]);
    console.log(`voided ${r.rows[0].n} stale game(s)`);
  } else {
    console.log('usage: moderation list | close <id> [note] | restore-run <id> | expire [hours]');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
