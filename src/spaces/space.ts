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
  
  // MARTEM architecture components
  private modulators: Modulator[] = [];
  private receptors: Map<string, Receptor[]> = new Map();
  private transforms: Transform[] = [];
  private effectors: Effector[] = [];
  private maintainers: Maintainer[] = [];

  // Lifecycle ID - persists for the entire life of this Space instance
  public readonly lifecycleId: string;
  
  // Restoration mode - suppresses event processing during state restoration
  private isRestoring: boolean = false;
  
  // Topic subscriptions for the Space itself
  private _subscriptions: string[] = [];

  // Callbacks to run on next frame
  private nextFrameCallbacks: (() => void)[] = [];

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
  addComponent<T extends Component>(component: T, componentId?: string, isRestoring: boolean = false): T {
    // Generate stable ID if not provided
    const id = componentId || `component-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Check for duplicate ID
    if (this.componentRegistry.has(id)) {
      console.warn(`[Space.addComponent] Component ID ${id} already registered, skipping`);
      return this.componentRegistry.get(id) as T;
    }

    // Register component
    this.components.push(component);
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

  // MARTEM registration methods
  
  addModulator(modulator: Modulator): void {
    this.modulators.push(modulator);
  }
  
  addReceptor(receptor: Receptor): void {
    for (const topic of receptor.topics) {
      const topicReceptors = this.receptors.get(topic) || [];
      topicReceptors.push(receptor);
      this.receptors.set(topic, topicReceptors);
      console.log(`[Space.addReceptor] Registered ${receptor.constructor.name} for topic '${topic}', now ${topicReceptors.length} receptors for this topic`);
    }
  }
  
  addTransform(transform: Transform): void {
    this.transforms.push(transform);
    
    // Sort: prioritized transforms first (by priority), then unprioritized (maintain order)
    this.transforms.sort((a, b) => {
      const aPriority = a.priority;
      const bPriority = b.priority;
      
      if (aPriority !== undefined && bPriority !== undefined) return aPriority - bPriority;
      if (aPriority !== undefined) return -1;
      if (bPriority !== undefined) return 1;
      return 0;
    });
  }
  
  addEffector(effector: Effector): void {
    this.effectors.push(effector);
  }
  
  addMaintainer(maintainer: Maintainer): void {
    this.maintainers.push(maintainer);
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
    
    this.eventQueue.push(event);
    
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
        queuedEvents: this.eventQueue.length
      });
      
      // Drain event queue
      const events: SpaceEvent[] = [];
      while (!this.eventQueue.isEmpty()) {
        const event = this.eventQueue.shift();
        if (event) {
          events.push(event);
        }
      }
      
      // PHASE 0: Event preprocessing (via Modulators)
      const processedEvents = this.runPhase0(events);
      
      // Emit frame:start to components
      const frameStartEvent: SpaceEvent = {
        topic: 'frame:start',
        source: this.getRef(),
        payload: { frameId },
        timestamp: Date.now()
      };
      await this.deliverEventToComponents(frameStartEvent);
      
      // Apply any deltas that components added during frame:start
      const componentDeltas = frame.deltas.length > 0 ? [...frame.deltas] : [];
      const componentChanges = componentDeltas.length > 0 
        ? this.veilState.applyDeltasDirect(componentDeltas)
        : [];
      
      // Record processed events in frame
      frame.events = processedEvents;
      
      // Deliver events to subscribed components
      for (const event of processedEvents) {
        await this.deliverEventToComponents(event);
      }
      
      // PHASE 1: Events → VEIL (via Receptors)
      const phase1Deltas = this.runPhase1(processedEvents);
      const phase1Changes = this.veilState.applyDeltasDirect(phase1Deltas);
      
      // PHASE 2: VEIL → VEIL (via Transforms)
      const phase2Result = this.runPhase2();
      const allPhase2Deltas = phase2Result.deltas;
      const allPhase2Changes = phase2Result.changes;
      
      // Collect all deltas into frame BEFORE Phase 4
      frame.deltas = [...componentDeltas, ...phase1Deltas, ...allPhase2Deltas];
      
      // Collect all changes
      const allChanges = [...componentChanges, ...phase1Changes, ...allPhase2Changes];
      
      // PHASE 3: VEIL → Events (via Effectors)
      const newEvents = await this.runPhase3(allChanges);
      
      // PHASE 4: Maintenance
      const maintenanceResult = await this.runPhase4(this.currentFrame, allChanges);
      
      // Apply maintainer deltas immediately
      if (maintenanceResult.deltas && maintenanceResult.deltas.length > 0) {
        const maintenanceChanges = this.veilState.applyDeltasDirect(maintenanceResult.deltas);
        allChanges.push(...maintenanceChanges);
        frame.deltas = [...frame.deltas, ...maintenanceResult.deltas];
      }
      
      // Update transition with all operations
      if (frame.transition) {
        frame.transition.veilOps = [...frame.deltas];
      }
      
      // Finalize frame
      this.veilState.finalizeFrame(frame, true);
      
      // Queue all new events for next frame
      [...newEvents, ...(maintenanceResult.events || [])].forEach(event => this.queueEvent(event));
      
      // Clean up ephemeral facets
      const ephemeralCleanup = this.veilState.cleanupEphemeralFacets();
      allChanges.push(...ephemeralCleanup);
      
      // Notify debug observers
        this.notifyDebugFrameComplete(this.currentFrame, {
          durationMs: performance.now() - frameStartClock,
          processedEvents: events.length
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
  
  /**
   * Deliver event to subscribed components
   */
  private async deliverEventToComponents(event: SpaceEvent): Promise<void> {
    for (const component of this.components) {
      if (component.enabled && component.isSubscribedTo(event.topic)) {
        try {
          await component.handleEvent(event);
        } catch (error) {
          console.error(`[Space] Error delivering event ${event.topic} to component ${component.constructor.name}:`, error);
        }
      }
    }
  }
  
  /**
   * PHASE 0: Event preprocessing (Modulators)
   */
  private runPhase0(events: SpaceEvent[]): SpaceEvent[] {
    let processedEvents = events;
    for (const modulator of this.modulators) {
      processedEvents = modulator.process(processedEvents);
    }
    return processedEvents;
  }
  
  /**
   * PHASE 1: Events → VEIL Deltas (Receptors)
   */
  private runPhase1(events: SpaceEvent[]): VEILDelta[] {
    const allDeltas: VEILDelta[] = [];
    
    for (const event of events) {
      const receptorsForTopic = this.receptors.get(event.topic) || [];
      if (receptorsForTopic.length === 0) continue;
      
      const receptorGroups = groupByPriority(receptorsForTopic);
      
      for (const [priority, receptors] of receptorGroups) {
        const groupDeltas: VEILDelta[] = [];
        
        for (const receptor of receptors) {
          const newDeltas = receptor.transform(event, this.getReadonlyState());
          groupDeltas.push(...newDeltas);
        }
        
        if (groupDeltas.length > 0) {
          this.veilState.applyDeltasDirect(groupDeltas);
          this.currentFrame!.deltas.push(...groupDeltas);
          allDeltas.push(...groupDeltas);
        }
      }
    }
    
    return allDeltas;
  }
  
  /**
   * PHASE 2: VEIL → VEIL (Transforms)
   */
  private runPhase2(): { deltas: VEILDelta[], changes: FacetDelta[] } {
    const allDeltas: VEILDelta[] = [];
    const allChanges: FacetDelta[] = [];
    const maxIterations = 100;
    
    const transformGroups = groupByPriority(this.transforms);
    
    for (const [priority, transforms] of transformGroups) {
      let groupIteration = 0;
      
      while (groupIteration < maxIterations) {
        const groupDeltas: VEILDelta[] = [];
        
        for (const transform of transforms) {
          const newDeltas = transform.process(this.getReadonlyState());
          groupDeltas.push(...newDeltas);
        }
        
        if (groupDeltas.length === 0) break;
        
        const groupChanges = this.veilState.applyDeltasDirect(groupDeltas);
        this.currentFrame!.deltas.push(...groupDeltas);
        allDeltas.push(...groupDeltas);
        allChanges.push(...groupChanges);
        
        groupIteration++;
      }
      
      if (groupIteration === maxIterations) {
        console.warn(`Phase 2 priority group ${priority} exceeded maximum iterations (${maxIterations})`);
      }
    }
    
    return { deltas: allDeltas, changes: allChanges };
  }
  
  /**
   * PHASE 3: VEIL changes → Events (Effectors)
   */
  private async runPhase3(changes: FacetDelta[]): Promise<SpaceEvent[]> {
    const allEvents: SpaceEvent[] = [];
    const effectorGroups = groupByPriority(this.effectors);
    
    for (const [priority, effectors] of effectorGroups) {
      const groupEvents: SpaceEvent[] = [];
      
      for (const effector of effectors) {
        const relevantChanges = changes.filter(change => 
          this.matchesEffectorFilters(change.facet, effector.facetFilters || [])
        );
        if (relevantChanges.length === 0) continue;
        
        const result = await effector.process(relevantChanges, this.getReadonlyState());
        if (result.events) {
          groupEvents.push(...result.events);
        }
      }
      
      allEvents.push(...groupEvents);
    }
    
    return allEvents;
  }
  
  /**
   * PHASE 4: Maintenance
   */
  private async runPhase4(frame: Frame, changes: FacetDelta[]): Promise<{ events: SpaceEvent[]; deltas: VEILDelta[] }> {
    const allEvents: SpaceEvent[] = [];
    const allDeltas: VEILDelta[] = [];
    const maintainerGroups = groupByPriority(this.maintainers);
    
    for (const [priority, maintainers] of maintainerGroups) {
      const groupEvents: SpaceEvent[] = [];
      const groupDeltas: VEILDelta[] = [];
      
      for (const maintainer of maintainers) {
        const result = await maintainer.process(frame, changes, this.getReadonlyState());
        
        if (result.events) {
          groupEvents.push(...result.events);
        }
        if (result.deltas) {
          groupDeltas.push(...result.deltas);
        }
      }
      
      allDeltas.push(...groupDeltas);
      allEvents.push(...groupEvents);
    }
    
    return { events: allEvents, deltas: allDeltas };
  }
  
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
