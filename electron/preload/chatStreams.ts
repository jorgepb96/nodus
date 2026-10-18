// The chat streams in flight on one surface, so its Stop button aborts the right one without
// the renderer juggling request ids. Several chats of a surface may answer at once (the
// composer locks only in the chat that is answering), so each stream is kept under its
// conversation; a stop names the conversation it was pressed in.
export function chatStreamRegistry() {
  const byConversation = new Map<string, string>();
  let latest: string | null = null;
  return {
    /** Registers a stream; the returned function forgets it once it has settled. */
    track(requestId: string, conversationId?: string) {
      latest = requestId;
      if (conversationId) byConversation.set(conversationId, requestId);
      return () => {
        if (latest === requestId) latest = null;
        if (conversationId && byConversation.get(conversationId) === requestId) byConversation.delete(conversationId);
      };
    },
    /** That conversation's stream, or none; without a conversation, the stream started last. */
    find(conversationId?: string): string | null {
      return conversationId ? byConversation.get(conversationId) ?? null : latest;
    },
  };
}
