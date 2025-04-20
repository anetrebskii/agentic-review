// Simple test to verify the JSON structure of the OpenAI service
const { execSync } = require('child_process');

console.log('Building the project...');
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch (error) {
  console.error('Failed to build the project:', error.message);
  process.exit(1);
}

console.log('Creating test file...');
const fs = require('fs');
const path = require('path');

const testFile = `
import { OpenAIService } from './dist/services/openai-service';
import { CodeReviewConfig } from './dist/config/default-config';

async function runTest() {
  // Create a simple file to test
  const testFile = {
    filename: 'test.js',
    status: 'modified',
    additions: 5,
    deletions: 2,
    changes: 7,
    patch: '@@ -1,3 +1,5 @@\\n function test() {\\n-  return 1;\\n+  // Missing error handling\\n+  const result = someAPICall();\\n+  return result;\\n }\\n',
    blob_url: '',
    raw_url: '',
    contents_url: '',
    changedContent: '1: function test() {\\n2:   // Missing error handling\\n3:   const result = someAPICall();\\n4:   return result;\\n5: }\\n'
  };

  try {
    // Initialize with minimal config
    const config = new CodeReviewConfig();
    config.rules = [
      {
        include: ['*.js'],
        prompt: 'Review this JavaScript code for error handling and best practices.'
      }
    ];
    
    // Set API key via environment variable
    process.env['INPUT_OPENAI-API-KEY'] = process.env.OPENAI_API_KEY;
    
    const openaiService = new OpenAIService(config);
    console.log('Analyzing code changes...');
    
    const analysis = await openaiService.analyzeCodeChanges(testFile);
    console.log('Analysis result:');
    console.log(analysis);
    
    // Try to parse the JSON
    try {
      const parsedResult = JSON.parse(analysis);
      console.log('Successfully parsed JSON response:');
      console.log(JSON.stringify(parsedResult, null, 2));
    } catch (error) {
      console.error('Failed to parse JSON response:', error.message);
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTest();
`;

const testFilePath = path.join(__dirname, 'test-run.ts');
fs.writeFileSync(testFilePath, testFile);

console.log('Running test...');
try {
  execSync(`ts-node ${testFilePath}`, { 
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY
    }
  });
} catch (error) {
  console.error('Test execution failed:', error.message);
}

// Clean up
console.log('Cleaning up...');
fs.unlinkSync(testFilePath); 