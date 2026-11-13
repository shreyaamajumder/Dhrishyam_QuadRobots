// src/pages/LibraryPage.tsx
import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Cpu,
  X,
  UploadCloud,
  AlertCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import {
  BrandEntry,
  BrandEntryVersion,
  CheckMode,
  EntryCategory,
  EntryType,
  ProposedImportEntry,
  Severity,
} from '../types/domain';
import {
  SeverityTag,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  Skeleton,
} from '../components/shared/Primitives';

export const LibraryPage: React.FC = () => {
  const { user, pushToast, libraryVersion, incrementLibraryVersion } = useApp();

  const [entries, setEntries] = useState<BrandEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeTab, setActiveTab] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');

  // Side panel editor state (S09)
  const [selectedEntry, setSelectedEntry] = useState<BrandEntry | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<'details' | 'history'>('details');
  const [versions, setVersions] = useState<BrandEntryVersion[]>([]);

  // Flexible resizable side panel state
  const [panelWidth, setPanelWidth] = useState<number>(560);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(380, Math.min(window.innerWidth - 30, window.innerWidth - e.clientX));
      setPanelWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Side panel form state
  const [formCode, setFormCode] = useState('');
  const [formType, setFormType] = useState<EntryType>('rule');
  const [formCategory, setFormCategory] = useState<EntryCategory>('tone');
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formCheckMode, setFormCheckMode] = useState<CheckMode>('deterministic');
  const [formBanned, setFormBanned] = useState('');
  const [formPreferred, setFormPreferred] = useState('');
  const [formGoodExample, setFormGoodExample] = useState('');
  const [formBadExample, setFormBadExample] = useState('');
  const [formSeverity, setFormSeverity] = useState<Severity>('medium');
  const [formIsActive, setFormIsActive] = useState(true);
  const [changeNote, setChangeNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Live pattern test playground in editor
  const [testText, setTestText] = useState('');

  // Toggle active confirm
  const [toggleConfirmEntry, setToggleConfirmEntry] = useState<{ id: string; code: string; target: boolean } | null>(null);

  // S16 Guideline Import modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [rawImportText, setRawImportText] = useState('');
  const [proposedRules, setProposedRules] = useState<ProposedImportEntry[]>([]);
  const [isParsingImport, setIsParsingImport] = useState(false);

  const isAdmin = user?.role === 'admin';

  const loadEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLibraryEntries();
      setEntries(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load brand library');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const openEditor = async (entry?: BrandEntry) => {
    setEditorError(null);
    if (entry) {
      setSelectedEntry(entry);
      setFormCode(entry.code);
      setFormType(entry.entry_type);
      setFormCategory(entry.category);
      setFormTitle(entry.title);
      setFormBody(entry.body);
      setFormCheckMode(entry.check_mode);
      setFormBanned(entry.pattern?.banned || '');
      setFormPreferred(entry.pattern?.preferred || '');
      setFormGoodExample(entry.good_example || '');
      setFormBadExample(entry.bad_example || '');
      setFormSeverity(entry.severity_default);
      setFormIsActive(entry.is_active);
      setChangeNote('');

      const historyList = await api.getEntryVersions(entry.id);
      setVersions(historyList);
    } else {
      setSelectedEntry(null);
      setFormCode(`R-NEW-00${entries.length + 1}`);
      setFormType('rule');
      setFormCategory('tone');
      setFormTitle('');
      setFormBody('');
      setFormCheckMode('deterministic');
      setFormBanned('');
      setFormPreferred('');
      setFormGoodExample('');
      setFormBadExample('');
      setFormSeverity('medium');
      setFormIsActive(true);
      setChangeNote('Initial entry creation');
      setVersions([]);
    }
    setEditorTab('details');
    setIsEditorOpen(true);
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin) return;
    if (!formCode.trim() || !formTitle.trim() || !formBody.trim()) {
      setEditorError('Code, Title, and Rule Body are required fields.');
      return;
    }

    setIsSaving(true);
    setEditorError(null);

    try {
      await api.saveLibraryEntry(
        user,
        {
          id: selectedEntry?.id,
          code: formCode.trim(),
          entry_type: formType,
          category: formCategory,
          title: formTitle.trim(),
          body: formBody.trim(),
          check_mode: formCheckMode,
          pattern: formBanned ? { banned: formBanned.trim(), preferred: formPreferred.trim() } : undefined,
          good_example: formGoodExample.trim() || undefined,
          bad_example: formBadExample.trim() || undefined,
          severity_default: formSeverity,
          is_active: formIsActive,
        },
        changeNote.trim() || 'Updated rule definition'
      );

      incrementLibraryVersion();
      pushToast({
        title: selectedEntry ? 'Entry updated' : 'Entry created',
        description: `Library version incremented to Lib v${libraryVersion + 1}`,
        type: 'success',
      });
      setIsEditorOpen(false);
      loadEntries();
    } catch (err: unknown) {
      setEditorError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActiveConfirm = async () => {
    if (!user || !isAdmin || !toggleConfirmEntry) return;
    try {
      await api.toggleEntryActive(user, toggleConfirmEntry.id, toggleConfirmEntry.target);
      incrementLibraryVersion();
      pushToast({
        title: toggleConfirmEntry.target ? 'Rule activated' : 'Rule deactivated',
        description: `${toggleConfirmEntry.code} updated`,
        type: 'info',
      });
      setToggleConfirmEntry(null);
      loadEntries();
    } catch (err: unknown) {
      pushToast({
        title: 'Toggle failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
      setToggleConfirmEntry(null);
    }
  };

  const handleSeedDemoKit = async () => {
    if (!user || !isAdmin) return;
    try {
      await api.seedDemoLibrary(user);
      incrementLibraryVersion();
      pushToast({
        title: 'Demo Brand Kit Loaded',
        description: 'Seeded verified terminology, claims, and tone rules',
        type: 'success',
      });
      loadEntries();
    } catch (err: unknown) {
      pushToast({ title: 'Seed failed', description: 'Could not load demo kit', type: 'error' });
    }
  };

  // Live pattern test matching
  const testMatch = formBanned && testText.toLowerCase().includes(formBanned.toLowerCase());

  // Filter entries
  const filteredEntries = entries.filter((entry) => {
    if (activeTab !== 'all' && entry.entry_type !== activeTab) return false;
    if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
    if (statusFilter === 'active' && !entry.is_active) return false;
    if (statusFilter === 'inactive' && entry.is_active) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        entry.code.toLowerCase().includes(q) ||
        entry.title.toLowerCase().includes(q) ||
        entry.body.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif text-2xl sm:text-3xl font-normal text-[#282828] dark:text-[#fbf1c7] tracking-tight">
              Brand Guidelines & Rule Library
            </h1>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-[#edeae1] dark:bg-[#32302f] text-[#4a4440] dark:text-[#ebdbb2] border border-[#e2ded5] dark:border-[#3c3836] shadow-2xs">
              v{libraryVersion}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#5c5650] dark:text-[#d5c4a1] mt-1">
            Authoritative rule definitions, tone constraints, and automated verification criteria.
          </p>
        </div>

        {isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#4a4440] dark:text-[#ebdbb2] bg-white dark:bg-white/[0.04] border border-[#e2ded5] dark:border-[#3c3836] hover:bg-[#edeae1]/60 dark:hover:bg-white/[0.08] transition-colors shadow-2xs cursor-pointer tap-interactive"
            >
              <UploadCloud className="w-3.5 h-3.5 text-[#a89984]" />
              <span>Import Guidelines</span>
            </button>
            <button
              type="button"
              onClick={handleSeedDemoKit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#4a4440] dark:text-[#ebdbb2] bg-white dark:bg-white/[0.04] border border-[#e2ded5] dark:border-[#3c3836] hover:bg-[#edeae1]/60 dark:hover:bg-white/[0.08] transition-colors shadow-2xs cursor-pointer tap-interactive"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Seed Demo Kit</span>
            </button>
            <button
              type="button"
              onClick={() => openEditor()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-sans font-semibold text-white dark:text-[#1d2021] bg-[#1d6f7a] hover:bg-[#15545c] dark:bg-[#4ea8a0] dark:hover:bg-[#5ab8ad] transition-all shadow-xs cursor-pointer tap-interactive"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Rule Entry</span>
            </button>
          </div>
        ) : (
          <span className="text-xs text-[#706860] dark:text-[#a89984] italic">Read-only view for {user?.role}</span>
        )}
      </div>

      {error && <InlineAlert title="Error loading library" message={error} onRetry={loadEntries} />}

      {/* Tabs by Type */}
      <div className="flex items-center border-b border-[#e2ded5] dark:border-[#3c3836] gap-6 text-xs font-semibold overflow-x-auto">
        {[
          { id: 'all', label: 'All Entries' },
          { id: 'rule', label: 'Rules' },
          { id: 'fact', label: 'Approved Facts' },
          { id: 'term', label: 'Terminology' },
          { id: 'claim_rule', label: 'Claim Rules' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`pb-2.5 transition-all border-b-2 -mb-px cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-slate-900 dark:border-stone-200 text-[#282828] dark:text-[#fbf1c7] font-bold'
                : 'border-transparent text-[#706860] dark:text-[#a89984] hover:text-[#282828] dark:hover:text-stone-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-[#282828] p-2.5 rounded-xl border border-[#e2ded5] dark:border-[#3c3836] shadow-2xs backdrop-blur-md">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#a89984] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search rules by code, title, or body..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm rounded-lg border border-[#e2ded5] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] placeholder:text-[#a89984] focus:outline-none focus:ring-2 focus:ring-[#36755a]/20 focus:border-[#36755a]"
          />
        </div>

        {/* Category & Status Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="p-1.5 px-2.5 rounded-lg border border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-black/40 text-[#4a4440] dark:text-[#ebdbb2] capitalize focus:outline-none focus:ring-1 focus:ring-[#36755a]"
          >
            <option value="all">All Categories</option>
            <option value="tone">Tone</option>
            <option value="terminology">Terminology</option>
            <option value="messaging">Messaging</option>
            <option value="facts_claims">Facts & Claims</option>
            <option value="accessibility">Accessibility</option>
            <option value="visual">Visual</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="p-1.5 px-2.5 rounded-lg border border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-black/40 text-[#4a4440] dark:text-[#ebdbb2] focus:outline-none focus:ring-1 focus:ring-[#36755a]"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
      </div>

      {/* Library Table */}
      {loading ? (
        <div className="bg-white/80 dark:bg-[#282828]/60 rounded-2xl border border-[#e2ded5] dark:border-[#3c3836] p-6 space-y-4 backdrop-blur-md">
          <Skeleton className="h-8 w-1/4" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : filteredEntries.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-6 h-6" />}
          explanation={
            search || categoryFilter !== 'all' || statusFilter !== 'all'
              ? 'No rules match your active filters.'
              : 'Your Brand Library is currently empty.'
          }
          actionLabel={isAdmin ? 'Add First Entry' : undefined}
          onAction={isAdmin ? () => openEditor() : undefined}
          secondaryActionLabel={isAdmin && !entries.length ? 'Seed Demo Kit' : undefined}
          onSecondaryAction={isAdmin && !entries.length ? handleSeedDemoKit : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-[#282828] rounded-2xl border border-[#e2ded5] dark:border-[#3c3836] shadow-lg overflow-hidden backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="min-w-[800px] w-full divide-y divide-slate-200/80 dark:divide-slate-800 text-left text-xs">
              <thead className="bg-[#edeae1]/60 dark:bg-[#1d2021]/60 text-[#706860] dark:text-[#a89984] font-sans font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th scope="col" className="px-5 py-3.5">Code</th>
                  <th scope="col" className="px-5 py-3.5">Title & Rule Summary</th>
                  <th scope="col" className="px-5 py-3.5">Category</th>
                  <th scope="col" className="px-5 py-3.5">Check Mode</th>
                  <th scope="col" className="px-5 py-3.5">Severity</th>
                  <th scope="col" className="px-5 py-3.5">Ver.</th>
                  <th scope="col" className="px-5 py-3.5">Active</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
                {filteredEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => openEditor(entry)}
                    className={`hover:bg-[#edeae1]/60 dark:hover:bg-white/[0.03] cursor-pointer transition-colors group ${
                      !entry.is_active ? 'opacity-50 bg-[#edeae1]/60/50 dark:bg-black/30' : ''
                    }`}
                  >
                    {/* Code */}
                    <td className="px-5 py-3.5 font-mono font-bold text-xs text-[#1d6f7a] dark:text-[#4ea8a0] whitespace-nowrap">
                      {entry.code}
                    </td>

                    {/* Title & Body */}
                    <td className="px-5 py-3.5 max-w-sm">
                      <div className="font-sans font-semibold text-sm text-[#282828] dark:text-[#fbf1c7] group-hover:text-[#1d6f7a] dark:group-hover:text-[#4ea8a0] transition-colors">
                        {entry.title}
                      </div>
                      <div className="text-xs text-[#706860] dark:text-[#a89984] line-clamp-1 mt-0.5 leading-relaxed font-sans">
                        {entry.body}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-5 py-3.5 whitespace-nowrap capitalize text-[#4a4440] dark:text-[#ebdbb2] font-sans text-xs">
                      {entry.category.replace('_', ' ')}
                    </td>

                    {/* Check Mode */}
                    <td className="px-5 py-3.5 whitespace-nowrap font-mono text-[10px]">
                      {entry.check_mode === 'deterministic' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/10 text-[#4a4440] dark:text-[#ebdbb2] border border-[#e2ded5] dark:border-[#3c3836] font-bold">
                          <Cpu className="w-3 h-3 text-[#a89984]" />
                          <span>RULE_ENGINE</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-sky-300 border border-blue-500/20 font-bold">
                          <ShieldCheck className="w-3 h-3 text-blue-500" />
                          <span>SEMANTIC_GROUNDING</span>
                        </span>
                      )}
                    </td>

                    {/* Severity */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      <SeverityTag severity={entry.severity_default} />
                    </td>

                    {/* Version */}
                    <td className="px-5 py-4 whitespace-nowrap font-mono text-[#706860] dark:text-[#a89984] font-bold">
                      v{entry.current_version}
                    </td>

                    {/* Active Toggle (Admin) */}
                    <td
                      className="px-5 py-4 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() =>
                            setToggleConfirmEntry({
                              id: entry.id,
                              code: entry.code,
                              target: !entry.is_active,
                            })
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer shadow-2xs tap-interactive ${
                            entry.is_active
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                              : 'bg-[#edeae1] dark:bg-[#32302f] text-[#5c5650] dark:text-[#d5c4a1] border border-slate-300 dark:border-stone-700'
                          }`}
                        >
                          {entry.is_active ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              <span>Active</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 text-[#a89984]" />
                              <span>Inactive</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className={`text-[11px] font-bold ${entry.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#a89984]'}`}>
                          {entry.is_active ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </td>

                    {/* Updated */}
                    <td className="px-5 py-4 whitespace-nowrap text-right text-[11px] font-mono text-[#a89984]">
                      {new Date(entry.updated_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* S09 Library Entry Editor Side Panel */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-150">
          <div
            style={{ width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : `${panelWidth}px` }}
            className="h-full bg-[#f5f5f3] dark:bg-[#1d2021] shadow-2xl flex flex-col border-l border-[#e2e0dc] dark:border-[#3c3836] relative transition-[width] duration-75 select-text"
          >
            {/* Grab handle for horizontal resizing */}
            <div
              onMouseDown={() => setIsResizing(true)}
              className="hidden sm:flex absolute left-0 top-0 bottom-0 w-2.5 -translate-x-1 cursor-col-resize hover:bg-[#458588]/40 active:bg-[#458588] transition-colors items-center justify-center group z-10"
              title="Drag horizontally to resize panel width"
            >
              <div className="w-0.5 h-12 rounded-full bg-[#d6d4ce] dark:bg-[#504945] group-hover:bg-[#458588] transition-colors" />
            </div>

            {/* Panel Header */}
            <div className="p-4 sm:p-5 border-b border-[#e2e0dc] dark:border-[#3c3836] flex items-center justify-between bg-[#f0eee9]/80 dark:bg-[#282828]/60">
              <div>
                <h3 className="text-base font-serif font-bold text-[#282828] dark:text-[#f5f5f4]">
                  {selectedEntry ? `Edit ${selectedEntry.code}` : 'Add Brand Rule Entry'}
                </h3>
                <p className="text-xs font-sans text-[#706860] dark:text-[#a89984] mt-0.5">
                  {isAdmin ? 'Modifications increment library version' : 'Read-only view'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="text-[#7c6f64] hover:text-[#282828] dark:hover:text-[#f5f5f4] p-1.5 rounded-xl hover:bg-[#f0eee9] dark:hover:bg-[#32302f] cursor-pointer"
                aria-label="Close panel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Panel Tabs */}
            <div className="flex border-b border-[#e2e0dc] dark:border-[#3c3836] bg-[#f5f5f3] dark:bg-[#1d2021] px-4 text-xs font-sans font-semibold">
              <button
                type="button"
                onClick={() => setEditorTab('details')}
                className={`py-2.5 px-3 border-b-2 -mb-px transition-all cursor-pointer font-sans font-semibold ${
                  editorTab === 'details'
                    ? 'border-[#1d6f7a] dark:border-[#4ea8a0] text-[#1d6f7a] dark:text-[#4ea8a0]'
                    : 'border-transparent text-[#7c6f64] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                }`}
              >
                Rule Specification
              </button>
              {selectedEntry && (
                <button
                  type="button"
                  onClick={() => setEditorTab('history')}
                  className={`py-2.5 px-3 border-b-2 -mb-px transition-all cursor-pointer font-sans font-semibold ${
                    editorTab === 'history'
                      ? 'border-[#1d6f7a] dark:border-[#4ea8a0] text-[#1d6f7a] dark:text-[#4ea8a0]'
                      : 'border-transparent text-[#7c6f64] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                  }`}
                >
                  Version History ({versions.length})
                </button>
              )}
            </div>

            {/* Panel Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {editorError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 rounded-xl text-rose-800 dark:text-rose-200 font-semibold">
                  {editorError}
                </div>
              )}

              {editorTab === 'details' ? (
                <form onSubmit={handleSaveEntry} id="entry-editor-form" className="space-y-4">
                  {/* Code & Category */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Rule Code <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={formCode}
                        onChange={(e) => setFormCode(e.target.value)}
                        placeholder="e.g. R-TERM-005"
                        className="w-full p-2.5 font-mono text-xs rounded-xl border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 uppercase disabled:bg-slate-100 dark:disabled:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Entry Type</label>
                      <select
                        disabled={!isAdmin}
                        value={formType}
                        onChange={(e) => setFormType(e.target.value as EntryType)}
                        className="w-full p-2.5 text-xs rounded-xl border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 capitalize disabled:bg-slate-100 dark:disabled:bg-slate-800"
                      >
                        <option value="rule">Rule (Guideline)</option>
                        <option value="fact">Approved Fact</option>
                        <option value="term">Terminology</option>
                        <option value="claim_rule">Claim Rule</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Category</label>
                      <select
                        disabled={!isAdmin}
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value as EntryCategory)}
                        className="w-full p-2.5 text-xs rounded-xl border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 capitalize disabled:bg-slate-100 dark:disabled:bg-slate-800"
                      >
                        <option value="tone">Tone</option>
                        <option value="terminology">Terminology</option>
                        <option value="messaging">Messaging</option>
                        <option value="facts_claims">Facts & Claims</option>
                        <option value="accessibility">Accessibility</option>
                        <option value="visual">Visual</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Check Mode</label>
                      <select
                        disabled={!isAdmin}
                        value={formCheckMode}
                        onChange={(e) => setFormCheckMode(e.target.value as CheckMode)}
                        className="w-full p-2.5 text-xs rounded-xl border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                      >
                        <option value="deterministic">Deterministic (Rule Engine)</option>
                        <option value="llm">AI Evaluated (LLM Pass)</option>
                      </select>
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Rule Title <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g. Product Name Formatting"
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                    />
                  </div>

                  {/* Body / Policy */}
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Rule Body & Rationale <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      rows={3}
                      disabled={!isAdmin}
                      value={formBody}
                      onChange={(e) => setFormBody(e.target.value)}
                      placeholder="Explain the brand policy and why deviations are flagged..."
                      className="w-full p-2.5 text-xs rounded-xl border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 leading-relaxed disabled:bg-slate-100 dark:disabled:bg-slate-800"
                    />
                  </div>

                  {/* Pattern fields for deterministic rules */}
                  {formCheckMode === 'deterministic' && (
                    <div className="p-3.5 bg-[#edeae1]/60/80 dark:bg-[#1d2021]/50 rounded-2xl border border-[#ded9ce]/80 dark:border-slate-800 space-y-2.5">
                      <div className="font-bold text-slate-800 dark:text-slate-200">Deterministic Pattern Matching:</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-600 dark:text-[#a89984] mb-0.5 font-medium">Banned Word / Phrase:</label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={formBanned}
                            onChange={(e) => setFormBanned(e.target.value)}
                            placeholder="e.g. Acme Cloud"
                            className="w-full p-2 text-xs rounded-lg border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#282828] text-[#282828] dark:text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-600 dark:text-[#a89984] mb-0.5 font-medium">Preferred Replacement:</label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={formPreferred}
                            onChange={(e) => setFormPreferred(e.target.value)}
                            placeholder="e.g. AcmeCloud"
                            className="w-full p-2 text-xs rounded-lg border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#282828] text-[#282828] dark:text-slate-100"
                          />
                        </div>
                      </div>

                      {/* Interactive Live Playground */}
                      <div className="pt-2 border-t border-[#ded9ce] dark:border-slate-800">
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Test against sample text:
                        </label>
                        <input
                          type="text"
                          value={testText}
                          onChange={(e) => setTestText(e.target.value)}
                          placeholder="Type text to test pattern matching..."
                          className="w-full p-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-black/40 text-[#282828] dark:text-white mb-1 focus:ring-1 focus:ring-[#36755a] focus:outline-none placeholder:text-[#a89984]"
                        />
                        <div className="text-[11px] mt-1 font-medium">
                          {!testText.trim() ? (
                            <span className="text-[#a89984]">
                              Enter sample text above to verify pattern trigger
                            </span>
                          ) : testMatch ? (
                            <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> Pattern match detected: &ldquo;{formBanned}&rdquo;
                            </span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Clean: No match found in sample text
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Examples */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Good Example:</label>
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={formGoodExample}
                        onChange={(e) => setFormGoodExample(e.target.value)}
                        placeholder="e.g. Deploy with AcmeCloud"
                        className="w-full p-2 text-xs rounded-lg border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Bad Example:</label>
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={formBadExample}
                        onChange={(e) => setFormBadExample(e.target.value)}
                        placeholder="e.g. Deploy with Acme Cloud"
                        className="w-full p-2 text-xs rounded-lg border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                      />
                    </div>
                  </div>

                  {/* Severity & Active */}
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Default Severity</label>
                      <select
                        disabled={!isAdmin}
                        value={formSeverity}
                        onChange={(e) => setFormSeverity(e.target.value as Severity)}
                        className="w-full p-2 text-xs rounded-lg border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100 capitalize disabled:bg-slate-100 dark:disabled:bg-slate-800"
                      >
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>

                    <div className="pt-4">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={formIsActive}
                          onChange={(e) => setFormIsActive(e.target.checked)}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 dark:border-white/20"
                        />
                        <span className="font-bold text-slate-800 dark:text-slate-200">Rule Active in Checks</span>
                      </label>
                    </div>
                  </div>

                  {/* Change note for version increment */}
                  {isAdmin && (
                    <div className="pt-2 border-t border-[#ded9ce] dark:border-slate-800">
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Change Note (Recorded in Audit Trail):
                      </label>
                      <input
                        type="text"
                        value={changeNote}
                        onChange={(e) => setChangeNote(e.target.value)}
                        placeholder="e.g. Updated wording to clarify SLA threshold"
                        className="w-full p-2.5 text-xs rounded-xl border border-slate-300/80 dark:border-slate-700 bg-white dark:bg-[#1d2021] text-[#282828] dark:text-slate-100"
                      />
                    </div>
                  )}
                </form>
              ) : (
                /* Version History */
                <div className="space-y-3">
                  <div className="text-xs text-[#706860] dark:text-[#a89984]">
                    Audit snapshots preserved for {selectedEntry?.code}:
                  </div>
                  {versions.map((ver) => (
                    <div key={ver.id} className="p-3.5 bg-[#edeae1]/60 dark:bg-[#1d2021]/50 rounded-2xl border border-[#ded9ce]/80 dark:border-slate-800 space-y-1">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="font-bold text-[#282828] dark:text-slate-100">Version {ver.version}</span>
                        <span className="text-[#a89984]">{new Date(ver.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{ver.change_note}</div>
                      <div className="text-[11px] text-[#706860] dark:text-[#a89984]">Changed by {ver.changed_by_name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Panel Footer */}
            {isAdmin && editorTab === 'details' && (
              <div className="p-4 border-t border-[#ded9ce] dark:border-slate-800 bg-[#edeae1]/60 dark:bg-[#1d2021]/50 flex items-center justify-end gap-3 font-sans">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-[#282828] text-[#4a4440] dark:text-[#ebdbb2] hover:bg-[#edeae1] dark:hover:bg-[#32302f] text-xs font-sans font-semibold cursor-pointer shadow-2xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="entry-editor-form"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-xl font-sans font-semibold bg-[#1d6f7a] hover:bg-[#15545c] text-white dark:bg-[#4ea8a0] dark:text-[#1d2021] dark:hover:bg-[#5ab8ad] text-xs cursor-pointer shadow-xs active:translate-y-[1px] disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Rule Version'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* S16 Guideline Import Modal */}
      {isImportModalOpen && (
        <div
          className="fixed inset-0 z-50 overflow-hidden bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-100 font-sans"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#282828] rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-[#e2ded5] dark:border-[#3c3836] space-y-4 max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-100 font-sans text-xs">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#e2ded5] dark:border-[#3c3836]">
              <div>
                <h3 className="text-lg font-serif font-bold text-[#282828] dark:text-[#fbf1c7] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[#1d6f7a] dark:text-[#4ea8a0]" />
                  <span>Guideline Policy Ingestion</span>
                </h3>
                <p className="text-xs font-sans text-[#706860] dark:text-[#a89984] mt-0.5">
                  Paste unstructured brand policy text to parse proposed rules. Confirm each before committing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-[#a89984] hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {proposedRules.length === 0 ? (
              <div className="space-y-3">
                <textarea
                  rows={7}
                  placeholder="Paste excerpt from your brand guidelines PDF or wiki...&#10;e.g. Always write AcmeCloud as one word. Never guarantee zero downtime without an approved SLA. Avoid alarmist competitor comparisons."
                  value={rawImportText}
                  onChange={(e) => setRawImportText(e.target.value)}
                  className="w-full text-xs p-3 rounded-lg border border-slate-300 dark:border-white/10 bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#36755a] leading-relaxed font-mono"
                />
                <button
                  type="button"
                  disabled={isParsingImport || !rawImportText.trim()}
                  onClick={async () => {
                    setIsParsingImport(true);
                    try {
                      const proposals = await api.previewGuidelineImport(rawImportText);
                      setProposedRules(proposals);
                    } catch (err: unknown) {
                      pushToast({ title: 'Import preview failed', type: 'error' });
                    } finally {
                      setIsParsingImport(false);
                    }
                  }}
                  className="w-full py-2.5 rounded-lg bg-[#282828] dark:bg-white text-white dark:text-slate-950 text-xs font-bold disabled:opacity-50 transition-all shadow-xs cursor-pointer active:translate-y-[1px]"
                >
                  {isParsingImport ? 'EXTRACTING...' : 'PARSE & PROPOSE BRAND RULES'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                  Review Proposed Rules [{proposedRules.length}]:
                </div>
                {proposedRules.map((prop) => (
                  <div key={prop.temp_id} className="p-3 bg-[#edeae1]/60 dark:bg-[#1d2021] rounded-lg border border-[#e2ded5] dark:border-[#3c3836] text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-blue-500">{prop.code}</span>
                      <span className="capitalize text-[#a89984] font-semibold">{prop.category}</span>
                    </div>
                    <div className="font-bold text-[#282828] dark:text-white">{prop.title}</div>
                    <p className="text-slate-600 dark:text-[#a89984] font-sans">{prop.body}</p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setProposedRules((prev) =>
                            prev.map((p) => (p.temp_id === prop.temp_id ? { ...p, decision: 'accepted' } : p))
                          );
                        }}
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                          prop.decision === 'accepted'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white dark:bg-white/10 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        ACCEPT
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setProposedRules((prev) =>
                            prev.map((p) => (p.temp_id === prop.temp_id ? { ...p, decision: 'rejected' } : p))
                          );
                        }}
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                          prop.decision === 'rejected'
                            ? 'bg-rose-600 text-white'
                            : 'bg-white dark:bg-white/10 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        REJECT
                      </button>
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between pt-3 border-t border-[#e2ded5] dark:border-[#3c3836]">
                  <button
                    type="button"
                    onClick={() => setProposedRules([])}
                    className="text-xs text-[#706860] hover:text-[#282828] dark:hover:text-white underline cursor-pointer"
                  >
                    Paste different text
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!user) return;
                      const acceptedOnes = proposedRules.filter((p) => p.decision === 'accepted');
                      for (const acc of acceptedOnes) {
                        await api.saveLibraryEntry(
                          user,
                          {
                            code: acc.code,
                            entry_type: acc.entry_type,
                            category: acc.category,
                            title: acc.title,
                            body: acc.body,
                            check_mode: acc.check_mode,
                            severity_default: acc.severity_default,
                            is_active: true,
                          },
                          'Imported via Guideline Ingestion'
                        );
                      }
                      incrementLibraryVersion();
                      pushToast({
                        title: `Imported ${acceptedOnes.length} brand entries`,
                        type: 'success',
                      });
                      setIsImportModalOpen(false);
                      loadEntries();
                    }}
                    className="px-4 py-2.5 rounded-xl bg-[#1d6f7a] hover:bg-[#15545c] dark:bg-[#4ea8a0] dark:hover:bg-[#5ab8ad] text-white dark:text-[#1d2021] text-xs font-sans font-semibold transition-all shadow-xs cursor-pointer active:translate-y-[1px]"
                  >
                    Save Confirmed Rules
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toggle Active Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(toggleConfirmEntry)}
        title={toggleConfirmEntry?.target ? `Activate ${toggleConfirmEntry?.code}?` : `Deactivate ${toggleConfirmEntry?.code}?`}
        consequence={
          toggleConfirmEntry?.target
            ? 'Activating this rule will enforce it across all subsequent content evaluations.'
            : 'Deactivating this rule removes it from future checks. Past checks referencing this rule will preserve their immutable audit snapshot.'
        }
        confirmLabel={toggleConfirmEntry?.target ? 'Activate Rule' : 'Deactivate Rule'}
        confirmVariant={toggleConfirmEntry?.target ? 'primary' : 'danger'}
        onConfirm={handleToggleActiveConfirm}
        onCancel={() => setToggleConfirmEntry(null)}
      />
    </div>
  );
};
