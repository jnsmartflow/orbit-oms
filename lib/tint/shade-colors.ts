// Shared pigment-colour tokens for the TI form, Skip modal, and (future) Pause
// modal. Each shade carries: a light + slightly deeper background tint, a base
// border, the top accent + a deeper variant for filled state, and a label
// foreground colour for the code text.
//
// Source: lifted verbatim from the original definitions in
// components/tint/tint-operator-content.tsx so the TI form + Skip modal stay
// pixel-aligned. Phase 4 PauseJobModal will consume the same tokens.

export interface ShadeColor {
  bg:      string;
  bgFill:  string;
  border:  string;
  top:     string;
  topFill: string;
  label:   string;
}

export const TINTER_SHADE_COLORS: Record<string, ShadeColor> = {
  YOX: { bg: "#fdf6e3", bgFill: "#faf0d1", border: "#c8a951", top: "#b8860b", topFill: "#8d6e1f", label: "#8d6e1f" },
  LFY: { bg: "#fefce8", bgFill: "#fef9c3", border: "#d4d430", top: "#cccc00", topFill: "#9e9d24", label: "#7d7d1e" },
  GRN: { bg: "#e8f5e9", bgFill: "#c8e6c9", border: "#66bb6a", top: "#2e7d32", topFill: "#1b5e20", label: "#1b5e20" },
  TBL: { bg: "#e3f2fd", bgFill: "#bbdefb", border: "#64b5f6", top: "#1565c0", topFill: "#0d47a1", label: "#0d47a1" },
  WHT: { bg: "#fafafa", bgFill: "#f5f5f5", border: "#bdbdbd", top: "#757575", topFill: "#616161", label: "#616161" },
  MAG: { bg: "#fce4ec", bgFill: "#f8bbd0", border: "#f48fb1", top: "#c2185b", topFill: "#880e4f", label: "#880e4f" },
  FFR: { bg: "#ffebee", bgFill: "#ffcdd2", border: "#ef9a9a", top: "#d32f2f", topFill: "#b71c1c", label: "#b71c1c" },
  BLK: { bg: "#eceff1", bgFill: "#cfd8dc", border: "#90a4ae", top: "#37474f", topFill: "#212121", label: "#212121" },
  OXR: { bg: "#fbe9e7", bgFill: "#f5c4b3", border: "#a1553a", top: "#8d3c1a", topFill: "#5d1f0d", label: "#5d1f0d" },
  HEY: { bg: "#fff9c4", bgFill: "#fff59d", border: "#d4c430", top: "#c9a800", topFill: "#8c7a00", label: "#8c7a00" },
  HER: { bg: "#ffebee", bgFill: "#ffcdd2", border: "#ef9a9a", top: "#e53935", topFill: "#c62828", label: "#c62828" },
  COB: { bg: "#e8eaf6", bgFill: "#c5cae9", border: "#7986cb", top: "#283593", topFill: "#1a237e", label: "#1a237e" },
  COG: { bg: "#e0f2f1", bgFill: "#b2dfdb", border: "#4db6ac", top: "#00695c", topFill: "#004d40", label: "#004d40" },
};

export const ACOTONE_SHADE_COLORS: Record<string, ShadeColor> = {
  YE2: { bg: "#fff8e1", bgFill: "#ffecb3", border: "#ffd54f", top: "#f9a825", topFill: "#f57f17", label: "#e65100" },
  YE1: { bg: "#fffde7", bgFill: "#fff9c4", border: "#fff176", top: "#fdd835", topFill: "#f9a825", label: "#f57f17" },
  XY1: { bg: "#fff3e0", bgFill: "#ffe0b2", border: "#ffb74d", top: "#ef6c00", topFill: "#e65100", label: "#bf360c" },
  XR1: { bg: "#fbe9e7", bgFill: "#ffccbc", border: "#ff8a65", top: "#d84315", topFill: "#bf360c", label: "#bf360c" },
  WH1: { bg: "#fafafa", bgFill: "#f5f5f5", border: "#bdbdbd", top: "#757575", topFill: "#616161", label: "#616161" },
  RE2: { bg: "#ffebee", bgFill: "#ffcdd2", border: "#ef9a9a", top: "#c62828", topFill: "#b71c1c", label: "#b71c1c" },
  RE1: { bg: "#ffebee", bgFill: "#ffcdd2", border: "#e57373", top: "#e53935", topFill: "#c62828", label: "#c62828" },
  OR1: { bg: "#fff3e0", bgFill: "#ffe0b2", border: "#ffb74d", top: "#ef6c00", topFill: "#e65100", label: "#e65100" },
  NO2: { bg: "#eceff1", bgFill: "#cfd8dc", border: "#90a4ae", top: "#263238", topFill: "#1a1a1a", label: "#212121" },
  NO1: { bg: "#f5f5f5", bgFill: "#e0e0e0", border: "#9e9e9e", top: "#424242", topFill: "#212121", label: "#424242" },
  MA1: { bg: "#f3e5f5", bgFill: "#e1bee7", border: "#ba68c8", top: "#7b1fa2", topFill: "#4a148c", label: "#4a148c" },
  GR1: { bg: "#e8f5e9", bgFill: "#c8e6c9", border: "#66bb6a", top: "#2e7d32", topFill: "#1b5e20", label: "#1b5e20" },
  BU2: { bg: "#e3f2fd", bgFill: "#bbdefb", border: "#64b5f6", top: "#1565c0", topFill: "#0d47a1", label: "#0d47a1" },
  BU1: { bg: "#e8eaf6", bgFill: "#c5cae9", border: "#7986cb", top: "#283593", topFill: "#1a237e", label: "#1a237e" },
};
