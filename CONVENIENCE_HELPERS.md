# Component Convenience Helpers

**Date**: September 29, 2025

## Overview

New helper methods in Component base class dramatically reduce boilerplate for common operations.

---

## Component State Helpers

### Reading State
```typescript
// Get entire component state from VEIL
const state = this.getComponentState<MyStateType>();

// Access properties
const count = state.count || 0;
```

### Writing State
```typescript
// Update specific properties (merged)
this.updateComponentState({ count: count + 1 });

// Replace entire state
this.setComponentState({ count: 0, reset: true });
```

**Scope**: Only works for component's own state
**When**: During frame processing (Effectors/Maintainers)
**Storage**: VEIL component-state facet (auto-persisted)

---

## Facet Emission Helpers

### Base Pattern
```typescript
// Emit any facet via veil:operation event
this.emitFacet(myFacet);

// Before (20+ lines):
events.push({
  topic: 'veil:operation',
  source: { elementId: this.element.id, elementPath: [] },
  timestamp: Date.now(),
  payload: {
    operation: {
      type: 'addFacet',
      facet: createAgentActivation(...)
    }
  }
});

// After (1 line):
this.activateAgent("Something happened");
```

### Agent Activation
```typescript
this.activateAgent(reason, options?)

// Examples:
this.activateAgent("New box dispensed");

this.activateAgent("User asked question", {
  priority: 'high',
  source: 'user-input'
});

this.activateAgent("Important event", {
  priority: 'critical',
  streamRef: myStreamRef
});
```

### Event Facets
```typescript
this.emitEventFacet(content, options?)

// Examples:
this.emitEventFacet("Button clicked");

this.emitEventFacet("User logged in", {
  eventType: 'auth-login',
  metadata: { userId: '123' }
});
```

---

## Validation by Component Type

### BaseEffector (Phase 3)
```typescript
// Warns if creating domain state facets
protected emitFacet(facet) {
  if (facet.type === 'state') {
    console.warn("Effector creating state - consider Transform");
  }
  super.emitFacet(facet);
}
```

**Guidance**: Effectors should emit events/activations, not create domain state

### BaseAfferent (Async)
```typescript
// Works correctly with async emit context
protected emitFacet(facet) {
  this.emit({
    topic: 'veil:operation',
    payload: { operation: { type: 'addFacet', facet } }
  });
}
```

**Note**: Queued for next frame (afferents are outside frame loop)

### BaseTransform (Phase 2)
```typescript
// Should use return deltas, not emit
// emitFacet() still available but discouraged
```

**Guidance**: Transforms should return VEILDeltas, not emit events

### BaseReceptor (Phase 1)
```typescript
// Should return facets from transform()
// emitFacet() available but discouraged
```

**Guidance**: Receptors return facets, don't emit

---

## Usage Patterns

### In Effectors
```typescript
class MyEffector extends BaseEffector {
  async process(changes, state) {
    for (const change of changes) {
      // Update own state
      this.updateComponentState({ processedCount: count + 1 });
      
      // Emit event
      this.emitEventFacet("Processed item");
      
      // Activate agent
      this.activateAgent("Important event", { priority: 'high' });
    }
    
    return { events: [] };  // No manual event construction needed!
  }
}
```

### In Afferents
```typescript
class MyAfferent extends BaseAfferent {
  handleMessage(msg) {
    // Emit event
    this.emitEventFacet(`Message received: ${msg.content}`);
    
    // Activate agent
    this.activateAgent("New message", {
      source: 'external-system'
    });
  }
}
```

### In Maintainers
```typescript
class MyMaintainer extends BaseMaintainer {
  async process(frame, changes, state) {
    // Update own state
    this.updateComponentState({ lastFrame: frame.sequence });
    
    // Emit infrastructure events
    this.emitEventFacet("Maintenance complete");
    
    return {
      events: [],
      deltas: []  // Can also return deltas for infrastructure
    };
  }
}
```

---

## Benefits

✅ **Less Boilerplate**: 20+ lines → 1-3 lines
✅ **Type Safety**: TypeScript generics for state  
✅ **Validation**: Component-specific rules enforced
✅ **Consistency**: Same helpers across all component types
✅ **Maintainability**: Change implementation once, affects all uses
✅ **Discoverability**: IDE autocomplete shows available helpers

---

## Migration Example

### Before
```typescript
class DispenseEffector {
  async process(changes) {
    // 22 lines to create activation
    events.push({
      topic: 'veil:operation',
      source: { elementId: this.element.id, elementPath: [] },
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'addFacet',
          facet: {
            id: `activation-${Date.now()}`,
            type: 'agent-activation',
            content: 'Box dispensed',
            state: {
              source: 'dispenser',
              reason: 'box_dispensed',
              priority: 'normal'
            },
            ephemeral: true
          }
        }
      }
    });
    
    return { events };
  }
}
```

### After
```typescript
class DispenseEffector {
  async process(changes) {
    // 1 line!
    this.activateAgent('Box dispensed', {
      source: 'dispenser',
      priority: 'normal'
    });
    
    return { events: [] };
  }
}
```

---

## Future Extensions

Possible additional helpers:
- `this.createElementViaVEIL(name, components)`
- `this.requestComponentAddition(elementId, componentType, config)`
- `this.emitStreamChange(operation, streamId)`
- `this.emitScopeChange(operation, scopeId)`

These can be added as patterns emerge!


