# Nodus 5.14.1

## New features

No changes in this section.

## Enhancements

No changes in this section.

## Fixes

- Vaults that were already indexed keep their semantic search after updating to 5.14. Version 5.14.0 left them without an active embedding index and asked for a full rebuild. Nodus now reuses the stored embeddings when they come from the model the vault still uses, with no new requests to the provider. Only texts that changed after they were indexed appear as pending.

- Settings no longer freezes Nodus while it shows the embedding indexes. The list reads the vault in short steps and reuses the result until the content changes. While an index is being prepared, the list is no longer reloaded after every batch.
