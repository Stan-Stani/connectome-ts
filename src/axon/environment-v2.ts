/**
 * AXON Environment V2 - FLEX Architecture
 *
 * Provides Component base class and FLEX interfaces to AXON modules.
 * All AXON modules should extend Component directly with explicit priority values.
 */

import { Component } from '../spaces/component';
import { VEILComponent, InteractiveComponent } from '../components/base-components';
import { ControlPanelComponent } from '../widgets/control-panel';
import { ControlPanelActionsReceptor, PanelScopeReceptor } from '../widgets/control-panel-receptors';
import { BaseAfferent } from '../components/base-afferent';
import { SpaceEvent } from '../spaces/types';
import { persistent, persistable } from '../persistence/decorators';
import { external } from '../host/decorators';
import { IAxonEnvironment } from '@connectome/axon-interfaces';
import { IAxonEnvironmentV2 } from './interfaces-v2';
import {
  FacetDelta,
  ReadonlyVEILState,
  EffectorResult,
  ExternalAction
} from '../spaces/receptor-effector-types';
import {
  VEILDelta,
  Facet,
  SpeechFacet,
  EventFacet,
  StateFacet,
  ThoughtFacet,
  ActionFacet
} from '../veil/types';
import {
  createEventFacet,
  createSpeechFacet,
  createStateFacet,
  createThoughtFacet,
  createActionFacet,
  createAmbientFacet,
  createAgentActivation
} from '../helpers/factories';

// Re-export WebSocket for components that need it
let WebSocketImpl: any;
try {
  // Try to import ws for Node.js environments
  WebSocketImpl = require('ws');
} catch {
  // Fall back to browser WebSocket if available
  if (typeof WebSocket !== 'undefined') {
    WebSocketImpl = WebSocket;
  }
}

/**
 * Create the AXON environment with FLEX support
 *
 * AXON modules should extend Component directly with explicit priority values:
 * - priority 100: Receptor-level (event → facet transformation)
 * - priority 200: Transform-level (facet processing)
 * - priority 300: Effector-level (side effects, external interactions)
 * - priority 400: Maintainer-level (cleanup, persistence)
 */
export function createAxonEnvironmentV2(): IAxonEnvironmentV2 {
  return {
    // FLEX Component base class - all AXON components should extend this
    Component: Component as any,
    VEILComponent: VEILComponent as any,
    InteractiveComponent: InteractiveComponent as any,
    ControlPanelComponent: ControlPanelComponent as any,
    BaseAfferent: BaseAfferent as any,

    // Control Panel receptors (built-in, ready to use)
    ControlPanelActionsReceptor: ControlPanelActionsReceptor as any,
    PanelScopeReceptor: PanelScopeReceptor as any,

    // Decorators
    persistent,
    persistable,
    external,

    // Type references - SpaceEvent is created as a plain object
    SpaceEvent: class SpaceEvent {
      constructor(
        public topic: string,
        public source: any,
        public payload?: any,
        public broadcast?: boolean
      ) {}
    } as any,

    // WebSocket
    WebSocket: WebSocketImpl,

    // Type constructors for AXON modules
    VEILDelta: class {} as any,
    FacetDelta: class {} as any,
    ReadonlyVEILState: class {} as any,
    EffectorResult: class {} as any,
    ExternalAction: class {} as any,

    // Facet types
    Facet: class {} as any,
    EventFacet: class {} as any,
    SpeechFacet: class {} as any,
    StateFacet: class {} as any,
    ThoughtFacet: class {} as any,
    ActionFacet: class {} as any,

    // Factory functions
    createEventFacet,
    createSpeechFacet,
    createStateFacet,
    createThoughtFacet,
    createActionFacet,
    createAmbientFacet,
    createAgentActivation,

    // Helper to check if state has facet
    hasFacet: (state: ReadonlyVEILState, id: string) => state.hasFacet(id),

    // Helper to get facets by type
    getFacetsByType: (state: ReadonlyVEILState, type: string) =>
      state.getFacetsByType(type)
  };
}
