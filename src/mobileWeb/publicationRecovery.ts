/** The phone's complete response is distinct from its acknowledgement by the
 * Mac. Only an explicit native transport failure enters the pending state. */
export type PublicationCheckpoint = {
  state: string;
  error?: string;
  publicationPending?: boolean;
  recoveredPublication?: boolean;
};
export const pendingPublicationMessage = 'Guardado en este dispositivo. Se sincronizará con Nodus al volver a conectar. Puedes consultarlo en Trabajos y resultados.';

export function preservePendingPublication(checkpoint: PublicationCheckpoint, error: unknown): boolean {
  if (checkpoint.state !== 'saved' || (error as {code?:string})?.code !== 'offline') return false;
  checkpoint.publicationPending = true;
  delete checkpoint.error;
  return true;
}

export class PendingPublicationError extends Error {
  readonly code = 'mobile_publication_pending';
  constructor() { super(pendingPublicationMessage); }
}
