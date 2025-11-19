/**
 * AgentEffector - Processes agent activations and rendered contexts to produce responses
 * 
 * This replaces AgentComponent in the new Receptor/Effector architecture.
 * It watches for both agentActivation facets and their corresponding 
 * rendered-context facets, then runs the agent to produce speech/action/thought facets.
 */

import { BaseEffector } from '../components/base-martem';
import { 
  Effector, 
  FacetDelta, 
  ReadonlyVEILState, 
  EffectorResult,
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
import { Element } from '../spaces/element';

export class AgentEffector extends BaseEffector {
  // Watch for activation facets AND their rendered contexts
  facetFilters: FacetFilter[] = [
    { type: 'agent-activation' },
    { type: 'rendered-context' }
  ];

  private agent?: AgentInterface;
  private processingActivations = new Set<string>();
  private tracer?: TraceStorage;
  private cachedAgentId?: string;

  async onMount(): Promise<void> {
    this.tracer = getGlobalTracer();
    // Agent lookup is lazy - happens in process() when first needed
  }

  private findAgent(): void {
    if (this.agent) return; // Already found

    // Config properties are set via Object.assign, read them directly
    const space = this.element?.findSpace();
    const agentElementId = (this as any).agentElementId;

    console.log(`[AgentEffector.findAgent] Looking for agent with ID: ${agentElementId}`);
    console.log(`[AgentEffector.findAgent] Space children:`, space?.children.map(c => `${c.name}(${c.id})`));

    if (agentElementId && space) {
      const agentElement = space.children.find(c => c.id === agentElementId);
      console.log(`[AgentEffector.findAgent] Found element by ID ${agentElementId}:`, !!agentElement);
      if (agentElement) {
        const agentComponents = agentElement.getComponents(AgentComponent);
        console.log(`[AgentEffector.findAgent] AgentComponents found:`, agentComponents.length);
        const agentComponent = agentComponents[0];
        if (agentComponent) {
          console.log(`[AgentEffector.findAgent] AgentComponent has agent:`, !!(agentComponent as any)?.agent);
        }
        this.agent = (agentComponent as any)?.agent;
        if (this.agent) {
          console.log(`[AgentEffector] Found agent in element ${agentElementId}`);
        }
      }
    }

    if (!this.agent) {
      // Try 'discord-agent' first, then 'agent' as ultimate fallback
      let agentElement = space?.children.find(c => c.name === 'discord-agent');
      console.log(`[AgentEffector.findAgent] Fallback: Found element by name 'discord-agent':`, !!agentElement);
      
      if (!agentElement) {
        agentElement = space?.children.find(c => c.name === 'agent');
        console.log(`[AgentEffector.findAgent] Fallback: Found element by name 'agent':`, !!agentElement);
      }
      if (agentElement) {
        const agentComponent = agentElement.getComponents(AgentComponent)[0];
        console.log(`[AgentEffector.findAgent] Fallback: AgentComponent found:`, !!agentComponent);
        if (agentComponent) {
          console.log(`[AgentEffector.findAgent] Fallback: AgentComponent has agent:`, !!(agentComponent as any)?.agent);
        }
        this.agent = (agentComponent as any)?.agent;
        if (this.agent) {
          console.log(`[AgentEffector] Found agent in element with name 'agent'`);
        }
      }
    }

    // FLEX Phase 1: Check direct component registry as last resort
    if (!this.agent && space && (space as any).getComponentById) {
      // Try predefined ID from DiscordApp
      const directComponent = (space as any).getComponentById('discord-agent:AgentComponent');
      if (directComponent) {
         console.log(`[AgentEffector.findAgent] Found direct component by ID 'discord-agent:AgentComponent'`);
         this.agent = (directComponent as any).agent;
      }
    }

    if (!this.agent) {
      console.log('[AgentEffector.findAgent] FAILED to find agent anywhere');
    }
  }
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    const externalActions: ExternalAction[] = [];

    // Lazy agent lookup - find it the first time we need it
    this.findAgent();

    // Skip if agent not initialized yet
    if (!this.agent) {
      console.log("[AgentEffector] skipping because no agent");
      return { events, externalActions };
    }
    
    // Check for new activations that have rendered contexts
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      if (change.facet.type === 'agent-activation') {
        console.log("[AgentEffector] pondering an agent-activation facet");

        const activationId = change.facet.id;
        const activationState = hasStateAspect(change.facet)
          ? (change.facet.state as Record<string, any>)
          : {};

        // Skip if already processing
        if (this.processingActivations.has(activationId)) continue;

        // Check if this activation targets this agent
        const targetAgentId = activationState.targetAgentId as string | undefined;
        const agentState = this.agent.getState();

        // Basic targeting logic (can be enhanced)
        const isTargeted = !targetAgentId || targetAgentId === this.getAgentId();
        if (!isTargeted) continue;

        // Flatten metadata into activation state for shouldActivate compatibility
        // createAgentActivation nests extra fields under metadata, but shouldActivate expects them at top level
        const flattenedActivation = {
          ...activationState,
          ...(activationState.metadata || {})
        };

        // Check if agent should activate
        // Convert ReadonlyVEILState to VEILState for legacy agent interface
        const veilState = state as any;
        if (!this.agent.shouldActivate(flattenedActivation, veilState)) {
          continue;
        }

        // Look for corresponding rendered context
        const contextFacet = Array.from(state.facets.values()).find(f => 
          f.type === 'rendered-context' &&
          hasStateAspect(f) &&
          (f.state as Record<string, any>).activationId === activationId
        );

        if (!contextFacet || !hasStateAspect(contextFacet)) {
          // No context yet, will process in next frame
          continue;
        }

        // Mark as processing
        this.processingActivations.add(activationId);

        // Use flattened activation for streamRef/streamId access (may be in metadata)
        const streamRef = flattenedActivation.streamRef as StreamRef | undefined;
        const streamId = streamRef?.streamId ?? (flattenedActivation.streamId as string | undefined) ?? 'default';

        // Get the context from the state
        const contextState = contextFacet.state as { context: RenderedContext };
        const context = contextState.context;

        // Rendered context is in VEIL as rendered-context facet
        // Debug API reads it from there (no need to duplicate)

        // Start agent cycle in background (fire-and-forget)
        // This allows the frame to complete immediately, enabling other effectors
        // to react to the activation (e.g., sending typing indicators) before agent completes
        this.runAgentCycleBackground(
          context,
          streamRef,
          activationId,
          streamId
        );
      }
    }
    
    return {
      events,
      externalActions
    };
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
          this.element.emit(event);
        }

        // Then emit facets for response
        for (const facet of response.facets) {
          console.log(`[AgentEffector] Emitting facet via veil:operation: ${facet.type} (${facet.id})`);
          this.element.emit({
            topic: 'veil:operation',
            source: this.element.getRef(),
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
        this.element.emit({
          topic: 'veil:operation',
          source: this.element.getRef(),
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
    // Use the element's ID as the agent ID for consistency
    return this.element.id;
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
