"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function HomeMotion() {
  useGSAP(() => {
    const heroImage = document.querySelector(".hero-image");
    const pinGrid = document.querySelector(".pin-grid");
    const cards = gsap.utils.toArray<HTMLElement>(".scroll-card");
    const words = gsap.utils.toArray<HTMLElement>(".scrub-word");

    if (heroImage) {
      gsap.fromTo(
        heroImage,
        { opacity: 0.72, scale: 0.9 },
        {
          opacity: 1,
          scale: 1,
          duration: 1.2,
          ease: "power3.out",
        },
      );
    }

    if (pinGrid) {
      ScrollTrigger.matchMedia({
        "(min-width: 981px)": () => {
          ScrollTrigger.create({
            trigger: ".pin-grid",
            start: "top top+=84",
            end: "bottom bottom",
            pin: ".pin-copy",
            pinSpacing: false,
          });
        },
      });
    }

    cards.forEach((card) => {
      gsap.fromTo(
        card,
        { opacity: 0.22, scale: 0.92, y: 32 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          ease: "power2.out",
          scrollTrigger: {
            trigger: card,
            start: "top 82%",
            end: "bottom 28%",
            scrub: true,
          },
        },
      );
    });

    if (words.length > 0) {
      gsap.to(words, {
        opacity: 1,
        stagger: 0.06,
        ease: "none",
        scrollTrigger: {
          trigger: ".scrub-words",
          start: "top 78%",
          end: "bottom 42%",
          scrub: true,
        },
      });
    }
  });

  return null;
}
