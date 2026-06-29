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
 * Detects speech segments by analyzing the RMS energy of the audio.
 * Uses an adaptive threshold based on the noise floor of the recording.
 */
export function detectSilence(
  audioBuffer: AudioBuffer
): { segments: AudioSegment[]; threshold: number } {
  const sampleRate = audioBuffer.sampleRate;
  const data = audioBuffer.getChannelData(0); // Analyze mono track

  const frameSize = Math.floor(0.02 * sampleRate); // 20ms frames
  const hopSize = Math.floor(0.01 * sampleRate);  // 10ms hops
  const numSamples = data.length;

  const rmsList: number[] = [];
  const dbList: number[] = [];

  // 1. Calculate RMS and dB for each frame
  for (let offset = 0; offset + frameSize < numSamples; offset += hopSize) {
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const val = data[offset + i];
      sum += val * val;
    }
    const rms = Math.sqrt(sum / frameSize);
    rmsList.push(rms);

    // Convert to dBFS
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    dbList.push(db);
  }

  // If we have no frames, return the whole audio
  if (dbList.length === 0) {
    return {
      segments: [{ start: 0, end: audioBuffer.duration }],
      threshold: -40,
    };
  }

  // 2. Estimate noise floor using 15th percentile of dB values
  const sortedDbs = [...dbList].sort((a, b) => a - b);
  const noiseFloorIdx = Math.floor(sortedDbs.length * 0.15);
  const noiseFloor = sortedDbs[noiseFloorIdx];

  // Threshold is noiseFloor + 12dB margin, bounded between -45dB and -25dB
  let threshold = noiseFloor + 12;
  if (threshold < -45) threshold = -45;
  if (threshold > -25) threshold = -25;

  // 3. Precision Silence Detection algorithm
  const frameDuration = hopSize / sampleRate;
  const cuts: AudioSegment[] = [];
  const numFrames = dbList.length;

  let i = 0;
  while (i < numFrames) {
    if (dbList[i] < threshold) {
      const potentialStartIdx = i;
      const potentialStartTime = potentialStartIdx * frameDuration;

      let j = i;
      while (j < numFrames && dbList[j] < threshold) {
        j++;
      }

      const silenceDuration = (j - potentialStartIdx) * frameDuration;

      if (silenceDuration > 0.200) {
        // Exceeds 200ms, mark that point as silenceStart (the cut-in anchor)
        const silenceStart = potentialStartTime + 0.200;

        // Scan forward frame-by-frame looking for the next voice uprise
        let upriseIdx = j;
        while (upriseIdx < numFrames && dbList[upriseIdx] < threshold) {
          upriseIdx++;
        }

        let silenceEnd: number;
        if (upriseIdx < numFrames) {
          const upriseTime = upriseIdx * frameDuration;
          silenceEnd = upriseTime - 0.200;
        } else {
          // If no uprise is found, silence extends to the end of the audio
          silenceEnd = audioBuffer.duration;
        }

        if (silenceEnd > silenceStart) {
          cuts.push({ start: silenceStart, end: silenceEnd });
        }

        // Resume scanning from silenceEnd forward, resetting the silence accumulator
        const nextScanIdx = Math.floor(silenceEnd / frameDuration);
        i = Math.max(i + 1, nextScanIdx);
      } else {
        i = Math.max(i + 1, j);
      }
    } else {
      i++;
    }
  }

  // Convert the cuts to keep-segments relative to the total duration
  const keepSegments: AudioSegment[] = [];
  let current = 0;
  // Sort cuts by start time
  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);
  for (const cut of sortedCuts) {
    if (cut.start > current) {
      keepSegments.push({ start: current, end: cut.start });
    }
    current = cut.end;
  }
  if (current < audioBuffer.duration) {
    keepSegments.push({ start: current, end: audioBuffer.duration });
  }

  // Filter out extremely short keep-segments (pops/noise spikes)
  const finalSegments = keepSegments.filter(seg => (seg.end - seg.start) >= 0.15);

  // If everything was cut, return a tiny silent segment or original to prevent empty buffers
  if (finalSegments.length === 0) {
    return {
      segments: [{ start: 0, end: Math.min(audioBuffer.duration, 0.5) }],
      threshold,
    };
  }

  return {
    segments: finalSegments,
    threshold,
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
  const crossfadeDuration = 0.010; // 10ms crossfade (8-12ms range)
  
  if (segments.length === 0) {
    return audioBuffer;
  }

  // Create equal-power crossfade curves
  const curveLength = 100;
  const fadeInCurve = new Float32Array(curveLength);
  const fadeOutCurve = new Float32Array(curveLength);
  for (let i = 0; i < curveLength; i++) {
    const fraction = i / (curveLength - 1);
    fadeInCurve[i] = Math.sin(fraction * Math.PI / 2);
    fadeOutCurve[i] = Math.cos(fraction * Math.PI / 2);
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
      // Subsequent segments fade in (equal-power)
      gainNode.gain.setValueCurveAtTime(fadeInCurve, playStartTime, crossfadeDuration);
    }

    // If it's not the last segment, we fade it out at the end (equal-power)
    if (i < segments.length - 1) {
      const fadeOutStartTime = playStartTime + segDuration - crossfadeDuration;
      gainNode.gain.setValueCurveAtTime(fadeOutCurve, fadeOutStartTime, crossfadeDuration);
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
