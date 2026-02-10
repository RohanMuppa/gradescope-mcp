/**
 * Tests for MCP server creation and basic functionality.
 * Validates server initialization, tool registration, and client connectivity.
 */

import { describe, it, expect } from "vitest";
import { createServer } from "../../src/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("createServer", () => {
  it("returns an McpServer instance", () => {
    const { server } = createServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  it("server has gradescope-mcp name", async () => {
    const { server } = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const serverInfo = client.getServerVersion();
    expect(serverInfo?.name).toBe("gradescope-mcp");

    await client.close();
    await server.close();
  });

  it("server lists clear_cache tool", async () => {
    const { server } = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const tools = await client.listTools();
    expect(tools.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "clear_cache",
        }),
      ])
    );

    await client.close();
    await server.close();
  });
});
