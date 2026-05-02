/** PRD: workspace_id is required on every call, even though embedding API itself is global. */
export interface EmbedRequest {
  workspaceId: string;
  texts: string[];
  /** Provider-agnostic logical model name; provider implements its own mapping. */
  model?: string;
}

export interface EmbedResult {
  vectors: number[][];
  /** Dimension of every returned vector. Must match `knowledge_chunks.embedding` column. */
  dimension: number;
  model: string;
  /** Provider-reported usage where available. */
  usage?: { promptTokens?: number; totalTokens?: number };
}

export interface EmbeddingClient {
  embed(req: EmbedRequest): Promise<EmbedResult>;
  /** Default vector dimension for the configured model. */
  dimension(): number;
}
