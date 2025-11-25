import { Component } from './component';
import { ExecutionContext } from './types';
import { createComponentStateFacet } from '../helpers/factories';

/**
 * ComponentStateReceptor: Converts component:add events into component-state facets
 *
 * Priority: 100 (Receptor phase)
 *
 * This is the VEIL-first entry point for component registration:
 * 1. Receives component:add events (from AxonLoader, Host, etc.)
 * 2. Creates component-state facets via applyOperation()
 * 3. ComponentManager (priority 400) later instantiates components from these facets
 *
 * FLEX Architecture: Facets created here are visible to all later components
 * in the same frame (priorities 101+), enabling same-frame component instantiation.
 */
export class ComponentStateReceptor extends Component {
  priority = 100;

  execute(context: ExecutionContext): void {
    const { event } = context;

    // Only process component:add events
    if (event.topic !== 'component:add') return;

    const payload = event.payload as any;
    const componentType = payload.componentType || payload.type;
    const config = payload.config || {};
    const componentClass = payload.componentClass || this.inferComponentClass(componentType);

    if (!componentType) {
      console.warn('[ComponentStateReceptor] component:add event missing componentType', payload);
      return;
    }

    // Generate component ID
    let componentId = payload.componentId;
    const parentId = payload.parentId || payload.elementId; // Support both names
    if (!componentId && parentId) {
      // Use parent ID as prefix for component ID
      if (parentId !== 'root') {
        componentId = `${parentId}:${componentType}`;
      }
    }
    if (!componentId) {
      // Auto-generate ID
      componentId = `${componentType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Check if component-state facet already exists (idempotency)
    const facetId = `component-state:${componentId}`;
    if (context.state.facets.has(facetId)) {
      console.log(`[ComponentStateReceptor] Component-state facet already exists: ${facetId}`);
      return;
    }

    console.log(`[ComponentStateReceptor] Creating component-state facet for ${componentType} (${componentId})`);

    // Create component-state facet
    const facet = createComponentStateFacet({
      componentId,
      componentType,
      componentClass,
      elementId: parentId || 'root', // Still called elementId in facet for backwards compat
      initialState: config
    });

    // Add facet to VEIL state via Space
    if ('applyOperation' in this.space) {
      (this.space as any).applyOperation({
        type: 'addFacet',
        facet
      });
    } else {
      console.error('[ComponentStateReceptor] Space does not support applyOperation - cannot create facet');
    }
  }

  /**
   * Infer component class from component type name
   * This is a heuristic fallback when componentClass isn't specified
   */
  private inferComponentClass(componentType: string): 'modulator' | 'afferent' | 'receptor' | 'transform' | 'effector' | 'maintainer' {
    const lower = componentType.toLowerCase();

    if (lower.includes('modulator')) return 'modulator';
    if (lower.includes('afferent')) return 'afferent';
    if (lower.includes('receptor')) return 'receptor';
    if (lower.includes('transform')) return 'transform';
    if (lower.includes('effector')) return 'effector';
    if (lower.includes('maintainer')) return 'maintainer';

    // Default to effector for unknown types
    return 'effector';
  }
}
