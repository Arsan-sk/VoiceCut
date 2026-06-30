import React from 'react';

interface ProcessingViewProps {
  currentStage: string;
  isAiProcessing?: boolean;
  stepIndex: number;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({ 
  currentStage, 
  isAiProcessing = false,
  stepIndex
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

  const getStageStatus = (stageIdx: number) => {
    if (stageIdx < stepIndex) return 'completed';
    if (stageIdx === stepIndex) return 'active';
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
          const status = getStageStatus(idx + 1); // 1-based index
          return (
            <div key={stage.key} className={`processing-step-item ${status}`}>
              <div className="step-number-circle">
                {status === 'completed' ? (
                  <svg className="step-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  idx + 1
                )}
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
