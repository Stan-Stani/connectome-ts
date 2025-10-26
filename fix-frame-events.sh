#!/bin/bash

echo "Adding events field to Frame objects..."

# Fix basic-agent.ts Frame creation
sed -i '' 's/{$/{\
        events: [],/g' src/agent/basic-agent.ts

# Fix persistence/transition-manager.ts
sed -i '' 's/deltas: VEILDelta\[\],$/deltas: VEILDelta[],\
        events: [],/g' src/persistence/transition-manager.ts

# Fix spaces/space.ts Frame creations
sed -i '' 's/transition: createDefaultTransition(frameId, timestamp)$/transition: createDefaultTransition(frameId, timestamp),\
        events: []/g' src/spaces/space.ts

echo "Done adding events field!"
