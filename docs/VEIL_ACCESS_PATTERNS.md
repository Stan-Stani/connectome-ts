# VEIL Access Patterns - Encapsulation Proposal

## Current Problem

Direct access to `state.facets` Map is scattered across 42+ call sites in 13 files. This:
- Exposes implementation details (Map structure, whether children are flattened)
- Makes refactoring difficult (change storage → update 42 places)
- Hides semantic intent (what are we looking for?)
- Requires knowledge of facet ID naming conventions

## Current Access Patterns

### 1. Direct ID Lookup
```typescript
const botConfigFacet = state.facets.get('discord-config-botUserId');
const botUserId = botConfigFacet?.state?.value;
```

### 2. Type Filtering
```typescript
const veilMessages = Array.from(state.facets.values()).filter(
  f => f.type === 'event' && 
       f.state?.eventType === 'discord-message' &&
       f.attributes?.channelId === channelId
);
```

### 3. Existence Checking
```typescript
if (state.facets.has(facetId)) {
  // ...
}
```

### 4. Child Navigation (Currently Requires Flattening)
```typescript
const speechFacetId = `speech-${messageId}`;
const speechFacet = state.facets.get(speechFacetId);  // Expects child in flat Map
```

### 5. State Value Access
```typescript
const lastReadFacet = state.facets.get(`discord-lastread-${channelId}`);
const lastMessageId = lastReadFacet?.state?.value;
```

## Proposed Convenience API

### VEIL Core API (Platform-Level Only)

**Principle**: VEIL core should be domain-agnostic. No Discord/Minecraft/SpaceGame concepts.

```typescript
interface ReadonlyVEILState {
  // Direct lookup
  getFacet(id: string): Facet | undefined;
  hasFacet(id: string): boolean;
  
  // Type-based queries
  getFacetsByType(type: FacetType): Facet[];
  getEventFacets(eventType: string): Facet[];
  
  // Hierarchy navigation (generic - works for any nested facets)
  getChildFacet(parentId: string, predicate: (f: Facet) => boolean): Facet | undefined;
  getChildrenFacets(parentId: string): Facet[];
  findInChildren(parentId: string, predicate: (f: Facet) => boolean): Facet | undefined;
  
  // Platform patterns (used by framework, not domain-specific)
  getConfig(key: string): any | undefined;
  getStateValue<T>(facetId: string): T | undefined;
  getElementTree(elementId: string): Facet | undefined;
  
  // Stream/scope filtering
  getFacetsInStream(streamId: string): Facet[];
  getFacetsInScope(scopeId: string): Facet[];
  
  // Complex queries (generic filtering)
  findFacets(filter: FacetFilter): Facet[];
}

interface FacetFilter {
  type?: FacetType | FacetType[];
  eventType?: string;
  streamId?: string;
  hasChildren?: boolean;
  attributeMatch?: Record<string, any>;
  stateMatch?: Record<string, any>;
}
```

### Application Layer Helpers (Domain-Specific)

Each application/axon can define its own helpers on top of VEIL core:

```typescript
// discord-axon/src/veil-helpers.ts
export class DiscordVEILHelpers {
  constructor(private state: ReadonlyVEILState) {}
  
  // Discord-specific accessors
  getMessage(messageId: string): Facet | undefined {
    return this.state.getFacet(`discord-msg-${messageId}`);
  }
  
  getMessageContent(messageId: string): string {
    const msg = this.getMessage(messageId);
    // Navigate to nested speech child (no flattening needed!)
    const speechFacet = msg?.children?.[0];
    return speechFacet?.content || '';
  }
  
  getBotUserId(): string | undefined {
    return this.state.getConfig('botUserId');
  }
  
  getMessagesInChannel(channelId: string): Facet[] {
    return this.state.findFacets({
      type: 'event',
      eventType: 'discord-message',
      attributeMatch: { channelId }
    });
  }
  
  getLastReadForChannel(channelId: string): string | undefined {
    return this.state.getStateValue(`discord-lastread-${channelId}`);
  }
}

// Usage in receptors/effectors:
const discord = new DiscordVEILHelpers(state);
const content = discord.getMessageContent(messageId);
```

**Benefits of Layering:**
- ✅ VEIL core stays generic and reusable
- ✅ Domain knowledge lives in application layer
- ✅ Each axon can define its own helpers
- ✅ Clear separation of concerns
```

### Usage Examples

**Before:**
```typescript
const botConfigFacet = state.facets.get('discord-config-botUserId');
const botUserId = botConfigFacet?.state?.value;
```

**After:**
```typescript
const botUserId = state.getConfig('botUserId');
```

---

**Before:**
```typescript
const speechFacetId = `speech-${messageId}`;
const speechFacet = state.facets.get(speechFacetId);  // Requires flattening!
const veilContent = speechFacet?.content || '';
```

**After (using application helper):**
```typescript
const discord = new DiscordVEILHelpers(state);
const veilContent = discord.getMessageContent(messageId);
```

**After (using core navigation - no helper needed):**
```typescript
const messageFacet = state.getFacet(`discord-msg-${messageId}`);
const speechFacet = messageFacet?.children?.[0];  // Navigate, don't flatten
const veilContent = speechFacet?.content || '';
```

---

**Before:**
```typescript
const veilMessages = Array.from(state.facets.values()).filter(
  f => f.type === 'event' && 
       f.state?.eventType === 'discord-message' &&
       f.attributes?.channelId === channelId
);
```

**After:**
```typescript
const veilMessages = state.findFacets({
  type: 'event',
  eventType: 'discord-message',
  attributeMatch: { channelId }
});
```

---

**Before:**
```typescript
const rootTreeFacet = state.facets.get('element-tree-root');
const components = rootTreeFacet?.state?.components || [];
```

**After:**
```typescript
const components = state.getElementTree('root')?.state?.components || [];
// OR
const components = state.getElementComponents('root');
```

## Benefits

### 1. Encapsulation
- Hide whether children are flattened or nested
- Allow internal storage optimization without breaking callers
- Could switch from Map to indexed structure

### 2. Semantic Clarity
```typescript
// Current - what are we looking for?
const facet = state.facets.get('discord-config-botUserId');

// Proposed - clear intent
const botUserId = state.getConfig('botUserId');
```

### 3. Type Safety
```typescript
getStateValue<T>(facetId: string): T | undefined;
getConfig(key: string): any | undefined;
```

### 4. Performance Opportunities
```typescript
// Could add indexing
private typeIndex: Map<FacetType, Set<string>>;
private eventTypeIndex: Map<string, Set<string>>;

getFacetsByType(type: FacetType): Facet[] {
  const ids = this.typeIndex.get(type) || new Set();
  return Array.from(ids).map(id => this.facets.get(id)!);
}
```

### 5. Easier Refactoring
- Remove flattening? Just change `getChildFacet` implementation
- Add caching? Transparent to callers
- Change ID scheme? Update helpers, not 42 call sites

## Implementation Locations

### Option A: Methods on ReadonlyVEILState
```typescript
// In veil-state.ts
export class VEILStateManager {
  // ...existing code...
  
  // Add convenience methods
  getFacet(id: string): Facet | undefined {
    return this.state.facets.get(id);
  }
  
  getConfig(key: string): any | undefined {
    const facet = this.state.facets.get(`discord-config-${key}`);
    return facet?.state?.value;
  }
  
  // ...etc
}
```

### Option B: Separate QueryHelper class
```typescript
// New file: veil/veil-queries.ts
export class VEILQueryHelper {
  constructor(private state: ReadonlyVEILState) {}
  
  getFacet(id: string): Facet | undefined {
    return this.state.facets.get(id);
  }
  
  // ...etc
}

// Usage:
const query = new VEILQueryHelper(state);
const botUserId = query.getConfig('botUserId');
```

### Option C: Static helper functions
```typescript
// veil/facet-queries.ts
export function getFacet(state: ReadonlyVEILState, id: string): Facet | undefined {
  return state.facets.get(id);
}

export function getChildFacet(state: ReadonlyVEILState, parentId: string, childId: string): Facet | undefined {
  const parent = state.facets.get(parentId);
  return parent?.children?.find(c => c.id === childId);
}
```

## Migration Path

### Phase 1: Add helpers (non-breaking)
- Create helper methods
- Add tests
- No changes to existing code yet

### Phase 2: Gradual migration
- Replace direct access one module at a time
- Can mix old and new during transition

### Phase 3: Remove flattening
- Once all code uses helpers
- Change helpers to navigate instead of flat lookup
- Remove flattening code from veil-state.ts and restoration.ts

### Phase 4: Make facets private
```typescript
export class VEILStateManager {
  private state: {
    facets: Map<string, Facet>;  // ← private!
    // ...
  };
  
  // Only accessible via helpers
  getFacet(id: string): Facet | undefined { ... }
}
```

## Impact on Current Code

### Immediate Benefit: Remove Flattening

**Current Problem**: We flatten all nested facets into the Map to enable direct lookup:
```typescript
// veil-state.ts - runs on EVERY addFacet operation!
if (cloned.children && cloned.children.length > 0) {
  const addChildren = (facet: any) => {
    for (const child of facet.children || []) {
      this.state.facets.set(child.id, child);  // Flatten!
      if (child.children && child.children.length > 0) {
        addChildren(child);  // Recursive!
      }
    }
  };
  addChildren(cloned);
}
```

**With Navigation Helpers**: No flattening needed!

```typescript
// discord-app.ts - DiscordHistorySyncReceptor
// Before (requires flattening)
const speechFacet = state.facets.get(`speech-${messageId}`);

// After (navigate structure)
const messageFacet = state.getFacet(`discord-msg-${messageId}`);
const speechFacet = messageFacet?.children?.[0];

// OR with application helper
const discord = new DiscordVEILHelpers(state);
const content = discord.getMessageContent(messageId);
```

**Code to Remove:**

`veil-state.ts` (lines 225-236):
```typescript
// DELETE: Recursive child flattening
```

`restoration.ts` (lines 42-51):
```typescript
// DELETE: addFacetAndChildren helper
// REPLACE with simple:
for (const [id, facetData] of serialized.facets) {
  const facet = deserializeFacet(facetData);
  if (facet) {
    newState.facets.set(facet.id, facet);
  }
}
```

**Net Impact:**
- ✅ ~30 lines of complex recursive code removed
- ✅ Less work on every `addFacet` operation
- ✅ Less work on every restoration
- ✅ Clearer semantics (children are children, not flat entries)
- ✅ Structure preserved as designed

## Open Questions

1. **Scope**: Should this be comprehensive or just for common patterns?
2. **Location**: Methods on VEILState, separate helper class, or static functions?
3. **Naming**: What conventions make the most sense?
4. **Performance**: Worth adding indexes or just iterate for now?
5. **Migration**: Do all at once or gradual?

## Recommendation

**Phase 1: Core Navigation Helpers (Enables Flattening Removal)**
1. Add to `ReadonlyVEILState`:
   - `getFacet(id)`, `hasFacet(id)` - direct wrappers
   - `getChildFacet(parentId, predicate)` - navigate children
   - `findFacets(filter)` - generic query
   - `getConfig(key)`, `getElementTree(id)` - platform patterns

2. Migrate `DiscordHistorySyncReceptor` to navigate instead of flat lookup
3. Remove flattening code (~30 lines)
4. Verify tests pass

**Phase 2: Application Helpers (Optional)**
1. Create `discord-axon/src/veil-helpers.ts`
2. Add `DiscordVEILHelpers` class with domain-specific methods
3. Gradually migrate Discord code to use helpers

**Phase 3: Comprehensive Migration (Future)**
1. All direct `state.facets` access replaced with helpers
2. Make `facets` Map private in `VEILStateManager`
3. Add indexes for performance if needed

**Why This Order:**
- Quick win: Remove flattening complexity immediately
- Prove pattern: See if helpers improve code clarity
- Low risk: Core helpers are simple wrappers
- Incremental: Can stop after Phase 1 if not valuable

---

*Documented: October 28, 2025*  
*Discussion: Olena & Claude*  
*Status: Proposal - Ready for Implementation*  
*Priority: Medium (current code works, but this improves architecture)*

