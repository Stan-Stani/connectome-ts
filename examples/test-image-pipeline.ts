
/**
 * Test Image Pipeline
 * 
 * Verifies that image attachments attached to facets are correctly propagated
 * through the HUD rendering pipeline and appear in the final LLM context.
 */

import { 
  VEILStateManager, 
  FrameTrackingHUD,
  createSpeechFacet, 
  Frame,
  Facet,
  VEILDelta
} from '../src/index';

async function testImagePipeline() {
  console.log('🖼️  Testing Image Attachment Pipeline');
  console.log('='.repeat(50));

  // 1. Setup Infrastructure
  const veilState = new VEILStateManager();
  const hud = new FrameTrackingHUD();
  
  console.log('\n1. Creating simulated Discord message with attachment...');
  
  // Mock attachment data (as it would come from Discord)
  const mockAttachment = {
    id: '123456789',
    url: 'https://cdn.discordapp.com/attachments/123/456/image.png',
    proxyUrl: 'https://media.discordapp.net/attachments/123/456/image.png',
    contentType: 'image/png',
    name: 'test-image.png',
    width: 800,
    height: 600,
    size: 102400
  };

  // Create a speech facet imitating what DiscordMessageReceptor produces
  // Note: In the receptor, we structure it as:
  // state: { ..., metadata: { attachments: [...] } }
  const speechFacet = createSpeechFacet({
    id: 'msg-with-image-1',
    agentId: 'user', // User message
    content: 'Look at this image!',
    streamId: 'discord:general',
    streamType: 'discord'
  });

  // Add the attachment metadata manually (since createSpeechFacet doesn't strictly type it yet)
  if (!speechFacet.state) speechFacet.state = {};
  (speechFacet.state as any).metadata = {
    attachments: [mockAttachment]
  };

  console.log('   Created facet:', {
    id: speechFacet.id,
    content: (speechFacet as any).content,
    attachments: (speechFacet.state as any).metadata.attachments.length
  });

  // 2. Create a Frame containing this facet
  const frame: Frame = {
    sequence: 1,
    timestamp: new Date().toISOString(),
    events: [],
    deltas: [
      {
        type: 'addFacet',
        facet: speechFacet
      }
    ],
    transition: {
      sequence: 1,
      timestamp: new Date().toISOString(),
      elementOps: [],
      componentOps: [],
      componentChanges: [],
      veilOps: [], 
    }
  };

  // 3. Render the context using HUD
  console.log('\n2. Rendering context via FrameTrackingHUD...');
  
  // We need to provide the current state (which includes the facet we just added)
  const currentFacets = new Map<string, Facet>();
  currentFacets.set(speechFacet.id, speechFacet);

  const rendered = hud.render(
    [frame], // History
    currentFacets,
    veilState,
    undefined, // No compression
    { 
      maxTokens: 1000
    }
  );

  // 4. Inspect the result
  console.log('\n3. Inspecting Resulting LLM Context...');
  
  const messages = rendered.messages;
  console.log(`   Total messages: ${messages.length}`);
  
  if (messages.length > 0) {
    const msg = messages[0];
    console.log('   Message Role:', msg.role);
    console.log('   Message Content:', msg.content);
    
    const attachments = msg.metadata?.attachments;
    
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      console.log('   ✅ SUCCESS: Attachments found in metadata!');
      console.log('   Attachment Data:', JSON.stringify(attachments[0], null, 2));
      
      // Verify content matches
      if (attachments[0].url === mockAttachment.url) {
        console.log('   ✅ URL matches input');
      } else {
        console.error('   ❌ URL mismatch');
      }
    } else {
      console.error('   ❌ FAILED: No attachments found in message metadata');
      console.log('   Metadata:', JSON.stringify(msg.metadata, null, 2));
    }
  } else {
    console.error('   ❌ FAILED: No messages generated');
  }
  
  console.log('\n' + '='.repeat(50));
}

testImagePipeline().catch(console.error);

