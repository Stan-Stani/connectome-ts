/**
 * Control Panel Receptors - Declarative facet creation
 *
 * These receptors handle panel events and create VEIL facets declaratively.
 */

import { Component } from '../spaces/component';
import type { ExecutionContext } from '../spaces/types';
import type { VEILDelta } from '../veil/types';
import type { SpaceEvent } from '../spaces/types';

/**
 * Receptor that creates action-definition and instruction facets
 * when panel tools are registered (declarative pattern)
 */
export class ControlPanelActionsReceptor extends Component {
  priority = 100;
  topics = ['panel:tools-registered'];

  execute(context: ExecutionContext): void {
    const event = context.event;
    if (!event) return;
    const payload = event.payload as any;

    console.log('[ControlPanelActionsReceptor] Panel tools registered:', {
      panelId: payload.panelId,
      elementId: payload.elementId,
      toolCount: payload.tools?.length || 0
    });

    if (!payload.tools || !Array.isArray(payload.tools)) {
      console.warn('[ControlPanelActionsReceptor] No tools array in payload');
      return;
    }

    // Use panelId (e.g. "discord-control") as the tool namespace if available
    // This ensures friendly tool names like "discord-control.open" instead of "elem_123.open"
    const targetId = payload.panelId || payload.elementId;

    // Create facets for panel control actions (open/close)
    this.addOperation({
      type: 'addFacet',
      facet: {
        id: `action-def-${payload.elementId}-open`,
        type: 'action-definition',
        displayName: `${targetId}.open`,
        attributes: {
          toolName: `${targetId}.open`,
          actionName: 'open',
          elementId: targetId, // Use friendly ID for action routing
          description: `Open the ${payload.displayName} panel to access its tools`,
          parameters: {},
          category: payload.panelId
        }
      }
    });

    this.addOperation({
      type: 'addFacet',
      facet: {
        id: `tool-instruction-${payload.elementId}-open`,
        type: 'ambient',
        displayName: 'tool-instruction',
        content: `Open ${payload.displayName} panel: {@${targetId}.open()}`
      }
    });

    this.addOperation({
      type: 'addFacet',
      facet: {
        id: `action-def-${payload.elementId}-close`,
        type: 'action-definition',
        displayName: `${targetId}.close`,
        attributes: {
          toolName: `${targetId}.close`,
          actionName: 'close',
          elementId: targetId, // Use friendly ID for action routing
          description: `Close the ${payload.displayName} panel`,
          parameters: {},
          category: payload.panelId,
          scope: [payload.panelScope]  // Only visible when open
        }
      }
    });

    this.addOperation({
      type: 'addFacet',
      facet: {
        id: `tool-instruction-${payload.elementId}-close`,
        type: 'ambient',
        displayName: 'tool-instruction',
        content: `Close this panel: {@${targetId}.close()}`,
        scope: [payload.panelScope]  // Only visible when open
      }
    });

    // Create facets for each registered tool
    let facetCount = 4; // Already created 4 facets above
    for (const tool of payload.tools) {
      const toolName = `${targetId}.${tool.name}`;

      // Action definition facet
      this.addOperation({
        type: 'addFacet',
        facet: {
          id: `action-def-${payload.elementId}-${tool.name}`,
          type: 'action-definition',
          displayName: toolName,
          attributes: {
            toolName,
            actionName: tool.name,
            elementId: targetId, // Use friendly ID for action routing
            description: tool.description || `Perform ${tool.name} action`,
            parameters: tool.params || {},
            category: tool.category,
            scope: tool.scope  // Panel-scoped
          }
        }
      });

      // Instruction facet (renderable to agent)
      // Replace any internal ID references in instructions with friendly ID
      const instructions = tool.instructions.replace(
        new RegExp(`{@${payload.elementId}\\.`, 'g'),
        `{@${targetId}.`
      );

      this.addOperation({
        type: 'addFacet',
        facet: {
          id: `tool-instruction-${payload.elementId}-${tool.name}`,
          type: 'ambient',
          displayName: 'tool-instruction',
          content: instructions,
          scope: tool.scope  // Panel-scoped
        }
      });

      facetCount += 2;
    }

    console.log(`[ControlPanelActionsReceptor] Created ${facetCount} facets for panel ${payload.panelId}`);
  }
}

/**
 * Receptor that handles panel scope activation/deactivation
 */
export class PanelScopeReceptor extends Component {
  priority = 100;
  topics = ['panel:scope-change'];

  execute(context: ExecutionContext): void {
    const event = context.event;
    if (event.topic !== 'panel:scope-change') return;

    const { scope, active } = event.payload as any;
    const scopeFacetId = `scope-${scope}`;
    const state = context.state;

    console.log(`[PanelScopeReceptor] ${active ? 'Activating' : 'Deactivating'} scope: ${scope}`);

    // Check if scope facet already exists
    const existingFacet = state.facets.has(scopeFacetId);

    if (existingFacet) {
      this.addOperation({
        type: 'rewriteFacet',
        id: scopeFacetId,
        changes: { state: { active } }
      });
    } else {
      this.addOperation({
        type: 'addFacet',
        facet: {
          id: scopeFacetId,
          type: 'scope-change' as any,
          scope: [scope],
          state: { active }
        } as any
      });
    }
  }
}
