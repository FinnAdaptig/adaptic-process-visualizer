import fetch from 'node-fetch';

async function checkCurrentAPI() {
  try {
    console.log('🔍 Checking current API responses...\n');
    
    // Test health endpoint
    console.log('Testing health endpoint...');
    const healthRes = await fetch('http://localhost:8082/health');
    if (healthRes.ok) {
      const health = await healthRes.json();
      console.log('✅ Health:', health);
    } else {
      console.log('❌ Health endpoint failed');
    }
    
    // Test library endpoint
    console.log('\nTesting library endpoint...');
    const libraryRes = await fetch('http://localhost:8082/api/library');
    if (libraryRes.ok) {
      const library = await libraryRes.json();
      console.log('📚 Library response:');
      console.log(JSON.stringify(library, null, 2));
    } else {
      console.log('❌ Library endpoint failed');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkCurrentAPI();
