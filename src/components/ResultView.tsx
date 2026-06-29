import React, { useState } from 'react';
import { 
  Download, 
  Sparkles, 
  RefreshCw, 
  CheckCircle,
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
      </div>

      {/* 3. Smart AI Inconsistency Removal (Only show if not already run) */}
      {!isAiDone && (
        <div className="ai-upgrade-card">
          <div className="ai-upgrade-header">
            <Sparkles className="sparkles-icon" size={24} />
            <div>
              <h3 className="ai-card-title">Smart AI Inconsistency Removal</h3>
              <p className="ai-card-subtitle">Take your audio to the next level by cutting spoken mistakes</p>
            </div>
          </div>

          <div className="ai-example-box">
            <span className="example-badge">Example of what we remove:</span>
            <div className="example-comparison">
              <div className="example-before">
                <span className="label-red">Before:</span>
                <span className="speech-text">
                  "We went to the... <span className="highlight-cut">we decided to go</span> to the park because, <span className="highlight-cut">you know, because</span> it was sunny."
                </span>
              </div>
              <div className="example-after">
                <span className="label-green">After:</span>
                <span className="speech-text">"We decided to go to the park because it was sunny."</span>
              </div>
            </div>
            <p className="example-explanation">
              Using the Gemini 2.5 Flash API, VoiceCut detects <strong>false starts</strong>, <strong>repeated words</strong>, and <strong>incoherent speech stumbles</strong> to create a smooth, studio-like narration.
            </p>
          </div>

          <div className="ai-action-area">
            {apiKey ? (
              <div className="api-key-status">
                <div className="key-active-badge">
                  <CheckCircle size={14} className="badge-icon-check" />
                  API Key Configured
                </div>
                <button className="change-key-btn" onClick={onOpenApiKeyModal}>
                  Change API Key
                </button>
              </div>
            ) : (
              <p className="api-key-cta-text">
                Uses your free Gemini API Key. No signup required.
              </p>
            )}

            <button 
              className="btn btn-upgrade btn-large btn-icon"
              onClick={apiKey ? onTriggerAiCleanup : onOpenApiKeyModal}
            >
              <Sparkles size={16} />
              Remove Inconsistencies & False Starts
            </button>
          </div>
        </div>
      )}

      {/* 4. AI Removed Items Panel (Only show if AI cleanup was executed) */}
      {isAiDone && aiRemovals && (
        <div className="removals-list-card">
          <button 
            className="removals-header-toggle"
            onClick={() => setShowRemovalsList(!showRemovalsList)}
          >
            <div className="removals-title-wrapper">
              <Sparkles size={16} className="removals-sparkle-icon" />
              <span>AI Smart-Cleanup Review ({aiRemovals.length} cuts made)</span>
            </div>
            {showRemovalsList ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {showRemovalsList && (
            <div className="removals-body">
              {aiRemovals.length === 0 ? (
                <div className="empty-removals">
                  No speech inconsistencies or repetitions were found in this audio file. Your recording was already clean!
                </div>
              ) : (
                <div className="removals-table-wrapper">
                  <table className="removals-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Removed Speech Segment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiRemovals.map((removal, idx) => (
                        <tr key={idx}>
                          <td className="removal-time">
                            {formatDuration(removal.start)} – {formatDuration(removal.end)}
                          </td>
                          <td className="removal-badge-cell">
                            <span className={`removal-badge type-${removal.reason.replace(' ', '-')}`}>
                              {removal.reason}
                            </span>
                          </td>
                          <td className="removal-text">"{removal.text}"</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
