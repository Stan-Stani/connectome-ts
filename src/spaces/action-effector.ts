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

      // Find the target element or component
      const space = this.element.findSpace();
      if (!space) {
        console.warn(`[ActionEffector] No space found for action routing`);
        continue;
      }

      let targetElement = space.children.find(child => child.id === elementId);
      
      // FLEX Phase 1: If element not found as child, check direct components on Space
      if (!targetElement) {
        // Try direct lookup by component ID (if Space supports it)
        if ((space as any).getComponentById) {
          // Try exact match (if tool name uses full component ID)
          let directComponent = (space as any).getComponentById(elementId);
          
          // Try prefix match (if tool name uses "elementId" prefix of "elementId:ComponentType")
          // This supports the pattern where tool is "discord-control.open" but component is "discord-control:DiscordControlPanelComponent"
          if (!directComponent && (space as any).components) {
            directComponent = (space as any).components.find((c: any) => 
              c._componentId && (
                c._componentId === elementId || 
                c._componentId.startsWith(`${elementId}:`)
              )
            );
          }
          
          if (directComponent) {
            console.log(`[ActionEffector] Found direct component for '${elementId}': ${directComponent.constructor.name} (${directComponent._componentId})`);
            
            // Execute action on component
            if (directComponent.actions && directComponent.actions.has && directComponent.actions.has(action)) {
              const handler = directComponent.actions.get(action);
              console.log(`[ActionEffector] Calling direct component action handler for '${action}'`);
              try {
                await handler(parameters);
                console.log(`[ActionEffector] Successfully executed action via direct component handler`);
              } catch (error) {
                console.error(`[ActionEffector] Error executing direct component action:`, error);
              }
            } else {
              console.warn(`[ActionEffector] No handler found for action '${action}' on direct component '${elementId}'`);
            }
            continue; // Done with this action
          }
        }
      }

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
