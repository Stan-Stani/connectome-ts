/**
 * AgentEffector - Processes agent activations and rendered contexts to produce responses
 *
 * FLEX Component (priority 300) that watches for agent-activation and rendered-context
 * facets, then runs the agent to produce speech/action/thought facets.
 */

import { Component } from '../spaces/component';
import { ExecutionContext } from '../spaces/types';
import {
  FacetDelta,
  ReadonlyVEILState,
  FacetFilter,
  ExternalAction
} from '../spaces/receptor-effector-types';
import {
  Facet,
  StreamRef,
  hasAgentGeneratedAspect,
  hasContentAspect,
  hasStateAspect,
  hasStreamAspect
} from '../veil/types';
import { SpaceEvent } from '../spaces/types';
import { AgentInterface, AgentState, AgentCommand } from './types';
import { AgentComponent } from './agent-component';
import { LLMProvider } from '../llm/llm-interface';
import { getGlobalTracer, TraceStorage } from '../tracing';
import { RenderedContext } from '../hud/types-v2';

export class AgentEffector extends Component {
  // FLEX priority: Effector level (300)
  priority = 300;

  // Watch for activation facets AND their rendered contexts
  facetFilters: FacetFilter[] = [
    { type: 'agent-activation' },
    { type: 'rendered-context' }
  ];

  private agent?: AgentInterface;
  private processingActivations = new Set<string>();
  private tracer?: TraceStorage;
  private cachedAgentId?: string;

  onMount(): void {
    this.tracer = getGlobalTracer();
    // Agent lookup is lazy - happens in execute() when first needed
  }

  /**
   * FLEX execute method - processes frame context for agent activations
   */
  execute(context: ExecutionContext): void {
    const { state, frame } = context;

    // Build changes from frame deltas
    const changes: FacetDelta[] = [];
    if (frame && frame.deltas) {
      for (const delta of frame.deltas) {
        if (delta.type === 'addFacet') {
          changes.push({ type: 'added', facet: delta.facet });
        }
      }
    }

    if (changes.length === 0) return;

    // Process asynchronously (fire and forget for effector pattern)
    this.processChanges(changes, state);
  }

  /**
   * Process facet changes - look for activations with rendered contexts
   */
  private async processChanges(changes: FacetDelta[], state: ReadonlyVEILState): Promise<void> {
    const events: any[] = [];
    const externalActions: ExternalAction[] = [];

    // Lazy agent lookup
    this.findAgent();

    if (!this.agent) {
      return;
    }

    // Check for new activations that have rendered contexts
    for (const change of changes) {
      if (change.type !== 'added') continue;

      if (change.facet.type === 'agent-activation') {
        const activationId = change.facet.id;
        const activationState = hasStateAspect(change.facet)
          ? (change.facet.state as Record<string, any>)
          : {};

        if (this.processingActivations.has(activationId)) continue;

        const targetAgentId = activationState.targetAgentId as string | undefined;
        const isTargeted = !targetAgentId || targetAgentId === this.getAgentId();
        if (!isTargeted) continue;

        const flattenedActivation = {
          ...activationState,
          ...(activationState.metadata || {})
        };

        const veilState = state as any;
        if (!this.agent.shouldActivate(flattenedActivation, veilState)) {
          continue;
        }

        const contextFacet = Array.from(state.facets.values()).find(f =>
          f.type === 'rendered-context' &&
          hasStateAspect(f) &&
          (f.state as Record<string, any>).activationId === activationId
        );

        if (!contextFacet || !hasStateAspect(contextFacet)) {
          continue;
        }

        this.processingActivations.add(activationId);

        const streamRef = flattenedActivation.streamRef as StreamRef | undefined;
        const streamId = streamRef?.streamId ?? (flattenedActivation.streamId as string | undefined) ?? 'default';

        const contextState = contextFacet.state as { context: RenderedContext };
        const context = contextState.context;

        this.runAgentCycleBackground(context, streamRef, activationId, streamId);
      }
    }
  }

  private findAgent(): void {
    if (this.agent) return;

    // Config properties are set via Object.assign, read them directly
    const space = this.space;
    const agentElementId = (this as any).agentElementId;

    if (!space) return;

    // Strategy 1: Look up by ID if provided
    if (agentElementId) {
      // Try exact match
      let comp = space.getComponentById(agentElementId);
      
      // Try "ID:AgentComponent" suffix convention
      if (!comp) {
        comp = space.getComponentById(`${agentElementId}:AgentComponent`);
      }
      
      if (comp instanceof AgentComponent) {
        this.agent = comp.agentInstance;
        if (this.agent) {
           console.log(`[AgentEffector] Found agent via ID ${agentElementId}`);
           return;
        }
      }
    }

    // Strategy 2: Search for any AgentComponent in the space
    const agentComponents = space.getComponents(AgentComponent);
    if (agentComponents.length > 0) {
       // Use the first component with an agent instance
       for (const comp of agentComponents) {
         if (comp.agentInstance) {
           this.agent = comp.agentInstance;
           console.log(`[AgentEffector] Found agent via type scan: ${comp.id}`);
           return;
         }
       }
    }

    // Strategy 3: Fallback to predefined IDs for Discord App compatibility
    const fallbackIds = ['discord-agent', 'discord-agent:AgentComponent', 'agent', 'agent:AgentComponent'];
    for (const id of fallbackIds) {
      const comp = space.getComponentById(id);
      if (comp instanceof AgentComponent && comp.agentInstance) {
        this.agent = comp.agentInstance;
        console.log(`[AgentEffector] Found agent via fallback ID ${id}`);
        return;
      }
    }
  }
  
  /**
   * Runs the agent cycle in the background (fire-and-forget).
   * Emits response events when complete, allowing the current frame to finish immediately.
   */
  private runAgentCycleBackground(
    context: RenderedContext,
    streamRef: StreamRef | undefined,
    activationId: string,
    streamId: string
  ): void {
    // Run asynchronously, don't await
    (async () => {
      try {
        console.log(`[AgentEffector] Running agent cycle for activation ${activationId}...`);
        
        // Run the agent cycle
        const response = await this.runAgentCycle(
          context,
          streamRef,
          activationId
        );

        console.log(`[AgentEffector] Agent cycle completed with ${response.facets.length} facets and ${response.events.length} events`);

        // Emit events first (they may trigger actions)
        for (const event of response.events) {
          console.log(`[AgentEffector] Emitting agent event: ${event.topic}`);
          this.emit(event);
        }

        // Then emit facets for response
        for (const facet of response.facets) {
          console.log(`[AgentEffector] Emitting facet via veil:operation: ${facet.type} (${facet.id})`);
          this.emit({
            topic: 'veil:operation',
            timestamp: Date.now(),
            payload: {
              operation: {
                type: 'addFacet',
                facet
              }
            }
          });
        }

        console.log(`[AgentEffector] All ${response.facets.length} facets and ${response.events.length} events emitted`);

      } catch (error) {
        console.error('[AgentEffector] Agent cycle error:', error);

        // Emit error event
        this.emit({
          topic: 'veil:operation',
          timestamp: Date.now(),
          payload: {
            operation: {
              type: 'addFacet',
              facet: {
                id: `agent-error-${Date.now()}`,
                type: 'event',
                content: String(error),
                state: {
                  source: this.getAgentId(),
                  eventType: 'agent-cycle-error',
                  metadata: {
                    activationId
                  }
                },
                streamId: streamId
              }
            }
          }
        });
      } finally {
        this.processingActivations.delete(activationId);
      }
    })();
  }

  private async runAgentCycle(
    context: RenderedContext,
    streamRef?: StreamRef,
    activationId?: string
  ): Promise<{ facets: Facet[]; events: SpaceEvent[] }> {
    const facets: Facet[] = [];
    
    // Guard against missing agent
    if (!this.agent) {
      console.error('[AgentEffector] Agent not available for runCycle');
      return { facets: [], events: [] };
    }
    
    console.log(`[AgentEffector.runAgentCycle] Calling agent.runCycle() with ${context.messages.length} messages...`);
    
    // Run the agent's cycle with the full context
    const outgoingFrame = await this.agent.runCycle(context, streamRef);
    
    console.log(`[AgentEffector.runAgentCycle] Agent returned frame with ${outgoingFrame.deltas.length} operations and ${outgoingFrame.events?.length || 0} events`);
    
    // Convert agent operations to facets
    for (const operation of outgoingFrame.deltas) {
      if (operation.type === 'addFacet') {
        const preparedFacet = this.prepareAgentFacet(operation.facet, streamRef);
        facets.push(preparedFacet);
        console.log(`[AgentEffector.runAgentCycle] Prepared facet: ${preparedFacet.type} (${preparedFacet.id})`);
      }
    }

    console.log(`[AgentEffector.runAgentCycle] Returning ${facets.length} facets and ${outgoingFrame.events?.length || 0} events`);
    return { facets, events: outgoingFrame.events || [] };
  }
  
  private parseContextMetadata(content: string): { tokenCount?: number; totalTokens?: number } {
    // Look for metadata in comments at the end of context
    const metadataMatch = content.match(/<!-- Metadata: (\{[^}]+\}) -->/);
    if (metadataMatch) {
      try {
        return JSON.parse(metadataMatch[1]);
      } catch {
        // Ignore parse errors
      }
    }
    return {};
  }

  private prepareAgentFacet(facet: Facet, streamRef?: StreamRef): Facet {
    const prepared = { ...facet } as Facet;

    if (hasAgentGeneratedAspect(prepared) && !prepared.agentId) {
      prepared.agentId = this.getAgentId();
    }

    if ((prepared.type === 'speech' || prepared.type === 'thought' || prepared.type === 'action') && !hasAgentGeneratedAspect(prepared)) {
      (prepared as Facet & { agentId: string }).agentId = this.getAgentId();
      if (streamRef?.streamId) {
        (prepared as Facet & { streamId: string }).streamId = streamRef.streamId;
      }
    }

    if (streamRef?.streamId && hasStreamAspect(prepared)) {
      prepared.streamId = prepared.streamId || streamRef.streamId;
    }

    if (prepared.type === 'speech' || prepared.type === 'thought') {
      if (!hasContentAspect(prepared)) {
        (prepared as Facet & { content: string }).content = '';
      }
      if (!prepared.streamId && streamRef?.streamId) {
        (prepared as Facet & { streamId: string }).streamId = streamRef.streamId;
      }
    }

    if (prepared.type === 'action' && hasStateAspect(prepared) && streamRef?.streamId) {
      prepared.streamId = prepared.streamId || streamRef.streamId;
    }

    return prepared;
  }

  private getAgentId(): string {
    // Use the component's ID as the agent ID for consistency
    return this.id;
  }
  
  // Handle agent commands via facets
  handleCommand(command: AgentCommand): void {
    if (this.agent) {
      this.agent.handleCommand(command);
    }
  }
  
  getState(): AgentState {
    if (!this.agent) {
      return { sleeping: false, ignoringSources: new Set(), attentionThreshold: 0 };
    }
    return this.agent.getState();
  }
}
