import {
  assertDataContainer,
  outputLeaves,
  print,
  readSettings,
  type OutputSchema,
  type Rel,
} from '@typedhouse/core';
import { validateStructure } from './validate-structure.js';
import { ValidationError } from './validation-error.js';

export interface PeeledSettings {
  /** The query to validate and emit. Its result is the query's result, so `rel === root` holds. */
  readonly input: Rel;
  /** `key = literal` items for the tail. */
  readonly settings: readonly string[];
}

const shape = (output: OutputSchema) =>
  JSON.stringify(outputLeaves(output).map(leaf => [leaf.path, print(leaf.type)]));

/** Remove a root `Settings` node, checking only what the rest of the compiler will not see.
 * Anything below the root reaches validateStructure, which raises invalid_settings_placement.
 */
export function peelSettings(root: Rel): PeeledSettings {
  try {
    assertDataContainer(root);
  } catch {
    return { input: root, settings: [] }; // validateStructure owns this diagnostic.
  }

  if (root.kind !== 'Settings') return { input: root, settings: [] };

  if (typeof root.id !== 'number')
    throw new ValidationError('invalid_structure', root, 'root.id', 'expected number');

  // Read once: what is validated here is what the emitters see.
  const { input, output } = root;
  const settings = readSettings(root.settings);

  if ('code' in settings)
    throw new ValidationError(settings.code, root, `root.${settings.path}`, settings.detail);

  validateStructure(input);
  let matches = false;

  try {
    matches = shape(output) === shape(input.output);
  } catch {
    // A malformed wrapper output does not match.
  }

  if (!matches) throw new ValidationError('invalid_output', root, 'root');
  return { input, settings };
}
