# HUD Simplification with Facet Aspects

## Current HUD Behavior (Must Preserve)

1. **Frame-based rendering**: Each frame is rendered independently, maintaining historical accuracy
2. **State replay**: State is rebuilt by replaying operations from frame 0 to ensure correct historical state
3. **Turn attribution**: Each frame belongs to whoever triggered it (external event or specific agent)
4. **Ambient floating**: Ambient facets are injected at a preferred depth (e.g., 5 messages back)
5. **State transitions**: Detect state changes by comparing before/after states
6. **My-turn wrapping**: Current agent's operations wrapped in `<my_turn>` tags for prefill

## New Multi-Agent Turn Model

Instead of incoming/outgoing, turns are attributed to their trigger:

1. **External trigger** (Discord, console, etc.) → User turn
   - Contains the external event and any immediate state changes
   - All facets in this frame are part of the user's "turn"

2. **Agent trigger** → That agent's turn  
   - Contains the agent's speech/actions AND resulting state changes
   - Other agents' responses in the same frame are part of the triggering agent's turn
   - Wrapped in `<my_turn>` only if it's the current agent

Example:
```
Frame 1 (triggered by Discord user "Alice"):
  - Event: "Alice: Hello agents!"
  - State change: conversation_started = true
  - Agent A activation facet created
  → This is all "Alice's turn" (user message)

Frame 2 (triggered by Agent A activation):
  - Agent A speaks: "Hello Alice!"
  - State change: greeting_count++
  - Agent B activation facet created
  → This is all "Agent A's turn" (assistant message if A is current agent)

Frame 3 (triggered by Agent B activation):
  - Agent B speaks: "Hi there!"
  → This is "Agent B's turn" (user message if A is current agent)
```

## Simplifications Enabled by Aspects

### 1. Content Rendering

**Current**: Check both `facet.content` and `facet.children`
```typescript
if (!facet.content && (!facet.children || facet.children.length === 0)) {
  return null;
}
```

**With Aspects**: Use `hasContentAspect`
```typescript
if (!hasContentAspect(facet) && (!facet.children || facet.children.length === 0)) {
  return null;
}
```

### 2. Facet Type Detection

**Current**: String comparison
```typescript
if (facet.type === 'state') { /* ... */ }
if (facet.type === 'ambient') { /* ... */ }
```

**With Aspects**: Type-safe checks
```typescript
// For state facets
if (facet.type === 'state' && hasStateAspect(facet)) {
  // Now TypeScript knows this is a StateFacet
  const entityId = facet.entityId; // Type-safe access
}

// For ambient facets  
if (facet.type === 'ambient' && hasStreamAspect(facet)) {
  // Now TypeScript knows this is an AmbientFacet
  const streamId = facet.streamId; // Type-safe access
}
```

### 3. Agent Attribution

**Current**: Check attributes
```typescript
const isAgentGenerated = facet.attributes?.agentGenerated;
const agentId = facet.attributes?.agentId;
```

**With Aspects**: Direct access
```typescript
if (hasAgentGeneratedAspect(facet)) {
  const agentId = facet.agentId;
  const agentName = facet.agentName;
}
```

### 4. Turn Detection

**Current**: Incoming vs Outgoing based on operation types
```typescript
private isIncomingFrame(frame: VEILFrame): boolean {
  const incomingOps = ['addFacet', 'changeState', 'addStream', ...];
  const outgoingOps = ['speak', 'think', 'act'];
  
  return frame.deltas.some((op: any) => 
    incomingOps.includes(op.type) || 'facet' in op
  );
}
```

**With Multi-Agent Understanding**: Deduce frame trigger from content
```typescript
private getFrameTrigger(frame: Frame): { role: 'user' | 'assistant', agentId?: string } {
  // Turn attribution is based on what triggered frame processing
  // Since we don't have frame metadata, we deduce from content
  
  // Check for agent activation that triggered this frame
  const activation = frame.deltas.find(d =>
    d.type === 'removeFacet' &&
    this.wasAgentActivation(d.id) // Track consumed activations
  );
  
  if (activation) {
    const agentId = this.getActivationAgent(activation.id);
    return { 
      role: agentId === this.currentAgentId ? 'assistant' : 'user',
      agentId 
    };
  }
  
  // Check for agent-generated content (indicates agent triggered frame)
  const agentContent = frame.deltas.find(d =>
    d.type === 'addFacet' &&
    hasAgentGeneratedAspect(d.facet)
  );
  
  if (agentContent && hasAgentGeneratedAspect(agentContent.facet)) {
    return {
      role: agentContent.facet.agentId === this.currentAgentId ? 'assistant' : 'user',
      agentId: agentContent.facet.agentId
    };
  }
  
  // Default: external trigger (user turn)
  return { role: 'user' };
}
```

Note: Ideally, the Space would track which event triggered each frame, but without that metadata, we must deduce from frame content.

### 5. State Change Detection

**Current**: Complex attribute merging
```typescript
const updatedFacet = {
  ...existingFacet,
  ...operation.updates,
  attributes: {
    ...existingFacet.attributes,
    ...(operation.updates.attributes || {})
  }
};
```

**With Aspects**: Cleaner state updates
```typescript
if (delta.type === 'changeFacet') {
  const existing = replayedState.get(delta.id);
  if (existing && hasStateAspect(existing)) {
    const updated = {
      ...existing,
      ...delta.changes,
      // State aspect is at top level now
      state: {
        ...existing.state,
        ...(delta.changes as any).state
      }
    };
    replayedState.set(delta.id, updated);
  }
}
```

### 6. Ephemeral Cleanup

**Current**: No automatic cleanup
**With Aspects**: Can identify ephemeral facets
```typescript
// At frame end, remove ephemeral facets
for (const [id, facet] of replayedState) {
  if (hasEphemeralAspect(facet)) {
    replayedState.delete(id);
    removals?.set(id, 'delete');
  }
}
```

## Key Architectural Insights

1. **Aspects enable type narrowing**: Type guards give us TypeScript safety
2. **Flat structure reduces nesting**: `facet.agentId` vs `facet.attributes.agentId`
3. **Semantic clarity**: `hasContentAspect` is clearer than checking for content field
4. **Unified delta model**: No more special cases for different operation types

## Migration Strategy

1. Add type guards to imports
2. Update facet type checks to use guards
3. Simplify attribute access for aspect fields
4. Update delta handling for new VEILDelta structure
5. Add ephemeral cleanup at frame boundaries

## What NOT to Change

1. **Frame-based message building**: Keep the current turn structure
2. **State replay logic**: Historical accuracy is critical
3. **Ambient floating behavior**: The depth calculation works well
4. **Compression integration**: Frame-based compression is correct
5. **Before/after state tracking**: Needed for transition detection
