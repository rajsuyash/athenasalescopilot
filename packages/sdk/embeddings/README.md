# sdk/embeddings

Provider-abstracted embedding client for knowledge ingestion + retrieval.

## Interface (sketch)

```ts
interface EmbeddingClient {
  embed(opts: {
    workspaceId: WorkspaceId;
    texts: string[];
    model: string;
  }): Promise<Float32Array[]>;
}
```

## Providers (TBD)

OpenAI text-embedding-3, Voyage, Cohere. Vector dim must match the column type in `knowledge_chunks.embedding` (default 1536; document any change).
