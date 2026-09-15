import type { FastifyPluginAsync } from "fastify";
import { GatewayHandler } from "@cloudops/gateway";

export interface GatewayRouteOptions {
  gatewayHandler?: GatewayHandler | undefined;
}

export const gatewayRoutes: FastifyPluginAsync<GatewayRouteOptions> = async (fastify, opts) => {
  const handler = opts.gatewayHandler || new GatewayHandler();

  fastify.get(
    "/v1/gateway/ws",
    { websocket: true },
    (socket /* WebSocket */) => {
      handler.handleConnection(socket as any);
    }
  );
};
