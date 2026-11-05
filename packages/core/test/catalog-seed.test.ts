import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogSeedSql } from '../src/cosmetics.js';

describe('catalog seed', () => {
  it('the SQL migration matches packages/core/src/cosmetics.ts (run pnpm catalog:sql after editing the catalog)', () => {
    const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/20261017000010_cosmetics.sql'), 'utf8');
    const block = sql.match(/-- BEGIN CATALOG SEED\n([\s\S]*?)-- END CATALOG SEED/)?.[1];
    expect(block).toBe(catalogSeedSql());
  });
});
