import { Receptor, Effector, Transform, FacetDelta, EffectorResult, ReadonlyVEILState, Maintainer } from './receptor-effector-types';
import { BaseReceptor, BaseTransform, BaseMaintainer } from '../components/base-martem';
import { SpaceEvent, ElementRef } from './types';
import { Facet, VEILDelta, ElementTreeFacet, ElementRequestFacet, Frame } from '../veil/types';
import { Element } from './element';
import { Component } from './component';
import { createEventFacet, createInternalStateFacet, rewriteFacet, wrapFacetsAsDeltas } from '../helpers/factories';
import { ComponentRegistry } from '../persistence/component-registry';

/**
 * Decorator for auto-registering components
 */
export function registerComponent(typeName: string) {
  return function<T extends { new(...args: any[]): Component }>(constructor: T) {
    ComponentRegistry.register(typeName, constructor);
    return constructor;
  };
}

/**
 * Receptor: Handles element creation requests
 * This allows declarative element creation via events
 */
export class ElementRequestReceptor extends BaseReceptor {
  topics = ['element:create', 'element:destroy', 'component:add', 'component:remove'];
  
  // Track element-tree facets being created/updated in this receptor call
  // Note: This persists across multiple transform() calls within the same Phase 1
  private elementTreeCache = new Map<string, any>();
  private lastFrameSequence = -1;
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    // Clear cache on new frame
    if (state.currentSequence !== this.lastFrameSequence) {
      this.elementTreeCache.clear();
      this.lastFrameSequence = state.currentSequence;
    }
    
    console.log(`[ElementRequestReceptor] Processing ${event.topic} event`);
    const facets: Facet[] = [];
    const deltas: VEILDelta[] = [];
    
    switch (event.topic) {
      case 'element:create': {
        const payload = event.payload as { 
          parentId?: string;
          elementType?: string;
          name: string;
          components?: Array<{ type: string; config?: any }>;
          continuations?: any[];
          continuationTag?: string;
        };
        
        // Create a request facet that the maintainer will process
        facets.push({
          id: `element-request-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          type: 'element-request',
          state: {
            parentId: payload.parentId || 'root',
            elementType: payload.elementType || 'Element',
            name: payload.name,
            components: payload.components,
            continuations: payload.continuations,  // Pass through continuations!
            continuationTag: payload.continuationTag
          },
          ephemeral: true // Request is processed once
        });
        break;
      }
      
      case 'element:destroy': {
        const payload = event.payload as { elementId: string };
        // Mark element tree facet as inactive
        facets.push(createEventFacet({
          content: `Request to destroy element '${payload.elementId}'`,
          source: 'element-tree',
          eventType: 'element-destroy-request',
          metadata: { elementId: payload.elementId },
          streamId: 'system'
        }));
        break;
      }
      
      case 'component:add': {
        const payload = event.payload as { 
          elementId: string;
          componentType: string;
          componentClass?: string;
          config?: any;
        };
        
        const { elementId, componentType, config } = payload;
        const treeFacetId = `element-tree-${elementId}`;
        
        // Check cache first, then state
        let treeFacet = this.elementTreeCache.get(treeFacetId);
        if (!treeFacet) {
          treeFacet = state.facets.get(treeFacetId);
        }
        
        if (treeFacet?.state || treeFacet?.components !== undefined) {
          // Element-tree facet exists (in state or cache), update it
          const existingComponents = treeFacet.state?.components || treeFacet.components || [];
          
          // Check if component already exists (idempotency)
          const alreadyExists = existingComponents.some((c: any) => 
            c.type === componentType && 
            JSON.stringify(c.config) === JSON.stringify(config)
          );
          
          if (!alreadyExists) {
            // Add component to the list
            const components = [...existingComponents, {
              type: componentType,
              index: existingComponents.length,
              config
            }];
            
            // Update cache
            this.elementTreeCache.set(treeFacetId, {
              ...(treeFacet.state || treeFacet),
              components
            });
            
            // Directly emit rewriteFacet delta to update element-tree
            deltas.push({
              type: 'rewriteFacet',
              id: treeFacetId,
              changes: { state: { components } }
            });
          }
        } else {
          // Create new element-tree facet
          const newTreeFacet = {
            elementId,
            elementType: 'Space',  // Assume Space for root
            parentId: elementId === 'root' ? null : 'root',
            name: elementId,
            active: true,
            components: [{
              type: componentType,
              index: 0,
              config
            }]
          };
          
          // Cache it
          this.elementTreeCache.set(treeFacetId, newTreeFacet);
          
          // Create the facet via delta
          deltas.push({
            type: 'addFacet',
            facet: {
              id: treeFacetId,
              type: 'element-tree',
              state: newTreeFacet
            }
          });
        }
        
        // Also create an event facet for history
        facets.push(createEventFacet({
          content: `Add component '${componentType}' to element '${elementId}'`,
          source: 'element-tree',
          eventType: 'component-add',
          metadata: payload,
          streamId: 'system'
        }));
        break;
      }
    }
    
    // Return both the event facets (for history) and the element-tree deltas
    return [...wrapFacetsAsDeltas(facets), ...deltas];
  }
}

/**
 * Transform: Handles element lifecycle state updates
 * Currently only marks elements as inactive on unmount
 */
export class ElementTreeTransform extends BaseTransform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    // Mark element-tree facets as inactive when elements unmount
    for (const [id, facet] of state.facets) {
      if (facet.type === 'event' && facet.state?.eventType === 'element-unmount') {
        const elementId = facet.state.metadata?.elementId;
        if (elementId) {
          const treeFacetId = `element-tree-${elementId}`;
          const treeFacet = state.facets.get(treeFacetId);
          if (treeFacet?.state?.active) {
            deltas.push(rewriteFacet(treeFacetId, {
              state: { active: false }
            }));
          }
        }
      }
    }
    
    return deltas;
  }
}

/**
 * Maintainer: Manages element tree operations in Phase 4
 * Handles creation, destruction, and component management
 */
export class ElementTreeMaintainer extends BaseMaintainer {
  private elementCache = new Map<string, Element>();
  
  // Track operations for this frame
  private pendingOperations: Array<{
    type: 'create' | 'destroy' | 'restore' | 'add-component';
    facet?: Facet;
    elementId?: string;
    request?: any;
  }> = [];
  
  constructor(private space: Element) {
    super();
    // Register the space itself
    this.elementCache.set('root', space);
    this.elementCache.set(space.id, space);
  }
  
  async process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<import('./receptor-effector-types').MaintainerResult> {
    const events: SpaceEvent[] = [];
    const deltas: import('../veil/types').VEILDelta[] = [];
    
    // Collect all element operations from this frame
    this.collectOperations(state);
    
    // Process deletions first (bottom-up)
    this.processDeletions(events);
    
    // Process creations and restorations (top-down)
    this.processCreations(events, deltas);
    
    // Process component additions
    this.processComponentAdditions(state, events, deltas);
    
    // Clear pending operations
    this.pendingOperations = [];
    
    return { events, deltas };
  }
  
  private collectOperations(state: ReadonlyVEILState) {
    // Clear previous operations
    this.pendingOperations = [];
    
    // Look for element-request facets from this frame
    for (const [id, facet] of state.facets) {
      if (facet.type === 'element-request') {
        this.pendingOperations.push({
          type: 'create',
          facet
        });
      }
      
      // Look for destroy requests
      if (facet.type === 'event' && facet.state?.eventType === 'element-destroy-request') {
        this.pendingOperations.push({
          type: 'destroy',
          elementId: facet.state.metadata?.elementId
        });
      }
      
      // Look for component add requests
      if (facet.type === 'event' && facet.state?.eventType === 'component-add') {
        this.pendingOperations.push({
          type: 'add-component',
          facet
        });
      }
    }
    
    // Look for element-tree facets that need syncing (restoration)
    for (const [id, facet] of state.facets) {
      if (facet.type === 'element-tree') {
        const elementState = facet.state as any;
        if (!this.elementCache.has(elementState.elementId) && elementState.active) {
          this.pendingOperations.push({
            type: 'restore',
            facet
          });
        }
      }
    }
  }
  
  private processDeletions(events: SpaceEvent[]) {
    // Get all deletion operations
    const deletions = this.pendingOperations.filter(op => op.type === 'destroy');
    
    // Sort to process children before parents
    const sorted = this.sortDeletionsByHierarchy(deletions);
    
    for (const deletion of sorted) {
      this.deleteElement(deletion.elementId!, events);
    }
  }
  
  private processCreations(events: SpaceEvent[], deltas: import('../veil/types').VEILDelta[]) {
    // Process restorations first (they have existing IDs)
    const restorations = this.pendingOperations.filter(op => op.type === 'restore');
    
    // Sort by parent-child relationship
    const sorted = this.sortByHierarchy(restorations);
    
    for (const restoration of sorted) {
      this.restoreElement(restoration.facet!, events);
    }
    
    // Then process new creations
    const creations = this.pendingOperations.filter(op => op.type === 'create');
    
    for (const creation of creations) {
      this.createElement(creation.facet!, events, deltas);
    }
  }
  
  private processComponentAdditions(state: ReadonlyVEILState, events: SpaceEvent[], deltas: import('../veil/types').VEILDelta[]) {
    const additions = this.pendingOperations.filter(op => op.type === 'add-component');
    
    for (const addition of additions) {
      this.addComponent(addition.facet!, state, events, deltas);
    }
  }
  
  private createElement(facet: Facet, events: SpaceEvent[], deltas: import('../veil/types').VEILDelta[]): void {
    const { parentId, elementType, name, components, continuationTag, continuations } = facet.state as any;
    
    // Find parent
    const parent = this.elementCache.get(parentId || 'root');
            if (!parent) {
              console.error(`Parent element ${parentId} not found`);
      
      // Emit failure continuation if tag exists
      if (continuationTag) {
        events.push({
          topic: 'veil:operation',
          source: this.space.getRef(),
          timestamp: Date.now(),
          payload: {
            operation: {
              type: 'addFacet',
              facet: {
                id: `continuation-complete-${Date.now()}`,
                type: 'continuation:complete',
                state: {
                  continuationTag,
                  success: false,
                  error: `Parent element ${parentId} not found`
                },
                ephemeral: true
              }
            }
          }
        });
      }
      return;
    }
    
    // Create element
    const elementId = `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const element = new Element(name, elementId);
    this.elementCache.set(elementId, element);
    
    // Mount element - this will emit element:mount event (queued for next frame)
            parent.addChild(element);
    
    // Create persistent element-tree facet
    events.push({
      topic: 'veil:operation',
      source: element.getRef(),
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'addFacet',
          facet: {
            id: `element-tree-${elementId}`,
            type: 'element-tree',
            state: {
              elementId,
              elementType,
              parentId: parent.id,
              name,
              active: true,
              components: []
            }
          }
        }
      }
    });
    
    // Remove the processed element-request facet
    events.push({
      topic: 'veil:operation',
      source: element.getRef(),
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'removeFacet',
          id: facet.id
        }
      }
    });
    
    // Emit success continuation if tag exists
    if (continuationTag || continuations) {
      events.push({
        topic: 'veil:operation',
        source: element.getRef(),
        timestamp: Date.now(),
        payload: {
          operation: {
            type: 'addFacet',
            facet: {
              id: `continuation-complete-${Date.now()}`,
              type: 'continuation:complete',
              state: {
                continuationTag: continuationTag || `element-create-${elementId}`,
                success: true,
                result: {
                  elementId,
                  elementType,
                  name
                },
                continuations: continuations
              },
              ephemeral: true
            }
          }
        }
      });
    }
    
    // Add components if specified
    if (components) {
      const componentStates: any[] = [];
      for (const compDef of components) {
        const component = ComponentRegistry.create(compDef.type, compDef.config);
        if (component) {
          // Create component-state BEFORE adding component (so onMount() can read it)
          const componentIndex = element.components.length;
          const componentId = `${elementId}:${compDef.type}:${componentIndex}`;
          
          const stateDelta = {
            type: 'addFacet' as const,
            facet: {
              id: `component-state:${componentId}`,
              type: 'component-state',
              componentType: compDef.type,
              componentClass: (compDef as any).componentClass || 'effector',
              componentId,
              elementId,
              state: compDef.config || {}
            }
          };
          
          // Apply immediately using Space's VEIL state
          const space = this.space as any;
          if (space.getVEILState) {
            space.getVEILState().applyDeltasDirect([stateDelta]);
          }
          
          // Also add to deltas array for tracking
          deltas.push(stateDelta);
          
          // Now add component (onMount() can read component-state)
            element.addComponent(component);
          
          // Register if it's a RETM component
          const componentClass = (compDef as any).componentClass;
          if (componentClass === 'effector' && space.addEffector) {
            space.addEffector(component);
          } else if (componentClass === 'receptor' && space.addReceptor) {
            space.addReceptor(component);
          } else if (componentClass === 'transform' && space.addTransform) {
            space.addTransform(component);
          }
          
          componentStates.push({
            type: compDef.type,
            index: componentIndex,
            config: compDef.config
          });
        }
      }
      
      // Update element-tree facet with all components at once
      if (componentStates.length > 0) {
        events.push({
          topic: 'veil:operation',
          source: element.getRef(),
          timestamp: Date.now(),
          payload: {
            operation: {
              type: 'rewriteFacet',
              id: `element-tree-${elementId}`,
              changes: {
                state: { components: componentStates }
              }
            }
          }
        });
      }
    }
  }
  
  private restoreElement(facet: Facet, events: SpaceEvent[]): void {
    const { elementId, elementType, parentId, name, components } = facet.state as any;
    
    // Skip if element already exists
    if (this.elementCache.has(elementId)) {
      return;
    }
    
    // Find parent
    const parent = parentId ? this.elementCache.get(parentId) : null;
    if (!parent) {
      console.error(`Parent element ${parentId} not found for ${elementId}`);
      return;
    }
    
    // Create element with existing ID
    const element = new Element(name, elementId);
    this.elementCache.set(elementId, element);
    
    // Mount element - events will be queued for next frame
    parent.addChild(element);
    
    // Add components
    for (const compDef of components || []) {
      const component = ComponentRegistry.create(compDef.type, compDef.config);
      if (component) {
        element.addComponent(component);
      }
    }
  }
  
  private deleteElement(elementId: string, events: SpaceEvent[]): void {
    const element = this.elementCache.get(elementId);
    if (!element) return;
    
    // Recursively delete children first
    for (const child of [...element.children]) {
      this.deleteElement(child.id, events);
    }
    
    // Remove from parent - events will be queued for next frame
    element.parent?.removeChild(element);
    
    // Remove from cache
    this.elementCache.delete(elementId);
    
    // Mark element-tree facet as inactive
    events.push({
      topic: 'veil:operation',
      source: this.space.getRef(),
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'rewriteFacet',
          id: `element-tree-${elementId}`,
          changes: {
            state: { active: false }
          }
        }
      }
    });
  }
  
  private addComponent(facet: Facet, state: ReadonlyVEILState, events: SpaceEvent[], deltas: import('../veil/types').VEILDelta[]): void {
    const { elementId, componentType, config, componentClass } = facet.state?.metadata || {};
    
    if (!elementId || !componentType) return;
    
    const element = this.elementCache.get(elementId);
    if (!element) {
      console.warn(`[ElementTreeMaintainer] Element ${elementId} not found for component ${componentType}`);
      return;
    }
    
    // Check if component already exists on element (idempotency)
    const alreadyExists = element.components.some((c: any) => 
      c.constructor.name === componentType
    );
    
    if (alreadyExists) {
      console.log(`[ElementTreeMaintainer] Component ${componentType} already exists on element ${elementId}, skipping`);
      return;
    }
    
    const component = ComponentRegistry.create(componentType);
    if (!component) {
      console.warn(`[ElementTreeMaintainer] Failed to create component ${componentType}`);
      return;
    }
    
    // Apply config properties to component
    if (config) {
      Object.assign(component, config);
    }
    
    console.log(`[ElementTreeMaintainer] Creating component ${componentType} for element ${elementId}`);
    
    // Generate component ID before adding (so we know the index)
    const componentIndex = element.components.length;
    const componentId = `${elementId}:${componentType}:${componentIndex}`;
    
    // Create component-state facet BEFORE mounting component
    // Use deltas (applied immediately) not events (next frame)
    // This ensures the state exists when onMount() is called
    const componentStateFacet = {
      id: `component-state:${componentId}`,
      type: 'component-state',
      componentType,
      componentClass: componentClass || 'effector', // Default to effector if not specified
      componentId,
      elementId,
      state: config || {}
    };
    
    deltas.push({
      type: 'addFacet',
      facet: componentStateFacet
    });
    
    // Now add component to element
    element.addComponent(component);
    
    // Register RETM component with Space based on its class
    const space = this.space as any;
    
    switch (componentClass) {
      case 'modulator':
        if (space.addModulator) space.addModulator(component);
        break;
      case 'receptor':
        if (space.addReceptor) space.addReceptor(component);
        break;
      case 'transform':
        if (space.addTransform) space.addTransform(component);
        break;
      case 'effector':
        if (space.addEffector) space.addEffector(component);
        break;
      case 'maintainer':
        if (space.addMaintainer) space.addMaintainer(component);
        break;
      case 'afferent':
        // Afferents are attached to elements but don't register with Space
        break;
    }
  }
  
  // Helper methods for sorting
  private sortDeletionsByHierarchy(deletions: any[]): any[] {
    // For now, just return as-is
    // TODO: Implement proper sorting based on parent-child relationships
    return deletions;
  }
  
  private sortByHierarchy(operations: any[]): any[] {
    // For now, just return as-is
    // TODO: Implement proper sorting based on parent-child relationships
    return operations;
  }
  
  private isAncestor(possibleAncestor: Element, element: Element): boolean {
    let current = element.parent;
    while (current) {
      if (current === possibleAncestor) return true;
      current = current.parent;
    }
    return false;
  }
}