/**
 * ContextTransform - A Transform that renders context for agent activations
 * 
 * This is the new architecture version of FrameTrackingHUD.
 * It runs during Phase 2 of frame processing and creates ephemeral
 * rendered-context facets for any pending agent activations.
 */

import { BaseTransform } from '../components/base-martem';
import { Transform, ReadonlyVEILState } from '../spaces/receptor-effector-types';
import { Facet, hasStateAspect, VEILDelta } from '../veil/types';
import { FrameTrackingHUD } from './frame-tracking-hud';
import { CompressionEngine } from '../compression/types-v2';
import { HUDConfig } from './types-v2';
import { VEILStateManager } from '../veil/veil-state';

export interface ContextTransformConfig {
  compressionEngine?: CompressionEngine;
  defaultOptions?: Partial<HUDConfig>;
}

export class ContextTransform extends BaseTransform {
  // Priority: Run after compression (which has priority 10)
  // TODO [constraint-solver]: Replace with requires = ['compressed-frames']
  priority = 100;
  
  private hud: FrameTrackingHUD;
  private compressionEngine?: CompressionEngine;
  private defaultOptions?: Partial<HUDConfig>;
  
  constructor(config: ContextTransformConfig = {}) {
    super();
    this.compressionEngine = config.compressionEngine;
    this.defaultOptions = config.defaultOptions;
    this.hud = new FrameTrackingHUD();
  }
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    // console.log(`[ContextTransform] process() called with ${state.facets.size} facets`);
    
    // Find activation facets that need context
    for (const [id, facet] of state.facets) {
      if (facet.type === 'agent-activation' && hasStateAspect(facet)) {
        // console.log(`[ContextTransform] Found agent-activation facet: ${id}`);
        const activationState = facet.state as Record<string, any>;
        // Skip if context already rendered for this activation
        const contextExists = Array.from(state.facets.values()).some(f => 
          f.type === 'rendered-context' &&
          hasStateAspect(f) &&
          (f.state as Record<string, any>).activationId === id
        );
        
        if (contextExists) {
          // console.log(`[ContextTransform] Skipping ${id} - context already exists`);
          continue;
        }
        
        // console.log(`[ContextTransform] Rendering context for activation ${id}...`);
        
        // Get agent-specific options from activation
        const agentOptions = this.buildAgentOptions(activationState);
        
        // Get VEILStateManager from Space
        const space = this.space;
        // console.log(`[ContextTransform] Space:`, !!space, 'hasVEILStateManager:', !!(space?.getVEILStateManager));
        
        if (!space || !space.getVEILStateManager) {
          console.error('[ContextTransform] Cannot access VEILStateManager - component not attached to Space');
          console.error('[ContextTransform] Component:', this.id, 'Space:', space?.id);
          continue;
        }
        
        const veilStateManager = space.getVEILStateManager();
        // console.log(`[ContextTransform] Got VEILStateManager, current sequence:`, veilStateManager.getState().currentSequence);
        
        // Render context using the existing HUD logic
        const fullState = veilStateManager.getState();
        
        // Get current frame from Space to include in rendering
        // This is critical: during Phase 2, the current frame hasn't been finalized
        // to frameHistory yet, so we need to explicitly include it
        const currentFrame = space?.getCurrentFrame();
        
        // Combine frameHistory with current frame so agent sees everything
        const allFrames = [...fullState.frameHistory];
        if (currentFrame) {
          // Only add if not already in history (avoid duplicates)
          const isAlreadyInHistory = fullState.frameHistory.some((f: any) => f.sequence === currentFrame.sequence);
          if (!isAlreadyInHistory) {
            allFrames.push(currentFrame);
          }
        }
        
        const context = this.hud.render(
          allFrames,
          fullState.facets,
          veilStateManager,
          this.compressionEngine,
          agentOptions
        );
        
        // Store the full rendered context object in state
        // The agent needs the message array with roles
        const contextFacetId = `context-${id}-${Date.now()}`;
        // console.log(`[ContextTransform] Creating rendered-context facet: ${contextFacetId}`);
        
        deltas.push({
          type: 'addFacet',
          facet: {
            id: contextFacetId,
            type: 'rendered-context',
            state: {
              activationId: id,
              tokenCount: context.metadata.totalTokens,
              context: context // Store the full RenderedContext object
            }
            // Not ephemeral - valuable for debugging what context agent saw
          }
        });
        
        // console.log(`[ContextTransform] Rendered context with ${context.metadata.totalTokens} tokens for activation ${id}`);
      }
    }
    
    // console.log(`[ContextTransform] Returning ${deltas.length} deltas`);
    return deltas;
  }
  
  private buildAgentOptions(activationState: Record<string, any>): HUDConfig {
    const options: HUDConfig = {
      ...this.defaultOptions,
      // Agent-specific overrides from activation
      systemPrompt: activationState.systemPrompt || this.defaultOptions?.systemPrompt,
      maxTokens: activationState.maxTokens || this.defaultOptions?.maxTokens || 4000,
      metadata: this.defaultOptions?.metadata
    };
    
    // Set focused stream from activation's streamRef
    if (activationState.streamRef?.streamId) {
      options.renderContext = {
        ...this.defaultOptions?.renderContext,
        focusedStream: activationState.streamRef.streamId
      };
    }
    
    // Format configuration for agent output
    if (activationState.targetAgentId) {
      options.formatConfig = {
        assistant: {
          prefix: '<my_turn>\n',
          suffix: '\n</my_turn>'
        }
      };
    }

    return options as HUDConfig;
  }
}
