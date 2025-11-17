#!/usr/bin/env ts-node

/**
 * Phase 0 Test Runner
 *
 * Runs all Phase 0 baseline tests to establish functionality
 * before the FLEX refactor begins.
 *
 * Usage:
 *   ts-node src/testing/run-phase0-tests.ts [options]
 *
 * Options:
 *   --priority        Run only priority tests
 *   --suite=<name>    Run specific test suite
 *   --test=<pattern>  Run tests matching pattern
 *   --debug-port=N    Debug server port (default: 3015)
 *   --timeout=N       Test timeout in ms (default: 30000)
 *   --skip-connect    Skip debug MCP connection
 */

// Load environment variables from .env file
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { TestRunner, createTestContext, connectDiscord, disconnectDiscord, checkDebugServer } from './test-framework';
import { ALL_TESTS, TEST_SUITES, CRITICAL_TESTS, REAL_TESTS, getTestsByPattern } from './tests';

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  FLEX REFACTOR - PHASE 0 BASELINE TEST SUITE            ║');
  console.log('║                                                          ║');
  console.log('║  ✅ 25 REAL tests with Discord API & Debug Server       ║');
  console.log('║     • Priority (5 tests)                                ║');
  console.log('║     • Discord Integration (3 tests)                     ║');
  console.log('║     • Agent System (2 tests)                            ║');
  console.log('║     • State Management (3 tests)                        ║');
  console.log('║     • MARTEM Components (5 tests)                       ║');
  console.log('║     • Element Tree (3 tests)                            ║');
  console.log('║     • AXON Modules (2 tests)                            ║');
  console.log('║     • Integration (2 tests)                             ║');
  console.log('║                                                          ║');
  console.log('║  🎉 100% COMPLETE - All tests converted to functional!  ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    priority: args.includes('--priority'),
    realOnly: args.includes('--real-only'),
    suite: args.find(a => a.startsWith('--suite='))?.split('=')[1],
    testPattern: args.find(a => a.startsWith('--test='))?.split('=')[1],
    debugPort: parseInt(args.find(a => a.startsWith('--debug-port='))?.split('=')[1] || '3015'),
    timeout: parseInt(args.find(a => a.startsWith('--timeout='))?.split('=')[1] || '30000'),
    skipConnect: args.includes('--skip-connect')
  };

  // Create test context
  console.log('📋 Configuration:');
  console.log(`   Guild ID: ${process.env.DISCORD_GUILD_ID || '966069488137158676'}`);
  console.log(`   Channel ID: ${process.env.DISCORD_CHANNEL_ID || '966069488137158679'}`);
  console.log(`   Bot ID: ${process.env.DISCORD_BOT_ID || '1400417376293359757'}`);
  console.log(`   Debug Port: ${options.debugPort}`);
  console.log(`   Timeout: ${options.timeout}ms`);
  console.log('');

  const context = createTestContext({
    debugPort: options.debugPort,
    timeout: options.timeout
  });

  // Connect to Discord and check debug server
  if (!options.skipConnect) {
    try {
      console.log('🔌 Connecting to Discord...');
      await connectDiscord(context);
    } catch (error: any) {
      console.warn('⚠️  Could not connect to Discord:', error.message);
      console.warn('   Set DISCORD_TEST_TOKEN environment variable');
      console.warn('   Discord tests will be skipped\n');
    }

    try {
      await checkDebugServer(context);
      console.log('');
    } catch (error: any) {
      console.warn('⚠️  Debug server check failed:', error.message);
      console.warn('   Some tests will be skipped\n');
    }
  }

  // Create test runner
  const runner = new TestRunner();

  // Determine which tests to run
  let testsToRun = ALL_TESTS;

  if (options.priority) {
    console.log('🎯 Running priority tests only (5 real tests)\n');
    testsToRun = CRITICAL_TESTS;
  } else if (options.realOnly) {
    console.log('🎯 Running REAL tests only (25 functional tests)\n');
    testsToRun = REAL_TESTS;
  } else if (options.suite) {
    console.log(`🎯 Running test suite: ${options.suite}\n`);
    const suite = TEST_SUITES[options.suite as keyof typeof TEST_SUITES];
    if (!suite) {
      console.error(`❌ Unknown test suite: ${options.suite}`);
      console.error(`   Available suites: ${Object.keys(TEST_SUITES).join(', ')}`);
      process.exit(1);
    }
    testsToRun = suite;
  } else if (options.testPattern) {
    console.log(`🎯 Running tests matching: ${options.testPattern}\n`);
    testsToRun = getTestsByPattern(new RegExp(options.testPattern));
    if (testsToRun.length === 0) {
      console.error(`❌ No tests match pattern: ${options.testPattern}`);
      process.exit(1);
    }
  }

  // Register tests
  runner.registerTests(testsToRun);

  // Run tests
  const startTime = Date.now();
  const results = await runner.runAll(context);
  const duration = Date.now() - startTime;

  // Disconnect from Discord
  if (!options.skipConnect) {
    await disconnectDiscord(context);
  }

  // Print final summary
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  FINAL RESULTS                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  console.log(`Total Tests:    ${results.length}`);
  console.log(`Passed:         ${passed} ✅`);
  console.log(`Failed:         ${failed} ❌`);
  console.log(`Skipped:        ${skipped} ⊘`);
  console.log(`Total Duration: ${duration}ms`);
  console.log('');

  if (runner.allPassed()) {
    console.log('🎉 All tests passed! Ready for FLEX refactor Phase 1.\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Please fix before proceeding.\n');

    // List failed tests
    console.log('Failed Tests:');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => {
        console.log(`  ${r.id}: ${r.name}`);
        if (r.errors && r.errors.length > 0) {
          r.errors.forEach(err => console.log(`     - ${err}`));
        }
      });
    console.log('');

    process.exit(1);
  }
}

// Run main function
main().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
