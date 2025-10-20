/**
 * Types for context-aware rendering and caching
 * 
 * Renders can vary based on context (focused stream, compression state, display mode).
 * These types capture the rendering context for cache keying.
 */

/**
 * Context that affects how frames are rendered
 * Different contexts produce different renderings of the same frames
 */
export interface RenderContext {
  /**
   * Which stream is currently in focus
   * Affects whether frames render detailed (focused) or minimal (unfocused)
   */
  focusedStream?: string;
  
  /**
   * Hash of compression state
   * Different compression states produce different renderings
   */
  compressionState: string;
  
  /**
   * Display mode for rendering
   * How verbose/detailed to render content
   */
  displayMode?: 'full' | 'focused' | 'ambient';
  
  /**
   * Additional context parameters for future extensibility
   */
  extensions?: Record<string, any>;
}

/**
 * A cached render of a frame in a specific context
 */
export interface CachedFrameRender {
  /**
   * Which frame this is
   */
  frameSequence: number;
  
  /**
   * The context it was rendered in
   */
  context: RenderContext;
  
  /**
   * The rendered content (actual text sent to LLM)
   */
  renderedContent: string;
  
  /**
   * Frame type/source
   */
  frameType: 'user' | 'agent' | 'system' | 'compressed';
  
  /**
   * Estimated token count
   */
  tokens: number;
  
  /**
   * Which facets were included in the rendering
   */
  facetIds: string[];
  
  /**
   * When this was cached
   */
  cachedAt: number;
}

/**
 * Statistics for monitoring cache performance
 */
export interface RenderCacheStats {
  /**
   * Total cache hits
   */
  hits: number;
  
  /**
   * Total cache misses
   */
  misses: number;
  
  /**
   * Number of different contexts cached
   */
  contextCount: number;
  
  /**
   * Total frames cached across all contexts
   */
  totalFramesCached: number;
  
  /**
   * Estimated memory usage
   */
  memoryEstimateBytes: number;
  
  /**
   * Hit rate (hits / total queries)
   */
  hitRate: number;
}

/**
 * Configuration for render cache
 */
export interface RenderCacheConfig {
  /**
   * Maximum number of contexts to cache (LRU eviction)
   * Default: 10
   */
  maxContexts?: number;
  
  /**
   * Enable statistics tracking
   * Default: true
   */
  enableStats?: boolean;
  
  /**
   * Enable verbose logging
   * Default: false
   */
  verbose?: boolean;
}

