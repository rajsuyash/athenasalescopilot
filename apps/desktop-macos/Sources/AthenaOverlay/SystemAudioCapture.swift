import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

/// System audio capture via ScreenCaptureKit (macOS 13.3+). Eliminates the
/// BlackHole virtual-device workaround for capturing the customer side of a
/// Meet call.
///
/// Output is 16 kHz mono Int16 PCM frames pushed via `onPCM`. Caller is
/// responsible for mixing with mic input.
@available(macOS 13.0, *)
final class SystemAudioCapture: NSObject {
    private var stream: SCStream?
    private let sampleQueue = DispatchQueue(label: "athena.system-audio.capture")
    private let targetSampleRate: Double = 16_000
    private var converter: AVAudioConverter?
    private var convertedFormat: AVAudioFormat?

    var onPCM: ((Data) -> Void)?
    var onError: ((Error) -> Void)?

    func start() async throws {
        guard let outFmt = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: targetSampleRate,
            channels: 1,
            interleaved: true
        ) else {
            throw NSError(domain: "athena.system-audio", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to build output PCM format"
            ])
        }
        self.convertedFormat = outFmt

        // Pick a content filter: capture the entire main display's audio. We
        // don't need video — disable it in the SCStreamConfiguration.
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "athena.system-audio", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "No displays available for SCStream"
            ])
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        // Minimum legal video config — we don't render but SCStream requires it.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.queueDepth = 5

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
        // We must subscribe to .screen too, otherwise SCStream won't start.
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() async {
        if let s = stream {
            try? await s.stopCapture()
        }
        stream = nil
        converter = nil
    }

    private func ensureConverter(for inputFormat: AVAudioFormat) -> AVAudioConverter? {
        if let c = converter, c.inputFormat == inputFormat { return c }
        guard let outFmt = convertedFormat else { return nil }
        let c = AVAudioConverter(from: inputFormat, to: outFmt)
        converter = c
        return c
    }

    private func handle(buffer inputBuffer: AVAudioPCMBuffer) {
        guard
            let converter = ensureConverter(for: inputBuffer.format),
            let outFmt = convertedFormat
        else { return }
        let ratio = outFmt.sampleRate / inputBuffer.format.sampleRate
        let outFrames = AVAudioFrameCount(Double(inputBuffer.frameLength) * ratio + 16)
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: outFrames) else {
            return
        }
        var error: NSError?
        var consumed = false
        let status = converter.convert(to: outBuffer, error: &error) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return inputBuffer
        }
        if status == .error || error != nil { return }
        guard let chans = outBuffer.int16ChannelData else { return }
        let frameCount = Int(outBuffer.frameLength)
        if frameCount == 0 { return }
        let byteCount = frameCount * MemoryLayout<Int16>.size
        let data = Data(bytes: chans[0], count: byteCount)
        onPCM?(data)
    }
}

@available(macOS 13.0, *)
extension SystemAudioCapture: SCStreamOutput, SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard sampleBuffer.isValid else { return }
        // Convert CMSampleBuffer → AVAudioPCMBuffer.
        guard let formatDesc = sampleBuffer.formatDescription,
              let asbdRef = formatDesc.audioStreamBasicDescription else {
            return
        }
        var asbd = asbdRef
        guard let inputFmt = AVAudioFormat(streamDescription: &asbd) else { return }
        let frameCount = AVAudioFrameCount(sampleBuffer.numSamples)
        guard let pcm = AVAudioPCMBuffer(pcmFormat: inputFmt, frameCapacity: frameCount) else { return }
        pcm.frameLength = frameCount

        // Copy raw audio into the buffer.
        let blockBuffer = sampleBuffer.dataBuffer
        guard let bb = blockBuffer else { return }
        var lengthAtOffset = 0
        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let result = CMBlockBufferGetDataPointer(
            bb,
            atOffset: 0,
            lengthAtOffsetOut: &lengthAtOffset,
            totalLengthOut: &totalLength,
            dataPointerOut: &dataPointer
        )
        guard result == kCMBlockBufferNoErr, let raw = dataPointer else { return }

        if inputFmt.commonFormat == AVAudioCommonFormat.pcmFormatFloat32, let floatChans = pcm.floatChannelData {
            let bytesPerFrame = Int(inputFmt.streamDescription.pointee.mBytesPerFrame)
            let chCount = Int(inputFmt.channelCount)
            // Interleaved float32 — copy raw bytes across.
            if inputFmt.isInterleaved {
                memcpy(floatChans[0], raw, min(totalLength, Int(frameCount) * bytesPerFrame))
            } else {
                let bytesPerChannel = Int(frameCount) * MemoryLayout<Float32>.size
                for ch in 0..<chCount {
                    memcpy(floatChans[ch], raw.advanced(by: ch * bytesPerChannel), min(bytesPerChannel, totalLength - ch * bytesPerChannel))
                }
            }
        } else if let int16Chans = pcm.int16ChannelData {
            memcpy(int16Chans[0], raw, min(totalLength, Int(frameCount) * MemoryLayout<Int16>.size * Int(inputFmt.channelCount)))
        } else {
            return
        }

        handle(buffer: pcm)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onError?(error)
    }
}

