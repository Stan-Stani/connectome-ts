import { Component } from '../spaces/component';
import { SpaceEvent } from '../spaces/types';
import { createAxonEnvironment } from '../axon/environment';
import { createAxonEnvironmentV2 } from '../axon/environment-v2';
import { IAxonManifest, IAxonComponentConstructor } from '../axon/interfaces';
import { IAxonManifestV2 } from '../axon/interfaces-v2';
import { persistable, persistent } from '../persistence/decorators';
import { Space } from '../spaces/space';
import { 
  Receptor, 
  Effector, 
  Transform, 
  Maintainer 
} from '../spaces/receptor-effector-types';

// Use the extended interface for RETM support
type AxonManifest = IAxonManifestV2;

interface ModuleVersions {
  [module: string]: string;
}

interface ParsedAxonUrl {
  protocol: string;
  host: string;
  path: string;
  params: Record<string, string>;
}

/**
 * AxonLoaderComponent - Loads components from external AXON URLs
 * 
 * This component enables elements to connect to external services by loading
 * component modules dynamically that generate VEIL and handle events.
 * 
 * Usage:
 * ```typescript
 * const element = new Element('my-service');
 * const loader = new AxonLoaderComponent();
 * element.addComponent(loader);
 * await loader.connect('axon://localhost:8080/modules/my-service/manifest');
 * space.addChild(element);
 * ```
 */
@persistable(1)
export class AxonLoaderComponent extends Component {
  private loadedComponent?: Component;
  private manifest?: AxonManifest;
  
  @persistent()
  private manifestUrl?: string;
  
  @persistent()
  private moduleUrl?: string;
  
  private moduleVersions: ModuleVersions = {};
  private hotReloadWs?: WebSocket;
  
  @persistent()
  private parsedUrl?: ParsedAxonUrl;
  
  private loadedDependencies: Map<string, any> = new Map();
  
  @persistent()
  private axonUrl?: string;
  
  @persistent()
  private loadedComponentState?: any;
  
  @persistent()
  private moduleType: 'component' | 'retm' | 'mixed' = 'component';
  
  @persistent()
  private loadedExports: string[] = [];
  
  /**
   * Called when component is first created
   */
  onInit(): void {
    // Basic initialization if needed
  }
  
  /**
   * Called when component is being restored from persistence
   */
  onRestore(): void {
    // Just log that we're being restored, don't connect yet
    if (this.axonUrl) {
      console.log(`[AxonLoader] Restored with URL ${this.axonUrl}, will connect when ready`);
    }
  }
  
  /**
   * Called when component is mounted
   * FRESH START: Load module and emit component:add events for maintainer to process
   * RESTORATION: Do nothing (component already in element-tree facet, maintainer creates it)
   */
  async onMount(): Promise<void> {
    if (this.axonUrl && this.loadedExports.length === 0) {
      // Fresh start - load module and register/emit for maintainer
      console.log(`[AxonLoader] Loading module from ${this.axonUrl}`);
      try {
        await this.connect(this.axonUrl);
        console.log(`[AxonLoader] Module loaded, components will be created by maintainer`);
      } catch (error) {
        console.error(`[AxonLoader] Failed to load module:`, error);
      }
    } else if (this.loadedExports.length > 0) {
      // Restoration - components already restored by maintainer
      console.log(`[AxonLoader] Restored, exports: ${this.loadedExports.join(', ')}`);
    }
  }
  
  
  /**
   * Restore the state of the loaded component
   */
  private async restoreLoadedComponentState(): Promise<void> {
    if (!this.loadedComponentState || !this.loadedComponent) return;
    
    const { deserializeValue } = require('../persistence/serialization');
    
    // Check for AXON-style persistence first
    const componentClass = this.loadedComponent.constructor as any;
    if (componentClass.persistentProperties) {
      console.log(`[AxonLoader] Using AXON-style restoration for ${componentClass.name}`);
      // Restore each property from the static array
      for (const propDef of componentClass.persistentProperties) {
        const value = this.loadedComponentState.properties?.[propDef.propertyKey];
        if (value !== undefined) {
          (this.loadedComponent as any)[propDef.propertyKey] = deserializeValue(value);
        }
      }
      console.log(`[AxonLoader] Restored ${Object.keys(this.loadedComponentState.properties || {}).length} properties`);
      return;
    }
    
    // Fall back to decorator-based restoration
    const { getPersistenceMetadata } = require('../persistence/decorators');
    const metadata = getPersistenceMetadata(this.loadedComponent);
    
    if (!metadata) {
      console.warn('[AxonLoader] Loaded component is not persistable');
      return;
    }
    
    // Restore each persistent property
    for (const [key, value] of Object.entries(this.loadedComponentState.properties || {})) {
      const propMetadata = metadata.properties.get(key);
      if (propMetadata) {
        if (propMetadata.serializer) {
          (this.loadedComponent as any)[key] = propMetadata.serializer.deserialize(value);
        } else {
          (this.loadedComponent as any)[key] = deserializeValue(value);
        }
      }
    }
    
    console.log(`[AxonLoader] Restored ${Object.keys(this.loadedComponentState.properties || {}).length} properties`);
  }
  
  /**
   * Parse AXON URL into components
   */
  static parseUrl(url: string): ParsedAxonUrl {
    const match = url.match(/^axon:\/\/([^/?]+)(\/[^?]*)?\??(.*)$/);
    if (!match) {
      throw new Error(`Invalid AXON URL: ${url}`);
    }
    
    const [, host, pathPart, queryPart] = match;
    const path = pathPart || '/';
    
    // Parse query parameters
    const params: Record<string, string> = {};
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });
    }
    
    return { protocol: 'axon', host, path, params };
  }
  
  /**
   * Connect to an AXON service
   * @param axonUrl - The AXON URL (e.g., "axon://game.server/spacegame?token=xyz")
   */
  async connect(axonUrl: string): Promise<void> {
    try {
      // Save the URL for restoration
      this.axonUrl = axonUrl;
      
      // Parse the URL
      this.parsedUrl = AxonLoaderComponent.parseUrl(axonUrl);
      
      // Build HTTP URL without parameters
      const httpUrl = `http://${this.parsedUrl.host}${this.parsedUrl.path}`;
      this.manifestUrl = httpUrl;
      
      // Fetch manifest
      console.log(`[AxonLoader] Fetching manifest from ${httpUrl}`);
      const response = await fetch(httpUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
      }
      
      this.manifest = await response.json() as IAxonManifest;
      console.log(`[AxonLoader] Loaded manifest:`, this.manifest);
      
      // Resolve module URL relative to manifest
      if (!this.manifest || !this.manifest.main) {
        throw new Error('Manifest missing required "main" field');
      }
      this.moduleUrl = new URL(this.manifest.main, httpUrl).toString();
      
      // Load the component
      await this.loadComponent();
      
      // Set up hot reload if specified
      if (this.manifest && this.manifest.hotReload) {
        this.setupHotReload(this.manifest.hotReload);
      }
    } catch (error) {
      console.error(`[AxonLoader] Failed to connect:`, error);
      throw error;
    }
  }
  
  /**
   * Load dependencies for the component
   */
  private async loadDependencies(env: any): Promise<void> {
    if (!this.manifest?.dependencies) return;
    
    console.log(`[AxonLoader] Loading ${this.manifest.dependencies.length} dependencies`);
    
    for (const dep of this.manifest.dependencies) {
      if (this.loadedDependencies.has(dep.name)) {
        console.log(`[AxonLoader] Dependency ${dep.name} already loaded`);
        continue;
      }
      
      try {
        // Resolve dependency URL relative to manifest
        const depUrl = new URL(dep.manifest, this.manifestUrl!).toString();
        console.log(`[AxonLoader] Loading dependency ${dep.name} from ${depUrl}`);
        
        // Fetch dependency manifest
        const response = await fetch(depUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch dependency manifest: ${response.status}`);
        }
        
        const depManifest = await response.json() as IAxonManifest;
        const depModuleUrl = new URL(depManifest.main, depUrl).toString();
        
        // Fetch dependency module
        const moduleResponse = await fetch(depModuleUrl);
        if (!moduleResponse.ok) {
          throw new Error(`Failed to fetch dependency module: ${moduleResponse.status}`);
        }
        
        const moduleCode = await moduleResponse.text();
        
        // Create module function
        const moduleFunc = new Function('exports', 'module', 'env', `
          ${moduleCode}
          
          // Handle different export styles
          if (typeof createModule !== 'undefined') {
            module.exports = createModule(env);
          } else if (typeof exports.createModule === 'function') {
            module.exports = exports.createModule(env);
          } else if (typeof module.exports === 'function') {
            // Module directly exports a function
            module.exports = module.exports(env);
          }
        `);
        
        const moduleExports: any = {};
        const module = { exports: moduleExports };
        
        // Execute module
        moduleFunc(moduleExports, module, env);
        
        // Store the loaded dependency
        this.loadedDependencies.set(dep.name, module.exports);
      } catch (error) {
        console.error(`[AxonLoader] Failed to load dependency ${dep.name}:`, error);
        throw error;
      }
      
      console.log(`[AxonLoader] Loaded dependency: ${dep.name}`);
    }
  }
  
  /**
   * Load or reload the component module
   */
  private async loadComponent(): Promise<void> {
    // Clean up previous instance
    if (this.loadedComponent) {
      console.log(`[AxonLoader] Unmounting previous component`);
      try {
        // Remove the component from the element
        this.element.removeComponent(this.loadedComponent);
      } catch (error) {
        console.error(`[AxonLoader] Error unmounting component:`, error);
      }
    }
    
    // Get version for cache busting
    const mainModule = this.manifest!.main;
    const version = this.moduleVersions[mainModule] || Date.now().toString();
    const url = `${this.moduleUrl}?v=${version}`;
    
    console.log(`[AxonLoader] Loading component from ${url}`);
    console.log(`[AxonLoader] moduleUrl: ${this.moduleUrl}, manifestUrl: ${this.manifestUrl}`);
    
    try {
      // Fetch the module code
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch module: ${response.status} ${response.statusText}`);
      }
      
      const moduleCode = await response.text();
      
      // Check if manifest indicates RETM support
      const exports = this.manifest?.exports;
      const hasRETMExports = exports && (
        (exports.receptors && exports.receptors.length > 0) ||
        (exports.effectors && exports.effectors.length > 0) ||
        (exports.transforms && exports.transforms.length > 0) ||
        (exports.maintainers && exports.maintainers.length > 0) ||
        ((exports as any).afferents && (exports as any).afferents.length > 0)
      );
      
      // Create appropriate environment
      const env = hasRETMExports ? createAxonEnvironmentV2() : createAxonEnvironment();
      
      // Load dependencies first
      await this.loadDependencies(env);
      
      // Add loaded dependencies to environment
      const enhancedEnv = {
        ...env,
        ...Object.fromEntries(this.loadedDependencies)
      };
      
      // Create a function that evaluates the module
      // The module should export a createModule function
      const moduleFunc = new Function('exports', 'module', 'env', `
        ${moduleCode}
        
        // Handle different export styles
        if (typeof createModule !== 'undefined') {
          module.exports = createModule(env);
        } else if (typeof exports.createModule === 'function') {
          module.exports = exports.createModule(env);
        } else if (typeof module.exports === 'function') {
          // Module directly exports a function
          module.exports = module.exports(env);
        }
      `);
      
      const moduleExports: any = {};
      const module = { exports: moduleExports };
      
      // Execute the module with the enhanced environment
      moduleFunc(moduleExports, module, enhancedEnv);
      
      // All modules go through unified RETM loading
      // Modules can export: { component?, receptors?, effectors?, transforms?, maintainers? }
      await this.loadRETMModule(module.exports);
      
      // Determine module type for metadata
      const hasComponent = module.exports.default || module.exports.component;
      this.moduleType = hasRETMExports && hasComponent ? 'mixed' : 
                        hasRETMExports ? 'retm' : 'component';
      
      // Set up hot reload if enabled
      if (this.manifest?.hotReload) {
        this.setupHotReload(this.manifest.hotReload);
      }
    } catch (error) {
      console.error(`[AxonLoader] Failed to load component:`, error);
      throw error;
    }
  }
  
  /**
   * Set up hot reload WebSocket connection
   */
  private setupHotReload(wsUrl: string): void {
    try {
      console.log(`[AxonLoader] Setting up hot reload: ${wsUrl}`);
      
      if (typeof WebSocket === 'undefined') {
        console.warn('[AxonLoader] WebSocket not available, hot reload disabled');
        return;
      }
      
      this.hotReloadWs = new WebSocket(wsUrl);
      
      this.hotReloadWs.onopen = () => {
        console.log('[AxonLoader] Hot reload connected');
      };
      
      this.hotReloadWs.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'update' && message.module) {
            console.log(`[AxonLoader] Hot reload update for module: ${message.module}`);
            
            // Update version
            this.moduleVersions[message.module] = message.version || Date.now().toString();
            
            // Reload if it's our main module
            if (message.module === this.manifest?.main) {
              await this.loadComponent();
            }
          }
        } catch (error) {
          console.error('[AxonLoader] Hot reload message error:', error);
        }
      };
      
      this.hotReloadWs.onerror = (error) => {
        console.error('[AxonLoader] Hot reload error:', error);
      };
      
      this.hotReloadWs.onclose = () => {
        console.log('[AxonLoader] Hot reload disconnected');
        // TODO: Implement reconnection logic
      };
    } catch (error) {
      console.error('[AxonLoader] Failed to setup hot reload:', error);
    }
  }
  
  /**
   * Load a RETM module and register its exports
   */
  private async loadRETMModule(moduleExports: any): Promise<void> {
    const space = this.space;
    if (!space) {
      throw new Error('Cannot load RETM module: component not attached to space');
    }
    
    console.log(`[AxonLoader] Loading RETM module with exports:`, Object.keys(moduleExports));
    this.loadedExports = [];

    // Initialize the module state with URL parameters if an initializer is provided
    if (moduleExports.initializer && this.parsedUrl?.params) {
      console.log(`[AxonLoader] Calling initializer with params:`, this.parsedUrl.params);
      try {
        // Call setConnectionParams if it exists
        if (typeof moduleExports.initializer.setConnectionParams === 'function') {
          moduleExports.initializer.setConnectionParams({
            host: this.parsedUrl.host,
            path: this.parsedUrl.path,
            ...this.parsedUrl.params
          });
        } else if (typeof moduleExports.initializer.initialize === 'function') {
          moduleExports.initializer.initialize({
            host: this.parsedUrl.host,
            path: this.parsedUrl.path,
            ...this.parsedUrl.params
          });
        }
        this.loadedExports.push('initializer');
        console.log(`[AxonLoader] Initialized module with connection params`);
      } catch (error) {
        console.error(`[AxonLoader] Failed to initialize module:`, error);
      }
    }

    // Register receptors (mount to Space root first)
    if (moduleExports.receptors) {
      for (const [name, ReceptorClass] of Object.entries(moduleExports.receptors)) {
        if (typeof ReceptorClass === 'function') {
          try {
            const receptor = new (ReceptorClass as any)();
            // Mount to Space (root element) so it has element property
            space.addComponent(receptor);
            space.addReceptor(receptor);
            this.loadedExports.push(`receptor:${name}`);
            console.log(`[AxonLoader] Registered receptor: ${name}`);
          } catch (error) {
            console.error(`[AxonLoader] Failed to register receptor ${name}:`, error);
          }
        }
      }
    }
    
    // Register effectors
    if (moduleExports.effectors) {
      for (const [name, EffectorClass] of Object.entries(moduleExports.effectors)) {
        if (typeof EffectorClass === 'function') {
          try {
            const effector = new (EffectorClass as any)();
            space.addEffector(effector);
            this.loadedExports.push(`effector:${name}`);
            console.log(`[AxonLoader] Registered effector: ${name}`);
          } catch (error) {
            console.error(`[AxonLoader] Failed to register effector ${name}:`, error);
          }
        }
      }
    }
    
    // Register transforms
    if (moduleExports.transforms) {
      for (const [name, TransformClass] of Object.entries(moduleExports.transforms)) {
        if (typeof TransformClass === 'function') {
          try {
            const transform = new (TransformClass as any)();
            space.addTransform(transform);
            this.loadedExports.push(`transform:${name}`);
            console.log(`[AxonLoader] Registered transform: ${name}`);
          } catch (error) {
            console.error(`[AxonLoader] Failed to register transform ${name}:`, error);
          }
        }
      }
    }
    
    // Register maintainers
    if (moduleExports.maintainers) {
      for (const [name, MaintainerClass] of Object.entries(moduleExports.maintainers)) {
        if (typeof MaintainerClass === 'function') {
          try {
            const maintainer = new (MaintainerClass as any)();
            space.addMaintainer(maintainer);
            this.loadedExports.push(`maintainer:${name}`);
            console.log(`[AxonLoader] Registered maintainer: ${name}`);
          } catch (error) {
            console.error(`[AxonLoader] Failed to register maintainer ${name}:`, error);
          }
        }
      }
    }

    // Register afferents (via component:add events for pure RETM)
    if (moduleExports.afferents) {
      for (const [name, AfferentClass] of Object.entries(moduleExports.afferents)) {
        if (typeof AfferentClass === 'function') {
          try {
            const afferentClassName = this.manifest?.componentClass || (AfferentClass as any).name || name;
            const { ComponentRegistry } = require('../persistence/component-registry');
            ComponentRegistry.register(afferentClassName, AfferentClass as any);
            
            // Build config with URL params at top level (for setConnectionParams)
            const config: any = {
              ...(this.manifest?.config || {}),
              ...(this.parsedUrl?.params || {}),  // host, path, guild, token, agent, etc.
              _axonMetadata: {
                axonUrl: this.axonUrl,
                moduleUrl: this.moduleUrl,
                manifestUrl: this.manifestUrl,
                host: this.parsedUrl?.host,
                path: this.parsedUrl?.path,
                isAfferent: true  // Flag for maintainer
              }
            };
            
            // Emit component:add - Maintainer will instantiate and call setConnectionParams
            space.emit({
              topic: 'component:add',
              source: this.element.getRef(),
              payload: {
                elementId: this.element.id,
                componentType: afferentClassName,
                componentClass: 'component',
                config
              },
              timestamp: Date.now()
            });
            
            this.loadedExports.push(`afferent:${name}`);
            console.log(`[AxonLoader] Emitted component:add for afferent: ${name}`);
          } catch (error) {
            console.error(`[AxonLoader] Failed to register afferent ${name}:`, error);
          }
        }
      }
    }

    // Also load traditional component if exported (via component:add event)
    if (moduleExports.default || moduleExports.component) {
      const ComponentClass = moduleExports.default || moduleExports.component;
      if (typeof ComponentClass === 'function') {
        try {
          const componentClassName = this.manifest?.componentClass || ComponentClass.name;
          const { ComponentRegistry } = require('../persistence/component-registry');
          ComponentRegistry.register(componentClassName, ComponentClass);
          
          // Build config from URL params
          const config: any = {
            ...(this.manifest?.config || {}),
            ...(this.parsedUrl?.params || {}),
            _axonMetadata: {
              axonUrl: this.axonUrl,
              moduleUrl: this.moduleUrl,
              manifestUrl: this.manifestUrl
            }
          };
          
          // Emit component:add - let Maintainer handle instantiation
          space.emit({
            topic: 'component:add',
            source: this.element.getRef(),
            payload: {
              elementId: this.element.id,
              componentType: componentClassName,
              componentClass: 'component',
              config
            },
            timestamp: Date.now()
          });
          
          this.loadedExports.push('component:default');
          console.log(`[AxonLoader] Emitted component:add for RETM module's component`);
        } catch (error) {
          console.error(`[AxonLoader] Failed to emit component:add:`, error);
        }
      }
    }
    
    console.log(`[AxonLoader] RETM module loaded successfully. Exports: ${this.loadedExports.join(', ')}`);

    // Emit module-loaded event for application to handle initialization
    console.log(`[AxonLoader] Emitting axon:module-loaded event for application initialization`);
    await space.emit({
      topic: 'axon:module-loaded',
      source: this.element.getRef(),
      payload: {
        module: this.manifest?.name || 'unknown',
        exports: this.loadedExports
      },
      timestamp: Date.now()
    });

    // Give the application a chance to handle the event
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  /**
   * Clean up on unmount
   */
  onUnmount(): void {
    // Clean up loaded component
    if (this.loadedComponent) {
      try {
        this.element.removeComponent(this.loadedComponent);
      } catch (error) {
        console.error('[AxonLoader] Error cleaning up component:', error);
      }
    }
    
    // Close hot reload connection
    if (this.hotReloadWs) {
      this.hotReloadWs.close();
      this.hotReloadWs = undefined;
    }
    
    // Clear loaded dependencies
    this.loadedDependencies.clear();
  }
  
  /**
   * Handle action routing to loaded component
   */
  async handleAction(action: string, payload: any): Promise<any> {
    if (!this.loadedComponent) {
      throw new Error('No component loaded');
    }
    
    // Forward action to the loaded component
    if ('handleAction' in this.loadedComponent && typeof this.loadedComponent.handleAction === 'function') {
      return await this.loadedComponent.handleAction(action, payload);
    }
    
    throw new Error(`Loaded component does not support actions`);
  }
}
