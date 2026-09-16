import { create } from 'zustand'
import { MOTION_TEMPLATES } from '../core/motion/templates'

interface MotionState {
  templateId: string
  playing: boolean
  loop: boolean
  speed: number
  setTemplateId: (id: string) => void
  setPlaying: (playing: boolean) => void
  setLoop: (loop: boolean) => void
  setSpeed: (speed: number) => void
}

export const useMotionStore = create<MotionState>((set) => ({
  templateId: MOTION_TEMPLATES[0].id,
  playing: false,
  loop: true,
  speed: 1,
  setTemplateId: (id) => set({ templateId: id, playing: false }),
  setPlaying: (playing) => set({ playing }),
  setLoop: (loop) => set({ loop }),
  setSpeed: (speed) => set({ speed }),
}))
