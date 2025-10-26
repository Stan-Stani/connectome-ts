# Receptor/Effector Migration Plan

## Overview
Iterative transformation of the current codebase to the new architecture, preserving all the nuances we've discovered.

## Phase 1: Simplify Operations (1-2 days)
**Goal**: Consolidate all operations to just add/change/remove

### 1.1 Complete Current Operation Cleanup
- [x] Already removed `speak`, `act`, `think` operations
- [ ] Remove any other special operations
- [ ] Ensure everything uses `addFacet`, `changeFacet`, `removeFacet`

### 1.2 Unify Frame Types
- [ ] Merge `IncomingVEILFrame` and `OutgoingVEILFrame` into single `Frame` type
- [ ] Add `transition` field to all frames
- [ ] Update `BasicAgent` to create frames with transitions
- [ ] Update `AgentComponent` to emit proper frames

## Phase 2: Introduce Facet Aspects (2-3 days)
**Goal**: Add aspect system while maintaining compatibility

### 2.1 Extend Facet Interface
```typescript
interface Facet {
  // Existing
  id: string;
  type: string;
  content?: string;
  
  // New aspects
  state?: Record<string, any>;
  temporal?: 'ephemeral' | 'persistent' | 'session';
  visibility?: 'agent' | 'system' | 'debug';
  renderable?: boolean;
  
  // Keep for compatibility
  attributes?: Record<string, any>;
  scope?: string[];
  displayName?: string;
}
```

### 2.2 Migrate Existing Facet Types
- [ ] Update facet creation to use aspects
- [ ] Keep `type` field for compatibility
- [ ] Gradually move type-specific fields to aspects

## Phase 3: Three-Phase Frame Processing (3-4 days)
**Goal**: Restructure Space to use three-phase model

### 3.1 Refactor Space.processFrame()
```typescript
class Space {
  async processFrame() {
    // Phase 1: Events → VEIL
    const phase1Ops = await this.runReceptors(this.eventQueue);
    
    // Phase 2: VEIL → VEIL  
    const phase2Ops = await this.runTransforms();
    
    // Phase 3: VEIL → Events
    const newEvents = await this.runEffectors();
    
    // Queue events for next frame
    newEvents.forEach(e => this.queueEvent(e));
  }
}
```

### 3.2 Create Receptor/Transform/Effector Registries
- [ ] Add registries to Space
- [ ] Add registration methods
- [ ] Keep existing event handling as fallback

## Phase 4: Migrate Components to Receptors/Effectors (1-2 weeks)
**Goal**: Transform existing components one at a time

### 4.1 Start with Simple Components
- [ ] `DispenseButtonComponent` → ButtonPressReceptor
- [ ] `ControlPanelComponent` → ControlStateTransform
- [ ] `BoxComponent` → BoxStateEffector

### 4.2 Discord Components
- [ ] `DiscordAxonComponent`:
  - MessageReceptor (events → message facets)
  - ConnectionEffector (manages WebSocket)
  - HistoryTransform (deduplication logic)
- [ ] `DiscordChatComponent`:
  - TriggerReceptor (checks if should respond)
  - ResponseEffector (sends messages)

### 4.3 Agent Components
- [ ] `AgentComponent` → AgentActivationEffector
- [ ] `BasicAgent`:
  - Keep as is initially
  - Refactor parsing to emit events instead of operations

## Phase 5: Optimize with Derived State (1 week)
**Goal**: Add performance optimizations

### 5.1 Add Index Transforms
- [ ] MessageIndexTransform (count, last read)
- [ ] StreamIndexTransform (active streams)
- [ ] AgentStateTransform (activation queue)

### 5.2 Add Ephemeral Cleanup
- [ ] EphemeralCleanupTransform
- [ ] Session cleanup on disconnect

## Phase 6: Clean Up (3-4 days)
**Goal**: Remove old code paths

### 6.1 Remove Legacy Systems
- [ ] Remove old event handling in Component base
- [ ] Remove operation processing from Space
- [ ] Remove special frame handling

### 6.2 Simplify Persistence
- [ ] Update to only save facets + operations
- [ ] Remove component state serialization
- [ ] Simplify restoration

## Implementation Strategy

### Start Small
1. Begin with Phase 1 - just unifying operations and frames
2. Test thoroughly at each step
3. Keep the system running throughout

### Preserve Knowledge
- Keep all the WebSocket reconnection logic
- Keep message deduplication strategies  
- Keep the three-phase component lifecycle
- Keep all the discovered timing nuances

### Test Continuously
- Write tests for each receptor/effector as we create them
- Use existing Discord/console functionality as integration tests
- Ensure persistence works at each phase

### Key Files to Track
1. `src/spaces/space.ts` - Frame processing
2. `src/veil/types.ts` - Facet types
3. `src/components/*` - Component migrations
4. `src/persistence/*` - Persistence updates

## Success Metrics
- [ ] All operations reduced to 3 types
- [ ] Single frame type with transitions
- [ ] Facets using aspect system
- [ ] Three-phase processing working
- [ ] All components migrated
- [ ] Performance equal or better
- [ ] Code significantly simpler

## Estimated Timeline
- Total: 4-5 weeks for full migration
- First working version: 1 week (Phases 1-3)
- Feature complete: 3 weeks (through Phase 4)
- Optimized: 4 weeks (Phase 5)
- Cleaned up: 5 weeks (Phase 6)

