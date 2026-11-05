import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkDefinerExecuteRevoked, checkRatingIgnoresCurrency, checkRatingsTableHasNoCurrency, checkRowLevelSecurity, checkSecurityDefiner, scanSecrets,
} from '../src/index.js';

const root = resolve(import.meta.dirname, '../../..');

describe('scanner catches what it should (synthetic)', () => {
  const FAKE = {
    aws: 'AKIA' + 'IOSFODNN7EXAMPLE',
    gh: 'ghp_' + 'a'.repeat(36),
    sk: 'sk-' + 'a1b2c3d4'.repeat(5),
    jwt: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UifQ', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'].join('.'),
    pk: '-----BEGIN ' + 'PRIVATE KEY-----',
  };
  it.each(Object.entries(FAKE))('flags %s', (_name, value) => {
    expect(scanSecrets('src/x.ts', `const k = "${value}";`).length).toBeGreaterThan(0);
  });
  it('flags a service-role key assignment but not placeholders or env lookups', () => {
    // built at runtime so this file does not itself contain something that looks like a leaked key
    expect(scanSecrets('a.ts', 'SUPABASE_SERVICE_ROLE' + '_KEY=' + 'abcdefghijklmnopqrstuvwxyz123456').length).toBe(1);
    expect(scanSecrets('.env.example', 'SUPABASE_SERVICE_ROLE_KEY=replace-with-local-key-please').length).toBe(0);
    expect(scanSecrets('a.ts', 'const k = process.env.SUPABASE_SERVICE_ROLE_KEY;').length).toBe(0);
    expect(scanSecrets('a.ts', 'SERVICE_ROLE_KEY: ${{ secrets.X }}').length).toBe(0);
  });
  it('flags a committed .env but allows .env.example', () => {
    expect(scanSecrets('apps/mobile/.env', '').map((f) => f.rule)).toEqual(['env-file-tracked']);
    expect(scanSecrets('.env.production', '').length).toBe(1);
    expect(scanSecrets('.env.example', 'EXPO_PUBLIC_X=1')).toEqual([]);
  });
});

describe('SQL structure guards catch violations (synthetic)', () => {
  const m = (sql: string) => [{ file: 'm.sql', sql }];
  it('RLS: a table with no enable-RLS is reported; a commented-out one still is', () => {
    expect(checkRowLevelSecurity(m('create table public.a (id int);')).map((f) => f.detail)).toEqual(['table public.a has no "enable row level security"']);
    expect(checkRowLevelSecurity(m('create table public.a (id int);\n-- alter table public.a enable row level security;'))).toHaveLength(1);
    expect(checkRowLevelSecurity(m('create table public.a (id int);\nalter table public.a enable row level security;'))).toEqual([]);
  });
  it('definer functions must pin search_path', () => {
    expect(checkSecurityDefiner(m('create function public.f() returns int language sql security definer as $$ select 1 $$;'))).toHaveLength(1);
    expect(checkSecurityDefiner(m('create function public.f() returns int language sql security definer set search_path = public as $$ select 1 $$;'))).toEqual([]);
    expect(checkSecurityDefiner(m('create function public.f() returns int language sql as $$ select 1 $$;'))).toEqual([]);
  });
  it('definer functions must have EXECUTE revoked from PUBLIC unless allow-listed', () => {
    const f = 'create function public.f() returns int language sql security definer set search_path = public as $$ select 1 $$;';
    expect(checkDefinerExecuteRevoked(m(f), [])).toHaveLength(1);
    expect(checkDefinerExecuteRevoked(m(`${f}\nrevoke execute on function public.f() from public, anon;`), [])).toEqual([]);
    expect(checkDefinerExecuteRevoked(m(f), ['f'])).toEqual([]);
    // a revoke for a DIFFERENT function earlier in the file must not count (the regex used to span statements)
    expect(checkDefinerExecuteRevoked(m(`revoke execute on function public.other() from public;\n${f}`), [])).toHaveLength(1);
  });
  it('rating code and the ratings table may not reference currency', () => {
    expect(checkRatingIgnoresCurrency('export const x = goldBonus * 2;')).toHaveLength(1);
    expect(checkRatingIgnoresCurrency('// gold never affects rating\nexport const x = 1;')).toEqual([]);
    expect(checkRatingsTableHasNoCurrency(m('create table public.ratings (\n  user_id uuid,\n  gold_bonus int\n);'))).toHaveLength(1);
    expect(checkRatingsTableHasNoCurrency(m('create table public.ratings (\n  user_id uuid,\n  mu double precision\n);'))).toEqual([]);
  });
});

describe('THE REPO obeys its own rules', () => {
  // tracked AND new-but-not-ignored files, so a file you have not committed yet is still scanned locally (CI only ever sees committed ones)
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const migrationsDir = join(root, 'supabase/migrations');
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ file: `supabase/migrations/${f}`, sql: readFileSync(join(migrationsDir, f), 'utf8') }));

  it('no secrets or real .env files are tracked', () => {
    const skip = /(^|\/)(pnpm-lock\.yaml|data\/|node_modules\/)|\.(png|jpg|svg|ico|ttf)$/;
    const findings = tracked.filter((f) => !skip.test(f) && statSync(join(root, f)).size < 1_000_000).flatMap((f) => scanSecrets(f, readFileSync(join(root, f), 'utf8')));
    expect(findings).toEqual([]);
  });
  it('every table has row level security', () => {
    expect(migrations.length).toBeGreaterThan(5);
    expect(checkRowLevelSecurity(migrations)).toEqual([]);
  });
  it('every SECURITY DEFINER function pins its search_path', () => {
    expect(checkSecurityDefiner(migrations)).toEqual([]);
  });
  it('every SECURITY DEFINER function has EXECUTE revoked from PUBLIC (explicit allow-list for deliberate exceptions)', () => {
    // The only deliberate exception: the public leaderboard (also pinned by pgTAP file 08, which asks Postgres directly).
    expect(checkDefinerExecuteRevoked(migrations, ['leaderboard'])).toEqual([]);
  });
  it('rating can never depend on Gold: not in the rating module, not in the ratings table', () => {
    expect(checkRatingIgnoresCurrency(readFileSync(join(root, 'packages/core/src/rating.ts'), 'utf8'))).toEqual([]);
    expect(checkRatingsTableHasNoCurrency(migrations)).toEqual([]);
  });
});

import { checkWorkflow } from '../src/index.js';

describe('workflow cost guard', () => {
  const wf = (cron: string) => `name: x\non:\n  schedule:\n    - cron: '${cron}'\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  it.each([['*/10 * * * *'], ['* * * * *'], ['0,30 * * * *'], ['*/5 * * * *']])('rejects a cron that can run more than hourly: %s', (cron) => {
    expect(checkWorkflow('w.yml', wf(cron)).map((f) => f.rule)).toEqual(['workflow-cron-too-frequent']);
  });
  it.each([['17 6 * * 1'], ['0 * * * *'], ['5 4 * * *']])('accepts at-most-hourly crons: %s', (cron) => {
    expect(checkWorkflow('w.yml', wf(cron))).toEqual([]);
  });
  it('rejects invalid YAML (a broken workflow is silently skipped by GitHub)', () => {
    expect(checkWorkflow('w.yml', 'jobs: { a: ${{ x }}, b: 1 }')[0]?.rule).toBe('workflow-invalid-yaml');
  });
  it('every real workflow in this repo parses and stays inside the free allowance', () => {
    const dir = join(root, '.github/workflows');
    const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    const findings = files.flatMap((f) => checkWorkflow(`.github/workflows/${f}`, readFileSync(join(dir, f), 'utf8')));
    expect(findings).toEqual([]);
  });
});
