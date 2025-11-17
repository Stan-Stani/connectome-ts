/**
 * Test Framework for FLEX Refactor Phase 0
 *
 * Provides infrastructure for testing Discord-app functionality
 * before and during the FLEX refactor to ensure no regressions.
 */

import { EventEmitter } from 'events';

export interface TestResult {
  id: string;           // e.g., "TEST-001"
  name: string;         // e.g., "Discord Connection"
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;     // milliseconds
  errors?: string[];    // Failure details
  verified: {           // What was verified
    [key: string]: any;
  };
  logs?: string[];      // Test execution logs
}

import { DiscordTestClient, DebugServerClient } from './test-helpers';

export interface TestContext {
  // Real Discord client
  discord: DiscordTestClient | null;

  // Real debug server client
  debugServer: DebugServerClient | null;

  // Test configuration
  config: {
    guildId: string;
    channelId: string;
    botId: string;
    debugPort: number;
    timeout: number;
    discordToken?: string;
  };

  // Test utilities
  log: (message: string) => void;
  error: (message: string) => void;
  waitFor: (condition: () => Promise<boolean>, timeout?: number) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}

export abstract class BaseTest {
  abstract id: string;
  abstract name: string;
  abstract priority: number;

  protected context!: TestContext;
  protected startTime: number = 0;
  protected logs: string[] = [];
  protected errors: string[] = [];
  protected verified: Record<string, any> = {};

  /**
   * Setup method called before test execution
   */
  async setup(context: TestContext): Promise<void> {
    this.context = context;
    this.logs = [];
    this.errors = [];
    this.verified = {};
  }

  /**
   * Cleanup method called after test execution
   */
  async cleanup(): Promise<void> {
    // Override in subclasses if needed
  }

  /**
   * Main test execution method - must be implemented
   */
  abstract execute(): Promise<void>;

  /**
   * Run the test and return result
   */
  async run(context: TestContext): Promise<TestResult> {
    this.startTime = Date.now();

    try {
      await this.setup(context);

      this.log(`Starting test: ${this.name}`);
      await this.execute();
      this.log(`Test completed successfully`);

      return {
        id: this.id,
        name: this.name,
        status: 'PASS',
        duration: Date.now() - this.startTime,
        verified: this.verified,
        logs: this.logs
      };
    } catch (error: any) {
      this.error(`Test failed: ${error.message}`);
      return {
        id: this.id,
        name: this.name,
        status: 'FAIL',
        duration: Date.now() - this.startTime,
        errors: [...this.errors, error.message, error.stack || ''],
        verified: this.verified,
        logs: this.logs
      };
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Log a message
   */
  protected log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    this.logs.push(logMessage);
    this.context?.log?.(logMessage);
  }

  /**
   * Log an error
   */
  protected error(message: string): void {
    this.errors.push(message);
    this.context?.error?.(message);
  }

  /**
   * Mark something as verified
   */
  protected verify(key: string, value: any): void {
    this.verified[key] = value;
    this.log(`Verified: ${key} = ${JSON.stringify(value)}`);
  }

  /**
   * Assert a condition is true
   */
  protected assert(condition: boolean, message: string): void {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  /**
   * Assert two values are equal
   */
  protected assertEqual(actual: any, expected: any, message?: string): void {
    if (actual !== expected) {
      const msg = message || `Expected ${expected}, got ${actual}`;
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  /**
   * Assert an object has a property
   */
  protected assertHasProperty(obj: any, property: string, message?: string): void {
    if (!(property in obj)) {
      const msg = message || `Object missing property: ${property}`;
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  /**
   * Wait for a condition to be true
   */
  protected async waitFor(
    condition: () => Promise<boolean>,
    timeout: number = 5000,
    message?: string
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await this.sleep(100);
    }

    throw new Error(message || `Timeout waiting for condition after ${timeout}ms`);
  }

  /**
   * Sleep for a given time
   */
  protected async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export class TestRunner extends EventEmitter {
  private tests: BaseTest[] = [];
  private results: TestResult[] = [];

  /**
   * Register a test
   */
  registerTest(test: BaseTest): void {
    this.tests.push(test);
  }

  /**
   * Register multiple tests
   */
  registerTests(tests: BaseTest[]): void {
    tests.forEach(test => this.registerTest(test));
  }

  /**
   * Run all registered tests
   */
  async runAll(context: TestContext): Promise<TestResult[]> {
    this.results = [];

    // Sort tests by priority
    const sortedTests = [...this.tests].sort((a, b) => a.priority - b.priority);

    console.log(`\n${'='.repeat(60)}`);
    console.log('FLEX REFACTOR - PHASE 0 TEST SUITE');
    console.log(`${'='.repeat(60)}\n`);
    console.log(`Running ${sortedTests.length} tests...\n`);

    for (const test of sortedTests) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Running ${test.id}: ${test.name}`);
      console.log(`${'─'.repeat(60)}`);

      this.emit('test:start', test);

      const result = await test.run(context);
      this.results.push(result);

      this.emit('test:complete', result);

      if (result.status === 'PASS') {
        console.log(`✅ PASSED in ${result.duration}ms`);
      } else if (result.status === 'FAIL') {
        console.log(`❌ FAILED in ${result.duration}ms`);
        if (result.errors) {
          result.errors.forEach(err => console.error(`   ${err}`));
        }
      } else {
        console.log(`⊘ SKIPPED`);
      }
    }

    this.printSummary();

    return this.results;
  }

  /**
   * Run tests matching a filter
   */
  async runFiltered(
    context: TestContext,
    filter: (test: BaseTest) => boolean
  ): Promise<TestResult[]> {
    const originalTests = [...this.tests];
    this.tests = this.tests.filter(filter);

    const results = await this.runAll(context);

    this.tests = originalTests;
    return results;
  }

  /**
   * Print test summary
   */
  private printSummary(): void {
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const skipped = this.results.filter(r => r.status === 'SKIP').length;
    const total = this.results.length;

    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log(`\n${'='.repeat(60)}`);
    console.log('TEST SUMMARY');
    console.log(`${'='.repeat(60)}`);
    console.log(`Total:   ${total} tests`);
    console.log(`Passed:  ${passed} tests ✅`);
    console.log(`Failed:  ${failed} tests ❌`);
    console.log(`Skipped: ${skipped} tests ⊘`);
    console.log(`Duration: ${totalDuration}ms`);
    console.log(`${'='.repeat(60)}\n`);

    if (failed > 0) {
      console.log('Failed Tests:');
      this.results
        .filter(r => r.status === 'FAIL')
        .forEach(r => {
          console.log(`  - ${r.id}: ${r.name}`);
        });
      console.log('');
    }
  }

  /**
   * Get test results
   */
  getResults(): TestResult[] {
    return this.results;
  }

  /**
   * Check if all tests passed
   */
  allPassed(): boolean {
    return this.results.every(r => r.status === 'PASS' || r.status === 'SKIP');
  }
}

/**
 * Create a test context with default configuration
 */
export function createTestContext(overrides?: Partial<TestContext['config']>): TestContext {
  const config = {
    guildId: process.env.DISCORD_GUILD_ID || '966069488137158676',
    channelId: process.env.DISCORD_CHANNEL_ID || '966069488137158679',
    botId: process.env.DISCORD_BOT_ID || '1400417376293359757',
    debugPort: parseInt(process.env.DEBUG_PORT || '3015'),
    timeout: parseInt(process.env.TEST_TIMEOUT || '30000'),
    discordToken: process.env.DISCORD_TEST_TOKEN,
    ...overrides
  };

  return {
    discord: null,
    debugServer: new DebugServerClient('localhost', config.debugPort),
    config,
    log: (message: string) => console.log(`[LOG] ${message}`),
    error: (message: string) => console.error(`[ERROR] ${message}`),
    waitFor: async (condition: () => Promise<boolean>, timeout?: number) => {
      const maxTime = timeout || config.timeout;
      const startTime = Date.now();

      while (Date.now() - startTime < maxTime) {
        if (await condition()) {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      throw new Error(`Timeout waiting for condition after ${maxTime}ms`);
    },
    sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  };
}

/**
 * Helper to connect Discord test client
 */
export async function connectDiscord(context: TestContext): Promise<void> {
  if (!context.config.discordToken) {
    context.log('⚠️  No DISCORD_TEST_TOKEN provided, Discord tests will be skipped');
    return;
  }

  context.log('Connecting to Discord...');
  context.discord = new DiscordTestClient();
  await context.discord.connect(context.config.discordToken);
  context.log('✅ Discord connected');
}

/**
 * Helper to disconnect Discord test client
 */
export async function disconnectDiscord(context: TestContext): Promise<void> {
  if (context.discord) {
    context.log('Disconnecting from Discord...');
    await context.discord.disconnect();
    context.discord = null;
    context.log('Discord disconnected');
  }
}

/**
 * Helper to check if debug server is available
 */
export async function checkDebugServer(context: TestContext): Promise<boolean> {
  if (!context.debugServer) {
    return false;
  }

  context.log(`Checking debug server at port ${context.config.debugPort}...`);
  const healthy = await context.debugServer.isHealthy();

  if (healthy) {
    context.log('✅ Debug server is available');
  } else {
    context.log('⚠️  Debug server not available, some tests will be skipped');
  }

  return healthy;
}
