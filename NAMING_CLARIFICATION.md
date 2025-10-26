# Naming Clarification - Endo vs Exotemporal

**Date**: September 29, 2025  
**Status**: ✅ COMPLETE

---

## The Confusion

The original naming had `changeFacet` as both:
1. A VEIL delta operation (exotemporal)
2. Semantically similar to state changes (endotemporal)

This created confusion: when you want to change a facet's state because something happened in the world, the natural impulse is to use `changeFacet()` - but this was an **exotemporal rewrite**, not an **endotemporal evolution**.

---

## The Solution

### VEIL Delta Operations (Exotemporal)

These are operations that modify VEIL state from outside time:

```typescript
export type VEILDelta = 
  | { type: 'addFacet'; facet: Facet }
  | { type: 'rewriteFacet'; id: string; changes: Partial<Facet> }  // NEW NAME!
  | { type: 'removeFacet'; id: string };
```

**rewriteFacet**: Exotemporal modification
- "This facet was always like this"
- Rewrites history/reality
- Used for: Forgetting, corrections, retroactive changes
- Example: Agent realizes memory was wrong

### Facet Types (Endotemporal Events)

These are facets that represent things happening in time:

```typescript
export type StateChangeFacet = ... { type: 'state-change' };   // Renamed from StateRewriteFacet
export type StreamChangeFacet = ... { type: 'stream-change' }; // Renamed from StreamRewriteFacet
export type ScopeChangeFacet = ... { type: 'scope-change' };   // Renamed from ScopeRewriteFacet
```

**StateChangeFacet**: Endotemporal event
- "The state evolved at this moment"
- Records that change happened
- Used for: Box opened, door closed, counter incremented
- Example: Box state goes from `closed` → `open`

---

## Developer Mental Model

### When Something Happens in the World

**Option A: Let StateTransitionTransform handle it**
```typescript
// Just emit an event
this.emitEventFacet("Box opened");

// StateTransitionTransform sees it and updates state automatically
```

**Option B: Explicit state change facet**
```typescript
// Create StateChangeFacet (added via addFacet)
this.addFacet({
  type: 'state-change',
  targetFacetIds: ['box-1-state'],
  state: {
    changes: {
      isOpen: { old: false, new: true }
    }
  }
});

// A Transform processes it and updates the state facet
```

**Option C: Direct rewrite (if appropriate)**
```typescript
// For immediate state updates that don't need event recording
this.addOperation(rewriteFacet('box-1-state', {
  state: { isOpen: true }
}));
```

### When Rewriting History

```typescript
// Exotemporal rewrite
this.addOperation(rewriteFacet('memory-123', {
  content: 'Actually, it was different from what I remembered'
}));
```

---

## Backward Compatibility

Aliases provided for migration:

```typescript
export const changeFacet = rewriteFacet;   // @deprecated
export const changeState = rewriteFacet;   // @deprecated  
export const updateState = rewriteFacet;   // @deprecated
```

---

## Files Changed

1. `src/veil/facet-types.ts`
   - VEILDelta: Removed 'changeFacet' type
   - Renamed StateRewriteFacet → StateChangeFacet
   - Renamed StreamRewriteFacet → StreamChangeFacet
   - Renamed ScopeRewriteFacet → ScopeChangeFacet

2. `src/helpers/factories.ts`
   - RewriteFacet → rewriteFacet (lowercase)
   - Added deprecated aliases
   - createStreamRewriteFacet → createStreamChangeFacet
   - Added deprecated alias

3. `src/veil/veil-state.ts`
   - Removed 'changeFacet' case (not a delta type)
   - Kept only 'rewriteFacet' case

4. `src/index.ts`
   - Updated exports
   - Added deprecated aliases with documentation

5. `src/spaces/element-tree-receptors.ts`
   - RewriteFacet() → rewriteFacet() (lowercase)

---

## Conceptual Clarity

### Before
- "changeFacet" → Confusing! Delta operation or state evolution?
- Natural impulse led to wrong semantic choice
- Exotemporal vs endotemporal distinction unclear

### After  
- "rewriteFacet" → Clearly exotemporal (rewriting reality)
- "StateChangeFacet" → Clearly endotemporal (evolution event)
- Names guide correct architectural choices
- Semantic clarity maintained

---

## Examples

### Box Opening (Endotemporal)

**Wrong** (before clarification):
```typescript
// Using changeFacet for evolution - semantically incorrect!
this.addOperation(changeFacet('box-state', { state: { isOpen: true } }));
```

**Right** (after clarification):
```typescript
// Create StateChangeFacet to record evolution
this.addFacet({
  type: 'state-change',
  targetFacetIds: ['box-state'],
  state: { changes: { isOpen: { old: false, new: true } } }
});

// OR use rewriteFacet if immediate update is appropriate
this.addOperation(rewriteFacet('box-state', { state: { isOpen: true } }));
```

### Memory Correction (Exotemporal)

**Right**:
```typescript
// Explicitly rewriting history
this.addOperation(rewriteFacet('memory-123', {
  content: 'Actually, this is what really happened...'
}));
```

---

## Impact

✅ **Conceptual Clarity**: Names now match semantics  
✅ **Developer Guidance**: Natural impulse leads to correct choice  
✅ **Backward Compatible**: Aliases prevent breaking changes  
✅ **Tested**: Dispenser still working perfectly

---

**This naming clarification maintains the conceptual purity of the endo/exotemporal distinction while making it intuitive for developers!**


