import { BaseMaintainer } from '../components/base-martem';
import { SpaceEvent, MaintainerResult } from './receptor-effector-types';
import { Frame, ReadonlyVEILState } from '../veil/types';
import { ComponentRegistry } from '../persistence/component-registry';
import { Space } from './space';
import { join, dirname } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';

/**
 * ComponentManager: Handles dynamic component creation and lifecycle
 * Replaces ElementTreeMaintainer for the flattened architecture
 */
export class ComponentManager extends BaseMaintainer {
  
  async process(frame: Frame, changes: import('../spaces/receptor-effector-types').FacetDelta[], state: ReadonlyVEILState): Promise<MaintainerResult> {
    const events: SpaceEvent[] = [];
    
    if (frame.events) {
      for (const event of frame.events) {
        if (event.topic === 'component:add') {
          await this.handleComponentAdd(event);
        } else if (event.topic === 'component:remove') {
          this.handleComponentRemove(event);
        }
      }
    }
    
    return { events };
  }
  
  private async handleComponentAdd(event: SpaceEvent): Promise<void> {
    const payload = event.payload as any;
    const componentType = payload.componentType || payload.type;
    const config = payload.config;
    
    // Generate ID: prefer componentId, fallback to elementId:Type (legacy shim), fallback to auto-generated
    let componentId = payload.componentId;
    if (!componentId && payload.elementId) {
      // Legacy shim: if elementId is provided (e.g. 'discord'), use it as prefix or ID
      // For singletons like 'discord', we might want just 'discord' or 'discord:Afferent'
      // Let's try to be smart: if elementId looks like a specific instance ID, use it
      if (payload.elementId !== 'root') {
         componentId = `${payload.elementId}:${componentType}`;
      }
    }

    if (!componentType) return;
    
    console.log(`[ComponentManager] Processing component:add for ${componentType}`);
    
    // AXON loading logic
    const axonMetadata = config?._axonMetadata;
    if (axonMetadata?.moduleUrl && !ComponentRegistry.has(componentType)) {
       await this.loadAndRegisterAxonComponent(componentType, axonMetadata);
    }

    // Check registry again after potential loading
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
      return;
    }
    
    try {
      // Use ComponentRegistry.create to handle potential factory logic if any, or just new Class()
      const component = ComponentRegistry.create(componentType) || new (ComponentClass as any)();
      
      // Apply config
      if (config) {
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
      
      // Emit component:mounted event
      this.space.emit({
        topic: 'component:mounted',
        source: this.space.getRef(),
        payload: {
          componentId: component.id,
          componentType,
          config
        },
        timestamp: Date.now()
      });

    } catch (error) {
      console.error(`[ComponentManager] Failed to create component ${componentType}:`, error);
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

