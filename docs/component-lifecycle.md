# Component Lifecycle: Three-Phase Model

## Overview

Components in Connectome now follow a three-phase lifecycle model to properly handle both creation and restoration scenarios. This solves the problem of components trying to connect to external services before they're ready during restoration.

## The Three Phases

### 1. `onInit()` - Initialization Phase
Called when a component is first created (either new or from persistence).
- Use for basic initialization that doesn't require external resources
- Set up internal state, prepare data structures
- This runs for ALL components regardless of how they're created

```typescript
onInit(): void {
  // Initialize internal state
  this.data = new Map();
  this.isReady = false;
}
```

### 2. `onRestore()` - Restoration Phase  
Called ONLY when a component is being restored from persistence.
- Use for restoration-specific setup
- Access persisted properties (already loaded via @persistent)
- Don't connect to external services yet - they may not be running

```typescript
onRestore(): void {
  // Log what we're restoring with
  if (this.savedUrl) {
    console.log(`Will reconnect to ${this.savedUrl} when ready`);
  }
  // Prepare any restoration-specific state
  this.needsReconnection = true;
}
```

### 3. `onMount()` - Ready Phase
Called when the component is fully ready and external services are available.
- For new components: Called immediately after `onInit`
- For restored components: Called after the application's `onRestore()` completes
- Use for connecting to external services, starting operations

```typescript
async onMount(): Promise<void> {
  // Now safe to connect to external services
  if (this.savedUrl) {
    await this.connect(this.savedUrl);
  }
  // Start any active operations
  this.startPolling();
}
```

## Lifecycle Flow

### New Component Creation:
```
new Component() → _attach() → onInit() → onMount() → onEnable()
```

### Component Restoration:
```
restore from persistence → _attach(isRestoring=true) → onInit() → onRestore() 
→ [wait for app.onRestore()] → _completeMount() → onMount() → onEnable()
```

## Real Example: AxonLoaderComponent

```typescript
export class AxonLoaderComponent extends Component {
  @persistent()
  private axonUrl?: string;
  
  private loadedComponent?: Component;
  
  /**
   * Basic initialization
   */
  onInit(): void {
    // Set up any internal state
    this.loadedDependencies = new Map();
  }
  
  /**
   * Called during restoration
   */
  onRestore(): void {
    if (this.axonUrl) {
      console.log(`[AxonLoader] Restored with URL ${this.axonUrl}, will connect when ready`);
    }
  }
  
  /**
   * Called when ready to operate
   */
  async onMount(): Promise<void> {
    // Now safe to connect to external AXON server
    if (this.axonUrl && !this.loadedComponent) {
      console.log(`[AxonLoader] Connecting to ${this.axonUrl}`);
      try {
        await this.connect(this.axonUrl);
        console.log(`[AxonLoader] Successfully connected`);
      } catch (error) {
        console.error(`[AxonLoader] Failed to connect:`, error);
        // Don't throw - allow graceful degradation
      }
    }
  }
}
```

## Benefits

1. **No More Connection Failures**: Components don't try to connect during restoration when services aren't ready
2. **Clear Separation**: Each phase has a clear purpose
3. **Backward Compatible**: Existing components that only implement `onMount()` continue to work
4. **Better Error Handling**: Connection failures don't break restoration

## Migration Guide

For existing components that connect to external services in `onMount()`:

1. Move connection logic to stay in `onMount()` 
2. Add `onRestore()` if you need restoration-specific behavior
3. Add `onInit()` for any initialization that should happen regardless of how the component is created

The system is backward compatible - if you don't implement `onInit()` or `onRestore()`, they simply won't be called.
