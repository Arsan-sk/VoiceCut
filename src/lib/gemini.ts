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
  reason: 'false start' | 'repetition' | 'inconsistency' | 'silence';
}

export interface RemovedRepetition {
  start: number;
  end: number;
  text: string;
  reason: 'repetition';
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
): Promise<WordTranscript[]> {
  onProgress?.(`AI Transcribing segment [${chunkStart.toFixed(0)}s - ${chunkEnd.toFixed(0)}s]...`);
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

  const basePrompt = `You are an expert audio transcription engine. Your task is to transcribe this audio clip and return a precise word-level transcript with timestamps in seconds.
The audio runs from ${chunkStart.toFixed(2)}s to ${chunkEnd.toFixed(2)}s relative to the original file, but this audio file represents a slice starting at 0s. Timestamps MUST be relative to this slice (starting at 0.00s).
Transcribe every word spoken. Ignore non-speech sounds, static, breaths, or silences.
Return the result strictly in the following JSON format:
{
  "words": [
    { "word": "example", "startTime": 0.45, "endTime": 0.82 }
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

  // Parse check & retry
  try {
    const parsed = JSON.parse(responseText.trim());
    if (parsed.words && Array.isArray(parsed.words)) {
      return parsed.words.map((w: any) => ({
        word: String(w.word || ''),
        startTime: Number(w.startTime || 0),
        endTime: Number(w.endTime || 0),
      }));
    }
    throw new Error("Missing 'words' list in schema");
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
      
      const parsed = JSON.parse(responseText.trim());
      if (parsed.words && Array.isArray(parsed.words)) {
        return parsed.words.map((w: any) => ({
          word: String(w.word || ''),
          startTime: Number(w.startTime || 0),
          endTime: Number(w.endTime || 0),
        }));
      }
      throw new Error("Schema validation failed on retry");
    } catch (retryErr: any) {
      throw new Error(`Gemini Transcription Failed: The AI output could not be parsed as valid word-level transcripts. details: ${retryErr?.message || 'Invalid JSON'}`);
    }
  }
}

/**
 * Transcribes the audio buffer, segmenting it into 30s overlapping chunks if necessary.
 * Recombines timestamps and filters duplicates.
 */
export async function getWordLevelTranscript(
  audioBuffer: AudioBuffer,
  apiKey: string,
  onProgress?: (stage: string) => void
): Promise<WordTranscript[]> {
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

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    onProgress?.(`AI Transcribing chunk ${idx + 1} of ${chunks.length}...`);
    
    const sliced = sliceAudioBuffer(audioBuffer, chunk.start, chunk.end);
    const chunkWords = await transcribeChunk(sliced, apiKey, chunk.start, chunk.end, onProgress);
    
    // Map timestamps back to absolute time
    const absoluteWords = chunkWords.map(w => ({
      word: w.word,
      startTime: w.startTime + chunk.start,
      endTime: w.endTime + chunk.start,
    }));

    if (idx === 0) {
      allWords.push(...absoluteWords);
    } else {
      // Merge logic with overlap split at midpoint
      const prevChunk = chunks[idx - 1];
      const midpoint = prevChunk.end - (overlap / 2);

      // Pop words from previous chunk that end after midpoint
      while (allWords.length > 0 && allWords[allWords.length - 1].endTime > midpoint) {
        allWords.pop();
      }

      // Filter and append current words that start after midpoint
      const filteredCurrent = absoluteWords.filter(w => w.startTime > midpoint);
      allWords.push(...filteredCurrent);
    }
  }

  return allWords;
}

/**
 * Searches the word-level transcript using a 5-word window to find spoken repetitions (Improvement 2).
 * Returns the list of segments to remove.
 */
export function detectRepetitions(words: WordTranscript[]): RemovedRepetition[] {
  const removals: RemovedRepetition[] = [];
  
  // Normalize strings by lowercasing and stripping punctuation
  const normalize = (w: string) => 
    w.toLowerCase()
     .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, '')
     .trim();

  let i = 0;
  while (i < words.length) {
    // Sliding buffer holds exactly the last 5 words.
    // If fewer than 5 words remain in the transcript ahead, skip repetition check.
    // Window A starts at i, window B starts at i + 5.
    // To have A and B of size 5, we need at least 10 words starting at i.
    if (i + 9 >= words.length) {
      break;
    }

    const w1 = normalize(words[i].word);
    const w2 = normalize(words[i + 5].word);

    // If first words of consecutive windows match
    if (w1 === w2 && w1.length > 0) {
      let matchCount = 0;
      for (let k = 0; k < 5; k++) {
        const wordA = normalize(words[i + k].word);
        const wordB = normalize(words[i + 5 + k].word);
        
        if (wordA === wordB && wordA.length > 0) {
          matchCount++;
        } else {
          break;
        }
      }

      // Confirmed repetition if 3 or more consecutive words match
      if (matchCount >= 3) {
        const start = words[i].startTime;
        const end = words[i + 4].endTime;
        const text = words.slice(i, i + 5).map(w => w.word).join(' ');

        removals.push({
          start,
          end,
          text,
          reason: 'repetition',
        });

        // Skip window and resume from kept segment (index i + 5)
        i = i + 5;
        continue;
      }
    }

    i++;
  }

  return removals;
}
