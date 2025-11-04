/**
 * Control Panel Widget
 * 
 * A toggleable control panel that manages tool visibility through scoping.
 * When toggled, re-activates the agent so it can continue with new tools visible.
 */

import { InteractiveComponent } from '../components/base-components';
import { persistent } from '../persistence/decorators';
import type { SpaceEvent } from '../spaces/types';

export abstract class ControlPanelComponent extends InteractiveComponent {
  @persistent()
  protected isOpen: boolean = false;
  
  /**
   * Subclasses must provide a unique panel ID
   */
  protected abstract getPanelId(): string;
  
  /**
   * Subclasses must provide a display name for the panel
   */
  protected abstract getPanelDisplayName(): string;
  
  /**
   * Called when panel is opened (after scope activated)
   */
  protected abstract onPanelOpened(): Promise<void>;
  
  /**
   * Called when panel is closed (after scope deactivated)
   */
  protected abstract onPanelClosed(): Promise<void>;
  
  /**
   * Get the scope ID for this panel's tools
   */
  protected getPanelScope(): string {
    return `panel:${this.getPanelId()}`;
  }
  
  async onMount(): Promise<void> {
    // Register panel control actions (always visible, no scope)
    this.registerActionWithInstructions(
      'open',
      async () => { await this.openPanel(); },
      `Open ${this.getPanelDisplayName()} panel: @${this.element.id}.open`,
      {
        description: `Open the ${this.getPanelDisplayName()} panel to access its tools`,
        category: this.getPanelId()
      }
    );
    
    this.registerActionWithInstructions(
      'close',
      async () => { await this.closePanel(); },
      `Close this panel: @${this.element.id}.close`,
      {
        description: `Close the ${this.getPanelDisplayName()} panel`,
        category: this.getPanelId(),
        scope: [this.getPanelScope()]  // Only visible when open
      }
    );
    
    // Subscribe to events
    this.element.subscribe('frame:start');
  }
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    // Process deferred operations on first frame
    if (event.topic === 'frame:start') {
      console.log(`[ControlPanel] frame:start - processing deferred operations, count:`, this._deferredOperations?.length || 0);
      this.processDeferredOperations();
      console.log(`[ControlPanel] deferred operations processed`);
    }
    
    // Subclasses can handle their own events
  }
  
  /**
   * Open the panel - activates scope and re-activates agent
   */
  private async openPanel(): Promise<void> {
    if (this.isOpen) {
      this.addEvent(
        `${this.getPanelDisplayName()} panel is already open`,
        'panel-already-open',
        `${this.getPanelId()}-panel-already-open`
      );
      return;
    }
    
    this.isOpen = true;
    
    // Activate the panel scope
    this.addOperation({
      type: 'addFacet',
      facet: {
        id: `scope-${this.getPanelScope()}`,
        type: 'scope-change' as any,
        scope: [this.getPanelScope()],
        state: { active: true }
      } as any
    });
    
    // Notify that panel opened
    this.addEvent(
      `${this.getPanelDisplayName()} panel opened - additional tools now available`,
      'panel-opened',
      `${this.getPanelId()}-panel-opened`,
      { panelId: this.getPanelId() }
    );
    
    // Call subclass hook
    await this.onPanelOpened();
    
    // Re-activate agent so it can continue with new tools visible
    this.reactivateAgent('Panel opened - new tools available');
  }
  
  /**
   * Close the panel - deactivates scope and re-activates agent
   */
  private async closePanel(): Promise<void> {
    if (!this.isOpen) {
      this.addEvent(
        `${this.getPanelDisplayName()} panel is already closed`,
        'panel-already-closed',
        `${this.getPanelId()}-panel-already-closed`
      );
      return;
    }
    
    this.isOpen = false;
    
    // Deactivate the panel scope
    this.addOperation({
      type: 'addFacet',
      facet: {
        id: `scope-${this.getPanelScope()}`,
        type: 'scope-change' as any,
        scope: [this.getPanelScope()],
        state: { active: false }
      } as any
    });
    
    // Notify that panel closed
    this.addEvent(
      `${this.getPanelDisplayName()} panel closed`,
      'panel-closed',
      `${this.getPanelId()}-panel-closed`,
      { panelId: this.getPanelId() }
    );
    
    // Call subclass hook
    await this.onPanelClosed();
    
    // Re-activate agent
    this.reactivateAgent('Panel closed');
  }
  
  /**
   * Re-activate the agent so it can continue its turn with updated context
   */
  private reactivateAgent(reason: string): void {
    const space = this.element.findSpace();
    if (!space) {
      console.warn('[ControlPanel] No space found for agent reactivation');
      return;
    }
    
    // Emit agent activation event
    // This will trigger ContextTransform to render new context and AgentEffector to run cycle
    const activeStream = (space as any).getActiveStream?.();
    space.emit({
      topic: 'agent:activate',
      source: this.element.getRef(),
      payload: {
        streamId: activeStream?.streamId || 'default-stream',
        reason,
        priority: 'normal',
        metadata: {
          trigger: 'control-panel-toggle',
          panelId: this.getPanelId()
        }
      },
      timestamp: Date.now()
    });
  }
  
  /**
   * Register a panel tool - automatically scoped to this panel
   */
  protected registerPanelTool(
    name: string,
    handler: (params?: any) => Promise<void>,
    instructions: string,
    config?: {
      description?: string;
      params?: any;
      category?: string;
    }
  ): void {
    this.registerActionWithInstructions(
      name,
      handler,
      instructions,
      {
        ...config,
        scope: [this.getPanelScope()],  // Auto-scope to panel
        category: config?.category || this.getPanelId()
      }
    );
  }
}

