/**
 * ActionEffector - Executes component handlers when action facets are created
 *
 * In MARTEM architecture, this effector watches for action facets created by agents
 * and routes them to the appropriate element/component handlers for execution.
 *
 * This bridges the gap between agent-generated action facets and component execution.
 */

import { BaseEffector } from '../components/base-martem';
import {
  FacetDelta,
  ReadonlyVEILState,
  EffectorResult,
  FacetFilter,
  ExternalAction
} from './receptor-effector-types';
import { SpaceEvent } from './types';
import { hasStateAspect } from '../veil/types';

export class ActionEffector extends BaseEffector {
  // Watch for action facets
  facetFilters: FacetFilter[] = [
    { type: 'action' }
  ];

  /**
   * Process facet changes - look for new action facets and execute handlers
   */
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    const externalActions: ExternalAction[] = [];

    for (const change of changes) {
      if (change.type !== 'added') continue;

      const facet = change.facet;
      if (facet.type !== 'action') continue;
      if (!hasStateAspect(facet)) continue;

      const actionState = facet.state as { toolName: string; parameters?: Record<string, any> };
      const toolName = actionState.toolName;
      const parameters = actionState.parameters || {};

      console.log(`[ActionEffector] Processing action facet: ${toolName}`, parameters);

      // Parse tool name to extract element ID and action
      // Format: "elementId.actionName" or "elementId.nested.actionName"
      const parts = toolName.split('.');
      if (parts.length < 2) {
        console.warn(`[ActionEffector] Invalid tool name format: ${toolName} (expected "elementId.action")`);
        continue;
      }

      const elementId = parts[0];
      const action = parts[parts.length - 1];

      // Find the target element
      const space = this.element.findSpace();
      if (!space) {
        console.warn(`[ActionEffector] No space found for action routing`);
        continue;
      }

      const targetElement = space.children.find(child => child.id === elementId);
      if (!targetElement) {
        console.warn(`[ActionEffector] Target element not found: ${elementId}`);
        continue;
      }

      console.log(`[ActionEffector] Found target element: ${targetElement.name} (${targetElement.id})`);

      // Try element's own handleAction first (access via type assertion since it's protected)
      const elementWithAction = targetElement as any;
      if (elementWithAction.handleAction) {
        console.log(`[ActionEffector] Calling element.handleAction('${action}')`);
        try {
          await elementWithAction.handleAction(action, parameters);
          console.log(`[ActionEffector] Successfully executed action via element.handleAction`);
        } catch (error) {
          console.error(`[ActionEffector] Error executing element.handleAction:`, error);
        }
      } else {
        // Search through element's components for action handlers
        const components = (targetElement as any)._components || [];
        let handled = false;

        for (const component of components) {
          const comp = component as any;
          if (comp.actions && comp.actions.has && comp.actions.has(action)) {
            const handler = comp.actions.get(action);
            console.log(`[ActionEffector] Calling component action handler for '${action}'`);
            try {
              await handler(parameters);
              console.log(`[ActionEffector] Successfully executed action via component handler`);
              handled = true;
              break;
            } catch (error) {
              console.error(`[ActionEffector] Error executing component action:`, error);
            }
          }
        }

        if (!handled) {
          console.warn(`[ActionEffector] No handler found for action '${action}' on element '${elementId}'`);
        }
      }
    }

    return {
      events,
      externalActions
    };
  }
}
