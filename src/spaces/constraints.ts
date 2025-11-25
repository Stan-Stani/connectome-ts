export interface ComponentConstraintFacet {
  type: string;
  metadata?: Record<string, any>;
}

export interface PriorityConstraintFacet extends ComponentConstraintFacet {
  type: 'priority';
  priority: number;
  source?: string;
}

export type ConstraintFacet = PriorityConstraintFacet | ComponentConstraintFacet;


