import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useToast } from './Toast';

interface DropzoneProps {
  onFileSelected: (file: File) => void;
}

export const Dropzone: React.FC<DropzoneProps> = ({ onFileSelected }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const { toast } = useToast();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const validateAndSelectFile = (file: File | null) => {
    if (!file) return;

    // Check size (100MB soft/hard limit)
    const MAX_SIZE_MB = 100;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max size is ${MAX_SIZE_MB}MB.`, 'error');
      return;
    }

    // Check type
    const validExtensions = ['.mp3', '.wav', '.m4a', '.mp4'];
    const fileNameLower = file.name.toLowerCase();
    const isValidExtension = validExtensions.some(ext => fileNameLower.endsWith(ext));

    if (!isValidExtension) {
      toast('Unsupported file format! Please upload MP3, WAV, M4A, or MP4 files.', 'error');
      return;
    }

    onFileSelected(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSelectFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSelectFile(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div 
      className={`dropzone ${isDragActive ? 'drag-active' : ''}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      <input 
        ref={fileInputRef}
        type="file" 
        id="file-upload" 
        className="file-input" 
        accept=".mp3,.wav,.m4a,.mp4,audio/*,video/mp4"
        onChange={handleChange}
      />
      
      <div className="dropzone-content">
        <div className="upload-icon-wrapper">
          <Upload className="upload-icon" size={32} />
        </div>
        
        <h2 className="dropzone-title">
          Drop your recording here
        </h2>
        <p className="dropzone-subtitle">
          or click to choose a file from your device
        </p>
        
        <button type="button" className="btn btn-primary" onClick={onButtonClick}>
          Select File
        </button>
        
        <div className="supported-formats">
          <span>MP3 · WAV · M4A · MP4 (Audio Extract)</span>
          <span className="max-size-hint">Up to 100 MB</span>
        </div>
      </div>
    </div>
  );
};
