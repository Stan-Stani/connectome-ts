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

/**
 * Standard priority levels for FLEX components.
 * These are conventions, not enforced values.
 */
export const ComponentPriority = {
  MODULATOR: 0,
  RECEPTOR: 100,
  TRANSFORM: 200,
  EFFECTOR: 300,
  MAINTAINER: 400
} as const;

/**
 * Create a priority constraint for component ordering.
 * Lower priority values execute earlier in the frame.
 *
 * @param priority - The priority value (lower = earlier execution)
 * @param source - Optional source identifier for debugging
 * @returns A PriorityConstraintFacet
 *
 * @example
 * class MyReceptor extends Component {
 *   protected constraints = [priorityConstraint(ComponentPriority.RECEPTOR)];
 * }
 */
export function priorityConstraint(priority: number, source?: string): PriorityConstraintFacet {
  return { type: 'priority', priority, source };
}


