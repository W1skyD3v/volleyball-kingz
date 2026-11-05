/** Rewrites the generated catalog seed block in the cosmetics migration from packages/core/src/cosmetics.ts. */
import { readFileSync, writeFileSync } from 'node:fs';
import { catalogSeedSql } from '@vk/core';

const path = 'supabase/migrations/20261017000010_cosmetics.sql';
const src = readFileSync(path, 'utf8');
const next = src.replace(/-- BEGIN CATALOG SEED\n[\s\S]*?-- END CATALOG SEED/, `-- BEGIN CATALOG SEED\n${catalogSeedSql()}-- END CATALOG SEED`);
writeFileSync(path, next);
console.log(next === src ? 'catalog seed already up to date' : 'catalog seed rewritten');
