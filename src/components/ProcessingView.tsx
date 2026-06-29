import React from 'react';

interface ProcessingViewProps {
  currentStage: string;
  isAiProcessing?: boolean;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({ 
  currentStage, 
  isAiProcessing = false 
}) => {
  // Define stages based on mode
  const stages = isAiProcessing 
    ? [
        { key: 'compressing', label: 'Preparing Audio' },
        { key: 'api', label: 'AI Analysis' },
        { key: 'cutting', label: 'Cutting Inconsistencies' },
        { key: 'encoding', label: 'Saving Cleaned Audio' }
      ]
    : [
        { key: 'decoding', label: 'Decoding File' },
        { key: 'analyzing', label: 'Detecting Pauses' },
        { key: 'cutting', label: 'Stitching Audio' },
        { key: 'encoding', label: 'Encoding Output' }
      ];

  const getStageStatus = (stageKey: string) => {
    const currentLower = currentStage.toLowerCase();
    
    if (isAiProcessing) {
      if (stageKey === 'compressing') {
        if (currentLower.includes('compress') || currentLower.includes('convert')) return 'active';
        if (currentLower.includes('sending') || currentLower.includes('api') || currentLower.includes('cutt') || currentLower.includes('encod') || currentLower.includes('sav')) return 'completed';
      }
      if (stageKey === 'api') {
        if (currentLower.includes('send') || currentLower.includes('api') || currentLower.includes('analy')) return 'active';
        if (currentLower.includes('cutt') || currentLower.includes('encod') || currentLower.includes('sav')) return 'completed';
      }
      if (stageKey === 'cutting') {
        if (currentLower.includes('cutt')) return 'active';
        if (currentLower.includes('encod') || currentLower.includes('sav')) return 'completed';
      }
      if (stageKey === 'encoding') {
        if (currentLower.includes('encod') || currentLower.includes('sav') || currentLower.includes('mp3') || currentLower.includes('wav')) return 'active';
      }
    } else {
      if (stageKey === 'decoding') {
        if (currentLower.includes('decod')) return 'active';
        if (currentLower.includes('analyz') || currentLower.includes('cutt') || currentLower.includes('encod')) return 'completed';
      }
      if (stageKey === 'analyzing') {
        if (currentLower.includes('analyz') || currentLower.includes('detect')) return 'active';
        if (currentLower.includes('cutt') || currentLower.includes('encod')) return 'completed';
      }
      if (stageKey === 'cutting') {
        if (currentLower.includes('cutt') || currentLower.includes('stitch')) return 'active';
        if (currentLower.includes('encod')) return 'completed';
      }
      if (stageKey === 'encoding') {
        if (currentLower.includes('encod')) return 'active';
      }
    }
    
    return 'pending';
  };

  return (
    <div className="processing-card">
      <div className="processing-spinner-wrapper">
        <div className="processing-spinner">
          <div className="spinner-inner"></div>
        </div>
      </div>
      
      <div className="processing-status-text">
        <h3 className="processing-title">
          {isAiProcessing ? 'AI Smart Cleanup in progress...' : 'Processing your audio...'}
        </h3>
        <p className="processing-sub">{currentStage}</p>
      </div>

      <div className="processing-steps">
        {stages.map((stage, idx) => {
          const status = getStageStatus(stage.key);
          return (
            <div key={stage.key} className={`processing-step-item ${status}`}>
              <div className="step-number-circle">
                {status === 'completed' ? '✓' : idx + 1}
              </div>
              <span className="step-label">{stage.label}</span>
            </div>
          );
        })}
      </div>

      <div className="processing-privacy-note">
        All audio processing is done directly in your browser. No files leave your device.
      </div>
    </div>
  );
};
