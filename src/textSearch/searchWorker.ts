import { parentPort } from "node:worker_threads";
import { findMatches, type SearchOptions } from "./searchModel";

parentPort?.on("message", (message: {text: string; options: SearchOptions; maximum: number; positions?: number[]}) => {
  try { parentPort?.postMessage({result: findMatches(message.text, message.options, message.maximum, message.positions)}); }
  catch (error) { parentPort?.postMessage({error: String(error)}); }
});
