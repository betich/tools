import type { Fill, TextLayer } from "@tools/shared";
import { Chip, ColorInput, Empty, Field, NumberInput, Section, Segmented, Slider, TextButton, Toggle } from "@/components/ui";
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
  onChange,
  onPreview,
  onSnapshot,
}: {
  layer: TextLayer | null;
  fields: string[];
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
    <div className="flex flex-col gap-6">
      <Section title="content">
        <Field label="text" hint="wrap a column name in angle brackets to merge it">
          <textarea
            value={layer.text}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={3}
            spellCheck={false}
            className="border-wash text-ink hover:border-[rgba(244,243,255,0.28)] focus:border-indigo w-full resize-y rounded-xs border bg-[rgba(244,243,255,0.04)] px-2.5 py-2 font-mono text-label tracking-normal transition-colors duration-200 focus:outline-none"
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

        <Toggle checked={layer.uppercase} onChange={(uppercase) => onChange({ uppercase })} label="uppercase" />
      </Section>

      <Section title="type">
        <FontPicker font={layer.font} onChange={(patch) => onChange({ font: { ...layer.font, ...patch } })} />

        <div className="grid grid-cols-2 gap-3">
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="align">
            <Segmented
              value={layer.align}
              onChange={(align) => onChange({ align })}
              options={[
                { value: "left", label: "left" },
                { value: "center", label: "mid" },
                { value: "right", label: "right" },
              ]}
            />
          </Field>
          <Field label="vertical">
            <Segmented
              value={layer.vAlign}
              onChange={(vAlign) => onChange({ vAlign })}
              options={[
                { value: "top", label: "top" },
                { value: "middle", label: "mid" },
                { value: "bottom", label: "base" },
              ]}
            />
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
    </div>
  );
}
