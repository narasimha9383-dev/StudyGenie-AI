import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CirclePlay,
  GraduationCap,
  MessageCircleMore,
  Sparkles,
  Star,
  Target,
  TimerReset,
  Users,
} from "lucide-react";

export function HeroSection({ onStart, onExplore }) {
  const highlights = ["AI Study Assistant", "Smart Notes", "Progress Tracking"];

  return (
    <section className="relative overflow-hidden rounded-[40px] border border-sky-100/70 bg-gradient-to-br from-sky-600 via-blue-600 to-slate-900 px-6 py-10 shadow-[0_30px_90px_rgba(2,132,199,0.22)] sm:px-8 lg:px-12 lg:py-16">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.22),transparent_35%)]" />
      <div className="relative grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-sky-50 backdrop-blur">
            <Sparkles size={16} />
            AI-powered learning workspace
          </div>
          <h1 className="mt-6 text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
            Study smarter with a premium AI learning companion.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-sky-50/90">
            Turn notes, quizzes, flashcards, and study plans into a seamless
            experience that keeps you focused and ahead.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={onStart}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:scale-[1.02]"
            >
              Get Started
              <ArrowRight size={16} />
            </button>
            <button
              onClick={onExplore}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
            >
              <CirclePlay size={16} />
              Explore Features
            </button>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {highlights.map((item) => (
              <div
                key={item}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm text-sky-50 backdrop-blur"
              >
                {item}
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative mx-auto w-full max-w-xl"
        >
          <div className="absolute inset-0 -translate-y-3 rounded-[36px] bg-white/10 blur-3xl" />
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            className="relative overflow-hidden rounded-[36px] border border-white/20 bg-white/10 p-3 shadow-[0_30px_90px_rgba(2,6,23,0.3)] backdrop-blur"
          >
            <img
              src="/HomePage.png"
              alt="StudyGenie AI dashboard preview"
              className="h-full w-full rounded-[28px] object-cover"
            />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

export function FeaturesSection() {
  const features = [
    {
      icon: BrainCircuit,
      title: "AI Study Assistant",
      description:
        "Get instant explanations, summaries, and learning guidance tailored to your goals.",
    },
    {
      icon: BookOpen,
      title: "Smart Notes",
      description:
        "Capture and organize key ideas across subjects with a clean, visual workspace.",
    },
    {
      icon: Target,
      title: "Quiz Generator",
      description:
        "Create personalized practice quizzes to test your understanding in seconds.",
    },
    {
      icon: Sparkles,
      title: "Flashcards",
      description:
        "Turn concepts into fast revision cards that reinforce long-term memory.",
    },
    {
      icon: TimerReset,
      title: "Study Planner",
      description:
        "Stay consistent with a structured plan built around your focus time.",
    },
    {
      icon: BarChart3,
      title: "Analytics",
      description:
        "Follow progress with clear insights into study hours, milestones, and trends.",
    },
    {
      icon: CheckCircle2,
      title: "Progress Tracking",
      description: "See what is working and where you should spend more time.",
    },
    {
      icon: MessageCircleMore,
      title: "AI Chat",
      description:
        "Ask questions and get support in a conversational, supportive experience.",
    },
  ];

  return (
    <section
      id="features"
      className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.32em] text-sky-600">
          Features
        </p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-950 sm:text-4xl">
          Everything you need to study with clarity and momentum.
        </h2>
        <p className="mt-4 text-lg leading-8 text-slate-600">
          A polished set of tools designed for focused learning, faster
          revision, and steady progress.
        </p>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <motion.article
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.35, delay: index * 0.05 }}
              whileHover={{ y: -6, scale: 1.01 }}
              className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <Icon size={20} />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">
                {feature.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {feature.description}
              </p>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}

export function StatisticsSection() {
  const stats = [
    { value: "20K+", label: "Students" },
    { value: "100K+", label: "Notes Generated" },
    { value: "1M+", label: "Questions Solved" },
    { value: "98%", label: "Satisfaction" },
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-4 rounded-[32px] border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_25px_70px_rgba(15,23,42,0.18)] md:grid-cols-2 xl:grid-cols-4 xl:p-8">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: index * 0.07 }}
            className="rounded-[24px] border border-white/10 bg-white/10 p-5 backdrop-blur"
          >
            <p className="text-3xl font-semibold text-white sm:text-4xl">
              {stat.value}
            </p>
            <p className="mt-2 text-sm text-slate-300">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export function TestimonialsSection() {
  const testimonials = [
    {
      name: "Riya Patel",
      college: "IIT Delhi",
      quote:
        "The AI tutor helped me revise faster than ever. Every study block feels more intentional now.",
      avatar: "RP",
    },
    {
      name: "Noah Kim",
      college: "University of Toronto",
      quote:
        "The planner and quiz generator turned my scattered study habits into a focused weekly routine.",
      avatar: "NK",
    },
    {
      name: "Aisha Rahman",
      college: "LSE",
      quote:
        "The experience is polished, calm, and genuinely motivating. I love how smooth everything feels.",
      avatar: "AR",
    },
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.32em] text-sky-600">
          Testimonials
        </p>
        <h2 className="mt-4 text-3xl font-semibold text-slate-950 sm:text-4xl">
          Loved by ambitious students everywhere.
        </h2>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {testimonials.map((testimonial, index) => (
          <motion.article
            key={testimonial.name}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: index * 0.06 }}
            whileHover={{ y: -8, scale: 1.01 }}
            className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700">
                {testimonial.avatar}
              </div>
              <div>
                <p className="font-semibold text-slate-950">
                  {testimonial.name}
                </p>
                <p className="text-sm text-slate-500">{testimonial.college}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-1 text-amber-400">
              {Array.from({ length: 5 }).map((_, starIndex) => (
                <Star
                  key={`${testimonial.name}-${starIndex}`}
                  size={16}
                  fill="currentColor"
                />
              ))}
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              “{testimonial.quote}”
            </p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

export function CTASection({ onStart }) {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35 }}
        className="rounded-[36px] bg-gradient-to-r from-sky-600 via-blue-600 to-slate-900 p-8 text-white shadow-[0_25px_70px_rgba(15,23,42,0.18)] sm:p-10 lg:p-12"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-sky-100">
              Ready to begin?
            </p>
            <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">
              Start learning smarter today.
            </h2>
            <p className="mt-4 text-lg leading-8 text-sky-100/90">
              Build stronger habits, revise faster, and enjoy a calm, guided
              study experience.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={onStart}
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:scale-[1.02]"
            >
              Get Started
            </button>
            <button
              onClick={onStart}
              className="rounded-full border border-white/25 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
            >
              Join Free
            </button>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

export function FooterSection() {
  const footerLinks = [
    ["Home", "Courses", "Features", "Pricing", "About"],
    ["Contact", "Privacy Policy", "Terms & Conditions", "Help Center"],
  ];

  const socialLinks = ["GitHub", "LinkedIn", "Twitter", "Instagram", "Email"];

  return (
    <footer className="border-t border-slate-200 bg-slate-950/95 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-600 text-white">
              <GraduationCap size={20} />
            </div>
            <div>
              <p className="text-lg font-semibold text-white">StudyGenie AI</p>
              <p className="text-sm text-slate-400">AI-powered learning</p>
            </div>
          </div>
          <p className="mt-6 max-w-md text-sm leading-7 text-slate-400">
            A premium study workspace for notes, quizzes, flashcards, and AI
            support that keeps your learning calm and consistent.
          </p>
        </div>

        {footerLinks.map((group, index) => (
          <div key={`footer-group-${index}`}>
            <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-white">
              {index === 0 ? "Quick Links" : "Resources"}
            </h3>
            <ul className="mt-5 space-y-3 text-sm text-slate-400">
              {group.map((item) => (
                <li key={item} className="transition hover:text-white">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-white">
            Social
          </h3>
          <ul className="mt-5 space-y-3 text-sm text-slate-400">
            {socialLinks.map((item) => (
              <li key={item} className="transition hover:text-white">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-sm text-slate-500">
        © 2026 StudyGenie AI. All rights reserved.
      </div>
    </footer>
  );
}
