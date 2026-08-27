export type UsSyncMode = "initialize" | "update";

export function chooseUsSyncMode(input: {
  started: boolean;
  remaining: number;
}): UsSyncMode {
  return input.started && input.remaining === 0 ? "update" : "initialize";
}
