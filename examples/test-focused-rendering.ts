/**
 * Test Focused vs Unfocused Stream Rendering
 * 
 * Demonstrates how frames render differently based on focused stream
 */

import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { VEILStateManager } from '../src/veil/veil-state';
import { Frame } from '../src/veil/types';

function createDiscordFrame(
  seq: number, 
  channelName: string, 
  author: string, 
  message: string,
  serverName: string = 'MyServer'
): Frame {
  const streamId = `discord:${serverName}:${channelName}`;
  
  return {
    sequence: seq,
    timestamp: new Date().toISOString(),
    uuid: `frame-${seq}`,
    activeStream: {
      streamId,
      streamType: 'discord',
      metadata: { channelName, serverName }
    },
    events: [{
      topic: 'discord:message',
      source: { 
        elementId: 'discord', 
        elementType: 'DiscordComponent',
        elementPath: []
      },
      payload: { content: message, channelName, author },
      timestamp: Date.now()
    }],
    deltas: [{
      type: 'addFacet',
      facet: {
        id: `discord-msg-${seq}`,
        type: 'event',
        content: `${author}: ${message}`,
        streamId,
        streamType: 'discord',
        state: {
          source: 'discord',
          eventType: 'discord-message',
          metadata: { channelName, author }
        }
      }
    }],
    transition: {
      sequence: seq,
      timestamp: new Date().toISOString(),
      elementOps: [],
      componentOps: [],
      componentChanges: [],
      veilOps: []
    }
  };
}

async function testFocusedUnfocusedRendering() {
  console.log('\n🎯 Test: Focused vs Unfocused Rendering');
  console.log('========================================\n');
  
  const hud = new FrameTrackingHUD();
  const veilManager = new VEILStateManager();
  
  // Create conversation across two channels
  console.log('📝 Creating multi-channel conversation...');
  console.log('   Channels: #general, #random\n');
  
  const frames = [
    createDiscordFrame(1, 'general', 'Alice', 'Hello everyone!'),
    createDiscordFrame(2, 'general', 'Bob', 'Hi Alice!'),
    createDiscordFrame(3, 'random', 'Charlie', 'Anyone here?'),
    createDiscordFrame(4, 'random', 'Diana', 'Yes, I am!'),
    createDiscordFrame(5, 'general', 'Alice', 'How are you all?'),
    createDiscordFrame(6, 'random', 'Charlie', 'Doing great!'),
  ];
  
  for (const frame of frames) {
    veilManager.finalizeFrame(frame);
  }
  
  const state = veilManager.getState();
  
  // Test 1: Render with #general focused
  console.log('🎯 Test 1: Rendering with #general focused');
  console.log('───────────────────────────────────────────\n');
  
  const contextGeneral = hud.render(
    state.frameHistory,
    state.facets,
    veilManager,
    undefined,
    {
      renderContext: {
        focusedStream: 'discord:MyServer:general',
        displayMode: 'focused'
      }
    }
  );
  
  console.log('Messages:');
  contextGeneral.messages.forEach((msg, i) => {
    console.log(`[${i}] ${msg.role}:`);
    console.log(`    ${msg.content.replace(/\n/g, '\n    ')}`);
    console.log();
  });
  
  // Test 2: Render with #random focused
  console.log('\n🎯 Test 2: Rendering with #random focused');
  console.log('──────────────────────────────────────────\n');
  
  const contextRandom = hud.render(
    state.frameHistory,
    state.facets,
    veilManager,
    undefined,
    {
      renderContext: {
        focusedStream: 'discord:MyServer:random',
        displayMode: 'focused'
      }
    }
  );
  
  console.log('Messages:');
  contextRandom.messages.forEach((msg, i) => {
    console.log(`[${i}] ${msg.role}:`);
    console.log(`    ${msg.content.replace(/\n/g, '\n    ')}`);
    console.log();
  });
  
  // Test 3: Render with no focus (all detailed)
  console.log('\n🎯 Test 3: Rendering with no focus (all streams detailed)');
  console.log('─────────────────────────────────────────────────────────\n');
  
  const contextNoFocus = hud.render(
    state.frameHistory,
    state.facets,
    veilManager,
    undefined,
    {
      // No renderContext = no focus = all streams rendered fully
    }
  );
  
  console.log('Messages:');
  contextNoFocus.messages.forEach((msg, i) => {
    console.log(`[${i}] ${msg.role}:`);
    console.log(`    ${msg.content.replace(/\n/g, '\n    ')}`);
    console.log();
  });
  
  // Verify cache created different contexts
  console.log('\n📊 Cache Verification');
  console.log('──────────────────────\n');
  
  // Enable cache and render both contexts
  const contextGeneralCached = hud.render(
    state.frameHistory,
    state.facets,
    veilManager,
    undefined,
    {
      renderContext: {
        focusedStream: 'discord:MyServer:general'
      },
      frameRenderCache: {
        enabled: true,
        cacheBorderDepth: 2
      }
    }
  );
  
  const contextRandomCached = hud.render(
    state.frameHistory,
    state.facets,
    veilManager,
    undefined,
    {
      renderContext: {
        focusedStream: 'discord:MyServer:random'
      },
      frameRenderCache: {
        enabled: true,
        cacheBorderDepth: 2
      }
    }
  );
  
  const stats = hud.getCacheStats();
  const contexts = hud.getCachedContexts();
  
  console.log(`Cache contexts: ${stats.contextCount}`);
  console.log(`Context keys:`);
  contexts.forEach(key => console.log(`  - ${key}`));
  console.log();
  
  // Verify they're different
  const generalContent = contextGeneralCached.messages.map(m => m.content).join('\n');
  const randomContent = contextRandomCached.messages.map(m => m.content).join('\n');
  
  if (generalContent !== randomContent) {
    console.log('✅ Different focus = different rendering!');
    console.log(`   #general focused: ${generalContent.length} chars`);
    console.log(`   #random focused: ${randomContent.length} chars`);
  } else {
    console.log('❌ ERROR: Renderings are identical (focus not working)');
  }
  
  // Check for XML markers in unfocused frames
  const hasXmlMarkers = generalContent.includes('<event stream="discord:MyServer:random"') ||
                        randomContent.includes('<event stream="discord:MyServer:general"');
  
  if (hasXmlMarkers) {
    console.log('✅ Unfocused frames have XML structure!');
  } else {
    console.log('⚠️  No XML markers found (might all be focused)');
  }
  
  console.log('\n✅ All tests completed!');
}

if (require.main === module) {
  testFocusedUnfocusedRendering().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export { testFocusedUnfocusedRendering };

