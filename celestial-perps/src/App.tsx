'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Hero from './components/Hero';
import BentoFeatures from './components/BentoFeatures';
import TerminalPreview from './components/TerminalPreview';
import Footer from './components/Footer';

gsap.registerPlugin(ScrollTrigger);

export default function App() {
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // ============ HERO: Phantom-style extreme smooth reveal ============
      const heroTl = gsap.timeline({ defaults: { ease: 'power4.out' } });

      heroTl
        .from('[data-animate="hero-badge"]', {
          y: 20,
          opacity: 0,
          duration: 1,
          delay: 0.1,
        })
        .from(
          '[data-animate="hero-headline"]',
          {
            y: 50,
            opacity: 0,
            duration: 1.2,
          },
          '-=0.7'
        )
        .from(
          '[data-animate="hero-sub"]',
          {
            y: 30,
            opacity: 0,
            duration: 1,
          },
          '-=0.9'
        )
        .from(
          '[data-animate="hero-cta"]',
          {
            y: 20,
            opacity: 0,
            duration: 1,
            stagger: 0.1,
          },
          '-=0.8'
        )
        .from(
          '[data-animate="hero-stats"]',
          {
            y: 20,
            opacity: 0,
            duration: 1,
          },
          '-=0.7'
        );

      // ============ SECTIONS: Floating scroll reveals ============
      // Select all elements that should fade/scale up on scroll
      gsap.utils.toArray<HTMLElement>('.scroll-reveal').forEach((elem) => {
        gsap.from(elem, {
          scrollTrigger: {
            trigger: elem,
            start: 'top 85%',
            toggleActions: 'play none none reverse',
          },
          y: 60,
          opacity: 0,
          scale: 0.98,
          duration: 1.2,
          ease: 'power3.out',
        });
      });

      // ============ TERMINAL PARALLAX: Deep Dive Effect ============
      const terminalMock = document.querySelector('[data-animate="terminal-mock"]');
      if (terminalMock) {
        gsap.fromTo(
          terminalMock,
          { scale: 0.9, opacity: 0.2, y: 100 },
          {
            scale: 1,
            opacity: 1,
            y: 0,
            ease: 'none',
            scrollTrigger: {
              trigger: '.terminal-section',
              start: 'top 95%',
              end: 'top 20%',
              scrub: 1,
            },
          }
        );
      }
    }, mainRef);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={mainRef}
      className="relative min-h-screen bg-[#ffffff] text-[#111111] overflow-hidden font-sans tracking-tight flex flex-col"
    >
      {/* Ambient Orbs (Ultra-soft Phantom-style gradients) */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="ambient-orb w-[800px] h-[800px] bg-[#ab9ff2]/10 top-[-200px] right-[-200px] animate-float-slow" />
        <div className="ambient-orb w-[600px] h-[600px] bg-[#22c55e]/5 top-[40%] left-[-300px] animate-float-slow" style={{ animationDelay: '-3s' }} />
        <div className="ambient-orb w-[900px] h-[900px] bg-[#7b61ff]/5 bottom-[-400px] right-[10%] animate-float-slow" style={{ animationDelay: '-6s' }} />
      </div>

      {/* Navigation */}
      <nav className="w-full px-8 py-6 flex items-center justify-between z-20 flex-shrink-0 relative">
        <div className="flex items-center gap-3">
          {/* Minimalist Logo Mark */}
          <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center">
            <div className="w-3 h-3 rounded-sm bg-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-black">
            Celestial
          </span>
        </div>
        <div className="flex items-center gap-8">
          <a href="#features" className="text-sm font-semibold text-[#555] hover:text-black transition-colors hidden sm:block">Features</a>
          <a href="#terminal" className="text-sm font-semibold text-[#555] hover:text-black transition-colors hidden sm:block">Terminal</a>
          <a href="https://docs.celestial.exchange" className="text-sm font-semibold text-[#555] hover:text-black transition-colors hidden sm:block">Docs</a>
          <button className="btn-phantom text-sm !py-2.5 !px-5">Launch App</button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 w-full flex-1 flex flex-col items-center">
        <Hero />
        <BentoFeatures />
        <TerminalPreview />
      </main>

      <Footer />
    </div>
  );
}
