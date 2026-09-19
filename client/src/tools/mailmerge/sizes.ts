/**
 * Document sizes, grouped the way Figma groups its frames: where the file is
 * going first, then plain ratios, then paper. Pixel sizes are each platform's
 * recommended upload; ratios keep a 1080 short edge so they sit beside the
 * social sizes; paper is at 300 dpi.
 */
export type SizePreset = { name: string; ratio: string; width: number; height: number };
export type SizeGroup = { title: string; presets: SizePreset[] };

export const SIZE_GROUPS: SizeGroup[] = [
  {
    title: "social",
    presets: [
      { name: "instagram post", ratio: "1:1", width: 1080, height: 1080 },
      { name: "instagram portrait", ratio: "4:5", width: 1080, height: 1350 },
      { name: "instagram story", ratio: "9:16", width: 1080, height: 1920 },
      { name: "instagram landscape", ratio: "1.91:1", width: 1080, height: 566 },
      { name: "facebook post", ratio: "1.91:1", width: 1200, height: 630 },
      { name: "linkedin post", ratio: "1.91:1", width: 1200, height: 627 },
      { name: "x post", ratio: "16:9", width: 1600, height: 900 },
      { name: "youtube thumbnail", ratio: "16:9", width: 1280, height: 720 },
    ],
  },
  {
    title: "ratio",
    presets: [
      { name: "square", ratio: "1:1", width: 2000, height: 2000 },
      { name: "portrait", ratio: "3:4", width: 1080, height: 1440 },
      { name: "landscape", ratio: "4:3", width: 1440, height: 1080 },
      { name: "portrait", ratio: "2:3", width: 1080, height: 1620 },
      { name: "landscape", ratio: "3:2", width: 1620, height: 1080 },
      { name: "widescreen", ratio: "16:9", width: 1920, height: 1080 },
      { name: "tall", ratio: "9:16", width: 1080, height: 1920 },
    ],
  },
  {
    title: "print · 300 dpi",
    presets: [
      { name: "a4", ratio: "portrait", width: 2480, height: 3508 },
      { name: "a4", ratio: "landscape", width: 3508, height: 2480 },
      { name: "a5", ratio: "portrait", width: 1748, height: 2480 },
      { name: "us letter", ratio: "portrait", width: 2550, height: 3300 },
      { name: "photo 4×6", ratio: "portrait", width: 1200, height: 1800 },
      { name: "photo 5×7", ratio: "portrait", width: 1500, height: 2100 },
    ],
  },
];

export const ALL_SIZES = SIZE_GROUPS.flatMap((g) => g.presets);

/** The first preset with exactly these pixels — the social name wins over the bare ratio. */
export function presetFor(width: number, height: number): SizePreset | null {
  return ALL_SIZES.find((p) => p.width === width && p.height === height) ?? null;
}
