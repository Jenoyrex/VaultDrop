"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ShieldCheck, Lock, KeyRound, FolderLock } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Lock,
    title: "End-to-end ownership",
    description: "Only you hold the password that unlocks your vault."
  },
  {
    icon: FolderLock,
    title: "Organized by design",
    description: "Nested folders keep every file exactly where you expect it."
  },
  {
    icon: KeyRound,
    title: "One password, one vault",
    description: "No accounts to juggle — your username is your vault."
  }
];

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <section className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2 text-primary"
        >
          <ShieldCheck className="h-9 w-9" />
          <span className="text-2xl font-bold tracking-tight text-foreground">VaultDrop</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl"
        >
          Your Files. Your Password. Your Vault.
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <Button size="lg" asChild>
            <Link href="/auth">Get Started</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="#learn-more">Learn More</a>
          </Button>
        </motion.div>
      </section>

      <section id="learn-more" className="border-t border-border bg-secondary/40 px-6 py-20">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6"
            >
              <feature.icon className="h-7 w-7 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </section>
    </main>
  );
}
