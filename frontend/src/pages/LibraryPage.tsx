// src/pages/LibraryPage.tsx
import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  FileCode,
  Sparkles,
  Cpu,
  History,
  X,
  RotateCcw,
  UploadCloud,
  Check,
  AlertCircle,
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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Brand Library</h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200">
              Lib v{libraryVersion}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            The single source of truth for brand rules, verified facts, terminology, and claim policies.
          </p>
        </div>

        {isAdmin ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors shadow-xs"
            >
              <UploadCloud className="w-4 h-4 text-slate-500" />
              <span>AI Guideline Import</span>
            </button>
            <button
              type="button"
              onClick={handleSeedDemoKit}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors shadow-xs"
            >
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Seed Demo Kit</span>
            </button>
            <button
              type="button"
              onClick={() => openEditor()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Add Entry</span>
            </button>
          </div>
        ) : (
          <span className="text-xs text-slate-500 italic">Read-only view for {user?.role}</span>
        )}
      </div>

      {error && <InlineAlert title="Error loading library" message={error} onRetry={loadEntries} />}

      {/* Tabs by Type */}
      <div className="flex items-center border-b border-slate-200 gap-6 text-sm">
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
            className={`pb-2.5 font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search rules by code, title, or body..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
        </div>

        {/* Category & Status Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 capitalize focus:outline-none focus:ring-2 focus:ring-indigo-600"
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
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
      </div>

      {/* Library Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
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
              : 'Your Brand Library is empty.'
          }
          actionLabel={isAdmin ? 'Add First Entry' : undefined}
          onAction={isAdmin ? () => openEditor() : undefined}
          secondaryActionLabel={isAdmin && !entries.length ? 'Seed Demo Kit' : undefined}
          onSecondaryAction={isAdmin && !entries.length ? handleSeedDemoKit : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3">Code</th>
                <th scope="col" className="px-4 py-3">Title & Rule Summary</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3">Check Mode</th>
                <th scope="col" className="px-4 py-3">Severity</th>
                <th scope="col" className="px-4 py-3">Ver.</th>
                <th scope="col" className="px-4 py-3">Active</th>
                <th scope="col" className="px-4 py-3 text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-normal">
              {filteredEntries.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => openEditor(entry)}
                  className={`hover:bg-slate-50/80 cursor-pointer transition-colors ${
                    !entry.is_active ? 'opacity-60 bg-slate-50/50' : ''
                  }`}
                >
                  {/* Code */}
                  <td className="px-4 py-3 font-mono font-bold text-indigo-700 whitespace-nowrap">
                    {entry.code}
                  </td>

                  {/* Title & Body */}
                  <td className="px-4 py-3 max-w-sm">
                    <div className="font-semibold text-slate-900">{entry.title}</div>
                    <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{entry.body}</div>
                  </td>

                  {/* Category */}
                  <td className="px-4 py-3 whitespace-nowrap capitalize text-slate-600">
                    {entry.category.replace('_', ' ')}
                  </td>

                  {/* Check Mode */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {entry.check_mode === 'deterministic' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-700">
                        <Cpu className="w-3.5 h-3.5 text-slate-500" />
                        <span>Rule Engine</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-purple-700 font-medium">
                        <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                        <span>AI Pass</span>
                      </span>
                    )}
                  </td>

                  {/* Severity */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <SeverityTag severity={entry.severity_default} />
                  </td>

                  {/* Version */}
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-500 font-semibold">
                    v{entry.current_version}
                  </td>

                  {/* Active Toggle (Admin) */}
                  <td
                    className="px-4 py-3 whitespace-nowrap"
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
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                          entry.is_active
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-300'
                        }`}
                      >
                        {entry.is_active ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Active</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 text-slate-400" />
                            <span>Inactive</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-slate-500 font-medium">{entry.is_active ? 'Active' : 'Inactive'}</span>
                    )}
                  </td>

                  {/* Updated */}
                  <td className="px-4 py-3 whitespace-nowrap text-right text-slate-500 text-[11px] font-mono">
                    {new Date(entry.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* S09 Library Entry Editor Side Panel */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200">
            {/* Panel Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedEntry ? `Edit ${selectedEntry.code}` : 'Add Brand Rule Entry'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isAdmin ? 'Edits increment the organization library version' : 'Read-only view'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Close panel"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Panel Tabs */}
            <div className="flex border-b border-slate-200 bg-white px-4 text-xs">
              <button
                type="button"
                onClick={() => setEditorTab('details')}
                className={`py-2.5 px-3 font-semibold border-b-2 -mb-px transition-colors ${
                  editorTab === 'details'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Rule Details
              </button>
              {selectedEntry && (
                <button
                  type="button"
                  onClick={() => setEditorTab('history')}
                  className={`py-2.5 px-3 font-semibold border-b-2 -mb-px transition-colors ${
                    editorTab === 'history'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Version History ({versions.length})
                </button>
              )}
            </div>

            {/* Panel Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {editorError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 font-medium">
                  {editorError}
                </div>
              )}

              {editorTab === 'details' ? (
                <form onSubmit={handleSaveEntry} id="entry-editor-form" className="space-y-4">
                  {/* Code & Category */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Rule Code <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={formCode}
                        onChange={(e) => setFormCode(e.target.value)}
                        placeholder="e.g. R-TERM-005"
                        className="w-full p-2 font-mono text-xs rounded border border-slate-300 uppercase disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Entry Type</label>
                      <select
                        disabled={!isAdmin}
                        value={formType}
                        onChange={(e) => setFormType(e.target.value as EntryType)}
                        className="w-full p-2 text-xs rounded border border-slate-300 capitalize disabled:bg-slate-100"
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
                      <label className="block font-semibold text-slate-700 mb-1">Category</label>
                      <select
                        disabled={!isAdmin}
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value as EntryCategory)}
                        className="w-full p-2 text-xs rounded border border-slate-300 capitalize disabled:bg-slate-100"
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
                      <label className="block font-semibold text-slate-700 mb-1">Check Mode</label>
                      <select
                        disabled={!isAdmin}
                        value={formCheckMode}
                        onChange={(e) => setFormCheckMode(e.target.value as CheckMode)}
                        className="w-full p-2 text-xs rounded border border-slate-300 disabled:bg-slate-100"
                      >
                        <option value="deterministic">Deterministic (Rule Engine)</option>
                        <option value="llm">AI Evaluated (LLM Pass)</option>
                      </select>
                    </div>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Rule Title <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g. Product Name Formatting"
                      className="w-full p-2 text-xs rounded border border-slate-300 disabled:bg-slate-100"
                    />
                  </div>

                  {/* Body / Policy */}
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Rule Body & Description <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      rows={3}
                      disabled={!isAdmin}
                      value={formBody}
                      onChange={(e) => setFormBody(e.target.value)}
                      placeholder="Explain the brand policy and why deviations are flagged..."
                      className="w-full p-2 text-xs rounded border border-slate-300 leading-relaxed disabled:bg-slate-100"
                    />
                  </div>

                  {/* Pattern fields for deterministic rules */}
                  {formCheckMode === 'deterministic' && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                      <div className="font-semibold text-slate-800">Deterministic Pattern Matching:</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-0.5">Banned Word / Phrase:</label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={formBanned}
                            onChange={(e) => setFormBanned(e.target.value)}
                            placeholder="e.g. Acme Cloud"
                            className="w-full p-1.5 text-xs rounded border border-slate-300 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-0.5">Preferred Replacement:</label>
                          <input
                            type="text"
                            disabled={!isAdmin}
                            value={formPreferred}
                            onChange={(e) => setFormPreferred(e.target.value)}
                            placeholder="e.g. AcmeCloud"
                            className="w-full p-1.5 text-xs rounded border border-slate-300 bg-white"
                          />
                        </div>
                      </div>

                      {/* Interactive Live Playground */}
                      <div className="pt-2 border-t border-slate-200">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Test against sample text:
                        </label>
                        <input
                          type="text"
                          value={testText}
                          onChange={(e) => setTestText(e.target.value)}
                          placeholder="Type text to test pattern matching..."
                          className="w-full p-1.5 text-xs rounded border border-slate-300 bg-white mb-1 focus:ring-2 focus:ring-indigo-600 focus:outline-none placeholder:text-slate-400"
                        />
                        <div className="text-[11px]">
                          {!testText.trim() ? (
                            <span className="text-slate-400">
                              Enter sample text above to verify pattern trigger
                            </span>
                          ) : testMatch ? (
                            <span className="text-rose-600 font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> Pattern match detected: &ldquo;{formBanned}&rdquo;
                            </span>
                          ) : (
                            <span className="text-emerald-700 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> No match found in sample text
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Examples */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Good Example:</label>
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={formGoodExample}
                        onChange={(e) => setFormGoodExample(e.target.value)}
                        placeholder="e.g. Deploy with AcmeCloud"
                        className="w-full p-1.5 text-xs rounded border border-slate-300 disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Bad Example:</label>
                      <input
                        type="text"
                        disabled={!isAdmin}
                        value={formBadExample}
                        onChange={(e) => setFormBadExample(e.target.value)}
                        placeholder="e.g. Deploy with Acme Cloud"
                        className="w-full p-1.5 text-xs rounded border border-slate-300 disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  {/* Severity & Active */}
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Default Severity</label>
                      <select
                        disabled={!isAdmin}
                        value={formSeverity}
                        onChange={(e) => setFormSeverity(e.target.value as Severity)}
                        className="w-full p-2 text-xs rounded border border-slate-300 capitalize disabled:bg-slate-100"
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
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300"
                        />
                        <span className="font-semibold text-slate-800">Rule Active in Checks</span>
                      </label>
                    </div>
                  </div>

                  {/* Change note for version increment */}
                  {isAdmin && (
                    <div className="pt-2 border-t border-slate-200">
                      <label className="block font-semibold text-slate-700 mb-1">
                        Change Note (Recorded in Audit Trail):
                      </label>
                      <input
                        type="text"
                        value={changeNote}
                        onChange={(e) => setChangeNote(e.target.value)}
                        placeholder="e.g. Updated wording to clarify SLA threshold"
                        className="w-full p-2 text-xs rounded border border-slate-300"
                      />
                    </div>
                  )}
                </form>
              ) : (
                /* Version History */
                <div className="space-y-3">
                  <div className="text-xs text-slate-500">
                    Audit snapshots preserved for {selectedEntry?.code}:
                  </div>
                  {versions.map((ver) => (
                    <div key={ver.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="font-bold text-slate-900">Version {ver.version}</span>
                        <span className="text-slate-400">{new Date(ver.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="font-medium text-slate-800">{ver.change_note}</div>
                      <div className="text-[11px] text-slate-500">Changed by {ver.changed_by_name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Panel Footer */}
            {isAdmin && editorTab === 'details' && (
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="entry-editor-form"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs"
                >
                  {isSaving ? 'Saving...' : 'Save New Version'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* S16 Guideline Import Modal */}
      {isImportModalOpen && (
        <div
          className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  <span>AI-Assisted Guideline Import (L2)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Paste unstructured brand policy text to generate proposed rules. Confirm each rule before saving.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {proposedRules.length === 0 ? (
              <div className="space-y-3">
                <textarea
                  rows={6}
                  placeholder="Paste excerpt from your brand guidelines PDF or wiki...&#10;e.g. Always write AcmeCloud as one word. Never guarantee zero downtime without an approved SLA. Avoid alarmist competitor comparisons."
                  value={rawImportText}
                  onChange={(e) => setRawImportText(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600 leading-relaxed"
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
                  className="w-full py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isParsingImport ? 'Extracting rules...' : 'Parse & Propose Brand Rules'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-800">
                  Review Proposed Brand Rules ({proposedRules.length}):
                </div>
                {proposedRules.map((prop) => (
                  <div key={prop.temp_id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-indigo-700">{prop.code}</span>
                      <span className="capitalize text-slate-500 font-medium">{prop.category}</span>
                    </div>
                    <div className="font-semibold text-slate-900">{prop.title}</div>
                    <p className="text-slate-600 leading-relaxed">{prop.body}</p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setProposedRules((prev) =>
                            prev.map((p) => (p.temp_id === prop.temp_id ? { ...p, decision: 'accepted' } : p))
                          );
                        }}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                          prop.decision === 'accepted'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setProposedRules((prev) =>
                            prev.map((p) => (p.temp_id === prop.temp_id ? { ...p, decision: 'rejected' } : p))
                          );
                        }}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                          prop.decision === 'rejected'
                            ? 'bg-rose-600 text-white'
                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setProposedRules([])}
                    className="text-xs text-slate-600 underline font-medium"
                  >
                    Paste different guidelines
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
                          'Imported via L2 Guideline Import'
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
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                  >
                    Save Confirmed Entries
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
            ? 'Activating this rule will include it in all future brand checks across the organisation.'
            : 'Deactivating this rule means future checks will ignore it. Prior check runs that referenced this rule will retain their immutable citation snapshot.'
        }
        confirmLabel={toggleConfirmEntry?.target ? 'Activate Rule' : 'Deactivate Rule'}
        confirmVariant={toggleConfirmEntry?.target ? 'primary' : 'danger'}
        onConfirm={handleToggleActiveConfirm}
        onCancel={() => setToggleConfirmEntry(null)}
      />
    </div>
  );
};
