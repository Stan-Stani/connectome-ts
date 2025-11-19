/**
 * ActionEffector - Executes component handlers when action facets are created
 *
 * In MARTEM architecture, this effector watches for action facets created by agents
 * and routes them to the appropriate component handlers for execution.
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

      // Parse tool name to extract target ID and action
      // Format: "targetId.actionName" or "targetId.nested.actionName"
      const parts = toolName.split('.');
      if (parts.length < 2) {
        console.warn(`[ActionEffector] Invalid tool name format: ${toolName} (expected "targetId.action")`);
        continue;
      }

      const targetId = parts[0];
      const action = parts[parts.length - 1];

      // Find the target component
      const space = this.space;
      if (!space) {
        console.warn(`[ActionEffector] No space found for action routing`);
        continue;
      }

      // Try direct lookup by component ID
      let component = space.getComponentById(targetId);
      
      // Try prefix match if direct lookup failed 
      // (e.g. tool "discord-control" -> component "discord-control:DiscordControlPanelComponent")
      if (!component) {
        component = space.components.find((c: any) => 
          c.id === targetId || 
          (c.id && c.id.startsWith(`${targetId}:`))
        );
      }
      
      if (!component) {
        console.warn(`[ActionEffector] Target component not found: ${targetId}`);
        continue;
      }

      console.log(`[ActionEffector] Found target component: ${component.constructor.name} (${component.id})`);
      
      // Execute action on component
      const comp = component as any;
      if (comp.actions && comp.actions.has && comp.actions.has(action)) {
        const handler = comp.actions.get(action);
        console.log(`[ActionEffector] Calling component action handler for '${action}'`);
        try {
          await handler(parameters);
          console.log(`[ActionEffector] Successfully executed action via component handler`);
        } catch (error) {
          console.error(`[ActionEffector] Error executing component action:`, error);
        }
      } else {
        console.warn(`[ActionEffector] No handler found for action '${action}' on component '${targetId}'`);
      }
    }

    return {
      events,
      externalActions
    };
  }
}
