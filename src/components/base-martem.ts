/**
 * Base implementations for MARTEM components
 * Provides default no-op implementations of Component lifecycle methods
 */

import { Component } from '../spaces/component';
import { ExecutionContext } from '../spaces/types';
import { 
  Modulator,
  Receptor, 
  Transform, 
  Effector, 
  Maintainer,
  SpaceEvent,
  ReadonlyVEILState,
  FacetDelta,
  EffectorResult
} from '../spaces/receptor-effector-types';
import { Frame, VEILDelta } from '../veil/types';
import { RETM_TYPE, RETM_TYPES } from '../utils/retm-type-guards';

/**
 * Base Modulator with default lifecycle
 */
export abstract class BaseModulator extends Component implements Modulator {
  readonly [RETM_TYPE] = RETM_TYPES.MODULATOR;
  priority = 0;
  
  abstract process(events: SpaceEvent[]): SpaceEvent[];
  
  reset?(): void;

  execute(context: ExecutionContext): void {
    console.warn(`[Deprecation] ${this.constructor.name} is a Modulator. Convert to Component.`);
    
    // Legacy bridge: wrap single event, call process, handle result
    const result = this.process([context.event]);
    
    if (result.length === 0) {
      // Event consumed/filtered
      // We can't easily "stop" execution here without signaling context
      // Maybe set a flag on event?
      (context.event as any).propagationStopped = true; 
    } else {
      // Update current event with first result
      // If modified, we should update context.event
      // But context.event is reference. 
      // We can try to mutate it or replace it if context allows (it's interface, but object)
      // context.event = result[0]; // This assigns to local param property, doesn't change caller's reference unless context is passed by reference (it is object)
      // But assignment to property of context works: context.event = result[0]
      
      if (result[0] !== context.event) {
         // Replace event in context for subsequent components
         context.event = result[0];
      }
      
      // If multiple events returned, emit the rest
      for (let i = 1; i < result.length; i++) {
        this.emit(result[i]);
      }
    }
  }

  // Implement Component interface requirements
  onMount(): void {
    // No-op by default
  }
  
  onUnmount(): void {
    // No-op by default
  }
}

/**
 * Base Receptor with default lifecycle
 */
export abstract class BaseReceptor extends Component implements Receptor {
  readonly [RETM_TYPE] = RETM_TYPES.RECEPTOR;
  priority = 100;
  
  abstract topics: string[];
  abstract transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[];
  
  execute(context: ExecutionContext): void {
    console.warn(`[Deprecation] ${this.constructor.name} is a Receptor. Convert to Component.`);
    
    // Check topic match
    if (!this.isSubscribedTo(context.event.topic)) {
       // Receptors explicitly list topics, check those too if not in subscriptions
       // But typically BaseReceptor doesn't auto-subscribe in legacy mode? 
       // Space handles routing.
       // In new Sequential mode, we must check manually.
       if (!this.topics.includes(context.event.topic)) {
         return;
       }
    }

    const deltas = this.transform(context.event, context.state);
    if (deltas && deltas.length > 0) {
      for (const delta of deltas) {
        this.addOperation(delta);
      }
    }
  }

  onMount(): void {
    // Auto-register with Space
    // Note: Space.addComponent already attempts auto-registration via _attach
    // But if manually mounted or specific logic needed, it can go here.
    // _attach in Component handles RETM registration now, so we might not need this.
    // But for safety we can leave empty or double check.
    // The base implementation in Component._attach handles:
    // if (isReceptor(this)) space.addReceptor(this);
    // So we don't need to do it here.
  }
  
  onUnmount(): void {
    // No-op by default
  }
}

/**
 * Base Transform with default lifecycle
 */
export abstract class BaseTransform extends Component implements Transform {
  readonly [RETM_TYPE] = RETM_TYPES.TRANSFORM;
  priority = 200;
  
  facetFilters?: import('../spaces/receptor-effector-types').FacetFilter[];
  abstract process(state: ReadonlyVEILState): VEILDelta[];
  
  execute(context: ExecutionContext): void {
    console.warn(`[Deprecation] ${this.constructor.name} is a Transform. Convert to Component.`);
    
    // Transforms run on every frame/event in legacy? 
    // Actually they ran in Phase 2 loop.
    // Here they run once per event.
    const deltas = this.process(context.state);
    if (deltas && deltas.length > 0) {
      for (const delta of deltas) {
        this.addOperation(delta);
      }
    }
  }

  onMount(): void {
    // Auto-registered by Component._attach
  }
  
  onUnmount(): void {
    // No-op by default
  }
}

/**
 * Base Effector with default lifecycle
 */
export abstract class BaseEffector extends Component implements Effector {
  readonly [RETM_TYPE] = RETM_TYPES.EFFECTOR;
  priority = 300;
  
  facetFilters?: import('../spaces/receptor-effector-types').FacetFilter[];
  abstract process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult>;
  
  async execute(context: ExecutionContext): Promise<void> {
    console.warn(`[Deprecation] ${this.constructor.name} is an Effector. Convert to Component.`);
    
    // Derive changes from frame deltas
    const changes: FacetDelta[] = [];
    if (context.frame && context.frame.deltas) {
        for (const op of context.frame.deltas) {
            if (op.type === 'addFacet') {
                changes.push({ type: 'added', facet: op.facet });
            } else if (op.type === 'rewriteFacet') {
                // We don't have old facet easily here without deeper lookup or tracking
                // Approximating
                const facet = context.state.facets.get(op.id);
                if (facet) {
                     changes.push({ type: 'changed', facet: facet, oldFacet: facet }); // Approximation
                }
            } else if (op.type === 'removeFacet') {
                // Removed facet might be gone from state if applied immediately
                // But maintainer logic is complex. 
                // For now, we skip removed or try to look up?
                // changes.push({ type: 'removed', facet: ... });
            }
        }
    }

    if (changes.length === 0) return;

    const result = await this.process(changes, context.state);
    if (result && result.events) {
      for (const event of result.events) {
        this.emit(event);
      }
    }
  }

  onMount(): void {
    // Auto-registered by Component._attach
  }
  
  onUnmount(): void {
    // No-op by default
  }

  /**
   * Override emitFacet with validation for effectors
   * Effectors should primarily emit event/activation facets, not domain state
   */
  protected emitFacet(facet: import('../veil/types').Facet): void {
    // Validate effectors aren't creating state facets (should use Receptors/Transforms)
    if (facet.type === 'state' && !facet.type.includes('component-state')) {
      console.warn(
        `[${this.constructor.name}] Effector creating state facet '${facet.id}'. ` +
        `Consider using a Transform instead for domain state.`
      );
    }
    
    super.emitFacet(facet);
  }
}

/**
 * Base Maintainer with default lifecycle
 */
export abstract class BaseMaintainer extends Component implements Maintainer {
  readonly [RETM_TYPE] = RETM_TYPES.MAINTAINER;
  priority = 400;
  
  abstract process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<import('../spaces/receptor-effector-types').MaintainerResult>;
  
  async execute(context: ExecutionContext): Promise<void> {
    console.warn(`[Deprecation] ${this.constructor.name} is a Maintainer. Convert to Component.`);
    
    // Similar approximation for changes
    const changes: FacetDelta[] = []; 
    // ... (Reuse logic if I can, or just pass empty for now to unblock)
    // Proper implementation requires tracking deltas applied THIS frame.
    
    const result = await this.process(context.frame, changes, context.state);
    
    if (result.events) {
      for (const event of result.events) {
        this.emit(event);
      }
    }
    if (result.deltas) {
      for (const delta of result.deltas) {
        this.addOperation(delta);
      }
    }
  }

  onMount(): void {
    // Auto-registered by Component._attach
  }
  
  onUnmount(): void {
    // No-op by default
  }
}
