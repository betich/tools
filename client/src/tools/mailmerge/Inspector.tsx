import { Fragment, type ReactNode } from "react";
import { FiType } from "react-icons/fi";
import { textCaseOf, type Align, type Fill, type TextCase, type TextLayer, type VAlign } from "@tools/shared";
import {
  Chip,
  ColorInput,
  Empty,
  Field,
  IconSegmented,
  NumberInput,
  Section,
  Sections,
  Segmented,
  segCell,
  segStrip,
  Slider,
  TextButton,
  Toggle,
} from "@/components/ui";
import { FontPicker } from "./FontPicker";

const DEFAULT_GRADIENT: Fill = {
  type: "linear",
  angle: 90,
  stops: [
    { offset: 0, color: "#4845DA" },
    { offset: 1, color: "#111827" },
  ],
};

/**
 * Everything about the selected layer. Controls write through `onPreview`
 * during a gesture and `onChange` when a value is committed, so dragging a
 * slider is one undo step rather than sixty.
 */
export function Inspector({
  layer,
  fields,
  canvas,
  onChange,
  onPreview,
  onSnapshot,
}: {
  layer: TextLayer | null;
  fields: string[];
  /** The page the layer is aligned against. */
  canvas: { width: number; height: number };
  onChange: (patch: Partial<TextLayer>) => void;
  onPreview: (patch: Partial<TextLayer>) => void;
  onSnapshot: () => void;
}) {
  if (!layer) {
    return (
      <Section title="layer">
        <Empty>select a layer to edit it</Empty>
      </Section>
    );
  }

  const fill = layer.fill;
  const live = (patch: Partial<TextLayer>) => onPreview(patch);

  return (
    <Sections>
      <Section title="content">
        <Field label="text" hint="wrap a column name in angle brackets to merge it">
          <textarea
            value={layer.text}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={3}
            spellCheck={false}
            className="border-wash text-ink hover:border-edge focus:border-indigo w-full resize-y rounded-xs border bg-control px-2.5 py-2 font-mono text-label tracking-normal transition-colors duration-200 focus:outline-none"
          />
        </Field>

        {fields.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {fields.map((field) => (
              <Chip key={field} as="button" onClick={() => onChange({ text: `${layer.text}<${field}>` })}>
                &lt;{field}&gt;
              </Chip>
            ))}
          </div>
        ) : null}

        <Field label="case">
          <IconSegmented
            label="case"
            value={textCaseOf(layer)}
            onChange={(textCase) => onChange({ textCase, uppercase: textCase === "upper" })}
            options={CASES}
          />
        </Field>
      </Section>

      <Section title="type">
        <FontPicker font={layer.font} onChange={(patch) => onChange({ font: { ...layer.font, ...patch } })} />

        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          <Field label="size">
            <NumberInput
              value={layer.font.size}
              min={4}
              max={800}
              onChange={(e) => onChange({ font: { ...layer.font, size: Number(e.target.value) || 1 } })}
            />
          </Field>
          <Field label="line height">
            <NumberInput
              value={layer.font.lineHeight}
              step={0.05}
              min={0.6}
              max={4}
              onChange={(e) => onChange({ font: { ...layer.font, lineHeight: Number(e.target.value) || 1 } })}
            />
          </Field>
        </div>

        <Field label={`tracking · ${layer.font.letterSpacing}px`}>
          <Slider
            onCommitStart={onSnapshot}
            min={-10}
            max={40}
            value={layer.font.letterSpacing}
            onChange={(letterSpacing) => live({ font: { ...layer.font, letterSpacing } })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          <Field label="align">
            <IconSegmented label="text align" value={layer.align} onChange={(align) => onChange({ align })} options={ALIGNS} />
          </Field>
          <Field label="vertical">
            <IconSegmented label="vertical align" value={layer.vAlign} onChange={(vAlign) => onChange({ vAlign })} options={VALIGNS} />
          </Field>
        </div>

        <Toggle
          checked={layer.autoFit.enabled}
          onChange={(enabled) => onChange({ autoFit: { ...layer.autoFit, enabled } })}
          label="shrink to fit box"
        />
      </Section>

      <Section title="fill">
        <Segmented
          value={fill.type}
          onChange={(type) => onChange({ fill: type === "solid" ? { type: "solid", color: "#111827" } : DEFAULT_GRADIENT })}
          options={[
            { value: "solid", label: "solid" },
            { value: "linear", label: "gradient" },
          ]}
        />

        {fill.type === "solid" ? (
          <Field label="colour">
            <ColorInput value={fill.color} onChange={(color) => onChange({ fill: { type: "solid", color } })} />
          </Field>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label={`angle · ${fill.angle}°`}>
              <Slider onCommitStart={onSnapshot} min={0} max={360} value={fill.angle} onChange={(angle) => live({ fill: { ...fill, angle } })} />
            </Field>
            {fill.stops.map((stop, i) => (
              <Field key={i} label={`stop ${i + 1} · ${Math.round(stop.offset * 100)}%`}>
                <div className="flex items-center gap-2">
                  <ColorInput
                    value={stop.color}
                    onChange={(color) =>
                      onChange({ fill: { ...fill, stops: fill.stops.map((s, j) => (j === i ? { ...s, color } : s)) } })
                    }
                    className="flex-1"
                  />
                  <Slider
            onCommitStart={onSnapshot}
                    min={0}
                    max={100}
                    value={Math.round(stop.offset * 100)}
                    onChange={(v) =>
                      live({ fill: { ...fill, stops: fill.stops.map((s, j) => (j === i ? { ...s, offset: v / 100 } : s)) } })
                    }
                    className="w-20"
                  />
                </div>
              </Field>
            ))}
            <div className="flex items-center gap-4">
              <TextButton
                onClick={() =>
                  onChange({ fill: { ...fill, stops: [...fill.stops, { offset: 1, color: "#4845DA" }] } })
                }
              >
                add stop
              </TextButton>
              <TextButton disabled={fill.stops.length <= 2} onClick={() => onChange({ fill: { ...fill, stops: fill.stops.slice(0, -1) } })}>
                remove
              </TextButton>
            </div>
          </div>
        )}
      </Section>

      <Section
        title="stroke"
        aside={
          <TextButton
            onClick={() => onChange({ stroke: layer.stroke ? null : { color: "#FFFFFF", width: 4 } })}
            active={Boolean(layer.stroke)}
          >
            {layer.stroke ? "on" : "off"}
          </TextButton>
        }
      >
        {layer.stroke ? (
          <div className="flex flex-col gap-3">
            <Field label="colour">
              <ColorInput value={layer.stroke.color} onChange={(color) => onChange({ stroke: { ...layer.stroke!, color } })} />
            </Field>
            <Field label={`width · ${layer.stroke.width}px`}>
              <Slider onCommitStart={onSnapshot} min={0} max={40} value={layer.stroke.width} onChange={(width) => live({ stroke: { ...layer.stroke!, width } })} />
            </Field>
          </div>
        ) : (
          <Empty>no outline</Empty>
        )}
      </Section>

      <Section
        title="drop shadow"
        aside={
          <TextButton
            onClick={() => onChange({ shadow: layer.shadow ? null : { color: "rgba(17,24,39,0.35)", blur: 12, offsetX: 0, offsetY: 6 } })}
            active={Boolean(layer.shadow)}
          >
            {layer.shadow ? "on" : "off"}
          </TextButton>
        }
      >
        {layer.shadow ? (
          <div className="flex flex-col gap-3">
            <Field label="colour" hint="rgba is allowed here">
              <ColorInput value={layer.shadow.color} onChange={(color) => onChange({ shadow: { ...layer.shadow!, color } })} />
            </Field>
            <Field label={`blur · ${layer.shadow.blur}px`}>
              <Slider onCommitStart={onSnapshot} min={0} max={80} value={layer.shadow.blur} onChange={(blur) => live({ shadow: { ...layer.shadow!, blur } })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="offset x">
                <NumberInput value={layer.shadow.offsetX} onChange={(e) => onChange({ shadow: { ...layer.shadow!, offsetX: Number(e.target.value) || 0 } })} />
              </Field>
              <Field label="offset y">
                <NumberInput value={layer.shadow.offsetY} onChange={(e) => onChange({ shadow: { ...layer.shadow!, offsetY: Number(e.target.value) || 0 } })} />
              </Field>
            </div>
          </div>
        ) : (
          <Empty>no shadow</Empty>
        )}
      </Section>

      <Section title="box">
        <AlignBar layer={layer} canvas={canvas} onChange={onChange} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="x">
            <NumberInput value={Math.round(layer.x)} onChange={(e) => onChange({ x: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="y">
            <NumberInput value={Math.round(layer.y)} onChange={(e) => onChange({ y: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="width">
            <NumberInput value={Math.round(layer.width)} onChange={(e) => onChange({ width: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
          <Field label="height">
            <NumberInput value={Math.round(layer.height)} onChange={(e) => onChange({ height: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
        </div>

        <Field label={`rotation · ${layer.rotation}°`}>
          <Slider onCommitStart={onSnapshot} min={-180} max={180} value={layer.rotation} onChange={(rotation) => live({ rotation })} />
        </Field>
        <Field label={`opacity · ${Math.round(layer.opacity * 100)}%`}>
          <Slider onCommitStart={onSnapshot} min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(v) => live({ opacity: v / 100 })} />
        </Field>
      </Section>
    </Sections>
  );
}

/* ── case and text alignment ───────────────────────────────────────────────
   Case is shown as the thing it produces, set in the mono at normal tracking
   so `aa` can be told from `AA`; `as typed` is the type glyph, because it is
   the absence of a transform. Alignment glyphs are three lines of text against
   the edge they sit on; the vertical ones sit the lines inside a faint box,
   which is what separates them from the align-to-page moves below. */

const caseGlyph = (text: string) => <span className="font-mono text-label leading-none tracking-normal normal-case">{text}</span>;

const CASES: { value: TextCase; label: string; icon: ReactNode }[] = [
  { value: "none", label: "as typed", icon: <FiType className="size-3.5" aria-hidden /> },
  { value: "upper", label: "uppercase", icon: caseGlyph("AA") },
  { value: "lower", label: "lowercase", icon: caseGlyph("aa") },
  { value: "sentence", label: "sentence case", icon: caseGlyph("Aa") },
];

const ALIGNS: { value: Align; label: string; icon: ReactNode }[] = [
  { value: "left", label: "align text left", icon: <TextAlignGlyph at="left" /> },
  { value: "center", label: "centre text", icon: <TextAlignGlyph at="center" /> },
  { value: "right", label: "align text right", icon: <TextAlignGlyph at="right" /> },
];

const VALIGNS: { value: VAlign; label: string; icon: ReactNode }[] = [
  { value: "top", label: "top of the box", icon: <VAlignGlyph at="top" /> },
  { value: "middle", label: "middle of the box", icon: <VAlignGlyph at="middle" /> },
  { value: "bottom", label: "foot of the box", icon: <VAlignGlyph at="bottom" /> },
];

function TextAlignGlyph({ at }: { at: Align }) {
  const x = (w: number) => (at === "left" ? 2 : at === "right" ? 14 - w : 8 - w / 2);
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      {[12, 8, 10].map((w, i) => (
        <rect key={i} x={x(w)} y={3.5 + i * 4} width={w} height={1.5} rx={0.5} fill="currentColor" />
      ))}
    </svg>
  );
}

function VAlignGlyph({ at }: { at: VAlign }) {
  const y = at === "top" ? 4 : at === "bottom" ? 8.5 : 6.25;
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <rect x={1.5} y={1.5} width={13} height={13} rx={1.5} fill="none" stroke="currentColor" strokeOpacity={0.45} />
      <rect x={4} y={y} width={8} height={1.5} rx={0.5} fill="currentColor" />
      <rect x={4} y={y + 2.5} width={5.5} height={1.5} rx={0.5} fill="currentColor" />
    </svg>
  );
}

/* ── align to the page ─────────────────────────────────────────────────────
   Six moves, the way every canvas editor arranges them: the horizontal trio,
   a rule, then the vertical trio. Each is one commit, so each is one undo.
   A button reads as active when the layer is already flush that way, which
   turns the cluster into a readout as well as a control. */

type Move = { key: string; label: string; axis: "x" | "y"; value: (c: { width: number; height: number }, l: TextLayer) => number };

const MOVES: Move[] = [
  { key: "left", label: "align left", axis: "x", value: () => 0 },
  { key: "centre-x", label: "centre horizontally", axis: "x", value: (c, l) => (c.width - l.width) / 2 },
  { key: "right", label: "align right", axis: "x", value: (c, l) => c.width - l.width },
  { key: "top", label: "align top", axis: "y", value: () => 0 },
  { key: "middle", label: "centre vertically", axis: "y", value: (c, l) => (c.height - l.height) / 2 },
  { key: "bottom", label: "align bottom", axis: "y", value: (c, l) => c.height - l.height },
];

function AlignBar({
  layer,
  canvas,
  onChange,
}: {
  layer: TextLayer;
  canvas: { width: number; height: number };
  onChange: (patch: Partial<TextLayer>) => void;
}) {
  return (
    <Field label="align to page">
      <div className={segStrip}>
        {MOVES.map((move, i) => {
          const target = move.value(canvas, layer);
          const flush = Math.abs(layer[move.axis] - target) < 0.5;
          return (
            <Fragment key={move.key}>
              {i === 3 ? <span className="bg-wash mx-1 h-4 w-px" aria-hidden /> : null}
              <button
                type="button"
                aria-label={move.label}
                data-tip={move.label}
                data-tip-pos={i === 0 ? "top-left" : i === MOVES.length - 1 ? "top-right" : undefined}
                aria-pressed={flush}
                onClick={() => onChange({ [move.axis]: Math.round(target) })}
                className={segCell(flush)}
              >
                <AlignGlyph move={move.key} />
              </button>
            </Fragment>
          );
        })}
      </div>
    </Field>
  );
}

/**
 * Drawn rather than borrowed: a 1px rule for the edge you are aligning to and
 * two bars moving onto it, at the same hairline weight as the rest of the panel.
 */
function AlignGlyph({ move }: { move: string }) {
  const rule = "currentColor";
  const bar = "currentColor";
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true } as const;

  switch (move) {
    case "left":
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="1" height="13" fill={rule} />
          <rect x="4.5" y="4" width="8" height="2.5" rx="0.75" fill={bar} opacity="0.75" />
          <rect x="4.5" y="9.5" width="5" height="2.5" rx="0.75" fill={bar} opacity="0.75" />
        </svg>
      );
    case "centre-x":
      return (
        <svg {...common}>
          <rect x="7.5" y="1.5" width="1" height="13" fill={rule} />
          <rect x="3" y="4" width="10" height="2.5" rx="0.75" fill={bar} opacity="0.75" />
          <rect x="4.5" y="9.5" width="7" height="2.5" rx="0.75" fill={bar} opacity="0.75" />
        </svg>
      );
    case "right":
      return (
        <svg {...common}>
          <rect x="13" y="1.5" width="1" height="13" fill={rule} />
          <rect x="3.5" y="4" width="8" height="2.5" rx="0.75" fill={bar} opacity="0.75" />
          <rect x="6.5" y="9.5" width="5" height="2.5" rx="0.75" fill={bar} opacity="0.75" />
        </svg>
      );
    case "top":
      return (
        <svg {...common}>
          <rect x="1.5" y="2" width="13" height="1" fill={rule} />
          <rect x="4" y="4.5" width="2.5" height="8" rx="0.75" fill={bar} opacity="0.75" />
          <rect x="9.5" y="4.5" width="2.5" height="5" rx="0.75" fill={bar} opacity="0.75" />
        </svg>
      );
    case "middle":
      return (
        <svg {...common}>
          <rect x="1.5" y="7.5" width="13" height="1" fill={rule} />
          <rect x="4" y="3" width="2.5" height="10" rx="0.75" fill={bar} opacity="0.75" />
          <rect x="9.5" y="4.5" width="2.5" height="7" rx="0.75" fill={bar} opacity="0.75" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="1.5" y="13" width="13" height="1" fill={rule} />
          <rect x="4" y="3.5" width="2.5" height="8" rx="0.75" fill={bar} opacity="0.75" />
          <rect x="9.5" y="6.5" width="2.5" height="5" rx="0.75" fill={bar} opacity="0.75" />
        </svg>
      );
  }
}
