/**
 * ConnectomeHost - Core infrastructure for Connectome applications
 */

import { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import { TransitionManager } from '../persistence/transition-manager';
import { PersistenceMaintainer } from '../persistence/persistence-maintainer';
import { FileStorageAdapter } from '../persistence/file-storage';
import { DebugServer } from '../debug/debug-server';
import { LLMProvider } from '../llm/llm-interface';
import { ComponentRegistry } from '../persistence/component-registry';
import { ConnectomeApplication } from './types';
import { getReferenceMetadata, getExternalMetadata, RestorableComponent } from './decorators';
import { Component } from '../spaces/component';
import { SpaceEvent } from '../spaces/types';
import { restoreVEILState } from '../persistence/restoration';
import { registerDebugHost, registerDebugSpace, registerDebugServer } from '../debug/debug-registry';

export interface HostConfig {
  persistence?: {
    enabled: boolean;
    storageDir?: string;
    snapshotInterval?: number;  // Frames between snapshots (default: 100)
  };
  debug?: {
    enabled: boolean;
    port?: number;
  };
  providers?: {
    [key: string]: LLMProvider;
  };
  secrets?: {
    [key: string]: string;
  };
  reset?: boolean;
}

/**
 * Component to handle dynamic component loading events
 */
class HostHandlerComponent extends Component {
  private host: ConnectomeHost;

  constructor(host: ConnectomeHost) {
    super();
    this.host = host;
  }

  onMount(): void {
    console.log('[Host Handler] Mounted and ready to handle dynamic component events');
  }

  async handleEvent(event: SpaceEvent): Promise<void> {
    console.log(`[Host Handler] Received event: ${event.topic}`);
    if (event.topic === 'axon:component-loaded') {
      const payload = event.payload as { component: Component; componentClass: string };
      const component = payload.component;
      if (component) {
        console.log(`🔌 Resolving references for dynamically loaded component: ${payload.componentClass}`);
        await this.host.resolveComponentReferences(component);
        await this.host.resolveExternalResources(component);

        // Call onReferencesResolved if it exists
        if ('onReferencesResolved' in component && typeof (component as any).onReferencesResolved === 'function') {
          (component as any).onReferencesResolved();
        }
      }
    }
  }
}

export class ConnectomeHost {
  private config: HostConfig;
  private referenceRegistry = new Map<string, any>();
  private providers = new Map<string, LLMProvider>();
  private secrets = new Map<string, string>();
  private transitionManager?: TransitionManager;
  private storageAdapter?: any;  // FileStorageAdapter instance
  private debugServer?: DebugServer;
  
  constructor(config: HostConfig = {}) {
    this.config = config;

    // Register for debug access (only when --inspect is active)
    registerDebugHost(this);

    // Register providers
    if (config.providers) {
      Object.entries(config.providers).forEach(([id, provider]) => {
        this.providers.set(id, provider);
        this.referenceRegistry.set(`provider:${id}`, provider);

        // Also register common names for convenience
        if (id === 'llm.primary') {
          this.referenceRegistry.set('llmProvider', provider);
        }
      });
    }

    // Register secrets
    if (config.secrets) {
      Object.entries(config.secrets).forEach(([id, secret]) => {
        this.secrets.set(id, secret);
        console.log(`[Host] Registered secret: ${id} = ${secret ? '***' + secret.slice(-4) : 'undefined'}`);
      });
    }
  }
  
  /**
   * Start a Connectome application
   */
  async start(app: ConnectomeApplication): Promise<Space> {
    console.log('🚀 Starting Connectome Host...');
    
    // Handle storage initialization and reset
    if (this.config.persistence?.enabled) {
      const storageDir = this.config.persistence.storageDir || './connectome-state';
      this.storageAdapter = new FileStorageAdapter(storageDir);
      
      // Clear storage on --reset to start completely fresh
      if (this.config.reset) {
        console.log('🗑️  Clearing persistence storage (--reset flag)...');
        await this.storageAdapter.clear();
        console.log('✅ Storage cleared - starting fresh lifecycle');
      }
    }
    
    let space: Space;
    let veilState: VEILStateManager;
    let wasRestored = false;
    
    try {
      // Check for existing snapshot
      const snapshot = await this.loadSnapshot();
      
      if (snapshot && !this.config.reset) {
        console.log('📦 Restoring from snapshot...');
        ({ space, veilState } = await this.restore(snapshot, app));
        wasRestored = true;
      } else {
        console.log('🌱 Creating fresh application...');
        ({ space, veilState } = await this.createFresh(app));
      }
    } catch (error) {
      // If persistence is enabled and loading failed, this is a fatal error
      if (this.config.persistence?.enabled && !this.config.reset) {
        console.error('❌ Failed to load persisted state:', error);
        console.error('💥 Persistence loading failed - exiting to prevent data loss');
        throw error;
      }
      // If persistence is not enabled, we can continue with fresh state
      console.log('🌱 Creating fresh application...');
      ({ space, veilState } = await this.createFresh(app));
    }
    
    // Core services already registered in createFresh/restore

    // Register space for debug access (only when --inspect is active)
    registerDebugSpace(space);

    // Set up persistence tracking if enabled
    if (this.config.persistence?.enabled) {
      // Create storage adapter (reused for loading deltas)
      this.storageAdapter = new (await import('../persistence/file-storage')).FileStorageAdapter(
        this.config.persistence.storageDir || './connectome-state'
      );

      // Mount persistence maintainer (auto-registration handles the rest!)
      const persistenceMaintainer = new PersistenceMaintainer(veilState, space, {
        storagePath: this.config.persistence.storageDir || './connectome-state',
        snapshotInterval: this.config.persistence.snapshotInterval || 100
      });

      // Mount directly
      space.addComponent(persistenceMaintainer, 'infrastructure:PersistenceMaintainer');

      // Store reference for debug server frame deletion
      (space as any).persistence = persistenceMaintainer;
    }

    // Start debug server if enabled
    if (this.config.debug?.enabled) {
      const port = this.config.debug.port || 3015;
      this.debugServer = new DebugServer(space, { port });
      registerDebugServer(this.debugServer);
      await this.debugServer.start();
      console.log(`🔍 Debug UI available at http://localhost:${port}`);
    }
    
    // Set up dynamic component handler
    this.setupDynamicComponentHandler(space);
    
    // Let the application perform final initialization
    // Only call onStart for fresh applications (not after restore)
    if (!wasRestored) {
      await app.onStart?.(space, veilState);
    }
    
    console.log('✅ Host started successfully!\n');
    
    return space;
  }
  
  /**
   * Stop the host and clean up resources
   */
  async stop(): Promise<void> {
    // Save final snapshot
    console.log('\n💾 Saving state before shutdown...');
    if (this.transitionManager) {
      await this.transitionManager.createSnapshot();
    }
    
    // Stop debug server
    if (this.debugServer) {
      this.debugServer.stop();
    }
    
    // Clear registries
    this.referenceRegistry.clear();
    this.providers.clear();
    this.secrets.clear();
  }
  
  /**
   * Delete recent frames
   */
  async deleteFrames(count: number): Promise<void> {
    if (!this.transitionManager) {
      throw new Error('Persistence not enabled');
    }
    
    await this.transitionManager.deleteRecentFramesAndSnapshot(count, 'User requested deletion');
  }
  
  /**
   * Create a fresh application instance
   */
  private async createFresh(app: ConnectomeApplication): Promise<{ space: Space; veilState: VEILStateManager }> {
    const { space, veilState } = await app.createSpace(this.referenceRegistry);
    
    // Register core services before initialization
    this.referenceRegistry.set('space', space);
    this.referenceRegistry.set('veilState', veilState);
    
    // Initialize core infrastructure BEFORE app.initialize()
    await this.initializeComponentInfrastructure(space);
    
    await app.initialize(space, veilState);
    await this.resolveAllReferences(space);
    return { space, veilState };
  }
  
  /**
   * Restore from a persistence snapshot
   */
  private async restore(snapshot: any, app: ConnectomeApplication): Promise<{ space: Space; veilState: VEILStateManager }> {
    // Create space and VEIL state, preserving lifecycleId and spaceId from snapshot
    const { space, veilState } = await app.createSpace(this.referenceRegistry, snapshot.lifecycleId, snapshot.spaceId);
    
    // Register core services before restoration
    this.referenceRegistry.set('space', space);
    this.referenceRegistry.set('veilState', veilState);
    
    // Register components with ComponentRegistry BEFORE restoration
    app.getComponentRegistry();
    
    // Enter restoration mode BEFORE any component initialization
    space.setRestorationMode(true);
    
    // Restore VEIL state from snapshot
    await restoreVEILState(veilState, snapshot.veilState);
    
    // NOW initialize infrastructure (after VEIL is restored)
    await this.initializeComponentInfrastructure(space);
    
    // Set up dynamic component handler BEFORE restoring components
    this.setupDynamicComponentHandler(space);
    
    const afterTreeState = veilState.getState();
    console.log(`[Host] After VEIL restore: currentSeq=${afterTreeState.currentSequence}, frameCount=${afterTreeState.frameHistory.length}`);
    
    // Load and replay deltas since the snapshot
    if (this.config.persistence?.enabled && this.storageAdapter) {
      const deltas = await this.storageAdapter.loadDeltas(
        snapshot.sequence + 1, 
        undefined, 
        snapshot.lifecycleId
      );
      
      if (deltas.length > 0) {
        console.log(`📼 Replaying ${deltas.length} deltas since snapshot (sequence ${snapshot.sequence})...`);
        
        // Replay each delta frame synchronously to VEIL
        for (const delta of deltas) {
          const changes = veilState.applyFrame(delta.frame);
        }
        
        const finalSequence = veilState.getState().currentSequence;
        console.log(`✅ Replayed deltas, now at sequence ${finalSequence}`);
      }
    }
    
    // Phase 1 compatibility: Reconstruct components from element-tree facets in VEIL
    await this.reconstructComponentsFromVEIL(space, veilState);
    
    // Exit restoration mode
    space.setRestorationMode(false);
    
    console.log('✅ All components restored and mounted');
    
    // Now resolve all references and external resources
    await this.resolveAllReferences(space);
    
    // Check for any dynamically loaded components that need resources resolved
    await this.resolveDynamicComponents(space);
    
    // Complete mounting for all restored components
    console.log('🔧 Completing component mounting after restoration...');
    await space.completeMountForRestoration();
    
    // Let app do any post-restore setup
    await app.onRestore?.(space, veilState);
    
    return { space, veilState };
  }
  
  /**
   * Load persistence snapshot if available
   */
  private async loadSnapshot(): Promise<any | null> {
    if (!this.storageAdapter) return null;
    
    try {
      const snapshots = await this.storageAdapter.listSnapshots();
      if (snapshots.length === 0) return null;
      
      console.log(`[Host] Found ${snapshots.length} snapshots, selecting newest:`);
      console.log(`[Host] Loading snapshot: ${snapshots[snapshots.length - 1]}`);
      
      const latest = snapshots[snapshots.length - 1];
      const snapshot = await this.storageAdapter.loadSnapshot(latest);
      
      if (!snapshot) {
        throw new Error(`Failed to load snapshot ${latest}: Invalid snapshot structure`);
      }
      
      return snapshot;
    } catch (error) {
      console.error('Failed to load snapshot:', error);
      throw error;
    }
  }
  
  /**
   * Initialize core Component infrastructure
   */
  private async initializeComponentInfrastructure(space: Space): Promise<void> {
    // Import ComponentManager dynamically
    const { ComponentManager } = await import('../spaces/component-manager');

    console.log('✨ FLEX Phase 2: Component architecture active');

    // Mount ComponentManager directly
    const componentManager = new ComponentManager();
    space.addComponent(componentManager, 'infrastructure:ComponentManager');

    console.log('🔧 Component infrastructure initialized');
  }

  /**
   * Resolve all component references and external resources
   */
  private async resolveAllReferences(space: Space): Promise<void> {
    const components = space.components;
    
    // First pass: resolve references
    for (const component of components) {
      await this.resolveComponentReferences(component);
    }
    
    // Second pass: resolve external resources
    for (const component of components) {
      await this.resolveExternalResources(component);
    }
    
    // Third pass: notify components
    for (const component of components) {
      const restorable = component as RestorableComponent;
      if (restorable.onReferencesResolved) {
        await restorable.onReferencesResolved();
      }
    }
  }
  
  /**
   * Resolve references for a component
   */
  public async resolveComponentReferences(component: Component): Promise<void> {
    const references = getReferenceMetadata(component);
    
    for (const ref of references) {
      const target = this.referenceRegistry.get(ref.referenceId!);
      
      if (!target && ref.required) {
        throw new Error(`Required reference '${ref.referenceId}' not found for ${component.constructor.name}`);
      }
      
      if (target) {
        (component as any)[ref.propertyKey] = target;
      }
    }
  }
  
  /**
   * Resolve external resources for a component
   */
  public async resolveExternalResources(component: Component): Promise<void> {
    const externals = getExternalMetadata(component);
    
    if (externals.length > 0) {
      console.log(`Resolving ${externals.length} external resources for ${component.constructor.name}`);
    }
    
    for (const ext of externals) {
      const [type, ...pathParts] = ext.resourcePath.split(':');
      const path = pathParts.join(':');
      
      let value: any;
      
      switch (type) {
        case 'secret':
          value = this.secrets.get(path);
          break;
        case 'provider':
          value = this.providers.get(path);
          break;
        default:
          throw new Error(`Unknown external resource type: ${type}`);
      }
      
      if (!value && ext.required) {
        throw new Error(`Required external resource '${ext.resourcePath}' not found for ${component.constructor.name}`);
      }
      
      if (value) {
        (component as any)[ext.propertyKey] = value;
      }
    }
  }
  
  /**
   * Resolve resources for any dynamically loaded components
   */
  private async resolveDynamicComponents(space: Space): Promise<void> {
    console.log('[Host] Checking for dynamically loaded components needing resources...');
    
    for (const component of space.components) {
      // Special handling for AxonLoader - check if it has a loaded component
      if (component.constructor.name === 'AxonLoaderComponent') {
        const axonLoader = component as any;
        if (axonLoader.loadedComponent) {
          // Resolve resources for loaded component
          await this.resolveComponentReferences(axonLoader.loadedComponent);
          await this.resolveExternalResources(axonLoader.loadedComponent);
          
          if ('onReferencesResolved' in axonLoader.loadedComponent && 
              typeof axonLoader.loadedComponent.onReferencesResolved === 'function') {
            axonLoader.loadedComponent.onReferencesResolved();
          }
        }
      }
      
      // Standard resolution
      await this.resolveComponentReferences(component);
      await this.resolveExternalResources(component);
    }
  }
  
  /**
   * Set up handler for dynamically loaded components
   */
  private setupDynamicComponentHandler(space: Space): void {
    const componentId = '_host_handler:HostHandlerComponent';
    const existingHandler = space.getComponentById(componentId);

    if (existingHandler) {
      console.log('[Host] Found existing host handler from persistence');
      // Ensure space is subscribed to the right events
      space.subscribe('axon:component-loaded');
      return;
    }

    // Create new host handler component
    console.log('[Host] Creating new host handler');
    const handler = new HostHandlerComponent(this);

    // Mount directly
    space.addComponent(handler, componentId);

    // Subscribe to axon component loaded events at space level
    space.subscribe('axon:component-loaded');

    console.log('[Host] Dynamic component handler setup complete');
  }
  
  /**
   * Phase 1 compatibility: Reconstruct components from element-tree facets in VEIL
   */
  private async reconstructComponentsFromVEIL(space: Space, veilState: VEILStateManager): Promise<void> {
    const state = veilState.getState();
    
    // Find all active element-tree facets
    const elementFacets = Array.from(state.facets.values())
      .filter(f => f.type === 'element-tree' && (f as any).state?.active) as any[];
    
    if (elementFacets.length === 0) return;
    
    console.log(`[Host] Reconstructing components from ${elementFacets.length} element-tree facets...`);

    // Sort to ensure consistency if needed, though flat list doesn't strictly require it
    // except for maybe ID stability if indices are used
    
    for (const facet of elementFacets) {
      const { elementId, components } = facet.state;
      
      // Skip root (Space itself)
      if (elementId === 'root' || elementId === space.id) {
         if (components && components.length > 0) {
            await this.restoreComponentsForSpace(space, elementId, components);
         }
         continue;
      }
      
      // Restore components for this "element"
      if (components && components.length > 0) {
        await this.restoreComponentsForSpace(space, elementId, components);
      }
    }
  }
  
  /**
   * Restore components for an element ID
   */
  private async restoreComponentsForSpace(space: Space, elementId: string, components: any[]): Promise<void> {
    const { ComponentRegistry } = await import('../persistence/component-registry');
    
    for (const compDef of components) {
      const { type, config } = compDef;
      
      // Create component using registry
      const component = ComponentRegistry.create(type);
      
      if (!component) {
        console.warn(`[Host] Failed to create component ${type} for element ${elementId}`);
        continue;
      }
      
      // Apply config properties to component
      if (config) {
        Object.assign(component, config);
      }
      
      // Generate stable ID
      // Try to find if this component already exists
      const existing = space.components.find(c => 
         c.constructor.name === type && 
         (c as any).id?.startsWith(elementId)
      );

      if (existing) continue;

      // Fallback ID generation
      const componentIndex = components.indexOf(compDef);
      const componentId = `${elementId}:${type}:${componentIndex}`;
      
      // Add component
      space.addComponent(component, componentId);
      
      console.log(`[Host]   Restored component: ${type} (${componentId})`);
    }
  }
}
