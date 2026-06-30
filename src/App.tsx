import { useState } from 'react';
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
import { getWordLevelTranscript, detectRepetitions, alignRemovalToWords } from './lib/gemini';
import type { GeminiRemoval } from './lib/gemini';

function AppContent() {
  const { toast } = useToast();
  
  // App states
  const [file, setFile] = useState<File | null>(null);
  const [originalDuration, setOriginalDuration] = useState<number>(0);
  const [status, setStatus] = useState<'idle' | 'summary' | 'processing' | 'result'>('idle');
  const [processingStage, setProcessingStage] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [processingStepIndex, setProcessingStepIndex] = useState<number>(1);
  
  // API Key state
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('gemini_api_key') || '';
    } catch {
      return '';
    }
  });
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

  // AI-cleaned results
  const [aiCleanedUrl, setAiCleanedUrl] = useState<string | null>(null);
  const [aiCleanedWavBlob, setAiCleanedWavBlob] = useState<Blob | null>(null);
  const [aiCleanedMp3Blob, setAiCleanedMp3Blob] = useState<Blob | null>(null);
  const [aiCleanedDuration, setAiCleanedDuration] = useState<number | null>(null);
  const [aiRemovals, setAiRemovals] = useState<GeminiRemoval[] | null>(null);

  const handleFileSelected = (selectedFile: File) => {
    setFile(selectedFile);
    setStatus('summary');
  };

  const handleStartSilenceReduction = async () => {
    if (!file) return;

    setStatus('processing');
    setIsAiProcessing(false);
    setProcessingStepIndex(1);
    
    try {
      setProcessingStage('Decoding audio file data (extracting track)...');
      const rawBuffer = await decodeAudioFile(file);
      setRawAudioBuffer(rawBuffer);
      setOriginalDuration(rawBuffer.duration);

      setProcessingStepIndex(2);
      setProcessingStage('Analyzing waveform and detecting silence thresholds...');
      const { segments, silenceSegments } = detectSilence(rawBuffer);
      
      setSilenceRemovals(silenceSegments);
      console.log(`[Pipeline] Silence detection: ${silenceSegments.length} segments detected, keep segments count: ${segments.length}`);
      
      setProcessingStepIndex(3);
      setProcessingStage('Stitching speech segments together (applying crossfades)...');
      const processedBuffer = await cutAudio(rawBuffer, segments);
      setSilenceReducedBuffer(processedBuffer);
      setSilenceReducedDuration(processedBuffer.duration);

      setProcessingStepIndex(4);
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

  const handleTriggerAiCleanup = async (overrideApiKey?: string | React.MouseEvent) => {
    if (!silenceReducedBuffer || !rawAudioBuffer) return;
    const activeKey = (typeof overrideApiKey === 'string' && overrideApiKey)
      ? overrideApiKey
      : (apiKey || localStorage.getItem('gemini_api_key') || '');
    console.log('[Pipeline] handleTriggerAiCleanup API Key:', activeKey ? 'PRESENT (starts with ' + activeKey.substring(0, 6) + ')' : 'MISSING');
    if (!activeKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

    setStatus('processing');
    setIsAiProcessing(true);
    setProcessingStepIndex(1);

    try {
      setProcessingStage('Compressing audio for transmission...');
      
      setProcessingStepIndex(2);
      setProcessingStage('Starting Gemini AI transcription...');
      
      // Analyze silence-removed audio to get verbatim words and inconsistency/repetition removals
      const { words, removals: geminiRemovals } = await getWordLevelTranscript(
        silenceReducedBuffer,
        activeKey,
        (stage) => setProcessingStage(stage)
      );

      console.log(`[Pipeline] Transcript received: ${words.length} words. Gemini removals: ${geminiRemovals.length}`, geminiRemovals.slice(0, 10));

      setProcessingStepIndex(3);
      setProcessingStage('Running repetition detection...');

      // 1. Perform local word-level repetition/stumble/filler detection
      const localRemovals = detectRepetitions(words);
      console.log(`[Pipeline] Local repetitions/fillers detected: ${localRemovals.length}`, localRemovals);

      // 2. Align Gemini removals to precise word boundaries using the transcript
      const alignedGeminiRemovals = geminiRemovals.map(rem => alignRemovalToWords(rem, words));
      console.log(`[Pipeline] Aligned Gemini removals: ${alignedGeminiRemovals.length}`, alignedGeminiRemovals);

      // 3. Combine both lists of removals
      const combinedCuts = [...alignedGeminiRemovals, ...localRemovals];

      setProcessingStage('Applying cuts (sequential pass)...');

      // Sort and merge removals relative to silence-removed timeline
      const sortedRemovals = [...combinedCuts].sort((a, b) => a.start - b.start);
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

      // Invert merged removals to find the regions to KEEP from the silence-removed buffer
      const keepSegments: { start: number; end: number }[] = [];
      let current = 0;
      for (const rem of mergedRemovals) {
        if (rem.start > current + 0.01) { // 10ms minimum keep length
          keepSegments.push({ start: current, end: rem.start });
        }
        current = Math.max(current, rem.end);
      }
      if (current < silenceReducedBuffer.duration - 0.01) {
        keepSegments.push({ start: current, end: silenceReducedBuffer.duration });
      }

      console.log(`[Pipeline] Keep segments: ${keepSegments.length}, merged removals: ${mergedRemovals.length}`);

      // 4. Apply cuts directly to the silence-removed buffer
      let cleanedBuffer: AudioBuffer;
      if (keepSegments.length === 0) {
        cleanedBuffer = silenceReducedBuffer;
      } else {
        cleanedBuffer = await cutAudio(silenceReducedBuffer, keepSegments);
      }

      setProcessingStepIndex(4);
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
      const combinedRemovalsForPanel: GeminiRemoval[] = [
        ...silenceRemovals.map(r => ({
          start: r.start,
          end: r.end,
          text: 'Silent pause / dead air',
          reason: 'silence' as const
        })),
        ...alignedGeminiRemovals,
        ...localRemovals
      ];
      console.log(`[Pipeline] Combined panel removals: ${combinedRemovalsForPanel.length} (${silenceRemovals.length} silence + ${alignedGeminiRemovals.length} Gemini + ${localRemovals.length} local)`);
      setAiRemovals(combinedRemovalsForPanel);

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
    handleTriggerAiCleanup(key);
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
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="logo-icon-svg">
              <circle cx="16" cy="16" r="16" fill="#E6553A" />
              <path d="M16 8V24M11 12V20M21 12V20M7 14V18M25 14V18" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            VoiceCut
          </a>
        </div>
        <div className="private-badge-text">
          100% private · in-browser
        </div>
      </header>

      {/* Main Core View Area */}
      <main className="main-card">
        {status === 'idle' && (
          <>
            <div className="hero">
              <span className="hero-badge">Free · No sign-up</span>
              <h1 className="hero-title mt-5 font-display text-5xl sm:text-6xl tracking-tight text-ink">
                Cut the pauses.
                <br />
                <span className="text-brand">Keep the message.</span>
              </h1>
              <p className="hero-subtitle mx-auto mt-5 max-w-xl text-base sm:text-lg text-ink-muted">
                VoiceCut automatically removes silent gaps, dead air, and breaths from your recordings. Upload, clean, download — all in your browser.
              </p>
            </div>
            
            <Dropzone onFileSelected={handleFileSelected} />

            <div className="landing-steps-grid">
              <div className="landing-step-item">
                <div className="landing-step-number">1</div>
                <h3 className="landing-step-title">Upload</h3>
                <p className="landing-step-desc">Drag in an MP3, WAV, M4A, or MP4.</p>
              </div>
              <div className="landing-step-item">
                <div className="landing-step-number">2</div>
                <h3 className="landing-step-title">Clean</h3>
                <p className="landing-step-desc">VoiceCut trims silences, dead air, and breaths.</p>
              </div>
              <div className="landing-step-item">
                <div className="landing-step-number">3</div>
                <h3 className="landing-step-title">Download</h3>
                <p className="landing-step-desc">Grab the cleaned file as MP3 or WAV.</p>
              </div>
            </div>
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
            stepIndex={processingStepIndex}
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
