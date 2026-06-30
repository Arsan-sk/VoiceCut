import React, { useState } from 'react';
import { 
  Download, 
  Sparkles, 
  RefreshCw, 
  ChevronDown,
  ChevronUp,
  FileCheck
} from 'lucide-react';
import { formatDuration } from '../lib/format';
import type { GeminiRemoval } from '../lib/gemini';

interface ResultViewProps {
  fileName: string;
  originalDuration: number;
  
  // Silence-reduced results
  silenceReducedUrl: string;
  silenceReducedDuration: number;
  silenceReducedWavBlob: Blob | null;
  silenceReducedMp3Blob: Blob | null;

  // AI-cleaned results (optional/nullable if not run yet)
  aiCleanedUrl: string | null;
  aiCleanedDuration: number | null;
  aiCleanedWavBlob: Blob | null;
  aiCleanedMp3Blob: Blob | null;
  aiRemovals: GeminiRemoval[] | null;

  // Key operations
  apiKey: string;
  onOpenApiKeyModal: () => void;
  onClearApiKey: () => void;
  onTriggerAiCleanup: () => void;
  onReset: () => void;
}

export const ResultView: React.FC<ResultViewProps> = ({
  fileName,
  originalDuration,
  silenceReducedUrl,
  silenceReducedDuration,
  silenceReducedWavBlob,
  silenceReducedMp3Blob,
  aiCleanedUrl,
  aiCleanedDuration,
  aiCleanedWavBlob,
  aiCleanedMp3Blob,
  aiRemovals,
  apiKey,
  onOpenApiKeyModal,
  onClearApiKey,
  onTriggerAiCleanup,
  onReset
}) => {
  const [showRemovalsList, setShowRemovalsList] = useState(true);

  // Helper to trigger browser downloads
  const downloadFile = (blob: Blob | null, suffix: string, ext: string) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    // Construct cleaned file name
    const baseName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    link.href = url;
    link.download = `${baseName}_${suffix}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up URL object after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const isAiDone = !!aiCleanedUrl;
  const activeDuration = isAiDone ? (aiCleanedDuration || 0) : silenceReducedDuration;
  const timeSaved = Math.max(0, originalDuration - activeDuration);
  const percentSaved = Math.round((timeSaved / originalDuration) * 100) || 0;

  return (
    <div className="result-view-container">
      {/* 1. Comparison & Analytics Card */}
      <div className="analytics-card">
        <h3 className="card-title-main">
          <FileCheck size={20} className="card-title-icon-check" />
          Processing Completed
        </h3>
        
        <div className="stats-grid">
          <div className="stat-box">
            <span className="stat-label">Original Duration</span>
            <span className="stat-value">{formatDuration(originalDuration)}</span>
          </div>
          <div className="stat-box accent-box">
            <span className="stat-label">Cleaned Duration</span>
            <span className="stat-value">{formatDuration(activeDuration)}</span>
          </div>
          <div className="stat-box highlight-box">
            <span className="stat-label">Time Saved</span>
            <span className="stat-value">
              {formatDuration(timeSaved)} <span className="stat-percentage">({percentSaved}%)</span>
            </span>
          </div>
        </div>

        {/* Visual Bar Comparison */}
        <div className="duration-bar-comparison">
          <div className="comparison-bar-bg">
            <div 
              className="comparison-bar-fill fill-original" 
              style={{ width: '100%' }}
            >
              <span className="bar-text">Original: {formatDuration(originalDuration)}</span>
            </div>
            <div 
              className="comparison-bar-fill fill-cleaned" 
              style={{ width: `${(activeDuration / originalDuration) * 100}%` }}
            >
              <span className="bar-text">Cleaned: {formatDuration(activeDuration)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Download and Player Section */}
      <div className="player-card">
        <h3 className="section-title">
          {isAiDone ? 'Listen to AI Smart-Cleaned Audio' : 'Listen to Silence-Reduced Audio'}
        </h3>
        
        <div className="audio-player-wrapper">
          <audio 
            key={isAiDone ? aiCleanedUrl : silenceReducedUrl} 
            controls 
            className="custom-audio-player"
          >
            <source src={isAiDone ? aiCleanedUrl! : silenceReducedUrl} type="audio/mp3" />
            Your browser does not support the audio element.
          </audio>
        </div>

        <div className="download-options">
          <button 
            className="btn btn-primary btn-icon btn-large"
            onClick={() => downloadFile(
              isAiDone ? aiCleanedMp3Blob : silenceReducedMp3Blob, 
              isAiDone ? 'cleaned_ai' : 'silence_reduced', 
              'mp3'
            )}
          >
            <Download size={16} />
            Download MP3
          </button>
          <button 
            className="btn btn-secondary btn-icon btn-large"
            onClick={() => downloadFile(
              isAiDone ? aiCleanedWavBlob : silenceReducedWavBlob, 
              isAiDone ? 'cleaned_ai' : 'silence_reduced', 
              'wav'
            )}
          >
            <Download size={16} />
            Download WAV
          </button>
        </div>
        
        {!isAiDone && (
          <div className="ai-trigger-container">
            <button 
              className="btn btn-upgrade btn-large btn-icon btn-full-width"
              onClick={apiKey ? () => onTriggerAiCleanup() : onOpenApiKeyModal}
            >
              <Sparkles size={16} />
              Remove Inconsistencies & False Starts
            </button>
            {apiKey && (
              <div className="api-key-status-inline">
                <span className="key-configured-label">✓ API Key Configured</span>
                <button className="change-key-btn" onClick={onOpenApiKeyModal}>
                  Change Key
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. AI Removed Items Panel (Only show if AI cleanup was executed) */}
      {isAiDone && aiRemovals && (() => {
        const silenceCuts = aiRemovals.filter(r => r.reason === 'silence');
        const repetitionCuts = aiRemovals.filter(r => r.reason === 'repetition' || r.reason === 'repetition-partial');
        const silenceTotalTime = silenceCuts.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0);
        const repTotalTime = repetitionCuts.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0);

        return (
          <div className="removals-list-card">
            <button 
              className="removals-header-toggle"
              onClick={() => setShowRemovalsList(!showRemovalsList)}
            >
              <div className="removals-title-wrapper">
                <Sparkles size={16} className="removals-sparkle-icon" />
                <span>AI Smart-Cleanup Review</span>
              </div>
              {showRemovalsList ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {showRemovalsList && (
              <div className="removals-body">
                {/* Summary Line */}
                <div className="removals-summary-line">
                  <span>Removed <strong>{silenceCuts.length}</strong> silence gaps ({formatDuration(silenceTotalTime)})</span>
                  {repetitionCuts.length > 0 && (
                    <span> + <strong>{repetitionCuts.length}</strong> repeated phrases ({formatDuration(repTotalTime)})</span>
                  )}
                </div>

                {/* Repetition rows only */}
                {repetitionCuts.length > 0 ? (
                  <div className="removals-table-wrapper">
                    <table className="removals-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Type</th>
                          <th>Removed Text</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repetitionCuts.map((removal, idx) => (
                          <tr key={idx}>
                            <td className="removal-time">
                              {formatDuration(removal.start)} – {formatDuration(removal.end)}
                            </td>
                            <td className="removal-badge-cell">
                              <span className={`removal-badge type-${removal.reason}`}>
                                {removal.reason === 'repetition' ? 'exact repeat' : 'similar phrase'}
                              </span>
                            </td>
                            <td className="removal-text">"{removal.text}"</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-removals">
                    No repeated phrases or false starts were detected. Only silence gaps were removed.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* API Key management at bottom if AI has already run */}
      {isAiDone && (
        <div className="api-key-footer">
          {apiKey ? (
            <span className="api-key-stored-hint">
              Gemini API Key active. <button onClick={onOpenApiKeyModal} className="text-btn">Change key</button> or <button onClick={onClearApiKey} className="text-btn text-danger">clear key</button>.
            </span>
          ) : (
            <button onClick={onOpenApiKeyModal} className="text-btn">
              Configure Gemini API Key
            </button>
          )}
        </div>
      )}

      <div className="result-actions-footer">
        <button className="btn btn-secondary btn-icon" onClick={onReset}>
          <RefreshCw size={14} />
          Process Another File
        </button>
      </div>
    </div>
  );
};
