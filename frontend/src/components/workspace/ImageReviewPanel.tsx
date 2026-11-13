import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ImageUp, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import type { ContentItem, Finding, ImageRegion, UserProfile, VersionImageInfo } from '../../types/domain';

interface Props {
  user: UserProfile;
  contentId: string;
  image: VersionImageInfo;
  findings: Finding[];
  selectedFindingId: string | null;
  onSelectFinding: (id: string) => void;
  /** Called with the updated item after a revised image is uploaded. */
  onRevised: (item: ContentItem) => void;
}

const SEVERITY_BOX: Record<string, string> = {
  high: 'border-rose-500 bg-rose-500/15',
  medium: 'border-amber-500 bg-amber-500/15',
  low: 'border-sky-500 bg-sky-500/15',
};

/** Plain-language lines for the measured checks. Only problems are listed. */
function checkLines(image: VersionImageInfo): string[] {
  const m = image.metrics;
  const f = m.flags;
  const out: string[] = [];
  if (f.below_recommended_size && m.recommended_size) {
    out.push(`Image is ${m.width}×${m.height}px. ${m.platform_label ?? 'This channel'} works best at ${m.recommended_size[0]}×${m.recommended_size[1]}px, so it may look soft.`);
  }
  if (f.wrong_aspect_ratio && m.recommended_size) {
    out.push(`The shape does not match ${m.platform_label ?? 'the channel'} (${m.recommended_size[0]}×${m.recommended_size[1]}). It may be cropped.`);
  }
  if (f.looks_blurry) out.push('The image looks blurry. Use a sharper or higher-resolution original.');
  if (f.too_dark) out.push('The image is very dark overall. Text and details may be hard to see.');
  if (f.too_bright) out.push('The image is very bright overall. Light text may wash out.');
  if (f.low_overall_contrast) out.push('Overall contrast is low. Important elements may not stand out.');
  return out;
}

export const ImageReviewPanel: React.FC<Props> = ({
  user, contentId, image, findings, selectedFindingId, onSelectFinding, onRevised,
}) => {
  const [src, setSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    setSrc(null);
    setLoadError(null);
    api.getVersionImageUrl(user, image.url)
      .then((u) => { url = u; if (revoked) URL.revokeObjectURL(u); else setSrc(u); })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'The image could not be loaded.'));
    return () => { revoked = true; if (url) URL.revokeObjectURL(url); };
  }, [user, image.url]);

  // For each finding, the picture boxes whose text overlaps the finding's highlighted span.
  const boxes = useMemo(() => {
    const result: { finding: Finding; region: ImageRegion }[] = [];
    for (const finding of findings) {
      const dec = finding.decisions[finding.decisions.length - 1];
      if (dec && (dec.action === 'dismissed' || dec.action === 'overridden')) continue;
      for (const region of image.regions) {
        if (region.start < finding.span_end && region.end > finding.span_start) {
          result.push({ finding, region });
        }
      }
    }
    return result;
  }, [findings, image.regions]);

  const problems = checkLines(image);

  const handleRevised = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      onRevised(await api.uploadRevisedImage(user, contentId, file, image.platform ?? undefined));
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Could not upload the revised image.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section aria-label="Image under review" className="mb-6 space-y-3">
      <div className="relative inline-block max-w-full rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
        {src ? (
          <img
            src={src}
            alt="The creative under review"
            className="block max-w-full max-h-[480px] w-auto h-auto"
            style={{ aspectRatio: `${image.width} / ${image.height}` }}
          />
        ) : (
          <div
            className="flex items-center justify-center text-xs text-slate-500 min-w-[240px] min-h-[160px]"
            style={{ aspectRatio: `${image.width} / ${image.height}`, maxHeight: 480 }}
          >
            {loadError ?? <Loader2 className="w-4 h-4 animate-spin" aria-label="Loading image" />}
          </div>
        )}
        {src && boxes.map(({ finding, region }) => (
          <button
            key={`${finding.id}-${region.start}`}
            type="button"
            aria-label={`Show finding: ${finding.entry_title}`}
            onClick={() => onSelectFinding(finding.id)}
            className={`absolute border-2 rounded-sm transition-all ${SEVERITY_BOX[finding.severity] ?? SEVERITY_BOX.low} ${
              selectedFindingId === finding.id ? 'ring-2 ring-indigo-600 ring-offset-1' : ''
            }`}
            style={{
              left: `${region.x * 100}%`, top: `${region.y * 100}%`,
              width: `${region.w * 100}%`, height: `${region.h * 100}%`,
            }}
          />
        ))}
      </div>

      {problems.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Image checks
          </p>
          <ul className="list-disc pl-5 space-y-0.5">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Size, sharpness and brightness look fine for {image.metrics.platform_label ?? 'this image'}.
        </p>
      )}

      <div className="flex items-center gap-3">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleRevised} />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageUp className="w-3.5 h-3.5" />}
          <span>{uploading ? 'Reading the new image…' : 'Upload revised image'}</span>
        </button>
        {uploadError && <span role="alert" className="text-xs text-rose-700">{uploadError}</span>}
      </div>
      <p className="text-[11px] text-slate-500">
        The text below is what the AI read from your image. Findings point at that text, and the boxes on the image show where each one applies.
      </p>
    </section>
  );
};
