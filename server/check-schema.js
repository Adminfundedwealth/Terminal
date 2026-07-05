import { supabase } from './db/client.js';

async function checkSchema() {
  console.log('Checking terminal_traders schema...\n');
  
  const { data, error } = await supabase
    .from('terminal_traders')
    .select('*')
    .limit(1);
  
  if (error) {
    console.log('Error:', error.message);
    console.log('\nTrying alternate column names...');
    
    // Try with different possible column names
    const alternates = ['external_id', 'user_id', 'fw_id'];
    for (const col of alternates) {
      const { data: test, error: testErr } = await supabase
        .from('terminal_traders')
        .select(col)
        .limit(1);
      
      if (!testErr) {
        console.log(`✅ Column '${col}' exists`);
      }
    }
  } else {
    console.log('✅ Table accessible');
    console.log('Sample data:', data);
  }
  
  // Check actual columns
  const { data: columns } = await supabase.rpc('get_table_columns', { table_name: 'terminal_traders' }).catch(() => ({ data: null }));
  console.log('\nColumns:', columns);
}

checkSchema();
