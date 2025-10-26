# API Migration Guide

This guide helps you update existing Connectome code to use the new, cleaner APIs.

## Component Operations

### Adding Facets

**Old way:**
```typescript
this.element.addOperation({
  type: 'addFacet',
  facet: {
    id: `${this.element.id}-status-${Date.now()}`,
    type: 'state',
    content: 'Ready',
    attributes: { timestamp: Date.now() }
  }
});
```

**New way:**
```typescript
// For state facets:
this.addState('status', 'Ready', { timestamp: Date.now() });

// For ambient facets:
this.addAmbient('System message');

// For event facets:
this.addEvent('Something happened', 'system-event');
```

### Updating State

**Old way:**
```typescript
this.element.addOperation({
  type: 'changeState',
  facetId: `${this.element.id}-status`,
  updates: {
    content: 'Active',
    attributes: { connections: 5 }
  }
});
```

**New way:**
```typescript
this.updateState('status', {
  content: 'Active',
  attributes: { connections: 5 }
});
```

## Creating Events

**Old way:**
```typescript
const event = {
  topic: 'my-component:action',
  source: {
    elementId: this.element.id,
    elementPath: this.element.getPath(),  // Had to know about getPath()!
    elementType: this.element.constructor.name
  },
  payload: { action: 'clicked' }
};
this.element.emit(event);
```

**New way:**
```typescript
const event = createSpaceEvent('my-component:action', this.element, {
  action: 'clicked'
});
this.element.emit(event);
```

## Agent Activation

**Old way:**
```typescript
this.element.addOperation({
  type: 'addFacet',
  facet: {
    id: `activation-${Date.now()}-${Math.random()...}`,
    type: 'agentActivation',
    content: 'User needs help',
    attributes: {
      reason: 'User needs help',
      priority: 'high',
      source: 'help-system'
    }
  }
});
```

**New way:**
```typescript
const activation = createAgentActivation('User needs help', {
  priority: 'high',
  source: 'help-system'
});

this.addOperation(addFacet(
  activation.content,
  activation.type,
  activation.attributes
));
```

## Frame Safety

**Old way:**
```typescript
// Hope we're in a frame, or get cryptic errors
this.element.addOperation(...);
```

**New way:**
```typescript
// Check explicitly:
if (this.inFrame()) {
  this.addOperation(...);
}

// Or require it:
this.requireFrame();  // Throws helpful error if not in frame
this.addOperation(...);

// Or defer:
this.deferToNextFrame(() => {
  this.addAmbient('This runs in the next frame');
});
```

## Imports

**Old way:**
```typescript
import { Component } from 'connectome-ts/dist/spaces/component';
import { SpaceEvent } from 'connectome-ts/dist/spaces/types';
// SpaceNotesComponent wasn't even exported!
```

**New way:**
```typescript
import { 
  Component,
  SpaceNotesComponent,
  createSpaceEvent,
  addFacet,
  // ... all from the root
} from 'connectome-ts';
```

## Quick Conversion Checklist

1. ✅ Replace manual `addOperation({ type: 'addFacet', facet: {...} })` with helper methods
2. ✅ Use `createSpaceEvent()` instead of building event objects
3. ✅ Replace `changeState` operations with `updateState()` helper
4. ✅ Update imports to use root package exports
5. ✅ Add frame safety checks where needed
6. ✅ Use factory functions for complex objects

## Still Complex?

Some operations remain complex by necessity (like custom VEIL operations). But now the common cases are simple, and the complex cases have examples to follow.
