import type { Server } from 'node:net';

/** A saved port is a reconnect hint, not part of the pinned Mac identity.
 * Retry only a collision on that hint; permission/address/TLS failures remain
 * failures, as does an exhausted ephemeral-port allocation. */
export async function listenDesktopBridge(server: Server, savedPort: number): Promise<void> {
  if (!Number.isInteger(savedPort) || savedPort < 0 || savedPort > 65535) throw new Error('invalid_bridge_port');
  const listen = (requestedPort: number) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { server.removeListener('error', failed); server.removeListener('listening', ready); };
    const failed = (error: NodeJS.ErrnoException) => { cleanup(); reject(error); };
    const ready = () => { cleanup(); resolve(); };
    server.once('error', failed); server.once('listening', ready);
    try { server.listen(requestedPort, '0.0.0'); }
    catch (error) { cleanup(); reject(error); }
  });
  try { await listen(savedPort); }
  catch (error) {
    if (savedPort === 0 || (error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') throw error;
    await listen(0);
  }
}
