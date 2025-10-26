/**
 * Example showing how auto-discovery would work
 * Components are only added to elements, Space finds them automatically
 */

// Modified Space implementation (pseudocode)
class SpaceWithAutoDiscovery extends Space {
  
  // Override phase methods to include discovery
  
  protected runPhase1(events: SpaceEvent[]): VEILDelta[] {
    // Discover all receptors in element tree
    const receptors = this.discoverReceptors();
    
    // Group by topic for efficiency
    const receptorsByTopic = new Map<string, Receptor[]>();
    for (const receptor of receptors) {
      for (const topic of receptor.topics) {
        const list = receptorsByTopic.get(topic) || [];
        list.push(receptor);
        receptorsByTopic.set(topic, list);
      }
    }
    
    // Process events as normal
    const deltas: VEILDelta[] = [];
    for (const event of events) {
      const topicReceptors = receptorsByTopic.get(event.topic) || [];
      for (const receptor of topicReceptors) {
        deltas.push(...receptor.transform(event, this.getReadonlyState()));
      }
    }
    
    return deltas;
  }
  
  private discoverReceptors(): Receptor[] {
    const receptors: Receptor[] = [];
    this.traverseComponents((component) => {
      if (isReceptor(component)) {
        receptors.push(component);
      }
    });
    return receptors;
  }
  
  private traverseComponents(callback: (component: Component) => void): void {
    const traverse = (element: Element) => {
      for (const component of element.components) {
        callback(component);
      }
      for (const child of element.children) {
        traverse(child);
      }
    };
    traverse(this);
  }
}

// Usage becomes much simpler:

async function createBoxDispenser() {
  const space = new SpaceWithAutoDiscovery(veilState);
  
  // Create element
  const dispenserElement = new Element('dispenser');
  space.addChild(dispenserElement);
  
  // Just add component - no dual registration!
  const dispenseEffector = new DispenseEffector();
  dispenserElement.addComponent(dispenseEffector);
  // NOT NEEDED: space.addEffector(dispenseEffector);
  
  // Create button receptor
  const buttonElement = new Element('button');
  dispenserElement.addChild(buttonElement);
  
  const buttonReceptor = new ButtonPressReceptor();
  buttonElement.addComponent(buttonReceptor);
  // NOT NEEDED: space.addReceptor(buttonReceptor);
  
  // Space will automatically discover these components
  // when processing each phase!
}

// Components can even be added dynamically
async function addNewFeature(space: Space) {
  const featureElement = new Element('new-feature');
  space.addChild(featureElement);
  
  // Add transform - automatically discovered in next Phase 2
  featureElement.addComponent(new FeatureTransform());
  
  // Add effector - automatically discovered in next Phase 3  
  featureElement.addComponent(new FeatureEffector());
}

// Example component that's both element component AND effector
class DispenseEffector extends BaseEffector implements Effector {
  // Just implement the interfaces - no registration code!
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    // Process changes...
    return { events: [] };
  }
}

// Benefits:
// 1. No dual registration
// 2. Components can be added/removed dynamically
// 3. Single source of truth (element tree)
// 4. Zero boilerplate in components
// 5. Works with existing component interfaces
