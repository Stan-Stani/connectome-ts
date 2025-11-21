import { Component } from './component';
import { SpaceEvent, FrameStartEvent, FrameEndEvent, StreamRef, ElementRef } from './types';
import { VEILStateManager } from '../veil/veil-state';
import { Frame, Facet, VEILDelta, AgentInfo, createDefaultTransition } from '../veil/types';
import { 
  TraceStorage, 
  TraceCategory, 
  getGlobalTracer 
} from '../tracing';
import { EventPriorityQueue } from './priority-queue';
import type { 
  DebugObserver,
  DebugFrameStartContext,
  DebugFrameCompleteContext,
  DebugEventContext,
  DebugAgentFrameContext
} from '../debug/types';
import { DebugServer, DebugServerConfig } from '../debug/debug-server';
import { deterministicUUID } from '../utils/uuid';
import { performance } from 'perf_hooks';
import { 
  Modulator,
  Receptor, 
  Transform, 
  Effector, 
  FacetDelta, 
  ReadonlyVEILState,
  EffectorResult,
  FacetFilter,
  Maintainer
} from './receptor-effector-types';
import { VEILOperationReceptor } from './migration-adapters';
import { groupByPriority } from '../utils/priorities';
import { 
  isReceptor, 
  isTransform, 
  isEffector, 
  isMaintainer,
  isModulator 
} from '../utils/retm-type-guards';
import { generateId } from './utils';

/**
 * The root Space that orchestrates the entire system
 */
export class Space {
  /**
   * Unique identifier for this Space
   */
  readonly id: string;

  /**
   * Human-readable name
   */
  name: string = 'root';

  /**
   * Flat list of all components in the system
   */
  components: Component[] = [];

  /**
   * Component ID registry for fast lookup
   */
  private componentRegistry: Map<string, Component> = new Map();

  /**
   * Priority event queue for the current frame
   */
  private eventQueue: EventPriorityQueue = new EventPriorityQueue();
  
  /**
   * Reference to the host's registry (single source of truth)
   */
  private hostRegistry: Map<string, any>;
  
  /**
   * VEIL state manager
   */
  private veilState: VEILStateManager;
  
  /**
   * Current frame being processed
   */
  private currentFrame?: Frame;
  
  /**
   * Active stream reference
   */
  private activeStream?: StreamRef;
  
  /**
   * Whether we're currently processing a frame
   */
  private processingFrame: boolean = false;

  /**
   * Whether a frame is already scheduled but hasn't started yet
   */
  private frameScheduled: boolean = false;

  /**
   * Tracer for observability
   */
  private tracer: TraceStorage | undefined;
  
  /**
   * Registered debug observers that mirror internal activity to external tooling
   */
  private debugObservers: DebugObserver[] = [];
  
  private debugServerInstance?: DebugServer;
  
  // Frame event buffer for sequential execution
  private frameEventBuffer: SpaceEvent[] = [];
  
  // Lifecycle ID - persists for the entire life of this Space instance
  public readonly lifecycleId: string;
  
  // Restoration mode - suppresses event processing during state restoration
  private isRestoring: boolean = false;
  
  // Topic subscriptions for the Space itself
  private _subscriptions: string[] = [];

  // Callbacks to run on next frame
  private nextFrameCallbacks: (() => void)[] = [];

  /**
   * Runtime flag to enable detailed component execution tracing
   */
  public enableComponentTracing: boolean = false;

  constructor(veilState: VEILStateManager, hostRegistry?: Map<string, any>, lifecycleId?: string, spaceId?: string) {
    this.id = spaceId || 'root';
    this.veilState = veilState;
    this.hostRegistry = hostRegistry || new Map(); // Fallback for tests
    this.tracer = getGlobalTracer();
    this.lifecycleId = lifecycleId || this.generateLifecycleId();
    
    // Subscribe to agent activation events
    this.subscribe('agent:activate');
    
    // Add built-in VEIL operation receptor for compatibility
    const veilOpReceptor = new VEILOperationReceptor();
    this.addComponent(veilOpReceptor);
  }
  
  /**
   * Enable/disable component execution tracing
   */
  toggleComponentTracing(enabled: boolean): void {
    this.enableComponentTracing = enabled;
  }

  /**
   * Get VEILStateManager - public accessor for components
   */
  getVEILStateManager(): VEILStateManager {
    return this.veilState;
  }
  
  /**
   * Generate a new lifecycle ID for this Space instance
   */
  private generateLifecycleId(): string {
    return `lifecycle-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Add a component to the Space
   */
  addComponent<T extends Component>(
    component: T, 
    componentId?: string, 
    isRestoring: boolean = false,
    options?: {
      priority?: number;
      after?: Component | string;
      before?: Component | string;
    }
  ): T {
    // Generate stable ID if not provided
    const id = componentId || `component-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Check for duplicate ID
    if (this.componentRegistry.has(id)) {
      console.warn(`[Space.addComponent] Component ID ${id} already registered, skipping`);
      return this.componentRegistry.get(id) as T;
    }

    // Apply priority if provided
    if (options?.priority !== undefined) {
      component.priority = options.priority;
    }

    // Handle insertion constraints
    let insertIndex = -1;
    
    if (options?.after) {
       // Insert after specific component
       const target = typeof options.after === 'string' 
         ? this.getComponentById(options.after) 
         : options.after;
       if (target) {
         const idx = this.components.indexOf(target);
         if (idx !== -1) insertIndex = idx + 1;
       }
    } else if (options?.before) {
       // Insert before specific component
       const target = typeof options.before === 'string'
         ? this.getComponentById(options.before)
         : options.before;
       if (target) {
         const idx = this.components.indexOf(target);
         if (idx !== -1) insertIndex = idx;
       }
    } else if (options?.after === 'current') {
        // Insert after currently executing component (if processing frame)
        // We need to track current component index in processFrame
        // For now, append to end if not in frame, or use specific logic if needed
    }

    // Register component
    if (insertIndex !== -1) {
      this.components.splice(insertIndex, 0, component);
    } else {
      this.components.push(component);
    }
    
    // Sort by priority if no explicit position constraints were used to force order?
    // Or always sort? If we sort, 'after'/'before' might be lost if priorities conflict.
    // For Phase 3, let's assume priority dominates unless explicit position is given.
    // If we didn't insert at specific index, we sort.
    if (insertIndex === -1) {
      this.sortComponents();
    }

    this.componentRegistry.set(id, component);

    // Mount to Space
    // _attach will call onInit, onMount/onRestore, and auto-register MARTEMs
    // We don't await it here to match synchronous add behavior, but it handles async init internally
    component._attach(this, id, isRestoring).catch((err: any) => {
       console.error(`[Space.addComponent] Error attaching component ${id}:`, err);
    });

    console.log(`[Space.addComponent] Registered ${component.constructor.name} (${id})`);

    return component;
  }

  /**
   * Complete mounting after restoration when external services are ready
   */
  async completeMountForRestoration(): Promise<void> {
    // For flat components list
    for (const component of this.components) {
       if ('_completeMount' in component) {
         await (component as any)._completeMount();
       }
    }
  }
  
  /**
   * Remove a component from the Space
   */
  removeComponent(component: Component): boolean {
    const index = this.components.indexOf(component);
    if (index === -1) return false;
    
    this.components.splice(index, 1);
    if (component.id) {
      this.componentRegistry.delete(component.id);
    }
    
    component._detach();
    return true;
  }

  /**
   * Get a component by its unique ID
   */
  getComponentById(id: string): Component | undefined {
    return this.componentRegistry.get(id);
  }

  /**
   * Get the first component of a specific type
   */
  getComponent<T extends Component>(type: new (...args: any[]) => T): T | null {
    return this.components.find(c => c instanceof type) as T || null;
  }

  /**
   * Get all components of a specific type
   */
  getComponents<T extends Component>(type: new (...args: any[]) => T): T[] {
    return this.components.filter(c => c instanceof type) as T[];
  }
  
  /**
   * Request a frame (alias for legacy support, or for external callers)
   */
  requestFrame(): void {
    if (!this.processingFrame && !this.frameScheduled) {
      this.frameScheduled = true;
      setImmediate(() => {
        this.frameScheduled = false;
        this.processFrame();
      });
    }
  }

  /**
   * Sort components by priority
   */
  private sortComponents(): void {
    this.components.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Apply a VEIL operation immediately
   * Called by components during execution
   */
  applyOperation(operation: VEILDelta): void {
    if (!this.processingFrame || !this.currentFrame) {
      console.warn('[Space] applyOperation called outside of frame processing');
      return;
    }

    console.log(`[Space.applyOperation] Applying ${operation.type} delta immediately`);

    // Apply to VEIL state
    this.veilState.applyDeltasDirect([operation]);

    // Record in frame
    this.currentFrame.deltas.push(operation);
  }

  // MARTEM registration shims - map to components list
  
  addModulator(modulator: Modulator): void {
    // Already added via addComponent, ensure priority/sorting
    modulator.priority = 0;
    this.sortComponents();
  }
  
  addReceptor(receptor: Receptor): void {
    receptor.priority = 100;
    this.sortComponents();
  }
  
  addTransform(transform: Transform): void {
    transform.priority = 200;
    this.sortComponents();
  }
  
  addEffector(effector: Effector): void {
    effector.priority = 300;
    this.sortComponents();
  }
  
  addMaintainer(maintainer: Maintainer): void {
    maintainer.priority = 400;
    this.sortComponents();
  }

  /**
   * Attach an external debug observer
   */
  addDebugObserver(observer: DebugObserver): void {
    this.debugObservers.push(observer);
  }
  
  /**
   * Enable embedded debug server
   */
  enableDebugServer(config?: Partial<DebugServerConfig>): void {
    if (this.debugServerInstance) {
      return;
    }
    this.debugServerInstance = new DebugServer(this, config);
    this.debugServerInstance.start();
  }

  /**
   * Get the current active stream
   */
  getActiveStream(): StreamRef | undefined {
    return this.activeStream;
  }
  
  /**
   * Get the current frame
   */
  getCurrentFrame(): Frame | undefined {
    return this.currentFrame;
  }
  
  /**
   * Set restoration mode
   */
  setRestorationMode(restoring: boolean): void {
    this.isRestoring = restoring;
  }
  
  /**
   * Queue an event for processing
   */
  queueEvent(event: SpaceEvent): void {
    // Suppress event processing during restoration
    if (this.isRestoring) {
      return;
    }
    
    // Queue events that arrive during frame processing
    // These will be added to the main queue at the end of the current frame
    if (this.processingFrame) {
      this.frameEventBuffer.push(event);
    } else {
      this.eventQueue.push(event);
      this.requestFrame();
    }
    
    this.tracer?.record({
      id: `evt-${Date.now()}`,
      timestamp: Date.now(),
      level: 'debug',
      category: TraceCategory.EVENT_QUEUE,
      component: 'Space',
      operation: 'queueEvent',
      data: {
        topic: event.topic,
        source: event.source.elementId,
        priority: event.priority || 'normal',
        queueLength: this.eventQueue.length,
        queueState: this.eventQueue.getDebugInfo()
      }
    });
    
    this.requestFrame();
  }
  
  /**
   * Emit an event
   */
  emit(event: SpaceEvent): void {
    this.queueEvent(event);
  }

  /**
   * Subscribe to event topics
   */
  subscribe(topicPattern: string): void {
    this._subscriptions.push(topicPattern);
  }

  /**
   * Get a reference to this Space
   */
  getRef(): ElementRef {
    return {
      elementId: this.id,
      elementPath: ['root'],
      elementType: 'Space'
    };
  }
  
  /**
   * Schedule a callback to run at the start of the next frame
   */
  runNextFrame(callback: () => void): void {
    this.nextFrameCallbacks.push(callback);
    this.requestFrame();
  }

  /**
   * Process one frame
   */
  private async processFrame(): Promise<void> {
    if (this.processingFrame) return;
    
    // Run next frame callbacks first
    const callbacks = [...this.nextFrameCallbacks];
    this.nextFrameCallbacks = [];
    for (const callback of callbacks) {
      try {
        callback();
      } catch (err) {
        console.error('[Space] Error in next frame callback:', err);
      }
    }
    
    // Skip frame processing during restoration
    if (this.isRestoring) {
      console.log('[Space] Skipping frame processing during restoration');
      return;
    }
    this.processingFrame = true;
    
    const frameId = this.veilState.getNextSequence();
    const frameStartClock = performance.now();
    const frameSpan = this.tracer?.startSpan('processFrame', 'Space');
    const timestamp = new Date().toISOString();

    try {
      // Create frame structure
      const frame: Frame = {
        sequence: frameId,
        timestamp,
        uuid: deterministicUUID(`frame-${frameId}`),
        events: [],
        deltas: [],
        transition: createDefaultTransition(frameId, timestamp)
      };
      
      this.currentFrame = frame;
      
      this.notifyDebugFrameStart(this.currentFrame, {
        queuedEvents: this.eventQueue.length,
        components: this.getComponentSnapshots()
      });
      
      // Drain event queue - Take ONE event
      const event = this.eventQueue.shift();
      
      if (!event) {
        // Should not happen if loop check is correct, but safety first
        this.processingFrame = false;
        return;
      }
      
      // Record processed event in frame
      frame.events = [event];
      
      // Emit frame:start (this is a system event, handled specially?)
      // Or just process components.
      // In Phase 3, we iterate components for THIS event.
      // Prepare execution context for component execution
      const context = {
        event,
        state: this.getReadonlyState(),
        sequence: frame.sequence,
        timestamp: frame.timestamp,
        frame: frame as import('../veil/types').ReadonlyFrame,
        bufferedEvents: this.frameEventBuffer
      };

      // Sequential Execution
      // Index-based iteration allows components to be added during execution
      // Components can insert after current position using addComponent options

      const componentExecutions: import('../debug/types').ComponentExecutionRecord[] = [];
      const trackingEnabled = this.enableComponentTracing;

      for (let i = 0; i < this.components.length; i++) {
        const component = this.components[i];
        if (!component.enabled) continue;

        let startDeltaCount = 0;
        let startEventBufferCount = 0;
        let startTime = 0;
        let error: string | undefined;

        if (trackingEnabled) {
           startDeltaCount = frame.deltas.length;
           startEventBufferCount = this.frameEventBuffer.length;
           startTime = performance.now();
        }

        try {
          // Execute component logic
          component.execute(context);

          // Update context.state after each component so subsequent components
          // see the latest state including deltas applied by earlier components
          context.state = this.getReadonlyState();

          // Also deliver event to handleEvent (legacy/direct subscription)
          // This maintains compatibility with components using handleEvent
          // but not yet migrated to execute() logic (if any)
          // OR if execute() is the new way, maybe handleEvent is called internally?
          // Component.execute is no-op by default.
          // If we want legacy handleEvent to work, we should call it.
          if (component.isSubscribedTo(event.topic)) {
             await component.handleEvent(event);
          }

        } catch (err: any) {
          console.error(`[Space] Error executing component ${component.constructor.name}:`, err);
          error = err.message || String(err);
        } finally {
           if (trackingEnabled) {
              componentExecutions.push({
                componentId: component.id || 'unknown',
                componentName: component.constructor.name,
                durationMs: performance.now() - startTime,
                deltaStartIndex: startDeltaCount,
                deltaEndIndex: frame.deltas.length,
                emittedEvents: this.frameEventBuffer.length - startEventBufferCount,
                error
              });
           }
        }
      }
      
      // Flush buffer to event queue
      // Push directly to eventQueue instead of calling queueEvent() to avoid
      // re-buffering while processingFrame is still true
      if (this.frameEventBuffer.length > 0) {
        for (const bufferedEvent of this.frameEventBuffer) {
          this.eventQueue.push(bufferedEvent);
        }
        this.frameEventBuffer = [];
      }
      
      // Finalize frame
      this.veilState.finalizeFrame(frame, true);
      
      // Clean up ephemeral facets
      const ephemeralCleanup = this.veilState.cleanupEphemeralFacets();
      // cleanupEphemeralFacets returns changes that WERE applied (FacetDelta[])
      // Note: Ephemeral cleanup returns FacetDelta[], not VEILDelta[]
      // Frame.deltas contains VEILDelta (VEIL operations), not outcome deltas
      // Ephemeral cleanup is tracked implicitly by the state manager, not recorded in frame
      
      // Notify debug observers
        this.notifyDebugFrameComplete(this.currentFrame, {
          durationMs: performance.now() - frameStartClock,
          processedEvents: 1, // We processed one event
          componentExecutions: trackingEnabled ? componentExecutions : undefined
        });
        
    } finally {
      this.currentFrame = undefined;
      
      if (frameSpan) {
        this.tracer?.endSpan(frameSpan.id);
      }
      
      const hasMore = this.eventQueue.length > 0;
      this.processingFrame = false;

      if (hasMore && !this.frameScheduled) {
        this.frameScheduled = true;
        setImmediate(() => {
          this.frameScheduled = false;
          this.processFrame();
        });
      }
    }
  }
  
  private async deliverEventToComponents(event: SpaceEvent): Promise<void> {
    // No-op in new architecture - handled in processFrame loop
  }
  
  // Removed Phase methods (runPhase0, runPhase1, etc.)
  
  /**
   * Apply component-state delta with scoped write validation
   */
  _applyComponentStateDelta(delta: VEILDelta, componentId: string): void {
    if (delta.type !== 'rewriteFacet' || !delta.id.startsWith('component-state:')) {
      throw new Error(`_applyComponentStateDelta can only be used for component-state facets`);
    }
    
    const expectedId = `component-state:${componentId}`;
    if (delta.id !== expectedId) {
      throw new Error(`Component ${componentId} attempted to modify ${delta.id}. Components can only modify their own state.`);
    }
    
    this.veilState.applyDeltasDirect([delta]);
    if (this.currentFrame) {
      this.currentFrame.deltas.push(delta);
    }
  }

  /**
   * Helper to check if facet matches effector filters
   */
  private matchesEffectorFilters(facet: Facet, filters: FacetFilter[]): boolean {
    if (filters.length === 0) return true;
    
    return filters.some(filter => {
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        if (!types.includes(facet.type)) return false;
      }
      
      if (filter.aspectMatch) {
        for (const [aspect, value] of Object.entries(filter.aspectMatch)) {
          if ((facet as any)[aspect] !== value) return false;
        }
      }
      
      if (filter.attributeMatch) {
        if (!facet.attributes) return false;
        for (const [key, value] of Object.entries(filter.attributeMatch)) {
          if (facet.attributes[key] !== value) return false;
        }
      }
      
      return true;
    });
  }
  
  /**
   * Get read-only view of state
   */
  private getReadonlyState(): ReadonlyVEILState {
    const state = this.veilState.getState();
    
    return {
      facets: state.facets as ReadonlyMap<string, Facet>,
      scopes: state.scopes as ReadonlySet<string>,
      streams: state.streams as ReadonlyMap<string, any>,
      agents: state.agents as ReadonlyMap<string, AgentInfo>,
      currentStream: state.currentStream,
      currentAgent: state.currentAgent,
      frameHistory: [...state.frameHistory],
      currentSequence: state.currentSequence,
      removals: new Map(state.removals),
      
      getFacetsByType: (type: string) => {
        return Array.from(state.facets.values()).filter(f => f.type === type);
      },
      
      getFacetsByAspect: (aspect: keyof Facet, value: any) => {
        return Array.from(state.facets.values()).filter(f => (f as any)[aspect] === value);
      },
      
      hasFacet: (id: string) => {
        return state.facets.has(id);
      }
    };
  }
  
  /**
   * Get the VEIL state manager
   */
  getVEILState(): VEILStateManager {
    return this.veilState;
  }
  
  /**
   * Register a reference for dependency injection
   */
  registerReference(id: string, value: any): void {
    this.hostRegistry.set(id, value);
  }
  
  /**
   * Get a reference by ID
   */
  getReference(id: string): any {
    return this.hostRegistry.get(id);
  }
  
  /**
   * List all available references (for debugging)
   */
  listReferences(): string[] {
    return Array.from(this.hostRegistry.keys());
  }

  private getComponentSnapshots(): import('../debug/types').DebugComponentSnapshot[] {
    return this.components.map(c => ({
      id: c.id || 'unknown',
      name: c.constructor.name,
      priority: c.priority,
      enabled: c.enabled
    }));
  }

  private notifyDebugFrameStart(frame: Frame, context: DebugFrameStartContext): void {
    for (const observer of this.debugObservers) {
      observer.onFrameStart?.(frame, context);
    }
  }

  private notifyDebugFrameComplete(frame: Frame, context: DebugFrameCompleteContext): void {
    for (const observer of this.debugObservers) {
      observer.onFrameComplete?.(frame, context);
    }
  }
  
  /**
   * Activate the agent with specified stream configuration
   */
  activateAgent(
    streamId: string, 
    options: {
      source?: string;
      reason?: string;
      priority?: 'low' | 'normal' | 'high';
      streamType?: string;
      metadata?: Record<string, any>;
    } = {}
  ): void {
    this.emit({
      topic: 'agent:activate',
      source: this.getRef(),
      payload: {
        streamId,
        ...options
      },
      timestamp: Date.now()
    });
  }
}
