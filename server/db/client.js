/**
 * SUPABASE CLIENT
 * 
 * Single source of truth for database connection.
 * Uses service role key — bypasses RLS (backend is trusted).
 * 
 * Required env vars:
 *   SUPABASE_URL - Project URL (https://xxx.supabase.co)
 *   SUPABASE_SERVICE_KEY - Service role key (bypasses RLS)
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[Supabase] WARNING: SUPABASE_URL or SUPABASE_SERVICE_KEY not set. Database features disabled.');
}

export const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

/**
 * Check if Supabase is configured and reachable.
 */
export async function testConnection() {
  if (!supabase) {
    return { connected: false, reason: 'Environment variables not set' };
  }
  try {
    const { data, error } = await supabase.from('t_users').select('id').limit(1);
    if (error) {
      // Table might not exist yet — that's OK, connection is still valid
      if (error.message.includes('schema cache')) {
        return { connected: true, reason: 'OK (tables pending migration)' };
      }
      return { connected: false, reason: error.message };
    }
    return { connected: true, reason: 'OK' };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

