# Tag-Based Continuation System

**Date**: October 1, 2025  
**Status**: 🟢 IMPLEMENTED

---

## Overview

The continuation system allows any operation in Connectome to specify what should happen after it completes. This solves the problem of maintaining intent across phase boundaries and frames, enabling complex multi-step workflows while respecting the MARTEM architecture.

## Problem Statement

In a phase-based architecture, operations that span multiple phases lose their context:
1. Transform creates an `element:create` facet (Phase 2)
2. Maintainer creates the element (Phase 4) 
3. Original intent (e.g., "activate agent after box created") is lost

Without continuations, components must use workarounds like event listeners or polling.

## Solution: General Continuations

### Core Concepts

1. **Continuation Specifications**: Any operation can include a `continuations` array specifying facets to create upon completion
2. **Completion Facets**: Operations emit `continuation:complete` facets with success/failure status and results
3. **ContinuationTransform**: Processes completions and creates specified facets
4. **Template Interpolation**: Continuation specs can reference values from operation results

### Facet Types

```typescript
// Completion notification
interface ContinuationCompleteFacet {
  type: 'continuation:complete';
  state: {
    continuationTag: string;
    success: boolean;
    result?: any;
    error?: string;
    continuations?: ContinuationSpec[];
  };
}

// What to do next
interface ContinuationSpec {
  facetType: string;           // Type of facet to create
  facetSpec: any;             // Facet data (supports templates)
  condition?: 'success' | 'failure' | 'always';
}
```

## Usage Examples

### Simple Notification
```typescript
// Create element with notification
{
  type: 'element-request',
  state: {
    name: 'my-element',
    continuations: [{
      facetType: 'event',
      facetSpec: {
        eventType: 'notification',
        content: 'Element {{elementId}} created!'
      },
      condition: 'success'
    }]
  }
}
```

### Agent Activation
```typescript
// Dispenser creates box and activates agent
{
  type: 'element:create',
  payload: {
    elementType: 'Box',
    continuations: [{
      facetType: 'agent-activation',
      facetSpec: {
        agentId: 'main',
        trigger: {
          type: 'box-created',
          boxId: '{{elementId}}'
        }
      }
    }]
  }
}
```

### Operation Chaining
```typescript
// Create parent, then child, then notify
{
  type: 'element-request',
  state: {
    name: 'parent',
    continuations: [{
      facetType: 'element-request',
      facetSpec: {
        name: 'child',
        parentId: '{{elementId}}',
        continuations: [{
          facetType: 'state',
          facetSpec: {
            content: 'Hierarchy complete',
            parentId: '{{result.parentId}}',
            childId: '{{elementId}}'
          }
        }]
      }
    }]
  }
}
```

## Template Interpolation

Continuation specs support simple template variables:
- `{{elementId}}` - ID of created element
- `{{name}}` - Element name
- `{{result.field}}` - Any field from operation result
- `{{error}}` - Error message on failure

## Integration Points

### Components Supporting Continuations

Currently implemented:
- **ElementTreeMaintainer**: Emits completion for element creation
- **ContinuationTransform**: Processes all completions

To add continuation support to any operation:
1. Accept `continuations` in the operation payload
2. Emit `continuation:complete` with results
3. Include the continuations array in the completion

### Example Implementation
```typescript
// In a maintainer
if (operation.continuations) {
  events.push({
    topic: 'veil:operation',
    payload: {
      operation: {
        type: 'addFacet',
        facet: {
          type: 'continuation:complete',
          state: {
            continuationTag: operation.tag || `op-${Date.now()}`,
            success: true,
            result: { /* operation results */ },
            continuations: operation.continuations
          },
          ephemeral: true
        }
      }
    }
  });
}
```

## Benefits

1. **Declarative**: Intent is expressed with the operation
2. **Flexible**: Any facet type can be created
3. **Conditional**: Different paths for success/failure
4. **Composable**: Continuations can have continuations
5. **Type-Safe**: Can be strongly typed with TypeScript

## Best Practices

1. **Use specific continuation tags** for debugging
2. **Keep facetSpecs simple** - complex logic belongs in transforms
3. **Handle both success and failure** when appropriate
4. **Document template variables** in operation specs
5. **Make continuations optional** - operations should work without them

## Future Enhancements

1. **Complex conditions**: Beyond success/failure (e.g., `result.count > 5`)
2. **Multiple condition matching**: AND/OR logic
3. **Delayed continuations**: Wait N frames before executing
4. **Cancellable continuations**: Ability to prevent execution
5. **Type-safe templates**: Compile-time checking of template paths

