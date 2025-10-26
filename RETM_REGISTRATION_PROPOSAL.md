# RETM Component Registration - Architectural Proposal

## The Problem

Currently, components that are both Element Components AND RETM phase participants need to be registered twice:

```typescript
// Current approach - error prone!
const effector = new MyEffector();
element.addComponent(effector);        // Add to element
space.addEffector(effector);          // Register for Phase 3
```

This leads to:
- Duplicate registration
- Easy to forget one or the other
- Tight coupling in ElementTreeMaintainer

## Root Cause Analysis

Why do we need separate registration?

1. **Element Components**: Live in the element tree, have lifecycle (mount/unmount)
2. **RETM Components**: Participate in phases, discovered by Space for processing

The issue is that Space maintains separate arrays (`receptors`, `transforms`, etc.) that are disconnected from the element tree.

## Solution Options

### Option 1: Auto-Discovery (Recommended)

Space discovers RETM components by traversing the element tree at the start of each phase:

```typescript
// In Space
private discoverReceptors(): Receptor[] {
  const receptors: Receptor[] = [];
  this.traverseComponents((component) => {
    if (isReceptor(component)) {
      receptors.push(component);
    }
  });
  return receptors;
}

// Type guard
function isReceptor(component: any): component is Receptor {
  return 'topics' in component && 
         'transform' in component &&
         typeof component.transform === 'function';
}
```

**Pros:**
- No dual registration needed
- Components are automatically discovered
- Works with dynamic component addition/removal
- Single source of truth (element tree)

**Cons:**
- Traversal overhead (but likely negligible)
- Need type guards for each interface

### Option 2: Self-Registration in mount()

Components register themselves when mounted:

```typescript
class MyEffector extends BaseEffector {
  async mount(element: Element): Promise<void> {
    await super.mount(element);
    
    // Self-register with Space
    const space = this.findSpace(element);
    if (space && isEffector(this)) {
      space.addEffector(this);
    }
  }
  
  private findSpace(element: Element): Space | null {
    let current: Element | null = element;
    while (current) {
      if (current instanceof Space) return current;
      current = current.parent;
    }
    return null;
  }
}
```

**Pros:**
- Explicit registration
- Components control their own registration

**Cons:**
- Boilerplate in every component
- Need to handle unmount/unregister
- Components need to find Space

### Option 3: Element Notifies Space

Element checks component interfaces and notifies Space:

```typescript
// In Element
addComponent<T extends Component>(component: T): T {
  this._components.push(component);
  
  // Notify Space if RETM component
  const space = this.findSpace();
  if (space) {
    if (isReceptor(component)) space.addReceptor(component);
    if (isTransform(component)) space.addTransform(component);
    // etc.
  }
  
  // Continue with attachment...
}
```

**Pros:**
- Automatic registration
- No component boilerplate

**Cons:**
- Element needs to know about RETM interfaces
- Circular dependency issues
- What if component is added before Space exists?

### Option 4: Remove Dual Nature

Make components EITHER element components OR RETM components, never both:

```typescript
// RETM components registered directly with Space
space.addEffector(new MyEffector());

// Element components only in element tree
element.addComponent(new MyUIComponent());
```

**Pros:**
- Clear separation of concerns
- No registration confusion

**Cons:**
- Major breaking change
- Some components naturally are both
- Less flexible

## Recommendation: Auto-Discovery

I recommend **Option 1 (Auto-Discovery)** because:

1. **Zero boilerplate** - Components don't need any registration code
2. **Single source of truth** - Element tree is the canonical location
3. **Dynamic** - Handles runtime component addition/removal
4. **Low overhead** - Tree traversal is fast for typical element counts
5. **Backwards compatible** - Can keep explicit registration as override

Implementation would be:
1. Add type guards for each RETM interface
2. Modify each phase to discover components before processing
3. Cache discovery results within a frame for efficiency
4. Deprecate (but keep) explicit registration methods

## Migration Path

1. Implement auto-discovery alongside existing registration
2. Update examples to use only `element.addComponent()`
3. Remove explicit `space.addX()` calls
4. Eventually deprecate manual registration methods

This solves the immediate problem while simplifying the mental model!
