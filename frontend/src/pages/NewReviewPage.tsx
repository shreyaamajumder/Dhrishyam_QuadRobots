// src/pages/NewReviewPage.tsx
import React, { useState } from 'react';
import {
  Upload,
  FileText,
  AlertTriangle,
  Sparkles,
  Image as ImageIcon,
  CheckCircle,
  X,
  FileCode,
} from 'lucide-react';
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
  const [bodyText, setBodyText] = useState('');
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

    if (!file.name.endsWith('.txt') && !file.name.endsWith('.docx')) {
      setErrorMsg('Unsupported file type. Please upload a .txt or .docx file, or paste your text directly.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setBodyText(content);
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, ''));
      }
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

  const handleCreate = async (runCheckImmediately: boolean) => {
    if (!user) return;
    if (!title.trim()) {
      setErrorMsg('Please enter a document title');
      return;
    }
    if (isTooShort) {
      setErrorMsg('Draft is too short for brand review (minimum 5 words)');
      return;
    }
    if (isOverLimit) {
      setErrorMsg('Content exceeds the 2,000 words limit. Please shorten or check the first 2,000 words.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const created = await api.createContent(user, {
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
        title: runCheckImmediately ? 'Brand check started' : 'Draft saved',
        description: `Opened "${created.title}" in workspace`,
        type: 'success',
      });

      navigate(`workspace/${created.id}`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create review intake');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">New Brand Review</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Submit copy to run automated policy, claim, and terminology checks before publication.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setTitle('Announcing the Q4 AcmeCloud Enterprise Launch Blog');
            setContentType('blog');
            setBodyText(SAMPLE_DRAFT);
            setTab('paste');
            setErrorMsg(null);
          }}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
        >
          Load sample draft
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">
          {errorMsg}
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
        {/* Title */}
        <div>
          <label htmlFor="intake-title" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Content Title <span className="text-rose-600">*</span>
          </label>
          <input
            id="intake-title"
            type="text"
            placeholder="e.g. Q4 Cloud Product Announcement"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-sm p-2.5 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none"
          />
        </div>

        {/* Content Type */}
        <div>
          <label htmlFor="intake-type" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Content Format & Channel
          </label>
          <select
            id="intake-type"
            value={contentType}
            onChange={(e) => setContentType(e.target.value as ContentType)}
            className="w-full text-sm p-2.5 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none capitalize"
          >
            <option value="blog">Blog Post / Article</option>
            <option value="social_post">Social Post / Announcement</option>
            <option value="announcement">Press Release / Public Notice</option>
            <option value="product_copy">Product Copy / Landing Page</option>
          </select>
        </div>

        {/* Input Method Tabs */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setTab('paste')}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  tab === 'paste' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Paste text
              </button>
              <button
                type="button"
                onClick={() => setTab('upload')}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  tab === 'upload' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Upload file (.txt, .docx)
              </button>
            </div>

            {/* Live word counter */}
            <div
              className={`text-xs font-mono tabular-nums ${
                isOverLimit ? 'text-rose-600 font-bold' : 'text-slate-500'
              }`}
            >
              {wordCount.toLocaleString()} / 2,000 words
            </div>
          </div>

          {tab === 'paste' ? (
            <textarea
              rows={8}
              placeholder="Paste your draft body text here for real-time brand governance evaluation..."
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full text-sm p-3.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none leading-relaxed font-sans"
            />
          ) : (
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <div className="text-xs font-semibold text-slate-800">
                Click to upload or drag & drop .txt or .docx file
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Maximum 2,000 words extracted as plain text</p>
              <input
                type="file"
                accept=".txt,.docx"
                onChange={handleFileUpload}
                className="mt-3 text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
              />
            </div>
          )}

          {/* Over limit prompt */}
          {isOverLimit && (
            <div className="mt-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between">
              <span>Text exceeds the 2,000 words maximum limit.</span>
              <button
                type="button"
                onClick={handleTruncateToLimit}
                className="underline font-semibold cursor-pointer"
              >
                Check first 2,000 words
              </button>
            </div>
          )}

          {/* Non-English heuristic notice */}
          {isNonEnglish && (
            <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>
                Non-English text detected: V1 runs deterministic pattern checks only. AI tone & messaging review requires English copy.
              </span>
            </div>
          )}
        </div>

        {/* L1 Optional Single Image Asset Upload */}
        <div className="pt-2 border-t border-slate-100">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Visual Asset (Optional L1 Single Image Check)
          </label>
          {attachment ? (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {attachment.preview_url && (
                  <img
                    src={attachment.preview_url}
                    alt={attachment.alt_text || 'Asset preview'}
                    className="w-12 h-12 object-cover rounded-lg border border-slate-200"
                  />
                )}
                <div>
                  <div className="text-xs font-medium text-slate-900">{attachment.file_name}</div>
                  <input
                    type="text"
                    placeholder="Enter descriptive alt text for accessibility (e.g. AcmeCloud architecture diagram)"
                    value={attachment.alt_text}
                    onChange={(e) =>
                      setAttachment((prev) => (prev ? { ...prev, alt_text: e.target.value } : null))
                    }
                    className="mt-1 w-64 text-xs p-1.5 rounded border border-slate-300 bg-white"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors">
                <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                <span>Attach PNG/JPG</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
              <span className="text-[11px] text-slate-500">Max 5MB. Evaluated for alt text & brand colors.</span>
            </div>
          )}
        </div>

        {/* Privacy & Disclosure Note */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-2.5 text-xs text-slate-600">
          <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            Content is processed by external AI services (Google Gemini API / Groq). Under free-tier terms, avoid confidential data.{' '}
            <button
              type="button"
              onClick={() => setDisclosureOpen(true)}
              className="text-indigo-600 hover:text-indigo-800 underline font-medium cursor-pointer"
            >
              Read AI Disclosure & Policy
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            disabled={isSubmitting || !title.trim() || isTooShort || isOverLimit}
            onClick={() => handleCreate(false)}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Save Draft
          </button>
          <button
            type="button"
            disabled={isSubmitting || !title.trim() || isTooShort || isOverLimit}
            onClick={() => handleCreate(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-xs"
          >
            <CheckCircle className="w-4 h-4" />
            <span>{isSubmitting ? 'Evaluating...' : 'Run Brand Check'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
