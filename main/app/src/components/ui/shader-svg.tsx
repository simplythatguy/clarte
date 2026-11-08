"use client"

import { MeshGradient } from "@paper-design/shaders-react"
import { motion } from "framer-motion"
import { useState, useEffect, useRef } from "react"

type Props = {
  /** Where the eyes look, overriding the pointer: -1…1 per axis is the pointer's reach, up to ±3 for a big glance. */
  look?: { x: number; y: number } | null
  /** Narrowed eyes, as when flying. */
  squint?: boolean
}

export function MeshGradientSVG({ look = null, squint = false }: Props = {}) {
  const colors = [
    "#FFB3D9", // Pastel pink
    "#87CEEB", // Sky blue
    "#4A90E2", // Medium blue
    "#DADDE3", // Grey-white (owner, 2026-11-08, in place of dark blue-gray)
    "#ECEEF1", // Pale grey-white (in place of very dark blue)
  ]

  const svgRef = useRef<SVGSVGElement>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])

  useEffect(() => {
    // Its own svg: the page's first svg in Clarte is a card icon, not this one.
    const rect = svgRef.current?.getBoundingClientRect()
    if (rect) {
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      const deltaX = (mousePosition.x - centerX) * 0.08
      const deltaY = (mousePosition.y - centerY) * 0.08

      const maxOffset = 8
      setEyeOffset({
        x: Math.max(-maxOffset, Math.min(maxOffset, deltaX)),
        y: Math.max(-maxOffset, Math.min(maxOffset, deltaY)),
      })
    }
  }, [mousePosition])

  const maxReach = 8
  const eyes = look
    ? { x: Math.max(-3, Math.min(3, look.x)) * maxReach, y: Math.max(-3, Math.min(3, look.y)) * maxReach }
    : eyeOffset

  // White eyes (owner, 2026-11-08): currentColor is Clarte's dark ink, which sank into the navy.
  return (
    <motion.div
      className="relative w-full max-w-sm mx-auto p-8 rounded-lg"
      animate={{
        // Only a float: the ball stays a circle (owner, 2026-11-08).
        y: [0, -8, 0],
      }}
      transition={{
        duration: 2.8,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
      }}
    >
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" className="w-full h-auto">
        <defs>
          <clipPath id="shapeClip">
            <circle cx="120" cy="120" r="120" />
          </clipPath>
          {/* Lit from the upper left (owner, 2026-11-08: a ball, its lighting barely noticeable). The
              shadow lies on the ball's own edge all round, a little deeper at the lower right where
              the sphere turns furthest from the light. */}
          <radialGradient id="ballShade" cx="0.46" cy="0.43" r="0.58">
            <stop offset="0.72" stopColor="#101830" stopOpacity="0" />
            <stop offset="0.92" stopColor="#101830" stopOpacity="0.08" />
            <stop offset="1" stopColor="#101830" stopOpacity="0.16" />
          </radialGradient>
          <radialGradient id="ballLight" cx="0.34" cy="0.26" r="0.42">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <foreignObject width="240" height="240" clipPath="url(#shapeClip)">
          <div className="w-full h-full">
            <MeshGradient colors={colors} className="w-full h-full" speed={1} />
          </div>
        </foreignObject>
        <circle cx="120" cy="120" r="120" fill="url(#ballShade)" />
        <circle cx="120" cy="120" r="120" fill="url(#ballLight)" />

        <motion.g
          animate={{ scaleY: squint ? 0.72 : 1 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <motion.ellipse
            rx="20"
            ry="30"
            fill="#FFFFFF"
            className="animate-blink"
            animate={{
              cx: 85 + eyes.x,
              cy: 108 + eyes.y,
            }}
            transition={{ type: "spring", stiffness: 150, damping: 15 }}
          />
          <motion.ellipse
            rx="20"
            ry="30"
            fill="#FFFFFF"
            className="animate-blink"
            animate={{
              cx: 155 + eyes.x,
              cy: 108 + eyes.y,
            }}
            transition={{ type: "spring", stiffness: 150, damping: 15 }}
          />
        </motion.g>
      </svg>

      {/* styled-jsx is Next.js only; a plain style element carries the same rules in Vite. */}
      <style>{`
        .animate-blink {
          animation: blink 3s infinite ease-in-out;
        }

        @keyframes blink {
          0%,
          90%,
          100% {
            ry: 30;
          }
          95% {
            ry: 3;
          }
        }
      `}</style>
    </motion.div>
  )
}
