import React, { useState } from 'react';
import { Key, ExternalLink, HelpCircle } from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
  initialKey?: string;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialKey = ''
}) => {
  const [key, setKey] = useState(initialKey);
  const [showTooltip, setShowTooltip] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      onSave(key.trim());
      onClose();
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrapper">
            <Key className="modal-title-icon" size={20} />
            <h3 className="modal-title">Configure AI Inconsistency Removal</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <p className="modal-description">
            Enhance your recording by automatically removing spoken stumbles, false starts, and duplicates using the Gemini 2.5 Flash API directly from your browser.
          </p>

          <div className="modal-example-box">
            <span className="example-badge">Example of what is removed:</span>
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
          </div>

          <div className="api-key-info-box">
            <div className="info-badge">100% Free & Secure</div>
            <p>
              Your key is saved <strong>locally in your browser</strong>. It is never uploaded to our servers.
            </p>
            <a 
              href="https://aistudio.google.com/" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="api-studio-link"
            >
              Get a Free API Key from Google AI Studio
              <ExternalLink size={14} style={{ marginLeft: 4 }} />
            </a>
          </div>

          <div className="input-group">
            <label htmlFor="apiKey" className="input-label">
              Gemini API Key
              <button 
                type="button" 
                className="help-icon-btn" 
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                onClick={() => setShowTooltip(!showTooltip)}
              >
                <HelpCircle size={14} />
              </button>
            </label>
            
            {showTooltip && (
              <div className="tooltip-box">
                A string starting with 'AIzaSy' obtainable for free from Google AI Studio.
              </div>
            )}

            <input
              type="password"
              id="apiKey"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="AIzaSy..."
              className="api-key-input"
              required
              autoFocus
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Proceed
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
