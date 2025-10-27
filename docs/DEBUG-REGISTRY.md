# Debug Registry

The debug registry provides runtime introspection of Connectome internals when running with Node.js inspector.

## Activation

The debug registry **only activates** when Node.js is launched with the `--inspect` flag:

```bash
# Activate inspector on port 9229
node --inspect=9229 -r ts-node/register your-script.ts

# Or use --inspect-brk to pause on first line
node --inspect-brk=9229 -r ts-node/register your-script.ts
```

When activated, you'll see:
```
🔍 Inspector detected - Debug registry enabled
   Access via: global.__connectome_debug
   Inspector URL: ws://127.0.0.1:9229/...
   ✓ Host registered
   ✓ Space and VEILState registered
   ✓ DebugServer registered
```

## Connecting to Inspector

### Chrome DevTools
1. Open Chrome and navigate to `chrome://inspect`
2. Click "Open dedicated DevTools for Node"
3. Your process should appear in the list

### VS Code
1. Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "attach",
  "name": "Attach to Inspector",
  "port": 9229,
  "skipFiles": ["<node_internals>/**"]
}
```

### Command Line
```bash
node inspect localhost:9229
```

## Available APIs

Once connected, access the registry via `global.__connectome_debug`:

### Host Access
```javascript
const host = global.__connectome_debug.host;

// Access configuration
host.config

// Access providers (including LLM with API keys - be careful!)
host.providers.get('llm.primary')

// Access secrets
host.secrets.get('discord.token')

// Access reference registry
host.referenceRegistry.get('space')
```

### Space Access
```javascript
const space = global.__connectome_debug.space;

// View element tree
space.children
space.getAllElements()

// View components
space.components

// Emit events
await space.emit({
  topic: 'test:event',
  source: space.getRef(),
  payload: { foo: 'bar' },
  timestamp: Date.now()
})
```

### VEIL State Access
```javascript
const veilState = global.__connectome_debug.veilState;

// Get current state
const state = veilState.getState();

// View all facets
state.facets.size
Array.from(state.facets.values())

// Filter facets by type
Array.from(state.facets.values()).filter(f => f.type === 'state')

// View frame history
state.frameHistory.length
state.currentSequence

// Get agents
state.agents
```

### Debug Server Access
```javascript
const debugServer = global.__connectome_debug.debugServer;

// Access internal tracker
const tracker = debugServer.tracker;

// Get frames
tracker.getFrames(10) // Last 10 frames

// Get metrics
tracker.getMetrics()
```

### Agents Access
```javascript
const agents = global.__connectome_debug.agents;

// List all agents
agents.keys()

// Get specific agent
const agent = agents.get('my-agent-id');
```

## Example Usage

### Test Script

Run the test script:
```bash
node --inspect=9229 -r ts-node/register examples/test-debug-registry.ts
```

Connect and try:
```javascript
// Get facet count
global.__connectome_debug.veilState.getState().facets.size

// View all facet types
Array.from(global.__connectome_debug.veilState.getState().facets.values())
  .map(f => f.type)

// Inspect host config
global.__connectome_debug.host.config

// View element tree
global.__connectome_debug.space.children.map(c => ({
  id: c.id,
  name: c.name,
  components: c.components.length
}))
```

### Debugging Discord Bot

```bash
# Launch discord-axon with inspector
cd discord-axon
node --inspect=9229 -r ts-node/register src/discord-with-host.ts
```

In inspector:
```javascript
// Check Discord connection status
global.__connectome_debug.space.children.find(c => c.name === 'discord')

// View all facets
const facets = Array.from(global.__connectome_debug.veilState.getState().facets.values());

// Find Discord messages
facets.filter(f => f.type === 'message')

// Inject a test event
await global.__connectome_debug.space.emit({
  topic: 'test:debug',
  source: global.__connectome_debug.space.getRef(),
  payload: { test: true },
  timestamp: Date.now()
})
```

## Security Considerations

⚠️ **The debug registry exposes sensitive internals including:**
- API keys stored in LLM providers
- Secrets (Discord tokens, etc.)
- Full application state
- Ability to inject events

**Only enable `--inspect` in development environments!**

The registry automatically checks for the `--inspect` flag and **will not activate** in production unless you explicitly launch with inspector enabled.

## Architecture

The debug registry is implemented in `src/debug/debug-registry.ts`:

1. **Inspector Detection**: Checks `inspector.url()` and `process.execArgv`
2. **Conditional Registration**: Only registers when inspector is active
3. **Automatic Wiring**: Host, Space, and DebugServer self-register on creation
4. **Global Exposure**: Exposes `global.__connectome_debug` for easy access

No configuration needed - just launch with `--inspect`!
