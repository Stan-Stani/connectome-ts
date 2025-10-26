# AXON Support for Receptor/Effector/Transform/Maintainer (RETM) Architecture

## Overview
Extend AXON to allow modules to export Receptors, Effectors, Transforms, and Maintainers in addition to Components.

## Design Goals
1. **Backward Compatibility**: Existing AXON components continue to work
2. **Clean Separation**: AXON modules can export pure functions (Receptors/Transforms) separately from stateful services (Effectors/Maintainers)
3. **Type Safety**: Full TypeScript support for AXON RETM modules
4. **Hot Reload**: Support hot reloading for all RETM types
5. **Discovery**: Manifest describes what types are exported

## Manifest Extensions

### Current Manifest
```typescript
interface IAxonManifest {
  name: string;
  version: string;
  main: string;
  componentClass?: string;  // For component-based modules
  actions?: Record<string, ActionDefinition>;
  dependencies?: Array<{ name: string; manifest: string }>;
}
```

### Extended Manifest
```typescript
interface IAxonManifestV2 extends IAxonManifest {
  // New fields for RETM exports
  exports?: {
    components?: string[];      // Component class names
    receptors?: string[];       // Receptor class/function names
    effectors?: string[];       // Effector class names
    transforms?: string[];      // Transform class/function names
    maintainers?: string[];     // Maintainer class names
  };
  
  // Metadata for each export
  metadata?: {
    [exportName: string]: {
      description?: string;
      topics?: string[];        // For Receptors
      facetFilters?: any[];    // For Effectors
      requirements?: string[];  // External dependencies needed
    };
  };
}
```

## Module Structure

### Example: Discord AXON as RETM

```typescript
// discord-axon-retm.ts
export function createModule(env: IAxonEnvironment) {
  const { persistent, external } = env;
  
  // Receptor: Discord messages → Facets
  class DiscordMessageReceptor implements env.Receptor {
    topics = ['discord:message'];
    
    transform(event: env.SpaceEvent, state: env.ReadonlyVEILState): env.VEILDelta[] {
      const { channelId, author, content, messageId } = event.payload;
      
      return [{
        type: 'addFacet',
        facet: env.createEventFacet({
          content: `${author}: ${content}`,
          source: event.source,
          agentId: 'discord',
          streamId: channelId,
          metadata: { messageId, author }
        })
      }];
    }
  }
  
  // Effector: Speech facets → Discord messages
  class DiscordSpeechEffector implements env.Effector {
    facetFilters = [{ type: 'speech', streamId: /^discord:/ }];
    
    @persistent
    private wsUrl: string = '';
    
    @external('secret:discord.token')
    private token?: string;
    
    private ws?: WebSocket;
    
    async process(changes: env.FacetDelta[], state: env.ReadonlyVEILState): Promise<env.EffectorResult> {
      const events: env.SpaceEvent[] = [];
      const externalActions = [];
      
      for (const change of changes) {
        if (change.type === 'added' && change.facet.type === 'speech') {
          const speech = change.facet as env.SpeechFacet;
          const channelId = speech.streamId.replace('discord:', '');
          
          // Send to Discord
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'send',
              channelId,
              message: speech.content
            }));
            
            externalActions.push({
              type: 'discord-send',
              description: `Sent message to Discord channel ${channelId}`,
              channelId,
              content: speech.content
            });
          }
        }
      }
      
      return { events, externalActions };
    }
  }
  
  // Transform: Add Discord metadata to facets
  class DiscordMetadataTransform implements env.Transform {
    process(state: env.ReadonlyVEILState): env.VEILDelta[] {
      const deltas: env.VEILDelta[] = [];
      
      // Add Discord metadata to facets missing it
      for (const [id, facet] of state.facets) {
        if (facet.streamId?.startsWith('discord:') && !facet.metadata?.platform) {
          deltas.push({
            type: 'changeFacet',
            id,
            changes: {
              metadata: {
                ...facet.metadata,
                platform: 'discord'
              }
            }
          });
        }
      }
      
      return deltas;
    }
  }
  
  // Maintainer: Manage Discord connection state
  class DiscordConnectionMaintainer implements env.Maintainer {
    maintain(state: env.ReadonlyVEILState): env.SpaceEvent[] {
      // Check connection health facets
      const connectionFacets = state.getFacetsByType('discord-connection');
      
      // Emit reconnection events if needed
      const events: env.SpaceEvent[] = [];
      
      for (const facet of connectionFacets) {
        if (facet.state.status === 'disconnected' && facet.state.shouldReconnect) {
          events.push({
            topic: 'discord:reconnect',
            source: { elementId: 'discord-maintainer', elementPath: [] },
            timestamp: Date.now(),
            payload: { connectionId: facet.id }
          });
        }
      }
      
      return events;
    }
  }
  
  // Export all types
  return {
    // Traditional component (for backward compatibility)
    DiscordComponent: createLegacyComponent(env),
    
    // New RETM exports
    receptors: {
      DiscordMessageReceptor
    },
    effectors: {
      DiscordSpeechEffector
    },
    transforms: {
      DiscordMetadataTransform
    },
    maintainers: {
      DiscordConnectionMaintainer
    }
  };
}
```

## AXON Environment Extensions

```typescript
interface IAxonEnvironmentV2 extends IAxonEnvironment {
  // Add RETM interfaces
  Receptor: typeof Receptor;
  Effector: typeof Effector;
  Transform: typeof Transform;
  Maintainer: typeof Maintainer;
  
  // Add helper types
  VEILDelta: typeof VEILDelta;
  FacetDelta: typeof FacetDelta;
  ReadonlyVEILState: typeof ReadonlyVEILState;
  EffectorResult: typeof EffectorResult;
  
  // Add factory functions
  createEventFacet: typeof createEventFacet;
  createSpeechFacet: typeof createSpeechFacet;
  createStateFacet: typeof createStateFacet;
  // ... other facet factories
}
```

## AxonLoader Extensions

The AxonLoaderComponent needs to handle RETM exports:

```typescript
class AxonLoaderComponent extends Component {
  // ... existing code ...
  
  private async loadAndRegister(): Promise<void> {
    const module = await this.loadModule();
    
    // Handle traditional component
    if (module.default || typeof module === 'function') {
      await this.loadComponent(module);
      return;
    }
    
    // Handle RETM exports
    const space = this.element.findSpace();
    if (!space) throw new Error('Element not attached to space');
    
    // Register receptors
    if (module.receptors) {
      for (const [name, ReceptorClass] of Object.entries(module.receptors)) {
        const receptor = new ReceptorClass();
        space.addReceptor(receptor);
        console.log(`[AxonLoader] Registered receptor: ${name}`);
      }
    }
    
    // Register effectors
    if (module.effectors) {
      for (const [name, EffectorClass] of Object.entries(module.effectors)) {
        const effector = new EffectorClass();
        space.addEffector(effector);
        console.log(`[AxonLoader] Registered effector: ${name}`);
      }
    }
    
    // Register transforms
    if (module.transforms) {
      for (const [name, TransformClass] of Object.entries(module.transforms)) {
        const transform = new TransformClass();
        space.addTransform(transform);
        console.log(`[AxonLoader] Registered transform: ${name}`);
      }
    }
    
    // Register maintainers
    if (module.maintainers) {
      for (const [name, MaintainerClass] of Object.entries(module.maintainers)) {
        const maintainer = new MaintainerClass();
        space.addMaintainer(maintainer);
        console.log(`[AxonLoader] Registered maintainer: ${name}`);
      }
    }
  }
}
```

## Benefits

1. **Cleaner Architecture**: AXON modules can be pure functions (Receptors/Transforms) or services (Effectors/Maintainers)
2. **Better Testing**: Pure functions are easier to test
3. **Performance**: No double conversion (Component → Event → Receptor)
4. **Modularity**: Can load just the parts you need
5. **Type Safety**: Full TypeScript support with proper interfaces

## Migration Strategy

### Phase 1: Add RETM Support
1. Extend AXON environment with RETM interfaces
2. Update AxonLoader to handle RETM exports
3. Update manifest format to support exports metadata

### Phase 2: Create Examples
1. Convert Discord AXON to use RETM pattern
2. Create simpler example modules
3. Document best practices

### Phase 3: Tooling
1. Add hot reload support for RETM modules
2. Create development tools for testing RETM modules
3. Add manifest validation

## Example Usage

```typescript
// Load a RETM AXON module
const loader = new AxonLoaderComponent();
loader.manifestUrl = 'axon://discord.server/modules/discord-retm/manifest';
await loader.connect();

// The loader automatically registers all exported RETM components with the space
// No need to manually create components!

