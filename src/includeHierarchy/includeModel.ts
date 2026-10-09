import * as path from "node:path";

export interface IncludeDirective {
  text: string;
  target: string;
  angled: boolean;
  line: number;
}

export interface IncludeSearchPaths {
  quote: string[];
  user: string[];
  system: string[];
}

export function parseIncludes(source: string): IncludeDirective[] {
  const lines = source.split(/\r?\n/);
  const directives: IncludeDirective[] = [];
  let inBlockComment = false;
  for (let line = 0; line < lines.length; line += 1) {
    let cleaned = "";
    const input = lines[line];
    for (let index = 0; index < input.length; index += 1) {
      if (inBlockComment) {
        if (input[index] === "*" && input[index + 1] === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }
      if (input[index] === "/" && input[index + 1] === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }
      if (input[index] === "/" && input[index + 1] === "/") {
        break;
      }
      cleaned += input[index];
    }
    const match = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(cleaned);
    if (match) {
      directives.push({
        text: input.trim(),
        target: match[2].trim(),
        angled: match[1] === "<",
        line,
      });
    }
  }
  return directives;
}

export function includeDirectiveFingerprint(source: string): string {
  return parseIncludes(source)
    .map((directive) =>
      `${directive.line}:${directive.angled ? "<" : "\""}${directive.target}`
    )
    .join("\n");
}

export function shellSplit(command: string): string[] {
  const output: string[] = [];
  let value = "";
  let quote: "'" | "\"" | undefined;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        value += character;
      }
    } else if (character === "'" || character === "\"") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (value) {
        output.push(value);
        value = "";
      }
    } else {
      value += character;
    }
  }
  if (value) {
    output.push(value);
  }
  return output;
}

export function includeSearchPaths(
  arguments_: readonly string[],
  directory: string,
): IncludeSearchPaths {
  const result: IncludeSearchPaths = { quote: [], user: [], system: [] };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const separated =
      argument === "-I" || argument === "-isystem" || argument === "-iquote";
    const value = separated ? arguments_[++index] : attachedValue(argument);
    if (!value) {
      continue;
    }
    const resolved = path.resolve(directory, value);
    if (argument === "-iquote" || argument.startsWith("-iquote")) {
      result.quote.push(resolved);
    } else if (
      argument === "-isystem" ||
      argument.startsWith("-isystem")
    ) {
      result.system.push(resolved);
    } else if (argument === "-I" || argument.startsWith("-I")) {
      result.user.push(resolved);
    }
  }
  return {
    quote: unique(result.quote),
    user: unique(result.user),
    system: unique(result.system),
  };
}

function attachedValue(argument: string): string | undefined {
  if (argument.startsWith("-iquote") && argument.length > 7) {
    return argument.slice(7);
  }
  if (argument.startsWith("-isystem") && argument.length > 8) {
    return argument.slice(8);
  }
  if (argument.startsWith("-I") && argument.length > 2) {
    return argument.slice(2);
  }
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
