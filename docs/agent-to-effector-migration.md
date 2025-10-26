# Migrating AgentComponent to AgentEffector

## Overview

AgentComponent needs to become an Effector in the new Receptor/Effector architecture. This is more complex than the HUD migration because agents are stateful and interact with external LLMs.

## Current Architecture

```typescript
// Old: AgentComponent listens for frame:end events
class AgentComponent extends VEILComponent {
  async handleEvent(event: SpaceEvent) {
    if (event.topic === 'frame:end') {
      // Look for activation facets in the frame
      // Run agent if activated
      // Emit agent:frame-ready event with response
    }
  }
}
```

## New Architecture

```typescript
// New: AgentEffector watches for activation + context facets
class AgentEffector implements Effector {
  facetFilters = [
    { type: 'agentActivation' },
    { type: 'rendered-context' }
  ];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState) {
    // Find new activations with contexts
    // Run agent cycle
    // Return speech/action/thought facets
  }
}
```

## Key Challenges

1. **State Management**: Agents track sleeping state, ignored sources, etc.
2. **Context Dependency**: Agent needs rendered context before it can run
3. **Tool Processing**: Actions need to be processed by elements
4. **Stream Routing**: Speech needs to be routed to correct output

## Migration Strategy

### Phase 1: Parallel Implementation
- Keep AgentComponent working
- Implement AgentEffector alongside
- Test both work correctly

### Phase 2: Switch Over
- Disable agent:frame-ready handling in Space
- Enable AgentEffector
- Remove AgentComponent from examples

### Phase 3: Cleanup
- Remove AgentComponent
- Remove agent:frame-ready event type
- Update documentation

## Benefits

- Clean separation of concerns
- Agents become pure processors
- Context rendering is decoupled
- Easier to test and debug
- Multiple agents can run independently

