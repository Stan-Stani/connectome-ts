/**
 * Component that integrates an AgentInterface with the Space/Element system
 */

import { VEILComponent } from '../components/base-components';
import { SpaceEvent, FrameEndEvent, AgentResponseEvent } from '../spaces/types';
import { AgentInterface, AgentCommand, AgentConfig } from './types';
import { Space } from '../spaces/space';
import { Facet, AgentLifecycleFacet, hasStateAspect } from '../veil/types';
import { persistable, persistent } from '../persistence/decorators';
import { reference, RestorableComponent } from '../host/decorators';
import { LLMProvider } from '../llm/llm-interface';
import { VEILStateManager } from '../veil/veil-state';
import { BasicAgent } from './basic-agent';

@persistable(1)
export class AgentComponent extends VEILComponent implements RestorableComponent {
  private agent?: AgentInterface;
  private agentRegistered = false;
  
  // Persist the agent configuration
  @persistent() private agentConfig?: AgentConfig;
  
  // References that will be injected by the Host
  @reference('veilState') private veilState?: VEILStateManager;
  @reference('llmProvider') private llmProvider?: LLMProvider;
  
  constructor(agentOrConfig?: AgentInterface | { agentConfig: AgentConfig }) {
    super();

    console.log('[AgentComponent] constructor called with:', agentOrConfig ? Object.keys(agentOrConfig) : 'undefined');

    // Handle both direct agent and config object (from declarative creation)
    if (agentOrConfig) {
      // Check if it's a config wrapper (from declarative component:add)
      if ('agentConfig' in agentOrConfig && !('runCycle' in agentOrConfig)) {
        // It's a config object, store the agent config
        this.agentConfig = (agentOrConfig as { agentConfig: AgentConfig }).agentConfig;
        console.log('[AgentComponent] Stored agentConfig:', this.agentConfig?.name);
      } else {
        // It's an actual agent object
        this.agent = agentOrConfig as AgentInterface;
        console.log('[AgentComponent] Stored agent directly');
        // Save agent config for restoration
        if ('config' in agentOrConfig) {
          this.agentConfig = (agentOrConfig as any).config;
        }
      }
    }
  }
  
  get agentInstance(): AgentInterface | undefined {
    return this.agent;
  }

  setAgent(agent: AgentInterface) {
    this.agent = agent;
    // Save agent config for restoration
    if ('config' in agent) {
      this.agentConfig = (agent as any).config;
    }
  }
  
  /**
   * Called by Host after all references are resolved
   */
  async onReferencesResolved(): Promise<void> {
    console.log(`[AgentComponent ${this.id}] onReferencesResolved - config: ${!!this.agentConfig}, agent: ${!!this.agent}, llm: ${!!this.llmProvider}, veil: ${!!this.veilState}`);

    // If we have config but no agent, recreate it
    if (this.agentConfig && !this.agent && this.llmProvider && this.veilState) {
      console.log('✨ Recreating agent from config:', this.agentConfig.name || 'unnamed');

      // Check if there's a custom agent factory registered
      const space = this.space;
      const agentFactory = (space as any)?.getReference?.('agentFactory');

      if (agentFactory && typeof agentFactory === 'function') {
        // Use custom factory
        this.agent = agentFactory(this.agentConfig, this.llmProvider, this.veilState);
        console.log('[AgentComponent] Created agent via custom factory');
      } else {
        // Default to BasicAgent
        this.agent = new BasicAgent(this.agentConfig, this.llmProvider, this.veilState);
        console.log('[AgentComponent] Created BasicAgent, has agent now:', !!this.agent);
      }

      // Re-enable auto action registration if it was enabled
      if ((this.agentConfig as any).autoActionRegistration) {
        (this.agent as BasicAgent).enableAutoActionRegistration();
      }
    } else {
      console.log('[AgentComponent] NOT creating agent. Reasons:', {
        hasConfig: !!this.agentConfig,
        hasAgent: !!this.agent,
        hasLLM: !!this.llmProvider,
        hasVeil: !!this.veilState
      });
    }

    // Agent registration will happen in onFirstFrame()
  }

  onMount(): void {
    // Subscribe to relevant events
    this.subscribe('frame:start');
    this.subscribe('frame:end');
    this.subscribe('agent:command');
    this.subscribe('agent:pending-activation');

    // Agent registration will happen on first frame:start
  }

  onFirstFrame(): void {
    // Register agent on first frame if we have everything we need
    if (!this.agentRegistered && this.agent && this.veilState) {
      this.registerAgent();
    }
  }
  
  onUnmount(): void {
    // Unregister agent from VEIL state
    if (this.veilState) {
      this.addOperation({
        type: 'addFacet',
        facet: this.createAgentLifecycleFacet('deregister')
      });
    }
  }
  
  private registerAgent(): void {
    if (this.agentRegistered) return;

    console.log(`[AgentComponent ${this.id}] Registering agent...`);
    const agentInfo = {
      id: this.id,
      name: this.agentConfig?.name || this.id || 'Agent',
      type: 'assistant',
      capabilities: ['chat', 'code', 'search'],
      metadata: {
        model: (this.agentConfig as any)?.modelName || 'unknown',
        provider: (this.agentConfig as any)?.provider || 'unknown'
      },
      createdAt: new Date().toISOString()
    };

    this.addOperation({
      type: 'addFacet',
      facet: this.createAgentLifecycleFacet('register', agentInfo)
    });

    this.agentRegistered = true;
  }

  async handleEvent(event: SpaceEvent): Promise<void> {
    // IMPORTANT: Call parent handleEvent to enable onFirstFrame() lifecycle
    await super.handleEvent(event);

    switch (event.topic) {
      case 'frame:start':
        // Register agent on first frame (agent might be created in onReferencesResolved)
        if (!this.agentRegistered && this.agent && this.veilState) {
          this.registerAgent();
        }
        break;

      case 'frame:end':
        if (this.agent) {
          await this.handleFrameEnd(event as FrameEndEvent);
        }
        break;

      case 'agent:command':
        if (this.agent) {
          this.handleAgentCommand(event.payload as AgentCommand);
        }
        break;
    }
  }
  
  private async handleFrameEnd(event: FrameEndEvent): Promise<void> {
    // Handle agent processing directly in the component
    const space = this.space;
    if (!space) return;
    
    const frame = space.getCurrentFrame();
    if (!frame || !event.payload.hasOperations) return;
    
    // Check if this agent should handle this frame - look for activation facets
    const activationOps = frame.deltas.filter((op: any) => 
      op.type === 'addFacet' && op.facet?.type === 'agent-activation'
    );
    if (activationOps.length === 0) return;

    // Check if any activation targets this agent (or no target specified)
    const shouldHandle = activationOps.some((op: any) => {
      const facet = op.facet as Facet | undefined;
      if (!facet || !hasStateAspect(facet)) {
        return false;
      }
      const activationState = facet.state as Record<string, any>;
      const targetAgent = activationState.targetAgent ?? activationState.targetAgentName;
      const targetAgentId = activationState.targetAgentId as string | undefined;
      
      // Check by ID first, then by name
      if (targetAgentId) {
        return targetAgentId === this.id;
      }
      
      // If no ID specified, check by name (either element name or agent name from config)
      const agentName = this.agentConfig?.name || this.id;
      return !targetAgent || targetAgent === this.id || targetAgent === agentName;
    });
    
    if (!shouldHandle) return;
    
    if (!this.agent) {
      console.warn('[AgentComponent] No agent set');
      return;
    }
    
    // Let the agent process the frame
    const veilState = space.getVEILStateManager();
    const response = await this.agent.onFrameComplete(frame, veilState.getState());
    
    // If agent generated a response, process it synchronously
    // This must happen within the current frame to maintain sequence order
    if (response && space) {
      // Extract rendered context if attached
      const renderedContext = (response as any).renderedContext;
      delete (response as any).renderedContext; // Clean up before passing
      
      // Extract raw completion if attached
      const rawCompletion = (response as any).rawCompletion;
      delete (response as any).rawCompletion; // Clean up before passing
      
      // Emit agent:frame-ready event with the response frame
      // This event is processed by downstream components (e.g., ActionEffector)
      this.emit({
        topic: 'agent:frame-ready',
        payload: {
          frame: response,
          agentId: this.id,
          agentName: this.agentConfig?.name || this.id,
          renderedContext, // Include rendered context for debug
          rawCompletion // Include raw completion for debug
        },
        priority: 'immediate',
        timestamp: Date.now()
      });
    }
  }

  private createAgentLifecycleFacet(
    operation: AgentLifecycleFacet['state']['operation'],
    agentInfo?: AgentLifecycleFacet['state']['agentInfo']
  ): AgentLifecycleFacet {
    return {
      id: `agent-lifecycle-${this.id || 'unknown'}-${Date.now()}`,
      type: 'agent-lifecycle',
      state: {
        operation,
        agentId: this.id || 'unknown',
        agentInfo
      },
      ephemeral: true
    };
  }

  private handleAgentCommand(command: AgentCommand): void {
    if (!this.agent) {
      console.warn('[AgentComponent] No agent set');
      return;
    }
    
    this.agent.handleCommand(command);
    
    // Log state changes
    const state = this.agent.getState();
    console.log('[Agent] State updated:', {
      sleeping: state.sleeping,
      ignoringSources: Array.from(state.ignoringSources),
      attentionThreshold: state.attentionThreshold
    });
    
    // If waking up, check for activation facets in state
    if (command.type === 'wake') {
      // Activation facets persist in state, so we just need to trigger processing
      this.emit({
        topic: 'agent:wake',
        payload: {},
        timestamp: Date.now()
      });
    }
  }
  
}
