# Component State Management Specification

**Date**: September 30, 2025  
**Status**: 🟡 PROPOSED ARCHITECTURE

---

## Overview

This specification describes a new state management system for MARTEM components that allows them to directly manage their own persistent state within VEIL, replacing the legacy `@persistent` decorator pattern.

## Problem Statement

The current `@persistent` decorator pattern conflicts with VEIL as the single source of truth:
- Components with persistent state must emit events and wait for the next frame to see updates
- This creates race conditions, lost increments, and state inconsistency
- Afferents are especially problematic as they run outside the event loop
- Configuration and runtime state are conflated

## Proposed Solution

### Core Concept

Each component instance can directly read and write to its own scoped state facet within VEIL, with write permissions determined by component phase.

### Component State Facet

```typescript
interface ComponentStateFacet extends BaseFacet, StateAspect<any> {
  type: 'component-state';
  componentType: string;      // e.g., 'discord-effector'
  componentClass: 'modulator' | 'afferent' | 'receptor' | 'transform' | 'effector' | 'maintainer';
  componentId: string;        // Unique instance ID
  elementId: string;          // Owning element
  state: Record<string, any>; // Component-managed state
}
```

### Write Permissions by Phase

| Component Type | Phase | VEIL Write Access |
|---------------|-------|-------------------|
| Modulator | 0 | ❌ None (pure event processor) |
| Receptor | 1 | ✅ Full access |
| Transform | 2 | ✅ Full access |
| Effector | 3 | 🔒 Own component-state only |
| Maintainer | 4 | 🔒 Own component-state only |
| Afferent | Async | 🔒 Own component-state via bridge |

### Base Class API

```typescript
// In BaseEffector and BaseMaintainer
abstract class BaseEffector extends Component implements Effector {
  private componentId: string;
  
  /**
   * Get this component's state from VEIL
   */
  protected getState<T = any>(): T {
    const facet = this.element.space.state.getFacet(`component-state:${this.componentId}`);
    return (facet?.state || {}) as T;
  }
  
  /**
   * Update this component's state in VEIL
   * Only works during this component's allowed phase
   */
  protected updateState<T = any>(updates: Partial<T>): void {
    const currentState = this.getState<T>();
    const newState = { ...currentState, ...updates };
    
    const op: VEILOperation = {
      type: 'change',
      target: `component-state:${this.componentId}`,
      state: newState
    };
    
    // Direct VEIL update within current phase
    this.applyStateOperation(op);
  }
  
  /**
   * Replace entire state
   */
  protected setState<T = any>(state: T): void {
    const op: VEILOperation = {
      type: 'change',
      target: `component-state:${this.componentId}`,
      state
    };
    
    this.applyStateOperation(op);
  }
  
  private applyStateOperation(op: VEILOperation): void {
    // This would be implemented to directly modify VEIL
    // within the current phase's processing
    this.element.space._applyComponentStateOp(op, this.componentId);
  }
}
```

### Configuration Management

Component configuration comes from element properties via VEIL:

```typescript
interface ComponentConfigFacet extends BaseFacet, StateAspect<any> {
  type: 'component-config';
  componentType: string;
  elementId: string;
  config: Record<string, any>;
}

// In base Component class
abstract class Component {
  protected getConfig<T = any>(): T {
    const facet = this.element.getFacet(`component-config:${this.element.id}:${this.componentType}`);
    return (facet?.config || {}) as T;
  }
  
  protected watchConfig(callback: (config: any) => void): void {
    // Subscribe to config changes between frames
  }
}
```

### Afferent State Bridge

Afferents need special handling due to their async nature:

```typescript
interface AfferentStateBridge {
  // Read current state (async)
  getState(): Promise<any>;
  
  // Update state (queued for next safe point)
  updateState(updates: Partial<any>): void;
  
  // Replace state (queued)
  setState(state: any): void;
}

// In BaseAfferent
abstract class BaseAfferent<TConfig, TCommand> extends Component {
  private stateBridge: AfferentStateBridge;
  
  protected async getState<T = any>(): Promise<T> {
    return this.stateBridge.getState();
  }
  
  protected updateState<T = any>(updates: Partial<T>): void {
    this.stateBridge.updateState(updates);
  }
}
```

The bridge ensures afferent state updates are applied atomically between frames.

## Migration Strategy

### Phase 1: Add New API
1. Implement component-state facets
2. Add state methods to base classes
3. Update Space to handle scoped writes

### Phase 2: Gradual Migration
```typescript
// Old pattern
class DiscordEffector {
  @persistent
  private messageCount = 0;
  
  handleMessage() {
    this.messageCount++; // Only in memory
    this.emit({ type: 'persist-count', count: this.messageCount });
  }
}

// New pattern
class DiscordEffector extends BaseEffector {
  handleMessage() {
    const state = this.getState<{ messageCount: number }>();
    this.updateState({ 
      messageCount: (state.messageCount || 0) + 1 
    }); // Persisted immediately
  }
}
```

### Phase 3: Deprecate @persistent
1. Mark decorator as deprecated
2. Provide migration guide
3. Eventually remove

## Benefits

1. **Consistency**: All components see the same state values
2. **Atomicity**: Updates are immediate within phases
3. **Simplicity**: No event round-trips for state updates
4. **Debugging**: All state visible in VEIL
5. **Time Travel**: State changes part of frame history

## Implementation Considerations

### Performance
- Component state facets should be indexed by componentId
- Batch updates within a phase
- Lazy initialization of state facets

### Persistence
- Component state facets are automatically persisted
- On restoration, components read their state normally
- No special restoration logic needed

### Validation
- Space validates componentId matches the writing component
- Writes outside allowed phase throw errors
- Type safety via TypeScript generics

## Example Usage

### Effector with Counter
```typescript
interface DiscordState {
  messageCount: number;
  lastMessageTime: number;
  errorCount: number;
}

class DiscordEffector extends BaseEffector {
  async handleMessage(facet: MessageFacet) {
    const state = this.getState<DiscordState>();
    
    try {
      await this.sendToDiscord(facet.content);
      
      this.updateState({
        messageCount: (state.messageCount || 0) + 1,
        lastMessageTime: Date.now()
      });
    } catch (error) {
      this.updateState({
        errorCount: (state.errorCount || 0) + 1
      });
    }
  }
}
```

### Maintainer Tracking Work
```typescript
interface PersistenceState {
  lastSavedFrame: number;
  lastSaveTime: number;
  totalBytesSaved: number;
}

class PersistenceMaintainer extends BaseMaintainer {
  async process(frame: Frame, changes: FacetDelta[]): Promise<SpaceEvent[]> {
    const bytes = await this.saveFrame(frame);
    const state = this.getState<PersistenceState>();
    
    this.updateState({
      lastSavedFrame: frame.sequence,
      lastSaveTime: Date.now(),
      totalBytesSaved: (state.totalBytesSaved || 0) + bytes
    });
    
    return [];
  }
}
```

### Afferent Connection State
```typescript
interface ConsoleState {
  totalLinesRead: number;
  lastInputTime: number;
  sessionStartTime: number;
}

class ConsoleAfferent extends BaseAfferent {
  protected async onLineReceived(line: string) {
    const state = await this.getState<ConsoleState>();
    
    this.updateState({
      totalLinesRead: (state.totalLinesRead || 0) + 1,
      lastInputTime: Date.now()
    });
    
    this.context.emit({
      type: 'console:message',
      payload: { message: line }
    });
  }
}
```

## Open Questions

1. **State Facet Lifecycle**: When are component-state facets created/destroyed?
2. **Schema Validation**: Should component state have schemas?
3. **Access Control**: How to prevent components from accidentally writing to others' state?
4. **Debugging Tools**: What tooling do we need to inspect component state?

## Next Steps

1. Review and refine specification
2. Implement proof of concept with one effector
3. Update Space to support scoped writes
4. Migrate a few components to validate approach
5. Full implementation across all component types

