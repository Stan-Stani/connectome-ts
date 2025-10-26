# Receptor VEILDelta Migration

**Date**: September 29, 2025  
**Status**: 🟡 IN PROGRESS

---

## Change Summary

Receptors now return `VEILDelta[]` instead of `Facet[]` to support:
- Adding facets (`addFacet`)
- Rewriting facets (`rewriteFacet`) - for offline edits
- Removing facets (`removeFacet`) - for offline deletes

---

## Receptors Needing Update

### Simple (Just wrap in addFacet)
1. **ConsoleMessageReceptor** - `src/elements/console-chat-retm.ts`
2. **ElementRequestReceptor** - `src/spaces/element-tree-receptors.ts`
3. **ConsoleInputReceptor** - `src/components/console-receptors.ts`
4. **VEILOperationReceptor** - `src/spaces/migration-adapters.ts`
5. **ComponentToReceptorAdapter** - `src/spaces/migration-adapters.ts`

### Already Updated
✅ **DiscordHistorySyncReceptor** - Uses rewriteFacet and removeFacet for offline changes

---

## Migration Pattern

### Before
```typescript
class MyReceptor extends BaseReceptor {
  transform(event, state): Facet[] {
    return [
      { id: '...', type: 'event', content: '...' }
    ];
  }
}
```

### After (Quick Fix)
```typescript
import { wrapFacetsAsDeltas } from '../helpers/factories';

class MyReceptor extends BaseReceptor {
  transform(event, state): VEILDelta[] {
    const facets = [
      { id: '...', type: 'event', content: '...' }
    ];
    return wrapFacetsAsDeltas(facets);
  }
}
```

### After (Proper)
```typescript
class MyReceptor extends BaseReceptor {
  transform(event, state): VEILDelta[] {
    return [
      { type: 'addFacet', facet: { id: '...', type: 'event', content: '...' } }
    ];
  }
}
```

---

## Discord Implementation

### ✅ Completed

**DiscordHistorySyncReceptor**:
```typescript
// Detects offline edits/deletes
transform(event, state) {
  const deltas = [];
  
  for (veilMessage in VEIL) {
    if (!in Discord history) {
      deltas.push({ type: 'removeFacet', id: veilMessage.id });
      deltas.push({ type: 'addFacet', facet: deleteEventFacet });
    }
    if (content different) {
      deltas.push({ type: 'rewriteFacet', id, changes: { content: newContent } });
      deltas.push({ type: 'addFacet', facet: editEventFacet });
    }
  }
  
  return deltas;
}
```

### 🟡 TODO

Register in discord-app.ts:
```typescript
space.addReceptor(new DiscordHistorySyncReceptor());
```

Update other Discord receptors to return VEILDelta[].

---

## Benefits

✅ **Receptors can modify VEIL** - add, rewrite, remove  
✅ **Offline changes detected** - edits and deletes while bot offline  
✅ **Exotemporal operations** - properly using rewriteFacet/removeFacet  
✅ **Event records** - optional events for edit/delete notifications  
✅ **Unified interface** - Receptors and Transforms both return VEILDelta[]

---

## Next Steps

1. Export `wrapFacetsAsDeltas` from index.ts
2. Update all receptors to use wrapper (quick fix)
3. Register DiscordHistorySyncReceptor
4. Test offline edit/delete detection
5. Gradually migrate to proper delta format


