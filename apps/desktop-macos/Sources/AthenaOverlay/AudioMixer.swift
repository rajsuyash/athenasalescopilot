import Foundation

/// Sample-aligned mixer for two 16 kHz mono Int16 PCM streams (mic + system
/// audio). Pulls 100 ms windows out of two ring buffers, sums the samples
/// with clamping, and emits a single mixed PCM frame.
///
/// Concurrency: callers push from arbitrary threads; the timer that drains
/// runs on a serial queue. We guard the buffers with a lock.
final class AudioMixer {
    private let frameSize = 1600 // 100 ms @ 16 kHz mono
    private let lock = NSLock()
    private var micBuffer: [Int16] = []
    private var systemBuffer: [Int16] = []
    private let drainQueue = DispatchQueue(label: "athena.audio.mixer")
    private var timer: DispatchSourceTimer?

    var onMixedPCM: ((Data) -> Void)?

    func start() {
        stop()
        let t = DispatchSource.makeTimerSource(queue: drainQueue)
        // 100 ms cadence — matches frameSize. Keep tight tolerance so latency
        // doesn't drift under load.
        t.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100), leeway: .milliseconds(5))
        t.setEventHandler { [weak self] in self?.drainOnce() }
        t.resume()
        timer = t
    }

    func stop() {
        timer?.cancel()
        timer = nil
        lock.lock()
        micBuffer.removeAll(keepingCapacity: true)
        systemBuffer.removeAll(keepingCapacity: true)
        lock.unlock()
    }

    func pushMic(_ data: Data) {
        appendInt16(data, into: &micBuffer)
    }

    func pushSystem(_ data: Data) {
        appendInt16(data, into: &systemBuffer)
    }

    private func appendInt16(_ data: Data, into target: inout [Int16]) {
        let count = data.count / MemoryLayout<Int16>.size
        if count == 0 { return }
        var samples = [Int16](repeating: 0, count: count)
        _ = samples.withUnsafeMutableBytes { dst in
            data.copyBytes(to: dst.bindMemory(to: Int16.self), count: count * MemoryLayout<Int16>.size)
        }
        lock.lock()
        // Cap each side at ~2 s to avoid unbounded growth if one source stalls.
        let cap = frameSize * 20
        target.append(contentsOf: samples)
        if target.count > cap {
            target.removeFirst(target.count - cap)
        }
        lock.unlock()
    }

    private func drainOnce() {
        lock.lock()
        let micAvailable = micBuffer.count
        let sysAvailable = systemBuffer.count
        // Only emit when at least one side has a full frame ready. Use silence
        // for the side that doesn't.
        if micAvailable < frameSize && sysAvailable < frameSize {
            lock.unlock()
            return
        }
        let micSlice: [Int16] = takeFrame(from: &micBuffer)
        let sysSlice: [Int16] = takeFrame(from: &systemBuffer)
        lock.unlock()

        var mixed = [Int16](repeating: 0, count: frameSize)
        for i in 0..<frameSize {
            // Sum with saturation to Int16 range.
            let s = Int32(micSlice[i]) + Int32(sysSlice[i])
            let clamped = max(Int32(Int16.min), min(Int32(Int16.max), s))
            mixed[i] = Int16(clamped)
        }
        let data = mixed.withUnsafeBufferPointer { Data(buffer: $0) }
        onMixedPCM?(data)
    }

    /// Pop `frameSize` samples from `buffer`. If less is available, pad with
    /// zeros (silence). Caller holds the lock.
    private func takeFrame(from buffer: inout [Int16]) -> [Int16] {
        if buffer.count >= frameSize {
            let slice = Array(buffer.prefix(frameSize))
            buffer.removeFirst(frameSize)
            return slice
        }
        let have = buffer.count
        var slice = [Int16](repeating: 0, count: frameSize)
        if have > 0 {
            for i in 0..<have { slice[i] = buffer[i] }
            buffer.removeAll(keepingCapacity: true)
        }
        return slice
    }
}
