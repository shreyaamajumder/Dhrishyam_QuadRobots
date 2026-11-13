import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ImageUp, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';

const PLATFORMS: { value: string; label: string }[] = [
  { value: 'instagram_post', label: 'Instagram post (1080×1350)' },
  { value: 'instagram_story', label: 'Instagram story (1080×1920)' },
  { value: 'linkedin_post', label: 'LinkedIn post (1200×627)' },
  { value: 'linkedin_banner', label: 'LinkedIn banner (1584×396)' },
  { value: 'x_post', label: 'X post (1600×900)' },
  { value: 'youtube_thumbnail', label: 'YouTube thumbnail (1280×720)' },
  { value: 'web_banner', label: 'Web banner (1200×628)' },
  { value: 'other', label: 'Other' },
];

const MAX_BYTES = 5 * 1024 * 1024;

const LABEL =
  'block text-xs font-serif font-bold text-[#504945] dark:text-[#d6d4ce] uppercase tracking-wider mb-1.5';
const FIELD =
  'w-full text-sm font-serif p-3 rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] bg-[#f0eee9]/60 dark:bg-[#282828] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#458588]';

export const ImageIntakeForm: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { user, navigate, pushToast } = useApp();
  const [title, setTitle] = useState('');
  const [platform, setPlatform] = useState('instagram_post');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
      setError('Please choose a JPEG, PNG or WebP image.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('Image size exceeds the 5 MB limit. Please upload a smaller file.');
      return;
    }
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (runCheck: boolean) => {
    if (!user || !file) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.uploadImage(user, { file, title: title.trim(), platform });
      if (runCheck) await api.triggerCheckRun(user, created.id);
      pushToast({
        title: runCheck ? 'Brand check started' : 'Image saved',
        description: `Opened "${created.title}"`,
        type: 'success',
      });
      navigate(`workspace/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not upload the image.');
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#282828] dark:text-white tracking-tight">
            Review an Image
          </h1>
          <p className="text-xs sm:text-sm font-serif italic text-[#7c6f64] dark:text-[#a89984] mt-1">
            Upload a social post or banner. The AI reads it, checks the wording and look against your brand library, and suggests fixes.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-serif font-semibold text-[#458588] dark:text-[#83a598] bg-[#458588]/15 border border-[#458588]/30 hover:bg-[#458588]/25 transition-colors cursor-pointer self-start sm:self-auto shadow-xs"
        >
          Review text instead
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-[#cc241d]/15 border border-[#cc241d]/30 text-xs sm:text-sm text-[#cc241d] dark:text-[#fb4934] flex items-center gap-2.5 font-serif"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white/95 dark:bg-[#32302f]/90 p-6 sm:p-8 rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm backdrop-blur-xl space-y-5">
        <div>
          <label htmlFor="img-title" className={LABEL}>Title (optional)</label>
          <input
            id="img-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Diwali offer banner"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="img-platform" className={LABEL}>Where will it be posted?</label>
          <select
            id="img-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className={`${FIELD} cursor-pointer`}
          >
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full border border-dashed border-[#e2e0dc] dark:border-[#3c3836] rounded-2xl p-8 text-center text-xs font-serif text-[#7c6f64] dark:text-[#a89984] bg-[#f0eee9]/60 dark:bg-[#282828]/50 hover:border-[#458588] transition-colors cursor-pointer"
          >
            {preview ? (
              <img src={preview} alt="Selected creative" className="mx-auto max-h-64 rounded-xl" />
            ) : (
              <span className="inline-flex flex-col items-center gap-2">
                <ImageUp className="w-8 h-8" />
                <span className="text-sm font-semibold text-[#282828] dark:text-white">Choose an image</span>
                JPEG, PNG or WebP, up to 5 MB
              </span>
            )}
          </button>
          {file && <p className="mt-1.5 text-[11px] font-serif text-[#7c6f64] dark:text-[#a89984]">{file.name}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60">
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => submit(false)}
            className="px-4 py-2 text-xs font-serif font-semibold rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] bg-white dark:bg-[#282828] text-[#504945] dark:text-[#d6d4ce] hover:bg-[#f0eee9] dark:hover:bg-[#3c3836] disabled:opacity-50 cursor-pointer"
          >
            Save without checking
          </button>
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => submit(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-serif font-semibold rounded-xl text-white dark:text-[#1d2021] bg-[#282828] dark:bg-[#f0eee9] hover:bg-[#3c3836] dark:hover:bg-[#f5f5f4] disabled:opacity-50 cursor-pointer shadow-xs"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{busy ? 'Reading your image…' : 'Run brand check'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
