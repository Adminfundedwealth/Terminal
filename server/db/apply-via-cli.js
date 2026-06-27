/**
 * Apply migrations using supabase CLI's db push or direct psql connection.
 * Uses the database connection string from Supabase project.
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PROJECT_REF = SUPABASE_URL?.match(/https:\/\/([^.]+)/)?.[1];

console.log('Project ref:', PROJECT_REF);
console.log('URL:', SUPABASE_URL);

// The direct postgres connection string for Supabase
// Format: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
// We'll use the Supabase CLI to execute SQL directly

const migrations = [
  { file: 'migrations/001_terminal_schema.sql', label: '001 — Schema' },
  { file: 'migrations/002_indexes.sql', label: '002 — Indexes' },
  { file: 'migrations/003_rls_policies.sql', label: '003 — RLS' },
];

async function main() {
  console.log('═'.repeat(60));
  console.log('  Applying migrations via Supabase CLI');
  console.log('═'.repeat(60));

  // Try using supabase db execute
  for (const m of migrations) {
    const filePath = resolve(__dirname, m.file);
    console.log(`\n▶ ${m.label}`);
    
    try {
      const output = execSync(
        `supabase db execute --project-ref ${PROJECT_REF} -f "${filePath}"`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      console.log(`  ✓ Applied`);
      if (output.trim()) console.log(`  ${output.trim().substring(0, 200)}`);
    } catch (e) {
      console.log(`  ✗ Error: ${e.stderr?.substring(0, 200) || e.message.substring(0, 200)}`);
    }
  }
}

main();
