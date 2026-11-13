// src/pages/LoginPage.tsx
import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  ShieldAlert,
  Building2,
  Lock,
  Mail,
  User,
  KeyRound,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types/domain';
import { api } from '../services/api';
import { isSupabaseAuthEnabled } from '../services/supabase';
import { DhrishyamLogo } from '../components/shared/DhrishyamLogo';
import { ThemeToggle } from '../components/layout/ThemeToggle';

export const LoginPage: React.FC = () => {
  const { user, login, loginAsRole, registerBrand, currentRoute, navigate } = useApp();

  // Active tab: 'login' | 'register'
  const [activeTab, setActiveTab] = useState<'login' | 'register'>(
    () => (typeof window !== 'undefined' && window.location.hash === '#register' ? 'register' : 'login')
  );

  // Sign In form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Register Brand form state
  const [brandName, setBrandName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [seedRules, setSeedRules] = useState(true);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // Synchronize hash with active tab
  useEffect(() => {
    if (window.location.hash === '#register' || currentRoute === 'register') {
      setActiveTab('register');
    } else {
      setActiveTab('login');
    }
  }, [currentRoute]);

  const handleTabSwitch = (tab: 'login' | 'register') => {
    setActiveTab(tab);
    setErrorMsg(null);
    setErrorStatus(null);
    setRegError(null);
    if (tab === 'register') {
      navigate('register');
    } else {
      navigate('login');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both your work email and password.');
      setErrorStatus(null);
      return;
    }
    setErrorMsg(null);
    setErrorStatus(null);
    setIsLoading(true);

    const result = await login(email.trim(), password);
    setIsLoading(false);

    if (!result.success) {
      if (result.error?.includes('401') || result.error?.toLowerCase().includes('invalid')) {
        setErrorStatus(401);
      } else if (result.error?.includes('403') || result.error?.toLowerCase().includes('forbidden')) {
        setErrorStatus(403);
      } else {
        setErrorStatus(null);
      }
      setErrorMsg(result.error || 'Invalid work email or password. Please try again.');
    }
  };

  const handleDemoQuickLogin = (role: Role) => {
    if (loginAsRole) {
      loginAsRole(role);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName.trim() || !adminName.trim() || !adminEmail.trim() || !regPassword.trim()) {
      setRegError('All fields marked with an asterisk are required.');
      return;
    }
    if (regPassword.length < 8) {
      setRegError('Password must be at least 8 characters long for offline security.');
      return;
    }
    if (regPassword !== confirmPassword) {
      setRegError('Passwords do not match. Please re-enter carefully.');
      return;
    }

    setRegError(null);
    setRegLoading(true);

    if (registerBrand) {
      const result = await registerBrand({
        brand_name: brandName.trim(),
        admin_name: adminName.trim(),
        admin_email: adminEmail.trim(),
        password: regPassword,
        seed_default_rules: seedRules,
      });
      setRegLoading(false);
      if (!result.success) {
        setRegError(result.error || 'Failed to register brand organization.');
      }
    } else {
      setRegLoading(false);
      setRegError('Brand registration service is currently unavailable.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 relative z-10 transition-colors">
      {/* Top bar controls */}
      <div className="absolute top-6 inset-x-6 z-20 flex items-center justify-between pointer-events-none">
        <div>
          {user ? (
            <button
              type="button"
              onClick={() => navigate(user.role === 'reviewer' ? 'review-queue' : 'my-content')}
              className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-sans font-semibold text-[#1d6f7a] dark:text-[#4ea8a0] bg-white dark:bg-[#282828] border border-[#ded9ce] dark:border-[#3c3836] hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-all cursor-pointer shadow-2xs tap-interactive"
              title="Return to your workspace console"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Return to {user.org_name || 'Workspace'}</span>
            </button>
          ) : <div />}
        </div>
        <div className="pointer-events-auto">
          <ThemeToggle showLabel />
        </div>
      </div>

      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Column: Brand Header & Auth Terminal */}
        <div className="lg:col-span-6 flex flex-col items-center sm:items-start text-center sm:text-left">
          <div className="flex flex-col items-center sm:items-start mb-6">
            <DhrishyamLogo size="lg" showWordmark={false} />
            <h1 className="mt-4 text-3xl sm:text-4xl font-serif font-bold tracking-tight text-[#282828] dark:text-[#fbf1c7]">
              Dhrishyam
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-sans text-[#706860] dark:text-[#a89984]">
              Brand & Editorial Governance Platform
            </p>
          </div>

          <div className="w-full">
            <div className="bg-white dark:bg-[#282828] py-7 px-6 sm:px-8 shadow-sm border border-[#e2ded5] dark:border-[#3c3836] rounded-3xl transition-colors">
              {/* Segmented Tab Bar */}
              <div className="flex p-1 bg-[#edeae1] dark:bg-[#1d2021] rounded-2xl mb-6 border border-[#ded9ce] dark:border-[#3c3836]" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'login'}
                  onClick={() => handleTabSwitch('login')}
                  className={`flex-1 py-2 text-xs font-sans font-semibold rounded-xl transition-all cursor-pointer text-center ${
                    activeTab === 'login'
                      ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-[#fbf1c7] shadow-xs'
                      : 'text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'register'}
                  onClick={() => handleTabSwitch('register')}
                  className={`flex-1 py-2 text-xs font-sans font-semibold rounded-xl transition-all cursor-pointer text-center ${
                    activeTab === 'register'
                      ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-[#fbf1c7] shadow-xs'
                      : 'text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                  }`}
                >
                  Register Organization
                </button>
              </div>

              {/* TAB 1: SIGN IN */}
              {activeTab === 'login' && (
                <div>
                  {/* Contextual Error Banners */}
                  {errorStatus === 401 && (
                    <div
                      role="alert"
                      className="mb-4 p-3.5 rounded-2xl bg-[#af3a03]/10 border border-[#af3a03]/25 flex items-start gap-2.5 text-xs text-[#af3a03] dark:text-[#fe8019] leading-relaxed font-sans"
                    >
                      <AlertCircle className="w-4 h-4 text-[#af3a03] dark:text-[#fe8019] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Invalid credentials:</span> Email or passphrase does not match. Select a pre-authorized profile below to test instantly.
                      </div>
                    </div>
                  )}

                  {errorStatus === 403 && (
                    <div
                      role="alert"
                      className="mb-4 p-3.5 rounded-2xl bg-[#a8231b]/10 border border-[#a8231b]/25 flex items-start gap-2.5 text-xs text-[#a8231b] dark:text-[#fb4934] leading-relaxed font-sans"
                    >
                      <ShieldAlert className="w-4 h-4 text-[#a8231b] dark:text-[#fb4934] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Access restricted:</span> This account is not assigned to this workspace.
                      </div>
                    </div>
                  )}

                  {!errorStatus && errorMsg && (
                    <div
                      role="alert"
                      className="mb-4 p-3.5 rounded-2xl bg-[#a8231b]/10 border border-[#a8231b]/25 text-xs text-[#a8231b] dark:text-[#fb4934] leading-relaxed font-sans"
                    >
                      {errorMsg}
                    </div>
                  )}

                  <form onSubmit={handleLoginSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="login-email" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                        Work Email Address
                      </label>
                      <div className="relative mt-1">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#706860] dark:text-[#a89984]">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input
                          id="login-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="operator@acme-cloud.io"
                          autoComplete="email"
                          required
                          className="w-full text-xs font-sans p-3 pl-10 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] placeholder:text-[#706860] dark:placeholder:text-[#a89984] transition-colors"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="login-password" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                          Passphrase
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="text-[11px] font-sans font-medium text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2] cursor-pointer"
                        >
                          {showPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <div className="relative mt-1">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#706860] dark:text-[#a89984]">
                          <Lock className="w-4 h-4" />
                        </div>
                        <input
                          id="login-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••••••"
                          autoComplete="current-password"
                          required
                          className="w-full text-xs font-sans p-3 pl-10 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] placeholder:text-[#706860] dark:placeholder:text-[#a89984] transition-colors"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold text-white dark:text-[#282828] bg-[#282828] dark:bg-[#edeae1] hover:bg-[#3c3836] dark:hover:bg-white transition-all cursor-pointer shadow-xs disabled:opacity-50 active:scale-[0.99]"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Verifying Credentials...</span>
                        </>
                      ) : (
                        <>
                          <span>Sign In to Console</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>

                  {/* Pre-Authorized Hardware Profiles (Demo Logins): only without real sign-in */}
                  {!isSupabaseAuthEnabled && (
                  <div className="mt-6 pt-5 border-t border-[#ded9ce]/60 dark:border-[#3c3836]">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-[#706860] dark:text-[#a89984]">
                        Quick Sign-In Profiles
                      </span>
                      <span className="text-[10px] font-sans font-medium px-2 py-0.5 rounded-md bg-[#edeae1] dark:bg-[#1d2021] text-[#4a4440] dark:text-[#a89984] border border-[#ded9ce] dark:border-[#3c3836]">
                        Acme Cloud
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleDemoQuickLogin('creator')}
                        className="flex flex-col items-center justify-center p-3 rounded-2xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021]/60 hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-all text-center cursor-pointer group tap-interactive"
                      >
                        <div className="w-8 h-8 rounded-full bg-[#35656d]/15 text-[#35656d] dark:text-[#83a598] flex items-center justify-center font-bold text-xs mb-1 group-hover:scale-105 transition-transform font-sans">
                          A
                        </div>
                        <span className="text-xs font-sans font-semibold text-[#282828] dark:text-[#fbf1c7]">Aarav</span>
                        <span className="text-[10px] font-sans font-medium text-[#35656d] dark:text-[#83a598] mt-0.5">
                          Creator
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDemoQuickLogin('reviewer')}
                        className="flex flex-col items-center justify-center p-3 rounded-2xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021]/60 hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-all text-center cursor-pointer group tap-interactive"
                      >
                        <div className="w-8 h-8 rounded-full bg-[#627520]/15 text-[#627520] dark:text-[#b8bb26] flex items-center justify-center font-bold text-xs mb-1 group-hover:scale-105 transition-transform font-sans">
                          P
                        </div>
                        <span className="text-xs font-sans font-semibold text-[#282828] dark:text-[#fbf1c7]">Priya</span>
                        <span className="text-[10px] font-sans font-medium text-[#627520] dark:text-[#b8bb26] mt-0.5">
                          Reviewer
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDemoQuickLogin('admin')}
                        className="flex flex-col items-center justify-center p-3 rounded-2xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021]/60 hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-all text-center cursor-pointer group tap-interactive"
                      >
                        <div className="w-8 h-8 rounded-full bg-[#af3a03]/15 text-[#af3a03] dark:text-[#fe8019] flex items-center justify-center font-bold text-xs mb-1 group-hover:scale-105 transition-transform font-sans">
                          K
                        </div>
                        <span className="text-xs font-sans font-semibold text-[#282828] dark:text-[#fbf1c7]">Kabir</span>
                        <span className="text-[10px] font-sans font-medium text-[#af3a03] dark:text-[#fe8019] mt-0.5">
                          Admin
                        </span>
                      </button>
                    </div>

                    <div className="mt-3.5 pt-2.5 border-t border-[#ded9ce]/40 dark:border-[#3c3836]/40 flex items-center justify-between text-[11px] font-sans text-[#706860] dark:text-[#a89984]">
                      <span>Reset Workspace</span>
                      <button
                        type="button"
                        onClick={() => {
                          api.resetDemoData();
                          alert('Demo workspace data reset successfully to initial state.');
                        }}
                        className="text-[#36755a] dark:text-[#8ec07c] hover:underline cursor-pointer font-medium"
                      >
                        Reset Demo Environment
                      </button>
                    </div>
                  </div>
                  )}
                </div>
              )}

              {/* TAB 2: REGISTER BRAND */}
              {activeTab === 'register' && (
                <div>
                  {regError && (
                    <div
                      role="alert"
                      className="mb-4 p-3.5 rounded-2xl bg-[#a8231b]/10 border border-[#a8231b]/25 text-xs text-[#a8231b] dark:text-[#fb4934] leading-relaxed font-sans"
                    >
                      {regError}
                    </div>
                  )}

                  <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                    <div>
                      <label htmlFor="reg-brand-name" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                        Brand / Enterprise Name <span className="text-[#a8231b] dark:text-[#fb4934]">*</span>
                      </label>
                      <div className="relative mt-1">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#706860] dark:text-[#a89984]">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <input
                          id="reg-brand-name"
                          type="text"
                          value={brandName}
                          onChange={(e) => setBrandName(e.target.value)}
                          placeholder="Nexus Dynamics"
                          required
                          className="w-full text-xs font-sans p-2.5 pl-10 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] placeholder:text-[#706860] dark:placeholder:text-[#a89984] transition-colors"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="reg-admin-name" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                        Lead Governance Officer Name <span className="text-[#a8231b] dark:text-[#fb4934]">*</span>
                      </label>
                      <div className="relative mt-1">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#706860] dark:text-[#a89984]">
                          <User className="w-4 h-4" />
                        </div>
                        <input
                          id="reg-admin-name"
                          type="text"
                          value={adminName}
                          onChange={(e) => setAdminName(e.target.value)}
                          placeholder="Devina Mehta"
                          required
                          className="w-full text-xs font-sans p-2.5 pl-10 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] placeholder:text-[#706860] dark:placeholder:text-[#a89984] transition-colors"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="reg-admin-email" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                        Work Email <span className="text-[#a8231b] dark:text-[#fb4934]">*</span>
                      </label>
                      <div className="relative mt-1">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#706860] dark:text-[#a89984]">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input
                          id="reg-admin-email"
                          type="email"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          placeholder="devina@nexusdynamics.io"
                          required
                          className="w-full text-xs font-sans p-2.5 pl-10 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] placeholder:text-[#706860] dark:placeholder:text-[#a89984] transition-colors"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="reg-password" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                          Admin Passphrase (8+ chars) <span className="text-[#a8231b] dark:text-[#fb4934]">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowRegPassword(!showRegPassword)}
                          className="text-[11px] font-sans font-medium text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2] cursor-pointer"
                        >
                          {showRegPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <div className="relative mt-1">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#706860] dark:text-[#a89984]">
                          <KeyRound className="w-4 h-4" />
                        </div>
                        <input
                          id="reg-password"
                          type={showRegPassword ? 'text' : 'password'}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="••••••••••••"
                          required
                          className="w-full text-xs font-sans p-2.5 pl-10 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] placeholder:text-[#706860] dark:placeholder:text-[#a89984] transition-colors"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="reg-confirm-password" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1]">
                        Confirm Passphrase <span className="text-[#a8231b] dark:text-[#fb4934]">*</span>
                      </label>
                      <div className="relative mt-1">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#706860] dark:text-[#a89984]">
                          <Lock className="w-4 h-4" />
                        </div>
                        <input
                          id="reg-confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••••••"
                          required
                          className="w-full text-xs font-sans p-2.5 pl-10 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] placeholder:text-[#706860] dark:placeholder:text-[#a89984] transition-colors"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        id="seed-rules-checkbox"
                        type="checkbox"
                        checked={seedRules}
                        onChange={(e) => setSeedRules(e.target.checked)}
                        className="rounded border-[#ded9ce] dark:border-[#3c3836] text-[#36755a] focus:ring-[#36755a]"
                      />
                      <label htmlFor="seed-rules-checkbox" className="text-xs text-[#706860] dark:text-[#a89984] font-sans">
                        Seed standard baseline rules (claims, accuracy, compliance)
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={regLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold text-white dark:text-[#282828] bg-[#282828] dark:bg-[#edeae1] hover:bg-[#3c3836] dark:hover:bg-white transition-all cursor-pointer shadow-xs disabled:opacity-50 active:scale-[0.99]"
                    >
                      {regLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Setting Up Organization...</span>
                        </>
                      ) : (
                        <>
                          <span>Register Organization & Admin</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Bento Grid Editorial Showcase (inspired by bentogrids.com) */}
        <div className="hidden lg:flex lg:col-span-6 flex-col gap-4">
          {/* Bento Hero Card */}
          <div className="bento-card p-7">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-[#627520] dark:text-[#b8bb26] px-2.5 py-1 rounded-full bg-[#627520]/10 dark:bg-[#b8bb26]/15 border border-[#627520]/25 dark:border-[#b8bb26]/30">
                Editorial Standard
              </span>
              <span className="text-xs font-sans text-[#706860] dark:text-[#a89984]">
                Continuous Auditing
              </span>
            </div>
            <h2 className="text-2xl font-serif font-bold text-[#282828] dark:text-[#fbf1c7]">
              Deterministic & LLM Brand Guardrails
            </h2>
            <p className="mt-2 text-sm font-sans text-[#504945] dark:text-[#a89984] leading-relaxed">
              Every draft is automatically checked against organization-defined terminology, claim evidence benchmarks, and tone parameters before entering peer review.
            </p>

            <div className="mt-5 p-4 rounded-2xl bg-[#edeae1] dark:bg-[#1d2021] border border-[#ded9ce] dark:border-[#3c3836] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-[#627520] dark:bg-[#b8bb26] animate-pulse" />
                <span className="font-sans text-xs font-semibold text-[#282828] dark:text-[#ebdbb2]">
                  Pre-Publication Governance Gate
                </span>
              </div>
              <span className="text-[11px] font-sans text-[#627520] dark:text-[#b8bb26] font-bold">
                Deterministic First
              </span>
            </div>
          </div>

          {/* Subgrid of 2 Bento Tiles */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bento-card p-6 flex flex-col justify-between">
              <div className="p-2.5 rounded-2xl bg-[#35656d]/15 text-[#35656d] dark:text-[#83a598] w-fit mb-3">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-base text-[#282828] dark:text-[#fbf1c7]">
                  Peer Clearance
                </h3>
                <p className="mt-1 text-xs font-sans text-[#706860] dark:text-[#a89984] leading-normal">
                  Mandatory two-person consensus before content can be marked brand certified.
                </p>
              </div>
            </div>

            <div className="bento-card p-6 flex flex-col justify-between">
              <div className="p-2.5 rounded-2xl bg-[#af3a03]/15 text-[#af3a03] dark:text-[#fe8019] w-fit mb-3">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-base text-[#282828] dark:text-[#fbf1c7]">
                  Tenant Isolation
                </h3>
                <p className="mt-1 text-xs font-sans text-[#706860] dark:text-[#a89984] leading-normal">
                  Strict cryptographic partitions keep each brand organization completely independent.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
