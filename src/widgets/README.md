# Control Panel Widget

Reusable primitive for toggleable control panels with progressive disclosure.

## Features

- ✅ **Open/close state** - persisted across restarts
- ✅ **Scope management** - tools auto-scoped to panel
- ✅ **Agent re-activation** - agent continues turn after toggle
- ✅ **Progressive disclosure** - show/hide tools on demand

## Usage

```typescript
import { ControlPanelComponent } from 'connectome-ts/src/widgets/control-panel';

class MyControlPanel extends ControlPanelComponent {
  protected getPanelId(): string {
    return 'my-panel';
  }
  
  protected getPanelDisplayName(): string {
    return 'My Control Panel';
  }
  
  async onMount() {
    // Call super to register open/close actions
    await super.onMount();
    
    // Register scoped tools (only visible when panel open)
    this.registerPanelTool(
      'doSomething',
      async (params) => { /* ... */ },
      'Do something: @my-panel.doSomething(param="value")',
      {
        description: 'Performs an action',
        params: { param: { type: 'string' } }
      }
    );
  }
  
  protected async onPanelOpened(): Promise<void> {
    // Optional: run logic when panel opens
  }
  
  protected async onPanelClosed(): Promise<void> {
    // Optional: run logic when panel closes
  }
}
```

## Agent Experience

**Initially (panel closed):**
```
• Open My Control Panel panel: @my-panel.open
```

**After @my-panel.open:**
```
My Control Panel panel opened - additional tools now available
• Close this panel: @my-panel.close
• Do something: @my-panel.doSomething(param="value")
```
*Agent automatically continues turn with new tools visible*

**After @my-panel.close:**
```
My Control Panel panel closed
• Open My Control Panel panel: @my-panel.open
```
*Agent automatically continues turn with tools hidden*

## How It Works

1. **Scope-based visibility**
   - Panel tools have `scope: ["panel:my-panel"]`
   - Opening activates scope → tools visible
   - Closing deactivates scope → tools hidden

2. **Agent re-activation**
   - After toggle, emits `agent:activate` event
   - Agent gets fresh context with updated tools
   - Can continue its turn seamlessly

3. **Persistent state**
   - `isOpen` flag persisted across restarts
   - Panel state restored correctly

## Pattern Extensions

**Nested panels:**
```typescript
// Main menu → Sub-menus
this.registerPanelTool('openFileMenu', ..., 'scope: ["panel:main"]');
this.registerPanelTool('readFile', ..., 'scope: ["panel:files"]');
```

**Contextual panels:**
```typescript
// Only show when relevant
if (hasActiveConnection) {
  this.registerPanelTool('disconnect', ...);
}
```

**Multi-step wizards:**
```typescript
// Step 1 tools → Step 2 tools → Complete
scope: ["wizard:step-1"] → ["wizard:step-2"] → []
```


