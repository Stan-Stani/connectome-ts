# Afferent Persistence Issue
**Date**: September 29, 2025  
**Status**: 🔴 CRITICAL ARCHITECTURAL GAP

---

## The Problem

### How @persistent Works for Regular Components

**Lifecycle (Fresh)**:
1. Component created
2. Properties with `@persistent()` are at default values
3. `_attach(element, isRestoring=false)` called
   - Calls `onInit()`
   - Calls `onMount()`  
4. Component runs

**Lifecycle (Restore)**:
1. Component created from registry
2. **@persistent properties restored from snapshot** ✓
3. `_attach(element, isRestoring=true)` called
   - Calls `onInit()`
   - Calls `onRestore()`
   - Does NOT call `onMount()` yet
4. External resources resolved (@external, @reference)
5. `_completeMount()` called
   - Calls `onMount()`
6. Component runs with restored state ✓

**This works great for:**
- `SpaceNotesComponent` - has @persistent notes Map, just needs it restored
- `BoxDispenserComponent` - has @persistent state, works on restore
- `AgentComponent` - has @persistent config, recreates agent on restore

---

## How Afferents Are Different

### Afferent Has TWO Types of State

**1. Persistent State** (should survive restarts):
- Config: guild, agent name, server URL
- Tracking: lastRead, joinedChannels, processedMessages
- Metadata: channelNames, guildName

**2. Runtime State** (should NOT be persisted):
- Active connections: `ws`, `rl` (WebSocket, readline)
- Timers: `reconnectTimeout`, `intervalId`
- Flags: `isActive`, `running`, `initialized`
- Queues: `commandQueue`

### Afferent Lifecycle Requires

**Beyond @persistent restoration:**
1. Create AfferentContext (with emit/emitError functions)
2. Call `initialize(context)` to set up internal state
3. Call `start()` to establish connections
4. Begin processing events

**Current Implementation (DiscordAfferent)**:

```typescript
// Fresh initialization
setConnectionParams(params) {
  // Manually creates context
  this.context = { config: {...}, emit: ..., emitError: ... };
}

onReferencesResolved() {
  if (this.context && this.botToken) {
    await this.initialize(this.context);
    await this.start();
  }
}
```

**Problem on Restoration**:
```typescript
// Restoration flow
1. @persistent properties restored ✓ (guildId, lastRead, etc.)
2. setConnectionParams() NOT called (only for fresh!)
3. context is undefined! ❌
4. onReferencesResolved() runs but context is missing
5. initialize() and start() never called
6. Afferent sits there with restored state but no connection!
```

---

## Current Workarounds

### DiscordAfferent (Broken on Restore)
- Has `@persistent` properties
- Manually creates context in setConnectionParams()
- On restore: context doesn't exist, afferent doesn't start

### ConsoleAfferent (Also Broken)
- Same issue - context only created when fresh
- Won't work if restored from snapshot

---

## Possible Solutions

### Option 1: Make Context @persistent
```typescript
@persistent()
private savedContext?: { config: any };

onRestore() {
  if (this.savedContext) {
    this.context = {
      ...this.savedContext,
      emit: (event) => this.element.emit(event),
      emitError: (error) => console.error(error)
    };
  }
}

onMount() {
  if (this.context && !this.initialized) {
    await this.initialize(this.context);
    await this.start();
  }
}
```

**Pros**: Simple, explicit
**Cons**: Duplicates config storage, needs manual context recreation

### Option 2: Reconstruct Context from @persistent Properties
```typescript
@persistent() private serverUrl = '';
@persistent() private guildId = '';
@persistent() private agentName = '';

onRestore() {
  // Reconstruct context from persistent properties
  this.context = {
    config: {
      serverUrl: this.serverUrl,
      guild: this.guildId,
      agent: this.agentName
    },
    afferentId: this.element.id,
    emit: (event) => this.element.emit(event),
    emitError: (error) => console.error(error)
  };
}

onMount() {
  if (!this.initialized) {
    await this.initialize(this.context);
    await this.start();
  }
}
```

**Pros**: DRY - config comes from @persistent properties
**Cons**: Need to know which properties form the config

### Option 3: Afferent-Specific Restoration Lifecycle
```typescript
interface Afferent {
  // New method called during restoration
  restoreContext(): AfferentContext<TConfig>;
}

// In BaseAfferent
onRestore() {
  this.context = this.restoreContext();
}

onMount() {
  if (!this.initialized) {
    await this.initialize(this.context);
    await this.start();
  }
}

// In DiscordAfferent
restoreContext(): AfferentContext<DiscordConfig> {
  return {
    config: {
      serverUrl: this.buildServerUrl(), // From @persistent properties
      guild: this.guildId,
      agent: this.agentName
    },
    afferentId: 'discord',
    emit: (event) => this.element.emit(event),
    emitError: (error) => console.error('[Discord]', error)
  };
}
```

**Pros**: Clean abstraction, explicit contract
**Cons**: Adds new interface method

### Option 4: Make Config Properties @persistent Directly

```typescript
// Instead of context.config.guild, just use this.guild directly

@persistent() private guildId = '';
@persistent() private serverUrl = '';

// In afferent methods, read from instance properties not context
protected async onStart() {
  await this.connect(this.serverUrl);
}

// Context becomes optional/internal
```

**Pros**: Simplest - afferents work like normal components
**Cons**: Breaks current Afferent interface that expects context

---

## Recommended Solution

**Option 2 + automatic context recreation in BaseAfferent**:

```typescript
// In BaseAfferent
async onRestore(): Promise<void> {
  // Create context from persistent config properties
  this.context = this.createContext();
}

async onMount(): Promise<void> {
  // Create context if it doesn't exist (fresh) or was just restored
  if (!this.context) {
    this.context = this.createContext();
  }
  
  if (!this.initialized) {
    await this.initialize(this.context);
    await this.start();
    this.initialized = true;
  }
}

// Subclasses implement this to build context from their @persistent state
protected abstract createContext(): AfferentContext<TConfig>;
```

**In DiscordAfferent**:
```typescript
@persistent() private serverUrl = '';
@persistent() private guildId = '';
@persistent() private agentName = '';

protected createContext(): AfferentContext<DiscordConfig> {
  return {
    config: {
      serverUrl: this.serverUrl,
      guild: this.guildId,
      agent: this.agentName
    },
    afferentId: this.element?.id || 'discord',
    emit: (event) => this.element?.emit(event),
    emitError: (error) => console.error('[Discord]', error)
  };
}

// setConnectionParams now just sets the @persistent properties
setConnectionParams(params: any) {
  this.serverUrl = params.host && params.path ? `ws://${params.host}${params.path}` : '';
  this.guildId = params.guild || '';
  this.agentName = params.agent || 'Connectome Agent';
}
```

---

## Current State Summary

| Component Type | @persistent Works? | Restoration Works? | Notes |
|---------------|-------------------|-------------------|-------|
| Component | ✅ Yes | ✅ Yes | Simple state restoration |
| VEILComponent | ✅ Yes | ✅ Yes | State + VEIL ops work |
| InteractiveComponent | ✅ Yes | ✅ Yes | Includes actions |
| AgentComponent | ✅ Yes | ✅ Yes | Recreates agent from config |
| Afferent (Current) | ⚠️ Partial | ❌ NO | Properties restore but context/connections don't |

---

## Impact

**Currently Broken**:
- DiscordAfferent won't reconnect after restoration
- ConsoleAfferent won't restart readline after restoration
- Any saved Discord state would be loaded but useless

**Workaround in Production**:
- Always use `--reset` flag (don't restore)
- Works but defeats persistence purpose

**Proper Fix Needed Before**:
- Using persistence in production
- Multi-session agent experiences
- Long-running Discord bots with state

---

## Next Steps

1. Implement `createContext()` method in BaseAfferent
2. Call it in `onRestore()` and `onMount()`
3. Update DiscordAfferent and ConsoleAfferent to use it
4. Test restoration cycle thoroughly
5. Document the pattern for future afferents
