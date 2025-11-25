/**
 * AXON Component Interfaces
 *
 * Re-exports core interfaces from the shared @connectome/axon-interfaces package
 * and defines the full environment interface used by AXON modules.
 */

// Re-export core interfaces from the shared package
export * from '@connectome/axon-interfaces';

import { IAxonManifest, IAxonEnvironment as IAxonEnvironmentBase } from '@connectome/axon-interfaces';

/**
 * Extended manifest with component exports metadata
 */
export interface IAxonManifestExtended extends IAxonManifest {
  // Fields for component exports
  exports?: {
    components?: string[];      // Component class names
  };

  // Metadata for each export
  metadata?: {
    [exportName: string]: {
      description?: string;
      priority?: number;        // FLEX priority (0-400)
      topics?: string[];        // For event-handling components
      facetFilters?: any[];     // For facet-watching components
      requirements?: string[];  // External dependencies needed
    };
  };
}

/**
 * Module exports structure
 */
export interface IAxonModuleExports {
  // All components exported by the module
  components?: Record<string, any>;

  // Optional initializer for connection params
  initializer?: {
    setConnectionParams?: (params: any) => void | Promise<void>;
    initialize?: (params: any) => void | Promise<void>;
  };
}

/**
 * Full AXON Environment interface
 *
 * Components should extend Component with explicit priority:
 * - priority 0: Modulator-level (event preprocessing)
 * - priority 100: Receptor-level (event → facet transformation)
 * - priority 200: Transform-level (facet processing)
 * - priority 300: Effector-level (side effects, external interactions)
 * - priority 400: Maintainer-level (cleanup, persistence)
 */
export interface IAxonEnvironment extends IAxonEnvironmentBase {
  // Component base classes
  ControlPanelComponent: any;
  BaseAfferent: any;

  // Control Panel receptors (built-in components)
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
