# Receptor/Effector Architecture: A Unified Temporal Model for Connectome

## Executive Summary

We propose a fundamental architectural shift that unifies all Connectome operations into a clean, three-phase processing model. This eliminates the current complexity of multiple frame types, operation types, and hidden state while providing better debugging, testing, and persistence capabilities.

## Current Problems

### 1. Multiple Frame Types
- `IncomingVEILFrame` (with transitions) vs `OutgoingVEILFrame` (without)
- Different serialization paths and processing logic
- Unclear why agent decisions aren't tracked the same as system changes

### 2. Too Many Operation Types
- VEIL operations: `addFacet`, `removeFacet`, `changeState`, `changeFacet`, etc.
- Agent operations: `speak`, `think`, `act` (which we just removed)
- Confusion about what creates facets vs what IS a facet

### 3. Hidden State Everywhere
```typescript
// Current: State hidden in components
class DiscordComponent {
  private lastRead = {};        // Hidden!
  private processedMessages = new Set();  // Also hidden!
  private ws?: WebSocket;       // Connection state hidden too!
}
```
This makes debugging, testing, and persistence extremely difficult.

### 4. Complex Event Flow
```
Agent → Operations → Space → Facets → Components → Events → ???
```
Too many transformations and special cases.

## Proposed Architecture

### Core Concepts

#### 1. Two Time Axes
- **Endotemporal**: Time within the world (events happen, messages arrive, agents speak)
- **Exotemporal**: Time of the world (frames tick by, facets change)

#### 2. Everything is a Facet
All state exists as facets in VEIL:
```typescript
// Events are facets
{ type: 'event', displayName: 'discord:message', content: 'Hello world', ... }

// State is facets  
{ type: 'state', id: 'discord-lastread', content: '12345', ... }

// Even definitions are facets
{ type: 'stream-definition', id: 'discord-general', ... }
{ type: 'scope-definition', id: 'agent-internal', ... }
```

#### 3. Facet Aspects (Composable Properties)
Instead of rigid types, facets have composable aspects:

```typescript
interface Facet {
  id: string;
  type: string;  // For compatibility/organization
  
  // Aspects - facets can have any combination
  content?: string;          // Content aspect
  state?: Record<string, any>; // State aspect  
  temporal?: 'ephemeral' | 'persistent' | 'session'; // Temporal aspect
  visibility?: 'agent' | 'system' | 'debug';  // Visibility aspect
  renderable?: boolean;      // Rendering aspect
  
  // Common metadata
  attributes?: Record<string, any>;
  timestamp?: string;
}

// Examples:
// Speech has content + ephemeral
{ 
  type: 'speech',
  content: 'Hello world',
  temporal: 'ephemeral',
  renderable: true
}

// State has state + persistent
{
  type: 'discord-connection',
  state: { connected: true, since: '2024-01-26' },
  temporal: 'persistent',
  renderable: false
}

// Rendered context is ephemeral
{
  type: 'hud-context', 
  content: '<turn>...</turn>',
  temporal: 'ephemeral',  // Deleted after frame!
  visibility: 'system'
}
```

This solves many problems:
- No more deciding "is this event or state?" - it can have both aspects
- Natural handling of ephemeral data (rendered contexts, intermediate computations)
- Clear visibility boundaries without complex type hierarchies

#### 4. Only Three Operations
The only exotemporal operations that exist:
```typescript
type VEILOperation = 
  | { type: 'addFacet'; facet: Facet }
  | { type: 'changeFacet'; facetId: string; changes: Partial<Facet> }
  | { type: 'removeFacet'; facetId: string; mode: 'hide' | 'delete' }
```

### Three-Phase Frame Processing

Each frame executes in three deterministic phases:

```
┌─────────────── ONE FRAME ────────────────┐
│                                          │
│  Phase 1: Events → VEIL (Receptors)      │
│  • External events create facets         │
│  • Pure functions: (Event, State) → Facets│
│  • No side effects                       │
│                    ↓                      │
│  Phase 2: VEIL → VEIL (Transforms)       │
│  • Compute derived state                 │
│  • Update indexes and aggregations       │  
│  • Prepare rendering contexts            │
│  • Clean up ephemeral facets from last frame │
│                    ↓                      │
│  Phase 3: VEIL → Events (Effectors)      │
│  • React to facet changes                │
│  • Take external actions                 │
│  • Emit new events for next frame       │
└──────────────────────────────────────────┘
```

### Receptors (Pure Functions)

Receptors convert events into facets with NO side effects:

```typescript
interface Receptor {
  pattern: string;  // Event pattern to match
  transform(event: Event, state: ReadonlyVEILState): Facet[];
}

class DiscordMessageReceptor implements Receptor {
  pattern = 'discord:message';
  
  transform(event: Event, state: ReadonlyVEILState): Facet[] {
    const msg = event.payload;
    
    // Check if already exists (pure query)
    const exists = Array.from(state.facets.values())
      .some(f => f.attributes?.messageId === msg.messageId);
    
    if (exists) return [];
    
    return [
      // Message facet
      {
        type: 'discord-message',
        id: `discord-msg-${msg.messageId}`,
        content: `${msg.author}: ${msg.content}`,
        attributes: { ...msg }
      },
      // Update last read state (as a facet!)
      {
        type: 'state',
        id: `discord-lastread-${msg.channelId}`,
        content: msg.messageId,
        attributes: { 
          stateType: 'discord-lastread',
          channelId: msg.channelId 
        }
      }
    ];
  }
}
```

### Transforms (Pure Functions)

Transforms compute derived state during Phase 2:

```typescript
interface Transform {
  process(state: ReadonlyVEILState): Facet[];
}

// Built-in transform that runs first in Phase 2
// Note: This could return VEILOperations instead of Facets for cleanup
class EphemeralCleanupTransform implements Transform {
  process(state: ReadonlyVEILState): Facet[] {
    // Mark ephemeral facets for removal
    // The frame processor handles the actual removal
    return Array.from(state.facets.values())
      .filter(f => f.temporal === 'ephemeral')
      .map(f => ({
        type: 'system-operation',
        id: `cleanup-${f.id}`,
        temporal: 'ephemeral',
        content: `Remove ephemeral facet ${f.id}`,
        attributes: { 
          operation: 'removeFacet',
          targetId: f.id 
        }
      }));
  }
}

class MessageStatsTransform implements Transform {
  process(state: ReadonlyVEILState): Facet[] {
    const messages = Array.from(state.facets.values())
      .filter(f => f.type === 'discord-message');
    
    return [{
      type: 'derived-state',
      id: 'discord-stats',
      content: `${messages.length} total messages`,
      attributes: {
        totalCount: messages.length,
        byChannel: this.groupByChannel(messages),
        lastUpdate: Date.now()
      }
    }];
  }
}
```

### Effectors (Manage Resources)

Effectors handle external effects and resource management:

```typescript
interface Effector {
  pattern: FacetPattern;
  onFacetAdded?(facet: Facet, state: ReadonlyVEILState): Promise<Event[]>;
  onFacetChanged?(facet: Facet, prev: Facet, state: ReadonlyVEILState): Promise<Event[]>;
  onFacetRemoved?(facetId: string, state: ReadonlyVEILState): Promise<Event[]>;
}

class DiscordSendEffector implements Effector {
  private ws?: WebSocket;  // Resource management is OK here
  
  pattern = { type: 'speech', attributes: { agentGenerated: true } };
  
  async onFacetAdded(facet: Facet): Promise<Event[]> {
    // Connect if needed (stateful but isolated)
    if (!this.ws) {
      this.ws = await this.connect();
    }
    
    // Send message
    await this.ws.send(JSON.stringify({
      type: 'message',
      channel: facet.attributes.target,
      content: facet.content
    }));
    
    // Emit confirmation event
    return [{
      topic: 'discord:message-sent',
      payload: { facetId: facet.id, timestamp: Date.now() }
    }];
  }
}
```

## Benefits

### 1. Unified Model
- Everything is a facet - no special cases
- All changes happen through 3 operations
- Clear endo/exotemporal separation

### 2. Perfect Debugging
- All state visible in VEIL
- Can snapshot at any phase boundary
- Complete audit trail of all changes

### 3. Trivial Testing
```typescript
// Receptors are pure functions
expect(receptor.transform(event, state)).toEqual(expectedFacets);

// Transforms are pure functions  
expect(transform.process(state)).toEqual(expectedFacets);

// Only effectors need mocking
const events = await effector.onFacetAdded(facet, state);
expect(mockWebSocket.send).toHaveBeenCalled();
```

### 4. Simple Persistence
- Just save the facets and replay operations
- No hidden state to persist
- Perfect reconstruction every time

### 5. Natural Parallelism
- All receptors in Phase 1 can run in parallel
- All transforms in Phase 2 can run in parallel  
- All effectors in Phase 3 can run in parallel

## Implementation Examples

### HUD as Transform + Effector

**Phase 2 Transform:**
```typescript
class HUDTransform implements Transform {
  process(state: ReadonlyVEILState): Facet[] {
    const relevant = this.selectRelevantFacets(state);
    const salient = this.computeSaliency(relevant);
    
    return [{
      type: 'hud-context',
      id: 'hud-current',
      visibility: 'system',
      attributes: {
        selectedFacets: salient,
        tokenBudget: 4000,
        compressionLevel: 0.3
      }
    }];
  }
}
```

**Phase 3 Effector:**
```typescript
class AgentEffector implements Effector {
  pattern = { type: 'agent-activation' };
  
  async onFacetAdded(activation: Facet): Promise<Event[]> {
    const hudContext = state.getFacet('hud-current');
    const rendered = this.renderToText(hudContext);
    const completion = await this.llm.complete(rendered);
    
    return this.parseCompletion(completion);
  }
}
```

### Memory Management as Transform

```typescript
class MemoryTransform implements Transform {
  process(state: ReadonlyVEILState): Facet[] {
    const frames = this.getRecentFrames(state);
    
    if (frames.length > THRESHOLD) {
      const compressed = this.compress(frames);
      return [{
        type: 'memory-chunk',
        id: `memory-${Date.now()}`,
        visibility: 'system',
        content: compressed.summary,
        attributes: compressed
      }];
    }
    return [];
  }
}
```

## Migration Path

1. **Phase 1**: Implement Receptor/Effector interfaces alongside existing system
2. **Phase 2**: Migrate components one by one to new model
3. **Phase 3**: Remove old operation types and frame processing
4. **Phase 4**: Optimize with indexes and derived state

## Summary

This architecture delivers on Connectome's original vision:
- **Poly-temporal**: Clear endo/exo temporal separation
- **Transparent**: All state visible as facets
- **Deterministic**: Three-phase processing eliminates race conditions
- **Testable**: Pure functions at the core
- **Performant**: Natural parallelism and caching through derived facets

The system becomes what it was meant to be: a **facet transformation engine** operating across two temporal dimensions, creating a substrate for digital minds to exist, perceive, and act.
