# Endotemporal vs Exotemporal Operations

**Date**: September 29, 2025  
**Status**: ✅ IMPLEMENTED AND TESTED

---

## Core Distinction

### Endotemporal (Events in Time)
**Concept**: Things happen in the world, state evolves  
**Examples**: Box opens, door closes, counter increments  
**Representation**: State-change facets (added to VEIL as events)  
**Processing**: Transforms apply changes to actual state facets

### Exotemporal (Outside Time)
**Concept**: Modifications to VEIL itself, rewrites reality  
**Examples**: Forgetting, corrections, facet modifications  
**Representation**: rewriteFacet operations  
**Processing**: Directly modifies existing facets

---

## Naming Convention

### VEIL Delta Operations (Exotemporal)
```typescript
export type VEILDelta = 
  | { type: 'addFacet'; facet: Facet }                          // Add facet
  | { type: 'rewriteFacet'; id: string; changes: Partial<Facet> }  // Rewrite facet
  | { type: 'removeFacet'; id: string };                        // Remove facet
```

**Helper Functions**:
```typescript
rewriteFacet(id, changes)  // Exotemporal modification
changeFacet(id, changes)   // @deprecated alias for rewriteFacet
changeState(id, changes)   // @deprecated alias for rewriteFacet
```

### Facet Types (Endotemporal Events)
```typescript
export type StateChangeFacet = ... { type: 'state-change' };
export type StreamChangeFacet = ... { type: 'stream-change' };
export type ScopeChangeFacet = ... { type: 'scope-change' };
```

---

## Usage Patterns

### Endotemporal State Evolution (Box Opening)

**The Flow**:
```
User action → Event → Receptor → StateChangeFacet → Transform → rewriteFacet
```

**Step by Step**:

1. **User acts**: `open box-1`

2. **Command Effector emits event**:
```typescript
this.emit({ topic: 'box:open', payload: { boxId: 1 } });
```

3. **Receptor creates facets**:
```typescript
class BoxOpenReceptor extends BaseReceptor {
  topics = ['box:open'];
  
  transform(event) {
    return [
      // Event facet (what happened)
      {
        type: 'event',
        content: '💥 The box opens!',
        eventType: 'box-opened'
      },
      // Activation (agent should react)
      {
        type: 'agent-activation',
        content: 'Box opened',
        state: { priority: 'high' }
      }
    ];
  }
}
```

4. **Effector records state change**:
```typescript
class BoxComponent extends BaseEffector {
  async process(changes) {
    if (box-opened event for me) {
      // Update own component-state (scoped write)
      this.updateComponentState({ isOpen: true });
      
      // Emit StateChangeFacet (endotemporal record)
      this.emitFacet({
        type: 'state-change',
        targetFacetIds: ['box-1-state'],
        state: {
          changes: {
            isOpen: { old: false, new: true }
          }
        }
      });
    }
  }
}
```

5. **Transform applies the change**:
```typescript
class BoxStateTransform extends BaseTransform {
  process(state) {
    for (state-change facets) {
      // Apply to target facet
      deltas.push({
        type: 'rewriteFacet',  // Exotemporal application
        id: targetFacetId,
        changes: { state: { isOpen: true } }
      });
      
      // Remove the state-change (ephemeral)
      deltas.push({ type: 'removeFacet', id: stateChangeFacetId });
    }
  }
}
```

### Exotemporal Rewriting (Memory Correction)

**Direct approach**:
```typescript
// Agent realizes a memory was wrong
this.addOperation(rewriteFacet('memory-123', {
  content: 'Actually, the meeting was on Tuesday, not Wednesday'
}));
```

---

## Why This Distinction Matters

### Temporal Semantics
- **Endotemporal**: "At time T, the box opened" (event happened)
- **Exotemporal**: "The facet is now different" (reality changed)

### Recording History
- **Endotemporal**: Creates an event record (box-opened facet)
- **Exotemporal**: No event record (facet was always like this)

### Agent Perception
- **Endotemporal**: Agent sees the event happening in conversation
- **Exotemporal**: Agent sees updated state with no event

### Debugging
- **Endotemporal**: State-change facets show evolution trail
- **Exotemporal**: Only current state visible, no trail

---

## Architecture Benefits

### Clear Separation of Concerns
- **Effectors**: Record that changes happened (state-change facets)
- **Transforms**: Apply changes to actual state (rewriteFacet)
- **Prevents**: Effectors directly modifying domain state

### Audit Trail
- State-change facets create temporal trail
- Can see what changed, when, why
- Can compress or summarize evolution

### Flexibility
- Different transforms can apply same state-change differently
- State-change facets can trigger multiple updates
- Conditional application based on current state

---

## Common Patterns

### Pattern 1: Event → StateChange → Update

**Best for**: Interactive elements (boxes, doors, switches)

```typescript
// Receptor creates event
{ type: 'event', content: 'Box opened' }

// Effector records state change
{ type: 'state-change', targetFacetIds: ['box-state'], ... }

// Transform applies change
rewriteFacet('box-state', { state: { isOpen: true } })
```

### Pattern 2: Direct Update (VEILComponents)

**Best for**: UI state, non-temporal updates

```typescript
// Component directly modifies state
this.addOperation(rewriteFacet('ui-state', { ... }));
```

### Pattern 3: Component-State Updates

**Best for**: Bookkeeping, metrics, component-internal state

```typescript
// Scoped write (immediate, no event)
this.updateComponentState({ count: count + 1 });
```

---

## Migration Guide

### Before (Improper)
```typescript
// Using rewriteFacet for endotemporal evolution
events.push({
  topic: 'veil:operation',
  payload: {
    operation: {
      type: 'rewriteFacet',  // Wrong! This is exotemporal
      id: 'box-state',
      changes: { state: { isOpen: true } }
    }
  }
});
```

### After (Proper)
```typescript
// Emit StateChangeFacet (endotemporal record)
this.emitFacet({
  type: 'state-change',
  targetFacetIds: ['box-state'],
  state: {
    changes: {
      isOpen: { old: false, new: true }
    }
  }
});

// Transform applies it
class MyStateTransform extends BaseTransform {
  process(state) {
    for (state-change facets) {
      deltas.push(rewriteFacet(target, changes));  // Exotemporal application
    }
  }
}
```

---

## Testing

**Tested in**: `examples/dispenser-retm.ts`

**Flow verified**:
1. ✅ Command parsed
2. ✅ box:open event emitted
3. ✅ BoxOpenReceptor creates facets
4. ✅ StateChangeFacet emitted
5. ✅ BoxStateTransform applies changes
6. ✅ Box state updated
7. ✅ Agent perceives changes

---

## Summary

**Key Insight**: The naming now guides correct usage:
- **rewriteFacet** → Clearly exotemporal (rewriting reality)
- **StateChangeFacet** → Clearly endotemporal (evolution event)

**Architecture**: Effectors record evolution, Transforms apply changes

**Benefit**: Temporal semantics preserved, audit trail maintained, clear separation of concerns

**This completes the conceptual clarity of the endo/exotemporal distinction!** ✅


