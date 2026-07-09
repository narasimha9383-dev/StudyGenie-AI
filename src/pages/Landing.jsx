import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Menu, X } from "lucide-react";
import { useState } from "react";
import {
  HeroSection,
  FeaturesSection,
  StatisticsSection,
  TestimonialsSection,
  CTASection,
  FooterSection,
} from "../components/landing/LandingSections";

function Landing() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = ["Features", "About", "Testimonials"];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8f7ff_0%,#f7f8fc_100%)] text-slate-900">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/80 px-3 py-2 shadow-sm backdrop-blur"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white">
            <GraduationCap size={18} />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-900">
              StudyGenie AI
            </p>
            <p className="text-xs text-slate-500">AI learning workspace</p>
          </div>
        </button>

        <nav className="hidden items-center gap-6 md:flex">
          {navItems.map((item) => (
            <a
              key={item}
              href={
                item === "Features"
                  ? "#features"
                  : item === "Testimonials"
                    ? "#testimonials"
                    : "/about"
              }
              className="text-sm font-medium text-slate-600 transition hover:text-violet-600"
            >
              {item}
            </a>
          ))}
          <button
            onClick={() => navigate("/login")}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            Get Started
          </button>
        </nav>

        <button
          className="rounded-full border border-slate-200 bg-white p-2 text-slate-700 shadow-sm md:hidden"
          onClick={() => setMenuOpen((value) => !value)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>

      {menuOpen && (
        <div className="mx-4 rounded-[24px] border border-slate-200 bg-white/95 p-4 shadow-lg md:hidden">
          <div className="flex flex-col gap-3">
            {navItems.map((item) => (
              <a
                key={item}
                href={
                  item === "Features"
                    ? "#features"
                    : item === "Testimonials"
                      ? "#testimonials"
                      : "/about"
                }
                className="text-sm font-medium text-slate-700"
                onClick={() => setMenuOpen(false)}
              >
                {item}
              </a>
            ))}
            <button
              onClick={() => navigate("/login")}
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Get Started
            </button>
          </div>
        </div>
      )}

      <main className="px-4 pb-10 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <HeroSection
            onStart={() => navigate("/login")}
            onExplore={() =>
              document
                .getElementById("features")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          />
        </motion.div>
        <FeaturesSection />
        <StatisticsSection />
        <div id="testimonials">
          <TestimonialsSection />
        </div>
        <CTASection onStart={() => navigate("/login")} />
      </main>

      <FooterSection />
    </div>
  );
}

export default Landing;
