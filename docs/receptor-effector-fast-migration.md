# Fast & Breaking Migration Plan

## Day 1: Gut the Core

### Morning: Nuke the Type System
```typescript
// DELETE these files/types:
// - IncomingVEILFrame
// - OutgoingVEILFrame  
// - OutgoingVEILOperation
// - All the specific Facet types (EventFacet, StateFacet, etc)

// REPLACE with:
interface Frame {
  sequence: number;
  timestamp: string;
  operations: VEILOperation[];
  transition: FrameTransition;
}

interface Facet {
  id: string;
  type: string;
  
  // Aspects
  content?: string;
  state?: Record<string, any>;
  temporal?: 'ephemeral' | 'persistent' | 'session';
  visibility?: 'agent' | 'system' | 'debug';
  renderable?: boolean;
  
  // Legacy support
  attributes?: Record<string, any>;
  displayName?: string;
  scope?: string[];
}

type VEILOperation = 
  | { type: 'addFacet'; facet: Facet }
  | { type: 'changeFacet'; facetId: string; changes: Partial<Facet> }
  | { type: 'removeFacet'; facetId: string; mode: 'hide' | 'delete' }
```

### Afternoon: Gut Space.processFrame()
```typescript
// DELETE all the current frame processing logic
// REPLACE with:
class Space {
  private receptors: Receptor[] = [];
  private transforms: Transform[] = [];
  private effectors: Effector[] = [];
  
  async processFrame(frameId: number) {
    const events = this.eventQueue.drain();
    
    // Phase 1: Events → VEIL
    const veilOps: VEILOperation[] = [];
    for (const event of events) {
      const receptor = this.findReceptor(event.topic);
      if (receptor) {
        const facets = receptor.transform(event, this.veilState.getState());
        veilOps.push(...facets.map(f => ({ type: 'addFacet', facet: f })));
      }
    }
    
    // Phase 2: VEIL → VEIL
    for (const transform of this.transforms) {
      const facets = transform.process(this.veilState.getState());
      veilOps.push(...facets.map(f => ({ type: 'addFacet', facet: f })));
    }
    
    // Apply all operations
    const frame: Frame = {
      sequence: frameId,
      timestamp: new Date().toISOString(),
      operations: veilOps,
      transition: { /* ... */ }
    };
    this.veilState.applyFrame(frame);
    
    // Phase 3: VEIL → Events  
    const newEvents: Event[] = [];
    for (const effector of this.effectors) {
      const events = await effector.process(this.veilState.getState());
      newEvents.push(...events);
    }
    
    // Queue for next frame
    newEvents.forEach(e => this.queueEvent(e));
  }
}
```

## Day 2: Quick & Dirty Component Conversion

### Morning: Create Adapters
```typescript
// Quick adapter to convert old components to receptors/effectors
class ComponentToReceptorAdapter implements Receptor {
  constructor(private component: Component, private topic: string) {}
  
  transform(event: Event): Facet[] {
    // Hack: create a fake frame and capture operations
    const fakeFrame = { operations: [] };
    (this.component as any).element = { space: { getCurrentFrame: () => fakeFrame } };
    this.component.handleEvent(event);
    
    // Extract facets from captured operations
    return fakeFrame.operations
      .filter(op => op.type === 'addFacet')
      .map(op => op.facet);
  }
}
```

### Afternoon: Mass Convert
```typescript
// For each component:
// 1. If it handles events → make it a Receptor
// 2. If it has side effects → make it an Effector
// 3. If it computes state → make it a Transform

// Quick conversions:
space.addReceptor(new ComponentToReceptorAdapter(discordComponent, 'discord:message'));
space.addEffector(new ComponentToEffectorAdapter(discordComponent));
```

## Day 3: Fix What's Broken

### Morning: Get Basic Flow Working
1. Console input → creates event facet
2. Agent sees activation facet → creates speech facet
3. Console sees speech facet → prints to console

### Afternoon: Get Discord Working
1. Discord message → creates message facet
2. Agent activation → creates speech facet  
3. Discord sees speech facet → sends to Discord

## Day 4: Rip Out Old Code

### Delete:
- All the old operation types
- Component.handleEvent
- Space's old event distribution
- Old frame processing logic
- VEILComponent base class (just use Receptor/Effector interfaces)

### Simplify:
- Agent just emits events (no more OutgoingFrame)
- Components are just collections of Receptors/Effectors
- Persistence just saves facets

## Day 5: Make It Fast

### Add Key Optimizations:
- Ephemeral facet cleanup
- Message deduplication as Transform
- Index facets for common queries
- Parallel processing in each phase

## What We're NOT Doing:
- Keeping backwards compatibility
- Maintaining old interfaces
- Gradual migration
- Worrying about breaking tests (we'll fix them later)

## What We ARE Doing:
- Ripping out complexity
- Getting to the new model ASAP
- Fixing issues as they arise
- Moving fast

## Key Insight:
The current code has all the logic we need - we're just reorganizing it. A Discord component that handles messages becomes a DiscordMessageReceptor. The part that sends messages becomes a DiscordSendEffector. We're not writing new logic, just moving it around.

## Success = 
- Everything is a Facet
- Only 3 operations  
- Three-phase processing
- No hidden state
- Way less code

