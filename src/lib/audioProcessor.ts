import { Mp3Encoder } from '@breezystack/lamejs';

export interface AudioSegment {
  start: number; // in seconds
  end: number;   // in seconds
}

/**
 * Decodes an uploaded audio/video file to an AudioBuffer using the browser's native AudioContext.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  // Use a temporary AudioContext to decode
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioContextClass();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return audioBuffer;
  } finally {
    await ctx.close();
  }
}

/**
 * Slices an AudioBuffer from startSec to endSec.
 */
export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.min(buffer.length, Math.floor(endSec * sampleRate));
  const frameCount = Math.max(1, endSample - startSample);

  const newBuffer = new AudioBuffer({
    length: frameCount,
    numberOfChannels: numChannels,
    sampleRate: sampleRate
  });

  for (let c = 0; c < numChannels; c++) {
    const origData = buffer.getChannelData(c);
    const slicedData = origData.subarray(startSample, endSample);
    newBuffer.copyToChannel(slicedData, c);
  }

  return newBuffer;
}

/**
 * Detects silence and speech segments using the Precision Silence Detection algorithm.
 * Returns both the speech segments to KEEP and the silence segments to REMOVE.
 */
export function detectSilence(
  audioBuffer: AudioBuffer,
  options: {
    minSilenceDuration?: number; // min duration of silence to cut (seconds)
  } = {}
): { segments: AudioSegment[]; silenceSegments: AudioSegment[] } {
  const minSilence = options.minSilenceDuration ?? 0.02; // Keep natural spacing if < 20ms

  const sampleRate = audioBuffer.sampleRate;
  const data = audioBuffer.getChannelData(0); // Analyze mono track

  const frameSize = Math.floor(0.02 * sampleRate); // 20ms frames
  const hopSize = Math.floor(0.01 * sampleRate);  // 10ms hops
  const numSamples = data.length;

  const dbList: number[] = [];
  const frameTimes: number[] = [];

  // 1. Calculate dB for each frame
  for (let offset = 0; offset + frameSize < numSamples; offset += hopSize) {
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const val = data[offset + i];
      sum += val * val;
    }
    const rms = Math.sqrt(sum / frameSize);
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    dbList.push(db);
    frameTimes.push(offset / sampleRate);
  }

  // If we have no frames, return the whole audio as speech
  if (dbList.length === 0) {
    return {
      segments: [{ start: 0, end: audioBuffer.duration }],
      silenceSegments: [],
    };
  }

  // 2. Compute local adaptive thresholds continuously across the file
  const thresholdList: number[] = [];
  const windowRadius = 200; // ±2 seconds (200 frames of 10ms hop)
  
  for (let i = 0; i < dbList.length; i++) {
    const startIdx = Math.max(0, i - windowRadius);
    const endIdx = Math.min(dbList.length - 1, i + windowRadius);
    
    // Slice and sort the local window to find the local noise floor
    const localDbs = dbList.slice(startIdx, endIdx + 1);
    localDbs.sort((a, b) => a - b);
    
    const noiseFloorIdx = Math.floor(localDbs.length * 0.15);
    const localNoiseFloor = localDbs[noiseFloorIdx];
    
    // Bounded adaptive speech threshold
    let threshold = localNoiseFloor + 12;
    if (threshold < -45) threshold = -45;
    if (threshold > -25) threshold = -25;
    
    thresholdList.push(threshold);
  }

  // 3. Scan frame-by-frame for silenceStart and silenceEnd (Precision Silence Algorithm)
  const silenceSegments: AudioSegment[] = [];
  let inSilence = false;
  let silenceStart = 0;
  let silentFramesCount = 0;

  for (let i = 0; i < dbList.length; i++) {
    const time = frameTimes[i];
    const db = dbList[i];
    const threshold = thresholdList[i];

    if (db < threshold) {
      silentFramesCount++;
      // If we accumulated more than 20ms of silence
      if (!inSilence && (silentFramesCount * hopSize) / sampleRate >= 0.02) {
        inSilence = true;
        // The first frame of this silent block is our anchor
        silenceStart = frameTimes[i - silentFramesCount + 1];
      }
    } else {
      if (inSilence) {
        // Voice uprise detected
        const upriseTime = time;
        const silenceEnd = upriseTime - 0.02; // Retain 20ms pre-uprise buffer

        const netGap = silenceEnd - silenceStart;
        // Do NOT cut if net gap is less than 20ms (which naturally includes the 5ms check)
        if (netGap >= minSilence) {
          silenceSegments.push({ start: silenceStart, end: silenceEnd });
        }
        inSilence = false;
      }
      silentFramesCount = 0;
    }
  }

  // Handle final open silence
  if (inSilence) {
    const silenceEnd = audioBuffer.duration;
    if (silenceEnd - silenceStart >= minSilence) {
      silenceSegments.push({ start: silenceStart, end: silenceEnd });
    }
  }

  // 4. Invert silence segments to get speech segments to KEEP
  const speechSegments: AudioSegment[] = [];
  let currentPos = 0;
  for (const sil of silenceSegments) {
    if (sil.start > currentPos + 0.01) { // 10ms min keep length
      speechSegments.push({ start: currentPos, end: sil.start });
    }
    currentPos = sil.end;
  }
  if (currentPos < audioBuffer.duration - 0.01) {
    speechSegments.push({ start: currentPos, end: audioBuffer.duration });
  }

  return {
    segments: speechSegments.length > 0 ? speechSegments : [{ start: 0, end: Math.min(audioBuffer.duration, 0.1) }],
    silenceSegments,
  };
}

/**
 * Reconstructs the audio using only the provided segments, applying a 10ms crossfade at cut boundaries.
 */
export async function cutAudio(
  audioBuffer: AudioBuffer,
  segments: AudioSegment[]
): Promise<AudioBuffer> {
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const crossfadeDuration = 0.01; // 10ms crossfade

  if (segments.length === 0) {
    return audioBuffer;
  }

  // Calculate the total destination duration
  let totalDuration = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    totalDuration += (seg.end - seg.start);
    if (i > 0) {
      totalDuration -= crossfadeDuration;
    }
  }

  // Clamp total duration to be positive
  totalDuration = Math.max(0.1, totalDuration);

  // Setup OfflineAudioContext
  const AudioContextClass = window.OfflineAudioContext || (window as any).OfflineAudioContext;
  const offlineCtx = new AudioContextClass(
    numChannels,
    Math.floor(totalDuration * sampleRate),
    sampleRate
  );

  let currentDestTime = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segDuration = seg.end - seg.start;

    // Create buffer source
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    // Create gain node for crossfading
    const gainNode = offlineCtx.createGain();

    // Connect source -> gain -> destination
    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    // Schedule play
    // Since we are crossfading, we overlap start time of seg(i) with end time of seg(i-1)
    const playStartTime = i === 0 ? 0 : currentDestTime - crossfadeDuration;

    // For the source, we start playing the segment.
    // The offset is seg.start.
    source.start(playStartTime, seg.start, segDuration);

    // Apply gain scheduling for crossfade
    if (i === 0) {
      // First segment starts at full volume
      gainNode.gain.setValueAtTime(1.0, 0);
    } else {
      // Subsequent segments fade in
      gainNode.gain.setValueAtTime(0.0, playStartTime);
      gainNode.gain.linearRampToValueAtTime(1.0, playStartTime + crossfadeDuration);
    }

    // If it's not the last segment, we fade it out at the end
    if (i < segments.length - 1) {
      const fadeOutStartTime = playStartTime + segDuration - crossfadeDuration;
      gainNode.gain.setValueAtTime(1.0, fadeOutStartTime);
      gainNode.gain.linearRampToValueAtTime(0.0, fadeOutStartTime + crossfadeDuration);
    }

    // Update destination time tracker
    currentDestTime = playStartTime + segDuration;
  }

  // Render the audio buffer offline
  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
}

/**
 * Encodes an AudioBuffer into a WAV Blob (16-bit PCM).
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // 1 = Raw PCM
  const bitDepth = 16;

  let interleavedData: Float32Array;
  if (numOfChan === 2) {
    interleavedData = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    interleavedData = buffer.getChannelData(0);
  }

  const dataLength = interleavedData.length * 2; // 16-bit = 2 bytes per sample
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);

  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write PCM data
  let offset = 44;
  for (let i = 0; i < interleavedData.length; i++) {
    let s = Math.max(-1, Math.min(1, interleavedData[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Encodes an AudioBuffer into an MP3 Blob using lamejs.
 */
export function audioBufferToMp3(buffer: AudioBuffer, kbps: number = 192): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: any[] = [];

  const sampleBlockSize = 1152; // Lame standard block size

  if (channels === 2) {
    const leftData = buffer.getChannelData(0);
    const rightData = buffer.getChannelData(1);
    
    // Convert to Int16
    const leftInt16 = new Int16Array(leftData.length);
    const rightInt16 = new Int16Array(rightData.length);
    for (let i = 0; i < leftData.length; i++) {
      let sL = Math.max(-1, Math.min(1, leftData[i]));
      leftInt16[i] = sL < 0 ? sL * 0x8000 : sL * 0x7FFF;

      let sR = Math.max(-1, Math.min(1, rightData[i]));
      rightInt16[i] = sR < 0 ? sR * 0x8000 : sR * 0x7FFF;
    }

    for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
      const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
      const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }
  } else {
    const monoData = buffer.getChannelData(0);
    const monoInt16 = new Int16Array(monoData.length);
    for (let i = 0; i < monoData.length; i++) {
      let s = Math.max(-1, Math.min(1, monoData[i]));
      monoInt16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    for (let i = 0; i < monoInt16.length; i += sampleBlockSize) {
      const monoChunk = monoInt16.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(monoChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }
  }

  const mp3bufFlush = mp3encoder.flush();
  if (mp3bufFlush.length > 0) {
    mp3Data.push(mp3bufFlush);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}
