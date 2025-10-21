/**
 * Frame Render Cache - Layer 2 Caching
 * 
 * Caches rendered frame text per-context to avoid re-rendering.
 * Complements VEILStateManager's state cache (Layer 1).
 * 
 * Layer 1: Frame → State (cached by VEILStateManager)
 * Layer 2: (Frame, Context) → Rendered text (cached here)
 */

import {
  RenderContext,
  CachedFrameRender,
  RenderCacheStats,
  RenderCacheConfig
} from './render-context-types';

export class FrameRenderCache {
  // Cache structure: Map<contextKey, Map<frameSequence, CachedRender>>
  private cache = new Map<string, Map<number, CachedFrameRender>>();
  
  // LRU tracking: most recently accessed context keys
  private accessLog: string[] = [];
  
  // Statistics
  private stats = {
    hits: 0,
    misses: 0
  };
  
  private config: Required<RenderCacheConfig>;
  
  constructor(config: RenderCacheConfig = {}) {
    this.config = {
      maxContexts: config.maxContexts ?? 10,
      enableStats: config.enableStats ?? true,
      verbose: config.verbose ?? false
    };
  }
  
  /**
   * Compute stable context key for caching
   */
  computeContextKey(context: RenderContext): string {
    const focus = context.focusedStream || 'none';
    const comp = context.compressionState;
    const mode = context.displayMode || 'full';
    const ext = context.extensions ? JSON.stringify(context.extensions) : '';
    
    return `focus:${focus}:comp:${comp}:mode:${mode}${ext ? ':ext:' + ext : ''}`;
  }
  
  /**
   * Get cached render for a frame in a context
   */
  get(context: RenderContext, frameSequence: number): CachedFrameRender | null {
    const contextKey = this.computeContextKey(context);
    const frameCache = this.cache.get(contextKey);
    
    if (!frameCache) {
      this.recordMiss();
      return null;
    }
    
    const cached = frameCache.get(frameSequence);
    
    if (!cached) {
      this.recordMiss();
      return null;
    }
    
    // Update LRU
    this.touchContext(contextKey);
    
    this.recordHit();
    
    if (this.config.verbose) {
      console.log(`[FrameRenderCache] ✓ Hit: frame ${frameSequence} in ${contextKey}`);
    }
    
    return cached;
  }
  
  /**
   * Store rendered frame in cache
   */
  set(context: RenderContext, frameSequence: number, render: CachedFrameRender): void {
    const contextKey = this.computeContextKey(context);
    
    // Get or create frame cache for this context
    let frameCache = this.cache.get(contextKey);
    if (!frameCache) {
      frameCache = new Map();
      this.cache.set(contextKey, frameCache);
      
      if (this.config.verbose) {
        console.log(`[FrameRenderCache] New context: ${contextKey}`);
      }
    }
    
    // Store render
    frameCache.set(frameSequence, render);
    
    // Update LRU
    this.touchContext(contextKey);
    
    // Evict old contexts if needed
    this.evictLRUIfNeeded();
    
    if (this.config.verbose) {
      console.log(`[FrameRenderCache] Cached frame ${frameSequence} in ${contextKey}`);
    }
  }
  
  /**
   * Invalidate a specific frame across ALL contexts
   * Use when a frame is modified (exotemporal changes)
   */
  invalidateFrame(frameSequence: number): void {
    let invalidatedCount = 0;
    
    for (const [contextKey, frameCache] of this.cache) {
      if (frameCache.delete(frameSequence)) {
        invalidatedCount++;
      }
    }
    
    if (this.config.verbose && invalidatedCount > 0) {
      console.log(`[FrameRenderCache] Invalidated frame ${frameSequence} across ${invalidatedCount} contexts`);
    }
  }
  
  /**
   * Invalidate a range of frames across ALL contexts
   */
  invalidateRange(fromSequence: number, toSequence: number): void {
    let invalidatedCount = 0;
    
    for (const [contextKey, frameCache] of this.cache) {
      for (let seq = fromSequence; seq <= toSequence; seq++) {
        if (frameCache.delete(seq)) {
          invalidatedCount++;
        }
      }
    }
    
    if (this.config.verbose && invalidatedCount > 0) {
      console.log(`[FrameRenderCache] Invalidated frames ${fromSequence}-${toSequence}, removed ${invalidatedCount} entries`);
    }
  }
  
  /**
   * Invalidate all frames in a specific context
   */
  invalidateContext(context: RenderContext): void {
    const contextKey = this.computeContextKey(context);
    const deleted = this.cache.delete(contextKey);
    
    // Remove from access log
    const index = this.accessLog.indexOf(contextKey);
    if (index !== -1) {
      this.accessLog.splice(index, 1);
    }
    
    if (deleted && this.config.verbose) {
      console.log(`[FrameRenderCache] Invalidated context: ${contextKey}`);
    }
  }
  
  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.accessLog = [];
    this.stats.hits = 0;
    this.stats.misses = 0;
    
    if (this.config.verbose) {
      console.log('[FrameRenderCache] Cleared entire cache');
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats(): RenderCacheStats {
    const totalFrames = Array.from(this.cache.values())
      .reduce((sum, frameCache) => sum + frameCache.size, 0);
    
    // Estimate memory: ~600 bytes per cached frame
    const memoryEstimate = totalFrames * 600;
    
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;
    
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      contextCount: this.cache.size,
      totalFramesCached: totalFrames,
      memoryEstimateBytes: memoryEstimate,
      hitRate
    };
  }
  
  /**
   * Get all cached context keys (for debugging)
   */
  getContextKeys(): string[] {
    return Array.from(this.cache.keys());
  }
  
  /**
   * Check if a context exists in cache
   */
  hasContext(context: RenderContext): boolean {
    const contextKey = this.computeContextKey(context);
    return this.cache.has(contextKey);
  }
  
  /**
   * Get number of frames cached for a specific context
   */
  getContextFrameCount(context: RenderContext): number {
    const contextKey = this.computeContextKey(context);
    const frameCache = this.cache.get(contextKey);
    return frameCache ? frameCache.size : 0;
  }
  
  // Private helpers
  
  private touchContext(contextKey: string): void {
    // Remove from access log if present
    const index = this.accessLog.indexOf(contextKey);
    if (index !== -1) {
      this.accessLog.splice(index, 1);
    }
    
    // Add to end (most recently used)
    this.accessLog.push(contextKey);
  }
  
  private evictLRUIfNeeded(): void {
    if (this.cache.size <= this.config.maxContexts) {
      return;
    }
    
    // Evict least recently used context
    const lruContext = this.accessLog.shift();
    
    if (lruContext && this.cache.has(lruContext)) {
      const frameCount = this.cache.get(lruContext)?.size || 0;
      this.cache.delete(lruContext);
      
      if (this.config.verbose) {
        console.log(`[FrameRenderCache] Evicted LRU context: ${lruContext} (${frameCount} frames)`);
      }
    }
  }
  
  private recordHit(): void {
    if (this.config.enableStats) {
      this.stats.hits++;
    }
  }
  
  private recordMiss(): void {
    if (this.config.enableStats) {
      this.stats.misses++;
    }
  }
}
