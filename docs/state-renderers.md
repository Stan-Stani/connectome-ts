# State Renderers

State renderers provide a way to automatically generate human-readable descriptions when state changes occur. They are fully serializable, ensuring consistent rendering across time and persistence.

## Overview

State facets can include two types of renderers:
- **Transition Renderers**: Generate descriptions when a specific state property changes
- **Attribute Renderers**: Generate descriptions for the current value of a state property

## Usage

```typescript
const stateFacet = createStateFacet({
  id: 'treasure-chest',
  content: 'Ancient Treasure Chest',
  entityType: 'component',
  entityId: 'treasure-chest',
  state: {
    isOpen: false,
    goldCount: 100
  },
  
  // Transition renderers describe changes
  transitionRenderers: {
    isOpen: (newValue, oldValue) => {
      if (!oldValue && newValue) {
        return 'The chest creaks open, revealing its treasures!';
      } else if (oldValue && !newValue) {
        return 'The chest slams shut with a heavy thud.';
      }
      return null;
    },
    goldCount: (newValue, oldValue) => {
      const diff = newValue - oldValue;
      if (diff < 0) {
        return `You take ${-diff} gold pieces from the chest.`;
      } else if (diff > 0) {
        return `${diff} gold pieces magically appear in the chest!`;
      }
      return null;
    }
  },
  
  // Attribute renderers describe current state
  attributeRenderers: {
    isOpen: (value) => value ? '(open)' : '(closed)',
    goldCount: (value) => `(${value} gold)`
  }
});
```

## Serialization

Renderers are automatically converted to serializable JavaScript code strings when created through `createStateFacet`. This ensures they can be:
- Persisted to storage
- Transmitted over networks
- Restored with identical behavior

### How It Works

When you provide a function to `createStateFacet`, it's automatically converted to a string:

```typescript
// You write:
attributeRenderers: {
  isOpen: (value) => value ? '(open)' : '(closed)'
}

// Stored as:
attributeRenderers: {
  isOpen: "return ((value) => value ? '(open)' : '(closed)')(value);"
}
```

The `StateTransitionTransform` safely evaluates these strings using `new Function()` when rendering.

## Integration with StateTransitionTransform

The `StateTransitionTransform` automatically:
1. Detects state changes between frames
2. Calls the appropriate transition renderer
3. Generates event facets with the rendered descriptions

```typescript
// Register the transform
space.addTransform(new StateTransitionTransform());

// State changes will automatically generate events
changeFacet('treasure-chest', { state: { isOpen: true } });
// Generates: "The chest creaks open, revealing its treasures!"
```

## Best Practices

1. **Keep Renderers Pure**: They should only depend on their input parameters
2. **Return null for No Description**: When a change shouldn't generate a message
3. **Be Descriptive**: Help create an immersive narrative experience
4. **Consider Edge Cases**: Handle all possible state transitions

## Historical Consistency

Because renderers are stored with the facet, historical rendering remains consistent:
- Old transitions render the same way they did when created
- Changing renderer logic only affects new facets
- No need to cache rendered strings


