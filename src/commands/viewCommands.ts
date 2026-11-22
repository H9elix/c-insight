import { COMMANDS } from "../ids";
import type { ViewDiscovery } from "../views/viewDiscovery";
import type { RegisterCommand } from "./commandRegistrar";

export function registerViewCommands(register: RegisterCommand, discovery: ViewDiscovery): void {
  register(COMMANDS.OPEN_VIEW, () => discovery.open());
}
