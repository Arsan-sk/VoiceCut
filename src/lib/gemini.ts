import { audioBufferToMp3, sliceAudioBuffer } from './audioProcessor';

export interface WordTranscript {
  word: string;
  startTime: number;
  endTime: number;
}

export interface GeminiRemoval {
  start: number;
  end: number;
  text: string;
  reason: 'false start' | 'repetition' | 'repetition-partial' | 'inconsistency' | 'silence';
}

export interface RemovedRepetition {
  start: number;
  end: number;
  text: string;
  reason: 'repetition' | 'repetition-partial';
}

export interface GeminiAnalysisResult {
  words: WordTranscript[];
  removals: GeminiRemoval[];
}

/**
 * Converts a Blob to a base64 string.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Transcribes a single audio buffer slice using Gemini 2.5 Flash API.
 * Includes JSON schema reinforcement, temperature = 0.1, and retry logic on parsing failure.
 */
async function transcribeChunk(
  audioBuffer: AudioBuffer,
  apiKey: string,
  chunkStart: number,
  chunkEnd: number,
  onProgress?: (stage: string) => void
): Promise<GeminiAnalysisResult> {
  onProgress?.(`AI Analyzing segment [${chunkStart.toFixed(0)}s - ${chunkEnd.toFixed(0)}s]...`);
  const lowBitrateBlob = audioBufferToMp3(audioBuffer, 48);
  const base64Audio = await blobToBase64(lowBitrateBlob);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const makePayload = (promptText: string) => ({
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: base64Audio,
            },
          },
          {
            text: promptText,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  });

  const basePrompt = `You are an expert audio transcription and analysis engine. Your task is to:
1. Transcribe this audio clip and return a precise, VERBATIM word-level transcript with timestamps in seconds.
IMPORTANT: You MUST transcribe every single word exactly as spoken, including all filler words ("uh", "um", "ah", "er", "uhm", "mhm"), stumbles, hesitations, and word repetitions. Do NOT clean up the speech.
2. Identify all speech stumbles, false starts (where the speaker stumbles and restarts a phrase), filler words, duplicate/repeated attempts of sentences, and grammatical corrections that should be removed to make the audio flow cleanly. For each such occurrence, identify the start and end timestamp in seconds, the text, and the reason.

The audio runs from ${chunkStart.toFixed(2)}s to ${chunkEnd.toFixed(2)}s relative to the original file, but this audio file represents a slice starting at 0s. Timestamps MUST be relative to this slice (starting at 0.00s).

Return the result strictly in the following JSON format:
{
  "words": [
    { "word": "example", "startTime": 0.45, "endTime": 0.82 }
  ],
  "removals": [
    { "start": 0.45, "end": 1.25, "text": "example stumble", "reason": "false start" }
  ]
}
Ensure timestamps align precisely with the words spoken. Output ONLY valid JSON matching the schema. No explanations, no preamble, and no markdown fences.`;

  let responseText = '';
  
  // First attempt
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload(basePrompt)),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      const msg = errJson.error?.message || response.statusText || 'Unknown error';
      throw new Error(`Gemini API Error: ${msg}`);
    }

    const data = await response.json();
    responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err: any) {
    throw new Error(`API Request Failed: ${err?.message || 'Connection failed'}`);
  }

  const parseResult = (text: string): GeminiAnalysisResult => {
    const parsed = JSON.parse(text.trim());
    const words = Array.isArray(parsed.words)
      ? parsed.words.map((w: any) => ({
          word: String(w.word || ''),
          startTime: Number(w.startTime || 0),
          endTime: Number(w.endTime || 0),
        }))
      : [];
    const removals = Array.isArray(parsed.removals)
      ? parsed.removals.map((r: any) => ({
          start: Number(r.start || 0),
          end: Number(r.end || 0),
          text: String(r.text || ''),
          reason: (r.reason || 'inconsistency') as any,
        }))
      : [];
    return { words, removals };
  };

  // Parse check & retry
  try {
    return parseResult(responseText);
  } catch (parseErr) {
    console.warn('Gemini output invalid JSON or schema, retrying...', parseErr, responseText);
    
    // Retry once with strict corrective instruction
    const retryPrompt = `${basePrompt}\n\nYour previous response was not valid JSON. Return only valid JSON matching the schema. No markdown fences, no preamble, no explanation.`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makePayload(retryPrompt)),
      });

      if (!response.ok) {
        throw new Error(`Retry HTTP Error: ${response.statusText}`);
      }

      const data = await response.json();
      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      return parseResult(responseText);
    } catch (retryErr: any) {
      throw new Error(`Gemini Transcription Failed: The AI output could not be parsed as valid JSON. details: ${retryErr?.message || 'Invalid JSON'}`);
    }
  }
}

/**
 * Transcribes the audio buffer and detects inconsistencies, segmenting it into 30s overlapping chunks if necessary.
 * Recombines timestamps and filters duplicates.
 */
export async function getWordLevelTranscript(
  audioBuffer: AudioBuffer,
  apiKey: string,
  onProgress?: (stage: string) => void
): Promise<GeminiAnalysisResult> {
  const duration = audioBuffer.duration;
  const chunkSize = 30; // seconds
  const overlap = 3;    // seconds

  // Single chunk path
  if (duration <= 45) {
    return transcribeChunk(audioBuffer, apiKey, 0, duration, onProgress);
  }

  // Segmenting path
  const chunks: { start: number; end: number }[] = [];
  let start = 0;
  while (start < duration) {
    const end = Math.min(duration, start + chunkSize);
    chunks.push({ start, end });
    if (end >= duration) break;
    start = end - overlap;
  }

  const allWords: WordTranscript[] = [];
  const allRemovals: GeminiRemoval[] = [];

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    onProgress?.(`AI Analyzing chunk ${idx + 1} of ${chunks.length}...`);
    
    const sliced = sliceAudioBuffer(audioBuffer, chunk.start, chunk.end);
    const chunkResult = await transcribeChunk(sliced, apiKey, chunk.start, chunk.end, onProgress);
    
    // Map timestamps back to absolute time
    const absoluteWords = chunkResult.words.map(w => ({
      word: w.word,
      startTime: w.startTime + chunk.start,
      endTime: w.endTime + chunk.start,
    }));

    const absoluteRemovals = chunkResult.removals.map(r => ({
      start: r.start + chunk.start,
      end: r.end + chunk.start,
      text: r.text,
      reason: r.reason
    }));

    // Merge words
    if (idx === 0) {
      allWords.push(...absoluteWords);
      allRemovals.push(...absoluteRemovals);
    } else {
      // Merge logic with overlap split at midpoint
      const prevChunk = chunks[idx - 1];
      const midpoint = prevChunk.end - (overlap / 2);

      // Pop words from previous chunk that end after midpoint
      while (allWords.length > 0 && allWords[allWords.length - 1].endTime > midpoint) {
        allWords.pop();
      }

      // Filter and append current words that start after midpoint
      const filteredCurrentWords = absoluteWords.filter(w => w.startTime > midpoint);
      allWords.push(...filteredCurrentWords);

      // Filter and append current removals that start after midpoint
      const filteredCurrentRemovals = absoluteRemovals.filter(r => r.start > midpoint);
      allRemovals.push(...filteredCurrentRemovals);
    }
  }

  return { words: allWords, removals: allRemovals };
}

/**
 * Aligns the start and end timestamps of a removal to the nearest word boundaries in the transcript.
 * This guarantees millisecond-perfect speech cuts.
 */
export function alignRemovalToWords(
  removal: GeminiRemoval,
  words: WordTranscript[]
): GeminiRemoval {
  if (words.length === 0) return removal;

  let bestStartWord = words[0];
  let bestStartDiff = Math.abs(removal.start - words[0].startTime);

  let bestEndWord = words[0];
  let bestEndDiff = Math.abs(removal.end - words[0].endTime);

  for (const w of words) {
    const startDiff = Math.abs(removal.start - w.startTime);
    if (startDiff < bestStartDiff) {
      bestStartDiff = startDiff;
      bestStartWord = w;
    }

    const endDiff = Math.abs(removal.end - w.endTime);
    if (endDiff < bestEndDiff) {
      bestEndDiff = endDiff;
      bestEndWord = w;
    }
  }

  let start = bestStartWord.startTime;
  let end = bestEndWord.endTime;
  if (end <= start) {
    end = start + 0.1; // Minimal 100ms duration
  }

  return {
    ...removal,
    start,
    end,
  };
}

/**
 * Normalize a word for comparison: lowercase, strip punctuation, trim.
 */
function normalizeWord(w: string): string {
  return w.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'…]/g, '')
    .trim();
}

/**
 * Check if two normalized words match via prefix/stem:
 * one must be a prefix of the other, with at least 3 shared leading characters.
 * Conservative: "talk" matches "talking", "go" does NOT match "got".
 */
function prefixMatch(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 3) return false; // require at least 3 chars
  return longer.startsWith(shorter);
}

/**
 * Check if the first word is a spoken stumble of the second word.
 * This is true if the first word originally ended with a hyphen/dash (e.g. "th-", "w-")
 * and its normalized stem matches the start of the next normalized word.
 */
function isStumbleOf(originalA: string, originalB: string): boolean {
  const normA = normalizeWord(originalA);
  const normB = normalizeWord(originalB);
  if (normA.length === 0 || normB.length === 0) return false;

  // Check if original word ends with a hyphen/dash character
  if (originalA.endsWith('-') || originalA.endsWith('—')) {
    return normB.startsWith(normA);
  }
  return false;
}

/**
 * Searches the word-level transcript to find spoken repetitions, fillers, and stumbles.
 * Detects:
 * 1. Filler words: "uh", "um", "ah", "er", "uhm", "mhm"
 * 2. Speech stumbles (e.g. "th- they") using hyphen-ending words
 * 3. Phrase/word repetitions of length L from 5 down to 1
 * Returns the list of segments to remove.
 */
export function detectRepetitions(words: WordTranscript[]): RemovedRepetition[] {
  console.log(`[RepetitionDetect] Starting detection on ${words.length} words`);
  
  const removals: RemovedRepetition[] = [];
  const flaggedIndices = new Set<number>(); // indices already marked for removal

  const normalized = words.map(w => normalizeWord(w.word));

  const isFiller = (w: string) => {
    return ["uh", "um", "ah", "er", "uhm", "mhm"].includes(w);
  };

  let i = 0;
  while (i < words.length) {
    if (flaggedIndices.has(i)) {
      i++;
      continue;
    }

    const w = normalized[i];

    // 1. Detect filler words
    if (isFiller(w)) {
      const start = words[i].startTime;
      const end = words[i].endTime;
      removals.push({
        start,
        end,
        text: words[i].word,
        reason: 'repetition-partial'
      });
      flaggedIndices.add(i);
      console.log(`[RepetitionDetect] FILLER: "${words[i].word}" at ${start.toFixed(2)}s-${end.toFixed(2)}s`);
      i++;
      continue;
    }

    // 2. Detect stumble / hyphenated false start (L = 1)
    if (i + 1 < words.length && !flaggedIndices.has(i + 1)) {
      if (isStumbleOf(words[i].word, words[i + 1].word)) {
        const start = words[i].startTime;
        const end = words[i].endTime;
        removals.push({
          start,
          end,
          text: words[i].word,
          reason: 'repetition-partial'
        });
        flaggedIndices.add(i);
        console.log(`[RepetitionDetect] STUMBLE: "${words[i].word}" matched "${words[i + 1].word}" at ${start.toFixed(2)}s-${end.toFixed(2)}s`);
        i++;
        continue;
      }
    }

    // 3. Detect repetitions of length L from 5 down to 1
    let matchFound = false;
    for (let L = 5; L >= 1; L--) {
      if (i + 2 * L > words.length) continue;

      let anyFlagged = false;
      for (let k = 0; k < 2 * L; k++) {
        if (flaggedIndices.has(i + k)) {
          anyFlagged = true;
          break;
        }
      }
      if (anyFlagged) continue;

      let exactMatches = 0;
      let partialMatches = 0;
      for (let k = 0; k < L; k++) {
        const wordA = normalized[i + k];
        const wordB = normalized[i + L + k];
        if (wordA === wordB && wordA.length > 0) {
          exactMatches++;
        } else if (prefixMatch(wordA, wordB)) {
          partialMatches++;
        }
      }

      // Match thresholds:
      // For L >= 3: at least L - 1 matching positions
      // For L = 2: both positions must match
      // For L = 1: the single position must match
      const threshold = L >= 3 ? L - 1 : L;
      if (exactMatches + partialMatches >= threshold) {
        const cutStart = i;
        const cutEnd = i + L - 1;
        const start = words[cutStart].startTime;
        const end = words[cutEnd].endTime;
        const text = words.slice(cutStart, cutEnd + 1).map(w => w.word).join(' ');
        const reason = exactMatches >= threshold ? 'repetition' : 'repetition-partial';

        console.log(`[RepetitionDetect] Match L=${L}: "${text}" at ${start.toFixed(2)}s-${end.toFixed(2)}s (${exactMatches} exact, ${partialMatches} partial)`);

        removals.push({ start, end, text, reason });
        for (let k = cutStart; k <= cutEnd; k++) {
          flaggedIndices.add(k);
        }

        i = i + L;
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      i++;
    }
  }

  removals.sort((a, b) => a.start - b.start);
  console.log(`[RepetitionDetect] Total removals found: ${removals.length}`);
  return removals;
}
