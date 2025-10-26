/**
 * Example showing symbol-based type identification
 * Much more reliable than duck typing!
 */

import { 
  BaseEffector, 
  BaseReceptor,
  BaseTransform,
  Space,
  Element,
  VEILStateManager
} from '../src';
import { 
  isEffector, 
  isReceptor, 
  isTransform,
  RETM_TYPE,
  RETM_TYPES 
} from '../src/utils/retm-type-guards';
import { SpaceEvent, ReadonlyVEILState, FacetDelta, EffectorResult } from '../src/spaces/receptor-effector-types';
import { VEILDelta } from '../src/veil/types';

// Example: Component that is BOTH an element component AND an effector
class ButtonEffector extends BaseEffector {
  // Symbol automatically inherited from BaseEffector
  // readonly [RETM_TYPE] = RETM_TYPES.EFFECTOR; ✓
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    console.log('Button effector processing changes');
    return { events: [] };
  }
}

// Custom component without base class - just add the symbol
class CustomReceptor implements Receptor {
  // This is what enables auto-discovery!
  readonly [RETM_TYPE] = RETM_TYPES.RECEPTOR;
  
  topics = ['custom:event'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    console.log('Custom receptor transforming event');
    return [];
  }
  
  // Component interface
  async mount(element: Element): Promise<void> {
    console.log('Custom receptor mounted');
  }
  
  async unmount(): Promise<void> {
    console.log('Custom receptor unmounted');
  }
}

// Component that implements multiple RETM interfaces!
class HybridComponent extends BaseTransform implements Transform, Effector {
  // Can have multiple symbols if needed
  readonly transformType = RETM_TYPES.TRANSFORM;
  readonly effectorType = RETM_TYPES.EFFECTOR;
  
  // Override the inherited symbol to indicate primary type
  readonly [RETM_TYPE] = RETM_TYPES.TRANSFORM;
  
  // Transform interface
  process(state: ReadonlyVEILState): VEILDelta[] {
    return [];
  }
  
  // Also implements Effector!
  async processEffector(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    return { events: [] };
  }
}

// Test the type guards
function testTypeGuards() {
  const button = new ButtonEffector();
  const custom = new CustomReceptor();
  const hybrid = new HybridComponent();
  
  // Symbol-based checks are fast and reliable
  console.log('ButtonEffector is effector?', isEffector(button)); // true
  console.log('ButtonEffector is receptor?', isReceptor(button)); // false
  
  console.log('CustomReceptor is receptor?', isReceptor(custom)); // true
  console.log('CustomReceptor is effector?', isEffector(custom)); // false
  
  console.log('HybridComponent is transform?', isTransform(hybrid)); // true
  console.log('HybridComponent is effector?', isEffector(hybrid)); // false (primary type wins)
  
  // Direct symbol check for multiple interfaces
  console.log('Hybrid has transform symbol?', hybrid.transformType === RETM_TYPES.TRANSFORM); // true
  console.log('Hybrid has effector symbol?', hybrid.effectorType === RETM_TYPES.EFFECTOR); // true
}

// Auto-discovery in action
async function demonstrateAutoDiscovery() {
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create elements with RETM components
  const buttonElement = new Element('button');
  space.addChild(buttonElement);
  buttonElement.addComponent(new ButtonEffector());
  
  const sensorElement = new Element('sensor');  
  space.addChild(sensorElement);
  sensorElement.addComponent(new CustomReceptor());
  
  // Space can discover these automatically!
  // No need for space.addEffector() or space.addReceptor()
  
  // In Space implementation:
  const discoverComponents = () => {
    const components: any[] = [];
    const traverse = (elem: Element) => {
      components.push(...elem.components);
      elem.children.forEach(traverse);
    };
    traverse(space);
    
    const effectors = components.filter(isEffector);
    const receptors = components.filter(isReceptor);
    const transforms = components.filter(isTransform);
    
    console.log(`Discovered: ${effectors.length} effectors, ${receptors.length} receptors, ${transforms.length} transforms`);
  };
  
  discoverComponents();
}

// Run the examples
console.log('=== Symbol-based Type Guards ===');
testTypeGuards();

console.log('\n=== Auto-discovery Demo ===');
demonstrateAutoDiscovery();
