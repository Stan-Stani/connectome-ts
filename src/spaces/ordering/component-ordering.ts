import { Component } from '../component';
import { PriorityConstraintFacet } from '../constraints';

export interface ComponentOrderingStrategy {
  order(components: Component[]): Component[];
}

export class PriorityOrderingStrategy implements ComponentOrderingStrategy {
  order(components: Component[]): Component[] {
    return components
      .map((component, index) => ({
        component,
        priority: this.getPriority(component),
        registrationOrder: index
      }))
      .sort((a, b) => {
        if (a.priority === b.priority) {
          return a.registrationOrder - b.registrationOrder;
        }
        return a.priority - b.priority;
      })
      .map(entry => entry.component);
  }

  private getPriority(component: Component): number {
    const priorityFacet = component
      .getConstraintFacets()
      .find(facet => facet.type === 'priority') as PriorityConstraintFacet | undefined;

    if (priorityFacet && typeof priorityFacet.priority === 'number') {
      return priorityFacet.priority;
    }

    return component.priority ?? 0;
  }
}


