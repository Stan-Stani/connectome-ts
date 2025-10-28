/**
 * Control Panel Example
 * 
 * Demonstrates using registerActionWithInstructions() to create
 * tools with progressive disclosure - instructions only visible when needed.
 */

import { InteractiveComponent } from '../src/components/base-components';

class FileSystemPanelComponent extends InteractiveComponent {
  async onMount() {
    // Panel control actions (always visible)
    this.registerActionWithInstructions(
      'open',
      async () => { await this.openPanel(); },
      'To access file system tools, use @filesystem.open',
      {
        description: 'Open the file system control panel',
        category: 'filesystem'
      }
    );
    
    this.registerActionWithInstructions(
      'close',
      async () => { await this.closePanel(); },
      'To close this panel, use @filesystem.close',
      {
        description: 'Close the file system control panel',
        category: 'filesystem',
        scope: ['panel:filesystem']  // Only visible when panel open
      }
    );
    
    // File operations (only visible when panel open)
    this.registerActionWithInstructions(
      'listFiles',
      async (params) => { await this.listFiles(params?.path); },
      'List files: @filesystem.listFiles(path="/some/path")',
      {
        description: 'List files in a directory',
        params: { path: { type: 'string', required: false } },
        category: 'filesystem',
        scope: ['panel:filesystem']  // Only when panel open
      }
    );
    
    this.registerActionWithInstructions(
      'readFile',
      async (params) => { await this.readFile(params?.path); },
      'Read file: @filesystem.readFile(path="/path/to/file")',
      {
        description: 'Read contents of a file',
        params: { path: { type: 'string', required: true } },
        category: 'filesystem',
        scope: ['panel:filesystem']
      }
    );
    
    this.registerActionWithInstructions(
      'writeFile',
      async (params) => { await this.writeFile(params?.path, params?.content); },
      'Write file: @filesystem.writeFile(path="/path", content="...")',
      {
        description: 'Write content to a file',
        params: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true }
        },
        category: 'filesystem',
        scope: ['panel:filesystem']
      }
    );
  }
  
  private async openPanel() {
    // Activate the panel scope - makes scoped instructions visible
    this.addEvent(
      'File system panel opened - file operations now available',
      'panel-opened',
      'filesystem-panel-opened',
      { panelId: 'filesystem' }
    );
    
    // Set scope active
    this.addOperation({
      type: 'addFacet',
      facet: {
        id: 'scope-panel-filesystem',
        type: 'scope-change' as any,
        scope: ['panel:filesystem'],
        state: { active: true }
      } as any
    });
  }
  
  private async closePanel() {
    this.addEvent(
      'File system panel closed',
      'panel-closed',
      'filesystem-panel-closed',
      { panelId: 'filesystem' }
    );
    
    // Deactivate scope - hides scoped instructions
    this.addOperation({
      type: 'addFacet',
      facet: {
        id: 'scope-panel-filesystem',
        type: 'scope-change' as any,
        scope: ['panel:filesystem'],
        state: { active: false }
      } as any
    });
  }
  
  private async listFiles(path?: string) {
    // Implementation
    this.addEvent(
      `Files in ${path || '/'}: file1.txt, file2.txt, dir1/`,
      'file-list',
      'filesystem-file-list'
    );
  }
  
  private async readFile(path: string) {
    // Implementation
    this.addEvent(
      `Content of ${path}: ...file contents...`,
      'file-content',
      'filesystem-file-content'
    );
  }
  
  private async writeFile(path: string, content: string) {
    // Implementation  
    this.addEvent(
      `Wrote ${content.length} bytes to ${path}`,
      'file-written',
      'filesystem-file-written'
    );
  }
}

/**
 * Agent sees:
 * 
 * INITIALLY (panel closed):
 * - "To access file system tools, use @filesystem.open"
 * 
 * AFTER @filesystem.open:
 * - "To close this panel, use @filesystem.close"
 * - "List files: @filesystem.listFiles(path="/some/path")"
 * - "Read file: @filesystem.readFile(path="/path/to/file")"
 * - "Write file: @filesystem.writeFile(path="/path", content="...")"
 * 
 * AFTER @filesystem.close:
 * - Back to just "To access file system tools, use @filesystem.open"
 * 
 * This pattern enables:
 * - Progressive disclosure (don't overwhelm with 50 tools at once)
 * - Contextual help (instructions appear when relevant)
 * - Menu navigation (panels can nest: main menu → file menu → operations)
 * - Attention management (only show what's currently useful)
 */

