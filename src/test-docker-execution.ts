// test-docker-execution.ts

import { DockerExecutionService } from "./service/DockerExecutionService";


async function test() {
  console.log('🚀 Starting Docker Execution Tests...\n');
  
  const executor = new DockerExecutionService();
  
  // Test 1: Python
  console.log('📝 Test 1: Python Execution');
  try {
    const pythonResult = await executor.executeCode(`
print("Hello from Python!")
for i in range(5):
    print(f"Number: {i}")
print("Python execution complete!")
  `, 'python');
    
    console.log('✅ Python Result:', pythonResult.success ? 'SUCCESS' : 'FAILED');
    console.log('Output:', pythonResult.output);
    if (pythonResult.error) console.log('Error:', pythonResult.error);
    console.log(`Time: ${pythonResult.executionTimeMs}ms\n`);
  } catch (error) {
    console.log('❌ Python Error:', error);
  }
  
  // Test 2: JavaScript
  console.log('📝 Test 2: JavaScript Execution');
  try {
    const jsResult = await executor.executeCode(`
console.log("Hello from JavaScript!");
const arr = [1, 2, 3, 4, 5];
console.log("Array sum:", arr.reduce((a,b) => a + b, 0));
console.log("Current time:", new Date().toLocaleTimeString());
  `, 'javascript');
    
    console.log('✅ JavaScript Result:', jsResult.success ? 'SUCCESS' : 'FAILED');
    console.log('Output:', jsResult.output);
    if (jsResult.error) console.log('Error:', jsResult.error);
    console.log(`Time: ${jsResult.executionTimeMs}ms\n`);
  } catch (error) {
    console.log('❌ JavaScript Error:', error);
  }
  
  // Test 3: HTML
  console.log('📝 Test 3: HTML Generation');
  try {
    const htmlResult = await executor.executeCode(`
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <h1>Hello from HTML!</h1>
  <p>This is a test</p>
</body>
</html>
  `, 'html');
    
    console.log('✅ HTML Result:', htmlResult.success ? 'SUCCESS' : 'FAILED');
    console.log('Output length:', htmlResult.output.length, 'characters');
    console.log(`Time: ${htmlResult.executionTimeMs}ms\n`);
  } catch (error) {
    console.log('❌ HTML Error:', error);
  }
  
  // Test 4: Dangerous code (should be blocked)
  console.log('📝 Test 4: Security Test - Dangerous Code');
  try {
    const dangerousResult = await executor.executeCode(`
const fs = require('fs');
console.log("This should fail");
  `, 'javascript');
    
    console.log('✅ Security Test Result:', dangerousResult.success ? 'Code ran (BAD!)' : 'Blocked (GOOD!)');
    if (!dangerousResult.success) {
      console.log('Blocked because:', dangerousResult.error);
    }
    console.log(`Time: ${dangerousResult.executionTimeMs}ms\n`);
  } catch (error) {
    console.log('❌ Security Test Error:', error);
  }
  
  console.log('✨ All tests completed!');
}

// Run the tests
test().catch(console.error);