import Foundation

/// Mirrors `~/.athena/config.json` written by the CLI.
struct CliConfig: Codable {
    var apiUrl: String
    var knowledgeUrl: String
    var orchestratorUrl: String
    var postcallUrl: String
    var gatewayUrl: String
    var accessToken: String?
    var refreshToken: String?
    var expiresAt: String?
    var workspaceId: String?
    var userEmail: String?
}

/// PRD F6 window modes. v1 ships Compact only; the others are stubs to keep
/// the rest of the app shape correct as we add them.
enum OverlayMode: String, CaseIterable, Identifiable {
    case micro
    case compact
    case coach
    case checklist
    case silent
    var id: String { rawValue }
}

enum SuggestionType: String, Codable {
    case answer
    case askNext = "ask_next"
    case coach
    case risk
}

struct SuggestionSource: Codable, Identifiable {
    let id: String
    let documentName: String?
    let score: Double
}

struct IntentSnapshot: Codable {
    let categories: [String]
    let stageSignal: String
    let urgencyScore: Double
    let confidence: Double
    let source: String
}

struct Suggestion: Codable, Identifiable {
    var id: String { suggestionId ?? UUID().uuidString }
    let suggestionId: String?
    let type: SuggestionType
    let answerText: String?
    let followupText: String?
    let confidenceScore: Double
    let priorityScore: Double
    let display: Bool
    let rationale: String
    let sources: [SuggestionSource]
    let intent: IntentSnapshot

    enum CodingKeys: String, CodingKey {
        case suggestionId
        case type
        case answerText
        case followupText
        case confidenceScore
        case priorityScore
        case display
        case rationale
        case sources
        case intent
    }
}

struct TranscriptSegment: Codable {
    let segmentId: String
    let text: String
    let startMs: Int
    let endMs: Int
    let confidence: Double
    let isFinal: Bool
    let speakerLabel: String
    let language: String
}

struct ScriptBlock: Identifiable, Sendable {
    let id: String
    let collection: String
    let bodyMd: String
    let persona: String?
    let language: String
}

struct ScriptStage: Identifiable, Sendable {
    var id: String { stage }
    let stage: String
    let blocks: [ScriptBlock]

    static func from(any: [String: Any]) -> ScriptStage? {
        guard let stage = any["stage"] as? String else { return nil }
        let arr = (any["blocks"] as? [[String: Any]]) ?? []
        let blocks = arr.compactMap { d -> ScriptBlock? in
            guard
                let collection = d["collection"] as? String,
                let bodyMd = d["bodyMd"] as? String
            else { return nil }
            let key =
                (d["versionId"] as? String ?? UUID().uuidString)
                + ":" + (d["collectionId"] as? String ?? "")
            return ScriptBlock(
                id: key,
                collection: collection,
                bodyMd: bodyMd,
                persona: d["persona"] as? String,
                language: d["language"] as? String ?? "en-US"
            )
        }
        return ScriptStage(stage: stage, blocks: blocks)
    }
}

struct InboxNotification: Identifiable, Sendable {
    let id: String
    let kind: String
    let title: String
    let body: String
    let linkPath: String?
    let createdAt: String

    static func from(any: [String: Any]) -> InboxNotification? {
        guard
            let id = any["id"] as? String,
            let kind = any["kind"] as? String,
            let title = any["title"] as? String,
            let body = any["body"] as? String,
            let createdAt = any["createdAt"] as? String
        else { return nil }
        return InboxNotification(
            id: id,
            kind: kind,
            title: title,
            body: body,
            linkPath: any["linkPath"] as? String,
            createdAt: createdAt
        )
    }
}

struct RecapPayload: Codable, Sendable {
    struct FollowupEmail: Codable, Sendable {
        let subject: String
        let body: String
    }
    let meetingId: String
    let title: String?
    let summary: String
    let followupEmail: FollowupEmail
    let lowSignal: Bool

    static func from(any: [String: Any]) -> RecapPayload? {
        guard
            let meetingId = any["meetingId"] as? String,
            let summary = any["summary"] as? String,
            let emailObj = any["followupEmail"] as? [String: Any],
            let subject = emailObj["subject"] as? String,
            let body = emailObj["body"] as? String
        else {
            return nil
        }
        return RecapPayload(
            meetingId: meetingId,
            title: any["title"] as? String,
            summary: summary,
            followupEmail: FollowupEmail(subject: subject, body: body),
            lowSignal: any["lowSignal"] as? Bool ?? false
        )
    }
}

/// Server → client envelope.
enum ServerEvent {
    case helloRequired(sessionId: String)
    case ready(sessionId: String, meetingId: String)
    case transcriptPartial(TranscriptSegment)
    case transcriptFinal(segment: TranscriptSegment, speaker: String)
    case suggestion(Suggestion)
    case recap(RecapPayload)
    case errorEvent(code: String, message: String)
    case closed(reason: String)
    case unknown(String)

    static func decode(_ data: Data) -> ServerEvent {
        guard
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = obj["type"] as? String
        else {
            return .unknown(String(data: data, encoding: .utf8) ?? "")
        }
        switch type {
        case "hello.required":
            return .helloRequired(sessionId: obj["sessionId"] as? String ?? "")
        case "ready":
            return .ready(
                sessionId: obj["sessionId"] as? String ?? "",
                meetingId: obj["meetingId"] as? String ?? ""
            )
        case "transcript.partial":
            if
                let segObj = obj["segment"] as? [String: Any],
                let seg = TranscriptSegment.from(any: segObj)
            {
                return .transcriptPartial(seg)
            }
            return .unknown(type)
        case "transcript.final":
            if
                let segObj = obj["segment"] as? [String: Any],
                let seg = TranscriptSegment.from(any: segObj)
            {
                return .transcriptFinal(segment: seg, speaker: obj["speaker"] as? String ?? "unknown")
            }
            return .unknown(type)
        case "suggestion.generated":
            if
                let sugObj = obj["suggestion"] as? [String: Any],
                let s = Suggestion.from(any: sugObj)
            {
                return .suggestion(s)
            }
            return .unknown(type)
        case "recap.ready":
            if
                let recapObj = obj["recap"] as? [String: Any],
                let r = RecapPayload.from(any: recapObj)
            {
                return .recap(r)
            }
            return .unknown(type)
        case "error":
            return .errorEvent(
                code: obj["code"] as? String ?? "ERROR",
                message: obj["message"] as? String ?? ""
            )
        case "closed":
            return .closed(reason: obj["reason"] as? String ?? "")
        default:
            return .unknown(type)
        }
    }
}

extension TranscriptSegment {
    static func from(any: [String: Any]) -> TranscriptSegment? {
        guard
            let segmentId = any["segmentId"] as? String,
            let text = any["text"] as? String,
            let startMs = any["startMs"] as? Int,
            let endMs = any["endMs"] as? Int,
            let confidence = any["confidence"] as? Double,
            let isFinal = any["isFinal"] as? Bool,
            let speakerLabel = any["speakerLabel"] as? String,
            let language = any["language"] as? String
        else {
            return nil
        }
        return TranscriptSegment(
            segmentId: segmentId,
            text: text,
            startMs: startMs,
            endMs: endMs,
            confidence: confidence,
            isFinal: isFinal,
            speakerLabel: speakerLabel,
            language: language
        )
    }
}

extension Suggestion {
    static func from(any: [String: Any]) -> Suggestion? {
        guard let typeRaw = any["type"] as? String, let type = SuggestionType(rawValue: typeRaw) else {
            return nil
        }
        let intentObj = any["intent"] as? [String: Any] ?? [:]
        let intent = IntentSnapshot(
            categories: intentObj["categories"] as? [String] ?? [],
            stageSignal: intentObj["stageSignal"] as? String ?? "discovery",
            urgencyScore: intentObj["urgencyScore"] as? Double ?? 0,
            confidence: intentObj["confidence"] as? Double ?? 0,
            source: intentObj["source"] as? String ?? "heuristic"
        )
        let sourcesArr = any["sources"] as? [[String: Any]] ?? []
        let sources: [SuggestionSource] = sourcesArr.compactMap { d in
            guard let id = d["id"] as? String else { return nil }
            return SuggestionSource(
                id: id,
                documentName: d["documentName"] as? String,
                score: d["score"] as? Double ?? 0
            )
        }
        return Suggestion(
            suggestionId: any["suggestionId"] as? String,
            type: type,
            answerText: any["answerText"] as? String,
            followupText: any["followupText"] as? String,
            confidenceScore: any["confidenceScore"] as? Double ?? 0,
            priorityScore: any["priorityScore"] as? Double ?? 0,
            display: any["display"] as? Bool ?? false,
            rationale: any["rationale"] as? String ?? "",
            sources: sources,
            intent: intent
        )
    }
}
