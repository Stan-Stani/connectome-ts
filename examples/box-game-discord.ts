/**
 * Discord Box Game Application - Host Architecture Implementation
 *
 * This implements the ConnectomeApplication interface for the Discord Box Game,
 * enabling automatic persistence and restoration of game state.
 */

import { config } from 'dotenv';
config();

import { Space } from '../src/spaces/space';
import { Element } from '../src/spaces/element';
import { Component } from '../src/spaces/component';
import { VEILStateManager } from '../src/veil/veil-state';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { AgentEffector } from '../src/agent/agent-effector';
import { ContextTransform } from '../src/hud/context-transform';
import { LLMProvider } from '../src/llm/llm-interface';
import { AxonLoaderComponent } from '../src/components/axon-loader';
import { ComponentRegistry } from '../src/persistence/component-registry';
import { ConnectomeApplication } from '../src/host/types';
import {
  ReadonlyVEILState,
  FacetDelta,
  EffectorResult
} from '../src/spaces/receptor-effector-types';
import { BaseReceptor, BaseTransform, BaseEffector } from '../src/components/base-martem';
import { SpaceEvent } from '../src/spaces/types';
import { Facet, VEILDelta } from '../src/veil/types';
import {
  createEventFacet,
  createStateFacet,
  createAgentActivation,
  addFacet,
  changeFacet
} from '../src/helpers/factories';
import { ElementRequestReceptor, ElementTreeMaintainer, ElementTreeTransform } from '../src/spaces/element-tree-receptors';
import { AgentLifecycleTransform } from '../src/agent/agent-lifecycle-transform';

// ============================================================================
// DATA STRUCTURES
// ============================================================================

export interface BoxState {
  boxId: string;
  contents: string[];
  creator: string;
  isOpen: boolean;
  createdAt: number;
}

export interface BoxGameConfig {
  guildId: string;
  channelId: string;
  discordBotToken: string;
  llmProvider: LLMProvider;
}

// ============================================================================
// RECEPTORS (Events → Facets)
// ============================================================================

/**
 * DiscordSlashReceptor: Handle Discord slash command interactions
 */
export class DiscordSlashReceptor extends BaseReceptor {
  topics = ['discord:slash-command'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const payload = event.payload as any;

    const { commandName, options, user, channelId, interactionId } = payload;

    if (commandName === 'create-box') {
      const itemsOption = options?.find((o: any) => o.name === 'items');
      if (itemsOption) {
        const contents = itemsOption.value.split(',').map((item: string) => item.trim());
        deltas.push(addFacet({
          id: `game-action-create-${Date.now()}`,
          type: 'game-action',
          content: `${user} is creating a box with ${contents.length} items`,
          state: {
            action: 'create-box',
            params: { contents, actor: user },
            interactionId,
            channelId
          },
          ephemeral: true
        } as Facet));
      }
    } else if (commandName === 'open-box') {
      const boxIdOption = options?.find((o: any) => o.name === 'box-id');
      if (boxIdOption) {
        deltas.push(addFacet({
          id: `game-action-open-${boxIdOption.value}-${Date.now()}`,
          type: 'game-action',
          content: `${user} is opening box ${boxIdOption.value}`,
          state: {
            action: 'open-box',
            params: { boxId: boxIdOption.value, actor: user },
            interactionId,
            channelId
          },
          ephemeral: true
        } as Facet));
      }
    } else if (commandName === 'box-status') {
      deltas.push(addFacet({
        id: `game-action-status-${Date.now()}`,
        type: 'game-action',
        content: `${user} requested box status`,
        state: {
          action: 'show-status',
          params: { actor: user },
          interactionId,
          channelId
        },
        ephemeral: true
      } as Facet));
    } else if (commandName === 'box-start') {
      deltas.push(addFacet({
        id: `game-action-start-${Date.now()}`,
        type: 'game-action',
        content: `${user} started the box game`,
        state: {
          action: 'start-game',
          params: { actor: user },
          interactionId,
          channelId
        },
        ephemeral: true
      } as Facet));
    }

    return deltas;
  }
}

/**
 * DiscordButtonReceptor: Handle Discord button click interactions
 */
export class DiscordButtonReceptor extends BaseReceptor {
  topics = ['discord:button-click'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const payload = event.payload as any;

    const { customId, user, channelId, interactionId } = payload;

    // Button custom IDs are formatted as "box-open-{boxId}"
    if (customId.startsWith('box-open-')) {
      const boxId = customId.replace('box-open-', '');
      deltas.push(addFacet({
        id: `game-action-open-${boxId}-${Date.now()}`,
        type: 'game-action',
        content: `${user} is opening box ${boxId} (via button)`,
        state: {
          action: 'open-box',
          params: { boxId, actor: user },
          interactionId,
          channelId
        },
        ephemeral: true
      } as Facet));
    }

    return deltas;
  }
}

/**
 * DiscordMessageReceptor: Handle regular Discord messages and activate agent
 */
export class DiscordMessageReceptor extends BaseReceptor {
  topics = ['discord:message'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const payload = event.payload as any;

    const { channelId, messageId, author, authorId, isBot, content, streamId, isHistory } = payload;

    // Ignore bot messages and historical messages
    if (isBot || isHistory) {
      return deltas;
    }

    // Add message facet for context
    deltas.push(addFacet({
      id: `discord-message-${messageId}`,
      type: 'message',
      content: `${author}: ${content}`,
      state: {
        author,
        authorId,
        content,
        channelId,
        messageId,
        streamId
      },
      ephemeral: false // Keep messages in context
    } as Facet));

    // Activate agent for all messages (simple activation)
    deltas.push(addFacet(createAgentActivation(
      `Message from ${author}`,
      {
        channelId,
        messageId,
        author,
        content
      }
    )));

    return deltas;
  }
}

/**
 * AgentGameActionReceptor: Handle agent tool use for game actions
 */
export class AgentGameActionReceptor extends BaseReceptor {
  topics = ['agent:game-action'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const payload = event.payload as any;

    const { action, args, user, channelId } = payload;

    if (action === 'create-box' && args.length > 0) {
      const contents = args[0].split(',').map((item: string) => item.trim());
      deltas.push(addFacet({
        id: `game-action-create-${Date.now()}`,
        type: 'game-action',
        content: `${user} is creating a box with ${contents.length} items`,
        state: {
          action: 'create-box',
          params: { contents, actor: user },
          channelId
        },
        ephemeral: true
      } as Facet));
    } else if (action === 'open-box' && args.length > 0) {
      deltas.push(addFacet({
        id: `game-action-open-${args[0]}-${Date.now()}`,
        type: 'game-action',
        content: `${user} is opening box ${args[0]}`,
        state: {
          action: 'open-box',
          params: { boxId: args[0], actor: user },
          channelId
        },
        ephemeral: true
      } as Facet));
    }

    return deltas;
  }
}

/**
 * BoxGameReceptor: Handle game events (box created/opened/errors)
 */
export class BoxGameReceptor extends BaseReceptor {
  topics = ['game:box-created', 'game:box-opened', 'game:box-not-found', 'game:box-already-open'];

  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

    if (event.topic === 'game:box-created') {
      const payload = event.payload as any;
      console.log(`[BoxGameReceptor] Creating box facet for ${payload.boxId} with contents:`, payload.contents);
      const boxFacet = createStateFacet({
        id: `box-${payload.boxId}`,
        content: `📦 Box ${payload.boxId}: ${payload.contents.join(', ')} (created by ${payload.creator})`,
        entityType: 'component',
        entityId: payload.boxId,
        state: {
          boxId: payload.boxId,
          contents: payload.contents,
          creator: payload.creator,
          isOpen: false,
          createdAt: Date.now()
        } as BoxState
      });
      console.log(`[BoxGameReceptor] Box facet created:`, JSON.stringify(boxFacet));
      deltas.push(addFacet(boxFacet));
      deltas.push(addFacet(createEventFacet({
        id: `box-created-event-${payload.boxId}`,
        content: `${payload.creator} created box ${payload.boxId} with ${payload.contents.length} items`,
        source: payload.creator,
        eventType: 'box-created',
        streamId: 'game-events',
        metadata: payload
      })));
    } else if (event.topic === 'game:box-opened') {
      const payload = event.payload as any;
      const existingBox = Array.from(state.facets.values()).find(f =>
        f.type === 'state' && f.state && 'boxId' in f.state && f.state.boxId === payload.boxId
      );
      if (existingBox && existingBox.state) {
        deltas.push(addFacet(createStateFacet({
          id: existingBox.id,
          content: `📦 Box ${payload.boxId} (OPEN): ${payload.contents.join(', ')} (was created by ${payload.creator})`,
          entityType: 'component',
          entityId: payload.boxId,
          state: { ...(existingBox.state as BoxState), isOpen: true } as BoxState
        })));
      }
      deltas.push(addFacet(createEventFacet({
        id: `box-opened-event-${payload.boxId}-${Date.now()}`,
        content: `🎉 ${payload.opener} opened box ${payload.boxId}, revealing: ${payload.contents.join(', ')}!`,
        source: payload.opener,
        eventType: 'box-opened',
        streamId: 'game-events',
        metadata: payload
      })));
    } else if (event.topic === 'game:box-not-found') {
      const payload = event.payload as any;
      deltas.push(addFacet(createEventFacet({
        id: `box-not-found-${payload.boxId}-${Date.now()}`,
        content: `❌ Box ${payload.boxId} not found!`,
        source: 'system',
        eventType: 'box-not-found',
        streamId: 'game-events',
        metadata: payload
      })));
    } else if (event.topic === 'game:box-already-open') {
      const payload = event.payload as any;
      deltas.push(addFacet(createEventFacet({
        id: `box-already-open-${payload.boxId}-${Date.now()}`,
        content: `ℹ️ Box ${payload.boxId} is already open!`,
        source: 'system',
        eventType: 'box-already-open',
        streamId: 'game-events',
        metadata: payload
      })));
    }

    return deltas;
  }
}

// ============================================================================
// TRANSFORMS (Context Generation)
// ============================================================================

/**
 * DiscordStatusTransform: Generate Discord embeds showing game status
 */
export class DiscordStatusTransform extends BaseTransform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

    // Get boxes
    const allStateFacets = state.getFacetsByType('state');
    console.log(`[DiscordStatusTransform] Total state facets: ${allStateFacets.length}`);

    const boxes = allStateFacets
      .filter(f => {
        const isContextScope = f.scopes?.some((s: string) =>
          s === 'user-rendered-context' || s === 'agent-rendered-context' || s === 'discord-rendered-context'
        );
        const isActualBox = f.state && 'boxId' in f.state && 'creator' in f.state && 'contents' in f.state;
        console.log(`[DiscordStatusTransform] Facet ${f.id}: isActualBox=${isActualBox}, isContextScope=${isContextScope}, scopes=${JSON.stringify(f.scopes)}`);
        return isActualBox && !isContextScope;
      })
      .map(f => f.state as BoxState);

    console.log(`[DiscordStatusTransform] Found ${boxes.length} boxes:`, JSON.stringify(boxes));

    // Get recent events
    const events = state.getFacetsByType('event')
      .filter(f => {
        const isContextScope = f.scopes?.some((s: string) =>
          s === 'user-rendered-context' || s === 'agent-rendered-context' || s === 'discord-rendered-context'
        );
        return !isContextScope && f.content;
      })
      .slice(-5); // Last 5 events

    // Build embed data
    const embedData = {
      boxes,
      events: events.map(e => e.content),
      stats: {
        totalBoxes: boxes.length,
        openBoxes: boxes.filter(b => b.isOpen).length,
        closedBoxes: boxes.filter(b => !b.isOpen).length
      }
    };

    const contextId = 'discord-game-status';
    const existing = Array.from(state.facets.values()).find(f => f.id === contextId);

    if (!existing) {
      deltas.push(addFacet({
        id: contextId,
        type: 'state',
        content: JSON.stringify(embedData),
        scopes: ['discord-rendered-context'],
        state: embedData
      } as Facet));
    } else {
      // Only update if data changed
      const existingData = existing.state;
      if (JSON.stringify(existingData) !== JSON.stringify(embedData)) {
        deltas.push(changeFacet(contextId, {
          content: JSON.stringify(embedData),
          scopes: ['discord-rendered-context'],
          state: embedData
        }));
      }
    }

    return deltas;
  }
}

/**
 * AgentContextTransform: Generate context for agent (for HUD/LLM)
 */
export class AgentContextTransform extends BaseTransform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

    const contextId = 'agent-hud-context';
    const contextContent = this.generateAgentContext(state);

    const existing = Array.from(state.facets.values()).find(f => f.id === contextId);

    if (!existing) {
      deltas.push(addFacet({
        id: contextId,
        type: 'ambient',
        content: contextContent,
        scopes: ['agent-rendered-context']
      } as Facet));
    } else if (existing.content !== contextContent) {
      deltas.push(changeFacet(contextId, {
        content: contextContent,
        scopes: ['agent-rendered-context']
      }));
    }

    return deltas;
  }

  private generateAgentContext(state: ReadonlyVEILState): string {
    const lines: string[] = [];
    lines.push('=== BOX GAME - AGENT VIEW ===\n');

    // Get boxes
    const boxes = state.getFacetsByType('state')
      .filter(f => {
        const isContextScope = f.scopes?.some((s: string) =>
          s === 'user-rendered-context' || s === 'agent-rendered-context' || s === 'discord-rendered-context'
        );
        const isActualBox = f.state && 'boxId' in f.state && 'creator' in f.state && 'contents' in f.state;
        return isActualBox && !isContextScope;
      })
      .map(f => f.state as BoxState);

    if (boxes.length > 0) {
      lines.push('Current boxes:');
      boxes.forEach(box => {
        const status = box.isOpen ? 'OPEN' : 'closed';
        const contentsDisplay = box.isOpen ? box.contents.join(', ') : '???';
        lines.push(`- Box ${box.boxId} (${status}): ${contentsDisplay} [created by ${box.creator}]`);
      });
      lines.push('');
    } else {
      lines.push('No boxes exist yet.\n');
    }

    // Get recent activity (messages, events, speech)
    const activity: Array<{content: string; source: string}> = [];
    state.facets.forEach(f => {
      const isContextScope = f.scopes?.some((s: string) =>
        s === 'user-rendered-context' || s === 'agent-rendered-context' || s === 'discord-rendered-context'
      );
      if (isContextScope) return;

      if (f.type === 'message' && f.content) {
        // User messages from Discord
        const author = f.state?.author || 'unknown';
        activity.push({ content: f.content, source: author });
      } else if (f.type === 'event' && f.content) {
        activity.push({ content: f.content, source: f.state?.source || 'system' });
      } else if (f.type === 'speech' && f.content) {
        const agentName = (f as any).agentName || (f as any).agentId || 'Unknown';
        activity.push({ content: f.content, source: agentName });
      }
    });
    const recentActivity = activity.slice(-8);
    if (recentActivity.length > 0) {
      lines.push('Recent activity:');
      recentActivity.forEach(item => {
        lines.push(`- [${item.source}]: ${item.content}`);
      });
      lines.push('');
    }

    lines.push('You can respond naturally to the conversation in Discord.');
    lines.push('Users can create boxes with /create-box and open them with /open-box or buttons.');

    return lines.join('\n');
  }
}

/**
 * AgentSpeechToDiscordTransform: Route agent speech to Discord and create send actions
 * FIXED: Use component-state facet for persistence
 */
export class AgentSpeechToDiscordTransform extends BaseTransform {
  private componentStateId = 'speech-tracker-state';

  constructor(private defaultChannelId: string) {
    super();
  }

  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];

    // Get processed speech IDs from component-state
    const stateFacet = Array.from(state.facets.values()).find(f => f.id === this.componentStateId);
    const processedSpeech = new Set<string>(stateFacet?.state?.processedSpeech || []);

    // Find agent speech facets that haven't been processed yet
    const agentSpeech = state.getFacetsByType('speech').filter(f => {
      const agentId = (f as any).agentId;
      return agentId && !processedSpeech.has(f.id);
    });

    for (const speech of agentSpeech) {
      processedSpeech.add(speech.id);

      // Determine channel ID from activation context or use default
      const activations = state.getFacetsByType('activation');
      const recentActivation = activations
        .filter(a => a.state?.metadata?.channelId)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];

      const channelId = recentActivation?.state?.metadata?.channelId || this.defaultChannelId;
      const message = speech.content || '';

      // Create a discord:send action facet
      deltas.push(addFacet({
        id: `discord-send-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'action',
        scopes: ['ephemeral'],
        state: {
          metadata: {
            action: 'discord:send',
            params: {
              channelId,
              message
            }
          }
        }
      }));
    }

    // Update component-state if speech was processed
    if (agentSpeech.length > 0) {
      deltas.push(addFacet({
        id: this.componentStateId,
        type: 'component-state',
        componentType: 'AgentSpeechToDiscordTransform',
        componentClass: 'transform',
        componentId: 'speech-tracker',
        state: {
          processedSpeech: Array.from(processedSpeech)
        }
      }));
    }

    return deltas;
  }
}

/**
 * AgentActivationTransform: Create agent activations for interesting events
 * FIXED: Use component-state facet for persistence
 */
export class AgentActivationTransform extends BaseTransform {
  private componentStateId = 'activation-tracker-state';
  private readonly ACTIVATION_COOLDOWN_MS = 2000;

  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const now = Date.now();

    // Get tracker state from VEIL
    const stateFacet = Array.from(state.facets.values()).find(f => f.id === this.componentStateId);
    const processedEvents = new Set<string>(stateFacet?.state?.processedEvents || []);
    const lastActivationTime = stateFacet?.state?.lastActivationTime || 0;

    if (now - lastActivationTime < this.ACTIVATION_COOLDOWN_MS) {
      return deltas;
    }

    // Find new interesting events
    const interestingEvents = state.getFacetsByType('event').filter(f => {
      const eventType = f.state?.eventType;
      const displayName = (f as any).displayName;
      const source = f.state?.source || f.state?.metadata?.speaker;
      const creator = f.state?.metadata?.creator;
      const author = f.state?.metadata?.author;
      const isUserAction = source && source !== 'agent' && source !== 'system' &&
                          creator !== 'agent';
      const isErrorEvent = eventType === 'box-not-found' || eventType === 'box-already-open';

      // Already processed
      if (processedEvents.has(f.id)) return false;

      // Discord message from a user
      if (displayName === 'discord-message') {
        return author !== undefined;
      }

      // Box game events
      return (eventType === 'box-opened' || eventType === 'box-created') &&
             !isErrorEvent &&
             isUserAction;
    });

    // Process event facets
    for (const event of interestingEvents) {
      processedEvents.add(event.id);
      const eventType = event.state?.eventType;
      const displayName = (event as any).displayName;
      const channelId = event.state?.metadata?.channelId;
      const author = event.state?.metadata?.author;
      const content = event.state?.metadata?.content;

      let reason: string;
      let priority: 'high' | 'normal' = 'normal';

      if (displayName === 'discord-message') {
        reason = `${author} sent a message: "${content}"`;
        priority = 'high';
      } else if (eventType) {
        reason = `New ${eventType} event requires attention`;
        priority = eventType === 'box-opened' ? 'high' : 'normal';
      } else {
        reason = 'New event requires attention';
      }

      const activationFacet = createAgentActivation(reason, {
        id: `activation-${eventType || displayName}-${Date.now()}`,
        priority,
        source: displayName === 'discord-message' ? 'discord' : 'box-game',
        triggerEvent: event.id,
        eventType: eventType || displayName,
        channelId
      });

      deltas.push(addFacet(activationFacet));
    }

    // Update component-state if events were processed
    if (deltas.length > 0) {
      deltas.push(addFacet({
        id: this.componentStateId,
        type: 'component-state',
        componentType: 'AgentActivationTransform',
        componentClass: 'transform',
        componentId: 'activation-tracker',
        state: {
          processedEvents: Array.from(processedEvents),
          lastActivationTime: now
        }
      }));
    }

    return deltas;
  }
}

// ============================================================================
// EFFECTORS (Side Effects)
// ============================================================================

/**
 * BoxGameEffector: Game world simulation
 * FIXED: Read boxes from VEIL state instead of internal Map
 */
export class BoxGameEffector extends BaseEffector {
  facetFilters = [{ type: 'game-action' }, { type: 'action' }];

  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];

    for (const change of changes) {
      if (change.type === 'added') {
        const facet = change.facet;

        // Handle game-action facets (from Discord slash commands, buttons, etc.)
        if (facet.type === 'game-action') {
          const action = facet.state?.action;
          const params = facet.state?.params || {};
          const interactionId = facet.state?.interactionId;
          const channelId = facet.state?.channelId;

          if (action === 'create-box') {
            events.push(...this.handleCreateBox(params.contents!, params.actor, interactionId, channelId, state));
          } else if (action === 'open-box') {
            events.push(...this.handleOpenBox(params.boxId!, params.actor, interactionId, channelId, state));
          }
        }
        // Handle action facets (from agent tool use - @box.create/@box.open)
        else if (facet.type === 'action') {
          const toolName = facet.state?.toolName;
          const params = facet.state?.parameters || {};
          const channelId = facet.state?.channelId;

          if (toolName === 'box.create') {
            const itemsString = params.value || params.items || '';
            const contents = itemsString.split(',').map((item: string) => item.trim()).filter((item: string) => item);
            events.push(...this.handleCreateBox(contents, 'agent', undefined, channelId, state));
          }
          else if (toolName === 'box.open') {
            const boxId = params.value || params.boxId || '';
            events.push(...this.handleOpenBox(boxId, 'agent', undefined, channelId, state));
          }
        }
      }
    }

    return { events };
  }

  private handleCreateBox(contents: string[], creator: string, interactionId?: string, channelId?: string, state?: ReadonlyVEILState): SpaceEvent[] {
    const boxId = `box${Date.now()}`;

    return [{
      topic: 'game:box-created',
      source: { elementId: 'box-game-effector', elementPath: [] },
      payload: { boxId, contents, creator, interactionId, channelId },
      timestamp: Date.now()
    }];
  }

  private handleOpenBox(boxId: string, opener: string, interactionId?: string, channelId?: string, state?: ReadonlyVEILState): SpaceEvent[] {
    // Read box from VEIL state instead of internal map
    const boxFacet = state?.facets.get(`box-${boxId}`);
    const box = boxFacet?.state as BoxState | undefined;

    if (!box) {
      return [{
        topic: 'game:box-not-found',
        source: { elementId: 'box-game-effector', elementPath: [] },
        payload: { boxId, opener, interactionId, channelId },
        timestamp: Date.now()
      }];
    }

    if (box.isOpen) {
      return [{
        topic: 'game:box-already-open',
        source: { elementId: 'box-game-effector', elementPath: [] },
        payload: { boxId, opener, interactionId, channelId },
        timestamp: Date.now()
      }];
    }

    return [{
      topic: 'game:box-opened',
      source: { elementId: 'box-game-effector', elementPath: [] },
      payload: { boxId, opener, contents: box.contents, creator: box.creator, interactionId, channelId },
      timestamp: Date.now()
    }];
  }
}

/**
 * DiscordAfferentEffector: Controls discord-afferent and sends typing indicators
 */
export class DiscordAfferentEffector extends BaseEffector {
  facetFilters = [
    { type: 'action' },
    { type: 'game-action' },
    { type: 'agent-activation' },
    { type: 'event' }
  ];

  constructor(
    private discordElement: Element,
    private channelId: string
  ) {
    super();
  }

  private getAfferent(): any {
    // Get the afferent component from the discord element
    const components = (this.discordElement as any).components;
    if (components && components.length > 0) {
      // Look for the DiscordAfferent component (it will be wrapped by AxonLoader)
      for (const component of components) {
        if (component.constructor.name === 'AxonLoaderComponent') {
          // The loaded component is stored in the AxonLoader
          const loadedComponent = (component as any).loadedComponent;
          if (loadedComponent) {
            return loadedComponent;
          }
        }
      }
    }
    return null;
  }

  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    const afferent = this.getAfferent();

    for (const change of changes) {
      // Send typing when agent activates
      if (change.facet.type === 'agent-activation' && change.type === 'added') {
        const channelId = change.facet.state?.metadata?.channelId || this.channelId;
        if (afferent && afferent.sendTyping) {
          afferent.sendTyping({ channelId });
        }
      }

      // Handle explicit status requests (from /box-status or /box-start)
      if (change.facet.type === 'game-action' && change.type === 'added') {
        const action = change.facet.state?.action;
        const interactionId = change.facet.state?.interactionId;

        if ((action === 'show-status' || action === 'start-game') && interactionId && afferent && afferent.replyToInteraction) {
          // Get who requested the status
          const requestingUser = change.facet.state?.params?.actor;

          // Get current game status from state
          const statusFacet = Array.from(state.facets.values()).find(f =>
            f.id === 'discord-game-status'
          );

          console.log(`[/box-status] discord-game-status facet found:`, statusFacet ? 'YES' : 'NO');
          console.log(`[/box-status] discord-game-status data:`, JSON.stringify(statusFacet?.state));

          const embedData = statusFacet?.state || { boxes: [], events: [], stats: {} };
          const { boxes = [], events: gameEvents = [], stats = {} } = embedData;

          console.log(`[/box-status] Sending embed with ${boxes.length} boxes, ${gameEvents.length} events`);

          // Build embed
          const embed = {
            title: '🎮 Box Game Status',
            description: 'Create mystery boxes with secret contents, then open them to reveal surprises!',
            color: 0x5865F2,
            fields: [
              {
                name: '📊 Stats',
                value: `Total: ${stats.totalBoxes || 0} | Open: ${stats.openBoxes || 0} | Closed: ${stats.closedBoxes || 0}`,
                inline: false
              }
            ]
          };

          // Add boxes field if there are any
          if (boxes.length > 0) {
            const closedBoxes = boxes.filter((b: BoxState) => !b.isOpen);
            const openBoxes = boxes.filter((b: BoxState) => b.isOpen);

            if (closedBoxes.length > 0) {
              embed.fields.push({
                name: '📦 Closed Boxes',
                value: closedBoxes.map((b: BoxState) => {
                  // Show contents to creator, ??? to others
                  const canSeeContents = b.creator === requestingUser;
                  const contentsDisplay = canSeeContents ? b.contents.join(', ') : '???';
                  return `\`${b.boxId}\` by ${b.creator}: ${contentsDisplay}`;
                }).join('\n') || 'None',
                inline: false
              });
            }

            if (openBoxes.length > 0) {
              embed.fields.push({
                name: '📭 Open Boxes',
                value: openBoxes.map((b: BoxState) =>
                  `\`${b.boxId}\`: ${b.contents.join(', ')}`
                ).join('\n') || 'None',
                inline: false
              });
            }
          }

          // Add recent events field
          if (gameEvents.length > 0) {
            embed.fields.push({
              name: '📜 Recent Events',
              value: gameEvents.slice(-3).join('\n') || 'No events yet',
              inline: false
            });
          }

          // Reply to the slash command with the status embed
          afferent.replyToInteraction({
            interactionId,
            embed,
            ephemeral: false
          });
        }
      }

      // Send interaction replies for game events
      if (change.facet.type === 'event' && change.type === 'added') {
        const eventType = change.facet.state?.eventType;
        const metadata = change.facet.state?.metadata;
        const interactionId = metadata?.interactionId;

        if (interactionId && afferent && afferent.replyToInteraction) {
          const replyContent = this.getEventReplyMessage(change.facet);
          if (replyContent) {
            afferent.replyToInteraction({
              interactionId,
              content: replyContent,
              ephemeral: false
            });
          }
        }
      }

      // Handle action facets with discord:* commands
      if (change.facet.type === 'action' && change.type === 'added') {
        const action = change.facet.state?.metadata?.action;
        const params = change.facet.state?.metadata?.params;

        if (action && action.startsWith('discord:') && afferent) {
          const method = action.replace('discord:', '');
          if (typeof (afferent as any)[method] === 'function') {
            (afferent as any)[method](params);
          }
        }
      }
    }

    return { events };
  }

  private getEventReplyMessage(facet: Facet): string | null {
    const eventType = facet.state?.eventType;
    const metadata = facet.state?.metadata;

    if (eventType === 'box-created') {
      return `✅ Created box \`${metadata?.boxId}\` with ${metadata?.contents?.length || 0} items!`;
    } else if (eventType === 'box-opened') {
      return `🎉 Opened box \`${metadata?.boxId}\`! It contained: ${metadata?.contents?.join(', ')}`;
    } else if (eventType === 'box-not-found') {
      return `❌ Box \`${metadata?.boxId}\` not found!`;
    } else if (eventType === 'box-already-open') {
      return `ℹ️ Box \`${metadata?.boxId}\` is already open!`;
    }

    return null;
  }
}

// ============================================================================
// APPLICATION CLASS
// ============================================================================

export class BoxGameDiscordApplication implements ConnectomeApplication {
  private config: BoxGameConfig;
  private discordElement?: Element;
  private wasRestored = false;

  constructor(config: BoxGameConfig) {
    this.config = config;
  }

  isRestored(): boolean {
    return this.wasRestored;
  }

  async createSpace(hostRegistry?: Map<string, any>, lifecycleId?: string, spaceId?: string): Promise<{ space: Space; veilState: VEILStateManager }> {
    console.log('[BoxGameApp] Creating Space and VEIL...');
    const veilState = new VEILStateManager();
    const space = new Space(veilState, hostRegistry, lifecycleId, spaceId);

    // Element Tree infrastructure is initialized by Host before initialize() is called
    // No need to register it here

    return { space, veilState };
  }

  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🎮 Initializing Discord Box Game...\n');

    // Register all components FIRST (needed for component:add events and declarative creation)
    this.getComponentRegistry();

    // Create main game element (declaratively)
    console.log('🆕 Creating game element via element:create event');
    space.emit({
      topic: 'element:create',
      source: space.getRef(),
      payload: {
        name: 'discord-box-game',
        elementId: 'discord-box-game',
        components: []
      },
      timestamp: Date.now()
    });

    // Create Discord connection element (declaratively)
    console.log('🔌 Creating Discord connection...');
    const axonUrl = `axon://localhost:8080/modules/discord-afferent/manifest?host=localhost:8081&path=/ws&guild=${this.config.guildId}&agent=box-game-bot&token=${encodeURIComponent(this.config.discordBotToken)}`;

    space.emit({
      topic: 'element:create',
      source: space.getRef(),
      payload: {
        name: 'discord',
        elementId: 'discord-connection',
        components: [{
          type: 'AxonLoaderComponent',
          config: { url: axonUrl }
        }]
      },
      timestamp: Date.now()
    });

    // Wait for the maintainer to process element:create events
    // Events are processed asynchronously via setImmediate in Space.emit()
    await new Promise(resolve => setImmediate(resolve));

    // Now find the created elements
    const gameElement = space.children.find(e => e.name === 'discord-box-game');
    if (!gameElement) {
      throw new Error('Failed to create game element');
    }

    this.discordElement = space.children.find(e => e.name === 'discord');
    if (!this.discordElement) {
      throw new Error('Failed to create discord element');
    }

    // Get the AxonLoader that was created
    const axonLoader = this.discordElement.components.find(c => c instanceof AxonLoaderComponent) as AxonLoaderComponent;
    if (!axonLoader) {
      throw new Error('AxonLoaderComponent not found');
    }

    // Create receptors for Discord initialization
    const initReceptor = this.createDiscordInitReceptor();
    const connectionReceptor = this.createDiscordConnectionReceptor();

    gameElement.addComponent(initReceptor);
    gameElement.addComponent(connectionReceptor);

    // Connect to Discord AXON server (URL already passed in config)
    const waitPromise = connectionReceptor.waitForConnection();
    await axonLoader.connect(axonUrl);
    await waitPromise;

    // Set up RETM pipeline declaratively via component:add events
    console.log('🔧 Setting up RETM architecture via component:add events...');

    // Define all components to be added
    const gameComponents = [
      // Receptors
      { type: 'DiscordSlashReceptor', class: 'receptor' },
      { type: 'DiscordButtonReceptor', class: 'receptor' },
      { type: 'DiscordMessageReceptor', class: 'receptor' },
      { type: 'AgentGameActionReceptor', class: 'receptor' },
      { type: 'BoxGameReceptor', class: 'receptor' },
      // Transforms
      { type: 'AgentLifecycleTransform', class: 'transform' }, // Must run early to register agents
      { type: 'DiscordStatusTransform', class: 'transform' },
      { type: 'AgentContextTransform', class: 'transform' },
      { type: 'AgentActivationTransform', class: 'transform' },
      { type: 'AgentSpeechToDiscordTransform', class: 'transform', config: { channelId: this.config.channelId } },
      { type: 'ContextTransform', class: 'transform' },
      // Effectors
      { type: 'BoxGameEffector', class: 'effector' },
      { type: 'DiscordAfferentEffector', class: 'effector', config: { channelId: this.config.channelId } }
    ];

    // Emit component:add events for each component
    for (const comp of gameComponents) {
      space.emit({
        topic: 'component:add',
        source: space.getRef(),
        payload: {
          elementId: gameElement.id,
          componentType: comp.type,
          componentClass: comp.class,
          config: comp.config
        },
        timestamp: Date.now()
      });
    }

    // Wait for the maintainer to process component:add events
    await new Promise(resolve => setImmediate(resolve));

    // Create AI agent element (declaratively)
    console.log('🤖 Creating AI agent element...');
    space.emit({
      topic: 'element:create',
      source: space.getRef(),
      payload: {
        name: 'agent',
        elementId: 'box-game-agent',
        components: []
      },
      timestamp: Date.now()
    });

    // Add agent component declaratively (config will be used to create agent in onReferencesResolved)
    const agentConfig = {
      systemPrompt: `You are an AI playing an interactive box game in Discord!

Game Rules:
- Players create boxes with hidden contents using /create-box
- Box contents are only visible to the creator until opened
- Anyone can open any box to reveal contents to everyone
- Players can also click "Open" buttons in Discord to open boxes

You can also create and open boxes yourself using the tools available to you!
Use @box.create to make a box with items, and @box.open to open any box.

You can engage with players naturally - react to boxes being created and opened,
express curiosity about mystery boxes, celebrate discoveries, and have fun conversations
about the game. Be playful, creative, and encouraging!`,
      defaultMaxTokens: 250,
      defaultTemperature: 0.8,
      name: 'box-game-ai',
      tools: [
        {
          name: 'box.create',
          description: 'Create a new mystery box with items',
          parameters: {
            items: {
              type: 'string',
              description: 'Comma-separated list of items to put in the box (e.g., "sword,potion,treasure")'
            }
          },
          elementPath: [],
          emitEvent: {
            topic: 'agent:game-action',
            payloadTemplate: {
              action: 'create-box',
              args: ['{{items}}'],
              user: 'agent',
              channelId: this.config.channelId
            }
          }
        },
        {
          name: 'box.open',
          description: 'Open an existing box to reveal its contents',
          parameters: {
            boxId: {
              type: 'string',
              description: 'The ID of the box to open (e.g., "box1234567890")'
            }
          },
          elementPath: [],
          emitEvent: {
            topic: 'agent:game-action',
            payloadTemplate: {
              action: 'open-box',
              args: ['{{boxId}}'],
              user: 'agent',
              channelId: this.config.channelId
            }
          }
        }
      ]
    };

    // Emit component:add for agent component (using placeholder ID)
    const agentElementId = 'box-game-agent';
    space.emit({
      topic: 'component:add',
      source: space.getRef(),
      payload: {
        elementId: agentElementId,
        componentType: 'AgentComponent',
        componentClass: 'component',
        config: { agentConfig }
      },
      timestamp: Date.now()
    });

    // Add agent effector declaratively
    space.emit({
      topic: 'component:add',
      source: space.getRef(),
      payload: {
        elementId: gameElement.id,
        componentType: 'AgentEffector',
        componentClass: 'effector',
        config: { agentElementId }
      },
      timestamp: Date.now()
    });

    // Wait for the maintainer to process agent element and component:add events
    await new Promise(resolve => setImmediate(resolve));

    // Add tool instructions
    await this.addToolInstructions(space);

    // Register slash commands and join channel
    await this.setupDiscordCommands(space);

    console.log('✅ Discord Box Game initialized\n');
  }

  getComponentRegistry(): typeof ComponentRegistry {
    // Register all custom components for restoration
    ComponentRegistry.register('DiscordSlashReceptor', DiscordSlashReceptor);
    ComponentRegistry.register('DiscordButtonReceptor', DiscordButtonReceptor);
    ComponentRegistry.register('DiscordMessageReceptor', DiscordMessageReceptor);
    ComponentRegistry.register('AgentGameActionReceptor', AgentGameActionReceptor);
    ComponentRegistry.register('BoxGameReceptor', BoxGameReceptor);
    ComponentRegistry.register('DiscordStatusTransform', DiscordStatusTransform);
    ComponentRegistry.register('AgentContextTransform', AgentContextTransform);
    ComponentRegistry.register('AgentActivationTransform', AgentActivationTransform);
    ComponentRegistry.register('BoxGameEffector', BoxGameEffector);
    ComponentRegistry.register('AxonLoaderComponent', AxonLoaderComponent);

    // Components with constructor parameters - config will be applied after construction
    const app = this;
    const channelId = this.config.channelId;

    class AgentSpeechToDiscordTransformWrapper extends AgentSpeechToDiscordTransform {
      constructor() {
        // Use default channelId, will be overridden by config if present
        super(channelId);
      }
    }
    ComponentRegistry.register('AgentSpeechToDiscordTransform', AgentSpeechToDiscordTransformWrapper);

    class DiscordAfferentEffectorWrapper extends DiscordAfferentEffector {
      constructor() {
        // Use placeholders - will be set from config and element tree
        super(app.discordElement as any, channelId);
      }
    }
    ComponentRegistry.register('DiscordAfferentEffector', DiscordAfferentEffectorWrapper);

    ComponentRegistry.register('AgentEffector', AgentEffector);
    ComponentRegistry.register('AgentComponent', AgentComponent);
    ComponentRegistry.register('AgentLifecycleTransform', AgentLifecycleTransform);
    ComponentRegistry.register('ContextTransform', ContextTransform);

    return ComponentRegistry;
  }

  async onStart(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🚀 Box Game started (fresh)!\n');

    // Send welcome message on fresh start
    await new Promise(resolve => setTimeout(resolve, 2000));
    await this.executeDiscordAction(space, 'send', {
      channelId: this.config.channelId,
      message: '🎮 **Box Game is now active!**\n\nUse `/create-box` to create a mystery box and `/open-box` to reveal its contents!\nUse `/box-status` to see all boxes and recent activity.'
    });
  }

  async onRestore(space: Space, veilState: VEILStateManager): Promise<void> {
    this.wasRestored = true;
    console.log('♻️  Box Game restored from persistence!\n');

    // Find discord element
    this.discordElement = space.children.find(c => c.name === 'discord');
    if (!this.discordElement) {
      console.error('❌ Discord element not found after restoration!');
      return;
    }

    // Update DiscordAfferentEffector components with the restored discord element
    const gameElement = space.children.find(c => c.name === 'discord-box-game');
    if (gameElement) {
      for (const component of gameElement.components) {
        if (component instanceof DiscordAfferentEffector) {
          // Update the discord element reference
          (component as any).discordElement = this.discordElement;
        }
      }
    }

    // Debug: Check what was restored
    const state = veilState.getState();
    console.log(`[Restore Debug] Current sequence: ${state.currentSequence}`);
    console.log(`[Restore Debug] Total facets: ${state.facets.size}`);

    // Count box facets
    const boxFacets = Array.from(state.facets.values()).filter(f =>
      f.type === 'state' && f.id.startsWith('box-')
    );
    console.log(`[Restore Debug] Box facets found: ${boxFacets.length}`);
    boxFacets.forEach(f => {
      console.log(`[Restore Debug]   - ${f.id}: ${JSON.stringify((f.state as any)?.boxId)}`);
    });

    // Reconnect to Discord (AxonLoader should handle this automatically)
    console.log('🔌 Discord reconnection handled by AxonLoader...');

    // Rejoin channel
    await this.executeDiscordAction(space, 'join', { channelId: this.config.channelId });

    // Send restoration message with box count
    const boxCount = boxFacets.length;
    await this.executeDiscordAction(space, 'send', {
      channelId: this.config.channelId,
      message: `🔄 **Box Game restored!** I'm back online and ${boxCount} ${boxCount === 1 ? 'box is' : 'boxes are'} preserved.\n\nUse \`/box-status\` to see the current game state.`
    });

    console.log('✅ Discord reconnection complete\n');
  }

  // Helper methods

  private createDiscordInitReceptor(): any {
    const DiscordInitReceptor = class extends BaseReceptor {
      topics = ['axon:module-loaded'];

      transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
        const payload = event.payload as any;

        if (payload.module === 'discord-afferent') {
          console.log('📡 Discord Afferent module loaded, triggering connection...');

          return [addFacet({
            id: `discord-init-${Date.now()}`,
            type: 'init',
            content: 'Initialize Discord connection',
            timestamp: Date.now(),
            streamId: 'system:discord'
          })];
        }

        return [];
      }
    };

    return new DiscordInitReceptor();
  }

  private createDiscordConnectionReceptor(): any {
    const DiscordConnectionReceptor = class extends BaseReceptor {
      topics = ['discord:connected'];
      private resolver?: () => void;

      transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
        console.log('✅ Discord connected!\n');
        if (this.resolver) {
          this.resolver();
        }
        return [
          addFacet(createEventFacet({
            id: `discord-connection-${Date.now()}`,
            content: 'Discord connection established',
            source: 'discord',
            eventType: 'connection',
            streamId: 'discord:system'
          }))
        ];
      }

      waitForConnection(): Promise<void> {
        return new Promise(resolve => {
          this.resolver = resolve;
        });
      }
    };

    return new DiscordConnectionReceptor();
  }

  private createBoxGameAgent(veilState: VEILStateManager): BasicAgent {
    const agent = new BasicAgent({
      systemPrompt: `You are an AI playing an interactive box game in Discord!

Game Rules:
- Players create boxes with hidden contents using /create-box
- Box contents are only visible to the creator until opened
- Anyone can open any box to reveal contents to everyone
- Players can also click "Open" buttons in Discord to open boxes

You can also create and open boxes yourself using the tools available to you!
Use @box.create to make a box with items, and @box.open to open any box.

You can engage with players naturally - react to boxes being created and opened,
express curiosity about mystery boxes, celebrate discoveries, and have fun conversations
about the game. Be playful, creative, and encouraging!`,
      defaultMaxTokens: 250,
      defaultTemperature: 0.8,
      name: 'box-game-ai'
    }, this.config.llmProvider, veilState);

    // Register tools
    agent.registerTool({
      name: 'box.create',
      description: 'Create a new mystery box with items',
      parameters: {
        items: {
          type: 'string',
          description: 'Comma-separated list of items to put in the box (e.g., "sword,potion,treasure")'
        }
      },
      elementPath: [],
      emitEvent: {
        topic: 'agent:game-action',
        payloadTemplate: {
          action: 'create-box',
          args: ['{{items}}'],
          user: 'agent',
          channelId: this.config.channelId
        }
      }
    });

    agent.registerTool({
      name: 'box.open',
      description: 'Open an existing box to reveal its contents',
      parameters: {
        boxId: {
          type: 'string',
          description: 'The ID of the box to open (e.g., "box1234567890")'
        }
      },
      elementPath: [],
      emitEvent: {
        topic: 'agent:game-action',
        payloadTemplate: {
          action: 'open-box',
          args: ['{{boxId}}'],
          user: 'agent',
          channelId: this.config.channelId
        }
      }
    });

    return agent;
  }

  private async addToolInstructions(space: Space): Promise<void> {
    await space.emit({
      topic: 'veil:operation',
      source: space.getRef(),
      payload: {
        operation: {
          type: 'addFacet',
          facet: {
            id: 'box-game-tool-instructions',
            type: 'ambient',
            scopes: ['agent-rendered-context'],
            content: `<tool_instructions>
Available Actions:
- {@box.create("item1,item2,item3")} - Create a box with items
- {@box.open("boxId")} - Open an existing box

Examples:
"Let me create that! {@box.create("stars,magic,dreams")}"
"I'll open it! {@box.open("box1234567890")}"
</tool_instructions>`
          }
        }
      },
      timestamp: Date.now()
    });
  }

  private async setupDiscordCommands(space: Space): Promise<void> {
    console.log('📝 Registering slash commands...');

    await this.executeDiscordAction(space, 'registerSlashCommand', {
      commandName: 'create-box',
      description: 'Create a mystery box with items',
      options: [{
        name: 'items',
        description: 'Comma-separated items (e.g., "sword,potion,treasure")',
        type: 'string',
        required: true
      }]
    });

    await this.executeDiscordAction(space, 'registerSlashCommand', {
      commandName: 'open-box',
      description: 'Open a mystery box to reveal its contents',
      options: [{
        name: 'box-id',
        description: 'The ID of the box to open (e.g., "box1234567890")',
        type: 'string',
        required: true
      }]
    });

    await this.executeDiscordAction(space, 'registerSlashCommand', {
      commandName: 'box-status',
      description: 'Show current box game status with all boxes and recent activity'
    });

    await this.executeDiscordAction(space, 'registerSlashCommand', {
      commandName: 'box-start',
      description: 'Start the box game and show the status'
    });

    // Join the channel
    console.log('🚪 Joining Discord channel...');
    await this.executeDiscordAction(space, 'join', { channelId: this.config.channelId });
  }

  private async executeDiscordAction(space: Space, action: string, params: any): Promise<void> {
    await space.emit({
      topic: 'veil:operation',
      source: space.getRef(),
      payload: {
        operation: {
          type: 'addFacet',
          facet: {
            id: `discord-action-${action}-${Date.now()}`,
            type: 'action',
            scopes: ['ephemeral'],
            agentId: 'system',
            state: {
              metadata: {
                action: `discord:${action}`,
                params
              }
            },
            ephemeral: true
          }
        }
      },
      timestamp: Date.now()
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function main() {
  const discordBotToken = process.env.DISCORD_BOT_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const guildId = process.env.GUILD_ID || '966069488137158676';
  const channelId = process.env.CHANNEL_ID || '966069488137158679';

  if (!discordBotToken) {
    throw new Error('DISCORD_BOT_TOKEN environment variable is required');
  }
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  // Create LLM provider
  const { AnthropicProvider } = await import('../src/llm/anthropic-provider');
  const llmProvider = new AnthropicProvider({
    apiKey: anthropicApiKey,
    defaultModel: 'claude-3-5-sonnet-20241022'
  });

  // Create application
  const app = new BoxGameDiscordApplication({
    guildId,
    channelId,
    discordBotToken,
    llmProvider
  });

  // Create and start host
  const { ConnectomeHost } = await import('../src/host/host');
  const host = new ConnectomeHost({
    persistence: {
      enabled: true,
      storageDir: './box-game-discord-state',
      snapshotInterval: 1000
    },
    debug: {
      enabled: true,
      port: 3015
    },
    providers: {
      'llm.primary': llmProvider
    },
    secrets: {
      'discord.token': discordBotToken
    },
    reset: process.argv.includes('--reset')
  });

  const space = await host.start(app);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n⚠️  Received SIGINT, shutting down gracefully...');
    await host.stop();
    process.exit(0);
  });

  console.log('✨ Box Game is running! Press Ctrl+C to stop.\n');
}

// Run if this is the main module
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Failed to start Box Game:', error);
    process.exit(1);
  });
}
