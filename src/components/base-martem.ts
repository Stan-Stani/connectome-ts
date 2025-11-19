/**
 * Base implementations for MARTEM components
 * Provides default no-op implementations of Component lifecycle methods
 */

import { Component } from '../spaces/component';
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
  
  abstract process(events: SpaceEvent[]): SpaceEvent[];
  
  reset?(): void;

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
  
  abstract topics: string[];
  abstract transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[];
  
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
  
  priority?: number;
  facetFilters?: import('../spaces/receptor-effector-types').FacetFilter[];
  abstract process(state: ReadonlyVEILState): VEILDelta[];
  
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
  
  facetFilters?: import('../spaces/receptor-effector-types').FacetFilter[];
  abstract process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult>;
  
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
  
  abstract process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<import('../spaces/receptor-effector-types').MaintainerResult>;
  
  onMount(): void {
    // Auto-registered by Component._attach
  }
  
  onUnmount(): void {
    // No-op by default
  }
}
