import { useContext, useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Check,
  GraduationCap,
  KeyRound,
  Mail,
  Pencil,
  Save,
  Shield,
  Trash2,
  UserRound,
} from "lucide-react";
import api from "../api/axios";
import { AuthContext } from "../context/AuthContext";

const Stat = ({ icon: Icon, label, value }) => <article className="rounded-2xl border border-white/10 bg-[#0d1110] p-5"><Icon size={20} className="text-[#65ff45]" /><p className="mt-4 text-xs text-zinc-500">{label}</p><p className="mt-1 text-2xl font-semibold text-white">{value}</p></article>;

const Detail = ({ label, value }) => <div className="border-b border-white/[.07] py-3 last:border-0"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-sm text-zinc-200">{value || "Not specified"}</p></div>;

export default function Profile() {
  const { login, logout } = useContext(AuthContext);
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    Promise.all([api.get("/user/profile"), api.get("/user/analytics")])
      .then(([profileResponse, analyticsResponse]) => {
        setProfile(profileResponse.data.user);
        setName(profileResponse.data.user.name || "");
        setAnalytics(analyticsResponse.data.analytics);
      })
      .catch((requestError) => setError(requestError.response?.data?.message || "Could not load your profile."));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.put("/user/profile", { name });
      setProfile(data.user);
      login(data.user);
      setEditing(false);
      setNotice("Profile updated successfully.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not update your profile.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete your account permanently? This cannot be undone.")) return;
    try {
      await api.delete("/user/profile");
      logout();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not delete account.");
    }
  };

  if (!profile && !error) return <section className="mx-auto max-w-6xl text-sm text-zinc-400">Loading profile…</section>;
  if (error && !profile) return <section className="mx-auto max-w-6xl rounded-2xl border border-red-400/30 bg-red-500/10 p-5 text-red-200">{error}</section>;

  const preferences = profile.learningPreferences || {};
  const learningPreferences = [preferences.level, preferences.explanationStyle, preferences.outputLanguage].filter(Boolean).join(" • ");
  const joinedYear = profile.createdAt ? new Date(profile.createdAt).getFullYear() : "Not available";

  return <section className="mx-auto max-w-6xl space-y-6 pb-10">
    <div><p className="text-sm font-semibold uppercase tracking-widest text-[#65ff45]">Account</p><h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold text-white"><UserRound className="text-[#65ff45]" />Profile</h1><p className="mt-2 text-sm text-zinc-400">Manage your StudyGenie AI profile and personalize your learning experience.</p></div>

    {(error || notice) && <p role="status" className={`rounded-xl border p-4 text-sm ${error ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-[#39ff14]/30 bg-[#39ff14]/10 text-[#b7ffab]"}`}>{error || notice}</p>}

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
      <div className="space-y-6">
        <form onSubmit={save} className="rounded-2xl border border-white/10 bg-[#0d1110] p-6">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">Profile Information</h2><p className="mt-1 text-xs text-zinc-500">Update your personal information and learning preferences.</p></div><button type="button" onClick={() => setEditing(!editing)} className="inline-flex items-center gap-2 rounded-xl border border-[#39ff14]/40 px-3 py-2 text-sm text-[#65ff45] hover:bg-[#39ff14]/10"><Pencil size={15} />{editing ? "Cancel" : "Edit Profile"}</button></div>
          <div className="grid gap-4 sm:grid-cols-2"><div><label className="text-xs text-zinc-500" htmlFor="profile-name">Full Name</label>{editing ? <input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} minLength="2" required className="mt-2 w-full rounded-xl border border-white/10 bg-white/[.04] p-3 text-sm text-white outline-none focus:border-[#39ff14]/50" /> : <p className="mt-2 text-sm text-zinc-200">{profile.name}</p>}</div><div><p className="text-xs text-zinc-500">Email Address</p><p className="mt-2 flex items-center gap-2 text-sm text-zinc-200"><Mail size={15} className="text-zinc-500" />{profile.email}</p></div></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Role" value={profile.role === "admin" ? "Administrator" : "Student"} /><Detail label="Education" value={[profile.course, profile.college].filter(Boolean).join(" at ") || "Computer Science & Engineering"} /><Detail label="Academic Goal" value="Semester Examination Preparation" /><Detail label="Learning Preferences" value={learningPreferences || "Theory • Diagrams • Formulas • Examples"} /></div>
          {editing && <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#39ff14] px-5 py-3 text-sm font-semibold text-[#071006] disabled:opacity-60"><Save size={17} />{saving ? "Saving…" : "Save Changes"}</button>}
        </form>

        <div className="rounded-2xl border border-white/10 bg-[#0d1110] p-6"><h2 className="text-lg font-semibold text-white">About Me</h2><p className="mt-3 text-sm leading-7 text-zinc-400">A computer science student using StudyGenie AI to organize study materials, generate exam-oriented answers, and prepare effectively for semester examinations.</p></div>

        <div><h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white"><BarChart3 size={20} className="text-[#65ff45]" />Study Statistics</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Stat icon={BookOpen} label="Materials Uploaded" value={analytics?.pdfs ?? 0} /><Stat icon={Check} label="Notes Generated" value={analytics?.notes ?? 0} /><Stat icon={GraduationCap} label="Questions Practiced" value={analytics?.quizzes ?? 0} /><Stat icon={BarChart3} label="Study Hours" value="Not tracked" /><Stat icon={BarChart3} label="Learning Progress" value={`${analytics?.flashcardProgress ?? 0}%`} /></div></div>
      </div>

      <aside className="space-y-6"><div className="rounded-2xl border border-white/10 bg-[#0d1110] p-6"><h2 className="flex items-center gap-2 font-semibold text-white"><Shield size={19} className="text-[#65ff45]" />Account</h2><Detail label="Member since" value={joinedYear} /><button type="button" onClick={() => setNotice("Password changes are not available in the current backend workflow.")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm text-zinc-300 hover:border-[#39ff14]/40 hover:text-[#65ff45]"><KeyRound size={16} />Change Password</button></div><div className="rounded-2xl border border-red-400/20 bg-red-500/[.04] p-6"><h2 className="flex items-center gap-2 font-semibold text-red-200"><Trash2 size={19} />Profile Actions</h2><p className="mt-3 text-sm leading-6 text-red-200/70">Deleting your account permanently removes your profile and uploaded study data.</p><button type="button" onClick={remove} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/40 px-4 py-3 text-sm font-semibold text-red-200 hover:bg-red-500/10"><Trash2 size={16} />Delete Account</button></div></aside>
    </div>
  </section>;
}
