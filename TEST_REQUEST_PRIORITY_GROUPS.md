# Test Request: Priority Groups + HUD Timing

**For**: Sonnet  
**Priority**: High  
**Date**: October 2025

## Background

We've implemented two major changes:

1. **HUD Frame Timing Fix** - ContextTransform now explicitly includes the current frame during rendering
2. **Priority Groups** - All MARTEM phases now process components in priority groups

These changes work together to ensure the agent sees all events in the current frame.

## What Changed

### Priority Groups Implementation

All phases now process components by priority:
- Lower numbers run first (priority 10 before priority 50)
- Each priority group runs to completion before the next starts
- In Phase 2, each priority group iterates until stable

### Key Components and Their Priorities

- **CompressionTransform**: priority = 250 (runs very late)
- **ContextTransform**: priority = 100 (runs after default transforms)
- **Most components**: priority = 50 (default)

## Test Scenarios

### 1. Basic Message Response Test
```
User: "Hello!"
Expected: Agent sees and responds in SAME frame
```

Verify:
- Message arrives in frame N
- ContextTransform (priority 100) runs AFTER any content generation (priority 50)
- Agent sees the message and activates in frame N
- Response is in frame N

### 2. Multi-Transform Interaction Test

Create a test with multiple transforms at different priorities:
```typescript
class EarlyTransform extends BaseTransform {
  priority = 20;
  process(state): VEILDelta[] {
    console.log('[Priority 20] Running early transform');
    // Add some metadata facet
  }
}

class DefaultTransform extends BaseTransform {
  // priority = 50 (default)
  process(state): VEILDelta[] {
    console.log('[Priority 50] Running default transform');
    // Generate content based on metadata
  }
}

// ContextTransform already has priority = 100
```

Expected order:
1. EarlyTransform runs first, adds metadata
2. DefaultTransform sees metadata, generates content
3. ContextTransform sees BOTH metadata and content

### 3. Phase 2 Iteration Within Priority Groups

Test that iterations work correctly within priority groups:
```typescript
class IterativeTransform extends BaseTransform {
  priority = 50;
  process(state): VEILDelta[] {
    // Should iterate 2-3 times then stabilize
    const count = /* count existing facets of some type */;
    if (count < 3) {
      return [/* add another facet */];
    }
    return [];
  }
}
```

Verify:
- Transform at priority 50 iterates multiple times
- ContextTransform at priority 100 sees ALL iterations complete

### 4. Stress Test - Complex Priority Chain

Add multiple components at different priorities and verify:
- Execution order matches priority numbers
- Each group completes before next starts
- Agent sees complete state at the end

## Debug Helpers

Add logging to verify execution order:
```typescript
// In Space.runPhase2()
console.log(`[Phase 2] Processing priority group: ${priority}`);

// In transforms
console.log(`[${this.constructor.name}] Running at priority ${this.priority || 50}`);
```

## Success Criteria

✅ Agent responds in same frame as user message  
✅ Priority groups execute in correct order  
✅ Each priority group completes before next starts  
✅ ContextTransform sees all changes from lower priorities  
✅ No regression in HUD timing fix  
✅ Phase 2 iterations work within priority groups

## Potential Issues to Watch For

1. **Infinite loops** - Each priority group has its own iteration limit
2. **Missing deltas** - Ensure deltas are accumulated correctly across priority groups
3. **State visibility** - Verify each group sees complete state from previous groups

Please test and let us know if the priority groups implementation maintains the HUD timing fix while providing better execution control!
