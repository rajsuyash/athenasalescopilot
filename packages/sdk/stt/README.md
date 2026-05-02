# sdk/stt

Provider-abstracted streaming speech-to-text. Required wrapper for all STT use; services MUST NOT import vendor SDKs directly.

## Interface (sketch)

```ts
interface SttClient {
  openStream(opts: {
    workspaceId: WorkspaceId;
    meetingId: MeetingId;
    language: string;
    vocabulary?: string[];
    onPartial(seg: TranscriptPartial): void;
    onFinal(seg: TranscriptFinal): void;
    onError(e: SttError): void;
  }): SttStream;
}
```

## Providers (TBD per ADR)

- Deepgram
- AssemblyAI
- Speechmatics

Selection per workspace via config; fallback chain on degradation.
