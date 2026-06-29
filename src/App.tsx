import { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ToastProvider, useToast } from './components/Toast';
import { Dropzone } from './components/Dropzone';
import { FileSummary } from './components/FileSummary';
import { ProcessingView } from './components/ProcessingView';
import { ResultView } from './components/ResultView';
import { ApiKeyModal } from './components/ApiKeyModal';

import {
  decodeAudioFile,
  detectSilence,
  cutAudio,
  audioBufferToMp3,
  audioBufferToWav
} from './lib/audioProcessor';
import { getWordLevelTranscript, detectRepetitions } from './lib/gemini';
import type { GeminiRemoval } from './lib/gemini';

function AppContent() {
  const { toast } = useToast();
  
  // App states
  const [file, setFile] = useState<File | null>(null);
  const [originalDuration, setOriginalDuration] = useState<number>(0);
  const [status, setStatus] = useState<'idle' | 'summary' | 'processing' | 'result'>('idle');
  const [processingStage, setProcessingStage] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  
  // API Key state
  const [apiKey, setApiKey] = useState<string>('');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);

  // Raw audio buffer for Stage 2 cuts
  const [rawAudioBuffer, setRawAudioBuffer] = useState<AudioBuffer | null>(null);

  // Silence-reduced results
  const [silenceReducedBuffer, setSilenceReducedBuffer] = useState<AudioBuffer | null>(null);
  const [silenceReducedUrl, setSilenceReducedUrl] = useState<string>('');
  const [silenceReducedWavBlob, setSilenceReducedWavBlob] = useState<Blob | null>(null);
  const [silenceReducedMp3Blob, setSilenceReducedMp3Blob] = useState<Blob | null>(null);
  const [silenceReducedDuration, setSilenceReducedDuration] = useState<number>(0);
  
  // Tracked cut segments for mapping and final stitching
  const [silenceRemovals, setSilenceRemovals] = useState<{ start: number; end: number }[]>([]);
  const [keepSegmentsState, setKeepSegmentsState] = useState<{ start: number; end: number }[]>([]);

  // AI-cleaned results
  const [aiCleanedUrl, setAiCleanedUrl] = useState<string | null>(null);
  const [aiCleanedWavBlob, setAiCleanedWavBlob] = useState<Blob | null>(null);
  const [aiCleanedMp3Blob, setAiCleanedMp3Blob] = useState<Blob | null>(null);
  const [aiCleanedDuration, setAiCleanedDuration] = useState<number | null>(null);
  const [aiRemovals, setAiRemovals] = useState<GeminiRemoval[] | null>(null);

  // Load API Key on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
    }
  }, []);

  const handleFileSelected = (selectedFile: File) => {
    setFile(selectedFile);
    setStatus('summary');
  };

  const handleStartSilenceReduction = async () => {
    if (!file) return;

    setStatus('processing');
    setIsAiProcessing(false);
    
    try {
      setProcessingStage('Decoding audio file data (extracting track)...');
      const rawBuffer = await decodeAudioFile(file);
      setRawAudioBuffer(rawBuffer);
      setOriginalDuration(rawBuffer.duration);

      setProcessingStage('Analyzing waveform and detecting silence thresholds...');
      const { segments, silenceSegments } = detectSilence(rawBuffer);
      
      setSilenceRemovals(silenceSegments);
      setKeepSegmentsState(segments);
      
      setProcessingStage('Stitching speech segments together (applying crossfades)...');
      const processedBuffer = await cutAudio(rawBuffer, segments);
      setSilenceReducedBuffer(processedBuffer);
      setSilenceReducedDuration(processedBuffer.duration);

      setProcessingStage('Encoding processed audio to high-quality MP3...');
      const mp3Blob = audioBufferToMp3(processedBuffer, 192);
      const mp3Url = URL.createObjectURL(mp3Blob);
      setSilenceReducedMp3Blob(mp3Blob);
      setSilenceReducedUrl(mp3Url);

      setProcessingStage('Encoding processed audio to lossless WAV...');
      const wavBlob = audioBufferToWav(processedBuffer);
      setSilenceReducedWavBlob(wavBlob);

      toast('Silence and dead-air successfully removed!', 'success');
      setStatus('result');
    } catch (error: any) {
      console.error(error);
      toast(error?.message || 'Failed to process audio. Please try another file.', 'error');
      handleReset();
    }
  };

  const handleTriggerAiCleanup = async () => {
    if (!silenceReducedBuffer || !rawAudioBuffer) return;
    if (!apiKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

    setStatus('processing');
    setIsAiProcessing(true);

    try {
      setProcessingStage('Starting Gemini AI transcription...');
      
      // 1. Transcribe the silence-reduced audio to get word-level timestamps
      const words = await getWordLevelTranscript(
        silenceReducedBuffer,
        apiKey,
        (stage) => setProcessingStage(stage)
      );

      setProcessingStage('Mapping AI timestamps to original timeline...');

      // Helper to map silence-reduced timeline back to the original timeline
      const mapReducedTimeToOriginal = (t: number) => {
        const crossfade = 0.01;
        let accumulated = 0;
        for (let idx = 0; idx < keepSegmentsState.length; idx++) {
          const seg = keepSegmentsState[idx];
          const reducedStart = idx === 0 ? 0 : accumulated - crossfade;
          const duration = seg.end - seg.start;
          accumulated = reducedStart + duration;

          if (t >= reducedStart && t <= accumulated) {
            return seg.start + (t - reducedStart);
          }
        }
        return t;
      };

      // Map words back to original timeline
      const absoluteWords = words.map(w => ({
        word: w.word,
        startTime: mapReducedTimeToOriginal(w.startTime),
        endTime: mapReducedTimeToOriginal(w.endTime),
      }));

      // 2. Perform local word-level repetition detection
      const repetitionRemovals = detectRepetitions(absoluteWords);

      setProcessingStage('Combining silence and repetition cuts...');

      // Combine silence removals and repetition removals relative to original timeline
      const combinedRemovals = [
        ...silenceRemovals.map(r => ({
          start: r.start,
          end: r.end,
          text: 'Silent pause / dead air',
          reason: 'silence' as const
        })),
        ...repetitionRemovals
      ];

      // Sort and merge removals to handle overlaps
      const sortedRemovals = [...combinedRemovals].sort((a, b) => a.start - b.start);
      const mergedRemovals: { start: number; end: number }[] = [];
      if (sortedRemovals.length > 0) {
        let current = { start: sortedRemovals[0].start, end: sortedRemovals[0].end };
        for (let idx = 1; idx < sortedRemovals.length; idx++) {
          const next = sortedRemovals[idx];
          if (next.start <= current.end) {
            current.end = Math.max(current.end, next.end);
          } else {
            mergedRemovals.push(current);
            current = { start: next.start, end: next.end };
          }
        }
        mergedRemovals.push(current);
      }

      // Invert merged removals to find the regions to KEEP from the original raw buffer
      const keepSegments: { start: number; end: number }[] = [];
      let current = 0;
      for (const rem of mergedRemovals) {
        if (rem.start > current + 0.01) { // 10ms minimum speech segment
          keepSegments.push({ start: current, end: rem.start });
        }
        current = Math.max(current, rem.end);
      }
      if (current < rawAudioBuffer.duration - 0.01) {
        keepSegments.push({ start: current, end: rawAudioBuffer.duration });
      }

      setProcessingStage('Applying final cuts and stitching audio (single pass)...');

      // 3. Perform a SINGLE cut pass on the rawAudioBuffer
      let cleanedBuffer: AudioBuffer;
      if (keepSegments.length === 0) {
        // Fallback to avoid empty output
        cleanedBuffer = rawAudioBuffer;
      } else {
        cleanedBuffer = await cutAudio(rawAudioBuffer, keepSegments);
      }

      setProcessingStage('Encoding final Smart-Cleaned audio to MP3...');
      const mp3Blob = audioBufferToMp3(cleanedBuffer, 192);
      const mp3Url = URL.createObjectURL(mp3Blob);
      setAiCleanedMp3Blob(mp3Blob);
      setAiCleanedUrl(mp3Url);

      setProcessingStage('Encoding final Smart-Cleaned audio to WAV...');
      const wavBlob = audioBufferToWav(cleanedBuffer);
      setAiCleanedWavBlob(wavBlob);

      setAiCleanedDuration(cleanedBuffer.duration);
      
      // Store all combined removals so they show up in the results collapsible panel
      setAiRemovals(combinedRemovals);

      toast('Silence and repetitions successfully cleaned!', 'success');
      setStatus('result');
    } catch (error: any) {
      console.error(error);
      toast(error?.message || 'Failed to analyze audio with AI. Keeping silence-reduced version.', 'error');
      setStatus('result');
    }
  };

  const handleSaveApiKey = (key: string) => {
    localStorage.setItem('gemini_api_key', key);
    setApiKey(key);
    toast('API Key saved successfully!', 'success');
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    toast('API Key removed.', 'info');
  };

  const handleReset = () => {
    // Revoke object URLs to prevent memory leaks
    if (silenceReducedUrl) URL.revokeObjectURL(silenceReducedUrl);
    if (aiCleanedUrl) URL.revokeObjectURL(aiCleanedUrl);

    setFile(null);
    setOriginalDuration(0);
    setStatus('idle');
    setRawAudioBuffer(null);
    setSilenceReducedBuffer(null);
    setSilenceReducedUrl('');
    setSilenceReducedWavBlob(null);
    setSilenceReducedMp3Blob(null);
    setSilenceReducedDuration(0);
    setSilenceRemovals([]);
    setKeepSegmentsState([]);
    
    setAiCleanedUrl(null);
    setAiCleanedWavBlob(null);
    setAiCleanedMp3Blob(null);
    setAiCleanedDuration(null);
    setAiRemovals(null);
  };

  return (
    <div className="app-container">
      {/* Navbar */}
      <header className="header">
        <div className="logo-wrapper">
          <a href="#" className="logo-text" onClick={(e) => { e.preventDefault(); handleReset(); }}>
            Voice<span>Cut</span>
          </a>
        </div>
        <div className="private-badge">
          <ShieldCheck size={14} />
          100% Private
        </div>
      </header>

      {/* Main Core View Area */}
      <main className="main-card">
        {status === 'idle' && (
          <>
            <div className="hero">
              <span className="hero-badge">Free · No sign-up</span>
              <h1 className="hero-title">
                Cut the pauses. <span>Keep the message.</span>
              </h1>
              <p className="hero-subtitle">
                VoiceCut automatically removes silent gaps, dead air, and breaths from your voice recordings.
              </p>
            </div>
            
            <Dropzone onFileSelected={handleFileSelected} />
          </>
        )}

        {status === 'summary' && file && (
          <FileSummary 
            file={file} 
            onProcess={handleStartSilenceReduction} 
            onCancel={handleReset} 
          />
        )}

        {status === 'processing' && (
          <ProcessingView 
            currentStage={processingStage} 
            isAiProcessing={isAiProcessing} 
          />
        )}

        {status === 'result' && (
          <ResultView
            fileName={file?.name || 'audio.mp3'}
            originalDuration={originalDuration}
            silenceReducedUrl={silenceReducedUrl}
            silenceReducedDuration={silenceReducedDuration}
            silenceReducedWavBlob={silenceReducedWavBlob}
            silenceReducedMp3Blob={silenceReducedMp3Blob}
            aiCleanedUrl={aiCleanedUrl}
            aiCleanedDuration={aiCleanedDuration}
            aiCleanedWavBlob={aiCleanedWavBlob}
            aiCleanedMp3Blob={aiCleanedMp3Blob}
            aiRemovals={aiRemovals}
            apiKey={apiKey}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            onClearApiKey={handleClearApiKey}
            onTriggerAiCleanup={handleTriggerAiCleanup}
            onReset={handleReset}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>VoiceCut — Professional in-browser audio editing utility. Made with 🧡 for creators.</p>
      </footer>

      {/* API Key configuration Modal */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={handleSaveApiKey}
        initialKey={apiKey}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
