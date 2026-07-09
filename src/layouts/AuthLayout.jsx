import { Home, BrainCircuit, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

const AuthLayout = ({ children }) => {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_30%),linear-gradient(135deg,#f8fcff_0%,#eef7ff_45%,#f8fafc_100%)] px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl overflow-hidden rounded-[36px] border border-sky-100/80 bg-white/85 shadow-[0_30px_90px_rgba(2,132,199,0.12)] backdrop-blur-xl">
        <div className="relative hidden w-full max-w-xl flex-col justify-between overflow-hidden bg-gradient-to-br from-sky-600 via-blue-600 to-slate-900 p-8 text-white lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.25),transparent_35%)]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-sky-50">
              <Sparkles size={16} />
              Premium study experience
            </div>
            <h1 className="mt-8 text-4xl font-semibold leading-tight">
              Create your calm, focused learning space.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-sky-100/90">
              Join a more intelligent way to study with AI-powered notes,
              quizzes, and guided progress.
            </p>
          </div>

          <div className="relative rounded-[28px] border border-white/15 bg-white/10 p-6 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <BrainCircuit size={22} />
              </div>
              <div>
                <p className="font-semibold">Designed for deep focus</p>
                <p className="text-sm text-sky-100/80">
                  Clean, elegant tools that help you learn without the noise.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-6 sm:p-8 lg:p-10">
          <div className="w-full max-w-md">
            <Link
              to="/"
              className="mb-8 inline-flex items-center gap-3 rounded-full border border-sky-100 bg-white/80 px-4 py-2 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-lg shadow-sky-500/20">
                <Home size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  StudyGenie AI
                </p>
                <p className="text-xs text-slate-500">
                  Smart learning, beautifully simple
                </p>
              </div>
            </Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
