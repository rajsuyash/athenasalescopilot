# sdk/llm

Provider-abstracted LLM client for Stages A, C, D. Services MUST NOT import vendor SDKs directly.

## Interface (sketch)

```ts
interface LlmClient {
  complete(opts: {
    workspaceId: WorkspaceId;
    promptId: string;       // resolves via packages/prompts
    inputs: Record<string, unknown>;
    schema?: ZodSchema;     // optional output validator
    deadlineMs: number;
    traceContext: TraceCtx;
  }): Promise<LlmResult>;
}
```

## Providers (TBD per ADR)

Default: Anthropic Claude. Alt: OpenAI, others. Selection via workspace policy; circuit breaker per provider per workspace.
