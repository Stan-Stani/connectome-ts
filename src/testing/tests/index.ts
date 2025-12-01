/**
 * Test Suite Index
 *
 * Exports all tests for Phase 0 baseline testing
 */

import { BaseTest } from '../test-framework';

// Import all functional tests - 100% complete!
import { PRIORITY_TESTS_REAL } from './priority-tests-real';
import { DISCORD_INTEGRATION_TESTS_REAL } from './discord-integration-tests-real';
import { AGENT_SYSTEM_TESTS_REAL } from './agent-system-tests-real';
import { STATE_MANAGEMENT_TESTS_REAL } from './state-management-tests-real';
import { MARTEM_COMPONENT_TESTS_REAL } from './martem-component-tests-real';
import { ELEMENT_TREE_TESTS_REAL } from './element-tree-tests-real';
import { AXON_MODULE_TESTS_REAL } from './axon-module-tests-real';
import { INTEGRATION_TESTS_REAL } from './integration-tests-real';

/**
 * All tests organized by category
 * ✅ ALL SUITES NOW HAVE REAL FUNCTIONAL TESTS!
 */
export const TEST_SUITES = {
  priority: PRIORITY_TESTS_REAL,                     // ✅ REAL: 5 tests
  discordIntegration: DISCORD_INTEGRATION_TESTS_REAL, // ✅ REAL: 3 tests
  agentSystem: AGENT_SYSTEM_TESTS_REAL,              // ✅ REAL: 2 tests
  stateManagement: STATE_MANAGEMENT_TESTS_REAL,      // ✅ REAL: 3 tests
  martemComponents: MARTEM_COMPONENT_TESTS_REAL,     // ✅ REAL: 5 tests
  elementTree: ELEMENT_TREE_TESTS_REAL,              // ✅ REAL: 3 tests
  axonModules: AXON_MODULE_TESTS_REAL,               // ✅ REAL: 2 tests
  integration: INTEGRATION_TESTS_REAL                // ✅ REAL: 2 tests
};

/**
 * All tests in a flat array - NOW ALL REAL FUNCTIONAL TESTS! 🎉
 */
export const ALL_TESTS: BaseTest[] = [
  ...PRIORITY_TESTS_REAL,              // ✅ 5 real tests
  ...DISCORD_INTEGRATION_TESTS_REAL,   // ✅ 3 real tests
  ...AGENT_SYSTEM_TESTS_REAL,          // ✅ 2 real tests
  ...STATE_MANAGEMENT_TESTS_REAL,      // ✅ 3 real tests
  ...MARTEM_COMPONENT_TESTS_REAL,      // ✅ 5 real tests
  ...ELEMENT_TREE_TESTS_REAL,          // ✅ 3 real tests
  ...AXON_MODULE_TESTS_REAL,           // ✅ 2 real tests
  ...INTEGRATION_TESTS_REAL            // ✅ 2 real tests
];

/**
 * Real functional tests (25 tests total - 100% COMPLETE!)
 */
export const REAL_TESTS: BaseTest[] = [
  ...PRIORITY_TESTS_REAL,
  ...DISCORD_INTEGRATION_TESTS_REAL,
  ...AGENT_SYSTEM_TESTS_REAL,
  ...STATE_MANAGEMENT_TESTS_REAL,
  ...MARTEM_COMPONENT_TESTS_REAL,
  ...ELEMENT_TREE_TESTS_REAL,
  ...AXON_MODULE_TESTS_REAL,
  ...INTEGRATION_TESTS_REAL
];

/**
 * Priority tests that MUST pass (core functionality) - REAL TESTS
 */
export const CRITICAL_TESTS: BaseTest[] = PRIORITY_TESTS_REAL;

/**
 * Get tests by ID pattern
 */
export function getTestsByPattern(pattern: RegExp): BaseTest[] {
  return ALL_TESTS.filter(test => pattern.test(test.id));
}

/**
 * Get tests by priority range
 */
export function getTestsByPriority(min: number, max: number): BaseTest[] {
  return ALL_TESTS.filter(test => test.priority >= min && test.priority <= max);
}

/**
 * Get tests by name pattern
 */
export function getTestsByName(pattern: RegExp): BaseTest[] {
  return ALL_TESTS.filter(test => pattern.test(test.name));
}

/**
 * Export test framework components
 */
export {
  BaseTest,
  TestResult,
  TestContext,
  TestRunner,
  createTestContext,
  connectDiscord,
  disconnectDiscord,
  checkDebugServer
} from '../test-framework';
