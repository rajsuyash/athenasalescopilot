import AVFoundation
import Foundation

/// Microphone capture via AVAudioEngine. Resamples to 16 kHz mono Int16 (PCM
/// s16le) and emits Data chunks.
///
/// PRD F2 specifies system + mic mixed; v1 of this overlay is mic-only. To
/// capture system audio too, the user routes Meet output through BlackHole
/// into the system input device (see docs/runbooks/personal-call-setup.md).
final class AudioCapture {
    private let engine = AVAudioEngine()
    private let targetSampleRate: Double = 16_000
    private var converter: AVAudioConverter?
    private var convertedFormat: AVAudioFormat?
    var onPCM: ((Data) -> Void)?

    func start() throws {
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard
            let outFmt = AVAudioFormat(
                commonFormat: .pcmFormatInt16,
                sampleRate: targetSampleRate,
                channels: 1,
                interleaved: true
            )
        else {
            throw NSError(domain: "athena.audio", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Failed to build output PCM format"
            ])
        }
        self.convertedFormat = outFmt
        self.converter = AVAudioConverter(from: inputFormat, to: outFmt)

        // Tap with a small buffer (~100 ms equivalent) to keep latency bounded.
        let bufferSize: AVAudioFrameCount = 4096
        input.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
            guard let self = self else { return }
            self.handleBuffer(buffer)
        }

        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    private func handleBuffer(_ inputBuffer: AVAudioPCMBuffer) {
        guard
            let converter = self.converter,
            let outFmt = self.convertedFormat
        else {
            return
        }

        // Compute output capacity from the SR ratio.
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

        if status == .error || error != nil {
            return
        }

        guard let int16Channels = outBuffer.int16ChannelData else { return }
        let frameCount = Int(outBuffer.frameLength)
        if frameCount == 0 { return }

        // mono → contiguous Int16 little-endian (Darwin is LE on Apple Silicon + Intel).
        let byteCount = frameCount * MemoryLayout<Int16>.size
        let data = Data(bytes: int16Channels[0], count: byteCount)
        onPCM?(data)
    }
}
