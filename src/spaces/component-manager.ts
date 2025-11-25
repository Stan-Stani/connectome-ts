import { Component } from './component';
import { ExecutionContext } from './types';
import { SpaceEvent, FacetDelta } from './receptor-effector-types';
import { ReadonlyVEILState, ReadonlyFrame } from '../veil/types';
import { ComponentRegistry } from '../persistence/component-registry';
import { Space } from './space';
import { join, dirname } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { ComponentStateFacet } from '../veil/facet-types';

/**
 * ComponentManager: Instantiates components from component-state facets
 *
 * FLEX Component (priority 400 - Maintainer level)
 *
 * VEIL-first component instantiation:
 * 1. ComponentStateReceptor (priority 100) creates component-state facets
 * 2. ComponentManager (priority 400) reads facets and instantiates components
 * 3. Components are added to Space and initialized
 *
 * This maintains VEIL as the single source of truth for component lifecycle.
 * Both fresh starts and restoration work the same way: read facets, create components.
 */
export class ComponentManager extends Component {
  // FLEX priority: Maintainer level (400)
  priority = 400;

  // Track which component-state facets we've already instantiated
  private instantiatedComponents = new Set<string>();

  execute(context: ExecutionContext): void {
    const { frame, state } = context;
    if (!frame) return;

    // Process asynchronously (fire and forget)
    this.processComponents(frame, state).catch(err => {
      console.error('[ComponentManager] Error processing components:', err);
    });
  }

  private async processComponents(frame: ReadonlyFrame, state: ReadonlyVEILState): Promise<void> {
    const events: SpaceEvent[] = [];

    // Find all component-state facets that need instantiation
    for (const [facetId, facet] of state.facets) {
      if (facet.type === 'component-state' && !this.instantiatedComponents.has(facetId)) {
        await this.instantiateComponent(facet as ComponentStateFacet, events);
      }
    }

    // Handle component removal events
    if (frame.events) {
      for (const event of frame.events) {
        if (event.topic === 'component:remove') {
          this.handleComponentRemove(event);
        }
      }
    }

    // Emit collected events directly via space (async processing)
    for (const event of events) {
      this.space.emit(event);
    }
  }

  /**
   * Instantiate a component from its component-state facet
   */
  private async instantiateComponent(facet: ComponentStateFacet, events: SpaceEvent[]): Promise<void> {
    const { componentId, componentType, state: config } = facet;
    const facetId = `component-state:${componentId}`;

    console.log(`[ComponentManager] Instantiating component ${componentType} (${componentId}) from facet`);

    // Check if component already exists in Space (idempotency)
    const existing = this.space.getComponentById(componentId);
    if (existing) {
      console.log(`[ComponentManager] Component already exists in Space: ${componentId}`);
      this.instantiatedComponents.add(facetId);
      return;
    }

    // AXON loading logic
    const axonMetadata = (config as any)?._axonMetadata;
    if (axonMetadata?.moduleUrl && !ComponentRegistry.has(componentType)) {
      try {
        await this.loadAndRegisterAxonComponent(componentType, axonMetadata);
      } catch (error) {
        console.error(`[ComponentManager] Failed to load AXON component ${componentType}:`, error);
        return;
      }
    }

    // Get component class from registry
    let ComponentClass = ComponentRegistry.getConstructor(componentType);

    if (!ComponentClass) {
      // Try to create from registry (it might have create method)
      try {
        const instance = ComponentRegistry.create(componentType);
        if (instance) {
          ComponentClass = instance.constructor as any;
        }
      } catch (e) {}
    }

    if (!ComponentClass && !ComponentRegistry.create(componentType)) {
      console.error(`[ComponentManager] Unknown component type: ${componentType}`);
      this.instantiatedComponents.add(facetId); // Mark as processed to avoid retries
      return;
    }

    try {
      // Create component instance
      const component = ComponentRegistry.create(componentType) || new (ComponentClass as any)();

      // Apply config from facet state
      if (config && typeof config === 'object') {
        Object.assign(component, config);

        // Handle AXON afferents with setConnectionParams
        if (axonMetadata && 'setConnectionParams' in component && typeof (component as any).setConnectionParams === 'function') {
          // Async init - catch errors
          (component as any).setConnectionParams(config).catch((err: any) => {
            console.error(`[ComponentManager] Error configuring ${componentType}:`, err);
          });
        }
      }

      // Add to space
      this.space.addComponent(component, componentId);

      // Mark as instantiated
      this.instantiatedComponents.add(facetId);

      // Emit component:mounted event
      events.push({
        topic: 'component:mounted',
        source: this.space.getRef(),
        payload: {
          componentId: component.id,
          componentType,
          config
        },
        timestamp: Date.now()
      });

      console.log(`[ComponentManager] Component instantiated: ${componentType} (${componentId})`);

    } catch (error) {
      console.error(`[ComponentManager] Failed to instantiate component ${componentType}:`, error);
      this.instantiatedComponents.add(facetId); // Mark as processed to avoid infinite retries
    }
  }
  
  private handleComponentRemove(event: SpaceEvent): void {
     const payload = event.payload as any;
     const { componentId } = payload;
     
     if (componentId) {
       const component = this.space.getComponentById(componentId);
       if (component) {
         this.space.removeComponent(component);
         console.log(`[ComponentManager] Removed component ${componentId}`);
       } else {
         console.warn(`[ComponentManager] Component to remove not found: ${componentId}`);
       }
     }
  }

  /**
   * Load and register an AXON component from a module URL
   */
  private async loadAndRegisterAxonComponent(componentType: string, axonMetadata: any): Promise<void> {
    const { moduleUrl } = axonMetadata;
    
    try {
      // Fetch module code
      const response = await fetch(moduleUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const moduleCode = await response.text();
      
      // Create module environment similar to AxonLoader
      const { createAxonEnvironmentV2 } = require('../axon/environment-v2');
      const env = createAxonEnvironmentV2();
      
      // Write module to temp file for proper Node.js module loading
      const Module = require('module');
      
      const tempFile = join(tmpdir(), `connectome-axon-${componentType}-${Date.now()}.js`);
      writeFileSync(tempFile, moduleCode);
      
      // Clear module cache to force reload
      delete require.cache[tempFile];
      
      // Create a module with proper paths for resolution
      const axonModule = new Module(tempFile);
      axonModule.filename = tempFile;
      axonModule.paths = Module._nodeModulePaths(dirname(tempFile));
      
      // Add connectome-ts parent directory to module paths
      const connectomeParentPath = join(__dirname, '../../..');
      axonModule.paths.unshift(connectomeParentPath);
      
      // Load module
      axonModule._compile(moduleCode, tempFile);
      const module: { exports: any } = { exports: axonModule.exports };
      
      // Clean up temp file after a delay
      setTimeout(() => {
        try {
          delete require.cache[tempFile];
          unlinkSync(tempFile);
        } catch (e) {}
      }, 1000);
      
      // Get module exports
      const moduleExports = module.exports as any;
      
      // Handle AXON V2 format
      let ComponentClass;
      let moduleExportsObject;
      
      if (typeof moduleExports.createModule === 'function') {
        moduleExportsObject = moduleExports.createModule(env);
        
        if (typeof moduleExportsObject === 'function') {
          ComponentClass = moduleExportsObject;
        } else if (moduleExportsObject.component) {
          ComponentClass = moduleExportsObject.component;
        } else if (moduleExportsObject.afferents && typeof moduleExportsObject.afferents === 'object') {
          ComponentClass = moduleExportsObject.afferents[componentType] || Object.values(moduleExportsObject.afferents)[0];
        }
      } else {
        ComponentClass = moduleExports.default || moduleExports.component || moduleExports;
      }
      
      if (typeof ComponentClass === 'function') {
        // Register with ComponentRegistry
        ComponentRegistry.register(componentType, ComponentClass);
        
        // Also register receptors if module exports them
        if (moduleExportsObject && moduleExportsObject.receptors) {
          for (const [receptorName, ReceptorClass] of Object.entries(moduleExportsObject.receptors)) {
            if (typeof ReceptorClass === 'function') {
              const receptor = new (ReceptorClass as any)();
              // Auto-register with Space (handled by Component._attach if we added it to space, but here we manually add)
              // Since receptor is not added via addComponent here (it's a side effect of module loading),
              // we should add it to the space.
              // Ideally, we should treat these as components too.
              this.space.addComponent(receptor, `receptor:${receptorName}`);
            }
          }
        }
      } else {
        throw new Error(`Module did not export a valid component class (got ${typeof ComponentClass})`);
      }
    } catch (error) {
      console.error(`[ComponentManager] Failed to load AXON component ${componentType}:`, error);
      throw error;
    }
  }
}

