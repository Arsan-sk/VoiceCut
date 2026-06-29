import React from 'react';
import { FileAudio, Play, X } from 'lucide-react';
import { formatBytes } from '../lib/format';

interface FileSummaryProps {
  file: File;
  onProcess: () => void;
  onCancel: () => void;
}

export const FileSummary: React.FC<FileSummaryProps> = ({ file, onProcess, onCancel }) => {
  const getFileExtension = (name: string) => {
    return name.slice(((name.lastIndexOf(".") - 1) >>> 0) + 2).toUpperCase();
  };

  return (
    <div className="file-summary-card">
      <div className="file-summary-header">
        <div className="file-icon-wrapper">
          <FileAudio className="file-icon" size={28} />
        </div>
        <div className="file-info-text">
          <h3 className="file-name" title={file.name}>
            {file.name}
          </h3>
          <p className="file-meta">
            {getFileExtension(file.name)} · {formatBytes(file.size)}
          </p>
        </div>
        <button className="summary-cancel-btn" onClick={onCancel} title="Remove file">
          <X size={18} />
        </button>
      </div>

      <div className="pipeline-preview-box">
        <h4 className="preview-box-title">Silence & Pause Reduction (Stage 1)</h4>
        <ul className="preview-steps">
          <li>✓ Identifies speech segments in your recording</li>
          <li>✓ Automatically clips long silences and "dead air" gaps</li>
          <li>✓ Fades audio boundaries to eliminate popping sounds</li>
          <li>✓ Client-side processing: 100% private, files stay in your browser</li>
        </ul>
      </div>

      <div className="file-summary-actions">
        <button className="btn btn-secondary" onClick={onCancel}>
          Choose Another File
        </button>
        <button className="btn btn-primary btn-icon" onClick={onProcess}>
          <Play size={16} />
          Clean Silence & Pauses
        </button>
      </div>
    </div>
  );
};
