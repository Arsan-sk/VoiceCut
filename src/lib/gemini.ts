import { audioBufferToMp3 } from './audioProcessor';

export interface GeminiRemoval {
  start: number;
  end: number;
  text: string;
  reason: 'false start' | 'repetition' | 'inconsistency';
}

interface GeminiResponse {
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
      // Get only the base64 part after "data:*/*;base64,"
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Sends the silence-reduced audio to Gemini 2.5 Flash API to detect speech inconsistencies,
 * repetitions, and false starts. Returns the list of segments to remove.
 */
export async function detectInconsistencies(
  audioBuffer: AudioBuffer,
  apiKey: string,
  onProgress?: (stage: string) => void
): Promise<GeminiRemoval[]> {
  onProgress?.('Compressing audio for AI analysis...');
  
  // Encode to 48kbps MP3 to minimize payload size and upload time
  const lowBitrateBlob = audioBufferToMp3(audioBuffer, 48);
  
  onProgress?.('Converting audio to transmission format...');
  const base64Audio = await blobToBase64(lowBitrateBlob);
  
  onProgress?.('Sending to Gemini AI for analysis (this may take 10-20 seconds)...');
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const prompt = `Analyze this voice recording. Identify all speech inconsistencies, false starts (where the speaker stumbles and restarts a phrase), filler words, and duplicate/repeated attempts of sentences. For each occurrence that represents a mistake or repetition that should be removed to make the audio flow cleanly, identify the start and end timestamp in seconds. Return the result strictly in the following JSON format:
{
  "removals": [
    {
      "start": 12.3,
      "end": 15.6,
      "text": "the repeated or inconsistent words to remove",
      "reason": "false start" | "repetition" | "inconsistency"
    }
  ]
}
Do not return any other text, comments, or markdown wrappers. Output only valid JSON matching the schema.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
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
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || response.statusText || 'Unknown error';
    throw new Error(`Gemini API Error: ${errorMessage}`);
  }

  const resultJson = await response.json();
  const textResponse = resultJson.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!textResponse) {
    throw new Error('No content returned from Gemini API. Please check the file length and quality.');
  }

  try {
    const parsed: GeminiResponse = JSON.parse(textResponse.trim());
    
    // Validate schema
    if (!parsed.removals || !Array.isArray(parsed.removals)) {
      return [];
    }

    // Clean up and validate timestamps
    const duration = audioBuffer.duration;
    return parsed.removals
      .map(r => ({
        start: Math.max(0, Number(r.start)),
        end: Math.min(duration, Number(r.end)),
        text: String(r.text || ''),
        reason: r.reason || 'inconsistency'
      }))
      .filter(r => r.end > r.start); // Ensure valid range
  } catch (e) {
    console.error('Failed to parse Gemini JSON response:', textResponse, e);
    throw new Error('Failed to parse the AI analysis output. Please try again.');
  }
}
