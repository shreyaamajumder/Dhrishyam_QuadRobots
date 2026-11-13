// src/pages/NewReviewPage.tsx
import React, { useState } from 'react';
import {
  Upload,
  FileText,
  AlertTriangle,
  Image as ImageIcon,
  CheckCircle,
  X,
  ShieldCheck,
} from 'lucide-react';
import { ImageIntakeForm } from '../components/ImageIntakeForm';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { ContentType } from '../types/domain';

const SAMPLE_DRAFT = `Announcing the Q4 Release of Acme Cloud Enterprise!

Legacy tools will catastrophically destroy your pipeline if you do not migrate immediately. With our new release, we provide 100% guaranteed uptime across 40 languages worldwide so our enterprise clients never experience a slowdown.

To explore the full benchmark report and security whitepaper, click here.`;

export const NewReviewPage: React.FC = () => {
  const { user, navigate, setDisclosureOpen, pushToast } = useApp();

  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<ContentType>('blog');
  const [tab, setTab] = useState<'paste' | 'upload'>('paste');
  const [imageMode, setImageMode] = useState(false);
  const [fontMode, setFontMode] = useState<'serif' | 'mono'>('serif');
  const [bodyText, setBodyText] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // L1 image attachment state
  const [attachment, setAttachment] = useState<{
    file_name: string;
    alt_text: string;
    preview_url?: string;
  } | null>(null);

  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
  const isTooShort = wordCount < 5;
  const isOverLimit = wordCount > 2000;

  // Language detection (heuristic for non-ascii ratio)
  const nonAsciiCount = (bodyText.replace(/[\x00-\x7F]/g, '').length || 0);
  const isNonEnglish = wordCount > 5 && nonAsciiCount / Math.max(bodyText.length, 1) > 0.25;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.txt') && !lower.endsWith('.docx')) {
      setErrorMsg('Unsupported file type. Please upload a .txt or .docx file, or paste your text directly.');
      return;
    }

    if (!title) {
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }

    if (lower.endsWith('.docx')) {
      setUploadedFile(file);
      setBodyText('');
      setErrorMsg(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setUploadedFile(null);
      setBodyText(content);
      setTab('paste');
      setErrorMsg(null);
    };
    reader.onerror = () => {
      setErrorMsg("We couldn't read this file. Please paste the text instead.");
    };
    reader.readAsText(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid PNG or JPG image asset.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image size exceeds 5MB limit. Please upload a smaller asset.');
      return;
    }

    setAttachment({
      file_name: file.name,
      alt_text: '',
      preview_url: URL.createObjectURL(file),
    });
    setErrorMsg(null);
  };

  const handleTruncateToLimit = () => {
    const words = bodyText.trim().split(/\s+/);
    setBodyText(words.slice(0, 2000).join(' '));
  };

  const hasValidDocxUpload = tab === 'upload' && uploadedFile !== null;

  const handleCreate = async (runCheckImmediately: boolean) => {
    if (!user) return;
    if (!title.trim()) {
      setErrorMsg('Please enter a document title');
      return;
    }
    if (!hasValidDocxUpload) {
      if (isTooShort) {
        setErrorMsg('Draft is too short for brand review (minimum 5 words)');
        return;
      }
      if (isOverLimit) {
        setErrorMsg('Content exceeds the 2,000 words limit. Please shorten or check the first 2,000 words.');
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const created = hasValidDocxUpload && uploadedFile
        ? await api.uploadContentFile(user, {
            file: uploadedFile,
            title: title.trim(),
            content_type: contentType,
            run_check_immediately: runCheckImmediately,
          })
        : await api.createContent(user, {
            title: title.trim(),
            content_type: contentType,
            body_text: bodyText.trim(),
            source: tab === 'upload' ? 'upload' : 'paste',
            run_check_immediately: runCheckImmediately,
            attachment: attachment
              ? {
                  id: `att_${Date.now()}`,
                  file_name: attachment.file_name,
                  mime: 'image/png',
                  size_bytes: 1024 * 200,
                  alt_text: attachment.alt_text,
                  preview_url: attachment.preview_url,
                }
              : undefined,
          });

      pushToast({
        title: runCheckImmediately ? 'Governance check completed' : 'Draft saved',
        description: `Opened "${created.title}" in workspace`,
        type: 'success',
      });

      navigate(`workspace/${created.id}`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create review intake');
      setIsSubmitting(false);
    }
  };

  if (imageMode) {
    return <ImageIntakeForm onBack={() => setImageMode(false)} />;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#282828] dark:text-white tracking-tight">
            New Manuscript Intake
          </h1>
          <p className="text-xs sm:text-sm font-serif italic text-[#7c6f64] dark:text-[#a89984] mt-1">
            Submit drafts, press announcements, or editorial copy for automated policy verification
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
        <button
          type="button"
          onClick={() => setImageMode(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-serif font-semibold text-[#af3a03] dark:text-[#fe8019] bg-[#d65d0e]/15 border border-[#d65d0e]/30 hover:bg-[#d65d0e]/25 transition-colors cursor-pointer tap-interactive shadow-xs"
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Review an Image</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setTitle('Announcing the Q4 AcmeCloud Enterprise Launch Blog');
            setContentType('blog');
            setBodyText(SAMPLE_DRAFT);
            setTab('paste');
            setErrorMsg(null);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-serif font-semibold text-[#458588] dark:text-[#83a598] bg-[#458588]/15 border border-[#458588]/30 hover:bg-[#458588]/25 transition-colors cursor-pointer self-start sm:self-auto tap-interactive shadow-xs"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Load Sample Draft</span>
        </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-[#cc241d]/15 border border-[#cc241d]/30 text-xs sm:text-sm text-[#cc241d] dark:text-[#fb4934] flex items-center gap-2.5 font-serif shadow-xs">
          <AlertTriangle className="w-4 h-4 text-[#cc241d] dark:text-[#fb4934] shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="bg-white/95 dark:bg-[#32302f]/90 p-6 sm:p-8 rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm backdrop-blur-xl space-y-5">
        {/* Title */}
        <div>
          <label htmlFor="intake-title" className="block text-xs font-serif font-bold text-[#504945] dark:text-[#d6d4ce] uppercase tracking-wider mb-1.5">
            Document Title <span className="text-[#cc241d] dark:text-[#fb4934]">*</span>
          </label>
          <input
            id="intake-title"
            type="text"
            placeholder="e.g. Q4 Cloud Product Announcement"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-sm sm:text-base font-serif font-medium p-3 rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] bg-[#f0eee9]/60 dark:bg-[#282828] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#458588] placeholder:text-[#7c6f64] dark:placeholder:text-[#a89984]"
          />
        </div>

        {/* Content Type */}
        <div>
          <label htmlFor="intake-type" className="block text-xs font-serif font-bold text-[#504945] dark:text-[#d6d4ce] uppercase tracking-wider mb-1.5">
            Channel & Document Format
          </label>
          <select
            id="intake-type"
            value={contentType}
            onChange={(e) => setContentType(e.target.value as ContentType)}
            className="w-full text-xs sm:text-sm font-serif p-3 rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] bg-white dark:bg-[#282828] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#458588] cursor-pointer"
          >
            <option value="blog">Blog Post / Editorial Article</option>
            <option value="social_post">Social Post / Announcement</option>
            <option value="announcement">Press Release / Regulatory Notice</option>
            <option value="product_copy">Product Copy / Landing Page</option>
          </select>
        </div>

        {/* Input Method Tabs */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center bg-[#f0eee9] dark:bg-[#282828] p-1 rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] text-xs font-serif">
              <button
                type="button"
                onClick={() => setTab('paste')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  tab === 'paste'
                    ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-white shadow-xs'
                    : 'text-[#7c6f64] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                }`}
              >
                Draft Manuscript
              </button>
              <button
                type="button"
                onClick={() => setTab('upload')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  tab === 'upload'
                    ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-white shadow-xs'
                    : 'text-[#7c6f64] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                }`}
              >
                Upload File (.txt, .docx)
              </button>
            </div>

            {tab === 'paste' && (
              <div className="flex items-center gap-3">
                {/* Font Toggle */}
                <div className="flex items-center bg-[#f0eee9] dark:bg-[#282828] p-0.5 rounded-lg text-[11px] font-serif">
                  <button
                    type="button"
                    onClick={() => setFontMode('serif')}
                    className={`px-2 py-0.5 rounded-md font-serif transition-all ${
                      fontMode === 'serif'
                        ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-white shadow-xs font-semibold'
                        : 'text-[#7c6f64] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                    }`}
                    title="Editorial Serif typography"
                  >
                    Editorial
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontMode('mono')}
                    className={`px-2 py-0.5 rounded-md font-mono transition-all ${
                      fontMode === 'mono'
                        ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-white shadow-xs font-semibold'
                        : 'text-[#7c6f64] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                    }`}
                    title="Monospace typography"
                  >
                    Mono
                  </button>
                </div>

                <span
                  className={`text-[11px] font-serif tabular-nums font-semibold ${
                    isOverLimit
                      ? 'text-[#cc241d] dark:text-[#fb4934]'
                      : isTooShort
                      ? 'text-[#7c6f64] dark:text-[#a89984]'
                      : 'text-[#504945] dark:text-[#d6d4ce]'
                  }`}
                >
                  {wordCount} / 2,000 words {wordCount > 0 && `· ~${Math.max(1, Math.ceil(wordCount / 200))} min read`}
                </span>
              </div>
            )}
          </div>

          {tab === 'paste' ? (
            <div className="space-y-2">
              <textarea
                rows={9}
                placeholder="Write or paste your draft manuscript for editorial brand verification..."
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                className={`w-full p-4 rounded-2xl border border-[#e2e0dc] dark:border-[#3c3836] bg-[#f0eee9]/60 dark:bg-[#282828] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#458588] leading-[1.85] placeholder:text-[#7c6f64] dark:placeholder:text-[#a89984] ${
                  fontMode === 'serif'
                    ? 'font-serif text-[17px] sm:text-[18px]'
                    : 'font-mono text-xs'
                }`}
              />

              {isOverLimit && (
                <div className="flex items-center justify-between p-3 bg-[#cc241d]/15 border border-[#cc241d]/30 rounded-xl text-xs text-[#cc241d] dark:text-[#fb4934] font-serif font-medium">
                  <span>Exceeds maximum limit of 2,000 words.</span>
                  <button
                    type="button"
                    onClick={handleTruncateToLimit}
                    className="underline font-bold cursor-pointer"
                  >
                    Truncate to 2,000 words
                  </button>
                </div>
              )}

              {isNonEnglish && (
                <div className="p-3 bg-[#d65d0e]/15 border border-[#d65d0e]/30 rounded-xl text-xs text-[#d65d0e] dark:text-[#fe8019] flex items-center gap-2 font-serif">
                  <AlertTriangle className="w-4 h-4 text-[#d65d0e] dark:text-[#fe8019] shrink-0" />
                  <span>Non-English text detected. English brand rules will be evaluated via translation heuristics.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="border border-dashed border-[#e2e0dc] dark:border-[#3c3836] rounded-2xl p-8 text-center bg-[#f0eee9]/60 dark:bg-[#282828]/50">
              <Upload className="w-8 h-8 text-[#7c6f64] dark:text-[#a89984] mx-auto mb-2" />
              <p className="text-sm font-serif font-semibold text-[#282828] dark:text-white mb-1">
                Upload .txt or .docx file
              </p>
              <p className="text-xs font-serif text-[#7c6f64] dark:text-[#a89984] mb-4">Maximum file size 10MB</p>
              <label className="cursor-pointer inline-flex items-center px-4 py-2 rounded-xl text-xs font-serif font-semibold text-white dark:text-[#1d2021] bg-[#282828] dark:bg-[#f0eee9] hover:bg-[#3c3836] dark:hover:bg-[#f5f5f4] transition-all shadow-xs tap-interactive">
                <span>Browse Files</span>
                <input
                  type="file"
                  accept=".txt,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              {uploadedFile && (
                <div className="mt-4 p-2 bg-white dark:bg-[#32302f] rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] text-xs font-serif inline-flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#458588] dark:text-[#83a598]" />
                  <span>{uploadedFile.name}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Visual Asset Attachment */}
        <div className="pt-2 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60">
          <label className="block text-xs font-serif font-bold text-[#504945] dark:text-[#d6d4ce] uppercase tracking-wider mb-2">
            Visual Asset Verification (Optional)
          </label>
          {attachment ? (
            <div className="flex items-center justify-between p-3 rounded-2xl border border-[#e2e0dc] dark:border-[#3c3836] bg-[#f0eee9]/60 dark:bg-[#282828]/60">
              <div className="flex items-center gap-3">
                {attachment.preview_url && (
                  <img
                    src={attachment.preview_url}
                    alt={attachment.alt_text || 'Uploaded asset'}
                    className="w-12 h-12 object-cover rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-xs"
                  />
                )}
                <div>
                  <div className="text-xs font-serif font-bold text-[#282828] dark:text-white">{attachment.file_name}</div>
                  <input
                    type="text"
                    placeholder="Enter descriptive alt text for accessibility"
                    value={attachment.alt_text}
                    onChange={(e) =>
                      setAttachment((prev) => (prev ? { ...prev, alt_text: e.target.value } : null))
                    }
                    className="mt-1 w-64 text-xs font-serif p-2 rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] bg-white dark:bg-[#282828] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#458588]"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-[#7c6f64] hover:text-[#cc241d] p-1.5 rounded-lg transition-colors cursor-pointer"
                aria-label="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] text-xs font-serif font-medium text-[#504945] dark:text-[#d6d4ce] bg-[#f0eee9]/60 dark:bg-[#282828] hover:bg-[#f0eee9] dark:hover:bg-[#3c3836] transition-colors shadow-2xs tap-interactive">
                <ImageIcon className="w-3.5 h-3.5 text-[#7c6f64] dark:text-[#a89984]" />
                <span>Attach Image (PNG / JPG)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
              <span className="text-[11px] font-serif text-[#7c6f64] dark:text-[#a89984]">Max 5MB · Evaluated for contrast & accessibility alt-text</span>
            </div>
          )}
        </div>

        {/* Responsible Governance Note */}
        <div className="p-4 bg-[#f0eee9]/60 dark:bg-[#282828]/60 rounded-2xl border border-[#e2e0dc] dark:border-[#3c3836] flex items-start gap-3 text-xs text-[#504945] dark:text-[#d6d4ce] font-serif">
          <ShieldCheck className="w-4 h-4 text-[#98971a] dark:text-[#b8bb26] shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            Content is verified against your organization&apos;s authoritative Brand Library rules. No AI alterations are applied automatically.{' '}
            <button
              type="button"
              onClick={() => setDisclosureOpen(true)}
              className="text-[#458588] dark:text-[#83a598] hover:underline font-semibold cursor-pointer"
            >
              Review AI Policy & Guardrails
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60">
          <button
            type="button"
            disabled={isSubmitting || !title.trim() || (!hasValidDocxUpload && (isTooShort || isOverLimit))}
            onClick={() => handleCreate(false)}
            className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-serif font-medium text-[#504945] dark:text-[#d6d4ce] bg-[#f0eee9] dark:bg-[#3c3836] border border-[#e2e0dc] dark:border-[#3c3836] hover:bg-[#f0eee9] dark:hover:bg-[#504945] disabled:opacity-50 transition-colors cursor-pointer tap-interactive"
          >
            Save Draft Only
          </button>
          <button
            type="button"
            disabled={isSubmitting || !title.trim() || (!hasValidDocxUpload && (isTooShort || isOverLimit))}
            onClick={() => handleCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-serif font-semibold text-white dark:text-[#1d2021] bg-[#282828] dark:bg-[#f0eee9] hover:bg-[#3c3836] dark:hover:bg-[#f5f5f4] disabled:opacity-50 transition-all shadow-xs cursor-pointer tap-interactive"
          >
            <CheckCircle className="w-4 h-4" />
            <span>{isSubmitting ? 'Evaluating Policy...' : 'Verify Content'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
