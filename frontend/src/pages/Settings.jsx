import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  Download,
  FileText,
  Globe,
  Lock,
  Moon,
  Pencil,
  Settings as SettingsIcon,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { AuthContext } from "../context/AuthContext";

const tabs = ["General", "AI Preferences", "Study Preferences", "Content & Sources", "Account", "Privacy & Security", "Notifications", "Appearance"];

function SelectValue({ children }) {
  return <button type="button" className="flex w-full min-w-36 items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-left text-sm text-zinc-200 sm:w-auto"><span>{children}</span><ChevronDown size={15} className="text-zinc-500" /></button>;
}

function Toggle({ enabled, onClick }) {
  return <button type="button" onClick={onClick} aria-pressed={enabled} className={`relative h-6 w-11 rounded-full transition ${enabled ? "bg-[#39ff14]" : "bg-zinc-700"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${enabled ? "right-1" : "left-1"}`} /></button>;
}

function SettingRow({ icon: Icon, title, description, children }) {
  return <div className="flex flex-col items-start justify-between gap-3 border-b border-white/[.07] py-4 last:border-0 sm:flex-row sm:items-center sm:gap-5"><div className="flex min-w-0 items-center gap-3"><Icon size={19} className="shrink-0 text-[#65ff45]" /><div><p className="text-sm font-medium text-white">{title}</p><p className="text-xs text-zinc-500">{description}</p></div></div><div className="w-full shrink-0 sm:w-auto">{children}</div></div>;
}

export default function Settings() {
  const { user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState("General");
  const [autoSave, setAutoSave] = useState(true);
  const [autoTitle, setAutoTitle] = useState(true);
  const [diagrams, setDiagrams] = useState(true);
  const [formulas, setFormulas] = useState(true);
  const [examples, setExamples] = useState(true);
  const [summary, setSummary] = useState(true);

  return <section className="mx-auto max-w-7xl pb-10">
    <div className="mb-6 flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#39ff14]/30 bg-[#39ff14]/10 text-[#65ff45]"><SettingsIcon size={25} /></div><div><h1 className="text-3xl font-semibold text-white">Settings</h1><p className="text-sm text-zinc-400">Customize your StudyGenie AI experience</p></div></div>

    <div className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[.025] p-2">
      {tabs.map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs transition ${activeTab === tab ? "bg-[#39ff14]/10 text-[#65ff45]" : "text-zinc-400 hover:text-white"}`}>{tab}</button>)}
    </div>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5">
          <h2 className="mb-2 text-lg font-semibold text-white">{activeTab}</h2>
          <p className="mb-2 text-xs text-zinc-500">Your preferences are applied to newly generated study materials.</p>
          <SettingRow icon={Globe} title="Language" description="Choose your preferred language"><SelectValue>English</SelectValue></SettingRow>
          <SettingRow icon={FileText} title="Default Output Format" description="Choose the default format for generated materials"><SelectValue>PDF</SelectValue></SettingRow>
          <SettingRow icon={Zap} title="Auto Save" description="Automatically save your work while editing"><Toggle enabled={autoSave} onClick={() => setAutoSave(!autoSave)} /></SettingRow>
          <SettingRow icon={Sparkles} title="Auto Title Generation" description="Generate appropriate titles automatically"><Toggle enabled={autoTitle} onClick={() => setAutoTitle(!autoTitle)} /></SettingRow>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5">
          <h2 className="mb-2 text-lg font-semibold text-white">AI Preferences</h2>
          <p className="mb-2 text-xs text-zinc-500">The AI provider is configured securely by the backend.</p>
          <SettingRow icon={Sparkles} title="AI Provider" description="Configured generation provider"><span className="rounded-lg border border-[#39ff14]/25 bg-[#39ff14]/10 px-3 py-2 text-sm text-[#65ff45]">OpenRouter</span></SettingRow>
          <SettingRow icon={Zap} title="Generation Model" description="Used for notes, quizzes, and AI answers"><span className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-sm text-zinc-200">openrouter/free</span></SettingRow>
          <SettingRow icon={Lock} title="API Key" description="Never displayed in the frontend"><span className="text-xs text-zinc-500">Managed securely in backend/.env</span></SettingRow>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5">
          <h2 className="mb-2 text-lg font-semibold text-white">Generation Settings</h2>
          <SettingRow icon={BookOpen} title="Default Marks" description="Set default marks for answer generation"><SelectValue>10 Marks</SelectValue></SettingRow>
          <SettingRow icon={Pencil} title="Default Answer Style" description="Choose default style for answers"><SelectValue>Detailed Explanation</SelectValue></SettingRow>
          <SettingRow icon={FileText} title="Include Diagrams by Default" description="Include diagrams when applicable"><Toggle enabled={diagrams} onClick={() => setDiagrams(!diagrams)} /></SettingRow>
          <SettingRow icon={Zap} title="Include Formulas by Default" description="Include formulas when applicable"><Toggle enabled={formulas} onClick={() => setFormulas(!formulas)} /></SettingRow>
          <SettingRow icon={BookOpen} title="Default Difficulty Level" description="Set default difficulty level"><SelectValue>Medium</SelectValue></SettingRow>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5">
          <h2 className="mb-2 text-lg font-semibold text-white">Content Preferences</h2>
          <SettingRow icon={BookOpen} title="Preferred Depth" description="Set default depth of explanation"><SelectValue>Detailed</SelectValue></SettingRow>
          <SettingRow icon={FileText} title="Include Examples" description="Include examples in answers"><Toggle enabled={examples} onClick={() => setExamples(!examples)} /></SettingRow>
          <SettingRow icon={Check} title="Include Key Points / Summary" description="Add key points or summary at the end"><Toggle enabled={summary} onClick={() => setSummary(!summary)} /></SettingRow>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5"><h2 className="mb-4 flex items-center gap-2 font-semibold text-white"><UserRound size={19} className="text-[#65ff45]" />Your Study Profile</h2><div className="space-y-3 text-sm"><div className="flex justify-between gap-4 text-zinc-400"><span>Name</span><span className="text-right text-zinc-200">{user?.name || "Student"}</span></div><div className="flex justify-between gap-4 text-zinc-400"><span>AI Model</span><span className="text-right text-[#65ff45]">openrouter/free</span></div></div><Link to="/profile" className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-[#39ff14]/40 px-3 py-2 text-sm text-[#65ff45] hover:bg-[#39ff14]/10"><Pencil size={15} />Edit Profile</Link></div>
        <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5"><h2 className="mb-4 flex items-center gap-2 font-semibold text-white"><Lock size={19} className="text-[#65ff45]" />Privacy & Security</h2><p className="text-sm leading-6 text-zinc-400">Your API key and provider configuration stay on the backend and are never sent to the browser.</p></div>
        <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-5"><h2 className="mb-4 flex items-center gap-2 font-semibold text-white"><Download size={19} className="text-[#65ff45]" />Data & Export</h2><button type="button" className="flex w-full items-center justify-between border-b border-white/[.07] py-3 text-sm text-zinc-300 hover:text-white">Export All Notes <Download size={15} /></button><button type="button" className="flex w-full items-center justify-between py-3 text-sm text-zinc-300 hover:text-white">Manage Storage <ChevronDown size={15} /></button></div>
        <div className="rounded-2xl border border-[#39ff14]/25 bg-[#39ff14]/[.04] p-5"><h2 className="mb-2 flex items-center gap-2 font-semibold text-white"><Bell size={18} className="text-[#65ff45]" />AI generation status</h2><p className="text-sm leading-6 text-zinc-400">Using OpenRouter free routing. Availability and rate limits are controlled by the provider.</p></div>
      </aside>
    </div>
  </section>;
}
