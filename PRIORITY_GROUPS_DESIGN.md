# Priority Groups Design

**Date**: October 2025  
**Status**: 🟡 READY TO IMPLEMENT

## Overview

Implement priority-grouped execution across all MARTEM phases to ensure proper ordering and visibility of changes.

## Core Concept

Instead of running all components in a phase together, we:
1. Group components by priority
2. Run each priority group to completion
3. Apply and commit all changes before moving to next group
4. Next group sees complete output of previous groups

## Implementation

### 1. Update Component Interfaces

```typescript
// All MARTEM components get optional priority
interface Receptor extends Component {
  priority?: number;  // Default: 50
  topics: string[];
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[];
}

interface Transform extends Component {
  priority?: number;  // Already exists
  // ...
}

interface Effector extends Component {
  priority?: number;  // Default: 50
  // ...
}

interface Maintainer extends Component {
  priority?: number;  // Default: 50
  // ...
}
```

### 2. Priority Convention

Components choose their own priority numbers. By convention:
- Lower numbers run first (priority 10 runs before priority 50)
- Default priority is 50 if not specified
- Components document their priority choices
- Leave gaps for future components (10, 20, 50, 100, etc.)

### 3. Generic Priority Grouping

```typescript
// In Space
private groupByPriority<T extends { priority?: number }>(
  components: T[]
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  
  for (const component of components) {
    const priority = component.priority ?? 50;
    const group = groups.get(priority) || [];
    group.push(component);
    groups.set(priority, group);
  }
  
  // Sort by priority (ascending)
  return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]));
}
```

### 4. Phase Implementations

#### Phase 1: Receptors
```typescript
private runPhase1(events: SpaceEvent[]): VEILDelta[] {
  const allDeltas: VEILDelta[] = [];
  const receptorGroups = this.groupByPriority(this.getReceptorsList());
  
  for (const [priority, receptors] of receptorGroups) {
    const groupDeltas: VEILDelta[] = [];
    
    for (const event of events) {
      for (const receptor of receptors) {
        if (this.matchesTopic(receptor, event.topic)) {
          const deltas = receptor.transform(event, this.getReadonlyState());
          groupDeltas.push(...deltas);
        }
      }
    }
    
    // Apply this priority group's changes
    if (groupDeltas.length > 0) {
      this.veilState.applyDeltasDirect(groupDeltas);
      this.currentFrame.deltas.push(...groupDeltas);
      allDeltas.push(...groupDeltas);
    }
  }
  
  return allDeltas;
}
```

#### Phase 2: Transforms (with iterations)
```typescript
private runPhase2(): VEILDelta[] {
  const allDeltas: VEILDelta[] = [];
  const transformGroups = this.groupByPriority(this.getTransforms());
  
  for (const [priority, transforms] of transformGroups) {
    let iteration = 0;
    
    // Run this priority group until stable
    while (iteration < this.maxIterations) {
      const groupDeltas: VEILDelta[] = [];
      
      for (const transform of transforms) {
        const deltas = transform.process(this.getReadonlyState());
        groupDeltas.push(...deltas);
      }
      
      if (groupDeltas.length === 0) break;
      
      this.veilState.applyDeltasDirect(groupDeltas);
      this.currentFrame.deltas.push(...groupDeltas);
      allDeltas.push(...groupDeltas);
      
      iteration++;
    }
  }
  
  return allDeltas;
}
```

#### Phase 3: Effectors
```typescript
private async runPhase3(changes: FacetDelta[]): Promise<SpaceEvent[]> {
  const allEvents: SpaceEvent[] = [];
  const effectorGroups = this.groupByPriority(this.getEffectors());
  
  for (const [priority, effectors] of effectorGroups) {
    const groupEvents: SpaceEvent[] = [];
    
    for (const effector of effectors) {
      const relevantChanges = this.filterChanges(changes, effector);
      if (relevantChanges.length > 0) {
        const result = await effector.process(
          relevantChanges, 
          this.getReadonlyState()
        );
        groupEvents.push(...(result.events || []));
      }
    }
    
    allEvents.push(...groupEvents);
    
    // Note: Effectors don't produce deltas, only events
    // But they might update component-state facets directly
  }
  
  return allEvents;
}
```

## Usage Examples

### Content Generation → Context Rendering
```typescript
class ContentGenerationTransform extends BaseTransform {
  priority = 50;  // Run with default priority
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // Generate summaries, analysis, etc.
  }
}

class ContextTransform extends BaseTransform {
  priority = 100;  // Run after content generation
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // Now guaranteed to see all content generation
  }
}
```

### Event Preprocessing → Main Processing
```typescript
class EventNormalizerReceptor extends BaseReceptor {
  priority = 10;  // Run early to normalize events
  topics = ['raw:input'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    // Normalize raw events
  }
}

class MessageReceptor extends BaseReceptor {
  // No priority specified, uses default 50
  topics = ['message'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    // Process normalized messages
  }
}
```

## Benefits

1. **Deterministic Ordering**: Components execute in well-defined order
2. **Complete Visibility**: Each priority group sees complete output of previous groups
3. **Natural Phases**: Infrastructure → Processing → Aggregation → Cleanup
4. **Backwards Compatible**: Components without priority use default (50)
5. **Flexible**: Can create as many priority levels as needed

## Migration

1. Add priority to existing components where order matters
2. Update Space to use priority grouping
3. Document common priority levels
4. Test with complex multi-component scenarios

## Considerations

- **Performance**: More groups = more overhead (but usually negligible)
- **Debugging**: Clear logging of which priority group is running
- **Documentation**: Must document priority conventions clearly
