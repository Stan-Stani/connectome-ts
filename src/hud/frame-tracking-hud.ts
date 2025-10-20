/**
 * Clean HUD implementation that tracks frames for compression
 * Works directly with VEIL primitives, no ContentBlock abstraction
 */

import {
  Facet,
  Frame,
  OutgoingVEILOperation,
  hasContentAspect,
  hasStateAspect,
  FrameRenderedSnapshot,
  RenderedChunk,
  createRenderedChunk
} from '../veil/types';
import { CompressibleHUD, RenderedContext, HUDConfig } from './types-v2';
import { CompressionEngine, RenderedFrame, StateDelta } from '../compression/types-v2';
import { getGlobalTracer, TraceCategory } from '../tracing';
import { VEILStateManager } from '../veil/veil-state';
import { FrameRenderCache } from './frame-render-cache';
import { RenderContext, CachedFrameRender } from './render-context-types';

export class FrameTrackingHUD implements CompressibleHUD {
  private frameRenderCache: FrameRenderCache;
  
  constructor() {
    this.frameRenderCache = new FrameRenderCache({
      maxContexts: 10,
      enableStats: true,
      verbose: false
    });
  }
  
  /**
   * Get cache statistics (for monitoring/debugging)
   */
  getCacheStats() {
    return this.frameRenderCache.getStats();
  }
  
  /**
   * Clear the render cache
   */
  clearRenderCache() {
    this.frameRenderCache.clear();
  }
  
  /**
   * Get cached context keys (for debugging)
   */
  getCachedContexts() {
    return this.frameRenderCache.getContextKeys();
  }
  
  /**
   * Invalidate a specific frame across all contexts
   */
  invalidateFrame(frameSequence: number) {
    this.frameRenderCache.invalidateFrame(frameSequence);
  }
  
  /**
   * Invalidate a range of frames across all contexts
   */
  invalidateFrameRange(fromSequence: number, toSequence: number) {
    this.frameRenderCache.invalidateRange(fromSequence, toSequence);
  }
  
  /**
   * Build render context from config and compression state
   */
  private buildRenderContext(config: HUDConfig, compression?: CompressionEngine): RenderContext {
    // Compute compression state hash
    const compressionState = this.computeCompressionStateHash(compression);
    
    return {
      focusedStream: config.renderContext?.focusedStream,
      compressionState,
      displayMode: config.renderContext?.displayMode || 'full',
      extensions: {}
    };
  }
  
  /**
   * Compute stable hash for compression state
   */
  private computeCompressionStateHash(compression?: CompressionEngine): string {
    if (!compression) {
      return 'none';
    }
    
    // Simple approach: just mark as "compressed" for now
    // Future: could hash actual compression mappings for finer granularity
    return 'compressed';
  }
  
  render(
    frames: Frame[],
    currentFacets: Map<string, Facet>,
    veilStateManager: VEILStateManager,
    compression?: CompressionEngine,
    config: HUDConfig = {}
  ): RenderedContext {
    const { context } = this.renderWithFrameTracking(
      frames,
      currentFacets,
      veilStateManager,
      compression,
      config
    );
    return context;
  }
  
  renderWithFrameTracking(
    frames: Frame[],
    currentFacets: Map<string, Facet>,
    veilStateManager: VEILStateManager,
    compression?: CompressionEngine,
    config: HUDConfig = {}
  ): {
    context: RenderedContext;
    frameRenderings: RenderedFrame[];
  } {
    const tracer = getGlobalTracer();
    const traceId = `hud-render-${Date.now()}`;
    
    tracer?.record({
      id: traceId,
      timestamp: Date.now(),
      level: 'info',
      category: TraceCategory.HUD_RENDER,
      component: 'FrameTrackingHUD',
      operation: 'renderWithFrameTracking',
      data: {
        frameCount: frames.length,
        currentFacetCount: currentFacets.size,
        config
      }
    });
    
    const frameRenderings: RenderedFrame[] = [];
    const frameContents: Array<{ 
      type: 'user' | 'agent' | 'system' | 'compressed';
      content: string;
      sequence: number;
    }> = [];
    let totalTokens = 0;
    
    // Note on token budget: We currently include ALL frames even if we exceed the budget.
    // Dropping frames (whether old or new) is problematic:
    // - Dropping old frames loses important context and setup
    // - Dropping new frames (the previous behavior) causes amnesia about recent messages
    // If frame dropping becomes necessary, it should be done intelligently (e.g., using
    // compression, importance scoring, or keeping a sliding window of recent + important frames).
    
    // Layer 2 cache setup (render caching)
    const cacheEnabled = config.frameRenderCache?.enabled ?? false;
    const cacheBorderDepth = config.frameRenderCache?.cacheBorderDepth ?? 20;
    const cacheableUntil = Math.max(0, frames.length - cacheBorderDepth);
    const renderContext = this.buildRenderContext(config, compression);
    
    // Get focused stream for rendering
    const focusedStream = config.renderContext?.focusedStream;
    
    // Render each frame using centralized state retrieval (Layer 1) and render caching (Layer 2)
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const isCacheable = cacheEnabled && i < cacheableUntil;
      
      // TRY LAYER 2 CACHE FIRST (render cache)
      if (isCacheable) {
        const cached = this.frameRenderCache.get(renderContext, frame.sequence);
        if (cached) {
          // Cache hit! Use cached render
          if (cached.renderedContent.trim()) {
            frameContents.push({
              type: cached.frameType,
              content: cached.renderedContent,
              sequence: frame.sequence
            });
            totalTokens += cached.tokens;
          }
          
          frameRenderings.push({
            frameSequence: frame.sequence,
            content: cached.renderedContent,
            tokens: cached.tokens,
            facetIds: cached.facetIds
          });
          
          continue;  // Skip rendering - used cache
        }
      }
      
      // LAYER 2 MISS - Get state from Layer 1 (VEILStateManager)
      // This is cached and compression-aware
      const snapshot = veilStateManager.getStateAtSequence(frame.sequence, compression);
      const replayedState = snapshot.facets;
      const removals = snapshot.removals;
      
      // Check if this frame is compressed
      if (compression?.shouldReplaceFrame(frame.sequence)) {
        const replacement = compression.getReplacement(frame.sequence);
        if (replacement !== null) {
          // Add replacement even if it's empty string (for compressed frames)
          if (replacement) {
            frameContents.push({
              type: 'compressed',
              content: replacement,
              sequence: frame.sequence
            });
            totalTokens += this.estimateTokens(replacement);
          }
          continue;
        }
      }
      
      const source = this.getFrameSource(frame);

      const { content, facetIds } = this.renderFrameContent(frame, source, replayedState, removals, focusedStream);
      const tokens = this.estimateTokens(content);
      
      // CACHE IN LAYER 2 if applicable
      if (isCacheable && content.trim()) {
        this.frameRenderCache.set(renderContext, frame.sequence, {
          frameSequence: frame.sequence,
          context: renderContext,
          renderedContent: content,
          frameType: source,
          tokens,
          facetIds,
          cachedAt: Date.now()
        });
      }
      
      // Trace each frame rendering
      tracer?.record({
        id: `${traceId}-frame-${frame.sequence}`,
        timestamp: Date.now(),
        level: 'debug',
        category: TraceCategory.HUD_RENDER,
        component: 'FrameTrackingHUD',
        operation: 'renderFrame',
        data: {
          frameSequence: frame.sequence,
          frameSource: source,
          operationCount: frame.deltas.length,
          deltas: frame.deltas.map(op => op.type),
          contentLength: content.length,
          contentPreview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
          tokens,
          facetIds,
          isEmpty: !content.trim()
        },
        parentId: traceId
      });
      
      frameRenderings.push({
        frameSequence: frame.sequence,
        content,
        tokens,
        facetIds
      });
      
      // Only add non-empty content
      if (content.trim()) {
        frameContents.push({
          type: source,
          content,
          sequence: frame.sequence
        });
        totalTokens += tokens;
      }
    }
    
    // Check if we exceeded token budget (but don't drop frames)
    if (config.maxTokens && totalTokens > config.maxTokens) {
      console.warn(`[HUD] Token budget exceeded: ${totalTokens} > ${config.maxTokens}.`);
      console.warn(`[HUD] Including all ${frameContents.length} frames to preserve conversation coherence.`);
      console.warn(`[HUD] Consider increasing contextTokenBudget in AgentConfig.`);
    }
    
    // Build messages directly from frame contents
    const { messages, frameToMessageIndex } = this.buildFrameBasedMessages(
      frameContents, 
      currentFacets, 
      config,
      cacheableUntil  // Pass CBD boundary for cache marker placement
    );
    
    // Calculate total tokens from messages
    totalTokens = messages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    
    return {
      context: {
        messages,
        metadata: {
          totalTokens,
          renderedFrames: frameRenderings,
          frameToMessageIndex
        }
      },
      frameRenderings
    };
  }
  
  /**
   * Render agent frame as chunks
   */
  private renderAgentFrameAsChunks(frame: Frame): RenderedChunk[] {
    const chunks: RenderedChunk[] = [];
    const contentParts: Array<{ content: string; facetId: string; type: string }> = [];

    // Collect content from facets
    for (const operation of frame.deltas) {
      if (operation.type === 'addFacet') {
        const facet = operation.facet;
        if (!facet) continue;
        
        let content = '';
        
        switch (facet.type) {
          case 'speech':
            if (hasContentAspect(facet)) {
              content = facet.content;
            }
            break;

          case 'action':
            if (hasStateAspect(facet)) {
              const { toolName, parameters } = facet.state as {
                toolName?: string;
                parameters?: Record<string, unknown>;
              };
              if (toolName) {
                content = this.renderToolCall(toolName, parameters ?? {});
              }
            }
            break;

          case 'thought':
            if (hasContentAspect(facet)) {
              content = `<thought>${facet.content}</thought>`;
          }
              break;
            }
        
        if (content) {
          contentParts.push({ content, facetId: facet.id, type: facet.type });
        }
      }
    }

    // Only add turn markers if there's content
    if (contentParts.length > 0) {
      // Opening turn marker
      chunks.push(createRenderedChunk(
        '<my_turn>\n\n',
        this.estimateTokens('<my_turn>\n\n'),
        { chunkType: 'turn-marker' }
      ));
      
      // Content chunks
      for (let i = 0; i < contentParts.length; i++) {
        const part = contentParts[i];
        const separator = i < contentParts.length - 1 ? '\n\n' : '';
        chunks.push(createRenderedChunk(
          part.content + separator,
          this.estimateTokens(part.content),
          { facetIds: [part.facetId], chunkType: part.type }
        ));
      }
      
      // Closing turn marker
      chunks.push(createRenderedChunk(
        '\n\n</my_turn>',
        this.estimateTokens('\n\n</my_turn>'),
        { chunkType: 'turn-marker' }
      ));
    }

    return chunks;
  }
  
  /**
   * Legacy wrapper - returns concatenated string
   */
  private renderAgentFrame(frame: Frame): string {
    const chunks = this.renderAgentFrameAsChunks(frame);
    return chunks.map(c => c.content).join('');
  }

  private getFrameSource(frame: Frame): 'user' | 'agent' | 'system' {
    if (!frame.events || frame.events.length === 0) {
      return 'system';
    }

    // Check for user input events
    const userTopics = ['console:input', 'discord:message', 'minecraft:chat'];
    if (frame.events.some(event => {
      if (!userTopics.includes(event.topic)) return false;
      
      // For discord:message events, check if it's from the bot itself
      // Bot's own messages in history should be treated as agent responses, not user input
      if (event.topic === 'discord:message') {
        const payload = event.payload as any;
        const authorId = payload?.authorId;
        const BOT_USER_ID = '1382891708513128485'; // TODO: Make configurable
        
        // If this is a message FROM the bot, it's an agent message
        if (authorId === BOT_USER_ID) {
          return false; // Not a user message
        }
      }
      
      return true;
    })) {
      return 'user';
    }

    // Check for agent-generated facets in deltas (speech, thought, action with agentId)
    const hasAgentFacet = frame.deltas?.some(delta => {
      if (delta.type === 'addFacet' && delta.facet) {
        const facet = delta.facet;
        // Check for agentId attribute (agent-generated content)
        if ((facet as any).agentId) {
          return true;
        }
        // Check nested children for agent speech (e.g., speech inside discord-msg)
        if (Array.isArray((facet as any).children)) {
          for (const child of (facet as any).children) {
            if ((child as any).agentId) {
              return true;
            }
            // Speech from bot in history has agentId
            if (child.type === 'speech' && (child as any).agentId) {
              return true;
            }
          }
        }
        // Also check for agent facet types at top level
        if (facet.type === 'speech' || facet.type === 'thought' || facet.type === 'action') {
          return true;
        }
      }
      return false;
    });
    
    if (hasAgentFacet) {
      return 'agent';
    }

    // Check for agent-generated events by looking at VEIL operations from agent elements
    if (frame.events.some(event => {
      if (event.topic === 'veil:operation' && event.source) {
        // Check if source is an AgentElement by elementType
        // This is more robust than string matching on elementId
        return event.source.elementType === 'AgentElement';
      }
      return false;
    })) {
      return 'agent';
    }

    // Check if any events have agent-related topics
    const agentTopics = ['agent:speech', 'agent:thought', 'agent:action'];
    if (frame.events.some(event => agentTopics.includes(event.topic))) {
      return 'agent';
    }

    return 'system';
  }

  /**
   * Render frame content as chunks with facet attribution
   * 
   * This is the single source of truth for frame rendering.
   * Returns chunks that can be used for both regular rendering
   * and snapshot capture.
   */
  private renderFrameAsChunks(
    frame: Frame,
    source: 'user' | 'agent' | 'system',
    replayedState: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>,
    renderMode: 'focused' | 'unfocused' = 'focused'
  ): RenderedChunk[] {
    if (source === 'agent') {
      // Agent frames always rendered in focused mode (their own speech)
      return this.renderAgentFrameAsChunks(frame);
    }

    return this.renderEnvironmentFrameAsChunks(frame, replayedState, removals, renderMode);
  }
  
  /**
   * Legacy wrapper - returns concatenated string
   * Used by existing code during transition
   */
  private renderFrameContent(
    frame: Frame,
    source: 'user' | 'agent' | 'system',
    replayedState: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>,
    focusedStream?: string
  ): { content: string; facetIds: string[] } {
    // Determine render mode based on frame's stream vs focused stream
    const frameStream = frame.activeStream?.streamId;
    const renderMode = (!focusedStream || !frameStream || frameStream === focusedStream)
      ? 'focused'
      : 'unfocused';
    
    const chunks = this.renderFrameAsChunks(frame, source, replayedState, removals, renderMode);
    const content = chunks.map(c => c.content).join('');
    const facetIds = Array.from(new Set(
      chunks.flatMap(c => c.facetIds || [])
    ));
    
    return { content, facetIds };
  }

  /**
   * Render environment frame as chunks
   */
  private renderEnvironmentFrameAsChunks(
    frame: Frame,
    replayedState: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>,
    renderMode: 'focused' | 'unfocused' = 'focused'
  ): RenderedChunk[] {
    const chunks: RenderedChunk[] = [];
    const renderedStates = new Map<string, { content: string; facetId: string; type: string }>();
    
    // Detect if this is a history dump (many event facets with nested speech)
    const eventFacetsWithSpeech = frame.deltas.filter(d => 
      d.type === 'addFacet' && 
      d.facet?.type === 'event' &&
      Array.isArray((d.facet as any).children) &&
      (d.facet as any).children.some((c: any) => c.type === 'speech')
    ).length;
    
    const isHistoryDump = eventFacetsWithSpeech > 5;
    
    if (isHistoryDump) {
      chunks.push(createRenderedChunk(
        '<history>\n',
        this.estimateTokens('<history>\n'),
        { chunkType: 'history-marker' }
      ));
    }

    // First pass: process state changes
    for (const operation of frame.deltas) {
      switch (operation.type) {
        case 'addFacet': {
          const facet = operation.facet;
          if (!facet || removals?.has(facet.id)) break;
          
          if (facet.type === 'state') {
            const rendered = this.renderFacet(facet, renderMode);
            if (rendered) {
              renderedStates.set(facet.id, { 
                content: rendered, 
                facetId: facet.id, 
                type: facet.type 
              });
            }
          }
          replayedState.set(facet.id, facet);
          break;
        }

        case 'rewriteFacet': {
          if (removals?.get(operation.id) === 'delete') break;
          
          const currentFacet = replayedState.get(operation.id);
          if (!currentFacet) break;
          
          const updatedFacet = this.mergeFacetChanges(currentFacet, operation.changes);
          const rendered = this.renderFacet(updatedFacet, renderMode);
          if (rendered) {
            renderedStates.set(operation.id, { 
              content: rendered, 
              facetId: operation.id, 
              type: updatedFacet.type 
            });
          }
          replayedState.set(operation.id, updatedFacet);
            break;
          }
            
        case 'removeFacet':
          break;
      }
    }

    // Second pass: render in order, creating chunks
    for (const operation of frame.deltas) {
      switch (operation.type) {
        case 'addFacet': {
          const facet = operation.facet;
          if (!facet || removals?.has(facet.id)) break;
          
          // Use pre-rendered state if available
          if (renderedStates.has(facet.id)) {
            const { content, facetId, type } = renderedStates.get(facet.id)!;
            chunks.push(createRenderedChunk(
              content + '\n',
              this.estimateTokens(content),
              { facetIds: [facetId], chunkType: type }
            ));
            renderedStates.delete(facet.id);
          break;
          }
          
          // Render directly
          const rendered = this.renderFacet(facet, renderMode);
          if (rendered) {
            chunks.push(createRenderedChunk(
              rendered + '\n',
              this.estimateTokens(rendered),
              { facetIds: [facet.id], chunkType: facet.type }
            ));
          }
            break;
          }
          
        case 'rewriteFacet': {
          if (removals?.has(operation.id)) break;
          
          if (renderedStates.has(operation.id)) {
            const { content, facetId, type } = renderedStates.get(operation.id)!;
            chunks.push(createRenderedChunk(
              content + '\n',
              this.estimateTokens(content),
              { facetIds: [facetId], chunkType: type }
            ));
            renderedStates.delete(operation.id);
          }
          break;
        }

        case 'removeFacet': {
          renderedStates.delete(operation.id);
          if (removals) {
            removals.set(operation.id, 'delete');
            const facet = replayedState.get(operation.id);
            if (facet && Array.isArray((facet as any)?.children)) {
              for (const child of (facet as any).children as Facet[]) {
                removals.set(child.id, 'delete');
              }
            }
          }
          replayedState.delete(operation.id);
          break;
        }
      }
    }
    
    // Add closing history tag if this was a history dump
    if (isHistoryDump) {
      chunks.push(createRenderedChunk(
        '</history>\n',
        this.estimateTokens('</history>\n'),
        { chunkType: 'history-marker' }
      ));
    }

    return chunks;
  }
  
  /**
   * Legacy wrapper - returns concatenated string
   */
  private renderEnvironmentFrame(
    frame: Frame,
    replayedState: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>
  ): string {
    const chunks = this.renderEnvironmentFrameAsChunks(frame, replayedState, removals);
    return chunks.map(c => c.content).join('');
  }
  
  /**
   * OLD IMPLEMENTATION - REPLACED BY renderEnvironmentFrameAsChunks
   * Keeping temporarily for reference
   */
  private renderEnvironmentFrameOld(
    frame: Frame,
    replayedState: Map<string, Facet>,
    removals?: Map<string, 'hide' | 'delete'>
  ): string {
    const parts: string[] = [];
    const renderedStates = new Map<string, string>();
    
    for (const operation of frame.deltas) {
      switch (operation.type) {
        case 'addFacet': {
          const facet = operation.facet;
          if (!facet) {
            console.error('[FrameTrackingHUD] Invalid addFacet operation - missing facet:', operation);
            break;
          }
          if (removals?.has(facet.id)) {
          break;
          }
          if (facet.type === 'state') {
            const rendered = this.renderFacet(facet);
            if (rendered) {
              renderedStates.set(facet.id, rendered);
            }
          }
          replayedState.set(facet.id, facet);
          break;
        }

        case 'rewriteFacet': {
          if (removals?.get(operation.id) === 'delete') {
            break;
          }

          const currentFacet = replayedState.get(operation.id);
          if (!currentFacet) {
          break;
          }

          const updatedFacet = this.mergeFacetChanges(currentFacet, operation.changes);
          const rendered = this.renderFacet(updatedFacet);
          if (rendered) {
            renderedStates.set(operation.id, rendered);
          }
          replayedState.set(operation.id, updatedFacet);
          break;
        }

        case 'removeFacet':
          break;
      }
    }

    for (const operation of frame.deltas) {
      switch (operation.type) {
        case 'addFacet': {
          const facet = operation.facet;
          if (!facet) {
            console.error('[FrameTrackingHUD] Invalid addFacet operation in second pass - missing facet:', operation);
          break;
      }
          if (removals?.has(facet.id)) {
            break;
          }

          if (renderedStates.has(facet.id)) {
            const finalRendering = renderedStates.get(facet.id);
            if (finalRendering) {
              parts.push(finalRendering);
            }
            renderedStates.delete(facet.id);
            break;
          }

          const rendered = this.renderFacet(facet);
          if (rendered) {
            parts.push(rendered);
          }
          break;
        }

        case 'rewriteFacet': {
          if (removals?.has(operation.id)) {
            break;
          }

          const finalRendering = renderedStates.get(operation.id);
          if (finalRendering) {
            parts.push(finalRendering);
            renderedStates.delete(operation.id);
          }
          break;
        }

        case 'removeFacet': {
          renderedStates.delete(operation.id);
          if (removals) {
            removals.set(operation.id, 'delete');
            const facet = replayedState.get(operation.id);
            if (facet && Array.isArray((facet as any)?.children)) {
              for (const child of (facet as any).children as Facet[]) {
                removals.set(child.id, 'delete');
              }
            }
          }
          replayedState.delete(operation.id);
          break;
        }
      }
    }

    return parts.join('\n');
  }
  
  /**
   * Render facet in unfocused mode (structured with stream context)
   */
  private renderFacetUnfocused(facet: Facet, facetContent?: string): string | null {
    if (!facetContent) return null;
    
    const streamId = facet.streamId || 'unknown-stream';
    const facetType = facet.type;
    
    // Extract channel name from metadata if available for cleaner display
    let streamLabel = streamId;
    if (facet.state?.metadata?.channelName) {
      streamLabel = `#${facet.state.metadata.channelName}`;
    }
    
    // Wrap with event tag and stream attribute
    return `<event stream="${streamId}" type="${facetType}" label="${streamLabel}">${facetContent}</event>`;
  }
  
  private renderFacet(facet: Facet, renderMode: 'focused' | 'unfocused' = 'focused'): string | null {
    const tracer = getGlobalTracer();
    
    const facetContent = hasContentAspect(facet) ? facet.content : undefined;
    const facetChildren = Array.isArray((facet as any)?.children)
      ? ((facet as any).children as Facet[])
      : [];

    // Skip facets with no content AND no children
    if (!facetContent && facetChildren.length === 0) {
      return null;
    }
    
    // NEW: For unfocused mode, use structured rendering
    if (renderMode === 'unfocused') {
      return this.renderFacetUnfocused(facet, facetContent);
    }
    
    // EXISTING: Focused mode rendering (clean colon format)
    const parts: string[] = [];
    
    // Trace facet rendering
    const facetTraceId = `facet-render-${facet.id}-${Date.now()}`;
    tracer?.record({
      id: facetTraceId,
      timestamp: Date.now(),
      level: 'trace',
      category: TraceCategory.HUD_RENDER,
      component: 'FrameTrackingHUD',
      operation: 'renderFacet',
      data: {
        id: facet.id,
        facetType: facet.type,
        displayName: (facet as any).displayName,
        hasContent: true, // We already checked hasContentAspect
        contentPreview: facetContent
          ? facetContent.substring(0, 100) + (facetContent.length > 100 ? '...' : '')
          : null,
        childCount: facetChildren.length,
        state: hasStateAspect(facet) ? facet.state : undefined
      }
    });
    
    // Use displayName as tag if available
    const displayName = (facet as any).displayName;
    if (typeof displayName === 'string' && displayName.length > 0) {
      const tag = this.sanitizeTagName(displayName);
      
      // Render the facet's own content
      if (facetContent) {
        parts.push(`<${tag}>${facetContent}</${tag}>`);
      }
      
      // Render child facets
      if (facetChildren.length > 0) {
        const childParts: string[] = [];
        for (const child of facetChildren) {
          const rendered = this.renderFacet(child);
          if (rendered) {
            childParts.push(rendered);
          }
        }
        if (childParts.length > 0) {
          // If facet has both content and children, wrap children
          if (facetContent) {
            parts.push(`<${tag}-children>`);
            parts.push(...childParts);
            parts.push(`</${tag}-children>`);
          } else {
            // If only children, include them in the main tag
            return `<${tag}>\n${childParts.join('\n')}\n</${tag}>`;
          }
        }
      }
      
      return parts.join('\n');
    }
    
    // No tag for facets without displayName
    if (facetContent) {
      // For speech facets, include speaker attribution
      if (facet.type === 'speech' && hasStateAspect(facet)) {
        const speaker = (facet.state as any).speaker;
        if (speaker) {
          parts.push(`${speaker}: ${facetContent}`);
        } else {
          parts.push(facetContent);
        }
      } else {
        parts.push(facetContent);
      }
    }
    
    // Still render children even without displayName
    if (facetChildren.length > 0) {
      for (const child of facetChildren) {
        const rendered = this.renderFacet(child);
        if (rendered) {
          parts.push(rendered);
        }
      }
    }
    
    return parts.length > 0 ? parts.join('\n') : null;
  }
  
  private renderToolCall(toolName: string, parameters: any): string {
    const parts = [`<tool_call name="${toolName}">`];
    
    for (const [key, value] of Object.entries(parameters)) {
      parts.push(`<parameter name="${key}">${this.escapeXml(String(value))}</parameter>`);
    }
    
    parts.push('</tool_call>');
    return parts.join('\n');
  }
  
  private renderAction(action: any): string {
    // Render as the original @path syntax (e.g., @chat.general.say)
    const actionPath = action.path.join('.');
    
    if (action.parameters && Object.keys(action.parameters).length > 0) {
      const params = action.parameters;
      // Check if it's a simple single value parameter
      if (Object.keys(params).length === 1 && params.value !== undefined) {
        return `@${actionPath}("${params.value}")`;
      } else {
        // Multi-parameter, render as block
        const paramLines = Object.entries(params).map(([key, value]) => 
          `  ${key}: ${value}`
        ).join('\n');
        return `@${actionPath} {\n${paramLines}\n}`;
      }
    } else {
      // No parameters
      return `@${actionPath}`;
    }
  }
  
  private renderCurrentState(
    facets: Map<string, Facet>,
    config: HUDConfig
  ): string | null {
    const stateParts: string[] = [];
    
    // Render only state facets - ambient facets are handled separately with floating behavior
    for (const [id, facet] of facets) {
      if (facet.type === 'state') {
        const rendered = this.renderFacet(facet);
        if (rendered) stateParts.push(rendered);
      }
    }
    
    return stateParts.length > 0 ? stateParts.join('\n\n') : null;
  }
  
  private buildFrameBasedMessages(
    frameContents: Array<{ type: 'user' | 'agent' | 'system' | 'compressed'; content: string; sequence: number }>,
    currentFacets: Map<string, Facet>,
    config: HUDConfig,
    cacheableUntil: number = 0  // CBD boundary for cache marker placement
  ): { messages: RenderedContext['messages']; frameToMessageIndex: Map<number, number> } {
    const messages: RenderedContext['messages'] = [];
    const frameToMessageIndex = new Map<number, number>();
    
    // Determine if prompt caching is enabled
    const promptCachingEnabled = config.promptCaching?.enabled ?? false;
    
    // Each frame becomes its own message
    for (const frame of frameContents) {
      let role: 'user' | 'assistant' | 'system';
      switch (frame.type) {
        case 'user':
          role = 'user';
          break;
        case 'agent':
          role = 'assistant';
          break;
        case 'system':
          role = 'system';
          break;
        default:
          role = 'assistant';
          break;
      }

      const messageIndex = messages.length;
      frameToMessageIndex.set(frame.sequence, messageIndex);
      
      // Determine if this message should have a cache marker
      // Place marker at CBD boundary (last cacheable frame)
      const shouldCache = promptCachingEnabled && 
                          cacheableUntil > 0 && 
                          frame.sequence === cacheableUntil - 1;
      
      // Build message with optional cache control
      const message: any = {
        role,
        content: frame.content,
        sourceFrames: {
          from: frame.sequence,
          to: frame.sequence
        }
      };
      
      if (shouldCache) {
        message.metadata = {
          cacheControl: {
            type: 'ephemeral' as const
          }
        };
      }
      
      messages.push(message);
    }
    
    // Add floating ambient and state content as system context
    const ambientFacets = this.getAmbientFacets(currentFacets);
    const ambientContent: string[] = [];
    
    for (const [id, facet] of ambientFacets) {
      const rendered = this.renderFacet(facet);
      if (rendered) ambientContent.push(rendered);
    }
    
    // Don't add state content here - states are only rendered in frames where they're added or changed
    const contextParts = [...ambientContent];
    
    // Add pending activations info if present
    if (config.metadata?.pendingActivations) {
      const { count, sources } = config.metadata.pendingActivations;
      const pendingInfo = `<pending_activations>\nThere are ${count} pending activation(s) from: ${sources.join(', ')}\n</pending_activations>`;
      contextParts.push(pendingInfo);
    }
    
    if (contextParts.length > 0) {
      // Add context to the last user message or create a new one
      const contextContent = contextParts.join('\n\n');
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage && lastMessage.role === 'user') {
        // Append to last user message
        lastMessage.content = `${lastMessage.content}\n\n${contextContent}`;
      } else {
        // Create a new user message with context
        messages.push({
          role: 'user',
          content: contextContent
        });
      }
    }
    
    // Apply format config for prefill
    if (config.formatConfig?.assistant?.prefix) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        // Add prefix to existing assistant message
        lastMessage.content = config.formatConfig.assistant.prefix + lastMessage.content;
      } else {
        // Add new assistant message with just the prefix for prefill
        messages.push({
          role: 'assistant',
          content: config.formatConfig.assistant.prefix
        });
      }
    }
    
    return { messages, frameToMessageIndex };
  }
  
  private getAmbientFacets(facets: Map<string, Facet>): Array<[string, Facet]> {
    const ambient: Array<[string, Facet]> = [];
    for (const [id, facet] of facets) {
      if (facet.type === 'ambient') {
        ambient.push([id, facet]);
      }
    }
    return ambient;
  }
  
  private insertFloatingAmbient(
    renderedParts: string[],
    ambientFacets: Array<[string, Facet]>,
    preferredDepth: number = 5
  ): string[] {
    if (ambientFacets.length === 0 || renderedParts.length === 0) {
      return renderedParts;
    }
    
    // Calculate insertion position for floating ambient
    const insertPosition = Math.max(0, renderedParts.length - preferredDepth);
    
    // Create a new array with ambient facets inserted
    const result = [...renderedParts];
    const ambientContent: string[] = [];
    
    for (const [id, facet] of ambientFacets) {
      const rendered = this.renderFacet(facet);
      if (rendered) ambientContent.push(rendered);
    }
    
    if (ambientContent.length > 0) {
      result.splice(insertPosition, 0, ambientContent.join('\n\n'));
    }
    
    return result;
  }
  
  private extractFacetIds(frame: Frame): string[] {
    const ids: string[] = [];
    
    for (const op of frame.deltas) {
      if (op.type === 'addFacet') {
        ids.push(op.facet.id);
      } else if (op.type === 'rewriteFacet' || op.type === 'removeFacet') {
        ids.push(op.id);
      }
    }
    
    return ids;
  }
  
  private sanitizeTagName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  }
  

  private cloneFacet(facet: Facet): Facet {
    const cloned = { ...facet } as Facet;

    if (hasStateAspect(facet)) {
      (cloned as Facet & { state: Record<string, unknown> }).state = {
        ...facet.state
      };
    }

    if (Array.isArray((facet as any)?.children)) {
      (cloned as any).children = ((facet as any).children as Facet[]).map(child =>
        this.cloneFacet(child)
      );
    }

    return cloned;
  }

  private mergeFacetChanges(existing: Facet, changes: Partial<Facet>): Facet {
    const merged = { ...existing, ...changes } as Facet;
    const changeRecord = changes as Record<string, unknown>;

    if ('state' in changeRecord && changeRecord.state && typeof changeRecord.state === 'object') {
      const newState = changeRecord.state as Record<string, unknown>;
      if (hasStateAspect(existing)) {
        (merged as Facet & { state: Record<string, unknown> }).state = {
          ...existing.state,
          ...newState
        };
      } else {
        (merged as any).state = { ...newState };
      }
    }

    if ('content' in changeRecord && typeof changeRecord.content === 'string') {
      (merged as any).content = changeRecord.content;
    }

    if ('children' in changeRecord && Array.isArray(changeRecord.children)) {
      (merged as any).children = changeRecord.children;
    }

    if ('displayName' in changeRecord) {
      (merged as any).displayName = changeRecord.displayName;
    }

    return merged;
  }
  
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  
  estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }
  
  /**
   * Render a single frame and capture as a chunked snapshot
   * 
   * This uses the shared rendering path (renderFrameAsChunks) to ensure
   * snapshots match actual rendering exactly.
   * 
   * @param frame - The frame to render
   * @param currentFacets - Current VEIL state facets
   * @param replayedState - Optional replayed state (for context)
   * @returns Snapshot with chunked content and facet attribution
   */
  captureFrameSnapshot(
    frame: Frame,
    currentFacets: Map<string, Facet>,
    replayedState?: Map<string, Facet>
  ): FrameRenderedSnapshot {
    const source = this.getFrameSource(frame);
    const stateToUse = replayedState || new Map(currentFacets);
    
    // Use the shared rendering path - single source of truth!
    const chunks = this.renderFrameAsChunks(frame, source, stateToUse);
    
    // Build snapshot
    const totalContent = chunks.map(c => c.content).join('');
    const totalTokens = chunks.reduce((sum, c) => sum + c.tokens, 0);
    
    return {
      chunks,
      totalContent,
      totalTokens,
      capturedAt: Date.now()
    };
  }
  
  parseCompletion(completion: string): {
    operations: OutgoingVEILOperation[];
    hasMoreToSay: boolean;
  } {
    // TODO: Implement parsing
    return {
      operations: [],
      hasMoreToSay: false
    };
  }
  
  needsCompression(frames: Frame[], config: HUDConfig): boolean {
    // Simple check based on frame count or estimated tokens
    return frames.length > 50;
  }
  
  getFormat(): string {
    return 'xml';
  }
}
