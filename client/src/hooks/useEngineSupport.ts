import { useMemo } from "react";
import {
  reasonCodecUnsupported,
  reasonUnsupported,
  supportNote,
  type CodecId,
  type EngineId,
  type PassId,
} from "@tools/shared";

/**
 * How a row stands on the chosen engine. `reason` set → the row dims (opacity,
 * never colour) and shows it inline; `note` set → it runs, minus what the note
 * says. Both are sentences from the capability matrix, shown as-is.
 */
export type RowSupport = { supported: boolean; reason: string | null; note: string | null };

export type EngineSupport = {
  engine: EngineId;
  pass: (pass: PassId) => RowSupport;
  codec: (codec: CodecId) => RowSupport;
};

export function engineSupport(engine: EngineId): EngineSupport {
  return {
    engine,
    pass: (pass) => {
      const reason = reasonUnsupported(engine, pass);
      return { supported: !reason, reason, note: reason ? null : supportNote(engine, pass) };
    },
    codec: (codec) => {
      const reason = reasonCodecUnsupported(engine, codec);
      return { supported: !reason, reason, note: null };
    },
  };
}

/** `engineSupport` for the engine a panel has picked, stable while it stays picked. */
export function useEngineSupport(engine: EngineId): EngineSupport {
  return useMemo(() => engineSupport(engine), [engine]);
}
