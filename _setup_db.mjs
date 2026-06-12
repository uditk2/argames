import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
const url = 'postgresql://neondb_owner:npg_VZqDIhM6Gj9t@ep-solitary-morning-ahwphpav.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const sql = neon(url);
const schema = readFileSync('./db/schema.sql','utf8');
// split on semicolons at statement end (simple; our schema has no functions/$$).
const stmts = schema.split(/;\s*\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith('--'));
for (const s of stmts) { await sql.query(s); }
console.log('schema applied:', stmts.length, 'statements');
// smoke test: insert + read best + leaderboard
await sql`insert into scores (game, level, escaped, time_s, pct, player, client_id)
          values ('dino-survival','MEDIUM', true, 24.7, 100, 'smoke-test', 'c_smoke')`;
const best = await sql`select min(time_s) t from scores where game='dino-survival' and level='MEDIUM' and escaped`;
const lb = await sql`select player, time_s from scores where game='dino-survival' and level='MEDIUM' and escaped order by time_s asc limit 5`;
console.log('best escape:', best[0].t);
console.log('leaderboard rows:', JSON.stringify(lb));
// cleanup smoke row so we don't pollute real data
await sql`delete from scores where client_id='c_smoke'`;
console.log('cleanup done; rows now:', (await sql`select count(*)::int n from scores`)[0].n);
