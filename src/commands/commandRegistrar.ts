import type { CommandId } from "../ids";

export type RegisterCommand = (
  id: CommandId,
  callback: (...args: unknown[]) => unknown,
) => void;
