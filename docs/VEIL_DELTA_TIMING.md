# VEIL Delta Timing and Application

**Important**: All VEIL deltas are applied **immediately** within the current frame.

## How It Works

### Phase Execution and Delta Application

```
Frame N Processing:
├─ Phase 0: Modulators
│  └─ Modifies events (no VEIL changes)
│
├─ Phase 1: Receptors  
│  ├─ Returns: VEILDelta[]
│  └─ Applied: IMMEDIATELY via applyDeltasDirect()
│
├─ Phase 2: Transforms (iterative)
│  ├─ Iteration 1: Returns deltas → Applied IMMEDIATELY
│  ├─ Iteration 2: Sees iteration 1 changes, returns deltas → Applied IMMEDIATELY  
│  └─ ... until no more deltas
│
├─ Phase 3: Effectors
│  └─ Sees all Phase 1 & 2 changes
│
└─ Phase 4: Maintainers
   ├─ Returns: MaintainerResult { deltas, events }
   ├─ Deltas: Applied IMMEDIATELY
   └─ Events: Queued for Frame N+1
```

## Key Points

1. **Immediate Visibility**: When a phase returns deltas, they are applied before the next phase runs
2. **Within-Phase Visibility**: 
   - Phase 2 transforms see each other's changes (due to iteration)
   - Other phases don't see changes from components in the same phase
3. **Frame Boundary**: All deltas are part of the current frame, finalized together
4. **Events Are Deferred**: Only SpaceEvents are queued for the next frame

## Implications for Component Authors

### ✅ DO
- Assume your deltas are visible to later phases immediately
- Design transforms to be idempotent (Phase 2 may run multiple times)
- Use events (not deltas) for changes that should happen next frame

### ❌ DON'T  
- Assume other components in your phase will see your changes
- Rely on specific ordering within a phase (except Phase 2 with priorities)
- Expect to "preview" changes before they're applied

## Example

```typescript
// This Receptor's changes...
class MyReceptor implements Receptor {
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    return [{
      type: 'addFacet',
      facet: { id: 'my-facet', type: 'state', state: { value: 1 } }
    }];
  }
}

// ...are immediately visible to this Transform
class MyTransform implements Transform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const myFacet = state.facets.get('my-facet');
    // myFacet exists here! (if Receptor ran first)
    
    if (myFacet?.state?.value === 1) {
      return [{
        type: 'changeFacet',
        id: 'my-facet',
        changes: { state: { value: 2 } }
      }];
    }
    return [];
  }
}
```

## Component State During Initialization

When `ElementTreeMaintainer` creates components in Phase 4:
1. It can emit a `component-state` facet delta
2. That delta is applied immediately 
3. The component's `onMount()` can read its state in the same frame

This is why the "hack" in ElementTreeMaintainer actually follows the architecture - it's just using the immediate application that's already there.
