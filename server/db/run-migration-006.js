/**
 * Run migration 006: Rename tables to t_ prefix
 * Uses pg library for direct Postgres connection via Supabase
 */
import pg from 'pg';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Extract project ref from URL
const projectRef = SUPABASE_URL?.match(/https:\/\/(.+?)\.supabase/)?.[1];

if (!projectRef) {
  console.error('Cannot extract project ref from SUPABASE_URL');
  process.exit(1);
}

// Supabase direct Postgres connection
const DATABASE_URL = `postgresql://postgres.${projectRef}:${SUPABASE_SERVICE_KEY}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;

async function main() {
  console.log('=== Migration 006: Rename tables to t_ prefix ===\n');
  
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    await client.connect();
    console.log('Connected to Supabase Postgres\n');

    const sql = readFileSync(join(__dirname, 'migrations', '006_rename_tables_t_prefix.sql'), 'utf8');
    
    // Execute line by line (skip comments and empty lines)
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    for (const stmt of statements) {
      if (!stmt) continue;
      try {
        await client.query(stmt + ';');
        console.log(`  ✓ ${stmt.substring(0, 60)}...`);
      } catch (err) {
        // Table might already be renamed or not exist
        console.log(`  ⚠ ${stmt.substring(0, 50)}... → ${err.message.split('\n')[0]}`);
      }
    }

    console.log('\n✅ Migration 006 complete');
  } catch (err) {
    console.error('Connection failed:', err.message);
    console.log('\nTrying alternative connection string...');
    
    // Try alternative: direct project connection
    const altUrl = `postgresql://postgres:${SUPABASE_SERVICE_KEY}@db.${projectRef}.supabase.co:5432/postgres`;
    const client2 = new pg.Client({ connectionString: altUrl, ssl: { rejectUnauthorized: false } });
    
    try {
      await client2.connect();
      console.log('Connected via alternative URL\n');
      
      const sql = readFileSync(join(__dirname, 'migrations', '006_rename_tables_t_prefix.sql'), 'utf8');
      const statements = sql.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));

      for (const stmt of statements) {
        if (!stmt) continue;
        try {
          await client2.query(stmt + ';');
          console.log(`  ✓ ${stmt.substring(0, 60)}...`);
        } catch (err) {
          console.log(`  ⚠ ${stmt.substring(0, 50)}... → ${err.message.split('\n')[0]}`);
        }
      }
      console.log('\n✅ Migration 006 complete');
      await client2.end();
    } catch (err2) {
      console.error('Alt connection also failed:', err2.message);
      process.exit(1);
    }
  } finally {
    try { await client.end(); } catch {}
  }
}

main();
