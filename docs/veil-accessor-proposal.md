# VEIL Accessor Interface Proposal

## Motivation

Currently, components directly access `VEILStateManager.getState()` which:
1. Returns the entire state in memory
2. Tightly couples components to the current storage implementation
3. Makes it difficult to optimize for long-running sessions
4. Provides no temporal query capabilities

As sessions grow longer and state history becomes critical for debugging and replay, we need a more flexible access pattern.

## Design Goals

1. **Temporal Queries**: Access state at any point in history
2. **Performance**: Lazy loading and efficient access patterns
3. **Flexibility**: Easy to swap storage backends (memory → disk → database)
4. **Type Safety**: Maintain TypeScript guarantees
5. **Simplicity**: Keep the interface intuitive

## Proposed Interface

```typescript
interface VEILAccessor {
  // === Current State Access ===
  
  // Get current facets (optionally filtered)
  getFacets(options?: { 
    types?: string[];
    aspects?: Partial<Facet>;
  }): ReadonlyMap<string, Facet>;
  
  // Get current frame sequence number
  getCurrentSequence(): number;
  
  // Get current stream/agent context
  getCurrentContext(): {
    stream?: StreamRef;
    agent?: string;
  };
  
  // === Temporal Queries ===
  
  // Get a specific facet at a specific frame
  getFacetAtFrame(facetId: string, frameSequence: number): Facet | undefined;
  
  // Get the complete state at a specific frame
  getStateAtFrame(frameSequence: number): ReadonlyVEILState;
  
  // Get the history of a specific facet
  getFacetHistory(facetId: string, options?: { 
    fromFrame?: number; 
    toFrame?: number;
  }): Array<{
    frame: number;
    operation: 'added' | 'changed' | 'removed';
    facet: Facet | null; // null if removed
  }>;
  
  // Find frames where a condition was true
  findFramesWhere(predicate: (state: ReadonlyVEILState) => boolean, options?: {
    after?: number;
    before?: number;
    limit?: number;
  }): number[];
  
  // === Frame Access ===
  
  // Get frame history with pagination
  getFrameHistory(options?: { 
    limit?: number; 
    offset?: number;
    includeOperations?: boolean; // false = just metadata
  }): ReadonlyArray<Frame>;
  
  // Get a specific frame by sequence
  getFrame(sequence: number): Frame | undefined;
  
  // === Efficient Bulk Access ===
  
  // Get multiple facets in one call
  getFacetsByIds(ids: string[]): ReadonlyMap<string, Facet>;
  
  // Get all facets matching criteria
  queryFacets(query: {
    type?: string;
    aspects?: Partial<Facet>;
    content?: RegExp;
  }): Facet[];
}
```

## Implementation Strategy

### Phase 1: Simple Implementation
- Implement interface over current `VEILStateManager`
- Temporal queries replay operations from frame 0 (inefficient but correct)
- No caching or optimization

### Phase 2: Optimization
- Add frame snapshots every N frames (configurable)
- Cache frequently accessed states
- Track facet change indices for faster history queries

### Phase 3: Storage Backends
- Abstract storage interface
- Implement disk-based storage for large histories
- Consider SQLite for complex queries

## Migration Path

1. Define `VEILAccessor` interface
2. Make `VEILStateManager` implement `VEILAccessor`
3. Update components to accept `VEILAccessor` instead of `VEILStateManager`:
   - `ContextTransform`
   - `AgentEffector`
   - Any other components that need state access
4. Update `ReadonlyVEILState` to use accessor methods instead of direct properties

## Example Usage

```typescript
// In ContextTransform
class ContextTransform implements Transform {
  constructor(
    private accessor: VEILAccessor,
    private compressionEngine?: CompressionEngine
  ) {}
  
  process(state: ReadonlyVEILState): Facet[] {
    // Get recent frame history efficiently
    const recentFrames = this.accessor.getFrameHistory({ 
      limit: 100,
      includeOperations: true 
    });
    
    // Check if agent config changed recently
    const agentConfigHistory = this.accessor.getFacetHistory('agent-config', {
      fromFrame: state.currentSequence - 50
    });
    
    // ... render context ...
  }
}
```

## Open Questions

1. **Async vs Sync**: Should accessor methods be async to support remote/disk storage?
   - Pro: Future flexibility
   - Con: Complicates current usage
   - Recommendation: Start sync, add async variants later

2. **Caching Policy**: Who controls caching - the accessor or the implementation?
   - Recommendation: Implementation-controlled with hints from accessor

3. **Change Notifications**: Should the accessor support subscriptions to changes?
   - Recommendation: Keep separate - accessor for reading, existing event system for changes

4. **Performance Guarantees**: Should we specify big-O complexity for operations?
   - Recommendation: Document expected performance, optimize implementation as needed

## Benefits

1. **Decoupling**: Components no longer tied to storage implementation
2. **Performance**: Can optimize access patterns without changing component code
3. **Debugging**: Temporal queries make it easy to understand state evolution
4. **Testing**: Can mock accessor for deterministic tests
5. **Scalability**: Path to handling very long sessions

## Risks

1. **Over-abstraction**: Interface might be too complex for simple use cases
2. **Performance**: Extra abstraction layer might add overhead
3. **Migration effort**: Need to update all state-accessing components

## Recommendation

Proceed with Phase 1 implementation during the current refactor. The interface provides immediate benefits (decoupling, better testing) while enabling future optimizations. The temporal query capabilities align perfectly with Connectome's poly-temporal philosophy.
