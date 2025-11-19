import { ComponentLifecycle, EventHandler, SpaceEvent, ElementRef } from './types';
import type { Space } from './space';
import type { VEILDelta } from '../veil/types';
import {
  createAmbientFacet,
  createStateFacet,
  createEventFacet
} from '../helpers/factories';

/**
 * Base component class
 * Similar to Unity's MonoBehaviour
 */
export abstract class Component implements ComponentLifecycle, EventHandler {
  /**
   * Direct reference to Space
   */
  space!: Space;

  /**
   * Component ID
   */
  id!: string;

  /**
   * Whether this component is enabled
   */
  private _enabled: boolean = true;
  
  /**
   * Track if we've seen the first frame
   */
  private _firstFrameSeen: boolean = false;

  /**
   * Topic subscriptions
   */
  private _subscriptions: string[] = [];

  get enabled(): boolean {
    return this._enabled;
  }
  
  set enabled(value: boolean) {
    if (this._enabled === value) return;
    
    this._enabled = value;
    if (value) {
      this.onEnable?.();
    } else {
      this.onDisable?.();
    }
  }
  
  /**
   * Called when component is first created (either new or from persistence)
   * Use for basic initialization that doesn't require external resources
   */
  onInit(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is being restored from persistence
   * Use for restoration-specific setup
   */
  onRestore(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is attached to space and ready for operation
   * Use for connecting to external services, starting operations
   */
  onMount(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is removed from space
   */
  onUnmount(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is enabled
   */
  onEnable(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is disabled
   */
  onDisable(): void {
    // Override in subclasses
  }
  
  /**
   * Handle events that reach this component
   * Override to process specific events
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    // Check for first frame
    if (!this._firstFrameSeen && event.topic === 'frame:start') {
      this._firstFrameSeen = true;
      if (this.onFirstFrame) {
        await this.onFirstFrame();
      }
    }
  }
  
  /**
   * Called on the first frame after mounting
   * Override to initialize facets, state, etc.
   */
  onFirstFrame?(): void | Promise<void>;
  
  /**
   * Get a reference from the host registry with helpful errors
   */
  protected requireReference<T>(id: string): T {
    if (!this.space) {
      throw new Error(`Component ${this.constructor.name} not mounted - cannot access references`);
    }
    
    const value = this.space.getReference(id);
    if (!value) {
      const available = this.space.listReferences();
      throw new Error(
        `Required reference '${id}' not found for ${this.constructor.name}.\n` +
        `Available references: ${available.join(', ')}\n` +
        `Hint: Ensure the reference is registered before component initialization.`
      );
    }
    
    return value as T;
  }
  
  /**
   * Get an optional reference
   */
  protected getReference<T>(id: string): T | undefined {
    return this.space?.getReference(id) as T | undefined;
  }
  
  /**
   * Internal method to attach to Space
   * Returns a promise if the component has async initialization
   */
  async _attach(space: Space, id: string, isRestoring: boolean = false): Promise<void> {
    this.space = space;
    this.id = id;
    
    // Always call onInit first
    const initResult = this.onInit();
    if (initResult !== undefined && initResult !== null && typeof (initResult as any).then === 'function') {
      await initResult;
    }
    
    // If restoring, call onRestore but delay onMount
    if (isRestoring) {
      const restoreResult = this.onRestore();
      if (restoreResult !== undefined && restoreResult !== null && typeof (restoreResult as any).then === 'function') {
        await restoreResult;
      }
      // Don't call onMount yet - wait for external services
    } else {
      // For new components, call onMount immediately
      const mountResult = this.onMount();
      if (mountResult !== undefined && mountResult !== null && typeof (mountResult as any).then === 'function') {
        await mountResult;
      }
    }
    
    if (this._enabled) {
      this.onEnable();
    }
    
    // Auto-register RETM components with Space
    if (space && 'addReceptor' in space) { 
      const { isReceptor, isEffector, isTransform, isMaintainer } = require('../utils/retm-type-guards');
      
      if (isReceptor(this)) {
        console.log(`[Component._attach] Auto-registering receptor: ${this.constructor.name}`);
        (space as any).addReceptor(this);
      }
      if (isEffector(this)) {
        console.log(`[Component._attach] Auto-registering effector: ${this.constructor.name}`);
        (space as any).addEffector(this);
      }
      if (isTransform(this)) {
        console.log(`[Component._attach] Auto-registering transform: ${this.constructor.name}`);
        (space as any).addTransform(this);
      }
      if (isMaintainer(this)) {
        console.log(`[Component._attach] Auto-registering maintainer: ${this.constructor.name}`);
        (space as any).addMaintainer(this);
      }
    }
  }
  
  /**
   * Complete mounting after restoration when external services are ready
   */
  async _completeMount(): Promise<void> {
    const mountResult = this.onMount();
    if (mountResult !== undefined && mountResult !== null && typeof (mountResult as any).then === 'function') {
      await mountResult;
    }
  }
  
  /**
   * Internal method to detach
   */
  _detach(): void {
    if (this._enabled) {
      this.onDisable();
    }
    this.onUnmount();
  }
  
  // ========== Convenience Methods ==========
  
  /**
   * Emit an event from the component
   */
  protected emit(event: Omit<SpaceEvent, 'source' | 'timestamp'> & { timestamp?: number }): void {
    this.space.emit({
      ...event,
      source: this.getRef(),
      timestamp: event.timestamp || Date.now()
    });
  }
  
  /**
   * Subscribe to event topics
   */
  protected subscribe(topicPattern: string): void {
    this._subscriptions.push(topicPattern);
  }

  /**
   * Check if this component is subscribed to a topic
   */
  isSubscribedTo(topic: string): boolean {
    return this._subscriptions.some(pattern => {
      if (pattern === '*') return true;
      if (pattern === topic) return true;
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        return topic.startsWith(prefix);
      }
      return false;
    });
  }
  
  /**
   * Get the component's ID (alias for id property for compatibility)
   */
  protected get elementId(): string {
    return this.id;
  }
  
  /**
   * Get a reference to this component (shimmed as ElementRef)
   */
  protected getRef(): ElementRef {
    return {
      elementId: this.id,
      elementPath: ['root', this.id],
      elementType: this.constructor.name
    };
  }

  // ============================================
  // Component State Management (VEIL-based)
  // ============================================

  /**
   * Get this component's unique ID for state scoping
   */
  protected getComponentId(): string {
    return this.id;
  }

  /**
   * Get this component's state from VEIL
   * Returns empty object if state facet doesn't exist yet
   */
  protected getComponentState<T = Record<string, any>>(): T {
    if (!this.space || !(this.space as any).getVEILState) {
      return {} as T;
    }
    
    const veilState = (this.space as any).getVEILState().getState();
    const componentId = this.getComponentId();
    // Phase 1 used "component-state:elementId:Type:Index"
    // Now we just use "component-state:componentId"
    const stateFacet = veilState.facets.get(`component-state:${componentId}`);
    
    return (stateFacet?.state || {}) as T;
  }

  /**
   * Update this component's state in VEIL
   * 
   * For VEILComponents (Phase 1/2): Uses addOperation() - applies via normal flow
   * For Effectors/Maintainers (Phase 3/4): Directly modifies VEIL (side effect!) via Space hook
   * For Afferents: Must emit event, use runtime cache
   * 
   * @param updates - Partial state updates (deep merged)
   */
  protected updateComponentState(updates: Record<string, any>): void {
    const componentId = this.getComponentId();
    const currentState = this.getComponentState();
    
    const delta = {
      type: 'rewriteFacet' as const,
      id: `component-state:${componentId}`,
      changes: {
        state: { ...currentState, ...updates }
      }
    };
    
    // Try to apply as scoped write (for Effectors/Maintainers in their phase)
    const space = this.space as any;
    if (space && space._applyComponentStateDelta) {
      // Direct application during Phase 3/4
      space._applyComponentStateDelta(delta, componentId);
    } else {
      // Fallback to normal addOperation (for VEILComponents)
      this.addOperation(delta);
    }
  }

  /**
   * Replace entire component state
   */
  protected setComponentState<T = Record<string, any>>(state: T): void {
    const componentId = this.getComponentId();
    
    this.addOperation({
      type: 'rewriteFacet',
      id: `component-state:${componentId}`,
      changes: {
        state
      }
    });
  }

  /**
   * Add a VEIL operation to the current frame
   * This is the primary way components interact with VEIL state
   */
  protected addOperation(operation: VEILDelta): void {
    if (!this.space) {
      throw new Error(
        `[${this.constructor.name}] Cannot add operation - component not attached to space`
      );
    }
    
    const frame = (this.space as any).getCurrentFrame ? (this.space as any).getCurrentFrame() : undefined;
    if (!frame) {
      throw new Error(
        `[${this.constructor.name}] VEIL operations are only allowed during frame processing. ` +
        `Move this operation from onMount() to onFirstFrame() or an event handler.`
      );
    }
    
    frame.deltas.push(operation);
  }

  // ============================================
  // Helper methods for common operations
  // ============================================

  /**
   * Adds an ambient facet with optional ID
   * @param content - The facet content
   * @param idOrAttributes - Either a string ID or attributes object
   * @param attributes - Attributes if second param was an ID
   */
  protected addAmbient(
    content: string, 
    idOrAttributes?: string | Record<string, any>,
    attributes?: Record<string, any>
  ): void {
    let id: string;
    let attrs: Record<string, any>;
    
    if (typeof idOrAttributes === 'string') {
      id = idOrAttributes;
      attrs = attributes || {};
    } else {
      // Simple counter-based ID generation
      id = `${this.id}-ambient-${Date.now()}`;
      attrs = idOrAttributes || {};
    }
    
    const { streamId = `${this.id}:ambient`, streamType, ...metadata } = attrs;

    this.addOperation({
      type: 'addFacet',
      facet: createAmbientFacet({
        id,
        content,
        streamId,
        streamType
      })
    });
    if (Object.keys(metadata).length > 0) {
      this.addOperation({
        type: 'addFacet',
        facet: createEventFacet({
          id: `${id}-meta`,
          content: `metadata:${JSON.stringify(metadata)}`,
          source: this.id,
          eventType: 'ambient-metadata',
          metadata,
          streamId,
          streamType
        })
      });
    }
  }

  /**
   * Adds a state facet
   * @param id - The facet ID (will be prefixed with component ID)
   * @param content - The facet content  
   * @param attributes - Optional attributes
   */
  protected addState(id: string, content: string, attributes: Record<string, any> = {}): void {
    const facetId = `${this.id}-${id}`;
    this.addOperation({
      type: 'addFacet',
      facet: createStateFacet({
        id: facetId,
        content,
        entityType: 'component',
        entityId: this.id,
        state: attributes,
        scopes: []
      })
    });
  }

  /**
   * Changes/updates an existing state facet
   * @param id - The facet ID (without component prefix)
   * @param updates - Content and/or attributes to update
   */
  protected changeState(
    id: string, 
    changes: { content?: string; attributes?: Record<string, any> }
  ): void {
    const facetId = `${this.id}-${id}`;
    const delta: any = {};
    if (changes.content !== undefined) {
      delta.content = changes.content;
    }
    if (changes.attributes) {
      delta.state = changes.attributes;
    }
    this.addOperation({
      type: 'rewriteFacet',
      id: facetId,
      changes: delta
    });
  }

  /**
   * @deprecated Use changeState() instead - renamed for consistency with VEIL operations
   */
  protected updateState(
    id: string, 
    changes: { content?: string; attributes?: Record<string, any> }
  ): void {
    console.warn('updateState() is deprecated. Use changeState() for consistency with VEIL operations.');
    this.changeState(id, changes);
  }

  /**
   * Adds an event facet with proper structure
   * @param content - The event content
   * @param eventType - Optional event subtype
   * @param idOrAttributes - Either a string ID or attributes object
   * @param attributes - Attributes if third param was an ID
   */
  protected addEvent(
    content: string, 
    eventType?: string,
    idOrAttributes?: string | Record<string, any>,
    attributes?: Record<string, any>
  ): void {
    let id: string;
    let attrs: Record<string, any>;
    
    if (typeof idOrAttributes === 'string') {
      id = idOrAttributes;
      attrs = attributes || {};
    } else {
      // Simple timestamp-based ID
      id = `${this.id}-event-${Date.now()}`;
      attrs = idOrAttributes || {};
    }
    
    const { source = this.id, streamId: streamIdAttr, streamType: streamTypeAttr, ...metadata } = attrs;
    const streamId = typeof streamIdAttr === 'string' ? streamIdAttr : 'default';
    const streamType = typeof streamTypeAttr === 'string' ? streamTypeAttr : undefined;

    const facet = createEventFacet({
      id,
      content,
      source,
      eventType: eventType || 'event',
      metadata: Object.keys(metadata).length ? metadata : undefined,
      streamId,
      streamType
    });
    this.addOperation({ type: 'addFacet', facet });
  }

  /**
   * Checks if we're currently in a frame (safe to add operations)
   */
  protected inFrame(): boolean {
    return (this.space as any)?.isProcessingFrame || false;
  }

  /**
   * Requires that we're in a frame, throws descriptive error if not
   */
  protected requireFrame(): void {
    if (!this.inFrame()) {
      throw new Error(
        `[${this.constructor.name}] This operation requires an active frame. ` +
        `Make sure you're calling this during frame processing or from an event handler. ` +
        `Current frame state: ${this.space ? 'Space exists but not in frame' : 'No space found'}. ` +
        `If you need to defer operations, use this.space.requestFrame().`
      );
    }
  }

  /**
   * Helper to safely get current VEIL state
   */
  protected getVeilState() {
    return (this.space as any)?.veilState?.getState() || null;
  }

  /**
   * Defers an operation until the next frame
   * Useful for operations that need to happen outside of current frame
   * 
   * @param operation - Function to execute in next frame
   */
  protected deferToNextFrame(operation: () => void): void {
    if (!this.space) {
      throw new Error(`[${this.constructor.name}] Cannot defer operation - no space found`);
    }
    
    this.space.once('frame:start', () => {
      operation();
    });
    (this.space as any).requestFrame();
  }

  // ============================================
  // Convenience Helpers for Facet Creation
  // ============================================

  /**
   * Emit a facet via veil:operation event
   * For Effectors/Maintainers/Afferents that can't directly add to frame
   */
  protected emitFacet(facet: import('../veil/types').Facet): void {
    this.emit({
      topic: 'veil:operation',
      payload: {
        operation: {
          type: 'addFacet',
          facet
        }
      }
    });
  }

  /**
   * Emit an agent activation (convenience)
   */
  protected activateAgent(reason: string, options?: {
    priority?: 'low' | 'normal' | 'high' | 'critical';
    source?: string;
    streamRef?: any;
  }): void {
    const { createAgentActivation } = require('../helpers/factories');
    this.emitFacet(createAgentActivation(reason, {
      source: options?.source || this.id,
      priority: options?.priority || 'normal',
      streamRef: options?.streamRef
    }));
  }

  /**
   * Emit an event facet (convenience)
   */
  protected emitEventFacet(content: string, options?: {
    eventType?: string;
    metadata?: any;
  }): void {
    const { createEventFacet } = require('../helpers/factories');
    this.emitFacet(createEventFacet({
      id: `${this.id}-event-${Date.now()}`,
      content,
      source: this.id,
      eventType: options?.eventType || 'event',
      metadata: options?.metadata,
      streamId: 'default'
    }));
  }
}

/**
 * Base component for producing VEIL operations
 */
export abstract class VEILComponent extends Component {
  // Track previous values for change detection
  private _previousValues: Map<string, any> = new Map();
  
  protected _deferredOperations?: VEILDelta[];
  
  /**
   * Add an operation to the current frame
   */
  protected addOperation(operation: VEILDelta): void {
    // Validate operation type
    const validOperations = ['addFacet', 'rewriteFacet', 'removeFacet'];
    if (!validOperations.includes(operation.type)) {
      console.warn(`[Component] Warning: Unsupported VEIL delta "${operation.type}". Expected one of: ${validOperations.join(', ')}`);
      return;
    }
    
    if (!this.space) {
      // Component not yet attached to space - defer operation
      if (!this._deferredOperations) {
        this._deferredOperations = [];
      }
      this._deferredOperations.push(operation);
      return;
    }
    
    const frame = (this.space as any).getCurrentFrame ? (this.space as any).getCurrentFrame() : undefined;
    if (!frame) {
      throw new Error(
        `VEIL operations are only allowed during frame processing. ` +
        `Move this operation to an event handler or use deferred operations. ` +
        `Component: ${this.constructor.name}, Operation: ${operation.type}`
      );
    }
    
    frame.deltas.push(operation);
  }
  
  /**
   * Process any deferred operations when element is added to space
   */
  protected processDeferredOperations(): void {
    if (this._deferredOperations && this.space) {
      const frame = (this.space as any).getCurrentFrame ? (this.space as any).getCurrentFrame() : undefined;
      console.log(`[VEILComponent.processDeferredOperations] frame exists: ${!!frame}, operations: ${this._deferredOperations.length}`);
      if (frame) {
        for (const op of this._deferredOperations) {
          const opInfo = op.type === 'addFacet' ? `${op.type} ${(op as any).facet?.id}` : op.type;
          console.log(`[VEILComponent.processDeferredOperations] Adding to frame:`, opInfo);
          frame.deltas.push(op);
        }
      }
      this._deferredOperations = undefined;
    }
  }
  
  // Add a facet to the current frame (inherited implementation logic)
  // ... (keeping the rest of addFacet similar to before but using this.id instead of element.id)
  protected addFacet(facetDef: any): void {
      // ... implementation details ...
      // Using logic from previous addFacet but replacing element.id with this.id
      const agentId = facetDef.agentId ?? (facetDef.attributes?.agentId as string) ?? this.id ?? 'unknown-agent';
      const entityId = (facetDef.attributes?.entityId as string) ?? facetDef.entityId ?? this.id ?? 'unknown-entity';
      
      // ... (simplified implementation since I'm rewriting)
      super.addFacet(facetDef); // Actually Component doesn't have addFacet exposed publicly, but it calls addOperation
  }
}

// Re-implement VEILComponent properly (I truncated it above, need to be careful)
// Actually, Component has addOperation now. VEILComponent extends Component and overrides addOperation to support deferral.

// Let's rewrite the file with FULL content to be safe.
// I need to verify if InteractiveComponent and StateComponent are also in this file. Yes they are.

