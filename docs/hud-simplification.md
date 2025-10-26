# HUD Simplification with Aspects

## Current Complexity

The existing `FrameTrackingHUD` has accumulated significant complexity:

1. **Type-specific rendering logic** - Different code paths for each facet type
2. **Nested facet handling** - Complex parent-child relationships  
3. **State transition tracking** - Special renderers for attribute changes
4. **Frame type detection** - Heuristics to determine incoming vs outgoing
5. **Operation-based logic** - Processing operations instead of facets directly

## Simplification with Aspects

### 1. Content-Based Rendering

```typescript
// Old: Check multiple fields
if (!facet.content && (!facet.children || facet.children.length === 0)) {
  return null;
}

// New: Single aspect check
if (!hasContentAspect(facet)) {
  return null;
}
```

### 2. Agent vs World Grouping

```typescript
// Old: Complex frame type detection
const isIncoming = frame.deltas.some(op => 
  ['addFacet', 'changeState', ...].includes(op.type)
);

// New: Simple aspect check
if (hasAgentGeneratedAspect(facet)) {
  // It's from an agent
} else {
  // It's from the world
}
```

### 3. Unified Facet Rendering

```typescript
// Old: Special cases everywhere
switch (facet.type) {
  case 'state':
    // Complex state rendering with transitions
  case 'event':  
    // Event-specific logic
  // ... many more cases
}

// New: Aspect-driven rendering
function renderFacet(facet: ContentFacet): string {
  // All content facets have content
  const base = facet.content;
  
  // Wrap based on type for structure
  switch (facet.type) {
    case 'thought': return `<thought>${base}</thought>`;
    case 'action': return renderAction(facet);
    default: return base;
  }
}
```

### 4. No More State Transitions

State changes are now explicit `StateChangeFacet`s that can be:
- Rendered if important
- Filtered out if noise
- Processed by specialized transforms

No need for complex `transitionRenderers` and `attributeRenderers`.

### 5. Stream-Aware Context

```typescript
// Old: Complex stream routing logic
const streamRef = frame.activeStream || { streamId: 'default', streamType: 'unknown' };

// New: Facets know their stream
if (hasStreamAspect(facet)) {
  // Group by facet.streamId
}
```

## Benefits

1. **Simpler Code** - ~50% less code in the HUD
2. **Better Performance** - No complex facet tree traversal
3. **Clearer Intent** - Aspects make the data model explicit
4. **Easier Testing** - Pure functions based on facet aspects
5. **More Flexible** - Easy to add new facet types without touching HUD

## Migration Path

1. Create `AspectAwareHUD` alongside existing HUD
2. Update `ContextTransform` to use new HUD
3. Test with aspect-based facets
4. Deprecate old HUD once stable

## Future Enhancements

With aspects, we can easily add:

1. **Attention-based filtering** - Show only salient content
2. **Role-specific views** - Different contexts for different agents  
3. **Temporal windowing** - Easy filtering by ephemeral/persistent
4. **Debug overlays** - Include system facets when debugging
