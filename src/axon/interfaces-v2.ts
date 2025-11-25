/**
 * Extended AXON Interfaces for FLEX Architecture
 */

import { IAxonManifest, IAxonEnvironment } from '@connectome/axon-interfaces';

/**
 * Extended manifest for FLEX modules
 */
export interface IAxonManifestV2 extends IAxonManifest {
  // Fields for component exports
  exports?: {
    components?: string[];      // Component class names (all extend Component with priority)
  };

  // Metadata for each export
  metadata?: {
    [exportName: string]: {
      description?: string;
      priority?: number;        // FLEX priority (100=receptor, 200=transform, 300=effector, 400=maintainer)
      topics?: string[];        // For event-handling components
      facetFilters?: any[];     // For facet-watching components
      requirements?: string[];  // External dependencies needed
    };
  };
}

/**
 * Module exports structure for FLEX modules
 */
export interface IAxonFLEXExports {
  // Traditional component (optional)
  default?: any;
  component?: any;

  // FLEX components by role (all extend Component with explicit priority)
  components?: Record<string, any>;
}

// Legacy alias for backwards compatibility
export type IAxonRETMExports = IAxonFLEXExports;

/**
 * Extended AXON Environment with FLEX support
 *
 * FLEX Components should extend Component with explicit priority:
 * - priority 100: Receptor-level (event → facet transformation)
 * - priority 200: Transform-level (facet processing)
 * - priority 300: Effector-level (side effects, external interactions)
 * - priority 400: Maintainer-level (cleanup, persistence)
 */
export interface IAxonEnvironmentV2 extends IAxonEnvironment {
  // Component base classes
  ControlPanelComponent: any;
  BaseAfferent: any;

  // Control Panel receptors (built-in FLEX components)
  ControlPanelActionsReceptor: any;
  PanelScopeReceptor: any;

  // Helper types
  VEILDelta: any;
  FacetDelta: any;
  ReadonlyVEILState: any;
  EffectorResult: any;
  ExternalAction: any;

  // Facet types
  Facet: any;
  EventFacet: any;
  SpeechFacet: any;
  StateFacet: any;
  ThoughtFacet: any;
  ActionFacet: any;

  // Factory functions
  createEventFacet: any;
  createSpeechFacet: any;
  createStateFacet: any;
  createThoughtFacet: any;
  createActionFacet: any;
  createAmbientFacet: any;
  createAgentActivation: any;

  // Helper functions
  hasFacet: (state: any, id: string) => boolean;
  getFacetsByType: (state: any, type: string) => any[];
}
