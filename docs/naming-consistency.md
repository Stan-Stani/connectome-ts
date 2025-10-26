# Naming Consistency in Connectome

We've addressed key naming inconsistencies that were causing confusion:

## changeState vs updateState

### The Problem
- VEIL operation: `changeState`
- Component helper: `updateState()` 
- Factory function: `changeState()`

This mismatch was confusing!

### The Solution
We've standardized on `changeState` to match the VEIL operation:

```typescript
// Component methods - now consistent
this.changeState('status', { content: 'Active' });

// Factory functions - already correct
this.addOperation(changeState('status', { content: 'Active' }));

// VEIL operation - the source of truth
{ type: 'changeState', facetId: 'status', updates: {...} }
```

### Backward Compatibility
The old `updateState()` method still works but shows a deprecation warning:

```typescript
// Still works, but deprecated
this.updateState('status', { content: 'Active' });
// Console: "updateState() is deprecated. Use changeState() for consistency with VEIL operations."
```

## getState vs getCurrentState

### The Problem
Developers expected `getCurrentState()` but the method is `getState()`.

### The Solution
Added a deprecated alias:

```typescript
// Preferred
const state = veilState.getState();

// Still works, but deprecated  
const state = veilState.getCurrentState();
// Console: "getCurrentState() is deprecated. Use getState() instead."
```

## Why This Matters

Consistent naming:
1. **Reduces cognitive load** - One name for one concept
2. **Improves discoverability** - If you know the VEIL operation, you know the method
3. **Prevents errors** - No more guessing which variant to use

## Migration Guide

### For changeState/updateState:
```typescript
// Old
this.updateState('status', updates);
component.updateState('status', updates);

// New
this.changeState('status', updates);
component.changeState('status', updates);
```

### For getState/getCurrentState:
```typescript
// Old
const state = veilState.getCurrentState();

// New  
const state = veilState.getState();
```

## Summary

The naming is now consistent throughout:
- `changeState` - For updating state facets
- `changeFacet` - For updating event facets  
- `getState` - For retrieving current state

The deprecated aliases ensure existing code continues to work while gently nudging developers toward the consistent names.
