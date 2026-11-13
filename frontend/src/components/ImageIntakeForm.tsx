import React, { useEffect, useRef, useState } from 'react';
import { ImageUp, Loader2 } from 'lucide-react';
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
      pushToast({ title: runCheck ? 'Brand check started' : 'Image saved', description: `Opened "${created.title}"`, type: 'success' });
      navigate(`workspace/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not upload the image.');
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Review an image</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload a social post or banner. The AI reads it, checks the wording and look against your brand library, and suggests fixes.
          </p>
        </div>
        <button type="button" onClick={onBack} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline">
          Review text instead
        </button>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">{error}</div>
      )}

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
        <div>
          <label htmlFor="img-title" className="block text-xs font-semibold text-slate-700 mb-1.5">Title (optional)</label>
          <input id="img-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Diwali offer banner"
            className="w-full text-sm p-2.5 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="img-platform" className="block text-xs font-semibold text-slate-700 mb-1.5">Where will it be posted?</label>
          <select id="img-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}
            className="w-full text-sm p-2.5 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none">
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pick} />
          <button type="button" onClick={() => inputRef.current?.click()}
            className="w-full border-2 border-dashed border-slate-300 rounded-xl p-6 text-center text-xs text-slate-600 hover:border-indigo-400 hover:bg-indigo-50/40">
            {preview ? (
              <img src={preview} alt="Selected creative" className="mx-auto max-h-64 rounded-lg" />
            ) : (
              <span className="inline-flex flex-col items-center gap-2"><ImageUp className="w-6 h-6" />Choose a JPEG, PNG or WebP image (up to 5 MB)</span>
            )}
          </button>
          {file && <p className="mt-1.5 text-[11px] text-slate-500">{file.name}</p>}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled={!file || busy} onClick={() => submit(false)}
            className="px-4 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Save without checking
          </button>
          <button type="button" disabled={!file || busy} onClick={() => submit(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{busy ? 'Reading your image…' : 'Run brand check'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
