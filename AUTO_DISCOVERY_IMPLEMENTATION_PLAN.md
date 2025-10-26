# Auto-Discovery Implementation Plan

**Date**: October 3, 2025  
**Status**: 🟡 READY TO IMPLEMENT

---

## Summary

We've designed a system to eliminate dual registration of RETM components using:
1. **Symbol-based type identification** - Reliable, fast type detection
2. **Auto-discovery** - Space finds components in the element tree
3. **Backwards compatibility** - Manual registration still works

## What's Been Done

### ✅ Completed
- Added `RETM_TYPE` symbols to all base classes
- Created type guards that prefer symbols over duck typing  
- Designed `SpaceAutoDiscovery` utility class
- Created `SpaceWithAutoDiscovery` example implementation
- Documented the approach and benefits

### 🚧 Ready to Implement
1. Integrate auto-discovery into main `Space` class
2. Update `ElementTreeMaintainer` to remove registration code
3. Update all examples to use simplified pattern
4. Add performance benchmarks

## Implementation Steps

### Step 1: Update Space Class

```typescript
// In space.ts, add:
private discovery = new SpaceAutoDiscovery();
private discoveryCache?: DiscoveryCache;

// Modify each runPhase method to use discovery
protected runPhase1(events: SpaceEvent[]): VEILDelta[] {
  const receptors = this.discovery.discoverReceptors(this);
  // ... existing logic
}
```

### Step 2: Clean Up ElementTreeMaintainer

Remove these problematic lines:
```typescript
// DELETE THIS:
if (componentClass === 'effector' && space.addEffector) {
  space.addEffector(component);
}
// Component will be auto-discovered instead!
```

### Step 3: Update Examples

Before:
```typescript
const effector = new MyEffector();
element.addComponent(effector);
space.addEffector(effector); // DELETE THIS LINE
```

After:
```typescript
element.addComponent(new MyEffector()); // That's it!
```

### Step 4: Migration Guide

For existing code:
1. Keep manual registration working (backwards compatible)
2. Log deprecation warnings in dev mode
3. Provide automated migration script

## Performance Considerations

### Traversal Cost
- 1000 elements × 5 components = 5000 checks
- Symbol check: ~1ns per component  
- Total: ~5μs per discovery
- Cache results per frame

### Optimization Options
1. **Frame caching** - Already designed, reuse discoveries within frame
2. **Dirty tracking** - Only re-discover if element tree changed
3. **Lazy discovery** - Discover each phase's components only when needed

## Benefits Summary

### For Developers
- 🎯 **Simpler API** - Just add to element
- 🚫 **No dual registration**
- 🔄 **Dynamic components work**
- 📝 **Less boilerplate**

### For Architecture  
- 🌳 **Single source of truth** - Element tree
- 🔍 **Discoverable** - Can introspect what's registered
- 🧹 **Cleaner** - No tight coupling in maintainers
- ✅ **Type-safe** - Symbol-based detection

## Next Actions

1. **Get team approval** on this approach
2. **Implement in Space** with feature flag
3. **Test performance** with large element trees
4. **Update documentation**
5. **Migrate examples**
6. **Deprecate manual registration** (future)

## Questions to Resolve

1. Should discovery be opt-in or opt-out?
2. How to handle component ordering within same priority?
3. Should we cache discoveries across frames?
4. Migration timeline for deprecating manual registration?

---

This eliminates the dual registration problem while maintaining backwards compatibility and improving the developer experience!
