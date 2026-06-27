/**
 * Migrate via Supabase Pooler (supavisor)
 * 
 * Supabase pooler accepts service_role key as password for the postgres user.
 * Connection: postgresql://postgres.PROJECT_REF:SERVICE_KEY@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

// Try multiple connection approaches
const connectionOptions = [
  {
    label: 'Direct (port 5432)',
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  },
  {
    label: 'Pooler Session Mode (port 5432)',
    host: `aws-0-ap-south-1.pooler.supabase.com`,
    port: 5432,
    user: `postgres.${projectRef}`,
    password: SUPABASE_SERVICE_KEY,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  },
  {
    label: 'Pooler Transaction Mode (port 6543)',
    host: `aws-0-ap-south-1.pooler.supabase.com`,
    port: 6543,
    user: `postgres.${projectRef}`,
    password: SUPABASE_SERVICE_KEY,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  },
];

async function tryConnect(opts) {
  const pool = new pg.Pool({ ...opts, connectionTimeoutMillis: 10000 });
  try {
    const client = await pool.connect();
    const { rows } = await client.query('SELECT current_user, current_database()');
    console.log(`  ✓ Connected as ${rows[0].current_user} to ${rows[0].current_database}`);
    client.release();
    return pool;
  } catch (err) {
    console.log(`  ✗ Failed: ${err.message.substring(0, 80)}`);
    await pool.end();
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(' Database Migration — Connection Attempts');
  console.log(`═══════════════════════════════════════════`);
  console.log(`Project: ${projectRef}\n`);

  let pool = null;

  for (const opts of connectionOptions) {
    console.log(`Trying: ${opts.label}...`);
    const { label, ...pgOpts } = opts;
    pool = await tryConnect(pgOpts);
    if (pool) break;
  }

  if (!pool) {
    console.error('\n❌ All connection attempts failed.');
    console.error('Set SUPABASE_DB_PASSWORD in server/.env');
    console.error(`Find at: https://supabase.com/dashboard/project/${projectRef}/settings/database`);
    process.exit(1);
  }

  // Run migrations
  const client = await pool.connect();

  try {
    const migration004 = readFileSync(join(__dirname, 'migrations', '004_terminal_tables.sql'), 'utf8');
    const migration005 = readFileSync(join(__dirname, 'migrations', '005_persistence_tables.sql'), 'utf8');
    const migration006 = readFileSync(join(__dirname, 'migrations', '006_phase_progression.sql'), 'utf8');

    console.log('\n▶ Migration 004: Terminal Tables...');
    await client.query(migration004);
    console.log('  ✓ Done');

    console.log('▶ Migration 005: Persistence Tables...');
    await client.query(migration005);
    console.log('  ✓ Done');

    console.log('▶ Migration 006: Phase Progression...');
    await client.query(migration006);
    console.log('  ✓ Done');

    console.log('▶ Foundation tables (audit_log, broker_sessions)...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID, user_id UUID,
        event_type TEXT NOT NULL, event_data JSONB DEFAULT '{}',
        ip_address TEXT, user_agent TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_type ON audit_log(event_type);
      CREATE TABLE IF NOT EXISTS broker_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID, provider TEXT NOT NULL, client_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'connected',
        connected_at TIMESTAMPTZ DEFAULT NOW(), disconnected_at TIMESTAMPTZ,
        error_message TEXT, metadata JSONB DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_broker_sessions_acct ON broker_sessions(account_id);
    `);
    console.log('  ✓ Done');

    console.log('\n═══════════════════════════════════════════');
    console.log(' ✓ ALL MIGRATIONS COMPLETE');
    console.log('═══════════════════════════════════════════');
  } catch (err) {
    console.error(`\n❌ Migration error: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
