# Phase 0 Test Suite

This directory contains the baseline test suite for the FLEX refactor. These tests establish functional correctness before architectural changes begin.

## Test Organization

### Test Files

- **priority-tests.ts**: 5 critical tests that MUST pass (TEST-003, TEST-004, TEST-011, TEST-014, TEST-023)
- **discord-integration-tests.ts**: Discord connectivity tests (TEST-001, TEST-002, TEST-005)
- **martem-component-tests.ts**: MARTEM phase execution tests (TEST-006 through TEST-010)
- **agent-system-tests.ts**: Agent functionality tests (TEST-012, TEST-013)
- **element-tree-tests.ts**: Element hierarchy tests (TEST-015, TEST-016, TEST-017)
- **state-management-tests.ts**: VEIL and persistence tests (TEST-018, TEST-019, TEST-020)
- **axon-module-tests.ts**: Module loading tests (TEST-021, TEST-022)
- **integration-tests.ts**: End-to-end tests (TEST-024, TEST-025)
- **index.ts**: Test suite exports and utilities

## Test Structure

Each test extends `BaseTest` from the test framework:

```typescript
export class Test003MessageReception extends BaseTest {
  id = 'TEST-003';
  name = 'Message Reception';
  priority = 3;

  async execute(): Promise<void> {
    // Test implementation
    this.log('Starting test...');
    this.assert(condition, 'Failure message');
    this.verify('key', value);
  }
}
```

## Test Implementation Status

### Current Status: Simulation Mode

All tests are currently implemented with **simulated data** rather than real debug MCP queries. This allows the test infrastructure to be validated before full integration.

### Integration TODO

To connect tests to real system:

1. **Connect Debug MCP**: Uncomment MCP connection code in test framework
2. **Query Real State**: Replace simulated data with actual debug MCP queries
3. **Discord Integration**: Connect Discord MCP for message sending/reading
4. **Validation**: Run against live discord-axon server

Example integration (currently commented):

```typescript
// TODO: Replace simulation
const messageEvent = { found: true };

// With real query
const frames = await this.context.debugMCP.getFrames({ limit: 10 });
const messageEvent = frames.find(f =>
  f.events?.some(e => e.topic === 'discord:message')
);
```

## Adding New Tests

### 1. Create Test Class

```typescript
export class TestNewFeature extends BaseTest {
  id = 'TEST-XXX';
  name = 'New Feature Test';
  priority = 26;

  async execute(): Promise<void> {
    this.log('Testing new feature...');

    // Test logic here
    this.assert(true, 'Should work');
    this.verify('featureWorks', true);
  }
}
```

### 2. Add to Test Suite

In the appropriate test file (e.g., `integration-tests.ts`):

```typescript
export const INTEGRATION_TESTS = [
  new Test024MultiAgentCoordination(),
  new Test025ControlPanelOperations(),
  new TestNewFeature()  // Add here
];
```

### 3. Register in Index

The test will be automatically included via the suite export.

## Test Helpers

### Assertions

- `assert(condition, message)`: Basic assertion
- `assertEqual(actual, expected, message)`: Equality check
- `assertHasProperty(obj, prop, message)`: Property existence

### Verification

- `verify(key, value)`: Record verified data
- `log(message)`: Log test execution
- `error(message)`: Log error

### Timing

- `sleep(ms)`: Wait for duration
- `waitFor(condition, timeout)`: Wait for condition

## Test Categories

### Priority (Critical Path)

These 5 tests verify the core message pipeline:
1. Message reception from Discord
2. Mention detection and filtering
3. Agent activation
4. Speech output generation
5. Full end-to-end pipeline

### Discord Integration

Tests for Discord bot connectivity:
- WebSocket connection
- Auto-join channels
- Message history sync

### MARTEM Components

Tests for phase-based execution:
- Modulator preprocessing
- Receptor topic registration
- Transform priority ordering
- Effector facet filtering
- Maintainer cleanup

### Agent System

Tests for agent functionality:
- Context assembly with HUD
- Tool execution via actions
- LLM integration

### Element Tree

Tests for component hierarchy:
- Tree structure
- Component mounting
- Event propagation

### State Management

Tests for VEIL system:
- Facet lifecycle
- State persistence
- Frame processing

### AXON Modules

Tests for dynamic loading:
- Module transpilation
- Hot reload capability

### Integration

Tests for complete system:
- Multi-agent coordination
- Control panel operations

## Running Tests

See [phase0-test-procedures.md](../../docs/phase0-test-procedures.md) for detailed instructions.

Quick commands:
```bash
# All tests
npm run test:phase0

# Priority only
npm run test:phase0:priority

# Specific suite
ts-node src/testing/run-phase0-tests.ts --suite=priority

# Specific test
ts-node src/testing/run-phase0-tests.ts --test="TEST-003"
```

## Test Data

### Test Configuration

Default values (override via environment variables):

- Guild ID: 966069488137158676
- Channel ID: 966069488137158679
- Bot ID: 1400417376293359757
- Debug Port: 3015
- Timeout: 30000ms

### Mock Data

Tests use simulated data structures matching the real system:

```typescript
const mockFrame = {
  uuid: 'frame-uuid',
  sequence: 100,
  events: [{ topic: 'discord:message', payload: {...} }]
};

const mockVEILState = {
  facets: new Map([
    ['facet-id', { type: 'speech', content: 'Hello' }]
  ])
};
```

## Future Enhancements

### Phase 1 Updates

As tree is collapsed:
- Update element tree tests
- Add flat component list tests
- Verify backward compatibility

### Phase 2 Updates

As sequential execution is implemented:
- Update MARTEM tests for priority levels
- Add constraint solver tests
- Verify event buffer behavior

### Phase 3 Updates

Polish phase:
- Add performance benchmarks
- Add memory leak detection
- Add stress tests

## Debugging Tests

### Enable Debug Logging

All tests log execution steps. Check console output.

### Inspect Test State

Tests record verification data:
```typescript
result.verified = {
  messageReceived: true,
  testMessage: "Test message 123"
};
```

### Run in Debug Mode

```bash
# With Node inspector
node --inspect-brk=9229 -r ts-node/register \
  src/testing/run-phase0-tests.ts --test="TEST-003"
```

### Check Simulation vs Real

Tests indicate when running in simulation mode. To force real mode, ensure debug MCP is connected.

## Contributing

When adding tests:

1. Follow existing test structure
2. Use descriptive names
3. Document what is being tested
4. Include clear failure messages
5. Record verification data
6. Add integration TODOs if using simulation

## References

- [PHASE-0-TEST-REQUIREMENTS.md](../../../PHASE-0-TEST-REQUIREMENTS.md)
- [FLEX-TEST-PLAN.md](../../../FLEX-TEST-PLAN.md)
- [phase0-test-procedures.md](../../docs/phase0-test-procedures.md)
