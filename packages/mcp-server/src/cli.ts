#!/usr/bin/env node
/**
 * ClawPilot CLI — single entry point for all commands.
 *
 * Usage:
 *   clawpilot init     — Interactive setup wizard
 *   clawpilot serve    — Start the HTTP server (auto-started by MCP, but can run standalone)
 *   clawpilot          — Start MCP server on stdio (used by VS Code mcp.json)
 */

const command = process.argv[2];

switch (command) {
  case "init":
    require("./init.js");
    break;

  case "serve":
    require("@clawpilot/server");
    break;

  case undefined:
  case "mcp":
    // Default: run the MCP stdio server (what VS Code calls)
    require("./index.js");
    break;

  case "--help":
  case "-h":
    console.log(`
ClawPilot — Bridge GitHub Copilot agent sessions with Microsoft Teams

Usage:
  clawpilot init      Interactive setup wizard (generates .env + mcp.json)
  clawpilot serve     Start the HTTP server standalone
  clawpilot mcp       Start the MCP stdio server (default, used by VS Code)
  clawpilot --help    Show this help

Quick start:
  npm install -g @clawpilot/mcp-server
  clawpilot init
`);
    break;

  default:
    console.error(`Unknown command: ${command}\nRun 'clawpilot --help' for usage.`);
    process.exit(1);
}
