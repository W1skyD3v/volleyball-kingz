/**
 * Repo guards: promises that used to live only in prose (CLAUDE.md, docs, persona prompts) enforced as code.
 * "A control the agent can decline to invoke is not a security control": these run in `pnpm check` and CI.
 */

export interface Finding {
  rule: string;
  file: string;
  line?: number;
  detail: string;
}

// ---------------------------------------------------------------- secrets
interface SecretRule {
  id: string;
  re: RegExp;
}
const SECRET_RULES: SecretRule[] = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'anthropic-or-openai-key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // A real Supabase service-role or anon key is a JWT; the payload names the role.
  { id: 'supabase-jwt', re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b/ },
  { id: 'key-assignment', re: /(?:SERVICE_ROLE_KEY|SECRET_KEY|API_KEY|ACCESS_TOKEN|PRIVATE_KEY)\s*[=:]\s*['"]?(?!replace-with|your-|xxx|<|\$\{|process\.env)[A-Za-z0-9/+_.=-]{24,}/ },
];
const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/;

/** Scan one file's text. `path` decides allowances (.env.example is allowed, and holds placeholders only). */
export function scanSecrets(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  if (ENV_FILE.test(path) && !/\.env\.example$/.test(path)) {
    out.push({ rule: 'env-file-tracked', file: path, detail: 'a real .env file must never be committed; use .env.example with placeholders' });
  }
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    for (const r of SECRET_RULES) {
      if (r.re.test(l)) out.push({ rule: `secret:${r.id}`, file: path, line: i + 1, detail: `matches ${r.id}` });
    }
  });
  return out;
}

// ---------------------------------------------------------------- SQL structure
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every `create table public.X` must have `alter table public.X enable row level security` somewhere in the migrations. */
export function checkRowLevelSecurity(migrations: { file: string; sql: string }[]): Finding[] {
  const all = migrations.map((m) => stripSqlComments(m.sql)).join('\n');
  const out: Finding[] = [];
  for (const m of migrations) {
    for (const t of stripSqlComments(m.sql).matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)) {
      const name = t[1]!;
      if (!new RegExp(`alter\\s+table\\s+public\\.${name}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(all)) {
        out.push({ rule: 'rls-missing', file: m.file, detail: `table public.${name} has no "enable row level security"` });
      }
    }
  }
  return out;
}

/** Every SECURITY DEFINER function must pin its search_path (otherwise a caller can shadow objects it resolves). */
export function checkSecurityDefiner(migrations: { file: string; sql: string }[]): Finding[] {
  const out: Finding[] = [];
  for (const m of migrations) {
    const sql = stripSqlComments(m.sql);
    for (const f of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\$\$/gi)) {
      const header = f[0];
      if (/security\s+definer/i.test(header) && !/set\s+search_path/i.test(header)) {
        out.push({ rule: 'definer-search-path', file: m.file, detail: `${f[1]} is SECURITY DEFINER without "set search_path"` });
      }
    }
  }
  return out;
}

/** Every SECURITY DEFINER function must not be callable by the public/anon role unless explicitly allowed. */
export function checkDefinerExecuteRevoked(migrations: { file: string; sql: string }[], allowPublic: string[]): Finding[] {
  const all = migrations.map((m) => stripSqlComments(m.sql)).join('\n');
  const out: Finding[] = [];
  const names = new Set<string>();
  for (const m of migrations) {
    for (const f of stripSqlComments(m.sql).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\$\$/gi)) {
      if (/security\s+definer/i.test(f[0])) names.add(f[1]!);
    }
  }
  for (const n of names) {
    if (allowPublic.includes(n)) continue;
    // Some revoke statement must mention the function (Postgres grants EXECUTE to PUBLIC by default).
    const revoked = new RegExp(`revoke\\s+(?:all|execute)[^;]*?public\\.${n}\\b[^;]*;`, 'i').test(all);
    if (!revoked) out.push({ rule: 'definer-execute-not-revoked', file: 'supabase/migrations', detail: `public.${n} is SECURITY DEFINER but EXECUTE is never revoked from PUBLIC` });
  }
  return out;
}

// ---------------------------------------------------------------- product invariants
/** Bought or earned currency must never be an input to rating. The rating module may not even mention it. */
export function checkRatingIgnoresCurrency(ratingSource: string): Finding[] {
  const bad = /(gold|wallet|purchas|bought|currency|price)/i.exec(ratingSource.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''));
  return bad ? [{ rule: 'currency-in-rating', file: 'packages/core/src/rating.ts', detail: `rating code references "${bad[0]}"` }] : [];
}

/** The ratings table must have no currency column. */
export function checkRatingsTableHasNoCurrency(migrations: { file: string; sql: string }[]): Finding[] {
  for (const m of migrations) {
    const t = /create\s+table\s+public\.ratings\s*\(([\s\S]*?)\n\);/i.exec(stripSqlComments(m.sql));
    if (t && /gold|wallet|purchase|bought|currency/i.test(t[1]!)) return [{ rule: 'currency-in-ratings-table', file: m.file, detail: 'public.ratings has a currency-related column' }];
  }
  return [];
}
export * from './visual.js';

// ---------------------------------------------------------------- free-tier cost guard
import { parse as parseYaml } from 'yaml';

/**
 * GitHub Free gives 2,000 Actions minutes a month for private repos and bills each run in whole minutes. A cron more often than hourly
 * quietly burns that (every 10 minutes = ~4,300 runs). Workflows must also parse: invalid YAML silently disables a workflow.
 */
export function checkWorkflow(file: string, yamlText: string): Finding[] {
  let doc: { on?: unknown; true?: unknown; jobs?: unknown };
  try {
    doc = parseYaml(yamlText) as typeof doc;
  } catch (e) {
    return [{ rule: 'workflow-invalid-yaml', file, detail: (e as Error).message.split('\n')[0]! }];
  }
  const out: Finding[] = [];
  if (!doc || typeof doc !== 'object' || !doc.jobs) out.push({ rule: 'workflow-no-jobs', file, detail: 'no jobs defined' });
  // YAML 1.1 parsers read the key `on` as boolean true; accept both spellings
  const on = (doc?.on ?? doc?.true) as { schedule?: { cron?: string }[] } | undefined;
  for (const s of on?.schedule ?? []) {
    const minute = (s.cron ?? '').trim().split(/\s+/)[0] ?? '';
    if (!/^\d{1,2}$/.test(minute)) {
      out.push({ rule: 'workflow-cron-too-frequent', file, detail: `cron "${s.cron}" can run more than once an hour; the free private-repo allowance is 2,000 minutes a month` });
    }
  }
  return out;
}
