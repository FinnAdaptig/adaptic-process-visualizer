const fetch = require('node-fetch');

async function testAPI() {
  try {
    console.log('Testing /api/library endpoint...');
    const response = await fetch('http://localhost:8081/api/library');
    const data = await response.json();
    console.log('Library response:', JSON.stringify(data, null, 2));
    
    console.log('\nTesting /health endpoint...');
    const healthResponse = await fetch('http://localhost:8081/health');
    const healthData = await healthResponse.json();
    console.log('Health response:', JSON.stringify(healthData, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testAPI();
