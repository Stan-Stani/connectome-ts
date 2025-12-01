#!/bin/bash
# Load nvm (needed for non-interactive shells)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd /home/tengro/Development/connectome-typescript/connectome-ts
exec npx ts-node src/testing/debug-mcp-stdio.ts

