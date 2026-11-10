// Registry of TypeScript frameworks. To add one: write agents/<name>.ts exporting a Framework, add it here.
import type { Framework } from "../harness/types";
import { anthropicSdk } from "./anthropic-sdk";

export const FRAMEWORKS: Framework[] = [anthropicSdk];
